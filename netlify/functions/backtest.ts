/**
 * BACKTEST — POST /.netlify/functions/backtest
 * Body (opcional):
 *   { tickers?: string[]; from?: 'YYYY-MM-DD'; to?: 'YYYY-MM-DD'; initial_capital?: number }
 *
 * Estrategia testeada (simple, sin LLM, para validar el motor técnico):
 *   - LONG cuando cierre cruza por encima de SMA20 con RSI(14) entre 40-65
 *     y SMA20 > SMA50 (tendencia alcista)
 *   - Stop = entry - 1.5*ATR, Target = entry + 2.5*ATR (idéntico al engine real)
 *   - Salida adicional por tiempo: 15 días sin tocar stop ni target
 *   - 1 trade por ticker activo a la vez
 *
 * Output: backtest_run + trades persistidos.
 *
 * NOTA: Esta función pega a Alpha Vantage TIME_SERIES_DAILY con outputsize=full
 * (5+ años de data). Por eso recibe pocos tickers a la vez (free tier).
 */

import { getDailyHistory, type DailyBar } from './_shared/alphavantage.ts';
import { rsi, atr, sma } from './_shared/indicators.ts';
import { getSupabase } from './_shared/supabase.ts';
import { computeAdvancedMetrics, type EquityPoint } from './_shared/metrics.ts';

interface BacktestParams {
  tickers: string[];
  from: string;            // YYYY-MM-DD
  to: string;
  initial_capital: number;
  risk_pct: number;
  atr_stop_mult: number;
  atr_target_mult: number;
  max_hold_days: number;
}

const DEFAULTS: Omit<BacktestParams, 'tickers' | 'from' | 'to'> = {
  initial_capital: 10000,
  risk_pct: 1.0,
  atr_stop_mult: 1.5,
  atr_target_mult: 2.5,
  max_hold_days: 15,
};

interface SimTrade {
  ticker: string;
  direction: 'LONG';
  entry_date: string;
  entry_price: number;
  exit_date: string;
  exit_price: number;
  exit_reason: 'stop' | 'target' | 'time';
  pnl_pct: number;
}

function runForTicker(
  ticker: string,
  bars: DailyBar[],
  p: BacktestParams,
): SimTrade[] {
  const trades: SimTrade[] = [];
  if (bars.length < 60) return trades;

  let open: {
    entry_idx: number;
    entry_price: number;
    stop: number;
    target: number;
  } | null = null;

  // Pre-cómputo rolling no es óptimo; recomputamos por simplicidad.
  for (let i = 50; i < bars.length; i++) {
    const window = bars.slice(0, i + 1);
    const closes = window.map((b) => b.close);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const r = rsi(closes, 14);
    const a = atr(window, 14);

    const bar = bars[i];

    // Salida si hay trade abierto
    if (open) {
      const isLong = true;
      const hitStop = isLong ? bar.low <= open.stop : bar.high >= open.stop;
      const hitTarget = isLong ? bar.high >= open.target : bar.low <= open.target;
      const heldDays = i - open.entry_idx;

      if (hitStop || hitTarget || heldDays >= p.max_hold_days) {
        const exitPrice = hitStop ? open.stop : hitTarget ? open.target : bar.close;
        const pnlPct = ((exitPrice - open.entry_price) / open.entry_price) * 100;
        trades.push({
          ticker,
          direction: 'LONG',
          entry_date: bars[open.entry_idx].date,
          entry_price: open.entry_price,
          exit_date: bar.date,
          exit_price: exitPrice,
          exit_reason: hitStop ? 'stop' : hitTarget ? 'target' : 'time',
          pnl_pct: pnlPct,
        });
        open = null;
      }
    }

    // Entrada si no hay trade abierto
    if (!open && sma20 != null && sma50 != null && r != null && a != null && a > 0) {
      const prevClose = closes[closes.length - 2];
      const prevSma20 = sma(closes.slice(0, -1), 20);
      const crossedUp = prevSma20 != null && prevClose < prevSma20 && bar.close > sma20;
      const trendOk = sma20 > sma50;
      const rsiOk = r >= 40 && r <= 65;

      if (crossedUp && trendOk && rsiOk) {
        const stopDist = p.atr_stop_mult * a;
        const tgtDist = p.atr_target_mult * a;
        open = {
          entry_idx: i,
          entry_price: bar.close,
          stop: bar.close - stopDist,
          target: bar.close + tgtDist,
        };
      }
    }
  }

  return trades;
}

