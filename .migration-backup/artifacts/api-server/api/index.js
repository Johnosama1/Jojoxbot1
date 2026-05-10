// Vercel serverless entry point (CommonJS wrapper)
// Root Directory in Vercel is set to artifacts/api-server/
// This file is at artifacts/api-server/api/index.js

let _app = null;

module.exports = async function handler(req, res) {
  if (!_app) {
    const mod = await import("../dist/vercel-entry.mjs");
    _app = mod.default;
  }
  return _app(req, res);
};
