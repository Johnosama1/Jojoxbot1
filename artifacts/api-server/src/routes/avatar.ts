import { Router, type Request, type Response } from "express";
import TelegramBot from "node-telegram-bot-api";
import https from "https";
import http from "http";

const router = Router();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || "", { polling: false });

// Known developer Telegram user IDs
const KNOWN_IDS: Record<string, number> = {
  "J_O_H_N8": 2069046826,
};

const cache: Record<string, { data: Buffer; contentType: string; ts: number }> = {};
const TTL = 60 * 60 * 1000;

async function fetchBuffer(url: string): Promise<{ data: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({
        data: Buffer.concat(chunks),
        contentType: res.headers["content-type"] || "image/jpeg",
      }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

router.get("/avatar/:username", async (req: Request, res: Response) => {
  const username = String(req.params.username).replace(/^@/, "");
  const now = Date.now();

  if (cache[username] && now - cache[username].ts < TTL) {
    res.setHeader("Content-Type", cache[username].contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(cache[username].data); return;
  }

  try {
    const userId = KNOWN_IDS[username];
    if (!userId) { res.status(404).json({ error: "unknown user" }); return; }

    const photos = await bot.getUserProfilePhotos(userId, { limit: 1 });
    if (!photos.total_count || !photos.photos[0]?.length) {
      res.status(404).json({ error: "no photo" }); return;
    }

    // Pick the largest size
    const sizes = photos.photos[0];
    const best = sizes[sizes.length - 1];
    const link = await bot.getFileLink(best.file_id);
    const { data, contentType } = await fetchBuffer(link);

    cache[username] = { data, contentType, ts: now };
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(data);
  } catch (err) {
    res.status(404).json({ error: "not found" });
  }
});

export default router;
