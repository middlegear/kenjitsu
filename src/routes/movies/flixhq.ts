import { FlixHQ, type IMovieGenre, type IMovieCountry } from '@middlegear/kenjitsu-extensions';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyParams, FastifyQuery } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';

const flixhq = new FlixHQ();

export default async function FlixHQRoutes(fastify: FastifyInstance) {
  fastify.get('/home', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

    const cacheKey = `flix-home`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await flixhq.fetchHome();

      if ('error' in result) {
        request.log.error({ result }, `External API Error`);
        return reply.status(500).send(result);
      }

      if (result && Array.isArray(result.upcoming) && result.upcoming.length > 0) {
        await redisSetCache(cacheKey, result, 48);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  // Search media
  fastify.get('/media/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

    const { q, page = 1 } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    try {
      const result = await flixhq.search(q, page);

      if ('error' in result) {
        request.log.error({ result, q, page }, `External API Error: Failed to fetch search results.`);
        return reply.status(500).send(result);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while querying search results`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  // Get search suggestions
  fastify.get('/media/suggestions', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

    const q = request.query.q;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });
    try {
      const result = await flixhq.searchSuggestions(q);

      if ('error' in result) {
        request.log.error({ result, q }, `External API Error: Failed to fetch search results.`);
        return reply.status(500).send(result);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while querying search results`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  // Get movies (popular, top-rated)
  fastify.get(
    '/movies/category/:category',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const category = request.params.category as 'popular' | 'top-rated';
      const page = request.query.page || 1;

      const validCategories = ['popular', 'top-rated'] as const;
      if (!validCategories.includes(category)) {
        return reply.status(400).send({
          error: `Invalid sort: '${category}'. Expected one of ${validCategories.join(', ')}.`,
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

        if ('error' in result) {
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
    },
  );
  fastify.get(
    '/tv/category/:category',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const category = request.params.category as 'popular' | 'top-rated';
      const page = request.query.page || 1;

      const validCategories = ['popular', 'top-rated'] as const;
      if (!validCategories.includes(category)) {
        return reply.status(400).send({
          error: `Invalid sort: '${category}'. Expected one of ${validCategories.join(', ')}.`,
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

        if ('error' in result) {
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
    },
  );
  fastify.get('/media/upcoming', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

    const page = request.query.page || 1;

    const cacheKey = `flix-upcoming-${page}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await flixhq.fetchUpcoming(page);

      if ('error' in result) {
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
      reply.header('Cache-Control', `s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

      const genre = request.query.genre as IMovieGenre | 'all' | undefined;
      const country = request.query.country as IMovieCountry | undefined;
      const type = (request.query.type as 'movie' | 'tv' | 'all') || 'all';
      const quality = (request.query.quality as 'all' | 'HD' | 'SD' | 'CAM') || 'all';
      const page = Number(request.query.page) || 1;

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

      const selectedCountry = country || 'all';

      const cacheKey = `flix-advanced-search-${type}-${quality}-${genre}-${selectedCountry}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await flixhq.advancedSearch(type, quality, genre, selectedCountry, page);

        if ('error' in result) {
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

  // Get media details
  fastify.get(
    '/media/:id',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `s-maxage=${72 * 60 * 60}, stale-while-revalidate=300`);

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

        if ('error' in result) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }

        if (result && result.data !== null && Array.isArray(result.providerEpisodes) && result.providerEpisodes.length > 1) {
          await redisSetCache(cacheKey, result, 168);
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
      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const genre = request.params.genre as IMovieGenre | undefined;
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

        if ('error' in result) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 336);
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
      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const page = request.query.page || 1;
      const country = request.params.country as IMovieCountry;

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

        if ('error' in result) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 336);
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
      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

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

        if ('error' in result) {
          request.log.error({ result }, `External API Error.`);
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 148);
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
      reply.header('Cache-Control', `s-maxage=1200, stale-while-revalidate=300`);

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
          error: `Invalid streaming server selected: '${server}'. Pick one of these instead ${validServers.join(', ')}. You are gay if you can't read the docs`,
        });
      }

      try {
        const result = await flixhq.fetchSources(episodeId, server);

        if ('error' in result) {
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
