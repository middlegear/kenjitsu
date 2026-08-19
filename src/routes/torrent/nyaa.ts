import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Nyaa } from '@middlegear/kenjitsu-extensions';
import { type FastifyParams, type FastifyQuery } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../config/redis.js';

const baseUrl = process.env.NYAAURL || 'https://nyaa.si';
const nyaa = new Nyaa(baseUrl);

export default async function NyaaRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/anime/search',

    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

      const { q } = request.query;
      if (!q) return reply.status(400).send({ error: "Missing 'q' parameter" });
      if (q.length > 1000) return reply.status(400).send({ error: 'Query too long' });

      const cacheKey = `nyaa-search-${q}`;

      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await nyaa.search(q);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result?.data?.length > 0) {
          await redisSetCache(cacheKey, result, 168);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
  fastify.get(
    '/anime/:id',

    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

      const id = request.params.id;
      if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

      const cacheKey = `nyaa-infohash-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await nyaa.fetchInfoHashDetails(id);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result.data) {
          await redisSetCache(cacheKey, result, 2);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
