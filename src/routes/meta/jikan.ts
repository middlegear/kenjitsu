import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Jikan, type Seasons, type IMetaFormat } from '@middlegear/hakai-extensions';

import { type FastifyQuery, type FastifyParams, IAMetaFormatArr, IAnimeSeasonsArr } from '../../utils/types.js';

const jikan = new Jikan();

export default async function JikanRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      message: 'Welcome to Jikan metadata provider',
    });
  });

  fastify.get('/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    let q = request.query.q?.trim() ?? '';
    q = decodeURIComponent(q);
    q = q.replace(/[^\w\s\-_.]/g, '');

    if (!q.length) {
      return reply.status(400).send({ error: 'Query string cannot be empty' });
    }

    if (q.length > 1000) {
      return reply.status(400).send({ error: 'Query too long' });
    }

    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    reply.header('Cache-Control', 's-maxage=86400, stale-while-revalidate=300');

    const result = await jikan.search(q, page, perPage);

    if ('error' in result) {
      return reply.status(500).send(result);
    }
    return reply.status(200).send(result);
  });

  fastify.get('/info/:malId', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

    const malId = Number(request.params.malId);

    const result = await jikan.fetchInfo(malId);

    if ('error' in result) {
      return reply.status(500).send(result);
    }

    return reply.status(200).send(result);
  });

  fastify.get('/top-airing', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);

    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);
    const format = (request.query.format as IMetaFormat) || 'TV';

    if (!IAMetaFormatArr.includes(format)) {
      return reply.status(400).send({
        error: `Invalid format: '${format}'. Expected one of ${IAMetaFormatArr.join(', ')}.`,
      });
    }
    const result = await jikan.fetchTopAiring(page, perPage, format);

    if ('error' in result) {
      return reply.status(500).send(result);
    }

    return reply.status(200).send(result);
  });

  fastify.get('/most-popular', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    const format = (request.query.format as IMetaFormat) || 'TV';

    if (!IAMetaFormatArr.includes(format)) {
      return reply.status(400).send({
        error: `Invalid format: '${format}'. Expected one of ${IAMetaFormatArr.join(', ')}.`,
      });
    }

    const result = await jikan.fetchMostPopular(page, perPage, format);

    if ('error' in result) {
      return reply.status(500).send(result);
    }

    return reply.status(200).send(result);
  });

  fastify.get('/upcoming', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${72 * 60 * 60}, stale-while-revalidate=300`);

    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    const result = await jikan.fetchTopUpcoming(page, perPage);

    if ('error' in result) {
      return reply.status(500).send(result);
    }
    return reply.status(200).send(result);
  });

  fastify.get('/movies', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${72 * 60 * 60}, stale-while-revalidate=300`);

    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    const result = await jikan.fetchTopMovies(page, perPage);

    if ('error' in result) {
      return reply.status(500).send(result);
    }

    return reply.status(200).send(result);
  });

  fastify.get(
    '/season',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `s-maxage=${72 * 60 * 60}, stale-while-revalidate=300`);

      const season = request.query.season as Seasons;
      const year = Number(request.query.year);
      const format = (request.query.format as IMetaFormat) || 'TV';
      const page = Number(request.query.page) || 1;
      let perPage = Number(request.query.perPage) || 20;
      perPage = Math.min(perPage, 25);

      if (!IAMetaFormatArr.includes(format)) {
        return reply.status(400).send({
          error: `Invalid format: '${format}'. Expected one of ${IAMetaFormatArr.join(', ')}.`,
        });
      }

      if (!season) {
        return reply.status(400).send({
          error: "Missing required query parameter: 'season'.",
        });
      }
      if (!IAnimeSeasonsArr.includes(season)) {
        return reply.status(400).send({
          error: `Invalid format: '${season}'. Expected one of ${IAnimeSeasonsArr.join(', ')}.`,
        });
      }
      const result = await jikan.fetchSeasonalAnime(season, year, format, page, perPage);

      if ('error' in result) {
        return reply.status(500).send(result);
      }
      return reply.status(200).send(result);
    },
  );

  fastify.get('/current-season', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

    const format = (request.query.format as IMetaFormat) || 'TV';
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    if (!IAMetaFormatArr.includes(format)) {
      return reply.status(400).send({
        error: `Invalid format: '${format}'. Expected one of ${IAMetaFormatArr.join(', ')}.`,
      });
    }

    const result = await jikan.fetchCurrentSeason(page, perPage, format);

    if ('error' in result) {
      return reply.status(500).send(result);
    }
    return reply.status(200).send(result);
  });

  fastify.get('/next-season', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

    const format = (request.query.format as IMetaFormat) || 'TV';
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    if (!IAMetaFormatArr.includes(format)) {
      return reply.status(400).send({
        error: `Invalid format: '${format}'. Expected one of ${IAMetaFormatArr.join(', ')}.`,
      });
    }
    const result = await jikan.fetchNextSeason(page, perPage, format);

    if ('error' in result) {
      return reply.status(500).send(result);
    }
    return reply.status(200).send(result);
  });

  fastify.get('/characters/:malId', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

    const malId = Number(request.params.malId);

    const result = await jikan.fetchAnimeCharacters(malId);

    if ('error' in result) {
      return reply.status(500).send(result);
    }
    return reply.status(200).send(result);
  });

  fastify.get(
    '/episodes/:malId',
    async (request: FastifyRequest<{ Params: FastifyParams; Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const malId = Number(request.params.malId);
      const page = Number(request.query.page) || 1;

      const result = await jikan.fetchEpisodes(malId, page);
      if ('error' in result) {
        return reply.status(500).send(result);
      }
      return reply.status(200).send(result);
    },
  );

  fastify.get(
    '/episode-info/:malId',
    async (request: FastifyRequest<{ Params: FastifyParams; Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);
      const malId = Number(request.params.malId);
      const episodeNumber = Number(request.query.episode);

      if (!malId) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'malId'.",
        });
      }
      if (!episodeNumber) {
        return reply.status(400).send({
          error: "Missing required query parameter: 'episode'. which is a number",
        });
      }
      const result = await jikan.fetchEpisodeInfo(malId, episodeNumber);
      if ('error' in result) {
        return reply.status(500).send(result);
      }
      return reply.status(200).send(result);
    },
  );

  fastify.get(
    '/get-provider/:malId',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const malId = Number(request.params.malId);
      const provider = (request.query.provider as 'allanime' | 'hianime') || 'hianime';

      if (!malId) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'malId'.",
        });
      }
      if (provider !== 'allanime' && provider !== 'hianime') {
        return reply.status(400).send({
          error: `Invalid provider ${provider} .Expected provider query paramater to be  'allanime' or 'hianime' `,
        });
      }
      const result = await jikan.fetchProviderId(malId, provider);

      if ('error' in result) {
        return reply.status(500).send(result);
      }

      return reply.status(200).send(result);
    },
  );

  fastify.get(
    '/provider-episodes/:malId',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const malId = Number(request.params.malId);
      const provider = (request.query.provider as 'allanime' | 'hianime') || 'hianime';

      if (!malId) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'malId'.",
        });
      }
      if (provider !== 'allanime' && provider !== 'hianime') {
        return reply.status(400).send({
          error: `Invalid provider ${provider} .Expected provider query paramater to be  'allanime' or 'hianime' `,
        });
      }
      const result = await jikan.fetchAnimeProviderEpisodes(malId, provider);

      if ('error' in result) {
        return reply.status(500).send(result);
      }

      return reply.status(200).send(result);
    },
  );
  fastify.get(
    '/watch/:episodeId',
    async (request: FastifyRequest<{ Params: FastifyParams; Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', 's-maxage=420, stale-while-revalidate=60');

      const episodeId = String(request.params.episodeId);

      const validCategories = ['sub', 'dub', 'raw'] as const;
      const validServers = ['hd-1', 'hd-2', 'hd-3'] as const;

      const category = (request.query.category as string) || 'sub';
      const server = (request.query.server as string) || 'hd-2';

      if (!episodeId) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'episodeId'.",
        });
      }

      if (!validCategories.includes(category as any)) {
        return reply.status(400).send({
          error: `Invalid category '${category}'. Expected one of ${validCategories.join(', ')}.`,
        });
      }

      if (episodeId.includes('hianime')) {
        if (!validServers.includes(server as any)) {
          return reply.status(400).send({
            error: `Invalid streaming server '${server}'. Expected one of ${validServers.join(', ')}.`,
          });
        }
      }

      let result;

      if (episodeId.includes('hianime')) {
        result = await jikan.fetchHianimeProviderSources(
          episodeId,
          category as (typeof validCategories)[number],
          server as (typeof validServers)[number],
        );
      } else if (episodeId.includes('allanime')) {
        result = await jikan.fetchAllAnimeProviderSources(episodeId, category as (typeof validCategories)[number]);
      } else {
        return reply.status(400).send({
          error: `Unsupported provider for episodeId: '${episodeId}' Fetch episodeId from provider episodes endpoint.`,
        });
      }

      if ('error' in result) {
        return reply.status(500).send(result);
      }

      return reply.status(200).send(result);
    },
  );
}
