import { Router } from "express";

const router = Router();

/* Simple in-memory cache — refreshed every 60 s */
let cachedPrice: number | null = null;
let cacheAt = 0;
const CACHE_TTL = 60_000;

async function fetchTonPrice(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
    { signal: AbortSignal.timeout(7000) }
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json() as { "the-open-network"?: { usd?: number } };
  const price = data?.["the-open-network"]?.usd;
  if (!price || price <= 0) throw new Error("Invalid price");
  return price;
}

/* GET /api/price/ton */
router.get("/price/ton", async (_req, res) => {
  const now = Date.now();
  if (cachedPrice && now - cacheAt < CACHE_TTL) {
    res.json({ usd: cachedPrice, cached: true });
    return;
  }
  try {
    const price = await fetchTonPrice();
    cachedPrice = price;
    cacheAt = now;
    res.json({ usd: price, cached: false });
  } catch (err) {
    /* Serve stale cache if available, otherwise 502 */
    if (cachedPrice) {
      res.json({ usd: cachedPrice, cached: true, stale: true });
    } else {
      res.status(502).json({ error: "تعذّر جلب سعر TON" });
    }
  }
});

export default router;
