/**
 * Alpha Vantage API client.
 * Free tier: 25 requests/day, 5 requests/min.
 * Usado primariamente para TOP_GAINERS_LOSERS y daily history.
 */

const BASE_URL = 'https://www.alphavantage.co/query';

function getKey(): string {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) throw new Error('ALPHA_VANTAGE_KEY not set');
  return key;
}

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TopMover {
  ticker: string;
  price: number;
  change_amount: number;
  change_percentage: number;
  volume: number;
}

/**
 * Devuelve top gainers, losers y most actively traded.
 * Endpoint: TOP_GAINERS_LOSERS (gratis, no consume mucha cuota).
 */
export async function getTopMovers(): Promise<{
  gainers: TopMover[];
  losers: TopMover[];
  most_active: TopMover[];
}> {
  const url = `${BASE_URL}?function=TOP_GAINERS_LOSERS&apikey=${getKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AlphaVantage error: ${res.status}`);
  const json = (await res.json()) as any;

  if (json.Information || json.Note) {
    throw new Error(`AlphaVantage rate limit: ${json.Information || json.Note}`);
  }

  const parse = (arr: any[] = []): TopMover[] =>
    arr.map((m) => ({
      ticker: m.ticker,
      price: parseFloat(m.price),
      change_amount: parseFloat(m.change_amount),
      change_percentage: parseFloat(String(m.change_percentage).replace('%', '')),
      volume: parseInt(m.volume, 10),
    }));

  return {
    gainers: parse(json.top_gainers),
    losers: parse(json.top_losers),
    most_active: parse(json.most_actively_traded),
  };
}

/**
 * Histórico diario (últimos ~100 días en compact mode).
 */
export async function getDailyHistory(
  ticker: string,
  outputsize: 'compact' | 'full' = 'compact',
): Promise<DailyBar[]> {
  const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=${outputsize}&apikey=${getKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AlphaVantage error: ${res.status}`);
  const json = (await res.json()) as any;

  if (json.Information || json.Note) {
    throw new Error(`AlphaVantage rate limit: ${json.Information || json.Note}`);
  }

  const series = json['Time Series (Daily)'];
  if (!series) return [];

  return Object.entries(series)
    .map(([date, bar]: [string, any]) => ({
      date,
      open: parseFloat(bar['1. open']),
      high: parseFloat(bar['2. high']),
      low: parseFloat(bar['3. low']),
      close: parseFloat(bar['4. close']),
      volume: parseInt(bar['5. volume'], 10),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Quote en tiempo real (latencia ~15 min en free tier).
 */
export async function getQuote(ticker: string): Promise<{ price: number; change_pct: number } | null> {
  const url = `${BASE_URL}?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${getKey()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as any;
  const q = json['Global Quote'];
  if (!q || !q['05. price']) return null;

  return {
    price: parseFloat(q['05. price']),
    change_pct: parseFloat(String(q['10. change percent']).replace('%', '')),
  };
}
