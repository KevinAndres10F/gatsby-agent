/**
 * POST /api/backtest-runs
 * Lista runs históricos del backtest (los últimos 20).
 * Usamos POST para evitar caching del CDN de Netlify.
 */

import { getSupabase } from './_shared/supabase.ts';

export default async () => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('backtest_runs')
    .select(
      'id, started_at, completed_at, status, from_date, to_date, tickers_count, total_trades, winning_trades, losing_trades, hit_rate_pct, total_pnl_usd, total_return_pct, max_drawdown_pct, sharpe, sortino, params',
    )
    .order('started_at', { ascending: false })
    .limit(20);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ runs: data ?? [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
