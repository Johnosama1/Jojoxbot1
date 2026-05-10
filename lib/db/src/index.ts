import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// NEON_DATABASE_URL is the cloud Neon database — works on Vercel even when Replit is closed.
// DATABASE_URL is the Replit-provisioned local database — only available inside Replit.
// We always prefer NEON_DATABASE_URL so the Vercel deployment is fully independent.
const connectionString =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "No database URL found. Set NEON_DATABASE_URL (for Vercel/production) or DATABASE_URL (for local dev).",
  );
}

const isServerless =
  !!process.env.VERCEL ||
  !!process.env.VERCEL_ENV ||
  process.env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString,
  min: isServerless ? 0 : 1,
  max: isServerless ? 3 : 10,
  idleTimeoutMillis: isServerless ? 10_000 : 30_000,
  connectionTimeoutMillis: 5_000,
  keepAlive: !isServerless,
  keepAliveInitialDelayMillis: 10_000,
  ssl: connectionString.includes("neon.tech") || connectionString.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
