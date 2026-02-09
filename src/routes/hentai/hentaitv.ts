import { HentaiTv } from 'kenjitsu-extensions';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { type FastifyQuery, type FastifyParams } from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';

const hentaitv = new HentaiTv();

export default async function HentaiTvRoutes(fastify: FastifyInstance) {
  fastify.get('/hentai/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

    const q = request.query.q;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });

    const cacheKey = `hentaitv-search-${q}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }
    try {
      const result = await hentaitv.search(q);
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
}
