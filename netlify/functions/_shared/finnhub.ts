/**
 * Finnhub API client.
 * Free tier: 60 requests/minute. Generoso para noticias y quotes.
 */

const BASE_URL = 'https://finnhub.io/api/v1';

function getKey(): string {
  const key = process.env.FINNHUB_KEY;
  if (!key) throw new Error('FINNHUB_KEY not set');
  return key;
}

export interface NewsArticle {
  id: number;
  ticker: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  published_at: string;       // ISO
}

/**
 * Noticias de una compañía específica en un rango de fechas.
 */
export async function getCompanyNews(
  ticker: string,
  from: string,    // YYYY-MM-DD
  to: string,
): Promise<NewsArticle[]> {
  const url = `${BASE_URL}/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${getKey()}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as any[];

  return json.map((n) => ({
    id: n.id,
    ticker,
    headline: n.headline,
    summary: n.summary,
    source: n.source,
    url: n.url,
    published_at: new Date(n.datetime * 1000).toISOString(),
  }));
}

/**
 * Quote en tiempo real (free).
 */
export async function getFinnhubQuote(
  ticker: string,
): Promise<{ price: number; change_pct: number } | null> {
  const url = `${BASE_URL}/quote?symbol=${ticker}&token=${getKey()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as any;
  if (!json.c || json.c === 0) return null;

  return {
    price: json.c,
    change_pct: json.dp ?? 0,
  };
}

/**
 * Generador con throttle simple (free tier: 60/min, hacemos máximo 50/min).
 */
export async function throttledMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  delayMs: number = 1300,    // ~46 req/min
): Promise<R[]> {
  const results: R[] = [];
  for (const item of items) {
    results.push(await fn(item));
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}
