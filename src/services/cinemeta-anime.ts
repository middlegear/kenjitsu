import { token_sort_ratio } from 'fuzzball';
import type { ClientOptions } from '../config/client.js';
import { redisGetCache, redisSetCache } from '../config/redis.js';
import { BaseClass } from '../providers/models/base.js';
import type { IResponse } from '../types/base.js';
import type { ICinemetaEpisode, ICineMetaSearch } from '../types/cinemeta.js';
import type { IMetaAnime, IRelatedAnimeData } from '../types/meta/meta-anime.js';
import { AIOMetadata, type MediaType } from './aiometadata.js';
import type { AnimeInfoResolver } from './anime-resolver.js';
import { getByAnilistId, upsertMapping } from '../db/queries.js';

interface IScheduleNode {
  episode: number;
  airingAt: number;
}

interface IScheduleMap {
  [anilistId: string]: IScheduleNode[];
}

interface IEpisodeSource {
  imdbId: string;
  type: string;
  kitsuId: number | null;
  episodes: ICinemetaEpisode[];
}

class Cinemeta extends BaseClass {
  constructor(
    private readonly resolver: AnimeInfoResolver,
    options: ClientOptions = { browser: 'okhttp5' },
  ) {
    super(options);
  }

  private static readonly MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  private static readonly SCHEDULE_TTL_HOURS = 1;

  private static readonly UNRELEASED_STATUSES = new Set(['unreleased', 'not_yet_released', 'upcoming', 'tba']);

  /** Media types are tried in this order until one yields a valid episode range. */
  private static readonly SEARCH_ORDER: readonly MediaType[] = ['series', 'movie'];

  // One shared instance so search and episode fetches share its cache
  private readonly aioMetadata = new AIOMetadata();

  /**
   * Maximum acceptable distance, in days, between an anime's releaseDate
   * and the nearest episode airDate for that airDate to be trusted as
   * the anchor.
   */
  private readonly DATE_ANCHOR_TOLERANCE_DAYS = 7;

  /**
   * A failure belongs to an (imdbId, type) pair: the same imdbId can be
   * invalid as a series yet valid as a movie, so the blacklist is keyed by both.
   */
  private static blacklistKey(type: string, imdbId: string): string {
    return `${type}:${imdbId}`;
  }

