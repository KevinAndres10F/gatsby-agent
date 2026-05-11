/**
 * GET /api/portfolio
 * Devuelve estado del portfolio: cash, posiciones abiertas con P&L flotante.
 * Multi-usuario: si llega un Bearer token, scope por user_id.
 * Si no, opera en modo single-user (user_id IS NULL).
 */

import { getSupabase, getUserIdFromRequest } from './_shared/supabase.ts';

export default async (req: Request) => {
  const supabase = getSupabase();
  const userId = await getUserIdFromRequest(req);

  // Portfolio scope
  let pfQuery = supabase.from('portfolio').select('*').order('id').limit(1);
  pfQuery = userId ? pfQuery.eq('user_id', userId) : pfQuery.is('user_id', null);
  const pfRes = await pfQuery.maybeSingle();

  let posQuery = supabase.from('v_open_positions').select('*');
  posQuery = userId ? posQuery.eq('user_id', userId) : posQuery.is('user_id', null);
  const openRes = await posQuery;

  let eqQuery = supabase
    .from('equity_snapshots')
    .select('*')
    .order('date', { ascending: false })
    .limit(1);
  eqQuery = userId ? eqQuery.eq('user_id', userId) : eqQuery.is('user_id', null);
  const equityRes = await eqQuery.maybeSingle();

  const portfolio = pfRes.data;
  const positions = openRes.data ?? [];
  const lastSnapshot = equityRes.data;

  const positionsValue = positions.reduce(
    (sum: number, p: any) => sum + (p.current_price ?? p.entry_price) * p.shares,
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
