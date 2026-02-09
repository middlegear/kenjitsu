import 'dotenv/config';
import { FlixHQ } from 'kenjitsu-extensions';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyParams, FastifyQuery } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';

const baseUrl = process.env.FLIXHQURL || 'https://flixhq.to';
const flixhq = new FlixHQ(baseUrl);

export default async function FlixHQRoutes(fastify: FastifyInstance) {
  fastify.get('/home', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

    const cacheKey = `flix-home`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await flixhq.fetchHome();
      if (!result || typeof result !== 'object') {
        request.log.warn({ result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result.error) {
        request.log.error({ result }, `External API Error`);
        return reply.status(500).send(result);
      }

      if (result && Array.isArray(result.upcoming) && result.upcoming.length > 0) {
        await redisSetCache(cacheKey, result, 168);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/media/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

    const { q, page = 1 } = request.query;

    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const cacheKey = `flix-search-${q}-${page}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);

    try {
      const result = await flixhq.search(q, page);

      if (!result || typeof result !== 'object') {
        request.log.warn({ q, page, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        request.log.error({ result, q, page }, `External API Error: Failed to fetch search results.`);
        return reply.status(500).send(result);
      }
      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 168);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while querying search results`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });
  fastify.get('/media/lookup/title', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

    const { q, page = 1 } = request.query;

    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const cacheKey = `flix-lookup-${q}-${page}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);

    try {
      const result = await flixhq.search(q, page);

      if (!result || typeof result !== 'object') {
        request.log.warn({ q, page, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        request.log.error({ result, q, page }, `External API Error: Failed to fetch search results.`);
        return reply.status(500).send(result);
      }

      if (result && Array.isArray(result.data) && result.data.length > 0) {
        const exactMatches = result.data.filter((item: any) => (item.name || item.title)?.toLowerCase() === q.toLowerCase());

        request.log.info(`Found ${exactMatches.length} exact matches for "${q}" out of ${result.data.length} results`);

        if (exactMatches.length === 0) {
          request.log.warn(
            { available: result.data.slice(0, 5).map((r: any) => r.name || r.title) },
            `No exact match found for: ${q}`,
          );
        }

        const filteredResult = {
          ...result,
          data: exactMatches.length > 0 ? exactMatches : [],
        };

        if (exactMatches.length > 0) {
          await redisSetCache(cacheKey, filteredResult, 168);
        }

        return reply.status(200).send(filteredResult);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while querying search results`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/media/suggestions', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

    const q = request.query.q;

    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const cacheKey = `flix-suggestions-${q}}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);

    try {
      const result = await flixhq.searchSuggestions(q);
      if (!result || typeof result !== 'object') {
        request.log.warn({ q, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        request.log.error({ result, q }, `External API Error: Failed to fetch search results.`);
        return reply.status(500).send(result);
      }
      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 720);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while querying search results`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get(
    '/movies/category/:category',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const category = request.params.category as 'popular' | 'top-rated';
      const page = request.query.page || 1;

      const validCategories = ['popular', 'top-rated'] as const;
      if (!validCategories.includes(category)) {
        return reply.status(400).send({
          error: `Invalid category: '${category}'. Expected one of ${validCategories.join(', ')}.`,
        });
      }

      if (!category) {
        return reply.status(400).send({
          error: `Missing required path parameter: 'category'.`,
        });
      }

      const cacheKey = `flix-Movie-${category}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        let result;

        switch (category) {
          case 'popular':
            result = await flixhq.fetchPopularMovies(page);
            break;
          case 'top-rated':
            result = await flixhq.fetchTopMovies(page);
            break;
        }

        if (!result || typeof result !== 'object') {
          request.log.warn({ category, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 720);
        }

        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred.`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );
  fastify.get(
    '/tv/category/:category',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const category = request.params.category as 'popular' | 'top-rated';
      const page = request.query.page || 1;

      const validCategories = ['popular', 'top-rated'] as const;
      if (!validCategories.includes(category)) {
        return reply.status(400).send({
          error: `Invalid category: '${category}'. Expected one of ${validCategories.join(', ')}.`,
        });
      }

      if (!category) {
        return reply.status(400).send({
          error: `Missing required path parameter: 'category'.`,
        });
      }

      const cacheKey = `flix-tv-${category}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        let result;

        switch (category) {
          case 'popular':
            result = await flixhq.fetchPopularTv(page);
            break;
          case 'top-rated':
            result = await flixhq.fetchTopTv(page);
            break;
        }
        if (!result || typeof result !== 'object') {
          request.log.warn({ category, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }

        if (result.error) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 720);
        }

        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred.`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );
  fastify.get('/media/upcoming', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

    const page = request.query.page || 1;

    const cacheKey = `flix-upcoming-${page}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await flixhq.fetchUpcoming(page);

      if (!result || typeof result !== 'object') {
        request.log.warn({ page, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        request.log.error({ result }, `External API Error.`);
        return reply.status(500).send(result);
      }

      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 168);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred.`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get(
    '/media/filter',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

      const genre = request.query.genre || 'all';
      const country = request.query.country || 'all';
      const type = (request.query.type as 'movie' | 'tv' | 'all') || 'all';
      const quality = (request.query.quality as 'all' | 'HD' | 'SD' | 'CAM') || 'all';
      const page = request.query.page || 1;
      const year = request.query.year || 'all';

      const validTypes = ['movie', 'tv', 'all'] as const;
      if (!validTypes.includes(type)) {
        return reply.status(400).send({
          error: `Invalid type: '${type}'. Expected one of ${validTypes.join(', ')}.`,
        });
      }

      const validQualities = ['all', 'SD', 'HD', 'CAM'] as const;
      if (!validQualities.includes(quality)) {
        return reply.status(400).send({
          error: `Invalid quality: '${quality}'. Expected one of ${validQualities.join(', ')}.`,
        });
      }

      const cacheKey = `flix-advanced-search-${type}-${quality}-${genre}-${year}-${country}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await flixhq.advancedSearch(type, quality, genre, country, year, page);
        if (!result || typeof result !== 'object') {
          request.log.warn({ page, genre, country, type, quality, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 720);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred.`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/media/:id',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${72 * 60 * 60}, stale-while-revalidate=300`);

      const mediaId = request.params.id;

      if (!mediaId) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'mediaId'.",
        });
      }
      const cacheKey = `flix-media-info-${mediaId}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await flixhq.fetchMediaInfo(mediaId);
        if (!result || typeof result !== 'object') {
          request.log.warn({ mediaId, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }

        if (result && result.data !== null && Array.isArray(result.providerEpisodes) && result.providerEpisodes.length > 0) {
          let duration;
          result.data.type?.toLowerCase() === 'movie' ? (duration = 0) : (duration = 168);
          await redisSetCache(cacheKey, result, duration);
        }

        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred.`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/genres/:genre',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const genre = request.params.genre;
      const page = request.query.page || 1;

      if (!genre) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'genre'.",
        });
      }

      const cacheKey = `flix-genre-${genre}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await flixhq.fetchGenre(genre, page);
        if (!result || typeof result !== 'object') {
          request.log.warn({ page, genre, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 720);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred.`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/countries/:country',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const page = request.query.page || 1;
      const country = request.params.country;

      if (!country) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'country'.",
        });
      }
      const cacheKey = `flix-country-${country}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await flixhq.fetchByCountry(country, page);
        if (!result || typeof result !== 'object') {
          request.log.warn({ page, country, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 720);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred.`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/media/:episodeId/servers',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const episodeId = request.params.episodeId;
      if (!episodeId) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'episodeId'.",
        });
      }
      const cacheKey = `flix-servers-${episodeId}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }
      try {
        const result = await flixhq.fetchServers(episodeId);
        if (!result || typeof result !== 'object') {
          request.log.warn({ episodeId, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 720);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred.`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/sources/:episodeId',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=1200, stale-while-revalidate=300`);

      const episodeId = request.params.episodeId;
      const server = (request.query.server as 'vidcloud' | 'akcloud' | 'upcloud') || 'vidcloud';
      if (!episodeId) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'episodeId'.",
        });
      }
      const validServers = ['vidcloud', 'akcloud', 'upcloud'] as const;
      if (!validServers.includes(server)) {
        return reply.status(400).send({
          error: `Invalid streaming server selected: '${server}'. Pick one of these instead ${validServers.join(', ')}.`,
        });
      }

      try {
        const result = await flixhq.fetchSources(episodeId, server);
        if (!result || typeof result !== 'object') {
          request.log.warn({ episodeId, server, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred.`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );
}
