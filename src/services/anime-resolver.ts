import { token_sort_ratio } from 'fuzzball';
import { Anilist, Kitsu } from '../providers/main.js';
import { BaseClass } from '../providers/models/base.js';
import type { IResponse } from '../types/base.js';
import type { IMetaAnime, IRelatedAnimeData } from '../types/meta/meta-anime.js';

interface IFribbsList {
  anilistId: number | null;
  kitsuId: number | null;
  imdbId: string | null;
}

export interface IStremioImdbMapping {
  kitsuId: number;
  imdbId: string;
  title: string;
  seasonStart?: number;
  episodeStart?: number;
}

export class AnimeInfoResolver extends BaseClass {
  private readonly animeInfoCache = new Map<number, Promise<IResponse<IMetaAnime | null>>>();
  private readonly franchiseMediaCache = new Map<number, Promise<IResponse<IRelatedAnimeData[] | null>>>();

  private readonly anilist = new Anilist();
  private readonly kitsu = new Kitsu();

  private readonly RESULT_GRACE_MS = 5000;

  constructor() {
    super();
  }

  async resolveAnimeInfo(anilistId: number): Promise<IResponse<IMetaAnime | null>> {
    const cached = this.animeInfoCache.get(anilistId);
    if (cached) return cached;

    const promise = this.doResolveAnimeInfo(anilistId);
    this.animeInfoCache.set(anilistId, promise);

    promise.finally(() => {
      setTimeout(() => {
        if (this.animeInfoCache.get(anilistId) === promise) {
          this.animeInfoCache.delete(anilistId);
        }
      }, this.RESULT_GRACE_MS);
    });

    return promise;
  }

  async resolveFranchiseMedia(anilistId: number): Promise<IResponse<IRelatedAnimeData[] | null>> {
    const cached = this.franchiseMediaCache.get(anilistId);
    if (cached) return cached;

    const promise = this.doResolveFranchiseMedia(anilistId);
    this.franchiseMediaCache.set(anilistId, promise);

    promise.finally(() => {
      setTimeout(() => {
        if (this.franchiseMediaCache.get(anilistId) === promise) {
          this.franchiseMediaCache.delete(anilistId);
        }
      }, this.RESULT_GRACE_MS);
    });

    return promise;
  }

