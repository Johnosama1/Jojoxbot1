import { Router, type Request, type Response } from "express";

const router = Router();

const APP_URL = "https://jojoxbot-api-server.vercel.app";

router.get("/tonconnect-manifest.json", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    url: APP_URL,
    name: "Jojox Lucky Wheel",
    iconUrl: `${APP_URL}/bot-icon-circle.png`,
  });
});

export default router;
