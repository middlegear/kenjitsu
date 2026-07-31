import 'dotenv/config';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import events from 'node:events';

import StaticRoutes from './routes/static.js';
import AnizoneRoutes from './routes/anime/anizone.js';
import AnilistRoutes from './routes/meta/anilist.js';
import TheMovieDatabaseRoutes from './routes/meta/tmdb.js';
import { ratelimitOptions, rateLimitPlugIn } from './config/ratelimit.js';
import fastifyCors, { corsOptions } from './config/cors.js';
import { checkRedis, purgeCache } from './config/redis.js';

import AnikotoRoutes from './routes/anime/anikoto.js';
import AniDBRoutes from './routes/anime/anidb.js';
import AnimeHeavenRoutes from './routes/anime/animeheaven.js';
import AniBDRoutes from './routes/anime/anibd.js';

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
        remoteAddress: req.socket.remoteAddress,
        remotePort: req.socket.remotePort,
        headers: {
          'user-agent': req.headers['user-agent'],
          'x-api-key': req.headers['x-api-key'],
          host: req.headers['host'],
          referer: req.headers['referer'],
          origin: req.headers['origin'],
          'x-forwarded-for': req.headers['x-forwarded-for'],
          'x-real-ip': req.headers['x-real-ip'],
          'cf-connecting-ip': req.headers['cf-connecting-ip'],
        },
      }),
      error: error => ({
        type: error.name,
        message: error.message,
        stack: error.stack,
      }),
      res: res => ({
        statusCode: res.statusCode,
        responseTime: res.elapsedTime,
      }),
    },
  },
  routerOptions: {
    maxParamLength: 1000,
  },
});

async function FastifyApp() {
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    const status = reply.statusCode;

    if (status !== 200) {
      reply.removeHeader('Cache-Control');
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      reply.header('Surrogate-Control', 'no-store');
    }

    // Remove rate limit headers for successful requests
    if (status === 200) {
      reply.removeHeader('x-ratelimit-remaining');
      reply.removeHeader('x-ratelimit-reset');
    }

    return payload;
  });
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    const status = reply.statusCode;

    if (status !== 200) {
      reply.removeHeader('Cache-Control');
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      reply.header('Surrogate-Control', 'no-store');
    }

    /// remove rate limit headers since plugin doesnt work
    if (status === 200) {
      // reply.removeHeader('x-ratelimit-limit');
      reply.removeHeader('x-ratelimit-remaining');
      reply.removeHeader('x-ratelimit-reset');
    }
    return payload;
  });

  await app.register(rateLimitPlugIn, ratelimitOptions);

  await checkRedis();
  await app.register(fastifyCors, corsOptions);

  await app.register(AnilistRoutes, { prefix: '/api/anilist' });
  await app.register(AnikotoRoutes, { prefix: '/api/anikoto' });
  await app.register(AniDBRoutes, { prefix: '/api/anidb' });
  await app.register(AniBDRoutes, { prefix: '/api/anibd' });
  await app.register(AnizoneRoutes, { prefix: '/api/anizone' });
  await app.register(AnimeHeavenRoutes, { prefix: '/api/animeheaven' });
  await app.register(TheMovieDatabaseRoutes, { prefix: '/api/tmdb' });
  await app.register(StaticRoutes);
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
// purgeCache();
