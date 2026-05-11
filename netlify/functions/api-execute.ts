/**
 * POST /api/execute
 * Body: { signal_id: number }
 *
 * Ejecuta un paper trade basado en una señal:
 * 1. Lee la señal y su plan
 * 2. Verifica que haya cash suficiente
 * 3. Crea el trade y descuenta cash del portfolio
 * 4. Marca la señal como executed
 */

import { getSupabase } from './_shared/supabase.ts';

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: { signal_id?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const signalId = body.signal_id;
  if (!signalId) {
    return new Response(JSON.stringify({ error: 'signal_id required' }), { status: 400 });
  }

  const supabase = getSupabase();

  // 1. Cargar señal
  const { data: signal, error: sErr } = await supabase
    .from('signals')
    .select('*')
    .eq('id', signalId)
    .single();
  if (sErr || !signal) {
    return new Response(JSON.stringify({ error: 'Signal not found' }), { status: 404 });
  }

  if (signal.executed) {
    return new Response(JSON.stringify({ error: 'Signal already executed' }), { status: 409 });
  }

  // 2. Calcular shares basado en position_size_pct y portfolio
  const { data: pf, error: pErr } = await supabase
    .from('portfolio')
    .select('*')
    .order('id')
    .limit(1)
    .single();
  if (pErr || !pf) {
    return new Response(JSON.stringify({ error: 'Portfolio not found' }), { status: 500 });
  }

  const capitalToUse = (pf.cash * signal.position_size_pct) / 100;
  const shares = Math.floor(capitalToUse / signal.entry_price);

  if (shares <= 0) {
    return new Response(JSON.stringify({ error: 'Insufficient cash' }), { status: 400 });
  }

  const actualCapital = shares * signal.entry_price;
  if (actualCapital > pf.cash) {
    return new Response(JSON.stringify({ error: 'Insufficient cash' }), { status: 400 });
  }

  // 3. Insertar trade
  const { data: trade, error: tErr } = await supabase
    .from('trades')
    .insert({
      signal_id: signal.id,
      portfolio_id: pf.id,
      ticker: signal.ticker,
      direction: signal.direction,
      status: 'OPEN',
      entry_price: signal.entry_price,
      shares,
      capital_used: actualCapital,
      stop_loss: signal.stop_loss,
      take_profit: signal.take_profit,
    })
    .select()
    .single();
  if (tErr) {
    return new Response(JSON.stringify({ error: tErr.message }), { status: 500 });
  }

  // 4. Descontar cash y marcar señal
  await supabase
    .from('portfolio')
    .update({ cash: pf.cash - actualCapital })
    .eq('id', pf.id);
  await supabase.from('signals').update({ executed: true }).eq('id', signal.id);

  return new Response(JSON.stringify({ ok: true, trade }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
