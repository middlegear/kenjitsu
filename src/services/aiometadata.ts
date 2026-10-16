import 'dotenv/config';
import type { ClientOptions } from '../config/client.js';
import { redisGetCache, redisSetCache } from '../config/redis.js';
import { BaseClass } from '../providers/models/base.js';
import type { IResponse } from '../types/base.js';
import type { ICinemetaEpisode, ICineMetaSearch } from '../types/cinemeta.js';

interface AIOMetaAnimeMap {
  imdbId: string | null;
  tmdbId: string | null;
  kitsuId: string | null;
  malId: string | null;
  tvdbId: string | null;
  type: string | null;
  name: string | null;
}

interface AIOMetaPayload {
  genres: string[];
  episodes: ICinemetaEpisode[];
}

type MediaType = 'movie' | 'series';

const AIOHashId = process.env.AIOCONFIGHASH || null;
const MISSING_HASH_ERROR = 'Missing required env AIOCONFIGHASH! visit https://aiometadata.elfhosted.com';

class AIOMetadata extends BaseClass {
  private readonly baseUrl: string = `https://aiometadata.elfhosted.com/stremio/${AIOHashId}`;

  private static readonly META_TTL_HOURS = 24;
  private static readonly META_TTL_MS = AIOMetadata.META_TTL_HOURS * 60 * 60 * 1000;
  private static readonly MEMORY_MAX_ENTRIES = 500;
  private static readonly SEARCH_TTL_HOURS = 72;

  private readonly searchTypes: MediaType[] = ['movie', 'series'];

  private readonly metaMemory = new Map<string, { at: number; result: IResponse<AIOMetaPayload> }>();
  private readonly metaPending = new Map<string, Promise<IResponse<AIOMetaPayload | null>>>();

  constructor(options: ClientOptions = { browser: 'okhttp5' }) {
    super(options);
  }