function buildEquityCurve(
  trades: SimTrade[],
  initialCapital: number,
  riskPct: number,
): EquityPoint[] {
  // Daily equity = capital + Σ pnl_pct * (capital * risk_pct / 100) per trade closed up to date.
  // Compounding por trade cerrado en su exit_date.
  const sorted = [...trades].sort((a, b) => a.exit_date.localeCompare(b.exit_date));
  const points: EquityPoint[] = [];
  let equity = initialCapital;
  if (sorted.length === 0) return points;

  // Snapshot inicial el día antes del primer trade
  const startDate = sorted[0].entry_date;
  points.push({ date: startDate, total_value: equity });

  for (const t of sorted) {
    // R-multiple: pnl_pct ya es % sobre entry_price. Usamos posición fija =
    // (capital * risk_pct) escalado por el stop, simplificado a riskPct*pnl_pct.
    const trade_return_pct = (t.pnl_pct * riskPct) / 100;
    equity = equity * (1 + trade_return_pct / 100);
    points.push({ date: t.exit_date, total_value: equity });
  }
  return points;
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body: Partial<BacktestParams> = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }

  const today = new Date().toISOString().slice(0, 10);
  const twoYearsAgo = new Date(Date.now() - 730 * 86400_000).toISOString().slice(0, 10);

  const params: BacktestParams = {
    tickers: body.tickers && body.tickers.length > 0 ? body.tickers : ['SPY', 'AAPL', 'MSFT'],
    from: body.from ?? twoYearsAgo,
    to: body.to ?? today,
    initial_capital: body.initial_capital ?? DEFAULTS.initial_capital,
    risk_pct: body.risk_pct ?? DEFAULTS.risk_pct,
    atr_stop_mult: body.atr_stop_mult ?? DEFAULTS.atr_stop_mult,
    atr_target_mult: body.atr_target_mult ?? DEFAULTS.atr_target_mult,
    max_hold_days: body.max_hold_days ?? DEFAULTS.max_hold_days,
  };

  const supabase = getSupabase();

  const { data: runRow, error: runErr } = await supabase
    .from('backtest_runs')
    .insert({
      from_date: params.from,
      to_date: params.to,
      tickers_count: params.tickers.length,
      initial_capital: params.initial_capital,
      params,
      status: 'running',
    })
    .select('id')
    .single();

  if (runErr || !runRow) {
    return new Response(JSON.stringify({ error: runErr?.message ?? 'insert failed' }), {
      status: 500,
    });
  }
  const runId = runRow.id;

  try {
    const allTrades: SimTrade[] = [];

    for (const ticker of params.tickers) {
      try {
        const fullBars = await getDailyHistory(ticker, 'full');
        const filtered = fullBars.filter(
          (b) => b.date >= params.from && b.date <= params.to,
        );
        const trades = runForTicker(ticker, filtered, params);
        allTrades.push(...trades);
        // Throttle Alpha Vantage (5 req/min free tier)
        await new Promise((r) => setTimeout(r, 12_500));
      } catch (e: any) {
        console.error(`[backtest] ${ticker} failed:`, e.message);
      }
    }

    // Persistir trades del backtest
    if (allTrades.length > 0) {
      const rows = allTrades.map((t) => ({
        run_id: runId,
        ticker: t.ticker,
        direction: t.direction,
        entry_date: t.entry_date,
        entry_price: t.entry_price,
        exit_date: t.exit_date,
        exit_price: t.exit_price,
        exit_reason: t.exit_reason,
        pnl_pct: t.pnl_pct,
      }));
      await supabase.from('backtest_trades').insert(rows);
    }

    const winners = allTrades.filter((t) => t.pnl_pct > 0);
    const losers = allTrades.filter((t) => t.pnl_pct <= 0);
    const hit_rate = allTrades.length > 0 ? (winners.length / allTrades.length) * 100 : 0;
    const total_pnl_pct = allTrades.reduce((a, t) => a + t.pnl_pct * params.risk_pct / 100, 0);
    const total_pnl_usd = (params.initial_capital * total_pnl_pct) / 100;

    const equity = buildEquityCurve(allTrades, params.initial_capital, params.risk_pct);
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
        total_return_pct: total_pnl_pct,
        max_drawdown_pct: m.max_drawdown_pct,
        sharpe: m.sharpe,
        sortino: m.sortino,
      })
      .eq('id', runId);

    return new Response(
      JSON.stringify({
        ok: true,
        run_id: runId,
        total_trades: allTrades.length,
        hit_rate_pct: hit_rate,
        total_return_pct: total_pnl_pct,
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
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
  }
};
