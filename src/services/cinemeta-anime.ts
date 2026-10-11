import { token_sort_ratio } from 'fuzzball';
import type { ClientOptions } from '../config/client.js';
import { redisGetCache, redisSetCache } from '../config/redis.js';
import { BaseClass } from '../providers/models/base.js';
import type { IResponse } from '../types/base.js';
import type { ICinemetaEpisode, ICineMetaSearch } from '../types/cinemeta.js';
import type { IMetaAnime } from '../types/meta/meta-anime.js';
import { AIOMetadata } from './aiometadata.js';
import type { AnimeInfoResolver } from './anime-resolver.js';

type CinemetaMediaType = 'movie' | 'series';

interface IScheduleNode {
  episode: number;
  airingAt: number;
}

/** AniList id -> upcoming episodes. Plain object so it survives JSON in Redis. */
type ScheduleMap = Record<string, IScheduleNode[]>;

class Cinemeta extends BaseClass {
  constructor(
    private readonly resolver: AnimeInfoResolver,
    options: ClientOptions = { browser: 'okhttp4' },
  ) {
    super(options);
  }

  private static readonly MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  private static readonly SCHEDULE_URL =
    'https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/sub-schedule.json';
  private static readonly SCHEDULE_CACHE_KEY = 'anischedule-sub-schedule';
  private static readonly SCHEDULE_TTL_HOURS = 1;
  private static readonly SCHEDULE_TTL_MS = Cinemeta.SCHEDULE_TTL_HOURS * 60 * 60 * 1000;
  private static readonly SCHEDULE_BACKOFF_MS = 5 * 60 * 1000;

  private readonly baseUrl = 'https://v3-cinemeta.strem.io';
  private readonly mediaTypes: CinemetaMediaType[] = ['movie', 'series'];

  // In-process layer on top of Redis (also the only cache when Redis is disabled)
  private scheduleMemory: { at: number; data: ScheduleMap } | null = null;
  private schedulePending: Promise<ScheduleMap> | null = null;
  private scheduleRetryAt = 0;

  /**
   * Maximum acceptable distance, in days, between an anime's releaseDate
   * and the nearest episode airDate for that airDate to be trusted as
   * the anchor.
   */
  private readonly DATE_ANCHOR_TOLERANCE_DAYS = 7;

  // Interleaves result lists (movie, series, movie, series...) and dedupes by id
  private mergeResults(lists: ICineMetaSearch[][]): ICineMetaSearch[] {
    const merged: ICineMetaSearch[] = [];
    const seen = new Set<string>();
    const maxLen = Math.max(...lists.map(list => list.length));

    for (let i = 0; i < maxLen; i++) {
      for (const list of lists) {
        const item = list[i];
        if (item?.id && !seen.has(item.id)) {
          seen.add(item.id);
          merged.push(item);
        }
      }
    }

    return merged;
  }

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

  /**
   * Loads the AniSchedule "sub" schedule, reduced to { anilistId: nodes }.
   */
  private async loadSchedule(): Promise<ScheduleMap> {
    const memory = this.scheduleMemory;

    if (memory && Date.now() - memory.at < Cinemeta.SCHEDULE_TTL_MS) return memory.data;
    if (this.schedulePending) return this.schedulePending;

    this.schedulePending = (async (): Promise<ScheduleMap> => {
      try {
        const cached = await redisGetCache<ScheduleMap>(Cinemeta.SCHEDULE_CACHE_KEY);

        if (cached) {
          this.scheduleMemory = { at: Date.now(), data: cached };
          return cached;
        }

        // Recently failed: don't hit GitHub again yet
        if (Date.now() < this.scheduleRetryAt) return this.scheduleMemory?.data ?? {};

        const response = await this.client.fetch(Cinemeta.SCHEDULE_URL, { method: 'GET' });

        if (!response.ok) {
          this.scheduleRetryAt = Date.now() + Cinemeta.SCHEDULE_BACKOFF_MS;
          return this.scheduleMemory?.data ?? {};
        }

        const json = (await response.json()) as any[];
        const slim: ScheduleMap = {};

        for (const entry of json) {
          const nodes = entry?.airingSchedule?.nodes;

          if (entry?.id && Array.isArray(nodes) && nodes.length > 0) {
            slim[String(entry.id)] = nodes.map((node: any) => ({
              episode: node.episode,
              airingAt: node.airingAt,
            }));
          }
        }

        this.scheduleMemory = { at: Date.now(), data: slim };
        await redisSetCache(Cinemeta.SCHEDULE_CACHE_KEY, slim, Cinemeta.SCHEDULE_TTL_HOURS);

        return slim;
      } catch (error) {
        console.error('Failed to load airing schedule:', error instanceof Error ? error.message : error);
        this.scheduleRetryAt = Date.now() + Cinemeta.SCHEDULE_BACKOFF_MS;
        return this.scheduleMemory?.data ?? {};
      } finally {
        this.schedulePending = null;
      }
    })();

    return this.schedulePending;
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

    const nodes = [...((await this.loadSchedule())[String(anilistId)] ?? [])].sort((a, b) => a.episode - b.episode);
    if (nodes.length === 0) return episodes;

    const nowSec = Math.floor(Date.now() / 1000);
    const total = typeof anime.episodes === 'number' && anime.episodes > 0 ? anime.episodes : Infinity;

    const next = nodes.find(node => node.airingAt > nowSec);
    const airedCount = Math.min(next ? next.episode - 1 : nodes[nodes.length - 1].episode, total);

    // Cut excess
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

    const INTERVAL_SEC = 604_800; // not what i expect

    const padded: ICinemetaEpisode[] = [];

    for (let ep = lastNumber + 1; ep <= targetCount; ep++) {
      const seasonEpisodeNumber = last.seasonEpisodeNumber != null ? last.seasonEpisodeNumber + (ep - lastNumber) : null;

      // Step the air date forward from the last known one
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
          // Truncate excess (shouldn't normally happen after resolveEpisodeRange)
          return { data: episodes.slice(0, expected) };
        }
        if (episodes.length < expected) {
          // Cinemeta missing data → pad using the last real episode as template
          return { data: this.padEpisodes(episodes, expected) };
        }
      }

