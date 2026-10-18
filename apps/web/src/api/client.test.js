import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, configureAuth } from './client';
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
describe('api client', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    configureAuth(null);
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
});
