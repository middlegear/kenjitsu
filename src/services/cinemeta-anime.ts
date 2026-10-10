import type { ClientOptions } from '../config/client.js';
import { redisGetCache, redisSetCache } from '../config/redis.js';
import { BaseClass } from '../providers/models/base.js';
import type { IResponse } from '../types/base.js';
import type { ICinemetaEpisode, ICineMetaSearch } from '../types/cinemeta.js';
import type { IMetaAnime } from '../types/meta/meta-anime.js';
import { AIOMetadata } from './aiometadata.js';
import type { AnimeInfoResolver } from './anime-resolver.js';

type CinemetaMediaType = 'movie' | 'series';

class Cinemeta extends BaseClass {
  constructor(
    private readonly resolver: AnimeInfoResolver,
    options: ClientOptions = { browser: 'okhttp4' },
  ) {
    super(options);
  }
  private static readonly MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  private readonly baseUrl = 'https://v3-cinemeta.strem.io';
  private readonly mediaTypes: CinemetaMediaType[] = ['movie', 'series'];

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
   * Finds the pool episode whose airDate is numerically closest to
   * `target`, along with how far off it actually is.
   *
   * Returns null if no episode in the pool has a usable airDate.
   */
  private findClosestDateMatch(pool: ICinemetaEpisode[], target: Date): { index: number; diffDays: number } | null {
    let bestIdx = -1;
    let bestDiffMs = Infinity;

    pool.forEach((ep, idx) => {
      const epDate = this.normalizeDate(ep.airDate);

      if (!epDate) return;

      const diff = Math.abs(epDate.getTime() - target.getTime());

      if (diff < bestDiffMs) {
        bestDiffMs = diff;
        bestIdx = idx;
      }
    });

    if (bestIdx === -1) return null;

    return {
      index: bestIdx,
      diffDays: bestDiffMs / (1000 * 60 * 60 * 24),
    };
  }
  /**
   * FIX: month-precision fallback anchor.
   *
   * Cinemeta/IMDb often only knows "September 2026" for a not-yet-dated
   * episode and stores it as the 1st of the month (e.g. 2026-09-01), while
   * AniList/Kitsu know the exact day (2026-09-25). Day-for-day comparison
   * then fails the tolerance check even though the episode is the right one.
   *
   * An episode dated on the 1st of the SAME calendar month as the target
   * start date is treated as a month-precision match. Only used after the
   * normal tolerance-based anchor has failed, and it takes the earliest such
   * episode in the (sorted) pool.
   */
  private findMonthPrecisionMatch(pool: ICinemetaEpisode[], target: Date): number | null {
    for (let i = 0; i < pool.length; i++) {
      const d = this.normalizeDate(pool[i].airDate);
      if (!d) continue;

      if (
        d.getUTCDate() === 1 &&
        d.getUTCFullYear() === target.getUTCFullYear() &&
        d.getUTCMonth() === target.getUTCMonth()
      ) {
        return i;
      }
    }

    return null;
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

    const now = new Date();
    const diffMs = now.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    return diffDays <= this.DATE_ANCHOR_TOLERANCE_DAYS;
  }
  /**
   * Maximum acceptable distance, in days, between an anime's releaseDate
   * and the nearest episode airDate for that airDate to be trusted as
   * the anchor.
   */
  private readonly DATE_ANCHOR_TOLERANCE_DAYS = 7;

  private resolveEpisodeRange(anime: IMetaAnime, allEpisodes: ICinemetaEpisode[]): ICinemetaEpisode[] {
    const startDate = this.normalizeDate(anime.releaseDate);
    const endDate = this.normalizeDate(anime.endDate);
    const episodeCount = anime.episodes;

    const animeFormat = anime.format?.toLowerCase() ?? null;
    const pool = this.selectCandidateEpisodes(allEpisodes, animeFormat);

    const sorted = [...pool].sort((a, b) => {
      const seasonDiff = (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0);

      if (seasonDiff !== 0) return seasonDiff;

      const epDiff = (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);

      if (epDiff !== 0) return epDiff;

      const da = this.normalizeDate(a.airDate)?.getTime() ?? 0;
      const db = this.normalizeDate(b.airDate)?.getTime() ?? 0;

      return da - db;
    });

    if (!startDate) {
      return sorted;
    }

    const closest = this.findClosestDateMatch(sorted, startDate);

    let anchorIdx: number;

    if (closest && closest.diffDays <= this.DATE_ANCHOR_TOLERANCE_DAYS) {
      anchorIdx = closest.index;
    } else {
      const monthMatch = this.findMonthPrecisionMatch(sorted, startDate);

      if (monthMatch === null) {
        return [];
      }

      anchorIdx = monthMatch;
    }

    if (typeof episodeCount === 'number' && episodeCount > 0) {
      return sorted.slice(anchorIdx, anchorIdx + episodeCount);
    }

    if (endDate) {
      return sorted.filter(ep => {
        const epDate = this.normalizeDate(ep.airDate);

        if (!epDate) return false;

        return epDate.getTime() >= startDate.getTime() && epDate.getTime() <= endDate.getTime();
      });
    }

    return sorted.slice(anchorIdx);
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

  private levenshtein(a: string, b: string): number {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const matrix: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

    for (let i = 0; i < rows; i++) matrix[i][0] = i;
    for (let j = 0; j < cols; j++) matrix[0][j] = j;

    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
      }
    }

