/**
 * END-OF-DAY — Cron L-V 21:30 UTC (4:30 PM ET, post-cierre).
 *
 * 1. Calcula valor de cada posición abierta a precio de cierre
 * 2. Inserta un snapshot en equity_snapshots (curva de performance)
 */

import type { Config } from '@netlify/functions';
import {
  getSupabase,
  logRunStart,
  logRunComplete,
  SINGLE_USER_ID,
} from './_shared/supabase.ts';
import { getDailyHistory } from './_shared/alphavantage.ts';
import { notify } from './_shared/notify.ts';

export const config: Config = {
  schedule: '30 21 * * 1-5',
};

const BENCHMARK_TICKER = 'SPY';

async function refreshBenchmark(
  supabase: ReturnType<typeof getSupabase>,
): Promise<number> {
  const { data: last } = await supabase
    .from('benchmark_prices')
    .select('date')
    .eq('ticker', BENCHMARK_TICKER)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  if (last?.date === today) return 0;

  try {
    const bars = await getDailyHistory(BENCHMARK_TICKER, 'compact');
    if (bars.length === 0) return 0;
    const rows = bars.map((b) => ({
      ticker: BENCHMARK_TICKER,
      date: b.date,
      close: b.close,
    }));
    const { error } = await supabase
      .from('benchmark_prices')
      .upsert(rows, { onConflict: 'ticker,date' });
    if (error) {
      console.error('[end-of-day] benchmark upsert failed:', error.message);
      return 0;
    }
    return rows.length;
  } catch (e: any) {
    console.error('[end-of-day] benchmark fetch failed:', e.message);
    return 0;
  }
}

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

    // Calcular daily P&L vs snapshot anterior (mismo "usuario" = sentinel)
    const { data: prev } = await supabase
      .from('equity_snapshots')
      .select('total_value')
      .eq('user_id', SINGLE_USER_ID)
      .lt('date', today)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const dailyPnlPct =
      prev?.total_value && prev.total_value > 0
        ? ((totalValue - prev.total_value) / prev.total_value) * 100
        : 0;

    await supabase.from('equity_snapshots').upsert(
      {
        user_id: SINGLE_USER_ID,
        date: today,
        cash,
        positions_value: positionsValue,
        total_value: totalValue,
        num_open_positions: openTrades?.length ?? 0,
        daily_pnl_pct: dailyPnlPct,
      },
      { onConflict: 'user_id,date' },
    );

    // Digest de cierre con P&L del día (single-user / centinela).
    const pnlSign = dailyPnlPct >= 0 ? '+' : '';
    await notify({
      type: 'digest_eod',
      severity: 'info',
      dedup_key: `digest_eod:${today}`,
      title: `Cierre ${today}`,
      body:
        `Valor total: <code>$${totalValue.toFixed(2)}</code>\n` +
        `P&amp;L del día: <code>${pnlSign}${dailyPnlPct.toFixed(2)}%</code>\n` +
        `Posiciones abiertas: <b>${openTrades?.length ?? 0}</b>`,
      payload: { total_value: totalValue, daily_pnl_pct: dailyPnlPct },
    }).catch((e) => console.error('[end-of-day] notify failed:', e));

    // Refrescar benchmark (SPY) para comparativa en /performance
    const benchmarkRows = await refreshBenchmark(supabase);

    await logRunComplete(runId, 'success', {
      records_processed: 1,
      metadata: {
        total_value: totalValue,
        daily_pnl_pct: dailyPnlPct,
        benchmark_rows: benchmarkRows,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        total_value: totalValue,
        daily_pnl_pct: dailyPnlPct,
        benchmark_rows: benchmarkRows,
      }),
    );
  } catch (err: any) {
    console.error('[end-of-day] FATAL:', err);
    await logRunComplete(runId, 'error', { error_message: err.message });
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
    });
  }
};
