import { token_sort_ratio } from 'fuzzball';
import type { ClientOptions } from '../config/client.js';
import { redisGetCache, redisSetCache } from '../config/redis.js';
import { BaseClass } from '../providers/models/base.js';
import type { IResponse } from '../types/base.js';
import type { ICinemetaEpisode, ICineMetaSearch } from '../types/cinemeta.js';
import type { IMetaAnime, IRelatedAnimeData } from '../types/meta/meta-anime.js';
import { AIOMetadata } from './aiometadata.js';
import type { AnimeInfoResolver } from './anime-resolver.js';
import { getByAnilistId, upsertMapping } from '../db/queries.js';
import { error } from 'console';

type CinemetaMediaType = 'movie' | 'series';

interface IScheduleNode {
  episode: number;
  airingAt: number;
}

interface IScheduleMap {
  [anilistId: string]: IScheduleNode[];
}

class Cinemeta extends BaseClass {
  constructor(
    private readonly resolver: AnimeInfoResolver,
    options: ClientOptions = { browser: 'okhttp4' },
  ) {
    super(options);
  }

  private static readonly MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  private static readonly SCHEDULE_TTL_HOURS = 1;

  private static readonly UNRELEASED_STATUSES = new Set(['unreleased', 'not_yet_released', 'upcoming', 'tba']);

  // One shared instance so search and episode fetches share its cache
  private readonly aioMetadata = new AIOMetadata();

  /**
   * Maximum acceptable distance, in days, between an anime's releaseDate
   * and the nearest episode airDate for that airDate to be trusted as
   * the anchor.
   */
  private readonly DATE_ANCHOR_TOLERANCE_DAYS = 7;

  private selectCandidateEpisodes(episodes: ICinemetaEpisode[], animeFormat: string | null): ICinemetaEpisode[] {
    if (animeFormat === 'tv') {
      return episodes.filter(ep => (ep.seasonNumber ?? 0) >= 1);
    }

    return episodes;
  }

  /**
   * Returns whether the anime start date is recent enough to use the
   * normal Cinemeta episode list.
   *
   * An old start date means the AniList entry is likely a separate cour,
   * season, movie, or special inside a larger franchise. In that case
   * AIO metadata is used instead of trusting the franchise-wide
   * Cinemeta episode list.
   */
  private isRecentStartDate(startDate: Date | null): boolean {
    if (!startDate) return true;

    const diffDays = (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24);

    return diffDays <= this.DATE_ANCHOR_TOLERANCE_DAYS;
  }

  /**
   * Finds the index in `sorted` where this anime's episodes begin.
   *
   * Tier 1: nearest airDate within DATE_ANCHOR_TOLERANCE_DAYS.
   * Tier 2: month-precision match. Cinemeta often stores month-only dates
   *         as the 1st of the month, so an episode dated the 1st in the
   *         same, next, then previous month (in that order) is accepted.
   * Tier 3: nearest episode dated in the target month or the next. Covers
   *         streaming-first releases (e.g. Stone Ocean: AniList 2021-12-01,
   *         Cinemeta 2022-01-08).
   *
   * Specials (season 0) are ignored in tiers 2 and 3.
   * Returns null when nothing qualifies.
   */
  private findAnchorIndex(sorted: ICinemetaEpisode[], startDate: Date): number | null {
    const DAY = 86_400_000;
    const monthIdx = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
    const targetMonth = monthIdx(startDate);

    let nearestIdx = -1;
    let nearestDiff = Infinity;
    let windowIdx = -1;
    let windowDiff = Infinity;
    const firstOfMonth = new Map<number, number>(); // month offset -> first matching index

    sorted.forEach((ep, i) => {
      const d = this.normalizeDate(ep.airDate);
      if (!d) return;

      const diff = Math.abs(d.getTime() - startDate.getTime());
      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearestIdx = i;
      }

      if ((ep.seasonNumber ?? 0) === 0) return;

      const offset = monthIdx(d) - targetMonth;

      if (offset >= 0 && offset <= 1 && diff < windowDiff) {
        windowDiff = diff;
        windowIdx = i;
      }

      if (d.getUTCDate() === 1 && !firstOfMonth.has(offset)) {
        firstOfMonth.set(offset, i);
      }
    });

