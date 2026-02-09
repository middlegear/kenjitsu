import { AkiH } from 'kenjitsu-extensions';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';
import type { FastifyParams, FastifyQuery } from '../../utils/types.js';

const akih = new AkiH();

export default async function AkiHRoutes(fastify: FastifyInstance) {
  fastify.get('/home', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${4 * 60 * 60}, stale-while-revalidate=300`);

    const cacheKey = `akih-home`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }
    try {
      const result = await akih.fetchHomePage();
      if (!result || typeof result !== 'object') {
        request.log.warn({ result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if ('error' in result) {
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

  fastify.get('/hentai/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

    const q = request.query.q;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    const cacheKey = `akih-search-${q}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }
    try {
      const result = await akih.search(q);
      if (!result || typeof result !== 'object') {
        request.log.warn({ result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        request.log.error({ error: result.error, query: q }, 'External API error');
        return reply.status(502).send({ error: result.error });
      }

      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 168);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error.`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/hentai/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

    const id = request.params.id;
    if (!id) {
      return reply.status(400).send({ error: 'Missing required path paramater: id' });
    }
    const cacheKey = `akih-info-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }
    try {
      const result = await akih.fetchAnimeInfo(id);
      if (!result || typeof result !== 'object') {
        request.log.warn({ result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if ('error' in result) {
        request.log.error({ result }, `External API Error`);
        return reply.status(500).send(result);
      }

      if (result && Array.isArray(result.providerEpisodes) && result.providerEpisodes.length > 0) {
        await redisSetCache(cacheKey, result, 1);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error.`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/sources/:episodeId', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

    const episodeId = request.params.episodeId;
    if (!episodeId) {
      return reply.status(400).send({ error: 'Missing required path paramater: id' });
    }
    const cacheKey = `akih-sources-${episodeId}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }
    try {
      const result = await akih.fetchSources(episodeId);
      if (!result || typeof result !== 'object') {
        request.log.warn({ result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if ('error' in result) {
        request.log.error({ result }, `External API Error`);
        return reply.status(500).send(result);
      }

      if (result && Array.isArray(result.data?.sources) && result.data?.sources.length > 0) {
        await redisSetCache(cacheKey, result, 12);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error.`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });
}
