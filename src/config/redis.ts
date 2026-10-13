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

const redis = initRedis();

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

const DEFAULT_CACHE_EXPIRY_HOURS = 1;

/**
 * Sets a value in the cache (Redis).
 * @param key your key to set cache
 * @param value the data you want cached
 * @param ttlInHours Set cache expiry in hours. Use 0 for permanent storage (default = 1 hour)
 */
async function redisSetCache<T>(key: string, value: T, ttlInHours: number = DEFAULT_CACHE_EXPIRY_HOURS): Promise<void> {
  if (!redis) return;

  try {
    const stringValue = JSON.stringify(value);

    if (ttlInHours === 0) {
      await redis.set(key, stringValue);
      console.log(`Data stored permanently in Redis (Key: ${key})`);
    } else {
      await redis.set(key, stringValue, 'EX', ttlInHours * 3600);
      console.log(`Data stored in Redis with TTL (Key: ${key}, TTL: ${ttlInHours} hours)`);
    }
  } catch (error) {
    console.error(`Redis set failed (Key: ${key}):`, error instanceof Error ? error.message : error);
  }
}

/**
 * Retrieves a value from the cache (Redis).
 * @param key your key to retrieve data
 */
async function redisGetCache<T>(key: string): Promise<T | null> {
  if (!redis) return null;

  try {
    const data = await redis.get(key);

    if (!data) {
      console.log(`Cache miss - Key: ${key}`);
      return null;
    }

    const value = JSON.parse(data) as T;
    console.log(`Cache hit (Redis) - Key: ${key}`);
    return value;
  } catch (error) {
    console.error(`Redis get failed (Key: ${key}):`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Purges a specific key or the entire cache (Redis).
 */
async function purgeCache(key?: string): Promise<void> {
  if (!redis) return;

  try {
    if (key) {
      await redis.del(key);
      console.log(`Redis cache cleared for key: ${key}`);
    } else {
      await redis.flushall();
      console.log('Entire Redis cache has been purged');
    }
  } catch (error) {
    console.error('Redis purge failed:', error instanceof Error ? error.message : error);
  }
}

export { redisGetCache, redisSetCache, purgeCache };
