import 'dotenv/config';
import MetaRoutes from './routes/meta/index.js';
import AnimeRoutes from './routes/anime/index.js';
import { notFoundRateLimiter, ratelimitOptions, ratelimitPlugin } from './config/ratelimit.js';
import Fastify from 'fastify';
import Cors from './config/cors.js';
import { purgeCache } from './middleware/cache.js';

const app = Fastify({ maxParamLength: 1000, logger: true });
async function FastifyApp() {
  //CORS
  await app.register(Cors);

  // API routes
  app.register(MetaRoutes, { prefix: '/api/meta' });
  app.register(AnimeRoutes, { prefix: '/api/anime' });
  app.get('/', async (request, reply) => {
    reply.status(200).send({ message: 'Available routes are /anime & /meta' });
  });

  // Rate limiting
  await app.register(ratelimitPlugin, ratelimitOptions);
  app.setNotFoundHandler(
    {
      preHandler: app.rateLimit(notFoundRateLimiter),
    },
    (request, reply) => {
      reply.code(404).send({ message: 'Slow Down Jamal' });
    },
  );

  // Server

  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOSTNAME || '127.0.0.1';

    if (isNaN(port)) {
      app.log.error('Invalid PORT environment variable');
      process.exit(1);
    }

    await app.listen({ host, port });
  } catch (err) {
    app.log.error(`Server startup error: ${err}`);
    process.exit(1);
  }
}
FastifyApp();
purgeCache();
export default async function handler(req: any, res: any) {
  await app.ready();
  app.server.emit('request', req, res);
}
