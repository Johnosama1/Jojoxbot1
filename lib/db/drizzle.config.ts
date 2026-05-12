import { defineConfig } from "drizzle-kit";
import path from "path";

const connectionString =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("No database URL found. Set NEON_DATABASE_URL (for Vercel/production) or DATABASE_URL (for local dev).");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
