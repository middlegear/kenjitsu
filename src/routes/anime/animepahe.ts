import 'dotenv/config';
import { Animepahe } from 'kenjitsu-extensions';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyQuery, FastifyParams } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';

const baseUrl = process.env.ANIMEPAHEURL || 'https://animepahe.si';
const animepahe = new Animepahe(baseUrl);

export default async function AnimepaheRoutes(fastify: FastifyInstance) {
  fastify.get('/anime/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);

    const { q } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const cacheKey = `pahe-search-${q}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);
    try {
      const result = await animepahe.search(q);
      if (!result || typeof result !== 'object') {
        request.log.warn({ q, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if ('error' in result) {
        request.log.error({ result, q }, `External API Error: Failed to fetch search results for query:${q}`);
        return reply.status(500).send(result);
      }

      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 12);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while querying search results`);
      return reply.status(500).send({ error: `Internal server error occurred:${error}` });
    }
  });

  fastify.get('/episodes/recent', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

    const page = request.query.page || 1;

    const cacheKey = `pahe-episodes-recent-${page}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await animepahe.fetchRecentEpisodes(page);
      if (!result || typeof result !== 'object') {
        request.log.warn({ page, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if ('error' in result) {
        request.log.error({ result, page }, `External API Error: Failed to fetch recent episodes results`);
        return reply.status(500).send(result);
      }

      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 1);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while fetching recent episodes`);
      return reply.status(500).send({ error: `Internal server occurred:${error}` });
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
    let duration;
    const cacheKey = `animepahe-info-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await animepahe.fetchAnimeInfo(id);
      if ('error' in result) {
        request.log.error({ result, id }, `External API Error: Failed to fetch anime info`);
        return reply.status(500).send(result);
      }

      if (!result || typeof result !== 'object') {
        request.log.warn({ id, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (
        result &&
        result.data !== null &&
        result.data.status &&
        Array.isArray(result.providerEpisodes) &&
        result.providerEpisodes.length > 0
      ) {
        result.data.status.toLowerCase() === 'finished airing' ? (duration = 0) : (duration = 2);
        await redisSetCache(cacheKey, result, duration);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while fetching anime info`);
      return reply.status(500).send({ error: `Internal server occurred:${error}` });
    }
  });

  fastify.get('/anime/:id/episodes', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);

    const id = request.params.id;

    if (!id) {
      return reply.status(400).send({
        error: `Missing required path paramater: 'id'`,
      });
    }

    const cacheKey = `pahe-episodes-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await animepahe.fetchEpisodes(id);

      if (!result || typeof result !== 'object') {
        request.log.warn({ id, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if ('error' in result) {
        request.log.error({ result, id }, `External API Error: Failed to fetch episodes`);
        return reply.status(500).send(result);
      }
      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 12);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while fetching episodes`);
      return reply.status(500).send({ error: `Internal server occurred:${error}` });
    }
  });

  fastify.get(
    '/episode/:episodeId/servers',
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

      const episodeId = request.params.episodeId;

      if (!episodeId) {
        return reply.status(400).send({
          error: `Missing required path paramater: 'episodeId'`,
        });
      }

      const cacheKey = `pahe-servers-${episodeId}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await animepahe.fetchServers(episodeId);
        if ('error' in result) {
          request.log.error({ result, episodeId }, `External API Error: Failed to fetch servers`);
          return reply.status(500).send(result);
        }

        if (!result || typeof result !== 'object') {
          request.log.warn({ episodeId, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }

        if (result && typeof result === 'object' && result.data !== null) {
          await redisSetCache(cacheKey, result, 12);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching streaming server info`);
        return reply.status(500).send({ error: `Internal server occurred:${error}` });
      }
    },
  );

  fastify.get(
    '/sources/:episodeId',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${48 * 60 * 60}, stale-while-revalidate=300`);

      const episodeId = request.params.episodeId;

      const version = (request.query.version as 'sub' | 'dub') || 'sub';

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
      const cacheKey = `animepahe-sources-${episodeId}-${version}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);
      try {
        const result = await animepahe.fetchSources(episodeId, version);
        if (!result || typeof result !== 'object') {
          request.log.warn({ episodeId, version, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if ('error' in result) {
          request.log.error({ result, episodeId, version }, `External API Error: Failed to fetch sources`);
          return reply.status(500).send(result);
        }
        if (result && result.data && Array.isArray(result.data.sources) && result.data.sources.length > 0) {
          await redisSetCache(cacheKey, result, 48);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching sources`);
        return reply.status(500).send({ error: `Internal server occurred:${error}` });
      }
    },
  );
}
