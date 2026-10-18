import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { AppError } from './utils/errors.js';
import { createLogger } from './utils/logger.js';
const env = loadEnv({
  MONGODB_URI: 'mongodb://unused',
  NODE_ENV: 'test',
  CORS_ORIGIN: 'http://localhost:5173',
});
const logger = createLogger('silent');
describe('app foundation', () => {
  const app = createApp(env, logger);
  it('GET /api/health reports degraded (503) when the database is not connected, with no business data', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', db: 'down' });
  });
  it('echoes a request id and sets helmet headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/[\w-]{8,}/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
  it('rejects malformed JSON with a 400, not a 500 or a stack trace', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });
  it('rejects oversized bodies (request size limit)', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
  });
  it('blocks a disallowed CORS origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://evil.example');
    expect(res.status).toBe(500); // cors() raised "Origin not allowed"; generic message only
    expect(res.body.error.message).not.toMatch(/evil/);
  });
});
describe('error handler', () => {
  const mini = express();
  mini.use(requestId);
  mini.get('/zod', () => {
    z.object({ name: z.string().min(2, 'Name is too short') }).parse({ name: 'a' });
  });
  mini.get('/app', () => {
    throw new AppError('DAY_CLOSED', 409, 'This day is closed.');
  });
  mini.get('/boom', () => {
    throw new Error('secret internal detail');
  });
  mini.use(createErrorHandler(logger, true));
  it('returns field-level validation errors', async () => {
    const res = await request(mini).get('/zod');
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual({ name: 'Name is too short' });
  });
  it('maps AppError to its status and code', async () => {
    const res = await request(mini).get('/app');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DAY_CLOSED');
  });
  it('never leaks internals on unexpected errors', async () => {
    const res = await request(mini).get('/boom');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/secret internal detail/);
  });
});
