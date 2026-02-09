import 'dotenv/config';
import { Redis } from 'ioredis';

const port = Number(process.env.REDIS_PORT);
const host = process.env.REDIS_HOST;
const password = process.env.REDIS_PASSWORD;

const isRedisEnabled = Boolean(host && password);

let redisInstance: Redis | null = null;

function initRedis() {
  if (!isRedisEnabled) return null;
  if (!redisInstance) {
    redisInstance = new Redis({
      host,
      port,
      password,
      tls: {},
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    redisInstance.on('connect', () => console.log('🟢 Redis connected'));
    redisInstance.on('error', err => console.error('🔴 Redis error:', err.message));
    redisInstance.on('end', () => console.log('🟡 Redis connection closed'));
  }
  return redisInstance;
}

export const redis = initRedis();

export async function checkRedis() {
  if (!redis) {
    console.warn('❌ Redis is disabled (missing environment variables).');
    return;
  }

  try {
    if (!redis.status || redis.status === 'end') {
      await redis.connect();
    }
  } catch (err) {
    console.error('❌ Redis Connection Failed:', err);
  }
}
