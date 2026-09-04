import 'dotenv/config';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
  type RawServerDefault,
} from 'fastify';
import events from 'node:events';

import StaticRoutes from './routes/static.js';
import AnizoneRoutes from './routes/anime/anizone.js';
import AnikotoRoutes from './routes/anime/anikoto.js';
import AniDBRoutes from './routes/anime/anidb.js';
import AniBDRoutes from './routes/anime/anibd.js';
import AnimeHeavenRoutes from './routes/anime/animeheaven.js';
import AnilistRoutes from './routes/meta/anilist.js';
import KitsuRoutes from './routes/meta/kitsu.js';
import MyAnimeListRoutes from './routes/meta/mal.js';
import TheMovieDatabaseRoutes from './routes/meta/tmdb.js';
import NyaaRoutes from './routes/torrent/nyaa.js';
import { ratelimitOptions, rateLimitPlugIn } from './config/ratelimit.js';
import fastifyCors, { corsOptions } from './config/cors.js';
events.defaultMaxListeners = 25;

const API_KEY = process.env.API_KEY;

const app: FastifyInstance = Fastify({
  logger: {
    level: 'info',
    timestamp: () => `,"time":"${new Date().toLocaleString()}"`,
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
          'x-api-key': req.headers['x-api-key'] ? req.headers['x-api-key'] : 'Missing',
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
} as FastifyServerOptions<RawServerDefault>);

let appInitialized = false;

async function initializeApp() {
  if (appInitialized) {
    return;
  }
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith('/api')) {
      return;
    }

    if (!API_KEY) {
      return;
    }

    const apiKeyHeader = request.headers['x-api-key'];

    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;

    if (!apiKey || apiKey !== API_KEY) {
      return reply.code(401).send({
        error: 'Unauthorized',
      });
    }
  });

  await app.register(rateLimitPlugIn, ratelimitOptions);
  await app.register(fastifyCors, corsOptions);
  await app.register(AnilistRoutes, { prefix: '/api/anilist' });
  await app.register(MyAnimeListRoutes, { prefix: '/api/mal' });
  await app.register(KitsuRoutes, { prefix: '/api/kitsu' });
  await app.register(NyaaRoutes, { prefix: '/api/nyaa' });
  await app.register(AnikotoRoutes, { prefix: '/api/anikoto' });
  await app.register(AniDBRoutes, { prefix: '/api/anidb' });
  await app.register(AniBDRoutes, { prefix: '/api/anibd' });
  await app.register(AnizoneRoutes, { prefix: '/api/anizone' });
  await app.register(AnimeHeavenRoutes, { prefix: '/api/animeheaven' });
  await app.register(TheMovieDatabaseRoutes, { prefix: '/api/tmdb' });
  await app.register(StaticRoutes);

  appInitialized = true;
}

async function FastifyApp() {
  try {
    await initializeApp();
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';
    if (isNaN(port)) {
      console.error('Invalid PORT environment variable');
      process.exit(1);
    }
    await app.listen({
      host,
      port,
    });
    console.log(`🚀 Server listening on ${host}:${port}`);
  } catch (err) {
    console.error('Server startup error:', err);

    process.exit(1);
  }
}

const isServerless = process.env.SERVERLESSPLATFORM === 'TRUE';
if (!isServerless) {
  FastifyApp();
}

export default async function handler(request: FastifyRequest, reply: FastifyReply) {
  await initializeApp();
  await app.ready();
  app.server.emit('request', request, reply);
}
