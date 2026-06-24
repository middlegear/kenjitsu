import 'dotenv/config';
import { Anizone } from 'kenjitsu-extensions';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyQuery, FastifyParams } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../config/redis.js';

const baseUrl = process.env.ANIZONEURL || 'https://anizone.to';
const anizone = new Anizone(baseUrl);

export default async function AnizoneRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/anime/search',
    {
      schema: {
        tags: ['Anizone'],
        summary: 'Search anime',
        description: 'Search anime by title using Anizone.',
        querystring: {
          type: 'object',
          properties: {
            q: {
              type: 'string',
              description: 'Anime title to search for',
            },
          },
          required: ['q'],
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);
      const { q } = request.query;
      if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
      if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });
      const cacheKey = `anizone-search-${q}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);
      try {
        const result = await anizone.search(q);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 12);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/anime/recent',
    {
      schema: {
        tags: ['Anizone'],
        summary: 'Recent Updates',
        description: 'Retrieve recently aired episodes and newly added anime.',
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);
      const cacheKey = `anizone-updates`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);
      try {
        const result = await anizone.fetchUpdates();
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
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
    '/anime/:id',
    {
      schema: {
        tags: ['Anizone'],
        summary: 'Get Anime Information',
        description: 'Fetches metadata and episode listings for a specific anime.',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              description: 'The unique identifier of the anime.',
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${2 * 60 * 60}, stale-while-revalidate=300`);
      const id = request.params.id;
      if (!id) {
        return reply.status(400).send({
          error: `Missing required path paramater: 'id'`,
        });
      }
      let duration;
      const cacheKey = `anizone-info-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }
      try {
        const result = await anizone.fetchAnimeInfo(id);
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
          result.data.status.toLowerCase() === 'completed' && result.providerEpisodes.length === result.data.totalEpisodes
            ? (duration = 0)
            : (duration = 1);
          await redisSetCache(cacheKey, result, duration);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/sources/:episodeId',
    {
      schema: {
        tags: ['Anizone'],
        summary: 'Get episode sources',
        description: 'Retrieve media sources, subtitles and headers for an episode.',
        params: {
          type: 'object',
          required: ['episodeId'],
          properties: {
            episodeId: {
              type: 'string',
              description: 'The unique identifier of the episode.',
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);
      const episodeId = request.params.episodeId;
      if (!episodeId) {
        return reply.status(400).send({
          error: `Missing required path paramater: 'episodeId'`,
        });
      }
      const cacheKey = `anizone-sources-${episodeId}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }
      try {
        const result = await anizone.fetchSources(episodeId);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result.data && Array.isArray(result.data.sources) && result.data.sources.length > 0) {
          redisSetCache(cacheKey, result, 12);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );
}
