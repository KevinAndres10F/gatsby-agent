/**
 * POST /api/close-trade
 * Body: { trade_id: number, exit_price?: number }
 *
 * Cierra un trade manualmente. Si no se pasa exit_price, usa el último quote.
 */

import { getSupabase, getUserIdFromRequest } from './_shared/supabase.ts';

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: { trade_id?: number; exit_price?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const supabase = getSupabase();
  const userId = await getUserIdFromRequest(req);

  const { data: trade, error } = await supabase
    .from('trades')
    .select('*')
    .eq('id', body.trade_id!)
    .single();
  if (error || !trade) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  if (trade.status === 'CLOSED')
    return new Response(JSON.stringify({ error: 'Already closed' }), { status: 409 });
  // Si hay usuario autenticado, debe coincidir con dueño del trade
  if (userId && trade.user_id && trade.user_id !== userId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  let exitPrice = body.exit_price;
  if (!exitPrice) {
    const { data: q } = await supabase.from('quotes').select('price').eq('ticker', trade.ticker).single();
    exitPrice = q?.price ?? trade.entry_price;
  }

  const finalPrice = exitPrice ?? trade.entry_price;
  const isLong = trade.direction === 'LONG';
  const pnlPerShare = isLong ? finalPrice - trade.entry_price : trade.entry_price - finalPrice;
  const pnlUsd = pnlPerShare * trade.shares;
  const pnlPct = (pnlPerShare / trade.entry_price) * 100;

  await supabase
    .from('trades')
    .update({
      status: 'CLOSED',
      exit_price: finalPrice,
      exit_date: new Date().toISOString(),
      exit_reason: 'manual',
      pnl_usd: pnlUsd,
      pnl_pct: pnlPct,
    })
    .eq('id', trade.id);

  // Devolver capital + P&L al portfolio correcto (scoped por user_id)
  let pfQuery = supabase.from('portfolio').select('id, cash').order('id').limit(1);
  if (trade.user_id) pfQuery = pfQuery.eq('user_id', trade.user_id);
  else pfQuery = pfQuery.is('user_id', null);
  const { data: pf } = await pfQuery.maybeSingle();
  if (pf) {
    await supabase
      .from('portfolio')
      .update({ cash: pf.cash + trade.capital_used + pnlUsd })
      .eq('id', pf.id);
  }

  return new Response(JSON.stringify({ ok: true, pnl_usd: pnlUsd, pnl_pct: pnlPct }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
