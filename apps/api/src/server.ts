import { createApp } from './app';
import { loadEnv } from './config/env';
import { connectDb, disconnectDb } from './db';
import { createLogger } from './utils/logger';

async function main(): Promise<void> {
  const env = loadEnv(); // throws with a readable list if config is bad
  const logger = createLogger(env.LOG_LEVEL);
  await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME);
  logger.info('MongoDB connected');

  const app = createApp(env, logger);
  const server = app.listen(env.PORT, () => logger.info(`API listening on port ${env.PORT}`));

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
