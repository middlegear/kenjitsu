import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Anilist } from '../../providers/meta/anilist.js';
import { allowedAnimeProviders, type FastifyParams, type FastifyQuery, IAMetaFormatArr } from '../../types/base.js';
import { type IMetaFormat, Seasons } from '../../types/meta/meta-anime.js';
import { Cinemeta } from '../../services/cinemeta-anime.js';
import { AnimeInfoResolver } from '../../services/anime-resolver.js';
import { AnimeTmdb } from '../../services/anime-tmdb.js';

const anilist = new Anilist();
const resolver = new AnimeInfoResolver();
export default async function AnilistRoutes(fastify: FastifyInstance) {
  fastify.get('/anime/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const { q, page = 1 } = request.query;
    if (!q) return reply.status(400).send({ error: "Missing 'q' parameter" });
    if (q.length > 1000) return reply.status(400).send({ error: 'Query too long' });

    let perPage = Math.min(Number(request.query.perPage) || 20, 50);

    try {
      const result = await anilist.search(q, 'ANIME', page, perPage);
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'Invalid response from AniList' });
      }
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
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
      const result = await anilist.fetchInfo(id, 'ANIME');

      if (!result || typeof result !== 'object') {
        return reply.status(502).send({
          error: 'Invalid response from AniList',
        });
      }

      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }

      const isFinished = result.data?.status?.toUpperCase() === 'FINISHED';

      const duration = isFinished ? 730 : 1;

      return reply
        .header('Cache-Control', `public, s-maxage=${duration * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  });

  fastify.get(
    '/anime/top/:category',

    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const page = Number(request.query.page) || 1;
      let perPage = Math.min(Number(request.query.perPage) || 20, 50);
      const category = request.params.category as 'airing' | 'trending' | 'upcoming' | 'popular' | 'rating';

      if (!['airing', 'trending', 'upcoming', 'popular', 'rating'].includes(category)) {
        return reply.status(400).send({ error: `Invalid category: ${category}` });
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
        }

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        const duration = ['airing', 'trending', 'upcoming'].includes(category) ? 24 : 336;

        return reply
          .header('Cache-Control', `public, s-maxage=${duration * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  fastify.get(
    '/anime/:id/characters',

    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      const id = Number(request.params.id);
      if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

      try {
        const result = await anilist.fetchCharacters(id);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        return reply
          .header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  fastify.get(
    '/anime/:id/related',

    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      const id = Number(request.params.id);
      if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

      try {
        const result = await anilist.fetchRelatedAnime(id);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        return reply
          .header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
  fastify.get('/anime/:id/episodes', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const id = request.params.id;
    if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

    try {
      const result = await new Cinemeta(resolver).fetchAnimeEpisode(Number(id));
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'Invalid response' });
      }
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }

      return (
        reply
          // .header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`) would disable caching this for  now
          .status(200)
          .send(result)
      );
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/anime/:id/franchise', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const id = request.params.id;
    if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

    try {
      const result = await anilist.fetchParentSeries(Number(id));
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'Invalid response' });
      }
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${720 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/anime/:id/meta', async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
    const id = request.params.id;
    if (!id) return reply.status(400).send({ error: "Missing 'id' parameter" });

    try {
      const result = await new AnimeTmdb(resolver).fetchAnimeMeta(Number(id));
      if (!result || typeof result !== 'object') {
        return reply.status(502).send({ error: 'Invalid response' });
      }
      if (result.error) {
        return reply.status(result.status as number).send({ error: result.error });
      }

      return reply
        .header('Cache-Control', `public, s-maxage=${1 * 60 * 60}, stale-while-revalidate=300`)
        .status(200)
        .send(result);
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get(
    'anime/:date/airingschedule',

    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const page = Number(request.query.page) || 1;
      const perPage = Number(request.query.perPage) || 20;
      const date = request.params.date;

      if (!date) return reply.status(400).send({ error: "Missing 'date' parameter" });
      if (!isValidDate(date)) return reply.status(400).send({ error: 'Invalid date format. Expected YYYY-MM-DD' });

      try {
        const result = await anilist.fetchAiringSchedule(date, page, perPage);
        if (result.error) {
          return reply.status(result.status as number).send(result);
        }

        return reply
          .header('Cache-Control', `public, s-maxage=${24 * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  fastify.get(
    '/anime/:id/schedule',

    async (request: FastifyRequest<{ Params: FastifyParams }>, reply: FastifyReply) => {
      const id = Number(request.params.id);
      if (isNaN(id) || !id) return reply.status(400).send({ error: "Missing or invalid 'id' parameter" });

      try {
        const result = await anilist.fetchMediaSchedule(id);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        return reply
          .header('Cache-Control', `public, s-maxage=${12 * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
  fastify.get(
    '/seasons/:season/:year',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const season = request.params.season as Seasons;
      const year = Number(request.params.year);
      const format = (request.query.format as IMetaFormat) || 'TV';
      const page = Number(request.query.page) || 1;
      let perPage = Math.min(Number(request.query.perPage) || 20, 50);

      if (!IAMetaFormatArr.includes(format)) {
        return reply.status(400).send({ error: `Invalid format: ${format}` });
      }
      if (!season || !year) {
        return reply.status(400).send({ error: 'Missing season or year' });
      }
      if (!Seasons.includes(season)) {
        return reply.status(400).send({ error: `Invalid season: ${season}` });
      }

      try {
        const result = await anilist.fetchSeasonalAnime(season, year, page, perPage, format);
        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }
        if (result.error) {
          return reply.status(result.status as number).send({ error: result.error });
        }

        return reply
          .header('Cache-Control', `public, s-maxage=${720 * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
  fastify.get(
    '/anime/:id/mappings',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      const id = Number(request.params.id);
      const provider = request.query.provider as 'anikoto' | 'anizone' | 'animeheaven' | 'kitsu';

      if (isNaN(id) || !id) {
        return reply.status(400).send({ error: "Missing or invalid 'id' parameter" });
      }
      if (!allowedAnimeProviders.includes(provider)) {
        return reply.status(400).send({ error: `Invalid provider '${provider}'` });
      }

      try {
        let result;
        switch (provider) {
          case 'anizone':
            result = await anilist.fetchAnizoneProviderId(id);
            break;
          case 'anikoto':
            result = await anilist.fetchAnikotoProviderId(id);
            break;

          case 'animeheaven':
            result = await anilist.fetchAnimeHeavenProviderId(id);
            break;
          case 'kitsu':
            result = await anilist.fetchKitsuProviderId(id);
            break;
          default:
            return reply.status(400).send({ error: `Invalid provider '${provider}'` });
        }

        if (!result || typeof result !== 'object') {
          return reply.status(502).send({ error: 'Invalid response from AniList' });
        }

        if (result.error) {
          return reply.status((result.status as number) || 500).send({ error: result.error });
        }

        return reply
          .header('Cache-Control', `public, s-maxage=${168 * 60 * 60}, stale-while-revalidate=300`)
          .status(200)
          .send(result);
      } catch (error) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}

function isValidDate(dateString: string): boolean {
  const regEx = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  if (!regEx.test(dateString)) return false;

  const date = new Date(dateString);
  const timestamp = date.getTime();

  if (typeof timestamp !== 'number' || isNaN(timestamp)) return false;

  return date.toISOString().startsWith(dateString);
}
