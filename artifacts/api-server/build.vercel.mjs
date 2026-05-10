import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, mkdir } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(artifactDir, "..", "..");

async function buildVercel() {
  // Output goes to repo root /api/ so Vercel finds it at /api/index.js
  const outDir = path.resolve(repoRoot, "api");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const start = Date.now();

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/vercel-entry.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "cjs",
    outdir: outDir,
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

  console.log(`Vercel build finished in ${Date.now() - start}ms → api/index.js`);
}

buildVercel().catch((err) => {
  console.error(err);
  process.exit(1);
});