  async resolveAnilistKitsuMapping(anilistId: number): Promise<IResponse<number | null>> {
    try {
      // 1. Try standard Kitsu fetchMapping
      const kitsuMapping = await this.kitsu.fetchMapping(anilistId);
      if (!kitsuMapping.error && kitsuMapping.data?.id) {
        const parsedId = Number(kitsuMapping.data.id);
        if (!Number.isNaN(parsedId)) {
          return { data: parsedId, status: 200 };
        }
      }

      // 2. Fallback to Fribbs list mapping
      const fribbsMapping = await this.fetchFribbsMappings(anilistId);
      if (!fribbsMapping.error && fribbsMapping.data?.kitsuId) {
        return { data: fribbsMapping.data.kitsuId, status: 200 };
      }

      // 3. Fallback to searching Kitsu by title using fuzzball ratio matching
      const searchResult = await this.searchKitsuByAnilistId(anilistId);
      if (!searchResult.error && searchResult.data?.id) {
        const parsedId = Number(searchResult.data.id);
        if (!Number.isNaN(parsedId)) {
          return { data: parsedId, status: 200 };
        }
      }

      return { data: null, error: 'Could not resolve Kitsu ID from AniList ID', status: 404 };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
        status: 500,
      };
    }
  }

  /**
   * Fetches Stremio's Kitsu IMDb mapping data list and finds the matching entry.
   * Can accept either a `kitsuId` directly or an `anilistId` (which it will automatically resolve to a Kitsu ID first).
   * Returns normalized camelCase fields (`kitsuId`, `imdbId`, `title`, `fromSeason`, `fromEpisode`).
   */
  async fetchStremioImdbMappings(
    id: number,
    idType: 'kitsuId' | 'anilistId' = 'kitsuId',
  ): Promise<IResponse<IStremioImdbMapping | null>> {
    try {
      let targetKitsuId = id;

      if (idType === 'anilistId') {
        const resolvedMapping = await this.resolveAnilistKitsuMapping(id);
        if (resolvedMapping.error || !resolvedMapping.data) {
          return {
            data: null,
            error: resolvedMapping.error ?? 'Failed to resolve AniList ID to Kitsu ID',
            status: resolvedMapping.status ?? 404,
          };
        }
        targetKitsuId = resolvedMapping.data;
      }

      const response = await this.client.fetch(
        'https://raw.githubusercontent.com/TheBeastLT/stremio-kitsu-anime/master/static/data/imdb_mapping.json',
        { method: 'GET' },
      );

      if (!response.ok) {
        return { data: null, error: response.statusText, status: response.status };
      }

      const rawList: any[] = await response.json();
      const match = rawList.find(item => item.kitsu_id === targetKitsuId);

      if (!match) {
        return { data: null, error: 'Mapping not found for the given Kitsu ID', status: 404 };
      }

      const normalized: IStremioImdbMapping = {
        kitsuId: match.kitsu_id,
        imdbId: match.imdb_id,
        title: match.title,
        ...(match.fromSeason !== undefined && { seasonStart: match.fromSeason }),
        ...(match.fromEpisode !== undefined && { episodeStart: match.fromEpisode }),
      };
      console.log(normalized);

      return { data: normalized, status: 200 };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
        status: 500,
      };
    }
  }

  private async searchKitsuByAnilistId(anilistId: number): Promise<IResponse<IMetaAnime | null>> {
    try {
      const animeInfo = await this.anilist.fetchInfo(anilistId, 'ANIME');
      if (animeInfo.error || !animeInfo.data) {
        return { data: null, error: animeInfo.error, status: animeInfo.status };
      }

      const targetTitles = [
        animeInfo.data.title?.english,
        animeInfo.data.title?.romaji,
        animeInfo.data.title?.native,
        ...(animeInfo.data.synonyms || []),
      ].filter(Boolean) as string[];

      if (targetTitles.length === 0) {
        return { data: null, error: 'No titles found for the given AniList ID', status: 404 };
      }

      const query = targetTitles[0];
      const searchKitsu = await this.kitsu.search(query);

      if (searchKitsu.error || !searchKitsu.data || searchKitsu.data.length === 0) {
        return { data: null, error: searchKitsu.error ?? 'No Kitsu results found', status: searchKitsu.status ?? 404 };
      }

      let bestMatch: IMetaAnime | null = null;
      let highestScore = -1;

      for (const item of searchKitsu.data) {
        const kitsuTitles = [item.title?.english, item.title?.romaji, item.title?.native, ...(item.synonyms || [])].filter(
          Boolean,
        ) as string[];

        for (const tTitle of targetTitles) {
          for (const kTitle of kitsuTitles) {
            const score = token_sort_ratio(tTitle, kTitle);
            if (score > highestScore) {
              highestScore = score;
              bestMatch = item;
            }
          }
        }
      }

      if (!bestMatch || highestScore < 60) {
        return { data: null, error: 'No sufficiently close Kitsu match found', status: 404 };
      }

      return { data: bestMatch, status: 200 };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
        status: 500,
      };
    }
  }

  private async fetchFribbsMappings(anilistId: number): Promise<IResponse<IFribbsList | null>> {
    try {
      const response = await this.client.fetch(
        'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json',
        { method: 'GET' },
      );

      if (!response.ok) {
        return { data: null, error: response.statusText, status: response.status };
      }

      const list: any[] = await response.json();
      const match = list.find(item => item.anilist_id === anilistId);

      if (!match) {
        return { data: null, error: 'Mapping not found for the given AniList ID', status: 404 };
      }

      let imdbId: string | null = null;
      if (Array.isArray(match.imdb_id) && match.imdb_id.length > 0) {
        imdbId = match.imdb_id[0];
      } else if (typeof match.imdb_id === 'string') {
        imdbId = match.imdb_id;
      }

      const result: IFribbsList = {
        anilistId: match.anilist_id ?? null,
        kitsuId: match.kitsu_id ?? null,
        imdbId: imdbId,
      };

      return { data: result, status: 200 };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
        status: 500,
      };
    }
  }

  private async doResolveAnimeInfo(anilistId: number): Promise<IResponse<IMetaAnime | null>> {
    const anilistResult = await this.anilist.fetchInfo(anilistId, 'ANIME');

    if (!anilistResult.error && anilistResult.data) {
      return {
        data: anilistResult.data,
        status: 200,
      };
    }

    const RETRYABLE_STATUSES = [403, 429];
    const canFallback = anilistResult.status !== undefined && RETRYABLE_STATUSES.includes(anilistResult.status);

    if (!canFallback) {
      return {
        data: null,
        error: anilistResult.error,
        status: anilistResult.status,
      };
    }

    const mappingResult = await this.resolveAnilistKitsuMapping(anilistId);

    if (mappingResult.error || !mappingResult.data) {
      return {
        data: null,
        error: mappingResult.error ?? 'Could not map AniList ID to a valid Kitsu ID',
        status: mappingResult.status ?? 404,
      };
    }

    const kitsuResult = await this.kitsu.fetchInfo(mappingResult.data);

    if (kitsuResult.error || !kitsuResult.data) {
      return {
        data: null,
        error: kitsuResult.error ?? 'Kitsu fallback failed',
        status: kitsuResult.status ?? 500,
      };
    }

    return {
      data: kitsuResult.data,
      status: 200,
    };
  }

  private async doResolveFranchiseMedia(anilistId: number): Promise<IResponse<IRelatedAnimeData[] | null>> {
    const anilistResult = await this.anilist.fetchParentSeries(anilistId);

    if (!anilistResult.error && anilistResult.data) {
      return {
        data: anilistResult.data,
      };
    }

    const RETRYABLE_STATUSES = [403, 429];
    const canFallback = anilistResult.status !== undefined && RETRYABLE_STATUSES.includes(anilistResult.status);

    if (!canFallback) {
      return {
        data: null,
        error: anilistResult.error,
        status: anilistResult.status,
      };
    }

    const mappingResult = await this.resolveAnilistKitsuMapping(anilistId);

    if (mappingResult.error || !mappingResult.data) {
      return {
        data: null,
        error: mappingResult.error ?? 'Could not map AniList ID to a valid Kitsu ID',
        status: mappingResult.status ?? 404,
      };
    }

    const kitsuResult = await this.kitsu.fetchParentSeries(String(mappingResult.data));

    if (kitsuResult.error || !kitsuResult.data) {
      return {
        data: null,
        error: kitsuResult.error ?? 'Kitsu fallback failed',
        status: kitsuResult.status ?? 500,
      };
    }

    return {
      data: kitsuResult.data,
    };
  }
}
