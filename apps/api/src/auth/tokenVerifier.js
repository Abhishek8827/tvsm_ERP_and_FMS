import { createHash } from 'node:crypto';

/**
 * Verifies a Firebase ID token on EVERY request (never trust anything the client says).
 *
 * WHY the short cache: checkRevoked=true asks Firebase on each call, which adds a network
 * round-trip to every request (our receipt target is under 1 second). A verified token is
 * remembered for at most 60 seconds, so a disabled or signed-out account is cut off within a
 * minute while normal requests stay fast. The cache key is a hash, so raw tokens are never kept.
 */
export function createTokenVerifier(auth, { ttlMs = 60_000, now = () => Date.now() } = {}) {
  const cache = new Map();

  return async function verifyToken(idToken) {
    const key = createHash('sha256').update(idToken).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.decoded;

    const decoded = await auth.verifyIdToken(idToken, true);
    const expMs = typeof decoded.exp === 'number' ? decoded.exp * 1000 : now() + ttlMs;
    cache.set(key, { decoded, until: Math.min(now() + ttlMs, expMs) });

    if (cache.size > 500) {
      for (const [k, v] of cache) if (v.until <= now()) cache.delete(k);
    }
    return decoded;
  };
}
