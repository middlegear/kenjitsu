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

type MediaType = 'movie' | 'series';

const AIOHashId = process.env.AIOCONFIGHASH || null;
const MISSING_HASH_ERROR = 'Missing required env AIOCONFIGHASH! visit https://aiometadata.elfhosted.com';

const isImdbId = (value: unknown): value is string => typeof value === 'string' && /^tt\d+$/.test(value);

class AIOMetadata extends BaseClass {
  private readonly baseUrl: string = `https://aiometadata.elfhosted.com/stremio/${AIOHashId}`;

  /** Catalogs searched per media type, in order. Anime catalogs are folded into their type. */
  private static readonly SEARCH_PATHS: Record<MediaType, readonly string[]> = {
    series: ['series/search.series', 'anime.series/search.anime_series'],
    movie: ['movie/search.movie', 'anime.movie/search.anime_movie'],
  };

  constructor(options: ClientOptions = { browser: 'okhttp5' }) {
    super(options);
  }

  /**
   * Fetches id mappings for any prefixed provider id,
   * e.g. 'anilist:21', 'kitsu:1234', 'mal:5114'.
   */
  async fetchMappingsByProviderId(providerId: string): Promise<IResponse<AIOMetaAnimeMap | null>> {
    if (!AIOHashId) {
      return { data: null, error: MISSING_HASH_ERROR, status: 500 };
    }
    if (!providerId) {
      return { data: null, error: 'Missing required params: providerId', status: 400 };
    }

    const cacheKey = `AIOMetadata-fetchMappings-${providerId}`;
    const cached = await redisGetCache<IResponse<AIOMetaAnimeMap | null>>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.fetch(`${this.baseUrl}/meta/anime/${providerId}.json`, {
        method: 'GET',
      });

      if (!response.ok) {
        return { data: null, error: response.statusText, status: response.status };
      }

      const meta = ((await response.json()) as any)?.meta;

      if (!meta) {
        return { data: null, error: 'No metadata found', status: 404 };
      }

      const result: IResponse<AIOMetaAnimeMap> = {
        data: {
          imdbId: [meta.imdb_id, meta._imdbId, meta.imdbId].find(isImdbId) ?? null,
          tmdbId: meta._tmdbId,
          tvdbId: meta._tvdbId,
          malId: meta._malId,
          name: meta.name,
          kitsuId: meta._kitsuId,
          type: meta.type,
        },
      };

      await redisSetCache(cacheKey, result, 168);

      return result;
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : String(error), status: 500 };
    }
  }

  /**
   * Searches one media type's catalogs (series or movie, each including its
   * anime variant) sequentially and returns a deduplicated list. Every result
   * is tagged with the requested `type`.
   */
  async search(query: string, type: MediaType): Promise<IResponse<ICineMetaSearch[] | []>> {
    if (!AIOHashId) {
      return { data: [], error: MISSING_HASH_ERROR, status: 500 };
    }
    if (!query?.trim()) {
      return { data: [], error: 'Missing required params: query string', status: 400 };
    }

    const cacheKey = `aiometadata-search-${type}-${query.toLowerCase().trim()}`;
    const cached = await redisGetCache<IResponse<ICineMetaSearch[] | []>>(cacheKey);
    if (cached) return cached;

    const data: ICineMetaSearch[] = [];
    const seen = new Set<string>();

    try {
      for (const path of AIOMetadata.SEARCH_PATHS[type]) {
        const url = `${this.baseUrl}/catalog/${path}/search=${encodeURIComponent(query)}.json`;

        try {
          const response = await this.client.fetch(url, { method: 'GET' });

          if (!response.ok) {
            console.error(` ${response.status} ${response.statusText} -> ${url}`);
            continue;
          }

          const metas: any[] = ((await response.json()) as any).metas ?? [];

          for (const item of metas) {
            if (typeof item?.id !== 'string') continue;

            const imdbId = [item.imdb_id, item._imdbId, item.id].find(isImdbId) ?? null;
            const providerId = imdbId ? null : item.id;
            const key = imdbId ?? providerId;

            if (!key || seen.has(key)) continue;
            seen.add(key);

            const [start, ...rest] = String(item.releaseInfo ?? '').split('-');

            data.push({
              id: key,
              name: item.name,
              imdbId,
              providerId,
              posterImage: item.poster ?? null,
              coverImage: item.background ?? null,
              type,
              startYear: start || item.year || null,
              endYear: rest.pop() || null,
            });
          }
        } catch (error) {
          console.error(`search failed -> ${url}`, error);
        }
      }

      const result = { data };

      if (data.length > 0) {
        await redisSetCache(cacheKey, result, 72);
      }

      return result;
    } catch (error) {
      return { data: [], error: error instanceof Error ? error.message : String(error), status: 500 };
    }
  }

  async fetchEpisodes(id: string, format: string): Promise<IResponse<ICinemetaEpisode[] | []>> {
    if (!AIOHashId) {
      return { data: [], error: MISSING_HASH_ERROR, status: 500 };
    }
    if (!isImdbId(id)) {
      return { data: [], error: 'Invalid id: expected an IMDb id (tt...)', status: 400 };
    }

    const mediaType: MediaType = format.toLowerCase() === 'movie' ? 'movie' : 'series';
    const cacheKey = `AIOMetadata-meta-${mediaType}-${id}`;

    const cached = await redisGetCache<IResponse<ICinemetaEpisode[] | []>>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.fetch(`${this.baseUrl}/meta/${mediaType}/${id}.json`, { method: 'GET' });

      if (!response.ok) {
        return { data: [], error: response.statusText, status: response.status };
      }

      const meta = ((await response.json()) as any)?.meta;

      if (!meta) {
        return { data: [], error: 'No metadata found', status: 404 };
      }

      let episodes: ICinemetaEpisode[];

      if (mediaType === 'movie') {
        episodes = [
          {
            title: meta.name ?? null,
            airDate: meta.released ?? null,
            seasonNumber: null,
            seasonEpisodeNumber: null,
            thumbnail: meta.background ?? meta.landscapePoster ?? null,
            id,
            summary: meta.description ?? null,
            imdbId: meta.id?.startsWith('tt') ? meta.id : id,
            type: mediaType,
          },
        ];
      } else {
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);

        episodes = (meta.videos ?? [])
          .map((item: any): ICinemetaEpisode => ({
            title: item.title ?? null,
            airDate: item.released ?? item.firstAired ?? null,
            seasonNumber: item.season != null ? Number(item.season) : null,
            seasonEpisodeNumber: item.episode != null ? Number(item.episode) : null,
            thumbnail: item.thumbnail ?? null,
            id,
            imdbId:
              item.id?.startsWith('tt') && item.id.includes(':')
                ? item.id
                : `${id}:${item.season ?? 0}:${item.episode ?? 0}`,
            summary: item.overview ?? null,
            type: mediaType,
          }))
          // Drop unaired / undated episodes
          .filter((episode: ICinemetaEpisode) => {
            if (!episode.airDate) return false;

            const airDate = new Date(episode.airDate);
            return !isNaN(airDate.getTime()) && airDate <= endOfToday;
          });
      }

      const result = { data: episodes };

      if (episodes.length > 0) {
        await redisSetCache(cacheKey, result, 24);
      }

      return result;
    } catch (error) {
      return { data: [], error: error instanceof Error ? error.message : String(error), status: 500 };
    }
  }
}

export { AIOMetadata };
export type { MediaType };
