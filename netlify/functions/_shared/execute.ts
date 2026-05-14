/**
 * Lógica compartida para ejecutar paper trades. Usada por:
 *   - api-execute.ts (HTTP, click manual del usuario)
 *   - analyze.ts (auto-execute de HIGH conviction si AUTO_EXECUTE_HIGH=true)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type ExecuteResult =
  | { ok: true; trade: any }
  | { ok: false; error: string; status: number };

export async function executeSignal(
  supabase: SupabaseClient,
  signalId: number,
  userId: string | null,
): Promise<ExecuteResult> {
  const { data: signal, error: sErr } = await supabase
    .from('signals')
    .select('*')
    .eq('id', signalId)
    .single();
  if (sErr || !signal) {
    return { ok: false, error: 'Signal not found', status: 404 };
  }
  if (signal.executed) {
    return { ok: false, error: 'Signal already executed', status: 409 };
  }
  if (signal.direction === 'HOLD') {
    return { ok: false, error: 'HOLD signals are not executable', status: 400 };
  }
  if (
    signal.stop_loss == null ||
    signal.take_profit == null ||
    !signal.position_size_pct
  ) {
    return { ok: false, error: 'Signal has no trade plan', status: 400 };
  }

  let pfQuery = supabase.from('portfolio').select('*').order('id').limit(1);
  pfQuery = userId ? pfQuery.eq('user_id', userId) : pfQuery.is('user_id', null);
  const { data: pf, error: pErr } = await pfQuery.single();
  if (pErr || !pf) {
    return { ok: false, error: 'Portfolio not found', status: 500 };
  }

  const capitalToUse = (pf.cash * signal.position_size_pct) / 100;
  const shares = Math.floor(capitalToUse / signal.entry_price);
  if (shares <= 0) {
    return { ok: false, error: 'Insufficient cash for any share', status: 400 };
  }
  const actualCapital = shares * signal.entry_price;
  if (actualCapital > pf.cash) {
    return { ok: false, error: 'Insufficient cash', status: 400 };
  }

  const { data: trade, error: tErr } = await supabase
    .from('trades')
    .insert({
      signal_id: signal.id,
      portfolio_id: pf.id,
      user_id: userId,
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
  if (tErr) return { ok: false, error: tErr.message, status: 500 };

  await supabase
    .from('portfolio')
    .update({ cash: pf.cash - actualCapital })
    .eq('id', pf.id);
  await supabase.from('signals').update({ executed: true }).eq('id', signal.id);

  return { ok: true, trade };
}
