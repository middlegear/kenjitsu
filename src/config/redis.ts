import 'dotenv/config';
import { Redis } from 'ioredis';

const port = Number(process.env.REDIS_PORT);
const host = process.env.REDIS_HOST;
const password = process.env.REDIS_PASSWORD;

let isRedisAvailable = Boolean(host && password);

let redisInstance: Redis | null = null;

function initRedis() {
  if (!isRedisAvailable) return null;
  if (!redisInstance) {
    redisInstance = new Redis({
      host,
      port,
      password,
      tls: {},
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      enableReadyCheck: true,
    });

    redisInstance.on('connect', () => {
      isRedisAvailable = true;
      console.log('🟢 Redis connected');
    });

    redisInstance.on('error', err => {
      console.error('🔴 Redis error (disabling cache temporarily):', err.message);
      isRedisAvailable = false;
    });

    redisInstance.on('end', () => {
      isRedisAvailable = false;
      console.log('🟡 Redis connection closed');
    });
  }
  return redisInstance;
}

const redis = initRedis();

export async function checkRedis() {
  if (!isRedisAvailable || !redis) {
    console.warn('❌ Redis is disabled or unavailable.');
    return;
  }

  try {
    if (redis.status === 'end' || redis.status === 'wait') {
      await redis.connect();
    }
  } catch (err) {
    isRedisAvailable = false;
    console.error('❌ Redis Connection Failed, running without cache.');
  }
}

const DEFAULT_CACHE_EXPIRY_HOURS = 1;

/**
 * Sets a value in the cache (Redis) safely without crashing if down.
 */
async function redisSetCache<T>(key: string, value: T, ttlInHours: number = DEFAULT_CACHE_EXPIRY_HOURS): Promise<void> {
  if (!isRedisAvailable || !redis) return;

  try {
    const stringValue = JSON.stringify(value);
    if (ttlInHours === 0) {
      await redis.set(key, stringValue);
    } else {
      await redis.set(key, stringValue, 'EX', ttlInHours * 3600);
    }
  } catch (error) {
    isRedisAvailable = false;
    console.error('Cache set failed, continuing without Redis:', error);
  }
}

async function redisGetCache<T>(key: string): Promise<T | null> {
  if (!isRedisAvailable || !redis) return null;

  try {
    const data = await redis.get(key);
    if (data) {
      const value = JSON.parse(data) as T;
      console.log(`Cache hit (Redis) - Key: ${key}`);
      return value;
    }
    console.log(`Cache miss - Key: ${key}`);
  } catch (error) {
    isRedisAvailable = false;
    console.error('Cache get failed, continuing without Redis:', error);
  }
  return null;
}

/**
 * Purges a specific key or the entire cache safely.
 */
async function purgeCache(key?: string): Promise<void> {
  if (!isRedisAvailable || !redis) return;

  try {
    if (key) {
      await redis.del(key);
    } else {
      await redis.flushall();
    }
  } catch (error) {
    console.error('Cache purge failed:', error);
  }
}

export { redisGetCache, redisSetCache, purgeCache };
