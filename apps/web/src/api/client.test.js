import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, configureAuth, configureRetry } from './client';
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
describe('api client', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    configureAuth(null);
    configureRetry([]);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('sends the Idempotency-Key and parses JSON', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    const out = await api('/api/x', {
      method: 'POST',
      body: { a: 1 },
      idempotencyKey: 'k-1',
    });
    expect(out.ok).toBe(true);
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers['Idempotency-Key']).toBe('k-1');
  });
  it('refreshes the token once on 401, then succeeds', async () => {
    const provider = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('fresh');
    configureAuth(provider);
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'X', message: 'no' } }))
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(api('/api/me')).resolves.toEqual({ ok: 1 });
    expect(provider).toHaveBeenNthCalledWith(1, false);
    expect(provider).toHaveBeenNthCalledWith(2, true);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh');
  });
  it('signals session expiry after a second 401', async () => {
    const expired = vi.fn();
    configureAuth(vi.fn().mockResolvedValue('t'), expired);
    fetchMock.mockResolvedValue(json(401, {}));
    await expect(api('/api/me')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(expired).toHaveBeenCalledOnce();
  });
  it('exposes field-level errors from the server', async () => {
    fetchMock.mockResolvedValue(
      json(400, {
        error: { code: 'VALIDATION_ERROR', message: 'bad', fields: { name: 'Too short' } },
      }),
    );
    const err = await api('/api/x').catch((e) => e);
    expect(err.fields).toEqual({ name: 'Too short' });
  });
  it('turns a network failure into a readable error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(api('/api/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  describe('quiet retries', () => {
    beforeEach(() => configureRetry([0, 0]));

    it('a read that gets 502 first is retried and succeeds (no error shown)', async () => {
      fetchMock.mockResolvedValueOnce(json(502, {})).mockResolvedValueOnce(json(200, { ok: 1 }));
      await expect(api('/api/auth/me')).resolves.toEqual({ ok: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('a call can ask for a longer wait (the API still starting up) and then succeeds', async () => {
      fetchMock
        .mockResolvedValueOnce(json(502, {}))
        .mockResolvedValueOnce(json(502, {}))
        .mockResolvedValueOnce(json(502, {}))
        .mockResolvedValueOnce(json(502, {}))
        .mockResolvedValueOnce(json(200, { ok: 1 }));
      await expect(api('/api/auth/me', { retryDelays: [0, 0, 0, 0, 0] })).resolves.toEqual({
        ok: 1,
      });
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('a network drop is retried too, and gives up after the last retry', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      await expect(api('/api/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('a write WITHOUT an Idempotency-Key is never retried (it could be done twice)', async () => {
      fetchMock.mockResolvedValue(json(502, {}));
      await expect(api('/api/users', { method: 'POST', body: {} })).rejects.toMatchObject({
        status: 502,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('a write WITH an Idempotency-Key is retried safely', async () => {
      fetchMock.mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(201, { id: 'r1' }));
      await expect(
        api('/api/receipts', { method: 'POST', body: {}, idempotencyKey: 'k' }),
      ).resolves.toEqual({ id: 'r1' });
    });

    it('real server errors (500) are not retried', async () => {
      fetchMock.mockResolvedValue(json(500, { error: { code: 'X', message: 'boom' } }));
      await expect(api('/api/x')).rejects.toMatchObject({ status: 500 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("Firebase's token service being briefly unreachable is retried", async () => {
      const offline = Object.assign(new Error('x'), { code: 'auth/network-request-failed' });
      configureAuth(vi.fn().mockRejectedValueOnce(offline).mockResolvedValue('tok'));
      fetchMock.mockResolvedValue(json(200, { ok: 1 }));
      await expect(api('/api/me')).resolves.toEqual({ ok: 1 });
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    });

    it('if the token service stays down, the person sees a plain message, not a Firebase code', async () => {
      const offline = Object.assign(new Error('x'), { code: 'auth/network-request-failed' });
      configureAuth(vi.fn().mockRejectedValue(offline));
      await expect(api('/api/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });
  });
});
