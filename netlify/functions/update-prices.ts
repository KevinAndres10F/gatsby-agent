/**
 * UPDATE-PRICES — Cron cada 2h durante horario de mercado US.
 *
 * 1. Actualiza quote en tiempo real para todas las posiciones abiertas
 * 2. Si una posición toca stop_loss o take_profit, la cierra automáticamente
 * 3. Persiste el quote para mark-to-market en el dashboard
 */

import type { Config } from '@netlify/functions';
import { getSupabase, logRunStart, logRunComplete } from './_shared/supabase.ts';
import { getFinnhubQuote } from './_shared/finnhub.ts';

export const config: Config = {
  schedule: '0 14,16,18,20 * * 1-5',
};

export default async () => {
  const runId = await logRunStart('update-prices');
  const supabase = getSupabase();

  try {
    const { data: openTrades, error } = await supabase
      .from('trades')
      .select('id, ticker, direction, entry_price, shares, stop_loss, take_profit, capital_used')
      .eq('status', 'OPEN');
    if (error) throw error;

    if (!openTrades || openTrades.length === 0) {
      await logRunComplete(runId, 'success', { records_processed: 0 });
      return new Response(JSON.stringify({ ok: true, updated: 0 }));
    }

    let updated = 0;
    let closed = 0;

    for (const t of openTrades) {
      const quote = await getFinnhubQuote(t.ticker);
      if (!quote) continue;

      // Actualizar tabla quotes
      await supabase.from('quotes').upsert({
        ticker: t.ticker,
        price: quote.price,
        change_pct: quote.change_pct,
        updated_at: new Date().toISOString(),
      });
      updated++;

      // Verificar stop/target
      const isLong = t.direction === 'LONG';
      const hitStop = isLong
        ? quote.price <= t.stop_loss
        : quote.price >= t.stop_loss;
      const hitTarget = isLong
        ? quote.price >= t.take_profit
        : quote.price <= t.take_profit;

      if (hitStop || hitTarget) {
        const exitPrice = quote.price;
        const pnlPerShare = isLong
          ? exitPrice - t.entry_price
          : t.entry_price - exitPrice;
        const pnlUsd = pnlPerShare * t.shares;
        const pnlPct = (pnlPerShare / t.entry_price) * 100;

        await supabase
          .from('trades')
          .update({
            status: 'CLOSED',
            exit_price: exitPrice,
            exit_date: new Date().toISOString(),
            exit_reason: hitStop ? 'stop' : 'target',
            pnl_usd: pnlUsd,
            pnl_pct: pnlPct,
          })
          .eq('id', t.id);

        // Devolver capital + P&L al portfolio
        const { data: pf } = await supabase
          .from('portfolio')
          .select('id, cash')
          .order('id')
          .limit(1)
          .single();
        if (pf) {
          await supabase
            .from('portfolio')
            .update({ cash: pf.cash + t.capital_used + pnlUsd })
            .eq('id', pf.id);
        }
        closed++;
      }

      await new Promise((r) => setTimeout(r, 1300));
    }

    await logRunComplete(runId, 'success', {
      records_processed: updated,
      metadata: { updated, closed },
    });

    return new Response(JSON.stringify({ ok: true, updated, closed }));
  } catch (err: any) {
    console.error('[update-prices] FATAL:', err);
    await logRunComplete(runId, 'error', { error_message: err.message });
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
    });
  }
};
