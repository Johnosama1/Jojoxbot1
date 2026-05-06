// Vercel Serverless Function — entry point for all /api/* requests
// Uses dynamic import() to load the ESM bundle (vercel-entry.mjs)

let _app = null;
let _initError = null;

// export default style handler (Vercel supports both module.exports and export default for CJS)
module.exports = async function handler(req, res) {
  // If a previous cold-start import failed, reset and retry
  if (_initError) {
    console.error("[vercel] Cached init error — retrying:", _initError?.message);
    _initError = null;
    res.status(503).send("Service starting up — please retry");
    return;
  }

  if (!_app) {
    try {
      console.log("[vercel] Cold start — loading app module...");
      const mod = await import("../artifacts/api-server/dist/vercel-entry.mjs");
      _app = mod.default;
      console.log("[vercel] App module loaded successfully");
    } catch (err) {
      console.error("[vercel] Failed to load app module:", err);
      _initError = err;
      res.status(503).send("Service unavailable");
      return;
    }
  }

  return _app(req, res);
};
