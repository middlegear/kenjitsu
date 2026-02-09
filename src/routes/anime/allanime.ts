import 'dotenv/config';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AllAnime } from 'kenjitsu-extensions';
import type { AllAnimeServers, FastifyParams, FastifyQuery } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';

const allanime = new AllAnime();

export default async function AllAnimeRoutes(fastify: FastifyInstance) {
  fastify.get('/anime/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);

    const q = request.query.q;

    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });
    const cacheKey = `allanime-search-${q}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);
    try {
      const result = await allanime.search(q);
      if (!result || typeof result !== 'object') {
        request.log.warn({ q, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result.error) {
        request.log.error({ error: result.error, query: q }, 'External API error');
        return reply.status(502).send({ error: result.error });
      }

      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 12);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while querying search results`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/anime/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

    const id = request.params.id;
    if (!id) {
      return reply.status(400).send({ error: 'Missing required path paramater: id' });
    }
    const cacheKey = `allanime-info-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);
    try {
      const result = await allanime.fetchAnimeInfo(id);
      if (!result || typeof result !== 'object') {
        request.log.warn({ id, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        request.log.error({ error: result.error, id }, `External API Error`);
        return reply.status(502).send({ error: result.error });
      }

      if (result && result.data && result.data !== null) {
        await redisSetCache(cacheKey, result, 24);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while fetching episodes`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/anime/:id/episodes', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

    const id = request.params.id;
    if (!id) {
      return reply.status(400).send({ error: 'Missing required path paramater: id' });
    }
    const cacheKey = `allanime-episodes-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);

    try {
      const result = await allanime.fetchEpisodes(id);
      if (!result || typeof result !== 'object') {
        request.log.warn({ id, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result.error) {
        request.log.error({ error: result.error, id }, `External API Error`);
        return reply.status(500).send({ error: result.error });
      }

      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 1);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while fetching episodes`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get(
    '/episode/:id/servers',
    async (request: FastifyRequest<{ Params: FastifyParams; Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);

      const id = request.params.id;
      const version = (request.query.version as 'sub' | 'dub' | 'raw') || 'sub';
      if (!id) {
        return reply.status(400).send({ error: 'Missing required path paramater: id' });
      }

      if (!['sub', 'dub', 'raw'].includes(version)) {
        return reply.status(400).send({
          error: `Invalid version picked: '${version}'. Expected one of 'sub','dub','raw'.`,
        });
      }
      const cacheKey = `allanime-servers-${id}-${version}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await allanime.fetchServers(id);
        if (!result || typeof result !== 'object') {
          request.log.warn({ id, version, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }

        if (result.error) {
          request.log.error({ error: result.error, id }, `External API Error`);
          return reply.status(500).send({ error: result.error });
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 12);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching episodes`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );
  fastify.get(
    '/sources/:episodeId',
    async (request: FastifyRequest<{ Params: FastifyParams; Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

      const episodeId = request.params.episodeId;
      const version = (request.query.version as 'sub' | 'dub' | 'raw') || 'sub';
      const allowedServers = [
        // 'okru', still busted for playback on exoplayer idk how vlc does this
        'internal-default-hls',
        'internal-ak',
        'internal-s-mp4',
        'internal-yt-mp4',
        'mp4upload',
      ] as const;
      const server = (request.query.server as AllAnimeServers) || 'internal-s-mp4';

      if (!episodeId) {
        return reply.status(400).send({
          error: `Missing required path paramater: 'episodeId'`,
        });
      }

      if (!allowedServers.includes(server)) {
        return reply.status(400).send({
          error: `Invalid server '${server}'. Expected one of: ${allowedServers.join(', ')}`,
        });
      }

      if (!['sub', 'dub', 'raw'].includes(version)) {
        return reply.status(400).send({
          error: `Invalid version picked: '${version}'. Expected one of 'sub','dub','raw'.`,
        });
      }
      const cacheKey = `allanime-sources-${episodeId}-${version}-${server}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);
      try {
        const result = await allanime.fetchSources(episodeId, server, version);
        if (!result || typeof result !== 'object') {
          request.log.warn({ episodeId, version, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if ('error' in result) {
          request.log.error({ result, episodeId, version }, `External API Error`);
          return reply.status(500).send(result);
        }
        if (result && result.data && Array.isArray(result.data.sources) && result.data.sources.length > 0) {
          await redisSetCache(cacheKey, result, 5);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching sources`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );
}
