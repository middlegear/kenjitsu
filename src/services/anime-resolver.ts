import { Anilist, Kitsu } from '../providers/main.js';
import type { IResponse } from '../types/base.js';
import type { IMetaAnime, IRelatedAnimeData } from '../types/meta/meta-anime.js';
import { AIOMetadata } from './aiometadata.js';

export class AnimeInfoResolver {
  private readonly animeInfoCache = new Map<number, Promise<IResponse<IMetaAnime | null>>>();
  private readonly franchiseMediaCache = new Map<number, Promise<IResponse<IRelatedAnimeData[] | null>>>();

  private readonly anilist = new Anilist();
  private readonly kitsu = new Kitsu();
  private readonly aioMetadata = new AIOMetadata();

  private readonly RESULT_GRACE_MS = 5000;

  constructor() {}

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

    // Kitsu fallback
    let kitsuAnimeId: number | null = null;

    const mappedId = await this.kitsu.fetchMapping(anilistId);

    if (!mappedId.error && mappedId.data?.id) {
      const parsedId = Number(mappedId.data.id);
      if (!Number.isNaN(parsedId)) {
        kitsuAnimeId = parsedId;
      }
    }

    if (!kitsuAnimeId) {
      const aioResult = await this.aioMetadata.fetchAnimeMappings(anilistId);

      if (aioResult.data?.kitsuId) {
        const parsedId = Number(aioResult.data.kitsuId);
        if (!Number.isNaN(parsedId)) {
          kitsuAnimeId = parsedId;
        }
      }
    }

    if (!kitsuAnimeId) {
      return {
        data: null,
        error: 'Could not map AniList ID to a valid Kitsu ID using Kitsu or AIOMetadata',
        status: 404,
      };
    }

    const kitsuResult = await this.kitsu.fetchInfo(kitsuAnimeId);

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

    // Kitsu fallback
    let kitsuAnimeId: number | null = null;

    const mappedId = await this.kitsu.fetchMapping(anilistId);

    if (!mappedId.error && mappedId.data?.id) {
      const parsedId = Number(mappedId.data.id);
      if (!Number.isNaN(parsedId)) {
        kitsuAnimeId = parsedId;
      }
    }

    if (!kitsuAnimeId) {
      const aioResult = await this.aioMetadata.fetchAnimeMappings(anilistId);

      if (aioResult.data?.kitsuId) {
        const parsedId = Number(aioResult.data.kitsuId);
        if (!Number.isNaN(parsedId)) {
          kitsuAnimeId = parsedId;
        }
      }
    }

    if (!kitsuAnimeId) {
      return {
        data: null,
        error: 'Could not map AniList ID to a valid Kitsu ID using Kitsu or AIOMetadata',
        status: 404,
      };
    }

    const kitsuResult = await this.kitsu.fetchParentSeries(String(kitsuAnimeId));

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
