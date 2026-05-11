/**
 * GET /api/performance
 * Métricas agregadas: hit rate, P&L total, equity curve.
 */

import { getSupabase } from './_shared/supabase.ts';

export default async () => {
  const supabase = getSupabase();

  const [perfRes, equityRes, recentTradesRes] = await Promise.all([
    supabase.from('v_performance').select('*').single(),
    supabase.from('equity_snapshots').select('*').order('date', { ascending: true }).limit(180),
    supabase
      .from('trades')
      .select('ticker, direction, entry_date, exit_date, pnl_usd, pnl_pct, exit_reason, status')
      .eq('status', 'CLOSED')
      .order('exit_date', { ascending: false })
      .limit(20),
  ]);

  return new Response(
    JSON.stringify({
      performance: perfRes.data,
      equity_curve: equityRes.data ?? [],
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
