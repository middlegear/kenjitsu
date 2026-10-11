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
  /** Every AniList title for this entry, cleaned and deduped. */
  private extractAllTitles(media: IMetaAnime): string[] {
    const raw = [media.title.english, media.title.romaji, ...(media.synonyms ?? []), media.title.native];

    const seen = new Set<string>();
    const titles: string[] = [];

    for (const title of raw) {
      if (!title) continue;

      const cleaned = this.cleanTitle(title); // might be detrimental test before
      const key = cleaned.toLowerCase();

      if (!cleaned || seen.has(key)) continue;

      seen.add(key);
      titles.push(cleaned);
    }

    return titles;
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

      const animeTitle = this.extractTitle(animeData);

      if (!animeTitle) {
        return {
          data: null,
          error: 'Could not resolve anime title',
          status: 400,
        };
      }

      const mediaSearch = await this.search(animeTitle);

      if (!mediaSearch.error && mediaSearch.data?.length > 0) {
        const match = this.findBestMatch(animeData, this.extractAllTitles(animeData), mediaSearch.data, 0.6);

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

      if (format === 'movie') {
        return {
          data: episodeList.data.map((ep, index) => ({
            ...ep,
            episodeNumber: index + 1,
            kitsuId: kitsuIdNumber,
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
          kitsuId: kitsuIdNumber,
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
