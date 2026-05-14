/**
 * BACKTEST-LLM-REPLAY — POST /.netlify/functions/backtest-llm-replay
 * Body (opcional):
 *   { from?: 'YYYY-MM-DD'; to?: 'YYYY-MM-DD'; initial_capital?: number; max_hold_days?: number;
 *     min_conviction?: 'LOW' | 'MEDIUM' | 'HIGH' }
 *
 * Re-ejecuta TODAS las señales LLM persistidas (LONG/SHORT con plan completo)
 * como paper trades sobre data histórica diaria, usando los mismos stops/targets
 * que el agente generó en su momento. NO llama a Claude — usa las señales tal
 * cual quedaron en `signals`. Output: backtest_run con flag mode='llm-replay'.
 *
 * Útil para validar si las señales del LLM tienen edge ANTES de paper-tradearlas
 * por semanas. Limitación: el sample size depende de cuántas señales tengas
 * acumuladas en `signals`.
 */

import { getDailyHistory, type DailyBar } from './_shared/alphavantage.ts';
import { getSupabase } from './_shared/supabase.ts';
import { computeAdvancedMetrics, type EquityPoint } from './_shared/metrics.ts';

interface ReplayParams {
  from: string;
  to: string;
  initial_capital: number;
  risk_pct: number;
  max_hold_days: number;
  min_conviction: 'LOW' | 'MEDIUM' | 'HIGH';
}

const CONVICTION_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

interface SimTrade {
  ticker: string;
  direction: 'LONG' | 'SHORT';
  entry_date: string;
  entry_price: number;
  exit_date: string;
  exit_price: number;
  exit_reason: 'stop' | 'target' | 'time';
  pnl_pct: number;
}

function simulateSignal(
  signal: {
    ticker: string;
    direction: 'LONG' | 'SHORT';
    date: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
  },
  bars: DailyBar[],
  maxHoldDays: number,
): SimTrade | null {
  // Encuentra la primera vela en o después de la fecha de la señal
  const entryIdx = bars.findIndex((b) => b.date >= signal.date);
  if (entryIdx < 0) return null;

  const isLong = signal.direction === 'LONG';
  const last = Math.min(entryIdx + maxHoldDays, bars.length - 1);

  for (let i = entryIdx + 1; i <= last; i++) {
    const bar = bars[i];
    const hitStop = isLong
      ? bar.low <= signal.stop_loss
      : bar.high >= signal.stop_loss;
    const hitTarget = isLong
      ? bar.high >= signal.take_profit
      : bar.low <= signal.take_profit;

    if (hitStop || hitTarget) {
      const exitPrice = hitStop ? signal.stop_loss : signal.take_profit;
      const pnlPerShare = isLong
        ? exitPrice - signal.entry_price
        : signal.entry_price - exitPrice;
      const pnlPct = (pnlPerShare / signal.entry_price) * 100;
      return {
        ticker: signal.ticker,
        direction: signal.direction,
        entry_date: bars[entryIdx].date,
        entry_price: signal.entry_price,
        exit_date: bar.date,
        exit_price: exitPrice,
        exit_reason: hitStop ? 'stop' : 'target',
        pnl_pct: pnlPct,
      };
    }
  }

  // Salida por tiempo: cierra al último cierre dentro del horizonte
  const finalBar = bars[last];
  const pnlPerShare = isLong
    ? finalBar.close - signal.entry_price
    : signal.entry_price - finalBar.close;
  const pnlPct = (pnlPerShare / signal.entry_price) * 100;
  return {
    ticker: signal.ticker,
    direction: signal.direction,
    entry_date: bars[entryIdx].date,
    entry_price: signal.entry_price,
    exit_date: finalBar.date,
    exit_price: finalBar.close,
    exit_reason: 'time',
    pnl_pct: pnlPct,
  };
}