    if (nearestIdx !== -1 && nearestDiff / DAY <= this.DATE_ANCHOR_TOLERANCE_DAYS) {
      return nearestIdx;
    }

    for (const offset of [0, 1, -1]) {
      const idx = firstOfMonth.get(offset);
      if (idx !== undefined) return idx;
    }

    return windowIdx !== -1 ? windowIdx : null;
  }

  /**
   * Resolves which Cinemeta episodes belong to this anime entry:
   * 1. find the start anchor
   * 2. take `episodes` count from the anchor
   * 3. otherwise everything from the anchor up to endDate
   * 4. otherwise everything from the anchor onward
   */
  private resolveEpisodeRange(anime: IMetaAnime, allEpisodes: ICinemetaEpisode[]): ICinemetaEpisode[] {
    const startDate = this.normalizeDate(anime.releaseDate);
    const rawEnd = this.normalizeDate(anime.endDate);
    const episodeCount = anime.episodes;

    // endDate === startDate means a batch drop, not a usable end boundary
    const endDate = rawEnd && startDate && rawEnd.getTime() === startDate.getTime() ? null : rawEnd;

    const pool = this.selectCandidateEpisodes(allEpisodes, anime.format?.toLowerCase() ?? null);

    const sorted = [...pool].sort(
      (a, b) =>
        (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) ||
        (a.seasonEpisodeNumber ?? a.episodeNumber ?? 0) - (b.seasonEpisodeNumber ?? b.episodeNumber ?? 0) ||
        (this.normalizeDate(a.airDate)?.getTime() ?? 0) - (this.normalizeDate(b.airDate)?.getTime() ?? 0),
    );

    if (!startDate) return sorted;

    const anchorIdx = this.findAnchorIndex(sorted, startDate);
    if (anchorIdx === null) return [];

    const fromStart = sorted.slice(anchorIdx);

    if (typeof episodeCount === 'number' && episodeCount > 0) {
      return fromStart.slice(0, episodeCount);
    }

    if (endDate) {
      return fromStart.filter(ep => {
        const d = this.normalizeDate(ep.airDate);
        return d !== null && d <= endDate;
      });
    }

    return fromStart;
  }

  private async loadSchedule(): Promise<IResponse<IScheduleMap | null>> {
    try {
      const cacheKey = 'anischedule-sub-schedule';
      const cached = await redisGetCache<IResponse<IScheduleMap | null>>(cacheKey);
      if (cached) return cached;

      const response = await this.client.fetch(
        'https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/sub-schedule.json',
        { method: 'GET' },
      );

      if (!response.ok)
        return {
          data: null,
          error: response.statusText,
          status: response.status,
        };

      const json = (await response.json()) as any[];
      const slim: IScheduleMap = {};

      for (const entry of json) {
        const nodes = entry?.airingSchedule?.nodes;

        if (entry?.id && Array.isArray(nodes) && nodes.length > 0) {
          slim[String(entry.id)] = nodes.map((node: any) => ({
            episode: node.episode,
            airingAt: node.airingAt,
          }));
        }
      }

      const result: IResponse<IScheduleMap | null> = { data: slim };

      await redisSetCache(cacheKey, result, Cinemeta.SCHEDULE_TTL_HOURS);

      return result;
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : String(error), status: 500 };
    }
  }

  /**
   * Aligns a releasing anime's episode list with what has actually aired,
   * using AniSchedule as the source of truth.
   *
   * AniSchedule lists only upcoming episodes, so the next unaired episode
   * number minus one is the number of episodes already out.
   *
   * - More episodes than that: the excess is cut (Cinemeta placeholders,
   *   later seasons caught by an open-ended range, etc.).
   * - Fewer: the aired episodes Cinemeta hasn't caught up on are padded.
   *   Their airing time comes from the schedule when listed; otherwise it is
   *   the first scheduled airing stepped back by the schedule's own interval.
   *
   * Season/episode numbers continue from the last real Cinemeta episode so
   * imdbIds line up with Cinemeta's numbering. Anime missing from the
   * schedule are returned untouched.
   */
  private async syncWithSchedule(
    anilistId: number,
    anime: IMetaAnime,
    episodes: ICinemetaEpisode[],
  ): Promise<ICinemetaEpisode[]> {
    if (episodes.length === 0) return episodes;

    const schedule = (await this.loadSchedule()).data;
    if (!schedule) return episodes;

    const nodes = [...(schedule[String(anilistId)] ?? [])].sort((a, b) => a.episode - b.episode);
    if (nodes.length === 0) return episodes;

    const nowSec = Math.floor(Date.now() / 1000);
    const total = typeof anime.episodes === 'number' && anime.episodes > 0 ? anime.episodes : Infinity;

    const next = nodes.find(node => node.airingAt > nowSec);
    const airedCount = Math.min(next ? next.episode - 1 : nodes[nodes.length - 1].episode, total);

    if (episodes.length >= airedCount) return episodes.slice(0, airedCount);

    // Pad aired episodes Cinemeta doesn't have yet
    const last = episodes[episodes.length - 1];
    const lastNumber = last.episodeNumber ?? episodes.length;

    const first = nodes[0];
    const interval = nodes.length > 1 && nodes[1].airingAt > first.airingAt ? nodes[1].airingAt - first.airingAt : 604_800;
    const airingByEpisode = new Map(nodes.map(node => [node.episode, node.airingAt]));

    const padded: ICinemetaEpisode[] = [];

    for (let ep = lastNumber + 1; ep <= airedCount; ep++) {
      const airingAt = airingByEpisode.get(ep) ?? first.airingAt - (first.episode - ep) * interval;
      const seasonEpisodeNumber = last.seasonEpisodeNumber != null ? last.seasonEpisodeNumber + (ep - lastNumber) : null;

      padded.push({
        ...last,
        title: `Episode ${ep}`,
        airDate: new Date(airingAt * 1000).toISOString(),
        seasonEpisodeNumber,
        thumbnail: '',
        imdbId: seasonEpisodeNumber != null ? `${last.id}:${last.seasonNumber}:${seasonEpisodeNumber}` : last.imdbId,
        summary: '',
        episodeNumber: ep,
      });
    }

    return [...episodes, ...padded];
  }

  /**
   * Pads a short episode list up to `targetCount` by cloning the last real
   * episode and filling in sequential numbers / air dates.
   * Used for FINISHED titles when Cinemeta is missing later episodes.
   */
  private padEpisodes(episodes: ICinemetaEpisode[], targetCount: number): ICinemetaEpisode[] {
    if (episodes.length === 0 || episodes.length >= targetCount) {
      return episodes.slice(0, targetCount);
    }

    const last = episodes[episodes.length - 1];
    const lastNumber = last.episodeNumber ?? episodes.length;
    const INTERVAL_SEC = 604_800; // weekly fallback when no schedule data

    const padded: ICinemetaEpisode[] = [];

    for (let ep = lastNumber + 1; ep <= targetCount; ep++) {
      const seasonEpisodeNumber = last.seasonEpisodeNumber != null ? last.seasonEpisodeNumber + (ep - lastNumber) : null;

      const lastAir = this.normalizeDate(last.airDate);
      const airDate = lastAir
        ? new Date(lastAir.getTime() + (ep - lastNumber) * INTERVAL_SEC * 1000).toISOString()
        : last.airDate;

      padded.push({
        ...last,
        title: `Episode ${ep}`,
        airDate,
        seasonEpisodeNumber,
        thumbnail: '',
        imdbId: seasonEpisodeNumber != null ? `${last.id}:${last.seasonNumber}:${seasonEpisodeNumber}` : last.imdbId,
        summary: '',
        episodeNumber: ep,
      });
    }

    return [...episodes, ...padded];
  }

  /**
   * Final validation of the resolved episode list.
   *
   * FINISHED: pad up to AniList's reported count when Cinemeta is short;
   *           still reject when we somehow have *more* episodes than reported.
   * Anything else (releasing, hiatus…): synced against AniSchedule.
   */
  private async finalizeEpisodes(
    anilistId: number,
    anime: IMetaAnime,
    episodes: ICinemetaEpisode[],
  ): Promise<IResponse<ICinemetaEpisode[] | []>> {
    if (anime.status?.toUpperCase() === 'FINISHED') {
      const expected = anime.episodes;

      if (typeof expected === 'number' && expected > 0) {
        if (episodes.length > expected) {
          return { data: episodes.slice(0, expected) };
        }
        if (episodes.length < expected) {
          return { data: this.padEpisodes(episodes, expected) };
        }
      }

      return { data: episodes };
    }

    return { data: await this.syncWithSchedule(anilistId, anime, episodes) };
  }

  /**
   * Strips season / cour / part markers and trailing roman numerals so
   * the title is the bare franchise name. Falls back to the original
   * title if stripping would leave nothing.
   */
  private cleanTitle(title: string): string {
    const ORDINAL = '(?:\\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final)';
    const ROMAN = '(?:II|III|IV|V|VI|VII|VIII|IX|X)';

    const cleaned = title
      // "2nd Season", "Final Season", "Third Cour", "Second Part"
      .replace(new RegExp(`\\b${ORDINAL}\\s+(?:season|cour|part)\\b`, 'gi'), ' ')
      // "Season 2", "Cour 2", "Part 4", "Season II"
      .replace(new RegExp(`\\b(?:season|cour|part)\\s*(?:\\d+|${ROMAN})\\b`, 'gi'), ' ')
      // "S2", "S02"
      .replace(/\bS\d{1,2}\b/g, ' ')
      // Trailing roman numeral: "Overlord IV", "Overlord IV: ..." (uppercase only)
      .replace(new RegExp(`\\s+${ROMAN}(?=\\s*(?:[:\\-–]|$))`, 'g'), '')
      // Dangling punctuation left behind
      .replace(/\s*[:\-–,]+\s*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return cleaned || title.trim();
  }

  private extractTitle(media: IMetaAnime): string | undefined {
    const raw = media.title.english || media.title.romaji || undefined;

    return raw ? this.cleanTitle(raw) : undefined;
  }

  /**
   * Titles to search with, in order: the preferred title (english, then
   * romaji, then native), then romaji. Synonyms are never searched; they are
   * only used for scoring. Deduped, and capped because each query costs two
   * requests (anime series + anime movie catalogs) on a cache miss.
   */
  private extractSearchQueries(media: IMetaAnime, maxQueries = 5): string[] {
    const candidates = [this.extractTitle(media), media.title.romaji];

    const seen = new Set<string>();
    const queries: string[] = [];

    for (const query of candidates) {
      const key = query?.toLowerCase().trim();

      if (!query || !key || seen.has(key)) continue;

      seen.add(key);
      queries.push(query);

      if (queries.length >= maxQueries) break;
    }

    return queries;
  }

  private normalizeDate(dateStr: string | null | undefined): Date | null {
    if (!dateStr) return null;

    const trimmed = dateStr.trim();
    if (!trimmed || trimmed.toLowerCase() === 'unknown') return null;

    let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));

    m = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m) {
      const monthIdx = Cinemeta.MONTH_ABBR.indexOf(m[1].slice(0, 3).toLowerCase());
      if (monthIdx >= 0) return new Date(Date.UTC(Number(m[3]), monthIdx, Number(m[2])));
    }

    return null;
  }

  /**
   * Takes a full list of search candidates, filters out knockouts,
   * computes title similarities across all query variants, and returns the best match.
   */
  private findBestMatch(candidates: ICineMetaSearch[], animeData: IMetaAnime): ICineMetaSearch | null {
    const queries = this.extractSearchQueries(animeData);
    if (!candidates || candidates.length === 0 || !queries || queries.length === 0) {
      return null;
    }

    let bestCandidate: ICineMetaSearch | null = null;
    let highestScore = -1;

    for (const candidate of candidates) {
      // 1. Hard disqualifier check (format, episode count, duration, end year)
      if (this.isKnockedOut(candidate, animeData)) {
        continue;
      }

      const candidateName = candidate.name ?? '';
      let maxScore = 0;

      // 2. Evaluate title similarity against all target query variants
      for (const target of queries) {
        const normTarget = target.toLowerCase().trim();
        const normCandidate = candidateName.toLowerCase().trim();

        if (!normTarget || !normCandidate) continue;
        if (normTarget === normCandidate) {
          maxScore = 1.0;
          break; // Perfect match found, no need to check other queries
        }

        const sortSimilarity = token_sort_ratio(normTarget, normCandidate) / 100;

        const targetTokens = new Set(normTarget.split(/[\s:,\-_!?.]+/).filter(Boolean));
        const candidateTokens = new Set(normCandidate.split(/[\s:,\-_!?.]+/).filter(Boolean));

        let overlap = 0;
        for (const token of targetTokens) {
          if (candidateTokens.has(token)) overlap++;
        }

        // Divide by the LARGER set so one shared word can't score 1.0
        const maxTokenCount = Math.max(targetTokens.size, candidateTokens.size);
        const tokenSimilarity = maxTokenCount > 0 ? overlap / maxTokenCount : 0;

        let score = Math.max(sortSimilarity, tokenSimilarity);

        // Substring floor only when the shorter title is a big part of the longer one
        const [shorter, longer] =
          normTarget.length <= normCandidate.length ? [normTarget, normCandidate] : [normCandidate, normTarget];

        if (longer.includes(shorter) && shorter.length / longer.length >= 0.5 && score < 0.75) {
          score = 0.75;
        }

        if (score > maxScore) {
          maxScore = score;
        }
      }

      // 3. Track the highest scoring candidate overall
      if (maxScore > highestScore) {
        highestScore = maxScore;
        bestCandidate = candidate;
      }
    }

    return bestCandidate;
  }

  /**
   * Hard disqualifiers based on AniList/Kitsu metadata & end-year validation.
   * A candidate that is knocked out is never scored, regardless of title similarity.
   */
  private isKnockedOut(candidate: ICineMetaSearch, anime: IMetaAnime): boolean {
    const candidateType = candidate.type?.toLowerCase();

    // Unknown candidate type: don't knock out on missing data
    if (candidateType !== 'movie' && candidateType !== 'series') return false;

    const format = anime.format?.toLowerCase() ?? null;
    const episodes = typeof anime.episodes === 'number' ? anime.episodes : null;
    const duration = typeof anime.duration === 'number' && anime.duration > 0 ? anime.duration : null;

    let expected: CinemetaMediaType | null = null;

    if (format === 'movie') {
      expected = 'movie';
    } else if (format === 'tv' || format === 'ona' || format === 'ova') {
      // Standard TV/ONA/OVA are generally series, unless it's explicitly a single-episode movie special
      if (episodes === 1 && duration !== null && duration > 30) {
        expected = 'movie';
      } else {
        expected = 'series';
      }
    } else if (episodes !== null && episodes > 1) {
      expected = 'series';
    } else if (duration !== null) {
      if (duration > 30) {
        expected = episodes === null ? 'series' : 'movie';
      } else if (episodes !== 1) {
        expected = 'series';
      }
    }

    if (expected !== null && candidateType !== expected) {
      return true;
    }

    if (candidate.endYear) {
      const candidateEnd = parseInt(candidate.endYear, 10);

      if (!isNaN(candidateEnd)) {
        const animeStart = anime.year ? Number(anime.year) : null;

        let animeEnd: number | null = null;
        if (anime.endDate && anime.endDate.toLowerCase() !== 'unknown') {
          const match = anime.endDate.match(/\d{4}/);
          if (match) {
            animeEnd = parseInt(match[0], 10);
          }
        }

        const isReleasing = anime.status?.toLowerCase() === 'releasing';

        if (isReleasing && animeStart && candidateEnd < animeStart) {
          return true;
        }

        if (animeEnd !== null) {
          if (Math.abs(candidateEnd - animeEnd) > 2) {
            return true;
          }
        } else if (animeStart !== null && candidateEnd < animeStart) {
          return true;
        }
      }
    }

    return false;
  }

  private async search(animeData: IMetaAnime): Promise<IResponse<ICineMetaSearch | null>> {
    try {
      const queries = this.extractSearchQueries(animeData);
      const allResults: ICineMetaSearch[] = [];
      const seenIds = new Set<string>();

      // 1. Fetch search results for all query variants
      for (const title of queries) {
        const response = await this.aioMetadata.search(title);

        if (response && Array.isArray(response.data)) {
          for (const item of response.data) {
            if (item && item.id && !seenIds.has(item.id)) {
              seenIds.add(item.id);
              allResults.push(item);
            }
          }
        }
      }
      return { data: this.findBestMatch(allResults, animeData) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error', data: null, status: 500 };
    }
  }

  async fetchAnimeEpisode(anilistId: number): Promise<IResponse<ICinemetaEpisode[] | []>> {
    try {
      const animeData = (await this.resolver.resolveAnimeInfo(anilistId)).data;

      if (!animeData) {
        return {
          data: [],
          error: 'Could not resolve anime information',
          status: 404,
        };
      }

      const animeStatus = animeData.status?.toLowerCase();
      if (animeStatus && Cinemeta.UNRELEASED_STATUSES.has(animeStatus)) {
        return {
          data: [],
          error: 'Not yet released',
          status: 400,
        };
      }

      let imdbId: string | null = null;
      let type: string | null = null;
      let kitsuId: number | null = null;

      const existing = await getByAnilistId(anilistId);

      if (existing?.imdb_id && existing.media_type) {
        imdbId = existing.imdb_id;
        type = existing.media_type;
      } else {
        const mapping = await this.aioMetadata.fetchMappingsByProviderId(`anilist:${anilistId}`);

        if (!mapping.error && mapping.data && mapping.data.imdbId) {
          imdbId = mapping.data.imdbId;
          type = mapping.data.type;
          kitsuId = mapping.data.kitsuId ? Number(mapping.data.kitsuId) : null;
        } else {
          const searchResult = (await this.search(animeData)).data;

          if (searchResult) {
            imdbId = searchResult.imdbId;
            type = searchResult.type;
          }
        }
      }

      if (!imdbId || !type) {
        return {
          data: [],
          error: 'Could not resolve IMDbId or type for anime',
          status: 404,
        };
      }

      const rawEpisodesResponse = await this.aioMetadata.fetchEpisodes(imdbId, type);
      const rawEpisodes = rawEpisodesResponse.data;

      if (!rawEpisodes || rawEpisodes.length === 0) {
        return { data: [], error: 'No episodes found for this media', status: 404 };
      }

      const resolvedEpisodes = this.resolveEpisodeRange(animeData, rawEpisodes);

      const finalizedResponse = await this.finalizeEpisodes(anilistId, animeData, resolvedEpisodes);
      const finalizedEpisodes = finalizedResponse.data ?? [];

      if (finalizedEpisodes.length === 0) {
        return { data: [], error: 'No episodes found for this media', status: 404 };
      }

      const episodesWithIds: ICinemetaEpisode[] = finalizedEpisodes.map((ep, index) => ({
        ...ep,
        episodeNumber: index + 1,
        kitsuId: kitsuId,
      }));

      await upsertMapping(anilistId, type, { imdbId: imdbId });

      return { data: episodesWithIds };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 500,
      };
    }
  }
}
export { Cinemeta };
