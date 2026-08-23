import 'dotenv/config';
import { AniBD } from '@middlegear/kenjitsu-extensions';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyQuery, FastifyParams } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../config/redis.js';

const baseUrl = process.env.ANIBDURL || 'https://anibd.app';
const anibd = new AniBD(baseUrl);

export default async function AniBDRoutes(fastify: FastifyInstance) {
  fastify.get('/anime/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);
    const { q } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });
    const cacheKey = `anibd-search-${q}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);
    try {
      const result = await anibd.search(q);
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

  fastify.get('/anime/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);
    const id = request.params.id;
    if (!id) {
      return reply.status(400).send({
        error: `Missing required path paramater: 'id'`,
      });
    }

    const cacheKey = `anibd-info-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }
    try {
      const result = await anibd.fetchAnimeInfo(id);
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }
      if (
        result &&
        result.data !== null &&
        result.data.status &&
        Array.isArray(result.providerEpisodes) &&
        result.providerEpisodes.length > 0
      ) {
        await redisSetCache(cacheKey, result, 24);
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

    const cacheKey = `anibd-episodes-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }
    try {
      const result = await anibd.fetchEpisodes(Number(id));
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }
      if (result && result.data && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 6);
      }
      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send(error);
    }
  });

  fastify.get(
    '/sources/:episodeId',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);
      const episodeId = request.params.episodeId;
      if (!episodeId) {
        return reply.status(400).send({
          error: `Missing required path paramater: 'episodeId'`,
        });
      }
      const cacheKey = `anibd-sources-${episodeId}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }
      try {
        const result = await anibd.fetchSources(episodeId);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result.data && Array.isArray(result.data.sources) && result.data.sources.length > 0) {
          await redisSetCache(cacheKey, result, 12);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );
}