      return { data: episodes };
    }

    return { data: await this.syncWithSchedule(anilistId, anime, episodes) };
  }

  private async fetchCatalog(query: string, mediaType: CinemetaMediaType): Promise<IResponse<ICineMetaSearch[]>> {
    try {
      const response = await this.client.fetch(`${this.baseUrl}/catalog/${mediaType}/top/search=${query}.json`, {
        method: 'GET',
      });

      if (!response.ok) {
        return { data: [], error: response.statusText, status: response.status };
      }

      const json = (await response.json()) as any;
      const data: ICineMetaSearch[] = (json.metas ?? []).map((item: any) => ({
        id: item.id,
        name: item.name,
        imdbId: item.imdb_id,
        posterImage: item.poster,
        coverImage: item.background,
        type: item.type,
        startYear: item.releaseInfo ? item.releaseInfo.split('-').at(0) : null,
        endYear: item.releaseInfo ? item.releaseInfo.split('-').at(-1) : null,
      }));

      return { data };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown Error',
        status: 500,
      };
    }
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
    const englishSynonym = !media.title.english
      ? media.synonyms?.find(synonym => /^[\x00-\x7F]*$/.test(synonym))
      : undefined;

    const raw = media.title.english || englishSynonym || media.title.romaji || media.title.native || undefined;

    return raw ? this.cleanTitle(raw) : undefined;
  }

  /**
   * Titles to search Cinemeta with, in order: the preferred title
   * (english, then english synonym, ...), then romaji, then latin-only
   * synonyms. Deduped, and capped because each query costs two requests
   * (movie + series catalogs) on a cache miss.
   */
  private extractSearchQueries(media: IMetaAnime, maxQueries = 5): string[] {
    const candidates = [
      this.extractTitle(media),
      media.title.romaji,
      ...(media.synonyms ?? []).filter(synonym => /^[\x00-\x7F]*$/.test(synonym)),
    ];

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

  /** Every AniList title for this entry, cleaned and deduped. */
  private extractAllTitles(media: IMetaAnime): string[] {
    const raw = [media.title.english, media.title.romaji, ...(media.synonyms ?? []), media.title.native];

    const seen = new Set<string>();
    const titles: string[] = [];

    for (const title of raw) {
      if (!title) continue;

      const cleaned = this.cleanTitle(title); // might be detrimental, test before
      const key = cleaned.toLowerCase();

      if (!cleaned || seen.has(key)) continue;

      seen.add(key);
      titles.push(cleaned);
    }

    return titles;
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

  private calculateTitleSimilarity(target: string, candidate: string): number {
    const normTarget = target.toLowerCase().trim();
    const normCandidate = candidate.toLowerCase().trim();

    if (!normTarget || !normCandidate) return 0;
    if (normTarget === normCandidate) return 1.0;

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

    return score;
  }

  /**
   * Hard disqualifiers based on AniList/Kitsu metadata. A candidate that is
   * knocked out is never scored, regardless of title similarity.
   *
   * Determines whether AniList/Kitsu says this entry is a movie or a series
   * (format, episode count, duration) and knocks out candidates of the
   * other type. Inconclusive metadata knocks out nothing.
   */
  private isKnockedOut(candidate: ICineMetaSearch, anime: IMetaAnime): boolean {
    const candidateType = candidate.type?.toLowerCase();

    // Unknown candidate type: don't knock out on missing data
    if (candidateType !== 'movie' && candidateType !== 'series') return false;

    const format = anime.format?.toUpperCase() ?? null;
    const episodes = typeof anime.episodes === 'number' ? anime.episodes : null;
    const duration = typeof anime.duration === 'number' && anime.duration > 0 ? anime.duration : null;

    let expected: CinemetaMediaType | null = null;

    if (format === 'MOVIE') {
      expected = 'movie';
    } else if (episodes !== null && episodes > 1) {
      expected = 'series';
    } else if (duration !== null) {
      if (duration > 30) {
        // Standard episode is ~20-25 min, movies are longer than 30.
        expected = episodes === null ? 'series' : 'movie';
      } else if (episodes !== 1) {
        expected = 'series';
      }
    }

    if (expected === null) return false;

    return candidateType !== expected;
  }

  private findBestMatch(
    anime: IMetaAnime,
    titles: string[],
    candidates: ICineMetaSearch[],
    minThreshold: number = 0.7,
  ): ICineMetaSearch | null {
    let best: ICineMetaSearch | null = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      if (this.isKnockedOut(candidate, anime)) continue;

      const score = Math.max(...titles.map(title => this.calculateTitleSimilarity(title, candidate.name ?? '')));

      if (score < minThreshold) continue;

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best;
  }

  private async search(query: string): Promise<IResponse<ICineMetaSearch[] | []>> {
    if (!query) {
      return {
        data: [],
        error: 'Missing required params: query string',
        status: 400,
      };
    }

    const cacheKey = `cinemeta-search-${query.toLowerCase().trim()}`;
    const cached = await redisGetCache<IResponse<ICineMetaSearch[] | []>>(cacheKey);
    if (cached) return cached;

    const results = await Promise.all(
      this.mediaTypes.map(mediaType => this.fetchCatalog(encodeURIComponent(query), mediaType)),
    );
    const failed = results.filter(r => r.error);

    // Both failed -> surface the error
    if (failed.length === results.length) {
      return {
        data: [],
        error: failed[0].error,
        status: failed[0].status ?? 500,
      };
    }

    const responseResult: IResponse<ICineMetaSearch[]> = {
      data: this.mergeResults(results.map(r => r.data)),
    };

    if (responseResult.data.length > 0 && failed.length === 0) {
      await redisSetCache(cacheKey, responseResult, 72);
    }

    return responseResult;
  }

  private async searchCineMetaMedia(
    anilistId: number,
    preResolvedAnimeData?: IMetaAnime,
  ): Promise<IResponse<ICineMetaSearch | null>> {
    try {
      const animeData = preResolvedAnimeData ?? (await this.resolver.resolveAnimeInfo(anilistId)).data;

      if (!animeData) {
        return {
          data: null,
          error: 'Could not resolve anime information',
          status: 404,
        };
      }

      const queries = this.extractSearchQueries(animeData);

      if (queries.length === 0) {
        return {
          data: null,
          error: 'Could not resolve anime title',
          status: 400,
        };
      }

      const titles = this.extractAllTitles(animeData);

      for (const query of queries) {
        const mediaSearch = await this.search(query);

        if (mediaSearch.error || !mediaSearch.data?.length) continue;

        const match = this.findBestMatch(animeData, titles, mediaSearch.data, 0.6);

        if (match) {
          return { data: match };
        }
      }

      return {
        data: null,
        error: 'No match found',
        status: 404,
      };
    } catch (error) {
      return {
        data: null,
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

      const response = await this.searchCineMetaMedia(anilistId, animeData);

      if (response.error || !response.data) {
        return {
          data: [],
          error: response.error,
          status: response.status ?? 404,
        };
      }

      const mediaId = response.data.imdbId || response.data.id;

      if (!mediaId) {
        return {
          data: [],
          error: 'No valid media ID found',
          status: 400,
        };
      }

      const format = response.data.type as string;
      const aioMetadata = new AIOMetadata();
      const episodeList = await aioMetadata.fetchEpisodes(mediaId, format);

      if (episodeList.error || !episodeList.data || episodeList.data.length === 0) {
        return {
          data: [],
          error: episodeList.error,
          status: episodeList.status,
        };
      }

      const kitsuId = await aioMetadata.fetchAnimeMappings(anilistId);
      if (kitsuId.error || !kitsuId.data) {
        console.error(kitsuId.error);
      }

      const kitsuIdNumber = kitsuId.data?.kitsuId ? Number(kitsuId.data.kitsuId) : null;

      // Numbers episodes 1..n and attaches the Kitsu id
      const withIds = (episodes: ICinemetaEpisode[]) =>
        episodes.map((ep, index) => ({
          ...ep,
          episodeNumber: index + 1,
          kitsuId: kitsuIdNumber,
        }));

      if (format === 'movie') {
        return { data: withIds(episodeList.data as ICinemetaEpisode[]) };
      }

      if (episodeList.data.length === 1) {
        return this.finalizeEpisodes(anilistId, animeData, withIds(episodeList.data as ICinemetaEpisode[]));
      }

      const startDate = this.normalizeDate(animeData.releaseDate);

      const narrowedEpisodes = withIds(this.resolveEpisodeRange(animeData, episodeList.data as ICinemetaEpisode[]));

      if (narrowedEpisodes.length === 0) {
        return {
          data: [],
          error: !this.isRecentStartDate(startDate)
            ? 'No matching episodes found for this entry using the available date tolerance'
            : 'No matching episodes found for this entry',
          status: 404,
        };
      }

      return this.finalizeEpisodes(anilistId, animeData, narrowedEpisodes);
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
