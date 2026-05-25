import 'dotenv/config';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import axios from 'axios';
import { redisGetCache, redisSetCache } from '../../middleware/cache.js';
import { ANIKOTO_DEFAULT_HEADERS, ANIKOTO_FILTER_OPTIONS } from '../../lib/anikoto/constants.js';
import { scrapeHome } from '../../lib/anikoto/scrapers/home.scraper.js';
import { scrapeAnimeDetail, scrapeAnimeEpisodes } from '../../lib/anikoto/scrapers/anime.scraper.js';
import { scrapeSearch, scrapeFilter, scrapeListingPage } from '../../lib/anikoto/scrapers/search.scraper.js';
import { scrapeSchedule } from '../../lib/anikoto/scrapers/schedule.scraper.js';
import { scrapeWatch } from '../../lib/anikoto/scrapers/watch.scraper.js';
import type { FilterParams } from '../../lib/anikoto/types.js';

// TTL values in hours (to match existing Kenjitsu caching pattern)
const TTL = {
  HOME: 5 / 60,       // 5 min
  ANIME: 0.5,         // 30 min
  EPISODE: 10 / 60,   // 10 min
  SEARCH: 2 / 60,     // 2 min
  FILTER: 5 / 60,     // 5 min
  SCHEDULE: 1,        // 1 hour
};

interface FastifyQuery {
  q?: string;
  keyword?: string;
  page?: string;
  refresh?: string;
  start?: string;
  end?: string;
  ep?: string;
  type?: string;
  sort?: string;
  'genre[]'?: string | string[];
  'season[]'?: string | string[];
  'year[]'?: string | string[];
  'type[]'?: string | string[];
  'status[]'?: string | string[];
  'language[]'?: string | string[];
  'rating[]'?: string | string[];
  url?: string;
  referer?: string;
}

interface FastifyParams {
  slug?: string;
  genre?: string;
  mediaType?: string;
}