  async fetchAnimeMappings(anilistId: number): Promise<IResponse<AIOMetaAnimeMap | null>> {
    if (!AIOHashId) {
      return { data: null, error: MISSING_HASH_ERROR, status: 500 };
    }
    if (!anilistId) {
      return { data: null, error: 'Missing required params :anilistId!', status: 400 };
    }

    const cacheKey = `AIOMetadata-fetchMappings-${anilistId}`;
    const cached = await redisGetCache<IResponse<AIOMetaAnimeMap | null>>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.fetch(`${this.baseUrl}/meta/anime/anilist:${anilistId}.json`, {
        method: 'GET',
      });

      if (!response.ok) {
        return { data: null, error: response.statusText, status: response.status };
      }

      const result = (await response.json()) as any;
      const info: AIOMetaAnimeMap = {
        imdbId: result.meta.imdb_id || result.meta.imdbId,
        tmdbId: result.meta._tmdbId,
        tvdbId: result.meta._tvdbId,
        malId: result.meta._malId,
        name: result.meta.name,
        kitsuId: result.meta._kitsuId,
        type: result.meta.type,
      };

      const mappingsResult: IResponse<AIOMetaAnimeMap> = { data: info };

      await redisSetCache(cacheKey, mappingsResult, 168);

      return mappingsResult;
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 500,
      };
    }
  }

  /**
   * Searches AIOMetadata's movie and series search catalogs in parallel and
   * returns one interleaved, deduped list. Results carry `genres` so callers
   * can verify a candidate without a second metadata request.
   */
  async search(query: string): Promise<IResponse<ICineMetaSearch[] | []>> {
    if (!AIOHashId) {
      return { data: [], error: MISSING_HASH_ERROR, status: 500 };
    }
    if (!query?.trim()) {
      return { data: [], error: 'Missing required params: query string', status: 400 };
    }

    const cacheKey = `aiometadata-search-${query.toLowerCase().trim()}`;
    const cached = await redisGetCache<IResponse<ICineMetaSearch[] | []>>(cacheKey);
    if (cached) return cached;

    const settled = await Promise.allSettled(this.searchTypes.map(type => this.fetchSearchCatalog(query, type)));

    const results = settled.map(result =>
      result.status === 'fulfilled'
        ? result.value
        : {
            data: [] as ICineMetaSearch[],
            error: result.reason instanceof Error ? result.reason.message : 'Failed to fetch catalog',
            status: 500,
          },
    );

    const failed = results.filter(result => result.error);

    if (failed.length === results.length) {
      return { data: [], error: failed[0].error, status: failed[0].status ?? 500 };
    }

    const responseResult: IResponse<ICineMetaSearch[]> = {
      data: this.mergeResults(results.map(result => result.data)),
    };
    if (responseResult.data.length > 0 && failed.length === 0) {
      await redisSetCache(cacheKey, responseResult, AIOMetadata.SEARCH_TTL_HOURS);
    }

    return responseResult;
  }

  private async fetchSearchCatalog(query: string, mediaType: MediaType): Promise<IResponse<ICineMetaSearch[]>> {
    try {
      const url = `${this.baseUrl}/catalog/${mediaType}/search.${mediaType}/search=${encodeURIComponent(query)}.json`;
      const response = await this.client.fetch(url, { method: 'GET' });

      if (!response.ok) {
        return { data: [], error: response.statusText, status: response.status };
      }

      const json = (await response.json()) as any;

      const imdbOnly = (json.metas ?? []).filter((item: any) => typeof item?.id === 'string' && /^tt\d+$/.test(item.id));

      const data: ICineMetaSearch[] = imdbOnly.map((item: any): ICineMetaSearch => {
        const parts = typeof item.releaseInfo === 'string' ? item.releaseInfo.split('-') : [];

        return {
          id: item.id,
          name: item.name,
          imdbId: item.id,
          posterImage: item.poster ?? null,
          coverImage: item.background ?? null,
          type: item.type ?? mediaType,
          startYear: parts[0] || item.year || null,
          endYear: parts.length > 1 ? parts[parts.length - 1] || null : null,
          genres: this.extractGenres(item),
        };
      });

      return { data };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown Error',
        status: 500,
      };
    }
  }

  // Interleaves result lists (movie, series, movie, series...) and dedupes by id
  private mergeResults(lists: ICineMetaSearch[][]): ICineMetaSearch[] {
    const merged: ICineMetaSearch[] = [];
    const seen = new Set<string>();
    const maxLen = Math.max(0, ...lists.map(list => list.length));

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

  async fetchGenres(id: string, format: string): Promise<IResponse<string[] | null>> {
    const meta = await this.fetchMeta(id, format);

    if (meta.error || !meta.data) {
      return { data: null, error: meta.error, status: meta.status };
    }

    return { data: meta.data.genres };
  }

  async fetchEpisodes(id: string, format: string): Promise<IResponse<ICinemetaEpisode[] | []>> {
    const meta = await this.fetchMeta(id, format);

    if (meta.error || !meta.data) {
      return { data: [], error: meta.error, status: meta.status ?? 500 };
    }

    return { data: meta.data.episodes };
  }

  private async fetchMeta(id: string, format: string): Promise<IResponse<AIOMetaPayload | null>> {
    if (!AIOHashId) {
      return { data: null, error: MISSING_HASH_ERROR, status: 500 };
    }
    if (!id) {
      return { data: null, error: 'Missing required params :id!', status: 400 };
    }

    const mediaType: MediaType = format.toLowerCase() === 'movie' ? 'movie' : 'series';
    const cacheKey = `AIOMetadata-meta-${mediaType}-${id}`;

    const memory = this.metaMemory.get(cacheKey);
    if (memory && Date.now() - memory.at < AIOMetadata.META_TTL_MS) return memory.result;

    const pending = this.metaPending.get(cacheKey);
    if (pending) return pending;

    const request = this.loadMeta(id, mediaType, cacheKey).finally(() => {
      this.metaPending.delete(cacheKey);
    });

    this.metaPending.set(cacheKey, request);

    return request;
  }

  private async loadMeta(id: string, mediaType: MediaType, cacheKey: string): Promise<IResponse<AIOMetaPayload | null>> {
    const cached = await redisGetCache<IResponse<AIOMetaPayload>>(cacheKey);
    if (cached) {
      this.remember(cacheKey, cached);
      return cached;
    }

    try {
      const response = await this.client.fetch(`${this.baseUrl}/meta/${mediaType}/${id}.json`, { method: 'GET' });

      if (!response.ok) {
        return { data: null, error: response.statusText, status: response.status };
      }

      const meta = ((await response.json()) as any)?.meta ?? {};

      const result: IResponse<AIOMetaPayload> = {
        data: {
          genres: this.extractGenres(meta),
          episodes: this.extractEpisodes(meta, id, mediaType),
        },
      };

      if (result.data.genres.length > 0 || result.data.episodes.length > 0) {
        this.remember(cacheKey, result);
        await redisSetCache(cacheKey, result, AIOMetadata.META_TTL_HOURS);
      }

      return result;
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Unknown Error',
        status: 500,
      };
    }
  }

  private remember(key: string, result: IResponse<AIOMetaPayload>): void {
    if (this.metaMemory.size >= AIOMetadata.MEMORY_MAX_ENTRIES) {
      const oldest = this.metaMemory.keys().next().value;
      if (oldest !== undefined) this.metaMemory.delete(oldest);
    }

    this.metaMemory.set(key, { at: Date.now(), result });
  }

  private extractGenres(meta: any): string[] {
    const fromLinks = (meta.links ?? []).filter((l: any) => l?.category === 'Genres').map((l: any) => l?.name);

    const sources: unknown[] = [meta.genres, meta.genre, fromLinks];

    for (const source of sources) {
      if (!Array.isArray(source)) continue;

      const genres = source.filter((g): g is string => typeof g === 'string' && g.length > 0);
      if (genres.length > 0) return genres;
    }

    return [];
  }

  private extractEpisodes(meta: any, id: string, mediaType: MediaType): ICinemetaEpisode[] {
    if (mediaType === 'movie') {
      return [
        {
          title: meta.name ?? null,
          airDate: meta.released ?? null,
          seasonNumber: null,
          seasonEpisodeNumber: null,
          thumbnail: meta.background ?? meta.landscapePoster ?? null,
          id,
          summary: meta.description ?? null,
          imdbId: meta.id?.startsWith('tt') ? meta.id : `${id}`,
          type: mediaType,
        },
      ];
    }

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    return (meta.videos ?? [])
      .map((item: any): ICinemetaEpisode => ({
        title: item.title ?? null,
        airDate: item.released ?? item.firstAired ?? null,
        seasonNumber: item.season != null ? Number(item.season) : null,
        seasonEpisodeNumber: item.episode != null ? Number(item.episode) : null,
        thumbnail: item.thumbnail ?? null,
        id,
        imdbId:
          item.id?.startsWith('tt') && item.id.includes(':') ? item.id : `${id}:${item.season ?? 0}:${item.episode ?? 0}`,
        summary: item.overview ?? null,
        type: mediaType,
      }))
      .filter((episode: ICinemetaEpisode) => {
        if (!episode.airDate) return false;

        const airDate = new Date(episode.airDate);
        return !isNaN(airDate.getTime()) && airDate <= endOfToday;
      });
  }
}

export { AIOMetadata };
