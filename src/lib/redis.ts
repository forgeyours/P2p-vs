import Redis from 'ioredis';

const globalForRedis = global as unknown as { redis: Redis | undefined };

// Define a singleton client instance for Redis, reusing the connection across serverless functions.
export const redis =
  globalForRedis.redis ??
  new Redis(process.env.KV_REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true, // Safe for build-time static generation and linting
    maxRetriesPerRequest: null,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
