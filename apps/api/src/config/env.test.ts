import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('refuses to start without MONGODB_URI', () => {
    expect(() => loadEnv({ NODE_ENV: 'development' })).toThrow(/MONGODB_URI/);
  });
  it('applies safe defaults and parses the CORS allowlist', () => {
    const env = loadEnv({ MONGODB_URI: 'mongodb://x', CORS_ORIGIN: 'http://a.com, http://b.com' });
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGIN).toEqual(['http://a.com', 'http://b.com']);
    expect(env.ALLOW_SEED).toBe(false);
  });
  it('blocks seed data in production (decision X7)', () => {
    expect(() =>
      loadEnv({ MONGODB_URI: 'mongodb://x', NODE_ENV: 'production', ALLOW_SEED: 'true' }),
    ).toThrow(/ALLOW_SEED/);
  });
  it('rejects a bad port', () => {
    expect(() => loadEnv({ MONGODB_URI: 'mongodb://x', PORT: '99999' })).toThrow(/PORT/);
  });
});
