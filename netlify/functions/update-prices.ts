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
import { notify } from './_shared/notify.ts';
import { formatTradeClosedBody, escapeHtml } from './_shared/telegram.ts';

export const config: Config = {
  schedule: '0 14,16,18,20 * * 1-5',
};

// Avisar cuando el precio entra dentro de este % del stop o del target.
const STOP_PROXIMITY_PCT = parseFloat(process.env.STOP_PROXIMITY_PCT ?? '1.5');

export default async () => {
  const runId = await logRunStart('update-prices');
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

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

        const win = pnlUsd >= 0;
        await notify({
          type: 'trade_closed',
          severity: 'info',
          dedup_key: `trade_closed:${t.id}`,
          title: `${win ? '✅' : '🛑'} ${t.ticker} cerrado`,
          body: formatTradeClosedBody({
            ticker: t.ticker,
            direction: t.direction,
            pnl_usd: pnlUsd,
            pnl_pct: pnlPct,
            exit_reason: hitStop ? 'stop' : 'target',
          }),
          payload: { trade_id: t.id, pnl_usd: pnlUsd, pnl_pct: pnlPct },
        }).catch((e) => console.error('[update-prices] notify failed:', e));
      } else if (t.stop_loss != null && t.take_profit != null) {
        // Proximidad a stop/target (máximo una alerta por trade y día).
        const distStopPct = (Math.abs(quote.price - t.stop_loss) / quote.price) * 100;
        const distTargetPct =
          (Math.abs(quote.price - t.take_profit) / quote.price) * 100;
        const nearStop = distStopPct <= STOP_PROXIMITY_PCT;
        const nearTarget = distTargetPct <= STOP_PROXIMITY_PCT;
        if (nearStop || nearTarget) {
          const which = nearStop ? 'stop' : 'target';
          await notify({
            type: 'stop_proximity',
            severity: 'warning',
            dedup_key: `stop_proximity:${t.id}:${today}:${which}`,
            title: `⚠️ ${t.ticker} cerca de ${which}`,
            body:
              `<b>${escapeHtml(t.ticker)}</b> ${escapeHtml(t.direction)} a ` +
              `<code>$${quote.price.toFixed(2)}</code> · ` +
              `${which} <code>$${(nearStop ? t.stop_loss : t.take_profit).toFixed(2)}</code> ` +
              `(${(nearStop ? distStopPct : distTargetPct).toFixed(2)}%)`,
            payload: { trade_id: t.id, price: quote.price, which },
          }).catch((e) => console.error('[update-prices] proximity notify failed:', e));
        }
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
