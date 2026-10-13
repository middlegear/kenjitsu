import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { Kitsu } from '../../providers/meta/kitsu.js';
import type { FastifyQuery, FastifyParams } from '../../types/base.js';

const kitsu = new Kitsu();

export default async function KitsuRoutes(fastify: FastifyInstance) {
  fastify.get('/anime/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const { q } = request.query;

    if (!q) return reply.status(400).send({ error: "Missing 'q' parameter" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query too long' });

    try {
      const result = await kitsu.search(q);

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'Invalid response from Kitsu' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/anime/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const id = Number(request.params.id);

    if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

    try {
      const result = await kitsu.fetchInfo(id);

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'Invalid response' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${72 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/anime/:id/episodes', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const id = Number(request.params.id);

    if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

    try {
      const result = await kitsu.fetchEpisodes(id);

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'Invalid response' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/anime/:id/mappings', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const id = Number(request.params.id);

    if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

    try {
      const result = await kitsu.fetchMapping(id);

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'Invalid response' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/anime/:id/related', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

    try {
      const result = await kitsu.fetchRelatedAnime(id);

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'Invalid response' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/anime/:id/franchise', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

    try {
      const result = await kitsu.fetchParentSeries(id);

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'Invalid response' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${336 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
