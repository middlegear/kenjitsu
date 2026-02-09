import 'dotenv/config';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { HiAnime, type HIGenre, type IAnimeCategory } from 'kenjitsu-extensions';
import { IAnimeCategoryArr, type FastifyParams, type FastifyQuery } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';
import { splitEpisodes } from '../../utils/cache.js';

const baseUrl = process.env.HIANIMEURL || 'https://hianime.to';
const zoro = new HiAnime(baseUrl);

export default async function hianimeRoutes(fastify: FastifyInstance) {
  fastify.get('/home', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${4 * 60 * 60}, stale-while-revalidate=300`);

    const cacheKey = `hianime-home`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await zoro.fetchHome();
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

      if (result && result.data.length > 0 && result.mostPopular.length > 0) {
        await redisSetCache(cacheKey, result, 4);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error.`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/anime/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);

    const { q, page = 1 } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const cacheKey = `zoro-search-${q}-${page}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);
    try {
      const result = await zoro.search(q, page);

      if (!result || typeof result !== 'object') {
        request.log.warn({ q, page, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        request.log.error({ result, q, page }, `External API Error.`);
        return reply.status(500).send(result);
      }
      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 12);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred.`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/anime/suggestions', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

    const { q } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const cacheKey = `zoro-suggestions-${q}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);
    try {
      const result = await zoro.searchSuggestions(q);

      if (result.error) {
        request.log.error({ result, q }, `External API Error`);
        return reply.status(500).send(result);
      }
      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 12);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred.`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/anime/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

    const id = request.params.id;

    if (!id) {
      return reply.status(400).send({ error: 'Missing required path parameter: id' });
    }

    let duration;
    const cacheKey = `zoro-info-${id}`;
    const cachedData = await redisGetCache(cacheKey);

    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await zoro.fetchAnimeInfo(id);
      if (!result || typeof result !== 'object') {
        request.log.warn({ id, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        request.log.error({ result, id }, `External API Error `);
        return reply.status(500).send(result);
      }
      if (
        result &&
        result.data !== null &&
        result.providerEpisodes.length > 0 &&
        result.data.type?.toLowerCase() !== 'movie'
      ) {
        const { sub, dub } = splitEpisodes(result.providerEpisodes);
        const status = (result.data.status ?? '').toLowerCase();

        let duration: number;

        if (status === 'finished airing') {
          const subMatchesDub = sub.length > 0 && sub.length === dub.length && sub.every((n, i) => n === dub[i]);
          const dubMatchesSub = dub.length > 0 && dub.length === sub.length && dub.every((n, i) => n === sub[i]);

          const onlySub = sub.length > 0 && dub.length === 0;
          const onlyDub = dub.length > 0 && sub.length === 0;

          const fullySynced = subMatchesDub || dubMatchesSub;
          const hasOnlyOneLang = onlySub || onlyDub;

          if (fullySynced || hasOnlyOneLang) {
            duration = 0;
          } else {
            duration = 168;
          }
        } else {
          duration = 1;
        }

        await redisSetCache(cacheKey, result, duration);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error `);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get(
    '/anime/category/:category',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      const category = request.params.category as 'subbed' | 'dubbed' | 'favourites' | 'popular' | 'airing';

      if (!category) {
        return reply.status(400).send({
          error: `Missing required path parameter. Expected 'category' as (subbed/dubbed/popular/favourites/airing).`,
        });
      }

      const cacheKey = `hianime-${category}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        let result;
        switch (category) {
          case 'subbed':
            result = await zoro.fetchSubbedAnime(page);
            break;

          case 'dubbed':
            result = await zoro.fetchDubbedAnime(page);
            break;

          case 'favourites':
            result = await zoro.fetchMostFavourites(page);
            break;

          case 'popular':
            result = await zoro.fetchMostPopular(page);
            break;

          case 'airing':
            result = await zoro.fetchTopAiring(page);
            break;
        }
        if (!result || typeof result !== 'object') {
          request.log.warn({ category, page, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result, page, category }, `External API Error`);
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          let duration;
          category === 'airing' ? (duration = 12) : (duration = 168);

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
    '/anime/recent/:status',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${0.5 * 60 * 60}, stale-while-revalidate=300`);

      const status = request.params.status as 'completed' | 'added' | 'updated';
      const page = Number(request.query.page);

      if (!status) {
        return reply.status(400).send({ error: `Missing required path parameter: status` });
      }
      if (status !== 'completed' && status !== 'added' && status !== 'updated') {
        return reply
          .status(400)
          .send({ error: `Invalid status: '${status}'. Expected ''completed' , 'added' or 'updated'.` });
      }

      const cacheKey = `hianime-recent-${status}-{-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        let result;
        switch (status) {
          case 'completed':
            result = await zoro.fetchRecentlyCompleted(page);
            break;

          case 'added':
            result = await zoro.fetchRecentlyAdded(page);
            break;

          case 'updated':
            result = await zoro.fetchRecentlyAdded(page);
            break;
        }
        if (!result || typeof result !== 'object') {
          request.log.warn({ status, page, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result, page, status }, `External API Error: Failed to fetch recent anime`);
          return reply.status(500).send(result);
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 1);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching recent anime`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/anime/az-list/:sort',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      const sort = request.params.sort;

      if (!sort) {
        return reply.status(400).send({ error: `Missing required path parameter: sort` });
      }

      const cacheKey = `zoro-sort-${sort}-${page}`;

      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await zoro.fetchAtoZList(sort, page);
        if (!result || typeof result !== 'object') {
          request.log.warn({ sort, page, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result, sort, page }, `External API Error`);
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 168);
        }

        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/anime/format/:format',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      const format = request.params.format as IAnimeCategory;

      if (!format) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'format'.",
        });
      }
      if (!IAnimeCategoryArr.includes(format)) {
        return reply.status(400).send({
          error: `Invalid format: '${format}'. Expected one of ${IAnimeCategoryArr.join(', ')}.`,
        });
      }

      const cacheKey = `hianime-format-${format}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await zoro.fetchAnimeCategory(format, page);
        if (!result || typeof result !== 'object') {
          request.log.warn({ format, page, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }

        if (result.error) {
          request.log.error({ result, page, format }, `External API Error`);
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 168);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/anime/genre/:genre',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${48 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      const genre = request.params.genre as HIGenre;
      if (!genre) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'genre'.",
        });
      }

      const cacheKey = `zoro-genre-${genre}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await zoro.fetchGenre(genre, page);
        if (!result || typeof result !== 'object') {
          request.log.warn({ genre, page, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result, page, genre }, `External API Error: Failed to fetch genre list`);
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 168);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching genre list`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get('/anime/:id/episodes', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

    const id = String(request.params.id);

    const cacheKey = `zoro-episodes-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    if (!id) {
      return reply.status(400).send({
        error: "Missing required path parameter: 'id'.",
      });
    }

    try {
      const result = await zoro.fetchEpisodes(id);
      if (!result || typeof result !== 'object') {
        request.log.warn({ id, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        request.log.error({ result, id }, `External API Error: Failed to fetch episode list`);
        return reply.status(500).send(result);
      }

      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 1);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while fetching episode list`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get(
    '/episode/:episodeId/servers',
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

      const episodeId = String(request.params.episodeId);
      if (!episodeId) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'episodeId'.",
        });
      }
      const cacheKey = `hianime-servers-${episodeId}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await zoro.fetchServers(episodeId);
        if (!result || typeof result !== 'object') {
          request.log.warn({ episodeId, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result, episodeId }, `External API Error: Failed to fetch server list`);
          return reply.status(500).send(result);
        }

        if (result && typeof result === 'object' && result.data !== null) {
          await redisSetCache(cacheKey, result, 1);
        }

        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching server list`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/sources/:episodeId',
    async (request: FastifyRequest<{ Params: FastifyParams; Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${2 * 60 * 60}, stale-while-revalidate=300`);

      const episodeId = String(request.params.episodeId);
      const version = (request.query.version as 'sub' | 'dub' | 'raw') || 'sub';
      const server = (request.query.server as 'hd-1' | 'hd-2') || 'hd-2'; /// removed hd-3 cant support playback

      if (!episodeId) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'episodeId'.",
        });
      }
      if (!['sub', 'dub', 'raw'].includes(version)) {
        return reply.status(400).send({
          error: `Invalid version picked: '${version}'. Expected one of 'sub','dub','raw'.`,
        });
      }
      if (!['hd-1', 'hd-2'].includes(server)) {
        return reply.status(400).send({
          error: `Invalid  streaming server selected: '${server}'. Expected one of 'hd-1', 'hd-2'.`,
        });
      }
      const cacheKey = `hianime-sources-${episodeId}-${version}-${server}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);
      try {
        const result = await zoro.fetchSources(episodeId, server, version);
        if (!result || typeof result !== 'object') {
          request.log.warn({ episodeId, version, server, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result, episodeId, server, version }, `External API Error: Failed to fetch sources`);
          return reply.status(500).send(result);
        }
        if (result && result.data && Array.isArray(result.data.sources) && result.data.sources.length > 0) {
          await redisSetCache(cacheKey, result, 2);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching sources`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );
}
