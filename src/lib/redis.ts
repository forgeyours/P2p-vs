import Redis from 'ioredis';

class InMemoryRedis {
  private store = new Map<string, { value: any; expiry?: number }>();

  private isExpired(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return true;
    if (entry.expiry && entry.expiry < Date.now()) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) return null;
    const entry = this.store.get(key);
    if (!entry) return null;
    return typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
  }

  async set(key: string, value: string, ...args: any[]): Promise<'OK'> {
    let ttlMs: number | undefined;
    if (args[0] === 'EX' || args[0] === 'ex') {
      const seconds = parseInt(args[1], 10);
      if (!isNaN(seconds)) {
        ttlMs = seconds * 1000;
      }
    }
    const expiry = ttlMs ? Date.now() + ttlMs : undefined;
    this.store.set(key, { value, expiry });
    return 'OK';
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (this.isExpired(key)) {
      this.store.delete(key);
    }
    let entry = this.store.get(key);
    if (!entry || !(entry.value instanceof Set)) {
      entry = { value: new Set<string>() };
      this.store.set(key, entry);
    }
    const set = entry.value as Set<string>;
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    if (this.isExpired(key)) return [];
    const entry = this.store.get(key);
    if (!entry || !(entry.value instanceof Set)) return [];
    return Array.from(entry.value as Set<string>);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (this.isExpired(key)) return 0;
    const entry = this.store.get(key);
    if (!entry || !(entry.value instanceof Set)) return 0;
    const set = entry.value as Set<string>;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) {
        removed++;
      }
    }
    return removed;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.has(key)) {
        this.store.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    if (this.isExpired(key)) {
      this.store.delete(key);
    }
    let entry = this.store.get(key);
    if (!entry || !Array.isArray(entry.value)) {
      entry = { value: [] };
      this.store.set(key, entry);
    }
    const list = entry.value as string[];
    list.push(...values);
    return list.length;
  }

  async lrange(key: string, start: number, end: number): Promise<string[]> {
    if (this.isExpired(key)) return [];
    const entry = this.store.get(key);
    if (!entry || !Array.isArray(entry.value)) return [];
    const list = entry.value as string[];
    
    // Handle negative indices
    const len = list.length;
    let s = start < 0 ? len + start : start;
    let e = end < 0 ? len + end : end;
    
    if (s < 0) s = 0;
    if (e >= len) e = len - 1;
    if (s > e) return [];
    
    return list.slice(s, e + 1);
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiry = Date.now() + seconds * 1000;
    return 1;
  }

  on(event: string, callback: any) {
    // No-op for mock Redis events
  }
}

const globalForRedis = global as unknown as { redis: any };

function createRedisClient(): any {
  const url = process.env.KV_REDIS_URL;
  if (!url) {
    console.warn('KV_REDIS_URL is not set. Falling back to InMemoryRedis for local preview.');
    return new InMemoryRedis();
  }

  try {
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      connectTimeout: 3000,
    });

    // Handle connection errors gracefully without crashing the app server
    client.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    return client;
  } catch (err) {
    console.error('Failed to initialize Redis client, falling back to InMemoryRedis:', err);
    return new InMemoryRedis();
  }
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
