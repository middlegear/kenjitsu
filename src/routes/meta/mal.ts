import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MyAnimeList } from '@middlegear/kenjitsu-extensions';
import { type FastifyParams, type FastifyQuery } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../config/redis.js';

const mal = new MyAnimeList();

export default async function MyAnimeListRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/anime/search',

    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

      const { q } = request.query;
      if (!q) return reply.status(400).send({ error: "Missing 'q' parameter" });
      if (q.length > 1000) return reply.status(400).send({ error: 'Query too long' });

      const cacheKey = `mal-search-${q}`;

      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await mal.search(q);
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

      const id = Number(request.params.id);
      if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

      const cacheKey = `mal-info-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await mal.fetchInfo(id);
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

  fastify.get(
    '/anime/:id/episodes',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

      const id = Number(request.params.id);
      if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

      const cacheKey = `mal-episodes-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);

      try {
        const result = await mal.fetchEpisodes(id);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result?.data?.length > 0) {
          await redisSetCache(cacheKey, result, 2);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
