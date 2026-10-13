import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { TheMovieDatabase } from '../../providers/meta/tmdb.js';
import type { FastifyParams, FastifyQuery } from '../../types/base.js';

const tmdb = new TheMovieDatabase();

export default async function TheMovieDatabaseRoutes(fastify: FastifyInstance) {

  fastify.get('/tv/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const { q, page = 1, year } = request.query;

    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const firstAirDateYear = year ? Number(year) : undefined;

    try {
      const result = await tmdb.searchShows(q, page, firstAirDateYear);

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get(
    '/tv/category/:category',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const page = request.query.page || 1;
      const category = request.params.category as 'popular' | 'top';

      if (category !== 'popular' && category !== 'top') {
        return reply.status(400).send({ error: `Invalid category: '${category}'. Expected 'popular' or 'top'` });
      }

      try {
        const result = category === 'popular' ? await tmdb.fetchPopularTv(page) : await tmdb.fetchTopShows(page);

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status ?? 500).send({ error: result.error });
        }


        const maxAge = category === 'popular' ? 24 : 168;

        return reply
          .header('Cache-Control', `public, s-maxage=${maxAge * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get('/tv/trending', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const page = request.query.page || 1;
    const timeWindow = request.query.timeWindow || 'week';

    if (timeWindow !== 'week' && timeWindow !== 'day') {
      return reply.status(400).send({ error: `Invalid timeWindow: '${timeWindow}'. Expected 'day' or 'week'` });
    }

    try {
      const result = await tmdb.fetchTrendingTv(timeWindow, page);

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      const maxAge = timeWindow === 'day' ? 6 : 24;

      return reply
        .header('Cache-Control', `public, s-maxage=${maxAge * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/tv/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    if (!id) return reply.status(400).send({ error: 'Missing required path parameter: id' });

    try {
      const result = await tmdb.fetchShowInfo(Number(id));

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${6 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/tv/:id/seasons/:season', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const { id, season } = request.params;

    if (!id) return reply.status(400).send({ error: 'Missing required path parameter: id' });
    if (!season) return reply.status(400).send({ error: 'Missing required path parameter: season' });

    try {
      const result = await tmdb.fetchTvEpisodes(Number(id), Number(season));

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  // TODO: add externalIds and additional info such as crew info
  fastify.get(
    '/tv/:id/seasons/:season/episodes/:episode',
    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      const { id, season, episode } = request.params;

      if (!id) return reply.status(400).send({ error: 'Missing required path parameter: id' });
      if (!season) return reply.status(400).send({ error: 'Missing required path parameter: season' });
      if (!episode) return reply.status(400).send({ error: 'Missing required path parameter: episode' });

      try {
        const result = await tmdb.fetchEpisodeInfo(Number(id), Number(season), Number(episode));

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status ?? 500).send({ error: result.error });
        }

        return reply
          .header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );


  fastify.get('/movies/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const { q, page = 1, year } = request.query;

    if (!q) return reply.status(400).send({ error: "Missing required query param: 'q'" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query string too long' });

    const releaseYear = year ? Number(year) : undefined;

    try {
      const result = await tmdb.searchMovie(q, page, releaseYear);

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get(
    '/movies/category/:category',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const page = request.query.page || 1;
      const category = request.params.category as 'popular' | 'top';

      if (category !== 'popular' && category !== 'top') {
        return reply.status(400).send({ error: `Invalid category: '${category}'. Expected 'popular' or 'top'` });
      }

      try {
        const result = category === 'popular' ? await tmdb.fetchPopularMovies(page) : await tmdb.fetchTopMovies(page);

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status ?? 500).send({ error: result.error });
        }


        const maxAge = category === 'popular' ? 24 : 168;

        return reply
          .header('Cache-Control', `public, s-maxage=${maxAge * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );

  fastify.get('/movies/trending', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const page = request.query.page || 1;
    const timeWindow = request.query.timeWindow || 'week';

    if (timeWindow !== 'week' && timeWindow !== 'day') {
      return reply.status(400).send({ error: `Invalid timeWindow: '${timeWindow}'. Expected 'day' or 'week'` });
    }

    try {
      const result = await tmdb.fetchTrendingMovies(timeWindow, page);

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      const maxAge = timeWindow === 'day' ? 6 : 24;

      return reply
        .header('Cache-Control', `public, s-maxage=${maxAge * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });

  fastify.get('/movies/:id', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    if (!id) return reply.status(400).send({ error: 'Missing required path parameter: id' });

    try {
      const result = await tmdb.fetchMovieInfo(Number(id));

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
      }
      if (result.error) {
        return reply.status(result.status ?? 500).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
    }
  });



  fastify.get(
    '/anime/category/:category',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const page = request.query.page || 1;
      const category = request.params.category as 'popular' | 'top' | 'seasonal' | 'weekly';

      if (!['popular', 'top', 'seasonal', 'weekly'].includes(category)) {
        return reply
          .status(400)
          .send({ error: `Invalid category: '${category}'. Expected 'popular', 'top', 'seasonal' or 'weekly'` });
      }

      try {
        let result;
        switch (category) {
          case 'popular':
            result = await tmdb.fetchPopularAnime(page);
            break;
          case 'top':
            result = await tmdb.fetchTopAnime(page);
            break;
          case 'seasonal':
            result = await tmdb.fetchSeasonalAnime(page);
            break;
          case 'weekly':
            result = await tmdb.fetchWeeklyAnime(page);
            break;
        }

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status ?? 500).send({ error: result.error });
        }

        return reply
          .header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );



  fastify.get(
    '/artworks/:category/:id',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const category = request.params.category as 'movie' | 'tv';
      const { id } = request.params;

      if (!id) return reply.status(400).send({ error: 'Missing required path parameter: id' });
      if (category !== 'movie' && category !== 'tv') {
        return reply.status(400).send({ error: `Invalid category: '${category}'. Expected 'movie' or 'tv'` });
      }

      try {
        const result =
          category === 'tv' ? await tmdb.fetchShowArtWorks(Number(id)) : await tmdb.fetchMovieArtWorks(Number(id));

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'External provider returned an invalid response(null)' });
        }
        if (result.error) {
          return reply.status(result.status ?? 500).send({ error: result.error });
        }

        return reply
          .header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: `Internal server error occurred: ${error}` });
      }
    },
  );
}
