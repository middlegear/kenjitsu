import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

export async function registerSwagger(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Documentation',
        version: '0.0.0',
      },
    },

    transform: ({ schema, url }) => {
      const hide = url === '/';

      return {
        url,
        schema: {
          ...(schema ?? {}),
          ...(hide ? { hide: true } : {}),
        },
      };
    },
  });

  await app.register(swaggerUI, {
    routePrefix: '/docs',
  });
}
