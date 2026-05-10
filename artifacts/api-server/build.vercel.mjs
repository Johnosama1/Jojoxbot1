import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, mkdir, rename } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(artifactDir, "..", "..");

async function buildVercel() {
  // Build to a temp dir first, then rename the main bundle to index.js
  // so Vercel auto-discovers it as the /api/* handler.
  // We cannot use entryNames:"index" directly because esbuild-plugin-pino
  // also emits an index.js worker, causing a path collision.
  const tmpDir = path.resolve(repoRoot, ".api-tmp");
  const outDir = path.resolve(repoRoot, "api");

  await rm(tmpDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const start = Date.now();

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/vercel-entry.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "cjs",
    outdir: tmpDir,
    logLevel: "info",

    minify: true,
    treeShaking: true,
    sourcemap: false,

    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],

    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],

    banner: {
      js: `const { createRequire: __bannerCrReq } = require('module');
const __bannerPath = require('path');
globalThis.require = __bannerCrReq(__filename);
globalThis.__dirname = __bannerPath.dirname(__filename);`,
    },
  });

  // Move all files from tmpDir → api/, renaming the main bundle to index.js
  const { readdir, copyFile } = await import("node:fs/promises");
  const tmpFiles = await readdir(tmpDir);
  for (const file of tmpFiles) {
    const destName = file === "vercel-entry.js" ? "index.js" : file;
    await copyFile(path.join(tmpDir, file), path.join(outDir, destName));
  }
  await rm(tmpDir, { recursive: true, force: true });

  console.log(`Vercel build finished in ${Date.now() - start}ms → api/index.js`);
}

buildVercel().catch((err) => {
  console.error(err);
  process.exit(1);
});
