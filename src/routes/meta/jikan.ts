import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  Jikan,
  type Seasons,
  type IMetaFormat,
  AllAnime,
  Animepahe,
  Anizone,
  HiAnime,
} from '@middlegear/kenjitsu-extensions';

import {
  type FastifyQuery,
  type FastifyParams,
  IAMetaFormatArr,
  IAnimeSeasonsArr,
  allowedProviders,
  JikanList,
} from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';

const jikan = new Jikan();
const allanime = new AllAnime();
const anizone = new Anizone();
const hianime = new HiAnime();
const animepahe = new Animepahe();

export default async function JikanRoutes(fastify: FastifyInstance) {
  fastify.get('/anime/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', 's-maxage=86400, stale-while-revalidate=300');

    const { q, page = 1 } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    try {
      const result = await jikan.search(q, page, perPage);

      if ('error' in result) {
        request.log.error({ result, q, page, perPage }, `External API Error: Failed to fetch search results`);
        return reply.status(500).send(result);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while querying search results`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/anime/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

    const id = request.params.id;

    if (!id) {
      return reply.status(400).send({
        error: "Missing required path parameter: 'id'.",
      });
    }

    let duration;
    const cacheKey = `mal-info-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await jikan.fetchInfo(Number(id));

      if ('error' in result) {
        request.log.error({ result, id }, `External API Error: Failed to fetch animeInfo`);
        return reply.status(500).send(result);
      }
      if (result && result.data !== null) {
        result.data.status === 'finished airing' ? (duration = 0) : (duration = 168);
        await redisSetCache(cacheKey, result, duration);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while fetching animeinfo`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get(
    '/anime/top/:category',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      let perPage = Number(request.query.perPage) || 20;
      perPage = Math.min(perPage, 25);

      const format = (request.query.format as IMetaFormat) || 'TV';
      const category = request.params.category as 'favorite' | 'popular' | 'rating' | 'airing' | 'upcoming';

      if (!category) {
        return reply.status(400).send({
          error: `Missing required path parameter: 'category'.`,
        });
      }

      if (!IAMetaFormatArr.includes(format)) {
        return reply.status(400).send({
          error: `Invalid query param format: '${format}'. Expected one of ${IAMetaFormatArr.join(', ')}.`,
        });
      }

      if (!JikanList.includes(category)) {
        return reply.status(400).send({
          error: `Invalid query param type: '${category}'. Expected one of ${JikanList.join(', ')}.`,
        });
      }

      const cacheKey = `mal-${category}-${format}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        let result;
        switch (category) {
          case 'popular':
            result = await jikan.fetchMostPopular(page, perPage, format);
            break;

          case 'favorite':
            result = await jikan.fetchMostFavorite(page, perPage, format);
            break;

          case 'rating':
            result = await jikan.fetchTopAnime(page, perPage, format);
            break;

          case 'airing':
            result = await jikan.fetchTopAiring(page, perPage, format);
            break;

          case 'upcoming':
            result = await jikan.fetchTopUpcoming(page, perPage, format);
            break;
        }

        if ('error' in result) {
          request.log.error({ result, page, perPage, format, category }, `External API Error: Failed to fetch anime`);
          return reply.status(500).send(result);
        }
        if (result && Array.isArray(result.data) && result.data.length > 0) {
          let duration;

          category === 'airing' ? (duration = 12) : (duration = 168);

          await redisSetCache(cacheKey, result, duration);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching  anime list`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get('/anime/:id/characters', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

    const id = request.params.id;

    if (!id) {
      return reply.status(400).send({
        error: "Missing required path parameter: 'id'.",
      });
    }

    const cacheKey = `mal-characters-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await jikan.fetchAnimeCharacters(Number(id));

      if ('error' in result) {
        request.log.error({ result, id }, `External API Error: Failed to fetch next seasonal anime list`);
        return reply.status(500).send(result);
      }

      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 720);
      }
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ error: error }, `Internal runtime error occurred while fetching characters`);
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });
  fastify.get(
    '/seasons/:season/:year?',
    async (
      request: FastifyRequest<{
        Params: { season: Seasons | 'current' | 'upcoming'; year?: string };
        Querystring: FastifyQuery;
      }>,
      reply: FastifyReply,
    ) => {
      reply.header('Cache-Control', `s-maxage=${72 * 60 * 60}, stale-while-revalidate=300`);

      const { season, year } = request.params;
      const format = (request.query.format as 'TV' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC') || 'TV';
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
          error: "Missing required path parameter: 'season'.",
        });
      }
      const validSeasons = [...IAnimeSeasonsArr, 'current', 'upcoming'];
      if (!validSeasons.includes(season)) {
        return reply.status(400).send({
          error: `Invalid season: '${season}'. Expected one of ${validSeasons.join(', ')}.`,
        });
      }

      if (season !== 'current' && season !== 'upcoming' && !year) {
        return reply.status(400).send({ error: 'Missing required path parameter: year' });
      }

      const cacheKey = year ? `mal-seasons-${year}-${season}-${format}-${page}` : `mal-season-${season}-${format}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        let result;
        if (season === 'current') {
          result = await jikan.fetchCurrentSeason(page, perPage, format);
        } else if (season === 'upcoming') {
          result = await jikan.fetchNextSeason(page, perPage, format);
        } else {
          result = await jikan.fetchSeasonalAnime(season, Number(year), format, page, perPage);
        }

        if ('error' in result) {
          request.log.error(
            { result, page, perPage, season, year, format },
            `External API Error: Failed to fetch seasonal anime list`,
          );
          return reply.status(500).send(result);
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 168);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error }, `Internal runtime error occurred while fetching seasonal anime lists`);
        return reply.status(500).send({ error: 'Internal server error occurred' });
      }
    },
  );

  fastify.get(
    '/mappings/:id',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const id = Number(request.params.id);
      const provider = (request.query.provider as 'allanime' | 'hianime' | 'animepahe' | 'anizone') || 'hianime';

      if (!id) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'id'.",
        });
      }

      if (!allowedProviders.includes(provider)) {
        return reply.status(400).send({
          error: `Invalid provider '${provider}'. Expected one of: ${allowedProviders.join(', ')}`,
        });
      }

      let duration;
      const cacheKey = `mal-mappings-id-${id}-${provider}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await jikan.fetchProviderId(id, provider);

        if ('error' in result) {
          request.log.error({ result, id, provider }, `External API Error: Failed to fetch provider info.`);
          return reply.status(500).send(result);
        }

        if (result && result.data !== null && result.provider !== null && result.data.format.toLowerCase() !== 'movie') {
          result.data.status.toLowerCase() === 'finished airing' ? (duration = 0) : (duration = 148);
          await redisSetCache(cacheKey, result, duration);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching provider info`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get(
    '/episodes/:id',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `s-maxage=${0.5 * 60 * 60}, stale-while-revalidate=300`);

      const id = Number(request.params.id);
      const provider = (request.query.provider as 'allanime' | 'hianime' | 'animepahe' | 'anizone') || 'hianime';

      if (!id) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'id'.",
        });
      }
      if (!allowedProviders.includes(provider)) {
        return reply.status(400).send({
          error: `Invalid provider '${provider}'. Expected one of: ${allowedProviders.join(', ')}`,
        });
      }

      let duration;

      const cacheKey = `mal-episodes-${id}-${provider}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await jikan.fetchAnimeProviderEpisodes(id, provider);

        if ('error' in result) {
          request.log.error({ result, id, provider }, `External API Error: Failed to fetch provider episodes.`);
          return reply.status(500).send(result);
        }
        if (
          result &&
          result.data !== null &&
          Array.isArray(result.providerEpisodes) &&
          result.providerEpisodes.length > 0 &&
          result.data.format.toLowerCase() !== 'movie'
        ) {
          result.data.status.toLowerCase() === 'finished airing' ? (duration = 168) : (duration = 1);
          await redisSetCache(cacheKey, result, duration);
        }
        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching provider episodes`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );
  fastify.get(
    '/sources/:episodeId',
    async (request: FastifyRequest<{ Params: FastifyParams; Querystring: FastifyQuery }>, reply: FastifyReply) => {
      reply.header('Cache-Control', 's-maxage=600, stale-while-revalidate=60');

      const episodeId = String(request.params.episodeId);

      const validCategories = ['sub', 'dub', 'raw'] as const;
      const validServers = ['hd-1', 'hd-2', 'hd-3'] as const;

      const version = request.query.version || 'sub';
      const server = (request.query.server as string) || 'hd-2';

      if (!episodeId) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'episodeId'.",
        });
      }

      if (!validCategories.includes(version as any)) {
        return reply.status(400).send({
          error: `Invalid version '${version}'. Expected one of ${validCategories.join(', ')}.`,
        });
      }

      if (episodeId.includes('hianime')) {
        if (!validServers.includes(server as any)) {
          return reply.status(400).send({
            error: `Invalid streaming server '${server}'. Expected one of ${validServers.join(', ')}.`,
          });
        }
      }

      try {
        let result;

        if (episodeId.includes('hianime')) {
          result = await hianime.fetchSources(
            episodeId,
            server as (typeof validServers)[number],
            version as (typeof validCategories)[number],
          );
        } else if (episodeId.includes('allanime')) {
          result = await allanime.fetchSources(episodeId, version as 'sub' | 'dub');
        } else if (episodeId.includes('pahe')) {
          result = await animepahe.fetchSources(episodeId, version as 'sub' | 'dub');
        } else if (episodeId.includes('anizone')) {
          result = await anizone.fetchSources(episodeId);
        } else
          return reply.status(400).send({
            error: `Unsupported  episodeId: '${episodeId}' Fetch the right episodeId from api/jikan/episodes/:id.`,
          });
        if ('error' in result) {
          request.log.error({ result, episodeId, version }, `External API Error: Failed to fetch sources`);
          return reply.status(500).send(result);
        }

        return reply.status(200).send(result);
      } catch (error) {
        request.log.error({ error: error }, `Internal runtime error occurred while fetching sources`);
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );
}
