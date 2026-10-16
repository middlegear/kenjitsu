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

  /** A candidate must list one of these genres to be accepted as an anime match. */
  private static readonly ANIME_GENRE_PATTERN = /\b(anime|animation)\b/i;

  private static readonly UNRELEASED_STATUSES = new Set(['unreleased', 'not_yet_released', 'upcoming', 'tba']);

  /** Max candidates we'll pay a metadata request for per query. */
  private static readonly MAX_GENRE_CHECKS = 5;

  // One shared instance so search, genre checks and episode fetches share its cache
  private readonly aioMetadata = new AIOMetadata();

  private scheduleMemory: { at: number; data: ScheduleMap } | null = null;
  private schedulePending: Promise<ScheduleMap> | null = null;
  private scheduleRetryAt = 0;

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
      // "(TV)", "(OVA)", "(Movie)" etc. at the end
      .replace(/\s*\((?:TV|OVA|ONA|Movie|Special)\)\s*$/i, '')
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
    const raw = media.title.english || media.title.romaji || media.title.native || undefined;

    return raw ? this.cleanTitle(raw) : undefined;
  }

  /**
   * Titles to search with, in order: the preferred title (english, then
   * romaji, then native), then romaji. Synonyms are never searched; they are
   * only used for scoring. Deduped, and capped because each query costs two
   * requests (movie + series catalogs) on a cache miss.
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

  /** Search queries from a franchise root entry: english, romaji, then latin-only synonyms. */
  private extractRootQueries(root: IRelatedAnimeData, maxQueries = 5): string[] {
    const candidates = [
      root.title?.english,
      root.title?.romaji,
      ...(root.synonyms ?? []).filter((s: string) => /^[\x00-\x7F]*$/.test(s)),
    ];

    const seen = new Set<string>();
    const queries: string[] = [];

    for (const candidate of candidates) {
      if (!candidate) continue;

      const cleaned = this.cleanTitle(candidate);
      const key = cleaned.toLowerCase();

      if (!cleaned || seen.has(key)) continue;

      seen.add(key);
      queries.push(cleaned);

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

  /**
   * True only when the candidate's own metadata lists an Animation/Anime genre.
   * Search results already carry genres, so those are used first; a metadata
   * request is only made when they are missing. Fails closed: if genres can't
   * be determined, the candidate is not trusted.
   */
  private async hasAnimeGenre(candidate: ICineMetaSearch): Promise<boolean> {
    if (candidate.genres?.length) {
      return candidate.genres.some((genre: string) => Cinemeta.ANIME_GENRE_PATTERN.test(genre));
    }

    const id = candidate.imdbId;
    const type = candidate.type;

    if (!id || !type) return false;

    const result = await this.aioMetadata.fetchGenres(id, type);

    if (result.error || !result.data) return false;

    return result.data.some(genre => Cinemeta.ANIME_GENRE_PATTERN.test(genre));
  }

  /**
   * Scores every candidate that survives the knockout and returns them best
   * first, capped at MAX_GENRE_CHECKS so no more than that are ever genre-checked.
   */
  private rankCandidates(
    anime: IMetaAnime,
    titles: string[],
    candidates: ICineMetaSearch[],
    minThreshold: number = 0.7,
  ): ICineMetaSearch[] {
    const scored: { candidate: ICineMetaSearch; score: number }[] = [];

    for (const candidate of candidates) {
      if (this.isKnockedOut(candidate, anime)) continue;

      const score = Math.max(...titles.map(title => this.calculateTitleSimilarity(title, candidate.name ?? '')));

      if (score < minThreshold) continue;

      scored.push({ candidate, score });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, Cinemeta.MAX_GENRE_CHECKS).map(entry => entry.candidate);
  }

  /**
   * Lazily yields genre-verified matches, best first, for the given queries.
   * Each query's candidates are ranked and genre-checked in order, and ids
   * already in `triedIds` are skipped. Nothing further is searched or checked
   * until the caller asks for the next match.
   * `state.sawResults` records whether any query returned candidates.
   */
  private async *matchesFromQueries(
    anime: IMetaAnime,
    titles: string[],
    queries: string[],
    triedQueries: Set<string>,
    triedIds: Set<string>,
    state: { sawResults: boolean },
  ): AsyncGenerator<ICineMetaSearch> {
    for (const query of queries) {
      const key = query.toLowerCase().trim();
      if (triedQueries.has(key)) continue;
      triedQueries.add(key);

      const mediaSearch = await this.aioMetadata.search(query);

      if (mediaSearch.error || !mediaSearch.data?.length) continue;

      state.sawResults = true;

      for (const candidate of this.rankCandidates(anime, titles, mediaSearch.data, 0.6)) {
        const id = candidate.imdbId;

        if (!id || triedIds.has(id)) continue;
        if (!(await this.hasAnimeGenre(candidate))) continue;

        triedIds.add(id);
        yield candidate;
      }
    }
  }

  /**
   * Yields genre-verified matches in best-first order: first from the entry's
   * own titles, then, only if no query returned any results at all, from the
   * franchise root title (synonyms allowed).
   */
  private async *iterateMatches(
    anilistId: number,
    anime: IMetaAnime,
    triedIds: Set<string>,
  ): AsyncGenerator<ICineMetaSearch> {
    const queries = this.extractSearchQueries(anime);
    if (queries.length === 0) return;

    const titles = this.extractAllTitles(anime);
    const triedQueries = new Set<string>();
    const state = { sawResults: false };

    yield* this.matchesFromQueries(anime, titles, queries, triedQueries, triedIds, state);

    if (state.sawResults) return;

    const franchise = await this.resolver.resolveFranchiseMedia(anilistId);
    const root = franchise.data?.find(entry => entry.relationType === 'ROOT') ?? franchise.data?.[0];

    // Skip if the root is this very entry; its titles were already searched
    if (!root || String(root.id) === String(anilistId)) return;

    const rootQueries = this.extractRootQueries(root);

    // Score against both the entry's titles and the root's titles
    const rootTitles = rootQueries.filter(q => !titles.some(t => t.toLowerCase() === q.toLowerCase()));

    yield* this.matchesFromQueries(anime, [...titles, ...rootTitles], rootQueries, triedQueries, triedIds, state);
  }

  /** Max media matches tried per anime before giving up on episode range resolution. */
  private static readonly MAX_MATCH_ATTEMPTS = 3;

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

      let kitsuIdNumber: number | null | undefined;

      const getKitsuId = async (): Promise<number | null> => {
        if (kitsuIdNumber !== undefined) return kitsuIdNumber;

        const kitsuId = await this.aioMetadata.fetchAnimeMappings(anilistId);
        if (kitsuId.error || !kitsuId.data) {
          console.error(kitsuId.error);
        }

        kitsuIdNumber = kitsuId.data?.kitsuId ? Number(kitsuId.data.kitsuId) : null;
        return kitsuIdNumber;
      };

      /**
       * Tries one media match. `retry` is true only when the match produced
       * no usable episode range, i.e. it is probably the wrong version of
       * the franchise (e.g. the 1993 vs the 2012 JoJo) and the next-best
       * match is worth trying.
       */
      const attempt = async (
        mediaId: string,
        format: string,
      ): Promise<{ response: IResponse<ICinemetaEpisode[] | []>; retry: boolean }> => {
        const episodeList = await this.aioMetadata.fetchEpisodes(mediaId, format);

        if (episodeList.error || !episodeList.data || episodeList.data.length === 0) {
          return {
            response: { data: [], error: episodeList.error, status: episodeList.status },
            retry: false,
          };
        }

        const kitsu = await getKitsuId();

        const withIds = (episodes: ICinemetaEpisode[]) =>
          episodes.map((ep, index) => ({
            ...ep,
            episodeNumber: index + 1,
            kitsuId: kitsu,
          }));

        if (format === 'movie') {
          return { response: { data: withIds(episodeList.data as ICinemetaEpisode[]) }, retry: false };
        }

        const startDate = this.normalizeDate(animeData.releaseDate);

        const narrowedEpisodes = this.resolveEpisodeRange(animeData, episodeList.data as ICinemetaEpisode[]);

        if (narrowedEpisodes.length === 0) {
          return {
            response: {
              data: [],
              error: !this.isRecentStartDate(startDate)
                ? 'No matching episodes found for this entry using the available date tolerance'
                : 'No matching episodes found for this entry',
              status: 404,
            },
            retry: true,
          };
        }

        const finalized = await this.finalizeEpisodes(anilistId, animeData, narrowedEpisodes);

        if (finalized.error || !finalized.data) {
          return { response: finalized, retry: false };
        }

        return { response: { data: withIds(finalized.data) }, retry: false };
      };

      const triedIds = new Set<string>();
      let attempts = 0;
      let last: IResponse<ICinemetaEpisode[] | []> = { data: [], error: 'No match found', status: 404 };

      // Attempt 1: the stored mapping, if any
      const existing = await getByAnilistId(anilistId);
      if (existing?.imdb_id && existing.media_type) {
        triedIds.add(existing.imdb_id);
        attempts++;

        const result = await attempt(existing.imdb_id, existing.media_type);
        if (!result.retry) return result.response;

        last = result.response;
      }

      // Remaining attempts: best, second best, third best search match
      const matches = this.iterateMatches(anilistId, animeData, triedIds);
      let confirmed: { mediaId: string; format: string; response: IResponse<ICinemetaEpisode[] | []> } | null = null;

      while (attempts < Cinemeta.MAX_MATCH_ATTEMPTS) {
        const next = await matches.next();
        if (next.done) break;

        const mediaId = next.value.imdbId;
        const format = next.value.type;

        if (!mediaId || !format) continue;

        attempts++;

        const result = await attempt(mediaId, format);

        if (result.retry) {
          last = result.response;
          continue;
        }

        // Non-retryable error (e.g. metadata fetch failed): nothing is saved
        if (result.response.error || result.response.data.length === 0) return result.response;

        confirmed = { mediaId, format, response: result.response };
        break;
      }

      if (!confirmed) return last;

      try {
        await upsertMapping(anilistId, confirmed.format, { imdbId: confirmed.mediaId });
      } catch (err) {
        console.error('Failed to save anime entry:', err);
      }

      return confirmed.response;
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
