import 'dotenv/config';
import { Anikoto, type IAnimeCategory, type IMetaFormat } from 'kenjitsu-extensions';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type FastifyQuery, type FastifyParams, IAMetaFormatArr, IAnimeCategoryArr } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../config/redis.js';

const baseUrl = process.env.ANIKOTOURL || 'https://anikototv.to';
const anikoto = new Anikoto(baseUrl);

export default async function AnikotoRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/anime/home',
    {
      schema: {
        tags: ['Anikoto'],
        summary: 'Get homepage data',
        description: 'Fetch Anikoto homepage sections and anime lists.',
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
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
        return reply.status(500).send({
          error: error,
        });
      }
    },
  );

  fastify.get(
    '/anime/releasing',
    {
      schema: {
        tags: ['Anikoto'],
        summary: 'Get currently releasing anime',
        description: 'Retrieve a paginated list of ongoing anime.',
        querystring: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              default: 1,
              description: 'The page number for pagination.',
            },
          },
        },
      },
    },
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
    {
      schema: {
        tags: ['Anikoto'],
        summary: 'Get upcoming anime',
        description: 'Retrieve a paginated list of upcoming anime releases.',
        querystring: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              default: 1,
              description: 'The page number for pagination.',
            },
          },
        },
      },
    },
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
    {
      schema: {
        tags: ['Anikoto'],
        summary: 'Get recent anime by status',
        description: 'Retrieve recently completed, added, or updated anime.',
        params: {
          type: 'object',
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              enum: ['completed', 'added', 'updated'],
            },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              default: 1,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);
      const page = request.query.page || 1;
      const status = request.params.status as 'completed' | 'added' | 'updated';
      if (status !== 'completed' && status !== 'added' && status !== 'updated') {
        return reply
          .status(400)
          .send({ error: `Invalid path parameter status: '${status}'. Expected 'completed', 'added' or 'updated'.` });
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
              .send({ error: `Invalid path parameter status: '${status}'. Expected 'completed', 'added' or 'updated'.` });
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
    {
      schema: {
        tags: ['Anikoto'],
        summary: 'Get anime by format',
        description: 'Retrieve anime filtered by format (TV, Movie, OVA, etc.).',
        params: {
          type: 'object',
          required: ['format'],
          properties: {
            format: {
              type: 'string',
            },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              default: 1,
            },
          },
        },
      },
    },
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
    {
      schema: {
        tags: ['Anikoto'],
        summary: 'Get anime by genre',
        description: 'Retrieve anime filtered by a specific genre.',
        params: {
          type: 'object',
          required: ['genre'],
          properties: {
            genre: {
              type: 'string',
            },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              default: 1,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);
      const page = Number(request.query.page) || 1;
      const genre = request.params.genre;
      if (!genre) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'genre'.",
        });
      }
      const cacheKey = `anikoto-genre-${genre}-${page}`;
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
    {
      schema: {
        tags: ['Anikoto'],
        summary: 'Get A-Z anime list',
        description: 'Retrieve anime sorted alphabetically or by character group.',
        params: {
          type: 'object',
          required: ['sort'],
          properties: {
            sort: {
              type: 'string',
            },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              default: 1,
            },
          },
        },
      },
    },
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

  fastify.get(
    '/anime/search',
    {
      schema: {
        tags: ['Anikoto'],
        summary: 'Search anime titles by query string',
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string' },
            page: { type: 'number', default: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
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
    },
  );

  fastify.get(
    '/anime/suggestions',
    {
      schema: {
        tags: ['Anikoto'],
        summary: 'Get search suggestions',
        description: 'Retrieve autocomplete suggestions for anime titles.',
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: {
              type: 'string',
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);
      const { q } = request.query;
      if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
      if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });
      const cacheKey = `anikoto-search-suggestions-${q}`;
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
    },
  );

  fastify.get(
    '/anime/schedule',
    {
      schema: {
        tags: ['Anikoto'],
        summary: 'Get anime schedule',
        description: 'Fetch anime airing schedule by timezone offset.',
        querystring: {
          type: 'object',
          properties: {
            timezone: {
              type: 'number',
              description: 'Timezone offset from UTC (-12 to +12)',
              minimum: -12,
              maximum: 12,
            },
          },
          required: ['timezone'],
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);
      const { timezone } = request.query;
      if (!timezone) {
        return reply.status(400).send({
          error: "Missing required query param: 'timezone'",
        });
      }
      const offset = Number(timezone);
      if (isNaN(offset)) {
        return reply.status(400).send({
          error: 'Timezone must be a valid number (e.g., 3 or -10)',
        });
      }
      if (offset < -12 || offset > 12) {
        return reply.status(400).send({
          error: 'Timezone must be between -12 and +12',
        });
      }
      const cacheKey = `anikoto-schedule-${timezone}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }
      try {
        const result = await anikoto.fetchSchedule(offset);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({
            error: result.error,
          });
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 24);
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
        tags: ['Anikoto'],
        summary: 'Get anime details',
        description: 'Fetch detailed metadata and episode list for an anime.',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'string',
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
    },
  );

  fastify.get(
    '/episode/:episodeId/servers',
    {
      schema: {
        tags: ['Anikoto'],
        summary: 'Get episode servers',
        description: 'Retrieve available streaming servers (sub/dub) for an episode.',
        params: {
          type: 'object',
          required: ['episodeId'],
          properties: {
            episodeId: {
              type: 'string',
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      const episodeId = request.params.episodeId;
      if (!episodeId) {
        return reply.status(400).send({
          error: `Missing required path paramater: 'episodeId'`,
        });
      }
      try {
        const result = await anikoto.fetchServers(episodeId);
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
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
        tags: ['Anikoto'],
        summary: 'Get episode sources',
        description: 'Retrieve streaming sources, subtitles, and timestamps for an episode.',
        params: {
          type: 'object',
          required: ['episodeId'],
          properties: {
            episodeId: {
              type: 'string',
            },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            version: {
              type: 'string',
              enum: ['sub', 'dub', 'raw'],
              default: 'sub',
            },
            server: {
              type: 'string',
              enum: ['vidstream-2', 'vidcloud-1', 'vidplay-1', 'hd-1'],
              default: 'vidstream-2',
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const episodeId = request.params.episodeId;
      const version = (request.query.version as 'sub' | 'dub' | 'raw') || 'sub';
      const server = (request.query.server as 'vidstream-2' | 'vidcloud-1' | 'vidplay-1' | 'hd-1') || 'vidstream-2';
      if (!['sub', 'dub', 'raw'].includes(version)) {
        return reply.status(400).send({
          error: `Invalid version picked: '${version}'. Expected one of 'sub','dub' or 'raw'. `,
        });
      }
      if (!episodeId) {
        return reply.status(400).send({
          error: `Missing required path paramater: 'episodeId'`,
        });
      }
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
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );
}
