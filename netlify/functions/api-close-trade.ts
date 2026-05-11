/**
 * POST /api/close-trade
 * Body: { trade_id: number, exit_price?: number }
 *
 * Cierra un trade manualmente. Si no se pasa exit_price, usa el último quote.
 */

import { getSupabase } from './_shared/supabase.ts';

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: { trade_id?: number; exit_price?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const supabase = getSupabase();

  const { data: trade, error } = await supabase
    .from('trades')
    .select('*')
    .eq('id', body.trade_id!)
    .single();
  if (error || !trade) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  if (trade.status === 'CLOSED')
    return new Response(JSON.stringify({ error: 'Already closed' }), { status: 409 });

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

  // Devolver capital + P&L
  const { data: pf } = await supabase.from('portfolio').select('id, cash').order('id').limit(1).single();
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
