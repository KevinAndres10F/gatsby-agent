/**
 * GET /api/performance
 * Métricas agregadas: hit rate, P&L, equity curve,
 * risk-adjusted metrics (Sharpe, Sortino, Calmar, max DD)
 * y comparación contra benchmark (SPY).
 */

import { getSupabase } from './_shared/supabase.ts';
import {
  computeAdvancedMetrics,
  compareToBenchmark,
  type EquityPoint,
} from './_shared/metrics.ts';

export default async () => {
  const supabase = getSupabase();

  const [perfRes, equityRes, recentTradesRes, benchRes] = await Promise.all([
    supabase.from('v_performance').select('*').single(),
    supabase
      .from('equity_snapshots')
      .select('date, total_value, daily_pnl_pct')
      .order('date', { ascending: true })
      .limit(365),
    supabase
      .from('trades')
      .select('ticker, direction, entry_date, exit_date, pnl_usd, pnl_pct, exit_reason, status')
      .eq('status', 'CLOSED')
      .order('exit_date', { ascending: false })
      .limit(20),
    supabase
      .from('benchmark_prices')
      .select('date, close')
      .eq('ticker', 'SPY')
      .order('date', { ascending: true })
      .limit(365),
  ]);

  const equity_curve = (equityRes.data ?? []) as EquityPoint[];
  const advanced = computeAdvancedMetrics(equity_curve);

  const benchmarkRows = (benchRes.data ?? []) as { date: string; close: number }[];
  const benchmark = compareToBenchmark(equity_curve, benchmarkRows);

  return new Response(
    JSON.stringify({
      performance: perfRes.data,
      advanced,
      equity_curve,
      benchmark,
      recent_closed_trades: recentTradesRes.data ?? [],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
};
