/**
 * API client with token refresh (Step 1 requirement).
 * The auth layer (Firebase, Step 2) registers a token provider. On a 401 the client asks for a
 * FORCE-REFRESHED token and retries exactly once; a second 401 is surfaced as SESSION_EXPIRED
 * so the UI can send the user to sign in. Until Step 2 no provider is registered, so no
 * Authorization header is sent and nothing is faked.
 */

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type TokenProvider = (forceRefresh: boolean) => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;
let onSessionExpired: (() => void) | null = null;

export function configureAuth(provider: TokenProvider | null, expired?: () => void): void {
  tokenProvider = provider;
  onSessionExpired = expired ?? null;
}

/** One key per open form (rule 7). Send as the Idempotency-Key header on every create. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions, forceRefresh: boolean): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (tokenProvider) {
    const token = await tokenProvider(forceRefresh);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  try {
    return await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Network drop: human-readable, and safe to retry when an Idempotency-Key was sent.
    throw new ApiError(
      'NETWORK_ERROR',
      0,
      'Could not reach the server. Check the connection and try again.',
    );
  }
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts, false);
  if (res.status === 401 && tokenProvider) {
    res = await send(path, opts, true);
    if (res.status === 401) {
      onSessionExpired?.();
      throw new ApiError('SESSION_EXPIRED', 401, 'Your session has expired. Please sign in again.');
    }
  }
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = (
      data as {
        error?: {
          code?: string;
          message?: string;
          fields?: Record<string, string>;
          requestId?: string;
        };
      } | null
    )?.error;
    throw new ApiError(
      e?.code ?? 'HTTP_ERROR',
      res.status,
      e?.message ?? `Request failed (${res.status}).`,
      e?.fields,
      e?.requestId,
    );
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
