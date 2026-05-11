/**
 * END-OF-DAY — Cron L-V 21:30 UTC (4:30 PM ET, post-cierre).
 *
 * 1. Calcula valor de cada posición abierta a precio de cierre
 * 2. Inserta un snapshot en equity_snapshots (curva de performance)
 */

import type { Config } from '@netlify/functions';
import { getSupabase, logRunStart, logRunComplete } from './_shared/supabase.ts';

export const config: Config = {
  schedule: '30 21 * * 1-5',
};

export default async () => {
  const runId = await logRunStart('end-of-day');
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  try {
    const { data: pf } = await supabase
      .from('portfolio')
      .select('cash')
      .order('id')
      .limit(1)
      .single();

    const { data: openTrades } = await supabase
      .from('trades')
      .select('ticker, shares, entry_price, capital_used')
      .eq('status', 'OPEN');

    const { data: quotes } = await supabase.from('quotes').select('ticker, price');

    let positionsValue = 0;
    if (openTrades && quotes) {
      for (const t of openTrades) {
        const q = quotes.find((x) => x.ticker === t.ticker);
        const px = q?.price ?? t.entry_price;
        positionsValue += px * t.shares;
      }
    }

    const cash = pf?.cash ?? 0;
    const totalValue = cash + positionsValue;

    // Calcular daily P&L vs snapshot anterior
    const { data: prev } = await supabase
      .from('equity_snapshots')
      .select('total_value')
      .lt('date', today)
      .order('date', { ascending: false })
      .limit(1)
      .single();

    const dailyPnlPct =
      prev?.total_value && prev.total_value > 0
        ? ((totalValue - prev.total_value) / prev.total_value) * 100
        : 0;

    await supabase.from('equity_snapshots').upsert({
      date: today,
      cash,
      positions_value: positionsValue,
      total_value: totalValue,
      num_open_positions: openTrades?.length ?? 0,
      daily_pnl_pct: dailyPnlPct,
    });

    await logRunComplete(runId, 'success', {
      records_processed: 1,
      metadata: { total_value: totalValue, daily_pnl_pct: dailyPnlPct },
    });

    return new Response(
      JSON.stringify({ ok: true, total_value: totalValue, daily_pnl_pct: dailyPnlPct }),
    );
  } catch (err: any) {
    console.error('[end-of-day] FATAL:', err);
    await logRunComplete(runId, 'error', { error_message: err.message });
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
    });
  }
};
