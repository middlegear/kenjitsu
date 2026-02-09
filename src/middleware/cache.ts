import { redis } from '../config/redis.js'; // Redis is optional
import 'dotenv';

const DEFAULT_CACHE_EXPIRY_HOURS = 1;

/**
 * Sets a value in the cache (Redis) for permanent storage.
 * @param key your key to set cache
 * @param value  the data you want cached
 * @param ttlInHours =DEFAULT_CACHE_EXPIRY_HOURS] Set cache expiry in hours. Use value zero for permanent storage or set a value( default = 1(hour))
 */
async function redisSetCache<T>(key: string, value: T, ttlInHours: number = DEFAULT_CACHE_EXPIRY_HOURS): Promise<void> {
  const stringValue = JSON.stringify(value);

  if (redis) {
    // If ttlInHours is set to 0 or you want to set it as permanent
    if (ttlInHours === 0) {
      await redis.set(key, stringValue);
      console.log(`Data stored permanently in Redis (Key: ${key})`);
    } else {
      await redis.set(key, stringValue, 'EX', ttlInHours * 3600);
      console.log(`Data stored in Redis with TTL (Key: ${key}, TTL: ${ttlInHours} hours)`);
    }
  }
}

/**
 *  * @param key your key to retrieve data
 * Retrieves a value from the cache (Redis).
 */
async function redisGetCache<T>(key: string): Promise<T | null> {
  if (redis) {
    const data = await redis.get(key);
    if (data) {
      try {
        const value = JSON.parse(data) as T;
        console.log(`Cache hit (Redis) - Key: ${key}`);

        return value;
      } catch (error) {
        console.error('Error parsing JSON from Redis:', error);
        return null;
      }
    }
  }
  if (redis) {
    console.log(`Cache miss - Key: ${key}`);
  }
  return null;
}

/**
 * Purges a specific key or the entire cache (Redis and/or in-memory).
 */
async function purgeCache(key?: string): Promise<void> {
  if (redis) {
    if (key) {
      await redis.del(key);
      console.log(`Redis cache cleared for key: ${key}`);
    } else {
      await redis.flushall();
      console.log('Entire Redis cache has been purged');
    }
  }
}

export { redisGetCache, redisSetCache, purgeCache };