  private selectCandidateEpisodes(
    episodes: ICinemetaEpisode[],
    animeFormat: string | null,
    mediaType?: string,
  ): ICinemetaEpisode[] {
    if (mediaType === 'movie') return episodes;

    if (animeFormat === 'tv') {
      return episodes.filter(ep => (ep.seasonNumber ?? 0) >= 1);
    }

    return episodes;
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
  private findAnchorIndex(sorted: ICinemetaEpisode[], startDate: Date, mediaType?: string): number | null {
    const DAY = 86_400_000;
    const monthIdx = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
    const targetMonth = monthIdx(startDate);
    const MONTH_TOLERANCE = 1;

    let nearestIdx = -1;
    let nearestDiff = Infinity;
    let windowIdx = -1;
    let windowDiff = Infinity;
    const firstOfMonth = new Map<number, number>();

    sorted.forEach((ep, i) => {
      const d = this.normalizeDate(ep.airDate);
      if (!d) return;

      const diff = Math.abs(d.getTime() - startDate.getTime());
      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearestIdx = i;
      }

      // Only skip “season 0 / specials” for series – never for movies
      if (mediaType !== 'movie' && (ep.seasonNumber ?? 0) === 0) return;

      const offset = monthIdx(d) - targetMonth;

      if (offset >= -MONTH_TOLERANCE && offset <= MONTH_TOLERANCE && diff < windowDiff) {
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

    const offsetsToCheck: number[] = [0];
    for (let i = 1; i <= MONTH_TOLERANCE; i++) {
      offsetsToCheck.push(i, -i);
    }

    for (const offset of offsetsToCheck) {
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
   *
   * An empty result means "not a valid range for this anime".
   */
  private resolveEpisodeRange(anime: IMetaAnime, allEpisodes: ICinemetaEpisode[], mediaType: string): ICinemetaEpisode[] {
    const startDate = this.normalizeDate(anime.releaseDate);
    const rawEnd = this.normalizeDate(anime.endDate);
    const episodeCount = anime.episodes;

    // endDate === startDate means a batch drop, not a usable end boundary
    const endDate = rawEnd && startDate && rawEnd.getTime() === startDate.getTime() ? null : rawEnd;

    const pool = this.selectCandidateEpisodes(allEpisodes, anime.format?.toLowerCase() ?? null, mediaType);

    const sorted = [...pool].sort(
      (a, b) =>
        (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) ||
        (a.seasonEpisodeNumber ?? a.episodeNumber ?? 0) - (b.seasonEpisodeNumber ?? b.episodeNumber ?? 0) ||
        (this.normalizeDate(a.airDate)?.getTime() ?? 0) - (this.normalizeDate(b.airDate)?.getTime() ?? 0),
    );

    if (!startDate) {
      return mediaType === 'movie' ? sorted.slice(0, 1) : sorted;
    }

    const anchorIdx = this.findAnchorIndex(sorted, startDate, mediaType);
    if (anchorIdx === null) return [];

    const fromStart = sorted.slice(anchorIdx);

    if (mediaType === 'movie') {
      return fromStart.slice(0, 1);
    }

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

  private extractTitle(media: IMetaAnime | IRelatedAnimeData): string | undefined {
    const raw = media.title.english || media.title.romaji || undefined;

    return raw ? this.cleanTitle(raw) : undefined;
  }

  /**
   * Titles to search with, in order: the preferred title (english, then
   * romaji, then native), then romaji. Synonyms are never searched; they are
   * only used for scoring. Deduped, and capped because each query costs two
   * requests per media type on a cache miss.
   */
  private extractSearchQueries(media: IMetaAnime | IRelatedAnimeData, maxQueries = 5): string[] {
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
   * Ranks search candidates by title similarity across all query variants
   * and returns the top `limit`, best first.
   */
  private findBestMatch(
    candidates: ICineMetaSearch[],
    animeData: IMetaAnime | IRelatedAnimeData,
    type: MediaType,
    blacklist: ReadonlySet<string> = new Set(),
    limit = 3,
  ): ICineMetaSearch[] {
    const queries = this.extractSearchQueries(animeData);
    if (!candidates || candidates.length === 0 || queries.length === 0) {
      return [];
    }

    const scored: { candidate: ICineMetaSearch; score: number }[] = [];

    for (const candidate of candidates) {
      if (candidate.type !== type || !candidate.imdbId || blacklist.has(Cinemeta.blacklistKey(type, candidate.imdbId))) {
        continue;
      }

      const normCandidate = (candidate.name ?? '').toLowerCase().trim();
      let maxScore = 0;

      // Evaluate title similarity against all target query variants
      for (const target of queries) {
        const normTarget = target.toLowerCase().trim();

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

      scored.push({ candidate, score: maxScore });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ candidate }) => candidate);
  }

  /**
   * Searches AIOMetadata for one media type with every query variant and
   * returns the top-ranked, non-blacklisted candidates.
   */
  private async search(
    animeData: IMetaAnime | IRelatedAnimeData,
    type: MediaType,
    blacklist: ReadonlySet<string>,
  ): Promise<IResponse<ICineMetaSearch[]>> {
    try {
      const allResults: ICineMetaSearch[] = [];
      const seenIds = new Set<string>();

      for (const title of this.extractSearchQueries(animeData)) {
        const response = await this.aioMetadata.search(title, type);

        if (response && Array.isArray(response.data)) {
          for (const item of response.data) {
            if (item && item.id && !seenIds.has(item.id)) {
              seenIds.add(item.id);
              allResults.push(item);
            }
          }
        }
      }

      return { data: this.findBestMatch(allResults, animeData, type, blacklist) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error', data: [], status: 500 };
    }
  }

  /**
   * Same as `search`, but using the franchise root's titles instead of the
   * anime's own (e.g. when a season subtitle isn't what Cinemeta lists).
   */
  private async fetchFranchise(
    anilistId: number,
    type: MediaType,
    blacklist: ReadonlySet<string>,
  ): Promise<IResponse<ICineMetaSearch[]>> {
    try {
      const franchiseResponse = await this.resolver.resolveFranchiseMedia(anilistId);
      const franchiseAnime = franchiseResponse.data?.[0];

      if (franchiseResponse.error || !franchiseAnime) {
        return { data: [], error: franchiseResponse.error || 'Franchise media not found' };
      }

      return await this.search(franchiseAnime, type, blacklist);
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 500,
      };
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

      const blacklist = new Set<string>();

      const tryEpisodes = async (imdbId: string, type: string): Promise<ICinemetaEpisode[]> => {
        const key = Cinemeta.blacklistKey(type, imdbId);
        if (blacklist.has(key)) return [];

        const raw = (await this.aioMetadata.fetchEpisodes(imdbId, type)).data ?? [];
        const range = raw.length > 0 ? this.resolveEpisodeRange(animeData, raw, type) : [];

        if (range.length === 0) blacklist.add(key);

        return range;
      };

      let source: IEpisodeSource | null = null;

      const existing = await getByAnilistId(anilistId);

      if (existing?.imdb_id && existing.media_type) {
        const episodes = await tryEpisodes(existing.imdb_id, existing.media_type);

        if (episodes.length > 0) {
          source = {
            imdbId: existing.imdb_id,
            type: existing.media_type,
            kitsuId: null,
            episodes,
          };
        }
      }

      // 2. Kitsu -> Stremio imdb mapping. The mapping carries no type, so try both.
      if (!source) {
        const kitsuIdResult = await this.resolver.resolveAnilistKitsuMapping(anilistId);
        if (!kitsuIdResult.error && kitsuIdResult.data) {
          const kitsuId = kitsuIdResult.data;
          const stremioMapping = await this.resolver.fetchStremioImdbMappings(kitsuId, 'kitsuId');

          if (!stremioMapping.error && stremioMapping.data?.imdbId) {
            const imdbId = stremioMapping.data.imdbId;

            for (const type of Cinemeta.SEARCH_ORDER) {
              const episodes = await tryEpisodes(imdbId, type);

              if (episodes.length > 0) {
                source = { imdbId, type, kitsuId, episodes };
                break;
              }
            }
          }
        }
      }

      // 3. AIOMetadata provider-id mapping
      if (!source) {
        const mapping = await this.aioMetadata.fetchMappingsByProviderId(`anilist:${anilistId}`);
        const mapped = mapping.error ? null : mapping.data;

        if (mapped?.imdbId && mapped.type) {
          const episodes = await tryEpisodes(mapped.imdbId, mapped.type);

          if (episodes.length > 0) {
            source = {
              imdbId: mapped.imdbId,
              type: mapped.type,
              kitsuId: mapped.kitsuId ? Number(mapped.kitsuId) : null,
              episodes,
            };
          }
        }
      }

      // 4. Fallback search via title and franchise matching
      if (!source) {
        const finders = [
          (type: MediaType) => this.search(animeData, type, blacklist),
          (type: MediaType) => this.fetchFranchise(anilistId, type, blacklist),
        ];

        found: for (const find of finders) {
          for (const type of Cinemeta.SEARCH_ORDER) {
            for (const candidate of (await find(type)).data ?? []) {
              if (!candidate.imdbId) continue;

              const episodes = await tryEpisodes(candidate.imdbId, type);

              if (episodes.length > 0) {
                source = { imdbId: candidate.imdbId, type, kitsuId: null, episodes };
                break found;
              }
            }
          }
        }
      }

      if (!source) {
        return { data: [], error: 'No valid episode range found for this media', status: 404 };
      }

      const finalizedResponse = await this.finalizeEpisodes(anilistId, animeData, source.episodes);
      const finalizedEpisodes = finalizedResponse.data ?? [];

      if (finalizedEpisodes.length === 0) {
        return { data: [], error: 'No episodes found for this media', status: 404 };
      }

      let kitsuId = source.kitsuId;
      if (kitsuId == null) {
        const mapping = await this.aioMetadata.fetchMappingsByProviderId(`anilist:${anilistId}`);
        const mapped = mapping.error ? null : mapping.data;
        if (mapped?.kitsuId) {
          kitsuId = Number(mapped.kitsuId);
        } else {
          const resolvedKitsu = await this.resolver.resolveAnilistKitsuMapping(anilistId);
          if (!resolvedKitsu.error && resolvedKitsu.data) {
            kitsuId = resolvedKitsu.data;
          }
        }
      }

      const episodesWithIds: ICinemetaEpisode[] = finalizedEpisodes.map((ep, index) => ({
        ...ep,
        episodeNumber: index + 1,
        kitsuId,
      }));

      const mappingChanged = !existing || existing.imdb_id !== source.imdbId || existing.media_type !== source.type;

      if (mappingChanged) {
        try {
          await upsertMapping(anilistId, source.type, { imdbId: source.imdbId });
        } catch (error) {
          console.error(`upsertMapping failed for anilist:${anilistId}`, error);
        }
      }

      return { data: episodesWithIds };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : String(error),
        status: 500,
      };
    }
  }
}

export { Cinemeta };
