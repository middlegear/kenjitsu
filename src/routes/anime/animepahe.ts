import 'dotenv/config';
import { Animepahe } from 'kenjitsu-extensions';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyQuery, FastifyParams } from '../../utils/types.js';

const baseUrl = process.env.ANIMEPAHEURL || 'https://animepahe.pw';
const animepahe = new Animepahe(baseUrl);

export default async function AnimepaheRoutes(fastify: FastifyInstance) {
  fastify.get('/anime/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const { q } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    try {
      const result = await animepahe.search(q);
      if (!result || typeof result !== 'object') {
        request.log.warn({ q, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result.error) {
        request.log.error({ result, q }, `External API Error: Failed to fetch search results for query:${q}`);
        return reply.status(500).send(result);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while querying search results`);
      return reply.status(500).send({ error: `Internal server error occurred:${error}` });
    }
  });

  fastify.get('/episodes/recent', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const page = request.query.page || 1;

    try {
      const result = await animepahe.fetchRecentEpisodes(page);
      if (!result || typeof result !== 'object') {
        request.log.warn({ page, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result.error) {
        request.log.error({ result, page }, `External API Error: Failed to fetch recent episodes results`);
        return reply.status(500).send(result);
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
        error: `Missing required path parameter: 'id'`,
      });
    }

    try {
      const result = await animepahe.fetchAnimeInfo(id);
      if (result.error) {
        request.log.error({ result, id }, `External API Error: Failed to fetch anime info`);
        return reply.status(500).send(result);
      }

      if (!result || typeof result !== 'object') {
        request.log.warn({ id, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while fetching anime info`);
      return reply.status(500).send({ error: `Internal server occurred:${error}` });
    }
  });

  fastify.get('/anime/:id/episodes', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const id = request.params.id;

    if (!id) {
      return reply.status(400).send({
        error: `Missing required path parameter: 'id'`,
      });
    }

    try {
      const result = await animepahe.fetchEpisodes(id);

      if (!result || typeof result !== 'object') {
        request.log.warn({ id, result }, 'External provider returned null/undefined');
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }

      if (result.error) {
        request.log.error({ result, id }, `External API Error: Failed to fetch episodes`);
        return reply.status(500).send(result);
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
      const episodeId = request.params.episodeId;

      if (!episodeId) {
        return reply.status(400).send({
          error: `Missing required path parameter: 'episodeId'`,
        });
      }

      try {
        const result = await animepahe.fetchServers(episodeId);
        if (result.error) {
          request.log.error({ result, episodeId }, `External API Error: Failed to fetch servers`);
          return reply.status(500).send(result);
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
      const episodeId = request.params.episodeId;

      const version = (request.query.version as 'sub' | 'dub') || 'sub';

      if (!['sub', 'dub'].includes(version)) {
        return reply.status(400).send({
          error: `Invalid version picked: '${version}'. Expected one of 'sub','dub'.`,
        });
      }
      if (!episodeId) {
        return reply.status(400).send({
          error: `Missing required path parameter: 'episodeId'`,
        });
      }

      try {
        const result = await animepahe.fetchSources(episodeId, version);
        if (!result || typeof result !== 'object') {
          request.log.warn({ episodeId, version, result }, 'External provider returned null/undefined');
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          request.log.error({ result, episodeId, version }, `External API Error: Failed to fetch sources`);
          return reply.status(500).send(result);
        }

        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching sources`);
        return reply.status(500).send({ error: `Internal server occurred:${error}` });
      }
    },
  );
}
