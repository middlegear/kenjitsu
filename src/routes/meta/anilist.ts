import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Anilist } from '@middlegear/hakai-extensions';
import {
  toFormatAnilist,
  toAnilistSeasons,
  toCategory,
  toProvider,
  type AnimeProviderApi,
  toZoroServers,
} from '../../utils/utils.js';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';
import type { AnilistInfo, AnilistRepetitive, FastifyParams, FastifyQuery } from '../../utils/types.js';

const anilist = new Anilist();

export default async function AnilistRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ message: 'Welcome to Anilist Metadata provider' });
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
    perPage = Math.min(perPage, 50);

    reply.header('Cache-Control', `s-maxage=${48 * 60 * 60}, stale-while-revalidate=300`);

    const result = await anilist.search(q, page, perPage);
    if ('error' in result) {
      return reply.status(500).send({
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
        error: result.error,
      });
    }
    return reply.status(200).send({
      hasNextPage: result.hasNextPage,
      currentPage: result.currentPage,
      totalResults: result.totalResults,
      perPage: result.perPage,
      lastPage: result.lastPage,
      data: result.data,
    });
  });

  fastify.get('/info/:anilistId', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const anilistId = Number(request.params.anilistId);

    reply.header('Cache-Control', `s-maxage=${48 * 60 * 60}, stale-while-revalidate=300`);

    const cacheKey = `anilist-info-${anilistId}`;
    const cachedData = (await redisGetCache(cacheKey)) as AnilistInfo;

    if (cachedData) {
      return reply.status(200).send({
        data: cachedData.data,
      });
    }

    const result = await anilist.fetchInfo(anilistId);

    if ('error' in result) {
      return reply.status(500).send({
        data: result.data,
        error: result.error,
      });
    }

    if (result.data !== null) {
      const cacheableData = {
        data: result.data,
      };

      await redisSetCache(cacheKey, cacheableData, 24);
    }
    return reply.status(200).send({
      data: result.data,
    });
  });

  fastify.get('/top-airing', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 50);

    const cacheKey = `anilist-top-airing${page}-${perPage}`;

    reply.header('Cache-Control', `s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`);

    const cachedData = (await redisGetCache(cacheKey)) as AnilistRepetitive;
    if (cachedData) {
      return reply.status(200).send({
        hasNextPage: cachedData.hasNextPage,
        currentPage: cachedData.currentPage,
        totalResults: cachedData.totalResults,
        perPage: cachedData.perPage,
        lastPage: cachedData.lastPage,
        data: cachedData.data,
      });
    }
    const result = await anilist.fetchTopAiring(page, perPage);
    if ('error' in result) {
      return reply.status(500).send({
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
        error: result.error,
      });
    }
    if (result.data.length > 0) {
      const cacheableData = {
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
      };

      await redisSetCache(cacheKey, cacheableData, 6);
    }

    return reply.status(200).send({
      hasNextPage: result.hasNextPage,
      currentPage: result.currentPage,
      totalResults: result.totalResults,
      perPage: result.perPage,
      lastPage: result.lastPage,
      data: result.data,
    });
  });

  fastify.get('/most-popular', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const format = request.query.format || 'TV';
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 50);

    const newformat = toFormatAnilist(format);

    const cacheKey = `anilist-most-popular-${page}-${perPage}-${newformat}`;

    reply.header('Cache-Control', `s-maxage=${148 * 60 * 60}, stale-while-revalidate=300`);

    const cachedData = (await redisGetCache(cacheKey)) as AnilistRepetitive;
    if (cachedData) {
      return reply.status(200).send({
        hasNextPage: cachedData.hasNextPage,
        currentPage: cachedData.currentPage,
        totalResults: cachedData.totalResults,
        perPage: cachedData.perPage,
        lastPage: cachedData.lastPage,
        data: cachedData.data,
      });
    }

    const result = await anilist.fetchMostPopular(page, perPage, newformat);

    if ('error' in result) {
      return reply.status(500).send({
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
        error: result.error,
      });
    }
    if (result.data.length > 0) {
      const cacheableData = {
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
      };

      await redisSetCache(cacheKey, cacheableData, 148);
    }

    return reply.status(200).send({
      hasNextPage: result.hasNextPage,
      currentPage: result.currentPage,
      totalResults: result.totalResults,
      perPage: result.perPage,
      lastPage: result.lastPage,
      data: result.data,
    });
  });

  fastify.get('/top-anime', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const format = request.query.format || 'TV';
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 50);

    const newformat = toFormatAnilist(format);

    reply.header('Cache-Control', `s-maxage=${48 * 60 * 60}, stale-while-revalidate=300`);

    const cacheKey = `anilist-top-anime-${page}-${perPage}-${newformat}`;
    const cachedData = (await redisGetCache(cacheKey)) as AnilistRepetitive;
    if (cachedData) {
      return reply.status(200).send({
        data: cachedData.data,
        hasNextPage: cachedData.hasNextPage,
        currentPage: cachedData.currentPage,
        totalResults: cachedData.totalResults,
        perPage: cachedData.perPage,
        lastPage: cachedData.lastPage,
      });
    }

    const result = await anilist.fetchTopRatedAnime(page, perPage, newformat);

    if ('error' in result) {
      return reply.status(500).send({
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
        error: result.error,
      });
    }
    if (result.data.length > 0) {
      const cacheableData = {
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
      };

      await redisSetCache(cacheKey, cacheableData, 24);
    }

    return reply.status(200).send({
      hasNextPage: result.hasNextPage,
      currentPage: result.currentPage,
      totalResults: result.totalResults,
      perPage: result.perPage,
      lastPage: result.lastPage,
      data: result.data,
    });
  });

  fastify.get('/upcoming', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 50);

    const cacheKey = `anilist-upcoming-${page}-${perPage}`;

    reply.header('Cache-Control', `s-maxage=${48 * 60 * 60}, stale-while-revalidate=300`);

    const cachedData = (await redisGetCache(cacheKey)) as AnilistRepetitive;
    if (cachedData) {
      return reply.status(200).send({
        hasNextPage: cachedData.hasNextPage,
        currentPage: cachedData.currentPage,
        totalResults: cachedData.totalResults,
        perPage: cachedData.perPage,
        lastPage: cachedData.lastPage,
        data: cachedData.data,
      });
    }
    const result = await anilist.fetchTopUpcoming(page, perPage);

    if ('error' in result) {
      return reply.status(500).send({
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
        error: result.error,
      });
    }
    if (result.data.length > 0) {
      const cacheableData = {
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
      };

      await redisSetCache(cacheKey, cacheableData, 12);
    }

    return reply.status(200).send({
      hasNextPage: result.hasNextPage,
      currentPage: result.currentPage,
      totalResults: result.totalResults,
      perPage: result.perPage,
      lastPage: result.lastPage,
      data: result.data,
    });
  });

  fastify.get('/characters/:anilistId', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const anilistId = Number(request.params.anilistId);

    reply.header('Cache-Control', `s-maxage=${96 * 60 * 60}, stale-while-revalidate=300`);

    const result = await anilist.fetchCharacters(anilistId);
    if ('error' in result) {
      return reply.status(500).send({
        error: result.error,
        data: result.data,
      });
    }
    return reply.status(200).send({
      data: result.data,
    });
  });

  fastify.get('/trending', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 50);

    reply.header('Cache-Control', `s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`);

    const cacheKey = `anilist-trending-${page}-${perPage}`;

    const cachedData = (await redisGetCache(cacheKey)) as AnilistRepetitive;
    if (cachedData) {
      return reply.status(200).send({
        hasNextPage: cachedData.hasNextPage,
        currentPage: cachedData.currentPage,
        totalResults: cachedData.totalResults,
        perPage: cachedData.perPage,
        lastPage: cachedData.lastPage,
        data: cachedData.data,
      });
    }
    const result = await anilist.fetchTrending(page, perPage);

    if ('error' in result) {
      return reply.status(500).send({
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
        error: result.error,
      });
    }
    if (result.data.length > 0) {
      const cacheableData = {
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
      };

      await redisSetCache(cacheKey, cacheableData, 2);
    }

    return reply.status(200).send({
      hasNextPage: result.hasNextPage,
      currentPage: result.currentPage,
      totalResults: result.totalResults,
      perPage: result.perPage,
      lastPage: result.lastPage,
      data: result.data,
    });
  });

  fastify.get('/related/:anilistId', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const anilistId = Number(request.params.anilistId);
    reply.header('Cache-Control', `s-maxage=${96 * 60 * 60}, stale-while-revalidate=300`);

    const result = await anilist.fetchRelatedAnime(anilistId);
    if ('error' in result) {
      return reply.status(500).send({
        data: result.data,
        error: result.error,
      });
    }
    return reply.status(200).send({
      data: result.data,
    });
  });

  fastify.get(
    '/season',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const season = String(request.query.season);
      const year = Number(request.query.year);
      const format = request.query.format || 'TV';
      const page = Number(request.query.page) || 1;
      let perPage = Number(request.query.perPage) || 20;
      perPage = Math.min(perPage, 50);

      const newformat = toFormatAnilist(format);
      const newseason = toAnilistSeasons(season);

      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const result = await anilist.fetchSeasonalAnime(newseason, year, page, perPage, newformat);

      if ('error' in result) {
        return reply.status(500).send({
          hasNextPage: result.hasNextPage,
          currentPage: result.currentPage,
          totalResults: result.totalResults,
          perPage: result.perPage,
          lastPage: result.lastPage,
          data: result.data,
          error: result.error,
        });
      }
      return reply.status(200).send({
        hasNextPage: result.hasNextPage,
        currentPage: result.currentPage,
        totalResults: result.totalResults,
        perPage: result.perPage,
        lastPage: result.lastPage,
        data: result.data,
      });
    },
  );

  fastify.get(
    '/get-provider/:anilistId',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const anilistId = Number(request.params.anilistId);
      const provider = request.query.provider || 'hianime';

      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      const newprovider = toProvider(provider) as AnimeProviderApi;

      // const cacheKey = `anilist-provider-id-${anilistId}`;
      const cacheKey = `anilist-provider-id-${anilistId}-${newprovider}`;

      const cachedData = (await redisGetCache(cacheKey)) as AnilistInfo;
      if (cachedData) {
        return reply.status(200).send({
          data: cachedData.data,
          provider: cachedData.provider,
        });
      }
      const result = await anilist.fetchProviderId(anilistId, newprovider);
      if ('error' in result) {
        return reply.status(500).send({
          data: result.data,
          provider: result.provider,
          error: result.error,
        });
      }

      if (result.data !== null && result.provider !== null) {
        const cacheableData = {
          data: result.data,
          provider: result.provider,
        };

        await redisSetCache(cacheKey, cacheableData, 2);
      }

      return reply.status(200).send({
        data: result.data,
        provider: result.provider,
      });
    },
  );

  fastify.get(
    '/provider-episodes/:anilistId',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const anilistId = Number(request.params.anilistId);
      const provider = request.query.provider || 'hianime';
      const newprovider = toProvider(provider);

      reply.header('Cache-Control', `s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`);

      // const cacheKey = `anilist-provider-episodes-${anilistId}`;

      const cacheKey = `anilist-provider-episodes-${anilistId}-${newprovider}`;

      const cachedData = (await redisGetCache(cacheKey)) as AnilistInfo;
      if (cachedData) {
        return reply.status(200).send({
          data: cachedData.data,
          providerEpisodes: cachedData.providerEpisodes,
        });
      }

      const result = await anilist.fetchAnimeProviderEpisodes(anilistId, newprovider);

      if ('error' in result) {
        return reply.status(500).send({
          data: result.data,
          providerEpisodes: result.providerEpisodes,
          error: result.error,
        });
      }

      let timecached: number;
      const status = result.data?.status.toLowerCase().trim();
      status === 'finished' ? (timecached = 148) : (timecached = 24);

      if (result.data !== null && result.providerEpisodes.length > 0) {
        const cacheableData = {
          data: result.data,
          providerEpisodes: result.providerEpisodes,
        };
        await redisSetCache(cacheKey, cacheableData, timecached);
      }

      return reply.status(200).send({
        data: result.data,
        providerEpisodes: result.providerEpisodes,
      });
    },
  );

  fastify.get(
    '/watch/:episodeId',
    async (request: FastifyRequest<{ Params: FastifyParams; Querystring: FastifyQuery }>, reply: FastifyReply) => {
      const episodeId = String(request.params.episodeId);
      const category = request.query.category || 'sub';
      const server = request.query.server || 'hd-2';

      const newserver = toZoroServers(server);
      const newcategory = toCategory(category);

      reply.header('Cache-Control', 's-maxage=420, stale-while-revalidate=60');
      let result;

      if (episodeId.includes('hianime')) {
        result = await anilist.fetchHianimeProviderSources(episodeId, newcategory, newserver);
        if ('error' in result) {
          return reply.status(500).send({
            error: result.error,
            headers: result.headers,
            data: result.data,
          });
        }
      }
      if (episodeId.startsWith('allanime')) {
        result = await anilist.fetchAllAnimeProviderSources(episodeId, newcategory);
        if ('error' in result) {
          return reply.status(500).send({
            error: result.error,
            data: result,
          });
        }
      } else {
        result = await anilist.fetchHianimeProviderSources(episodeId, newcategory, newserver);
      }
      if ('error' in result) {
        return reply.status(500).send({
          error: result.error,
          headers: result.headers,
          data: result.data,
        });
      }

      return reply.status(200).send(result);
    },
  );
}
