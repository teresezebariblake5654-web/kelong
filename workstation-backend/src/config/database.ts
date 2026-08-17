import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * Connection pool is controlled by DATABASE_URL query params set in env.ts:
 * connection_limit / pool_timeout / connect_timeout / sslmode.
 */
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: env.databaseUrl,
    },
  },
  log: env.isProduction ? ['error', 'warn'] : ['error', 'warn'],
});

export async function connectDatabase(): Promise<void> {
  const started = Date.now();
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  console.log(`Database connected in ${Date.now() - started}ms`);
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export async function checkDatabaseHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'unknown database error',
    };
  }
}
