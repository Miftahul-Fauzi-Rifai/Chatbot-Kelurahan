// utils/cache.js
// Cache utility dengan support Redis (Upstash) untuk Vercel
// Fallback ke in-memory untuk development

import crypto from 'crypto';

const DEFAULT_TTL_SEC = parseInt(process.env.CACHE_TTL_SEC || '21600', 10); // 6 jam
const MAX_ITEMS = parseInt(process.env.CACHE_MAX_ITEMS || '500', 10);
const CACHE_PREFIX = process.env.CACHE_PREFIX || 'v1';

let mode = 'memory';
let redis = null;

// ======== INISIALISASI REDIS (UPSTASH) =========
async function initRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) {
    console.log('📦 [CACHE] Using in-memory cache (Redis not configured)');
    return;
  }
  
  try {
    const { Redis } = await import('@upstash/redis');
    redis = new Redis({ url, token });
    mode = 'redis';
    console.log('✅ [CACHE] Connected to Upstash Redis');
    
    // Test connection
    await redis.ping();
  } catch (e) {
    console.warn('⚠️  [CACHE] Redis init failed, using in-memory:', e?.message || e);
    mode = 'memory';
    redis = null;
  }
}

// Auto-init pada import
initRedis();

// ======== IN-MEMORY STORE (FALLBACK) =========
const store = new Map(); // key -> { value, exp, ts }

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// ======== HELPER FUNCTIONS =========

/**
 * Normalize message untuk consistent cache key
 */
export function normalizeMessage(msg = '') {
  return String(msg)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate cache key dengan hash untuk menghindari key terlalu panjang
 */
export function makeCacheKey(message = '') {
  const normalized = normalizeMessage(message);
  if (!normalized) return null;
  
  // Hash untuk key yang konsisten dan tidak terlalu panjang
  const hash = crypto.createHash('sha1').update(normalized).digest('hex');
  return `${CACHE_PREFIX}:q:${hash}`;
}

/**
 * Get data dari cache (Redis atau memory)
 */
export async function getCache(key) {
  if (!key) return null;
  
  // Try Redis first
  if (mode === 'redis' && redis) {
    try {
      const data = await redis.get(key);
      if (data) {
        console.log(`✅ [CACHE HIT] Redis: ${key.substring(0, 20)}...`);
      }
      return data || null;
    } catch (err) {
      console.warn('⚠️  [CACHE] Redis get error:', err?.message);
      // Fallback to memory
    }
  }
  
  // Fallback to in-memory
  const item = store.get(key);
  if (!item) return null;
  
  // Check expiration
  if (nowSec() > item.exp) {
    store.delete(key);
    return null;
  }
  
  console.log(`✅ [CACHE HIT] Memory: ${key.substring(0, 20)}...`);
  return item.value;
}

/**
 * Set data ke cache (Redis atau memory)
 */
export async function setCache(key, value, ttlSec = DEFAULT_TTL_SEC) {
  if (!key || !value) return;
  
  // Try Redis first
  if (mode === 'redis' && redis) {
    try {
      await redis.set(key, value, { ex: ttlSec });
      console.log(`💾 [CACHE SET] Redis: ${key.substring(0, 20)}... (TTL: ${ttlSec}s)`);
      return;
    } catch (err) {
      console.warn('⚠️  [CACHE] Redis set error:', err?.message);
      // Fallback to memory
    }
  }
  
  // Fallback to in-memory with simple LRU
  if (store.size >= MAX_ITEMS) {
    const firstKey = store.keys().next().value;
    if (firstKey) {
      store.delete(firstKey);
      console.log(`🗑️  [CACHE] Evicted oldest item: ${firstKey.substring(0, 20)}...`);
    }
  }
  
  store.set(key, {
    value,
    exp: nowSec() + ttlSec,
    ts: Date.now()
  });
  
  console.log(`💾 [CACHE SET] Memory: ${key.substring(0, 20)}... (TTL: ${ttlSec}s)`);
}

/**
 * Clear all cache (hati-hati di production!)
 */
export async function clearCache() {
  if (mode === 'redis' && redis) {
    try {
      // Hapus semua key dengan prefix
      const keys = await redis.keys(`${CACHE_PREFIX}:*`);
      if (keys && keys.length > 0) {
        await redis.del(...keys);
        console.log(`🗑️  [CACHE] Cleared ${keys.length} Redis keys`);
      }
    } catch (err) {
      console.warn('⚠️  [CACHE] Clear error:', err?.message);
    }
  }
  
  store.clear();
  console.log('🗑️  [CACHE] Cleared in-memory cache');
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    mode,
    size: mode === 'redis' ? 'N/A (Redis)' : store.size,
    ttlSec: DEFAULT_TTL_SEC,
    maxItems: MAX_ITEMS,
    prefix: CACHE_PREFIX,
    ttlHuman: `${Math.floor(DEFAULT_TTL_SEC / 3600)}h ${Math.floor((DEFAULT_TTL_SEC % 3600) / 60)}m`
  };
}

// ======== EXPORT =========
export default {
  normalizeMessage,
  makeCacheKey,
  getCache,
  setCache,
  clearCache,
  getCacheStats
};
