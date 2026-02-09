import 'dotenv/config';
import fastifyCors from '@fastify/cors';
import type { FastifyCorsOptions } from '@fastify/cors';

function resolveCorsOrigin(): true | string | string[] | undefined {
  const raw = process.env.ALLOWED_ORIGINS;

  if (!raw || raw === '*') return true;

  const origins = raw.split(',').map(origin => origin.trim());
  return origins.length === 1 ? origins[0] : origins;
}

export const corsOptions: FastifyCorsOptions = {
  origin: resolveCorsOrigin(),
  credentials: true,
  methods: ['GET'],
};

export default fastifyCors;
