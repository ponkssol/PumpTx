let cache: { price: number; at: number } | null = null;
const TTL_MS = 60_000;

/**
 * Spot SOL/USD for dashboard volume estimate (cached across requests).
 * CoinGecko first; Binance SOLUSDT as fallback (both public, no API key).
 * @returns USD per 1 SOL, or null if all providers fail.
 */
export async function getSolUsdCached(): Promise<number | null> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return cache.price;
  }

  let price: number | null = null;

  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { headers: { Accept: 'application/json' } },
    );
    if (r.ok) {
      const j = (await r.json()) as { solana?: { usd?: number } };
      const p = j?.solana?.usd;
      if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
        price = p;
      }
    }
  } catch {
    /* try next */
  }

  if (price == null) {
    try {
      const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', {
        headers: { Accept: 'application/json' },
      });
      if (r.ok) {
        const j = (await r.json()) as { price?: string };
        const p = Number(j?.price);
        if (Number.isFinite(p) && p > 0) {
          price = p;
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (price != null && price > 0) {
    cache = { price, at: now };
    return price;
  }

  return cache?.price ?? null;
}
