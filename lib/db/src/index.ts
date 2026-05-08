import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// On Vercel (production): use NEON_DATABASE_URL (cloud Postgres, reachable from anywhere).
// On Replit (local dev): use DATABASE_URL (Replit-provisioned local Postgres, stable long-lived connection).
// Fallback chain ensures both environments work correctly.
const isVercel = !!process.env.VERCEL || !!process.env.VERCEL_ENV;

const connectionString = isVercel
  ? (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL)
  : (process.env.DATABASE_URL || process.env.NEON_DATABASE_URL);

if (!connectionString) {
  throw new Error(
    "No database URL found. Set NEON_DATABASE_URL (for Vercel/production) or DATABASE_URL (for local dev).",
  );
}

const isNeon = connectionString.includes("neon.tech");

export const pool = new Pool({
  connectionString,
  min: isVercel ? 0 : 1,
  max: isVercel ? 3 : 10,
  idleTimeoutMillis: isVercel ? 10_000 : 60_000,
  connectionTimeoutMillis: 5_000,
  keepAlive: !isVercel,
  keepAliveInitialDelayMillis: 10_000,
  ssl: isNeon || connectionString.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined,
});

// Prevent idle-connection drops from crashing the process.
// The pool will create a fresh connection on the next query automatically.
pool.on("error", (err) => {
  console.error("[db] Pool connection error (will reconnect on next query):", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
