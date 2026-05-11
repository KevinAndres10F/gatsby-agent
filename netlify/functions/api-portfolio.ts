/**
 * GET /api/portfolio
 * Devuelve estado del portfolio: cash, posiciones abiertas con P&L flotante.
 */

import { getSupabase } from './_shared/supabase.ts';

export default async () => {
  const supabase = getSupabase();

  const [pfRes, openRes, equityRes] = await Promise.all([
    supabase.from('portfolio').select('*').order('id').limit(1).single(),
    supabase.from('v_open_positions').select('*'),
    supabase.from('equity_snapshots').select('*').order('date', { ascending: false }).limit(1).single(),
  ]);

  const portfolio = pfRes.data;
  const positions = openRes.data ?? [];
  const lastSnapshot = equityRes.data;

  const positionsValue = positions.reduce(
    (sum, p) => sum + (p.current_price ?? p.entry_price) * p.shares,
    0,
  );
  const totalValue = (portfolio?.cash ?? 0) + positionsValue;
  const totalReturn = portfolio
    ? ((totalValue - portfolio.initial_capital) / portfolio.initial_capital) * 100
    : 0;

  return new Response(
    JSON.stringify({
      portfolio: {
        initial_capital: portfolio?.initial_capital ?? 0,
        cash: portfolio?.cash ?? 0,
        positions_value: positionsValue,
        total_value: totalValue,
        total_return_pct: totalReturn,
      },
      positions,
      last_snapshot: lastSnapshot,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
      },
    },
  );
};
