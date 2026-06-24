import { TheMovieDatabase } from 'kenjitsu-extensions';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { type FastifyParams, type FastifyQuery } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../config/redis.js';

const tmdb = new TheMovieDatabase();

export default async function TheMovieDatabaseRoutes(fastify: FastifyInstance) {
  fastify.get('/movies/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

    const { q, page = 1 } = request.query;

    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const cacheKey = `tmdb-search-movie-${q}-${page}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);

    try {
      const result = await tmdb.searchMovie(q, page);
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
      }
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }
      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 168);
      }
      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get(
    '/tv/search',

    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);
      const { q, page = 1 } = request.query;

      if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
      if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

      const cacheKey = `tmdb-search-tv-${q}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await tmdb.searchShows(q, page);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 168);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/movies/category/:category',

    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const page = request.query.page || 1;
      const category = request.params.category as 'popular' | 'top';

      if (!category) {
        return reply.status(400).send({ error: `Missing required path parameter: 'category'.` });
      }
      if (category !== 'popular' && category !== 'top') {
        return reply.status(400).send({ error: `Invalid category: '${category}'. Expected 'popular' or 'top'` });
      }

      const cacheKey = `tmdb-${category}-movie-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        let result;
        switch (category) {
          case 'popular':
            result = await tmdb.fetchPopularMovies(page);
            break;
          case 'top':
            result = await tmdb.fetchTopMovies(page);
            break;
        }
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 720);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/tv/category/:category',

    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const page = request.query.page || 1;
      const category = request.params.category as 'popular' | 'top';

      if (!category) {
        return reply.status(400).send({ error: `Missing required path parameter: 'category'.` });
      }
      if (category !== 'popular' && category !== 'top') {
        return reply.status(400).send({ error: `Invalid category: '${category}'. Expected 'popular' or 'top'` });
      }

      const cacheKey = `tmdb-${category}-tv-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        let result;
        switch (category) {
          case 'popular':
            result = await tmdb.fetchPopularTv(page);
            break;
          case 'top':
            result = await tmdb.fetchTopShows(page);
            break;
        }
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 720);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/movies/:id',

    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

      const { id } = request.params;
      if (!id) return reply.status(400).send({ error: 'Missing required path parameter: id' });

      const cacheKey = `tmdb-media-info-movie-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await tmdb.fetchMovieInfo(Number(id));
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result.data) {
          await redisSetCache(cacheKey, result, 168);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/tv/:id',

    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const id = request.params.id;
      if (!id) return reply.status(400).send({ error: 'Missing required path parameter: id' });

      const cacheKey = `tmdb-media-info-tv-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await tmdb.fetchShowInfo(Number(id));
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && result.data !== null) {
          await redisSetCache(cacheKey, result, 24);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/movies/trending',

    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const page = request.query.page || 1;
      const timeWindow = request.query.timeWindow || 'week';

      if (timeWindow !== 'week' && timeWindow !== 'day') {
        return reply.status(400).send({ error: `Invalid timeWindow: '${timeWindow}'. Expected 'day' or 'week'` });
      }
      const duration = timeWindow === 'week' ? 168 : 24;
      const cacheKey = `tmdb-trending-movie-${page}`;

      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await tmdb.fetchTrendingMovies(timeWindow, page);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, duration);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/tv/trending',

    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const page = request.query.page || 1;
      const timeWindow = request.query.timeWindow || 'week';

      if (timeWindow !== 'week' && timeWindow !== 'day') {
        return reply.status(400).send({ error: `Invalid timeWindow: '${timeWindow}'. Expected 'day' or 'week'` });
      }
      const duration = timeWindow === 'week' ? 168 : 24;
      const cacheKey = `tmdb-trending-tv-${page}`;

      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await tmdb.fetchTrendingTv(timeWindow, page);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, duration);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/tv/:id/seasons/:season',

    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

      const id = request.params.id;
      const season = request.params.season;

      if (!id) return reply.status(400).send({ error: 'Missing required path parameter: id' });
      if (!season) return reply.status(400).send({ error: 'Missing required path parameter: season' });

      const cacheKey = `tmdb-episodes-tv-${id}-${season}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await tmdb.fetchTvEpisodes(Number(id), Number(season));
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 24);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/tv/:id/seasons/:season/episodes/:episode',

    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const id = request.params.id;
      const season = request.params.season;
      const episode = request.params.episode;

      if (!id) return reply.status(400).send({ error: 'Missing required path parameter: id' });
      if (!season) return reply.status(400).send({ error: 'Missing required path parameter: season' });
      if (!episode) return reply.status(400).send({ error: 'Missing required path parameter: episode' });

      const cacheKey = `tmdb-episode-${id}-${season}-${episode}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await tmdb.fetchEpisodeInfo(Number(id), Number(season), Number(episode));
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && result.data !== null) {
          await redisSetCache(cacheKey, result, 720);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/anime/category/:category',

    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const page = request.query.page || 1;
      const category = request.params.category as 'popular' | 'top' | 'seasonal' | 'weekly';

      if (!category) {
        return reply.status(400).send({ error: `Missing required path parameter: 'category'.` });
      }
      if (!['popular', 'top', 'seasonal', 'weekly'].includes(category)) {
        return reply
          .status(400)
          .send({ error: `Invalid category: '${category}'. Expected 'popular', 'top', 'seasonal' or 'weekly'` });
      }

      const cacheKey = `tmdb-${category}-anime-tv-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        let result;
        switch (category) {
          case 'popular':
            result = await tmdb.fetchPopularAnime(page);
            break;
          case 'top':
            result = await tmdb.fetchTopAnime(page);
            break;
          case 'seasonal':
            result = await tmdb.fetchSeasonalAnime(page);
            break;
          case 'weekly':
            result = await tmdb.fetchWeeklyAnime(page);
            break;
        }

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 24);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/artworks/:category/:id',

    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const category = request.params.category as 'movie' | 'tv';
      const id = request.params.id;

      if (!id) return reply.status(400).send({ error: 'Missing required path parameter: id' });
      if (!category) return reply.status(400).send({ error: `Missing required path parameter: 'category'.` });
      if (category !== 'movie' && category !== 'tv') {
        return reply.status(400).send({ error: `Invalid category: '${category}'. Expected 'movie' or 'tv'` });
      }

      const cacheKey = `tmdb-${category}-artworks-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        let result;
        switch (category) {
          case 'tv':
            result = await tmdb.fetchShowArtWorks(Number(id));
            break;
          case 'movie':
            result = await tmdb.fetchMovieArtWorks(Number(id));
            break;
        }

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && result.data) {
          await redisSetCache(cacheKey, result, 720);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );
}
