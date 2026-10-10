import 'dotenv/config';
import type { ClientOptions } from '../config/client.js';
import { redisGetCache, redisSetCache } from '../config/redis.js';
import { BaseClass } from '../providers/models/base.js';
import type { IResponse } from '../types/base.js';
import type { ICinemetaEpisode } from '../types/cinemeta.js';

interface AIOMetaAnimeMap {
  imdbId: string | null;
  tmdbId: string | null;
  kitsuId: string | null;
  malId: string | null;
  tvdbId: string | null;
  type: string | null;
  name: string | null;
}
const AIOHashId = process.env.AIOCONFIGHASH || null;
const MISSING_HASH_ERROR = 'Missing required env AIOCONFIGHASH! visit https://aiometadata.elfhosted.com';
class AIOMetadata extends BaseClass {
  private readonly baseUrl: string = `https://aiometadata.elfhosted.com/stremio/${AIOHashId}`;

  constructor(options: ClientOptions = { browser: 'okhttp5' }) {
    super(options);
  }
  async fetchAnimeMappings(anilistId: number): Promise<IResponse<AIOMetaAnimeMap | null>> {
    if (!AIOHashId) {
      return {
        data: null,
        error: MISSING_HASH_ERROR,
        status: 500,
      };
    }
    if (!anilistId) {
      return {
        data: null,
        error: 'Missing required params :anilistId!',
        status: 400,
      };
    }
    const cacheKey = `AIOMetadata-fetchMappings-${anilistId}`;
    const cached = await redisGetCache<IResponse<AIOMetaAnimeMap | null>>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.fetch(`${this.baseUrl}/meta/anime/anilist:${anilistId}.json`, { method: 'GET' });
      if (!response.ok) {
        return {
          data: null,
          error: response.statusText,
          status: response.status,
        };
      }

      const result = (await response.json()) as any;
      const info = {
        imdbId: result.meta.imdb_id || result.meta.imdbId,
        tmdbId: result.meta._tmdbId,
        tvdbId: result.meta._tvdbId,
        malId: result.meta._malId,
        name: result.meta.name,
        kitsuId: result.meta._kitsuId,
        type: result.meta.type,
      };

      const mappingsResult: IResponse<AIOMetaAnimeMap> = {
        data: info,
      };

      if (mappingsResult.data && mappingsResult.data !== null) {
        await redisSetCache(cacheKey, mappingsResult, 168);
      }

      return mappingsResult;
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 500,
      };
    }
  }

  async fetchEpisodes(id: string, format: string): Promise<IResponse<ICinemetaEpisode[] | []>> {
    if (!AIOHashId) {
      return {
        data: [],
        error: MISSING_HASH_ERROR,
        status: 500,
      };
    }
    if (!id) {
      return {
        data: [],
        error: 'Missing required params :id!',
        status: 400,
      };
    }
    const mediaType = format.toLowerCase() === 'movie' ? 'movie' : 'series';
    const cacheKey = `AIOMetadata-episodes-${id}-${mediaType}`;
    const cached = await redisGetCache<IResponse<ICinemetaEpisode[] | []>>(cacheKey);
    if (cached) return cached;
    try {
      const response = await this.client.fetch(`${this.baseUrl}/meta/${mediaType}/${id}.json`, { method: 'GET' });
      if (!response.ok) {
        return {
          data: [],
          error: response.statusText,
          status: response.status,
        };
      }

      const result = (await response.json()) as any;
      let episodes: ICinemetaEpisode[] = [];

      if (mediaType === 'movie')
        episodes = [
          {
            title: result.meta.name,
            airDate: result.meta.released,
            seasonNumber: null,
            seasonEpisodeNumber: null,
            thumbnail: result.meta.background ?? result.meta.landscapePoster,
            id: id,
            summary: result.meta.description,
            imdbId: result.meta.id.startsWith('tt') ? result.meta.id : `${id}`,
            type: mediaType,
          },
        ];
      else {
        episodes = result.meta.videos.map((item: any): ICinemetaEpisode => ({
          title: item.title,
          airDate: item.released || item.firstAired || '',
          seasonNumber: item.season != null ? Number(item.season) : null,
          seasonEpisodeNumber: item.episode != null ? Number(item.episode) : null,
          thumbnail: item.thumbnail,
          id: id,
          imdbId: item.id.startsWith('tt') && item.id.includes(':') ? item.id : `${id}:${item.season}:${item.episode}`,
          summary: item.overview || '',
          type: mediaType,
        }));
      }

      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);

      episodes = episodes.filter(episode => {
        if (!episode.airDate) return false;

        const airDate = new Date(episode.airDate);
        return !isNaN(airDate.getTime()) && airDate <= endOfToday;
      });
      const episodeResult: IResponse<ICinemetaEpisode[]> = {
        data: episodes,
      };

      if (Array.isArray(episodeResult.data) && episodes.length > 0) {
        await redisSetCache(cacheKey, episodeResult, 24);
      }

      return episodeResult;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown Error',
        data: [],
        status: 500,
      };
    }
  }
}

export { AIOMetadata };
