import { ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-store';
import pino from 'pino';

/**
 * Configuration factory for the StepFi API Cache layer.
 * 
 * Uses 'cache-manager-redis-store' (v3 compatible with Nest 10).
 * Defaults to localhost:6379 for local development.
 * 
 * TTL: Time to live in seconds (default: 300 - 5 minutes)
 */
export const getRedisConfig = async (configService: ConfigService): Promise<any> => {
  const isTest = process.env.NODE_ENV === 'test';
  const redisUrl = configService.get<string>('REDIS_URL');
  const ttl = configService.get<number>('REPUTATION_CACHE_TTL', 300);

  // If we are in test mode or no Redis URL is provided, fall back to in-memory store
  if (isTest || !redisUrl) {
    return {
      ttl,
    };
  }

  // Use Redis only if explicitly configured
  try {
    return {
      store: await redisStore({
        url: redisUrl,
        ttl,
      }),
      ttl,
    };
  } catch (error) {
    pino().warn({ error: error.message }, 'Failed to initialize Redis store, falling back to in-memory cache');
    return {
      ttl,
    };
  }
};
