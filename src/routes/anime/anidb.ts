import 'dotenv/config';
import { AniDB } from '@middlegear/kenjitsu-extensions';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyQuery, FastifyParams } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../config/redis.js';

const baseUrl = process.env.ANIDBURL || 'https://anidb.app';
const anidb = new AniDB(baseUrl);

export default async function AniDBRoutes(fastify: FastifyInstance) {
  fastify.get('/anime/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${72 * 60 * 60}, stale-while-revalidate=300`);

    const { q } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const cacheKey = `anidb-search-${q}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);
    try {
      const result = await anidb.search(q);
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }

      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 72);
      }

      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send(error);
    }
  });

  fastify.get('/anime/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${48 * 60 * 60}, stale-while-revalidate=300`);

    const id = request.params.id;

    if (!id) {
      return reply.status(400).send({
        error: `Missing required path paramater: 'id'`,
      });
    }

    const cacheKey = `anidb-info-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await anidb.fetchAnimeInfo(id);
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result && result.data !== null) {
        await redisSetCache(cacheKey, result, 48);
      }
      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send(error);
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

    const cacheKey = `anidb-episodes-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await anidb.fetchEpisodes(id);

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }
      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 6);
      }
      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send(error);
    }
  });

  fastify.get(
    '/episode/:episodeId/servers',
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${0.5 * 60 * 60}, stale-while-revalidate=300`);

      const episodeId = request.params.episodeId;

      if (!episodeId) {
        return reply.status(400).send({
          error: `Missing required path paramater: 'episodeId'`,
        });
      }

      const cacheKey = `anidb-servers-${episodeId}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await anidb.fetchServers(episodeId);
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result && typeof result === 'object' && result.data?.episodeNumber !== 0) {
          await redisSetCache(cacheKey, result, 0.5);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/sources/:episodeId',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

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
      const cacheKey = `anidb-sources-${episodeId}-${version}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);
      try {
        const result = await anidb.fetchSources(episodeId, version);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && result.data && Array.isArray(result.data.sources) && result.data.sources.length > 0) {
          await redisSetCache(cacheKey, result, 6);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );
}
