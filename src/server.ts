import 'dotenv/config';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import events from 'events';

import StaticRoutes from './routes/static.js';
import AnimekaiRoutes from './routes/anime/animekai.js';
import HianimeRoutes from './routes/anime/hianime.js';
import AnimepaheRoutes from './routes/anime/animepahe.js';
import KaidoRoutes from './routes/anime/kaido.js';
import AnizoneRoutes from './routes/anime/anizone.js';
import AnilistRoutes from './routes/meta/anilist.js';
import JikanRoutes from './routes/meta/jikan.js';
import HimoviesRoutes from './routes/movies/himovies.js';
import FlixHQRoutes from './routes/movies/flixhq.js';
import TheMovieDatabaseRoutes from './routes/meta/tmdb.js';

import { ratelimitOptions, rateLimitPlugIn } from './config/ratelimit.js';
import fastifyCors, { corsOptions } from './config/cors.js';
import { checkRedis } from './config/redis.js';

events.defaultMaxListeners = 25;

const app = Fastify({
  logger: {
    level: 'info',
    serializers: {
      req: req => ({
        method: req.method,
        url: req.url,
        query: req.query,
        params: req.params,
        ip: req.ip,
        ips: req.ips,
        headers: {
          'user-agent': req.headers['user-agent'],
        },
      }),
      error: error => ({
        type: error.name,
        message: error.message,
        stack: error.stack,
      }),
      res: res => ({
        statusCode: res.statusCode,
      }),
    },
  },
  routerOptions: {
    maxParamLength: 1000,
  },
});

async function FastifyApp() {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const userAgent = Array.isArray(request.headers['user-agent'])
      ? request.headers['user-agent'][0]
      : request.headers['user-agent'];

    if (!userAgent || typeof userAgent !== 'string' || userAgent.trim() === '') {
      request.log.error({ reqId: request.id }, 'Blocked Request');
      return reply.code(403).send({
        error: 'Forbidden',
      });
    }
  });

  app.register(rateLimitPlugIn, ratelimitOptions);

  await checkRedis();
  await app.register(fastifyCors, corsOptions);
  await app.register(StaticRoutes);
  await app.register(AnilistRoutes, { prefix: '/api/anilist' });
  await app.register(JikanRoutes, { prefix: '/api/jikan' });
  await app.register(AnimekaiRoutes, { prefix: '/api/animekai' });
  await app.register(HianimeRoutes, { prefix: '/api/hianime' });
  await app.register(KaidoRoutes, { prefix: '/api/kaido' });
  await app.register(AnimepaheRoutes, { prefix: '/api/animepahe' });
  await app.register(AnizoneRoutes, { prefix: '/api/anizone' });
  await app.register(FlixHQRoutes, { prefix: '/api/flixhq' });
  await app.register(HimoviesRoutes, { prefix: '/api/himovies' });
  await app.register(TheMovieDatabaseRoutes, { prefix: '/api/tmdb' });

  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    if (isNaN(port)) {
      console.error('Invalid PORT environment variable');
      process.exit(1);
    }

    await app.listen({ host, port });
  } catch (err) {
    console.error(`Server startup error:`, err);
    process.exit(1);
  }
}

FastifyApp();

let isReady = false;

export default async function handler(request: FastifyRequest, reply: FastifyReply) {
  if (!isReady) {
    await app.ready();
    isReady = true;
  }
  app.server.emit('request', request, reply);
}
