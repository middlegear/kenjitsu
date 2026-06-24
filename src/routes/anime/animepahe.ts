import 'dotenv/config';
import { Animepahe } from 'kenjitsu-extensions';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyQuery, FastifyParams } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../config/redis.js';

const baseUrl = process.env.ANIMEPAHEURL || 'https://animepahe.pw';
const proxyUrl = process.env.CFPROXYURL;
const animepahe = new Animepahe(baseUrl, {
  ignoreTlsErrors: true,
  ...(proxyUrl && { cfProxyUrl: proxyUrl }),
});

export default async function AnimepaheRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/episodes/recent',
    {
      schema: {
        tags: ['Animepahe'],
        summary: 'Get Recent Episodes',
        description: 'Retrieve a paginated list of recently released anime episodes.',
        querystring: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              description: 'The page number for pagination.',
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
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
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 0.5);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/anime/search',
    {
      schema: {
        tags: ['Animepahe'],
        summary: 'Search Anime',
        description: 'Search for anime titles by query string.',
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: {
              type: 'string',
              description: 'The search query string.',
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);
      const { q } = request.query;
      if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
      if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });
      const cacheKey = `pahe-search-${q}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) return reply.status(200).send(cachedData);
      try {
        const result = await animepahe.search(q);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 2);
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
        tags: ['Animepahe'],
        summary: 'Get Anime Information',
        description: 'Fetches metadata and available episode listings for a specific anime by its ID.',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'The unique identifier of the anime.' },
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
      if (Number.isNaN(Number(id))) {
        return reply.status(418).send({
          error: 'Short and stout!',
          message: "I'm a teapot, and I can't process this request because 'id' is invalid.",
          hint: 'Fill me with a valid ID, not tea leaves. Anyways who are you?',
        });
      }
      const cacheKey = `animepahe-info-${id}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }
      try {
        const result = await animepahe.fetchAnimeInfo(id);
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (!result || typeof result !== 'object') {
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
          await redisSetCache(cacheKey, result, 4);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/anime/:id/episodes',
    {
      schema: {
        tags: ['Animepahe'],
        summary: 'Get Anime Episodes by ID',
        description: 'Retrieve a list of episodes belonging to a specific anime ID.',
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
      reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);
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
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 5);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/episode/:episodeId/servers',
    {
      schema: {
        tags: ['Animepahe'],
        summary: 'Get Episode Streaming and Download Servers',
        params: {
          type: 'object',
          required: ['episodeId'],
          properties: { episodeId: { type: 'string' } },
        },
      },
    },

    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${4 * 60 * 60}, stale-while-revalidate=300`);
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
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }
        if (result && typeof result === 'object' && result.data?.episodeNumber !== 0) {
          await redisSetCache(cacheKey, result, 6);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/sources/:episodeId',
    {
      schema: {
        tags: ['Animepahe'],
        summary: 'Get Episode Video Sources',
        description: 'Retrieve video streaming links and quality choices for a specific episode.',
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
        querystring: {
          type: 'object',
          properties: {
            version: {
              type: 'string',
              enum: ['sub', 'dub'],
              default: 'sub',
              description: 'The audio version.',
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);
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
