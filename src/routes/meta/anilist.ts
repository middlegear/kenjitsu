import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Anilist, type Seasons, type IMetaFormat } from 'kenjitsu-extensions';
import {
  allowedAnimeProviders,
  IAMetaFormatArr,
  IAnimeSeasonsArr,
  type FastifyParams,
  type FastifyQuery,
} from '../../utils/types.js';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';
import { isValidDate } from '../../utils/utils.js';

const anilist = new Anilist();

export default async function AnilistRoutes(fastify: FastifyInstance) {
  fastify.get('/anime/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

    const { q, page = 1 } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing required query parameter: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 50);
    const cacheKey = `anilist-search-${q}-${page}-${perPage}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) return reply.status(200).send(cachedData);

    try {
      const result = await anilist.search(q, 'ANIME', page, perPage);

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
  });

  fastify.get('/anime/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

    let duration;
    const id = Number(request.params.id);

    if (!id) {
      return reply.status(400).send({ error: 'Missing required path params: id' });
    }

    const cacheKey = `anilist-info-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await anilist.fetchInfo(id, 'ANIME');

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }

      if (result && result.data !== null) {
        result.data.status.toLowerCase() === 'finished' ? (duration = 0) : (duration = 24);
        await redisSetCache(cacheKey, result, duration);
      }

      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send(error);
    }
  });

  fastify.get(
    '/anime/top/:category',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      let perPage = Number(request.query.perPage) || 20;
      perPage = Math.min(perPage, 50);
      const category = request.params.category as 'airing' | 'trending' | 'upcoming' | 'popular' | 'rating';

      if (
        category !== 'airing' &&
        category !== 'trending' &&
        category !== 'upcoming' &&
        category !== 'rating' &&
        category !== 'popular'
      ) {
        return reply.status(400).send({
          error: `Invalid type: '${category}'. Expected 'airing' , 'upcoming' , 'trending', 'popular' or 'rating'.`,
        });
      }
      if (!category) {
        return reply.status(400).send({ error: `Missing required path parameter: category` });
      }

      const cacheKey = `anilist-top-${category}-${page}-${perPage}`;
      const cacheData = await redisGetCache(cacheKey);
      if (cacheData) {
        return reply.status(200).send(cacheData);
      }

      try {
        let result;

        switch (category) {
          case 'airing':
            result = await anilist.fetchTopAiring(page, perPage);
            break;

          case 'trending':
            result = await anilist.fetchTrending('ANIME', 'TV', page, perPage);
            break;

          case 'upcoming':
            result = await anilist.fetchTopUpcoming(page, perPage);
            break;

          case 'rating':
            result = await anilist.fetchTopRated('ANIME', 'TV', page, perPage);
            break;

          case 'popular':
            result = await anilist.fetchMostPopular('ANIME', 'TV', page, perPage);
            break;
          default:
            return reply.status(400).send({
              error: `Invalid type: '${category}'. Expected 'airing' , 'upcoming' , 'trending', 'popular' or 'rating'.`,
            });
        }
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        let duration = category === 'airing' || category === 'trending' || category === 'upcoming' ? 24 : 336; //lol remember to swap this around

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, duration);
        }

        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get('/anime/:id/characters', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

    const id = request.params.id;

    if (!id) {
      return reply.status(400).send({
        error: "Missing required path parameter: 'id'.",
      });
    }

    const cacheKey = `anilist-characters-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await anilist.fetchCharacters(Number(id));
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }

      if (result && result.data !== null) {
        await redisSetCache(cacheKey, result, 0);
      }

      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/anime/:id/related', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

    const id = request.params.id;

    if (!id) {
      return reply.status(400).send({
        error: "Missing required path parameter: 'id'.",
      });
    }
    const cacheKey = `anilist-related-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await anilist.fetchRelatedAnime(Number(id));
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }

      if (result && Array.isArray(result.data) && result.data.length > 0) {
        await redisSetCache(cacheKey, result, 336);
      }

      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get(
    '/airing/date/:date',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

      const page = Number(request.query.page) || 1;
      const perPage = Number(request.query.perPage) || 20;
      const date = request.params.date;

      if (!date) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'date'.",
        });
      }
      if (!isValidDate(date)) {
        return reply.status(400).send({
          error: 'Invalid date format. Expected YYYY-MM-DD.',
        });
      }

      const cacheKey = `anilist-schedule-${date}-${page}-${perPage}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await anilist.fetchAiringSchedule(date, page, perPage);
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
  fastify.get('/anime/schedule/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`);

    const id = Number(request.params.id);

    if (isNaN(id)) {
      return reply.status(400).send({
        error: 'The id must be an anilistId',
      });
    } else if (!id) {
      return reply.status(400).send({
        error: "Missing required path parameter: 'id'.",
      });
    }
    const cacheKey = `anilist-media-schedule-${id}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.status(200).send(cachedData);
    }

    try {
      const result = await anilist.fetchMediaSchedule(id);
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'External provider returned an invalid response(null)',
        });
      }
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }

      if (result && result.data !== null) {
        await redisSetCache(cacheKey, result, 24);
      }

      return reply.status(200).send(result);
    } catch (error) {
      return reply.status(500).send(error);
    }
  });

  fastify.get(
    '/seasons/:season/:year',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`);

      const season = request.params.season as Seasons;
      const year = Number(request.params.year);
      const format = (request.query.format as IMetaFormat) || 'TV';
      const page = Number(request.query.page) || 1;
      let perPage = Number(request.query.perPage) || 20;
      perPage = Math.min(perPage, 50);

      if (!IAMetaFormatArr.includes(format)) {
        return reply.status(400).send({
          error: `Invalid format: '${format}'. Expected one of ${IAMetaFormatArr.join(', ')}.`,
        });
      }

      if (!season) {
        return reply.status(400).send({
          error: "Missing required parameter parameter: 'season'.",
        });
      }

      if (!year) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'year'.",
        });
      }

      if (!IAnimeSeasonsArr.includes(season)) {
        return reply.status(400).send({
          error: `Invalid format: '${season}'. Expected one of ${IAnimeSeasonsArr.join(', ')}.`,
        });
      }

      const cacheKey = `anilist-season-${season}-${year}-${page}-${format}-${perPage}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        const result = await anilist.fetchSeasonalAnime(season, year, page, perPage, format);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        if (result && Array.isArray(result.data) && result.data.length > 0) {
          await redisSetCache(cacheKey, result, 336);
        }

        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/anime/mappings/:id',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const id = Number(request.params.id);
      const provider = (request.query.provider as 'anikoto' | 'animepahe' | 'anizone') || 'anikoto';

      if (isNaN(id)) {
        return reply.status(400).send({
          error: 'The id must be an anilistId',
        });
      } else if (!id) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'id'.",
        });
      }

      if (!allowedAnimeProviders.includes(provider)) {
        return reply.status(400).send({
          error: `Invalid provider '${provider}'. Expected one of: ${allowedAnimeProviders.join(', ')}`,
        });
      }

      const cacheKey = `anilist-mappings-id-${id}-${provider}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        let result;
        switch (provider) {
          case 'animepahe':
            result = await anilist.fetchAnimepaheProviderId(id);
            break;
          case 'anizone':
            result = await anilist.fetchAnizoneProviderId(id);
            break;
          case 'anikoto':
            result = await anilist.fetchAnikotoProviderId(id);
            break;
          default:
            return reply.status(400).send({
              error: `Invalid provider '${provider}'. Expected one of: ${allowedAnimeProviders.join(', ')}`,
            });
        }
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error || result.data === null || result.provider === null) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        const data = result?.data;
        const status = data?.status?.toLowerCase();
        const format = data?.format?.toLowerCase();

        if (
          result &&
          data &&
          result.provider !== null &&
          status === 'finished' &&
          data.episodes !== null &&
          format !== 'movie' &&
          provider !== 'animepahe'
        ) {
          await redisSetCache(cacheKey, result, 0);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );

  fastify.get(
    '/episodes/:id',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${0.5 * 60 * 60}, stale-while-revalidate=300`);

      const id = Number(request.params.id);
      const provider = (request.query.provider as 'anikoto' | 'animepahe' | 'anizone') || 'anikoto';

      if (isNaN(id)) {
        return reply.status(400).send({
          error: 'The id must be an anilistId',
        });
      } else if (!id) {
        return reply.status(400).send({
          error: "Missing required path parameter: 'id'.",
        });
      }

      if (!allowedAnimeProviders.includes(provider)) {
        return reply.status(400).send({
          error: `Invalid provider '${provider}'. Expected one of: ${allowedAnimeProviders.join(', ')}`,
        });
      }

      const cacheKey = `anilist-episodes-${id}-${provider}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.status(200).send(cachedData);
      }

      try {
        let result;
        switch (provider) {
          case 'animepahe':
            result = await anilist.fetchAnimepaheProviderEpisodes(id);
            break;
          case 'anizone':
            result = await anilist.fetchAnizoneProviderEpisodes(id);
            break;
          case 'anikoto':
            result = await anilist.fetchAnikotoProviderEpisodes(id);
            break;
          default:
            return reply.status(400).send({
              error: `Invalid provider '${provider}'. Expected one of: ${allowedAnimeProviders.join(', ')}`,
            });
        }

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({
            error: 'External provider returned an invalid response(null)',
          });
        }
        if (result.error || result.data === null || result.providerEpisodes.length === 0) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        const status = result?.data?.status?.toLowerCase();
        const format = result?.data?.format?.toLowerCase();
        const episodesFound = result?.providerEpisodes?.length || 0;
        const episodesExpected = result?.data?.episodes;

        const isFinished = status === 'finished';
        const isNotMovie = format !== 'movie';
        const isComplete = episodesFound >= episodesExpected && episodesExpected !== null;

        let duration;
        isFinished ? (duration = 0) : 1.5;
        if (isFinished && result.data !== null && isNotMovie && isComplete && provider !== 'animepahe') {
          await redisSetCache(cacheKey, result, duration);
        }
        return reply.status(200).send(result);
      } catch (error) {
        return reply.status(500).send(error);
      }
    },
  );
}