    return matrix[rows - 1][cols - 1];
  }

  private extractTitle(media: IMetaAnime): string | undefined {
    const englishSynonym = !media.title.english
      ? media.synonyms?.find(synonym => /^[\x00-\x7F]*$/.test(synonym))
      : undefined;

    return media.title.english || englishSynonym || media.title.romaji || media.title.native || undefined;
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

  private extractYear(releaseDate: string | null | number | undefined): number | null {
    if (releaseDate === null || releaseDate === undefined) return null;

    if (typeof releaseDate === 'number') {
      return releaseDate > 1000 && releaseDate < 3000 ? releaseDate : null;
    }

    const parsed = this.normalizeDate(releaseDate);
    if (parsed) return parsed.getUTCFullYear();

    const bare = releaseDate.trim().match(/^(\d{4})$/);
    return bare ? Number(bare[1]) : null;
  }

  private calculateTitleSimilarity(target: string, candidate: string): number {
    const normTarget = target.toLowerCase().trim();
    const normCandidate = candidate.toLowerCase().trim();

    if (!normTarget || !normCandidate) return 0;
    if (normTarget === normCandidate) return 1.0;

    const distance = this.levenshtein(normTarget, normCandidate);
    const maxLen = Math.max(normTarget.length, normCandidate.length, 1);
    const levSimilarity = 1 - distance / maxLen;

    const isSubstring = normTarget.includes(normCandidate) || normCandidate.includes(normTarget);

    const targetTokens = new Set(normTarget.split(/[\s:,\-_]+/).filter(Boolean));
    const candidateTokens = new Set(normCandidate.split(/[\s:,\-_]+/).filter(Boolean));

    let overlap = 0;

    for (const token of targetTokens) {
      if (candidateTokens.has(token)) overlap++;
    }

    const minTokenCount = Math.min(targetTokens.size, candidateTokens.size);
    const tokenSimilarity = minTokenCount > 0 ? overlap / minTokenCount : 0;

    let score = Math.max(levSimilarity, tokenSimilarity);

    if (isSubstring && score < 0.75) {
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
        // Standard  is ~20-25 min, movies are longer than 30.
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
    title: string,
    year: number | null,
    candidates: ICineMetaSearch[],
    minThreshold: number = 0.7,
  ): ICineMetaSearch | null {
    if (candidates.length === 0) return null;

    let best: ICineMetaSearch | null = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      if (this.isKnockedOut(candidate, anime)) continue;

      const similarity = this.calculateTitleSimilarity(title, candidate.name ?? '');

      if (similarity < minThreshold) continue;

      const parsedStartYear = candidate.startYear ? Number.parseInt(String(candidate.startYear), 10) : NaN;
      const candidateYear = Number.isNaN(parsedStartYear) ? null : parsedStartYear;
      const yearMatch = year !== null && candidateYear !== null && candidateYear === Number(year);
      const score = similarity + (yearMatch ? 0.3 : 0);

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

    const results = await Promise.all(this.mediaTypes.map(mediaType => this.fetchCatalog(query, mediaType)));
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
      /* ---------------------------------------------------------------------- */
      /* STEP 1: Resolve queried anime                                          */
      /* ---------------------------------------------------------------------- */
      const animeData = preResolvedAnimeData ?? (await this.resolver.resolveAnimeInfo(anilistId)).data;

      if (!animeData) {
        return {
          data: null,
          error: 'Could not resolve anime information',
          status: 404,
        };
      }

      const animeTitle = this.extractTitle(animeData);
      const releaseDate = 'year' in animeData && animeData.year ? animeData.year : animeData.releaseDate;

      const animeYear = this.extractYear(releaseDate);

      if (!animeTitle) {
        return {
          data: null,
          error: 'Could not resolve anime title',
          status: 400,
        };
      }

      const mediaSearch = await this.search(animeTitle);

      if (!mediaSearch.error && mediaSearch.data?.length > 0) {
        const match = this.findBestMatch(animeData, animeTitle, animeYear, mediaSearch.data, 0.6);

        if (match) {
          return {
            data: match,
          };
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

      if (format === 'movie') {
        return {
          data: episodeList.data.map((ep, index) => ({
            ...ep,
            episodeNumber: index + 1,
            kitsuId: kitsuId.data?.kitsuId ? Number(kitsuId.data?.kitsuId) : null,
          })),
        };
      }

      if (episodeList.data.length === 1) {
        return {
          data: episodeList.data as ICinemetaEpisode[],
        };
      }

      const startDate = this.normalizeDate(animeData.releaseDate);

      const narrowedEpisodes = this.resolveEpisodeRange(animeData, episodeList.data as ICinemetaEpisode[]).map(
        (ep, index) => ({
          ...ep,
          episodeNumber: index + 1,
          kitsuId: kitsuId.data?.kitsuId ? Number(kitsuId.data?.kitsuId) : null,
        }),
      );

      if (narrowedEpisodes.length === 0) {
        return {
          data: [],
          error: !this.isRecentStartDate(startDate)
            ? 'No matching episodes found for this entry using the available date tolerance'
            : 'No matching episodes found for this entry',
          status: 404,
        };
      }

      return {
        data: narrowedEpisodes,
      };
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