function toArray(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export default async function AnikotoRoutes(fastify: FastifyInstance) {
  // ─── Home ────────────────────────────────────────────────────────────────
  fastify.get('/home', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${5 * 60}, stale-while-revalidate=60`);

    const refresh = request.query.refresh === '1';
    const cacheKey = 'anikoto:home';
    const cached = await redisGetCache(cacheKey);
    if (cached && !refresh) return reply.status(200).send({ ok: true, data: cached });

    try {
      const data = await scrapeHome();
      await redisSetCache(cacheKey, data, TTL.HOME);
      return reply.status(200).send({ ok: true, data });
    } catch (error) {
      request.log.error({ error }, 'Anikoto: failed to scrape home');
      return reply.status(500).send({ ok: false, message: `Internal server error: ${error}` });
    }
  });

  // ─── Search ───────────────────────────────────────────────────────────────
  fastify.get('/search', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${2 * 60}, stale-while-revalidate=60`);

    const keyword = (request.query.keyword ?? request.query.q ?? '').trim();
    const refresh = request.query.refresh === '1';

    if (!keyword) {
      return reply.status(400).send({ ok: false, message: 'keyword query parameter is required' });
    }
    if (keyword.length > 500) {
      return reply.status(400).send({ ok: false, message: 'keyword too long' });
    }

    const cacheKey = `anikoto:search:${keyword.toLowerCase()}`;
    const cached = await redisGetCache(cacheKey);
    if (cached && !refresh) return reply.status(200).send({ ok: true, data: cached });

    try {
      const data = await scrapeSearch(keyword);
      if (data.results.length > 0) await redisSetCache(cacheKey, data, TTL.SEARCH);
      return reply.status(200).send({ ok: true, data });
    } catch (error) {
      request.log.error({ error }, 'Anikoto: failed to scrape search');
      return reply.status(500).send({ ok: false, message: `Internal server error: ${error}` });
    }
  });

  // ─── Filter ───────────────────────────────────────────────────────────────
  fastify.get('/filter', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${5 * 60}, stale-while-revalidate=60`);

    const refresh = request.query.refresh === '1';
    const rawQuery = request.query;

    const params: FilterParams = {
      keyword: (rawQuery.keyword as string | undefined) ?? undefined,
      genre: toArray(rawQuery['genre[]'] as string | string[] | undefined),
      season: toArray(rawQuery['season[]'] as string | string[] | undefined),
      year: toArray(rawQuery['year[]'] as string | string[] | undefined),
      type: toArray(rawQuery['type[]'] as string | string[] | undefined),
      status: toArray(rawQuery['status[]'] as string | string[] | undefined),
      language: toArray(rawQuery['language[]'] as string | string[] | undefined),
      rating: toArray(rawQuery['rating[]'] as string | string[] | undefined),
      sort: (rawQuery.sort as string | undefined) ?? undefined,
      page: (rawQuery.page as string | undefined) ?? '1',
    };

    // Remove empty arrays
    (Object.keys(params) as (keyof FilterParams)[]).forEach(k => {
      const val = params[k];
      if (Array.isArray(val) && val.length === 0) delete params[k];
    });

    const cacheKey = `anikoto:filter:${JSON.stringify(params)}`;
    const cached = await redisGetCache(cacheKey);
    if (cached && !refresh) return reply.status(200).send({ ok: true, data: cached });

    try {
      const data = await scrapeFilter(params);
      (data as any).options = ANIKOTO_FILTER_OPTIONS;
      await redisSetCache(cacheKey, data, TTL.FILTER);
      return reply.status(200).send({ ok: true, data });
    } catch (error) {
      request.log.error({ error }, 'Anikoto: failed to scrape filter');
      return reply.status(500).send({ ok: false, message: `Internal server error: ${error}` });
    }
  });

  // ─── Schedule ─────────────────────────────────────────────────────────────
  fastify.get('/schedule', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${60 * 60}, stale-while-revalidate=300`);

    const refresh = request.query.refresh === '1';
    const cacheKey = 'anikoto:schedule';
    const cached = await redisGetCache(cacheKey);
    if (cached && !refresh) return reply.status(200).send({ ok: true, data: cached });

    try {
      const data = await scrapeSchedule();
      await redisSetCache(cacheKey, data, TTL.SCHEDULE);
      return reply.status(200).send({ ok: true, data });
    } catch (error) {
      request.log.error({ error }, 'Anikoto: failed to scrape schedule');
      return reply.status(500).send({ ok: false, message: `Internal server error: ${error}` });
    }
  });

  // ─── Latest / Most-viewed / New-release listings ─────────────────────────
  fastify.get('/latest', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${5 * 60}, stale-while-revalidate=60`);

    const VALID_TYPES: Record<string, string> = {
      'latest-updated': '/latest-updated',
      'new-release': '/new-release',
      'most-viewed': '/most-viewed',
    };

    const type = (request.query.type as string) ?? 'latest-updated';
    const page = parseInt((request.query.page as string) ?? '1', 10);
    const refresh = request.query.refresh === '1';

    if (!VALID_TYPES[type]) {
      return reply.status(400).send({
        ok: false,
        message: `type must be one of: ${Object.keys(VALID_TYPES).join(', ')}`,
      });
    }

    const cacheKey = `anikoto:listing:${type}:${page}`;
    const cached = await redisGetCache(cacheKey);
    if (cached && !refresh) return reply.status(200).send({ ok: true, data: cached });

    try {
      const data = await scrapeListingPage(VALID_TYPES[type]!, page);
      await redisSetCache(cacheKey, data, TTL.HOME);
      return reply.status(200).send({ ok: true, data });
    } catch (error) {
      request.log.error({ error }, 'Anikoto: failed to scrape latest');
      return reply.status(500).send({ ok: false, message: `Internal server error: ${error}` });
    }
  });

  // ─── By Status ────────────────────────────────────────────────────────────
  fastify.get('/status', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    reply.header('Cache-Control', `public, s-maxage=${5 * 60}, stale-while-revalidate=60`);

    const STATUS_PATHS: Record<string, string> = {
      'currently-airing': '/status/currently-airing',
      'finished-airing': '/status/finished-airing',
      'not-yet-aired': '/status/not-yet-aired',
    };

    const type = (request.query.type as string) ?? 'currently-airing';
    const page = parseInt((request.query.page as string) ?? '1', 10);
    const refresh = request.query.refresh === '1';

    if (!STATUS_PATHS[type]) {
      return reply.status(400).send({
        ok: false,
        message: `type must be one of: ${Object.keys(STATUS_PATHS).join(', ')}`,
      });
    }

    const cacheKey = `anikoto:status:${type}:${page}`;
    const cached = await redisGetCache(cacheKey);
    if (cached && !refresh) return reply.status(200).send({ ok: true, data: cached });

    try {
      const data = await scrapeListingPage(STATUS_PATHS[type]!, page);
      await redisSetCache(cacheKey, data, TTL.FILTER);
      return reply.status(200).send({ ok: true, data });
    } catch (error) {
      request.log.error({ error }, 'Anikoto: failed to scrape status listing');
      return reply.status(500).send({ ok: false, message: `Internal server error: ${error}` });
    }
  });

  // ─── By Genre ─────────────────────────────────────────────────────────────
  fastify.get(
    '/genre/:genre',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${5 * 60}, stale-while-revalidate=60`);

      const genre = request.params.genre;
      const page = parseInt((request.query.page as string) ?? '1', 10);
      const refresh = request.query.refresh === '1';

      if (!genre) {
        return reply.status(400).send({ ok: false, message: 'genre is required' });
      }

      const cacheKey = `anikoto:genre:${genre}:${page}`;
      const cached = await redisGetCache(cacheKey);
      if (cached && !refresh) return reply.status(200).send({ ok: true, data: cached });

      try {
        const data = await scrapeListingPage(`/genre/${genre}`, page);
        await redisSetCache(cacheKey, data, TTL.FILTER);
        return reply.status(200).send({ ok: true, data: { ...data, genre } });
      } catch (error) {
        request.log.error({ error }, 'Anikoto: failed to scrape genre listing');
        return reply.status(500).send({ ok: false, message: `Internal server error: ${error}` });
      }
    },
  );

  // ─── By Media Type ────────────────────────────────────────────────────────
  const VALID_MEDIA_TYPES = ['tv', 'movie', 'ova', 'ona', 'special', 'music'];

  fastify.get(
    '/type/:mediaType',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${5 * 60}, stale-while-revalidate=60`);

      const mediaType = request.params.mediaType?.toLowerCase();
      const page = parseInt((request.query.page as string) ?? '1', 10);
      const refresh = request.query.refresh === '1';

      if (!mediaType || !VALID_MEDIA_TYPES.includes(mediaType)) {
        return reply.status(400).send({
          ok: false,
          message: `type must be one of: ${VALID_MEDIA_TYPES.join(', ')}`,
        });
      }

      const cacheKey = `anikoto:type:${mediaType}:${page}`;
      const cached = await redisGetCache(cacheKey);
      if (cached && !refresh) return reply.status(200).send({ ok: true, data: cached });

      try {
        const data = await scrapeListingPage(`/type/${mediaType}`, page);
        await redisSetCache(cacheKey, data, TTL.FILTER);
        return reply.status(200).send({ ok: true, data: { ...data, mediaType } });
      } catch (error) {
        request.log.error({ error }, 'Anikoto: failed to scrape type listing');
        return reply.status(500).send({ ok: false, message: `Internal server error: ${error}` });
      }
    },
  );

  // ─── Anime Detail ─────────────────────────────────────────────────────────
  fastify.get(
    '/anime/:slug',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${30 * 60}, stale-while-revalidate=300`);

      const slug = request.params.slug;
      const refresh = request.query.refresh === '1';

      if (!slug) {
        return reply.status(400).send({ ok: false, message: 'slug is required' });
      }

      const cacheKey = `anikoto:anime:${slug}`;
      const cached = await redisGetCache(cacheKey);
      if (cached && !refresh) return reply.status(200).send({ ok: true, data: cached });

      try {
        const data = await scrapeAnimeDetail(slug);
        await redisSetCache(cacheKey, data, TTL.ANIME);
        return reply.status(200).send({ ok: true, data });
      } catch (error) {
        request.log.error({ error, slug }, 'Anikoto: failed to scrape anime detail');
        return reply.status(500).send({ ok: false, message: `Internal server error: ${error}` });
      }
    },
  );

  // ─── Episode List ─────────────────────────────────────────────────────────
  fastify.get(
    '/anime/:slug/episodes',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${10 * 60}, stale-while-revalidate=60`);

      const slug = request.params.slug;
      const refresh = request.query.refresh === '1';

      if (!slug) {
        return reply.status(400).send({ ok: false, message: 'slug is required' });
      }

      const startRaw = request.query.start as string | undefined;
      const endRaw = request.query.end as string | undefined;

      let startEpisode: number | undefined;
      let endEpisode: number | undefined;
      let cacheKey = `anikoto:episodes:${slug}`;

      if (startRaw && endRaw) {
        const s = parseInt(startRaw, 10);
        const e = parseInt(endRaw, 10);
        if (!isNaN(s) && !isNaN(e) && s > 0 && e > 0 && s <= e) {
          startEpisode = s;
          endEpisode = e;
          cacheKey += `:${s}-${e}`;
        } else {
          return reply.status(400).send({
            ok: false,
            message: 'Invalid episode range. start and end must be positive integers with start <= end.',
          });
        }
      }

      const cached = await redisGetCache(cacheKey);
      if (cached && !refresh) return reply.status(200).send({ ok: true, data: cached });

      try {
        const data = await scrapeAnimeEpisodes(slug, startEpisode, endEpisode);
        await redisSetCache(cacheKey, data, TTL.EPISODE);
        return reply.status(200).send({ ok: true, data });
      } catch (error) {
        request.log.error({ error, slug }, 'Anikoto: failed to scrape episodes');
        return reply.status(500).send({ ok: false, message: `Internal server error: ${error}` });
      }
    },
  );

  // ─── Watch (servers + sources + m3u8) ────────────────────────────────────
  fastify.get(
    '/watch/:slug',
    async (request: FastifyRequest<{ Querystring: FastifyQuery; Params: FastifyParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', `public, s-maxage=${10 * 60}, stale-while-revalidate=60`);

      const slug = request.params.slug;
      const epNum = (request.query.ep as string) || '1';
      const refresh = request.query.refresh === '1';

      if (!slug) {
        return reply.status(400).send({ ok: false, message: 'slug is required' });
      }

      const cacheKey = `anikoto:watch:${slug}:${epNum}`;
      const cached = await redisGetCache(cacheKey);
      if (cached && !refresh) return reply.status(200).send({ ok: true, data: cached });

      try {
        const data = await scrapeWatch(slug, epNum);
        await redisSetCache(cacheKey, data, TTL.EPISODE);
        return reply.status(200).send({ ok: true, data });
      } catch (error) {
        request.log.error({ error, slug, epNum }, 'Anikoto: failed to scrape watch data');
        return reply.status(500).send({ ok: false, message: `Internal server error: ${error}` });
      }
    },
  );

  // ─── m3u8 Proxy ──────────────────────────────────────────────────────────
  fastify.get('/proxy', async (request: FastifyRequest<{ Querystring: FastifyQuery }>, reply: FastifyReply) => {
    const targetUrl = request.query.url as string | undefined;
    const referer = request.query.referer as string | undefined;

    if (!targetUrl) {
      return reply.status(400).send({ ok: false, message: 'Missing url parameter' });
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent': ANIKOTO_DEFAULT_HEADERS['User-Agent'],
        Accept: '*/*',
      };

      if (referer) {
        headers['Referer'] = referer;
        try {
          headers['Origin'] = new URL(referer).origin;
        } catch {
          // ignore bad referer
        }
      }

      const response = await axios.get(targetUrl, {
        responseType: 'arraybuffer',
        headers,
        timeout: 15_000,
      });

      const contentType = (response.headers['content-type'] as string) || 'application/octet-stream';
      let responseData = response.data as Buffer;

      // Rewrite m3u8 playlists to proxy all segments through this endpoint
      if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl')) {
        const text = Buffer.from(responseData).toString('utf-8');
        const baseUrl = new URL(targetUrl);

        const rewrittenText = text
          .split('\n')
          .map(line => {
            if (line.includes('URI=')) {
              line = line.replace(/URI=["']([^"']+)["']/g, (_match: string, uri: string) => {
                let keyUrl = uri;
                if (!keyUrl.startsWith('http')) keyUrl = new URL(keyUrl, baseUrl).toString();
                const proxied = `/api/anikoto/proxy?url=${encodeURIComponent(keyUrl)}&referer=${encodeURIComponent(referer ?? '')}`;
                return `URI="${proxied}"`;
              });
            }
            if (line.startsWith('#') || !line.trim()) return line;

            let segmentUrl = line.trim();
            if (!segmentUrl.startsWith('http')) segmentUrl = new URL(segmentUrl, baseUrl).toString();
            return `/api/anikoto/proxy?url=${encodeURIComponent(segmentUrl)}&referer=${encodeURIComponent(referer ?? '')}`;
          })
          .join('\n');

        responseData = Buffer.from(rewrittenText, 'utf-8');
      }

      reply.header('Content-Type', contentType);
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cache-Control', 'no-cache');
      return reply.status(200).send(responseData);
    } catch (err: unknown) {
      const status = (err as any)?.response?.status || 500;
      request.log.error({ err, targetUrl }, `Anikoto proxy error: ${status}`);
      return reply.status(status).send({ ok: false, message: 'Proxy request failed' });
    }
  });
}
