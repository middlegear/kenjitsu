import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AnimeProvider, Format, Jikan, Seasons } from 'hakai-extensions';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';
import { FastifyQuery, FastifyParams } from '../../utils/types.js';
import { toProvider } from '../../utils/normalize.js';

const jikan = new Jikan();

export default async function JikanRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      message: 'Welcome to Jikan metadata provider',
    });
  });

  // api/meta/jikan/search?q=string&page=number&perPage=number
  fastify.get('/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const q = String(request.query.q);
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    const data = await jikan.search(q, page, perPage);
    return reply.send({ data });
  });

  // api/meta/jikan/info/:malId
  fastify.get('/info/:malId', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const malId = Number(request.params.malId);
    const cacheKey = `jikan-info-${malId}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.send({ cachedData });
    }

    const data = await jikan.fetchInfo(malId);

    await redisSetCache(cacheKey, data, 148);

    return reply.send({ data });
  });

  // api/meta/jikan/top-airing?page=number&perPage=number&format=format
  fastify.get('/top-airing', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);
    const format = (request.query.format as Format) || 'TV';

    const cacheKey = `jikan-top-airing-${page}-${perPage}-${format}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.send({ cachedData });
    }

    const data = await jikan.fetchTopAiring(page, perPage, format);

    await redisSetCache(cacheKey, data, 24);

    return reply.send({ data });
  });

  //api/meta/jikan/most-popular?page=number&perPage=number&format=format
  fastify.get('/most-popular', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);
    const format = (request.query.format as Format) || 'TV';

    const cacheKey = `jikan-most-popular${page}-${perPage}-${format}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.send({ data: cachedData });
    }

    const data = await jikan.fetchMostPopular(page, perPage, format);

    await redisSetCache(cacheKey, data, 148);

    return reply.send({ data });
  });

  //api/meta/jikan/upcoming?page=number&perPage=number
  fastify.get('/upcoming', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    const cacheKey = `jikan-upcoming-${page}-${perPage}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.send({ data: cachedData });
    }

    const data = await jikan.fetchTopUpcoming(page, perPage);

    await redisSetCache(cacheKey, data, 72);

    return reply.send({ data });
  });

  //api/meta/jikan/movies?page=number&perPage=number
  fastify.get('/movies', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    const cacheKey = `jikan-movies-category-${page}-${perPage}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.send({ cachedData });
    }

    const data = await jikan.fetchTopMovies(page, perPage);
    await redisSetCache(cacheKey, data, 148);
    return reply.send({ data });
  });

  //api/meta/jikan/seasons/:season/:year?page=number&perPage=number
  fastify.get(
    '/seasons/:season/:year',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const season = request.params.season as Seasons;
      const year = Number(request.params.year);
      const format = (request.query.format as Format) || 'TV';
      const page = Number(request.query.page) || 1;
      let perPage = Number(request.query.perPage) || 20;
      perPage = Math.min(perPage, 25);

      const cacheKey = `jikan-seasons-${season}-${year}-${page}-${perPage}-${format}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.send({ data: cachedData });
      }

      const data = await jikan.fetchSeason(season, year, format, page, perPage);

      await redisSetCache(cacheKey, data, 48);
      return reply.send({ data });
    },
  );

  //api/meta/jikan/current-season?page=number&perPage=number&format=string
  fastify.get('/current-season', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const format = (request.query.format as Format) || 'TV';
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    const cacheKey = `jikan-current-season-${page}-${perPage}-${format}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.send({ data: cachedData });
    }

    const data = await jikan.fetchCurrentSeason(page, perPage, format);

    await redisSetCache(cacheKey, data, 48);
    return reply.send({ data });
  });

  //api/meta/jikan/next-season?page=number&perPage=number&format=string
  fastify.get('/next-season', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const format = (request.query.format as Format) || 'TV';
    const page = Number(request.query.page) || 1;
    let perPage = Number(request.query.perPage) || 20;
    perPage = Math.min(perPage, 25);

    const cacheKey = `jikan-next-season-${page}-${perPage}-${format}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.send({ data: cachedData });
    }
    const data = await jikan.fetchNextSeason(page, perPage, format);

    await redisSetCache(cacheKey, data, 48);
    return reply.send({ data });
  });

  //api/meta/jikan/characters/:malId
  fastify.get('/characters/:malId', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const malId = Number(request.params.malId);

    const cacheKey = `jikan-characters-${malId}`;
    const cachedData = await redisGetCache(cacheKey);
    if (cachedData) {
      return reply.send({ data: cachedData });
    }

    const data = await jikan.fetchAnimeCharacters(malId);

    await redisSetCache(cacheKey, data, 298);
    return reply.send({ data });
  });

  //api/meta/jikan/mal-episodes/:malId?page=number
  fastify.get(
    '/mal-episodes/:malId',
    async (request: FastifyRequest<{ Params: FastifyParams; Querystring: FastifyQuery }>, reply: FastifyReply) => {
      const malId = Number(request.params.malId);
      const page = Number(request.query.page) || 1;

      const cacheKey = `mal-episodes-${malId}-${page}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.send({ data: cachedData });
      }

      const data = await jikan.fetchMalEpisodes(malId, page);

      await redisSetCache(cacheKey, data, 12);
      return reply.send({ data });
    },
  );

  //api/meta/jikan/mal-episode-info/:id/:episodeNumber
  fastify.get(
    '/mal-episode-info/:malId/:episodeNumber',
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      const malId = Number(request.params.malId);
      const episodeNumber = Number(request.params.episodeNumber);

      const cacheKey = `mal-episode-info${malId}-${episodeNumber}`;
      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.send({ data: cachedData });
      }

      const data = await jikan.fetchMalEpisodeInfo(malId, episodeNumber);

      await redisSetCache(cacheKey, data, 12);
      return reply.send({ data });
    },
  );

  //api/meta/anilist/get-provider/:malId?provider=string
  fastify.get(
    '/get-provider/:malId',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const malId = Number(request.params.malId);
      const provider = request.query.provider || 'hianime';
      const newprovider = toProvider(provider) as AnimeProvider;

      const cacheKey = `jikan-provider-id-${malId}-${newprovider}`;

      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.send({ data: cachedData });
      }

      const data = await jikan.fetchProviderAnimeId(malId, newprovider);

      await redisSetCache(cacheKey, data, 148);
      return reply.send({ data });
    },
  );

  //api/meta/anilist/provider-episodes/:malId?provider=string
  fastify.get(
    '/provider-episodes/:malId',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const malId = Number(request.params.malId);
      const provider = request.query.provider || 'hianime';

      console.log(provider);

      const newprovider = toProvider(provider) as AnimeProvider;

      const cacheKey = `jikan-provider-episodes-${malId}-${newprovider}`;

      const cachedData = await redisGetCache(cacheKey);
      if (cachedData) {
        return reply.send({ data: cachedData });
      }
      const data = await jikan.fetchAnimeProviderEpisodes(malId, newprovider);

      await redisSetCache(cacheKey, data, 148);
      return reply.send({ data });
    },
  );
}
