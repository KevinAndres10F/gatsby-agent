// Helper de fetch para los endpoints de Netlify Functions
const BASE = '/api';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`API ${path} ${res.status}`);
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? `API ${path} ${res.status}`);
  }
  return res.json();
}

// =============== Types ===============
export interface Signal {
  id: number;
  ticker: string;
  date: string;
  generated_at: string;
  score: number;
  direction: 'LONG' | 'SHORT' | 'HOLD';
  conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  position_size_pct: number;
  technical_score: number;
  sentiment_score: number;
  rationale: string;
  executed: boolean;
  trades?: { id: number; status: string; pnl_usd: number; pnl_pct: number; exit_reason: string }[];
}

export interface Position {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number;
  shares: number;
  capital_used: number;
  stop_loss: number;
  take_profit: number;
  entry_date: string;
  current_price: number | null;
  floating_pnl_usd: number | null;
  floating_pnl_pct: number | null;
}

export interface PortfolioState {
  portfolio: {
    initial_capital: number;
    cash: number;
    positions_value: number;
    total_value: number;
    total_return_pct: number;
  };
  positions: Position[];
}

export interface Performance {
  performance: {
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    avg_pnl_pct: number;
    total_pnl_usd: number;
    hit_rate_pct: number;
  };
  equity_curve: { date: string; total_value: number; daily_pnl_pct: number }[];
  recent_closed_trades: any[];
}

// =============== Format utils ===============
export const fmtUsd = (v: number | null | undefined) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);

export const fmtPct = (v: number | null | undefined, decimals = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;

export const fmtNum = (v: number | null | undefined, decimals = 2) =>
  v == null ? '—' : v.toFixed(decimals);

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES');
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
