import 'dotenv/config';
import { Redis } from 'ioredis';

const port = Number(process.env.REDIS_PORT || 6379);
const host = process.env.REDIS_HOST;
const password = process.env.REDIS_PASSWORD;

const redisEnabled = Boolean(host && password);

let redisInstance: Redis | null = null;
let redisConnecting: Promise<Redis | null> | null = null;

function createRedis(): Redis | null {
  if (!redisEnabled) {
    return null;
  }

  const redis = new Redis({
    host,
    port,
    password,
    tls: {},
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    retryStrategy: null,
    reconnectOnError: () => false,
    enableReadyCheck: true,
  });

  redis.on('ready', () => {
    console.log('🟢 Redis ready');
  });

  redis.on('connect', () => {
    console.log('🟢 Redis connected');
  });

  redis.on('error', err => {
    console.error('🔴 Redis error:', err.message);
  });

  redis.on('close', () => {
    console.log('🟡 Redis connection closed');
  });

  redis.on('end', () => {
    console.log('🟡 Redis connection ended');
  });

  return redis;
}

async function getRedis(): Promise<Redis | null> {
  if (!redisEnabled) {
    return null;
  }

  if (!redisInstance) {
    redisInstance = createRedis();
  }

  if (!redisInstance) {
    return null;
  }

  if (redisInstance.status === 'ready') {
    return redisInstance;
  }

  if (redisInstance.status === 'connecting') {
    return redisInstance;
  }

  if (redisInstance.status === 'end' || redisInstance.status === 'wait') {
    if (!redisConnecting) {
      redisConnecting = redisInstance
        .connect()
        .then(() => redisInstance)
        .catch(error => {
          console.error('❌ Redis unavailable, continuing without cache:', error instanceof Error ? error.message : error);

          return null;
        })
        .finally(() => {
          redisConnecting = null;
        });
    }

    return redisConnecting;
  }

  return redisInstance;
}

export async function checkRedis(): Promise<boolean> {
  const redis = await getRedis();

  if (!redis) {
    return false;
  }

  try {
    await redis.ping();
    return true;
  } catch (error) {
    console.error('❌ Redis health check failed:', error instanceof Error ? error.message : error);

    return false;
  }
}

const DEFAULT_CACHE_EXPIRY_HOURS = 1;

/**
 * Sets a value in Redis safely.
 *
 * Redis is only an optional cache. A Redis failure must never fail
 * the actual API request.
 */
async function redisSetCache<T>(key: string, value: T, ttlInHours: number = DEFAULT_CACHE_EXPIRY_HOURS): Promise<void> {
  const redis = await getRedis();

  if (!redis) {
    return;
  }

  try {
    const stringValue = JSON.stringify(value);

    if (ttlInHours === 0) {
      await redis.set(key, stringValue);
    } else {
      await redis.set(key, stringValue, 'EX', Math.max(1, Math.floor(ttlInHours * 3600)));
    }
  } catch (error) {
    console.error('⚠️ Redis cache set failed:', error instanceof Error ? error.message : error);
  }
}

async function redisGetCache<T>(key: string): Promise<T | null> {
  const redis = await getRedis();

  if (!redis) {
    return null;
  }

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
    console.error('⚠️ Redis cache get failed:', error instanceof Error ? error.message : error);

    return null;
  }
}

/**
 * Purges a specific key or the entire cache safely.
 */
async function purgeCache(key?: string): Promise<void> {
  const redis = await getRedis();

  if (!redis) {
    return;
  }

  try {
    if (key) {
      await redis.del(key);
    } else {
      await redis.flushall();
    }
  } catch (error) {
    console.error('⚠️ Redis cache purge failed:', error instanceof Error ? error.message : error);
  }
}

export { redisGetCache, redisSetCache, purgeCache };
