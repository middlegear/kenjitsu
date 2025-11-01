import 'dotenv/config';

export const rateLimitPlugIn = import('@fastify/rate-limit');
const MINUTE_IN_MS = 60 * 1000;

export const ratelimitOptions = {
  timeWindow: (Number(process.env.WINDOW_IN_MINUTES) || 1) * MINUTE_IN_MS,
  max: Number(process.env.MAX_API_REQUESTS) || 120,
  global: true,
  ban: 1,
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },
};
