import 'dotenv/config';
import { Anikoto, type IAnimeCategory, type IMetaFormat } from 'kenjitsu-extensions';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type FastifyQuery, type FastifyParams, IAnimeCategoryArr } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';

const baseUrl = process.env.ANIKOTOURL || 'https://anikototv.to';
const anikoto = new Anikoto(baseUrl);

export default async function AnikotoRoutes(fastify: FastifyInstance) {
  fastify.get('/home', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);

    try {
      const result = await anikoto.fetchHome();
      if (!result || typeof result !== 'object') {
        request.log.warn({ result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        return reply.status(result.status as number).send(result);
      }

      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send({ error: error });
    }
  });
  fastify.get(
    '/anime/releasing',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);

      const page = request.query.page || 1;

      const cacheKey = `anikoto-releasing-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await anikoto.fetchReleasing(page);

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send(result);
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 6);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/anime/upcoming',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

      const page = request.query.page || 1;

      const cacheKey = `anikoto-upcoming-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await anikoto.fetchUpcoming(page);

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send(result);
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 168);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/anime/recent/:status',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

      const page = request.query.page || 1;
      const status = request.params.status as 'completed' | 'added' | 'updated';

      if (status !== 'completed' && status !== 'added' && status !== 'updated') {
        return reply
          .status(400)
          .send({ error: `Invalid path parameter status: '${status}'. Expected ''completed' , 'added' or 'updated'.` });
      }
      const cacheKey = `anikoto-recent-${status}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        let result;
        switch (status) {
          case 'completed':
            result = await anikoto.fetchRecentlyCompleted(page);
            break;
          case 'added':
            result = await anikoto.fetchRecentlyAdded(page);
            break;
          case 'updated':
            result = await anikoto.fetchRecentlyUpdated(page);
            break;
          default:
            return reply
              .status(400)
              .send({ error: `Invalid path parameter status: '${status}'. Expected ''completed' , 'added' or 'updated'.` });
        }
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send(result);
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 1);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/anime/format/:format',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      const format = request.params.format as IAnimeCategory;

      if (!IAnimeCategoryArr.includes(format)) {
        return reply.status(400).send({
          error: `Invalid format: '${format}'. Expected one of ${IAnimeCategoryArr.join(', ')}.`,
        });
      }
      if (!format) {
        return reply.status(400).send({ error: 'Missing required path paramater: format' });
      }
      const cacheKey = `anikoto-format-${format}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await anikoto.fetchAnimeCategory(format, page);
        if (!result || typeof result !== 'object') {
          request.log.warn({ format, page, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send(result);
        }

        if (result.data && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 48);
        }

        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/anime/genre/:genre',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      const genre = request.params.genre;

      if (!genre) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'genre'.",
        });
      }

      const cacheKey = `anikoto-genre-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await anikoto.fetchGenre(genre, page);
        if (!result || typeof result !== 'object') {
          request.log.warn({ genre, page, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send(result);
        }
        if (result.data && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 168);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
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

      const cacheKey = `anikoto-sort-${sort}-${page}`;

      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await anikoto.fetchAtoZList(sort, page);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 168);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );
  fastify.get('/anime/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

    const { q, page = 1 } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const cacheKey = `anikoto-search-${q}-${page}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);

    try {
      const result = await anikoto.search(q, page);
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }
      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 168);
      }
      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send(error);
    }
  });
  fastify.get('/anime/suggestions', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

    const { q } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const cacheKey = `anikoto-search-suggestions-${q}}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);

    try {
      const result = await anikoto.searchSuggestions(q);
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }
      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 168);
      }
      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send(error);
    }
  });

  fastify.get('/anime/schedule', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

    const { timezone } = request.query;
    if (!timezone) {
      return reply.status(400).send({ error: "Missing required query param: 'timezone'" });
    }
    const offset = Number(timezone);

    if (isNaN(offset)) {
      return reply.status(400).send({ error: 'Timezone must be a valid number (e.g., 3 or -10)' });
    }
    if (offset < -12 || offset > 14) {
      return reply.status(400).send({ error: 'Timezone must be between -12 and +14' });
    }

    const cacheKey = `anikoto-schedule-${timezone}}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);

    try {
      const result = await anikoto.fetchSchedule(offset);
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }
      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 24);
      }
      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send(error);
    }
  });

  fastify.get('/anime/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${2 * 60 * 60}, stale-while-revalidate=300`);

    const id = request.params.id;

    if (!id) {
      return reply.status(400).send({
        error: `Missing required path paramater: 'id'`,
      });
    }
    const cacheKey = `anikoto-animeinfo-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }
    try {
      const result = await anikoto.fetchAnimeInfo(id);
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (
        result.data !== null &&
        Array.isArray(result.providerEpisodes) &&
        result.providerEpisodes.length > 0 &&
        result.data.status.toLowerCase() === 'finished airing'
      ) {
        await redisSetCache(cacheKey, result, 24);
      }
      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send(error);
    }
  });

  fastify.get(
    '/episode/:episodeId/servers',
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${2 * 60 * 60}, stale-while-revalidate=300`);

      const episodeId = request.params.episodeId;

      if (!episodeId) {
        return reply.status(400).send({
          error: `Missing required path paramater: 'episodeId'`,
        });
      }
      const cacheKey = `anikoto-servers-${episodeId}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);
      try {
        const result = await anikoto.fetchServers(episodeId);
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && typeof result === 'object' && result.data !== null) {
          await redisSetCache(cacheKey, result, 2);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/sources/:episodeId',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${0.2 * 60 * 60}, stale-while-revalidate=300`);

      const episodeId = request.params.episodeId;
      const version = (request.query.version as 'sub' | 'dub') || 'sub';
      const server = (request.query.server as 'vidstream-2' | 'vidcloud-1') || 'vidstream-2';
      if (!['sub', 'dub'].includes(version)) {
        return reply.status(400).send({
          error: `Invalid version picked: '${version}'. Expected one of 'sub','dub'.`,
        });
      }
      if (!episodeId) {
        return reply.status(400).send({
          error: `Missing required path paramater: 'episodeId'`,
        });
      }
      const cacheKey = `anikoto-sources-${episodeId}-${version}-${server}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await anikoto.fetchSources(episodeId, version, server);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && result.data && Array.isArray(result.data.sources) && result.data.sources.length > 0) {
          await redisSetCache(cacheKey, result, 0.2);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );
}
