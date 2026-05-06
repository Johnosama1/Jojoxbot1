import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Keep at least 1 connection alive — eliminates cold-start latency on first query
  min: 1,
  max: 10,
  // Drop idle connections after 30 s to free server resources
  idleTimeoutMillis: 30_000,
  // Fail fast if DB is unreachable (default is no timeout)
  connectionTimeoutMillis: 3_000,
  // TCP keepalive so the connection survives long idle periods
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
