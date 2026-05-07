import { Router, type Request, type Response } from "express";

const router = Router();

function resolveAppUrl(req: Request): string {
  // 1. Replit dev — always correct public hostname
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }

  // 2. Vercel production — stable alias URL (preferred over per-deployment URL)
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  // 3. Vercel per-deployment URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  // 4. Explicit override (Replit production / custom domain)
  if (process.env.MINI_APP_URL) {
    try {
      const parsed = new URL(process.env.MINI_APP_URL);
      parsed.port = ""; // strip internal dev port
      return parsed.origin;
    } catch {
      return process.env.MINI_APP_URL.replace(/\/$/, "");
    }
  }

  // 5. Derive from request (works behind Replit/Vercel reverse proxy)
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost";
  return `${req.protocol}://${host}`;
}

router.get("/tonconnect-manifest.json", (req: Request, res: Response) => {
  const appUrl = resolveAppUrl(req);

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.json({
    url: appUrl,
    name: "Jojox Lucky Wheel",
    iconUrl: "https://i.ibb.co/gZgFjFmZ/cropped-circle-image-1.png",
  });
});

export default router;
