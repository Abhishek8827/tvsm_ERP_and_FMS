/**
 * API client with token refresh (Step 1 requirement).
 * The auth layer (Firebase, Step 2) registers a token provider. On a 401 the client asks for a
 * FORCE-REFRESHED token and retries exactly once; a second 401 is surfaced as SESSION_EXPIRED
 * so the UI can send the user to sign in. Until Step 2 no provider is registered, so no
 * Authorization header is sent and nothing is faked.
 */
export class ApiError extends Error {
  code;
  status;
  fields;
  requestId;
  constructor(code, status, message, fields, requestId) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.requestId = requestId;
    this.name = 'ApiError';
  }
}
let tokenProvider = null;
let onSessionExpired = null;
export function configureAuth(provider, expired) {
  tokenProvider = provider;
  onSessionExpired = expired ?? null;
}
/** One key per open form (rule 7). Send as the Idempotency-Key header on every create. */
export function newIdempotencyKey() {
  return crypto.randomUUID();
}
// Short pauses before a retry. WHY: on a local or weak connection the first call after sign-in
// can fail for a moment (the proxy cannot reach the API for an instant, or Google's token
// service does not answer). A retry fixes it without the person having to refresh the page.
let retryDelays = [400, 1200];
/** Tests pass [] (no retry) or [0, 0] (instant retries). */
export function configureRetry(delays) {
  retryDelays = delays;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NETWORK_MESSAGE = 'Could not reach the server. Check the connection and try again.';
// 502/503/504 = a gateway could not get an answer from the API.
const GATEWAY = [502, 503, 504];
// A retry is only safe when repeating the call cannot do the work twice: reads, and writes
// that carry an Idempotency-Key.
const safeToRetry = (opts) =>
  (opts.method ?? 'GET').toUpperCase() === 'GET' || Boolean(opts.idempotencyKey);

/** The Firebase token, asking again when Google's token service is briefly unreachable. */
async function getToken(forceRefresh) {
  for (let i = 0; ; i += 1) {
    try {
      return await tokenProvider(forceRefresh);
    } catch (err) {
      const offline = err?.code === 'auth/network-request-failed';
      if (!offline) throw err;
      if (i >= retryDelays.length) throw new ApiError('NETWORK_ERROR', 0, NETWORK_MESSAGE);
      await wait(retryDelays[i]);
    }
  }
}

const BASE = import.meta.env.VITE_API_BASE_URL ?? '';
async function send(path, opts, forceRefresh) {
  const headers = { Accept: 'application/json' };
  if (opts.file) headers['Content-Type'] = 'application/octet-stream';
  else if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (tokenProvider) {
    const token = await getToken(forceRefresh);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  try {
    return await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      // `file` = a File chosen by the user, sent as raw bytes (Excel import).
      body: opts.file ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Network drop: human-readable, and safe to retry when an Idempotency-Key was sent.
    throw new ApiError('NETWORK_ERROR', 0, NETWORK_MESSAGE);
  }
}
/** One attempt, plus quiet retries on a network drop or a gateway error when that is safe. */
async function sendWithRetry(path, opts, forceRefresh) {
  // `opts.retryDelays` = a longer, one-after-another wait for a call that must survive the API
  // still starting up (the sign-in check). Tests that switched retries off keep them off.
  const delays = retryDelays.length ? (opts.retryDelays ?? retryDelays) : retryDelays;
  for (let i = 0; ; i += 1) {
    const last = i >= delays.length || !safeToRetry(opts);
    try {
      const res = await send(path, opts, forceRefresh);
      if (!GATEWAY.includes(res.status) || last) return res;
    } catch (err) {
      if (err?.code !== 'NETWORK_ERROR' || last) throw err;
    }
    await wait(delays[i]);
  }
}

export async function api(path, opts = {}) {
  let res = await sendWithRetry(path, opts, false);
  if (res.status === 401 && tokenProvider) {
    res = await sendWithRetry(path, opts, true);
    if (res.status === 401) {
      onSessionExpired?.();
      throw new ApiError('SESSION_EXPIRED', 401, 'Your session has expired. Please sign in again.');
    }
  }
  // `blob` = download a file (e.g. the Excel template) instead of reading JSON.
  if (opts.blob && res.ok) return res.blob();
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(
      e?.code ?? 'HTTP_ERROR',
      res.status,
      e?.message ?? `Request failed (${res.status}).`,
      e?.fields,
      e?.requestId,
    );
  }
  return data;
}
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
