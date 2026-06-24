import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Jikan, type Seasons, type IMetaFormat } from 'kenjitsu-extensions';
import { type FastifyQuery, type FastifyParams, IAMetaFormatArr, IAnimeSeasonsArr, JikanList } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../config/redis.js';

const jikan = new Jikan({
  rateLimit: {
    requestsPerInterval: 1,
    intervalMs: 1200,
  },
});

export default async function JikanRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/anime/search',
    {
      schema: {
        tags: ['Jikan'],
        summary: 'Search anime',
        description: 'Search MyAnimeList via Jikan.',
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string', maxLength: 1000, description: 'Search keyword' },
            page: { type: 'number', default: 1, description: 'Page number' },
            perPage: { type: 'number', default: 20, maximum: 25, description: 'Items per page' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=300');

      const { q, page = 1 } = request.query;
      if (!q) return reply.status(400).send({ error: "Missing 'q' parameter" });
      if (q.length > 1000) return reply.status(400).send({ error: 'Query too long' });

      let perPage = Math.min(Number(request.query.perPage) || 20, 25);
      const cacheKey = `mal-search-${q}-${page}-${perPage}`;

      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await jikan.search(q, page, perPage);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from Jikan' });
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
        tags: ['Jikan'],
        summary: 'Get anime details',
        description: 'Fetch full metadata for an anime by MAL ID.',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'number', description: 'MyAnimeList ID' } },
        },
      },
    },

    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const id = request.params.id;
      if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

      const cacheKey = `mal-info-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await jikan.fetchInfo(Number(id));
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from Jikan' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        const duration = result.data?.status === 'finished airing' ? 0 : 168;
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
        tags: ['Jikan'],
        summary: 'Get top anime',
        description: 'Get top ranked anime by category.',
        params: {
          type: 'object',
          required: ['category'],
          properties: {
            category: {
              type: 'string',
              enum: ['favorite', 'popular', 'rating', 'airing', 'upcoming'],
            },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', default: 1 },
            perPage: { type: 'number', default: 20, maximum: 25 },
            format: { type: 'string', default: 'TV' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      let perPage = Math.min(Number(request.query.perPage) || 20, 25);
      const format = (request.query.format as IMetaFormat) || 'TV';
      const category = request.params.category as 'favorite' | 'popular' | 'rating' | 'airing' | 'upcoming';

      if (!JikanList.includes(category)) {
        return reply.status(400).send({ error: `Invalid category: ${category}` });
      }
      if (!IAMetaFormatArr.includes(format)) {
        return reply.status(400).send({ error: `Invalid format: ${format}` });
      }

      const cacheKey = `mal-${category}-${format}-${page}-${perPage}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        let result;
        switch (category) {
          case 'popular':
            result = await jikan.fetchMostPopular(page, perPage, format);
            break;
          case 'favorite':
            result = await jikan.fetchMostFavorite(page, perPage, format);
            break;
          case 'rating':
            result = await jikan.fetchTopAnime(page, perPage, format);
            break;
          case 'airing':
            result = await jikan.fetchTopAiring(page, perPage, format);
            break;
          case 'upcoming':
            result = await jikan.fetchTopUpcoming(page, perPage, format);
            break;
          default:
            return reply.status(400).send({ error: `Invalid category: ${category}` });
        }

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from Jikan' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result?.data?.length > 0) {
          const duration = category === 'airing' || category === 'upcoming' ? 24 : 336;
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
        tags: ['Jikan'],
        summary: 'Get anime characters',
        description: 'Fetch characters and voice actors for an anime.',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'number', description: 'MyAnimeList ID' } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

      const id = request.params.id;
      if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

      const cacheKey = `mal-characters-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await jikan.fetchAnimeCharacters(Number(id));
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from Jikan' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result?.data?.length > 0) {
          await redisSetCache(cacheKey, result, 720);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  fastify.get(
    '/seasons/:season/:year?',
    {
      schema: {
        tags: ['Jikan'],
        summary: 'Get seasonal anime',
        description: 'Fetch anime for a specific season and year.',
        params: {
          type: 'object',
          required: ['season'],
          properties: {
            season: { type: 'string', enum: ['winter', 'spring', 'summer', 'fall', 'current', 'upcoming'] },
            year: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            format: { type: 'string', default: 'TV', enum: ['TV', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC'] },
            page: { type: 'number', default: 1 },
            perPage: { type: 'number', default: 20, maximum: 25 },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { season: Seasons | 'current' | 'upcoming'; year?: string };
        Querystring: FastifyQuery;
      }>,
      reply: FastifyReply,
    ) => {
      reply.header('Cache-Control', `public, s-maxage=${72 * 60 * 60}, stale-while-revalidate=300`);

      const { season, year } = request.params;
      const format = (request.query.format as 'TV' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC') || 'TV';
      const page = Number(request.query.page) || 1;
      let perPage = Math.min(Number(request.query.perPage) || 20, 25);

      if (!IAMetaFormatArr.includes(format)) {
        return reply.status(400).send({ error: `Invalid format: ${format}` });
      }
      if (!season) {
        return reply.status(400).send({ error: "Missing 'season' parameter" });
      }

      const validSeasons = [...IAnimeSeasonsArr, 'current', 'upcoming'];
      if (!validSeasons.includes(season)) {
        return reply.status(400).send({ error: `Invalid season: ${season}` });
      }
      if (season !== 'current' && season !== 'upcoming' && !year) {
        return reply.status(400).send({ error: 'Missing year parameter' });
      }

      const cacheKey = year
        ? `mal-seasons-${year}-${season}-${format}-${page}-${perPage}`
        : `mal-season-${season}-${format}-${page}-${perPage}`;

      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        let result;
        if (season === 'current') {
          result = await jikan.fetchCurrentSeason(page, perPage, format);
        } else if (season === 'upcoming') {
          result = await jikan.fetchNextSeason(page, perPage, format);
        } else {
          result = await jikan.fetchSeasonalAnime(season, Number(year), format, page, perPage);
        }

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from Jikan' });
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
}