function buildEquityCurve(
  trades: SimTrade[],
  initialCapital: number,
  riskPct: number,
): EquityPoint[] {
  const sorted = [...trades].sort((a, b) =>
    a.exit_date.localeCompare(b.exit_date),
  );
  const points: EquityPoint[] = [];
  let equity = initialCapital;
  if (sorted.length === 0) return points;

  points.push({ date: sorted[0].entry_date, total_value: equity });
  for (const t of sorted) {
    const trade_return_pct = (t.pnl_pct * riskPct) / 100;
    equity = equity * (1 + trade_return_pct / 100);
    points.push({ date: t.exit_date, total_value: equity });
  }
  return points;
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
    });
  }

  let body: Partial<ReplayParams> = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }

  const today = new Date().toISOString().slice(0, 10);
  const oneYearAgo = new Date(Date.now() - 365 * 86400_000)
    .toISOString()
    .slice(0, 10);

  const params: ReplayParams = {
    from: body.from ?? oneYearAgo,
    to: body.to ?? today,
    initial_capital: body.initial_capital ?? 10000,
    risk_pct: 1.0,
    max_hold_days: body.max_hold_days ?? 15,
    min_conviction: body.min_conviction ?? 'LOW',
  };

  const supabase = getSupabase();

  // 1. Cargar señales accionables en rango
  const minConvictionRank = CONVICTION_ORDER[params.min_conviction];
  const { data: signals, error: sigErr } = await supabase
    .from('signals')
    .select('ticker, direction, date, entry_price, stop_loss, take_profit, conviction')
    .in('direction', ['LONG', 'SHORT'])
    .gte('date', params.from)
    .lte('date', params.to)
    .not('stop_loss', 'is', null)
    .not('take_profit', 'is', null)
    .order('date', { ascending: true });

  if (sigErr) {
    return new Response(JSON.stringify({ error: sigErr.message }), { status: 500 });
  }

  const eligible = (signals ?? []).filter(
    (s) =>
      CONVICTION_ORDER[s.conviction as keyof typeof CONVICTION_ORDER] >=
      minConvictionRank,
  );

  if (eligible.length === 0) {
    return new Response(
      JSON.stringify({
        ok: true,
        total_trades: 0,
        message: 'No hay señales accionables en el rango especificado.',
      }),
    );
  }

  // 2. Crear backtest_run
  const { data: runRow, error: runErr } = await supabase
    .from('backtest_runs')
    .insert({
      from_date: params.from,
      to_date: params.to,
      tickers_count: new Set(eligible.map((s) => s.ticker)).size,
      initial_capital: params.initial_capital,
      params: { ...params, mode: 'llm-replay', signals_replayed: eligible.length },
      status: 'running',
    })
    .select('id')
    .single();

  if (runErr || !runRow) {
    return new Response(
      JSON.stringify({ error: runErr?.message ?? 'insert failed' }),
      { status: 500 },
    );
  }
  const runId = runRow.id;

  try {
    // 3. Para cada ticker único, pull histórico una sola vez (caché en memoria)
    const uniqueTickers = Array.from(new Set(eligible.map((s) => s.ticker)));
    const barsByTicker: Record<string, DailyBar[]> = {};

    for (const ticker of uniqueTickers) {
      try {
        const bars = await getDailyHistory(ticker, 'full');
        barsByTicker[ticker] = bars;
        await new Promise((r) => setTimeout(r, 12_500)); // throttle Alpha Vantage
      } catch (e: any) {
        console.error(`[backtest-llm-replay] ${ticker} fetch failed:`, e.message);
      }
    }

    // 4. Simular cada señal
    const allTrades: SimTrade[] = [];
    for (const sig of eligible) {
      const bars = barsByTicker[sig.ticker];
      if (!bars || bars.length === 0) continue;
      const simulated = simulateSignal(
        {
          ticker: sig.ticker,
          direction: sig.direction as 'LONG' | 'SHORT',
          date: sig.date,
          entry_price: Number(sig.entry_price),
          stop_loss: Number(sig.stop_loss),
          take_profit: Number(sig.take_profit),
        },
        bars,
        params.max_hold_days,
      );
      if (simulated) allTrades.push(simulated);
    }

    if (allTrades.length > 0) {
      await supabase.from('backtest_trades').insert(
        allTrades.map((t) => ({
          run_id: runId,
          ticker: t.ticker,
          direction: t.direction,
          entry_date: t.entry_date,
          entry_price: t.entry_price,
          exit_date: t.exit_date,
          exit_price: t.exit_price,
          exit_reason: t.exit_reason,
          pnl_pct: t.pnl_pct,
        })),
      );
    }

    const winners = allTrades.filter((t) => t.pnl_pct > 0);
    const losers = allTrades.filter((t) => t.pnl_pct <= 0);
    const hit_rate =
      allTrades.length > 0 ? (winners.length / allTrades.length) * 100 : 0;
    const total_return_pct = allTrades.reduce(
      (a, t) => a + (t.pnl_pct * params.risk_pct) / 100,
      0,
    );
    const total_pnl_usd = (params.initial_capital * total_return_pct) / 100;
    const equity = buildEquityCurve(
      allTrades,
      params.initial_capital,
      params.risk_pct,
    );
    const m = computeAdvancedMetrics(equity);

    await supabase
      .from('backtest_runs')
      .update({
        completed_at: new Date().toISOString(),
        status: 'success',
        total_trades: allTrades.length,
        winning_trades: winners.length,
        losing_trades: losers.length,
        hit_rate_pct: hit_rate,
        total_pnl_usd,
        total_return_pct,
        max_drawdown_pct: m.max_drawdown_pct,
        sharpe: m.sharpe,
        sortino: m.sortino,
      })
      .eq('id', runId);

    return new Response(
      JSON.stringify({
        ok: true,
        run_id: runId,
        signals_replayed: eligible.length,
        total_trades: allTrades.length,
        hit_rate_pct: hit_rate,
        total_return_pct,
        sharpe: m.sharpe,
        sortino: m.sortino,
        max_drawdown_pct: m.max_drawdown_pct,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    await supabase
      .from('backtest_runs')
      .update({
        completed_at: new Date().toISOString(),
        status: 'error',
        error_message: err.message,
      })
      .eq('id', runId);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
    });
  }
};
