import { Router, type Request, type Response } from "express";

const router = Router();

function resolveAppUrl(req: Request): string {
  // Prefer REPLIT_DEV_DOMAIN — always the correct public hostname in Replit dev
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }

  // MINI_APP_URL may include a port (internal dev port) — strip it
  if (process.env.MINI_APP_URL) {
    try {
      const parsed = new URL(process.env.MINI_APP_URL);
      parsed.port = "";
      return parsed.origin; // https://hostname (no port, no trailing slash)
    } catch {
      return process.env.MINI_APP_URL.replace(/\/$/, "");
    }
  }

  // Fallback: derive from request host (works behind Replit reverse proxy)
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
    iconUrl: `${appUrl}/bot-icon-circle.png`,
  });
});

export default router;
