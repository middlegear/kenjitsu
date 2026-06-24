import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Anilist, type Seasons, type IMetaFormat } from 'kenjitsu-extensions';
import {
  allowedAnimeProviders,
  IAMetaFormatArr,
  IAnimeSeasonsArr,
  type FastifyParams,
  type FastifyQuery,
} from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../config/redis.js';
import { isValidDate } from '../../utils/utils.js';

const anilist = new Anilist();

export default async function AnilistRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/anime/search',
    {
      schema: {
        tags: ['AniList'],
        summary: 'Search anime',
        description: 'Search AniList database.',
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string', maxLength: 1000, description: 'Search keyword' },
            page: { type: 'number', default: 1, description: 'Page number' },
            perPage: { type: 'number', default: 20, maximum: 50, description: 'Items per page' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

      const { q, page = 1 } = request.query;
      if (!q) return reply.status(400).send({ error: "Missing 'q' parameter" });
      if (q.length > 1000) return reply.status(400).send({ error: 'Query too long' });

      let perPage = Math.min(Number(request.query.perPage) || 20, 50);
      const cacheKey = `anilist-search-${q}-${page}-${perPage}`;

      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await anilist.search(q, 'ANIME', page, perPage);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result?.data?.length > 0) {
          await redisSetCache(cacheKey, result, 168);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
  fastify.get(
    '/anime/:id',
    {
      schema: {
        tags: ['AniList'],
        summary: 'Get anime details',
        description: 'Fetch full anime metadata by ID.',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'number', description: 'AniList ID' } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

      const id = Number(request.params.id);
      if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

      const cacheKey = `anilist-info-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await anilist.fetchInfo(id, 'ANIME');
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        const duration = result.data?.status?.toLowerCase() === 'finished' ? 12 : 1;
        if (result.data) {
          await redisSetCache(cacheKey, result, duration);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  fastify.get(
    '/anime/top/:category',
    {
      schema: {
        tags: ['AniList'],
        summary: 'Get top anime',
        description: 'Get top anime by category.',
        params: {
          type: 'object',
          required: ['category'],
          properties: {
            category: { type: 'string', enum: ['airing', 'trending', 'upcoming', 'popular', 'rating'] },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', default: 1 },
            perPage: { type: 'number', default: 20, maximum: 50 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      let perPage = Math.min(Number(request.query.perPage) || 20, 50);
      const category = request.params.category as 'airing' | 'trending' | 'upcoming' | 'popular' | 'rating';

      if (!['airing', 'trending', 'upcoming', 'popular', 'rating'].includes(category)) {
        return reply.status(400).send({ error: `Invalid category: ${category}` });
      }

      const cacheKey = `anilist-top-${category}-${page}-${perPage}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        let result;
        switch (category) {
          case 'airing':
            result = await anilist.fetchTopAiring(page, perPage);
            break;
          case 'trending':
            result = await anilist.fetchTrending('ANIME', 'TV', page, perPage);
            break;
          case 'upcoming':
            result = await anilist.fetchTopUpcoming(page, perPage);
            break;
          case 'rating':
            result = await anilist.fetchTopRated('ANIME', 'TV', page, perPage);
            break;
          case 'popular':
            result = await anilist.fetchMostPopular('ANIME', 'TV', page, perPage);
            break;
        }

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        const duration = ['airing', 'trending', 'upcoming'].includes(category) ? 24 : 336;
        if (result?.data?.length > 0) {
          await redisSetCache(cacheKey, result, duration);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  fastify.get(
    '/anime/:id/characters',
    {
      schema: {
        tags: ['AniList'],
        summary: 'Get anime characters',
        description: 'Fetch characters and voice actors.',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'number', description: 'AniList ID' } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

      const id = Number(request.params.id);
      if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

      const cacheKey = `anilist-characters-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await anilist.fetchCharacters(id);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result.data) {
          await redisSetCache(cacheKey, result, 0);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  fastify.get(
    '/anime/:id/related',
    {
      schema: {
        tags: ['AniList'],
        summary: 'Get related anime',
        description: 'Fetch related anime recommendations.',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'number', description: 'AniList ID' } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

      const id = Number(request.params.id);
      if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

      const cacheKey = `anilist-related-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await anilist.fetchRelatedAnime(id);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result?.data?.length > 0) {
          await redisSetCache(cacheKey, result, 336);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
  fastify.get(
    '/airing/date/:date',
    {
      schema: {
        tags: ['AniList'],
        summary: 'Get airing schedule by date',
        description: 'Get anime airing on a specific date.',
        params: {
          type: 'object',
          required: ['date'],
          properties: { date: { type: 'string', format: 'date', description: 'YYYY-MM-DD' } },
        },
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', default: 1 },
            perPage: { type: 'number', default: 20 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      const perPage = Number(request.query.perPage) || 20;
      const date = request.params.date;

      if (!date) return reply.status(400).send({ error: "Missing 'date' parameter" });
      if (!isValidDate(date)) return reply.status(400).send({ error: 'Invalid date format. Expected YYYY-MM-DD' });

      const cacheKey = `anilist-schedule-${date}-${page}-${perPage}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await anilist.fetchAiringSchedule(date, page, perPage);
        if (result.error) {
          return reply.status(result.status as number).send(result);
        }

        if (result?.data?.length > 0) {
          await redisSetCache(cacheKey, result, 6);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  fastify.get(
    '/anime/schedule/:id',
    {
      schema: {
        tags: ['AniList'],
        summary: 'Get media airing schedule',
        description: 'Get airing schedule for a specific anime.',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'number', description: 'AniList ID' } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

      const id = Number(request.params.id);
      if (isNaN(id) || !id) return reply.status(400).send({ error: "Missing or invalid 'id' parameter" });

      const cacheKey = `anilist-media-schedule-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await anilist.fetchMediaSchedule(id);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result.data) {
          await redisSetCache(cacheKey, result, 24);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
  fastify.get(
    '/seasons/:season/:year',
    {
      schema: {
        tags: ['AniList'],
        summary: 'Get seasonal anime',
        description: 'Fetch anime for a specific season and year.',
        params: {
          type: 'object',
          required: ['season', 'year'],
          properties: {
            season: { type: 'string' },
            year: { type: 'number' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            format: { type: 'string', default: 'TV' },
            page: { type: 'number', default: 1 },
            perPage: { type: 'number', default: 20, maximum: 50 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

      const season = request.params.season as Seasons;
      const year = Number(request.params.year);
      const format = (request.query.format as IMetaFormat) || 'TV';
      const page = Number(request.query.page) || 1;
      let perPage = Math.min(Number(request.query.perPage) || 20, 50);

      if (!IAMetaFormatArr.includes(format)) {
        return reply.status(400).send({ error: `Invalid format: ${format}` });
      }
      if (!season || !year) {
        return reply.status(400).send({ error: 'Missing season or year' });
      }
      if (!IAnimeSeasonsArr.includes(season)) {
        return reply.status(400).send({ error: `Invalid season: ${season}` });
      }

      const cacheKey = `anilist-season-${season}-${year}-${page}-${format}-${perPage}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await anilist.fetchSeasonalAnime(season, year, page, perPage, format);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result?.data?.length > 0) {
          await redisSetCache(cacheKey, result, 336);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
  fastify.get(
    '/anime/mappings/:id',
    {
      schema: {
        tags: ['AniList'],
        summary: 'Get provider mappings',
        description: 'Get external provider ID mappings for an anime.',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'number', description: 'AniList ID' } },
        },
        querystring: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['anikoto', 'animepahe', 'anizone'],
              default: 'anikoto',
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const id = Number(request.params.id);
      const provider = (request.query.provider as 'anikoto' | 'animepahe' | 'anizone') || 'anikoto';

      if (isNaN(id) || !id) {
        return reply.status(400).send({ error: "Missing or invalid 'id' parameter" });
      }
      if (!allowedAnimeProviders.includes(provider)) {
        return reply.status(400).send({ error: `Invalid provider '${provider}'` });
      }

      const cacheKey = `anilist-mappings-id-${id}-${provider}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        let result;
        switch (provider) {
          case 'animepahe':
            result = await anilist.fetchAnimepaheProviderId(id);
            break;
          case 'anizone':
            result = await anilist.fetchAnizoneProviderId(id);
            break;
          case 'anikoto':
            result = await anilist.fetchAnikotoProviderId(id);
            break;
          default:
            return reply.status(400).send({ error: `Invalid provider '${provider}'` });
        }

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }

        if (result.error) {
          return reply.status((result.status as number) || 500).send({ error: result.error });
        }

        const data = result?.data;
        const status = data?.status?.toLowerCase();
        const format = data?.format?.toLowerCase();

        if (
          result &&
          data &&
          result.provider !== null &&
          status === 'finished' &&
          data.episodes !== null &&
          format !== 'movie' &&
          provider !== 'animepahe'
        ) {
          await redisSetCache(cacheKey, result, 0);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
  fastify.get(
    '/episodes/:id',
    {
      schema: {
        tags: ['AniList'],
        summary: 'Get anime episodes',
        description: 'Get episodes from external provider.',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'number', description: 'AniList ID' } },
        },
        querystring: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['anikoto', 'animepahe', 'anizone'],
              default: 'anikoto',
            },
          },
        },
      },
    },

    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${0.5 * 60 * 60}, stale-while-revalidate=300`);

      const id = Number(request.params.id);
      const provider = (request.query.provider as 'anikoto' | 'animepahe' | 'anizone') || 'anikoto';

      if (isNaN(id) || !id) {
        return reply.status(400).send({ error: "Missing or invalid 'id' parameter" });
      }
      if (!allowedAnimeProviders.includes(provider)) {
        return reply.status(400).send({ error: `Invalid provider '${provider}'` });
      }

      const cacheKey = `anilist-episodes-${id}-${provider}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        let result;
        switch (provider) {
          case 'animepahe':
            result = await anilist.fetchAnimepaheProviderEpisodes(id);
            break;
          case 'anizone':
            result = await anilist.fetchAnizoneProviderEpisodes(id);
            break;
          case 'anikoto':
            result = await anilist.fetchAnikotoProviderEpisodes(id);
            break;
          default:
            return reply.status(400).send({ error: `Invalid provider '${provider}'` });
        }

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error || result.data === null || result.providerEpisodes?.length === 0) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        const status = result?.data?.status?.toLowerCase();
        const format = result?.data?.format?.toLowerCase();
        const episodesFound = result?.providerEpisodes?.length || 0;
        const episodesExpected = result?.data?.episodes;

        const isFinished = status === 'finished';
        const isNotMovie = format !== 'movie';
        const isComplete = episodesFound >= episodesExpected && episodesExpected !== null;

        let duration = isFinished ? 0 : 1.5;
        if (isFinished && result.data && isNotMovie && isComplete && provider !== 'animepahe') {
          await redisSetCache(cacheKey, result, duration);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
