/**
 * Métricas de performance ajustadas por riesgo.
 *
 * Sharpe   = (mean(daily_returns) - rf_daily) / std(daily_returns) * sqrt(252)
 * Sortino  = (mean(daily_returns) - rf_daily) / std(downside_returns) * sqrt(252)
 * Calmar   = CAGR / |max_drawdown|
 * MaxDD    = peor caída desde un peak previo (en %, negativo)
 */

const TRADING_DAYS = 252;
// Risk-free rate anualizado ~ 4% → diario ≈ 0.0001587
const RF_DAILY = Math.pow(1.04, 1 / TRADING_DAYS) - 1;

export interface EquityPoint {
  date: string;
  total_value: number;
}

export interface AdvancedMetrics {
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  max_drawdown_pct: number | null;
  volatility_annual_pct: number | null;
  cagr_pct: number | null;
  days_observed: number;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Calcula los daily returns en decimal (no %).
 * curve debe venir ordenada cronológicamente ascendente.
 */
export function dailyReturns(curve: EquityPoint[]): number[] {
  const rets: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = Number(curve[i - 1].total_value);
    const cur = Number(curve[i].total_value);
    if (prev > 0) rets.push((cur - prev) / prev);
  }
  return rets;
}

/**
 * Max drawdown en decimal negativo (ej: -0.12 = -12%).
 */
export function maxDrawdown(curve: EquityPoint[]): number {
  if (curve.length === 0) return 0;
  let peak = Number(curve[0].total_value);
  let mdd = 0;
  for (const p of curve) {
    const v = Number(p.total_value);
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (v - peak) / peak;
      if (dd < mdd) mdd = dd;
    }
  }
  return mdd;
}

export function computeAdvancedMetrics(curve: EquityPoint[]): AdvancedMetrics {
  if (curve.length < 2) {
    return {
      sharpe: null,
      sortino: null,
      calmar: null,
      max_drawdown_pct: null,
      volatility_annual_pct: null,
      cagr_pct: null,
      days_observed: curve.length,
    };
  }

  const rets = dailyReturns(curve);
  if (rets.length === 0) {
    return {
      sharpe: null,
      sortino: null,
      calmar: null,
      max_drawdown_pct: 0,
      volatility_annual_pct: null,
      cagr_pct: null,
      days_observed: curve.length,
    };
  }

  const avgRet = mean(rets);
  const stdRet = stddev(rets);
  const excessDaily = avgRet - RF_DAILY;

  const sharpe = stdRet > 0 ? (excessDaily / stdRet) * Math.sqrt(TRADING_DAYS) : null;

  const downside = rets.filter((r) => r < 0);
  const downStd = stddev(downside);
  const sortino =
    downStd > 0 ? (excessDaily / downStd) * Math.sqrt(TRADING_DAYS) : null;

  const mdd = maxDrawdown(curve);

  const startVal = Number(curve[0].total_value);
  const endVal = Number(curve[curve.length - 1].total_value);
  const years = curve.length / TRADING_DAYS;
  const cagr =
    startVal > 0 && years > 0 ? Math.pow(endVal / startVal, 1 / years) - 1 : null;

  const calmar = cagr != null && mdd < 0 ? cagr / Math.abs(mdd) : null;

  return {
    sharpe: sharpe != null ? round(sharpe, 2) : null,
    sortino: sortino != null ? round(sortino, 2) : null,
    calmar: calmar != null ? round(calmar, 2) : null,
    max_drawdown_pct: round(mdd * 100, 2),
    volatility_annual_pct: round(stdRet * Math.sqrt(TRADING_DAYS) * 100, 2),
    cagr_pct: cagr != null ? round(cagr * 100, 2) : null,
    days_observed: curve.length,
  };
}

function round(x: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(x * f) / f;
}

/**
 * Compara dos curvas (estrategia vs benchmark) normalizándolas
 * a base 100 desde la primera fecha común.
 */
export interface BenchmarkComparison {
  series: { date: string; strategy: number; benchmark: number }[];
  strategy_return_pct: number;
  benchmark_return_pct: number;
  alpha_pct: number;
}

export function compareToBenchmark(
  strategy: EquityPoint[],
  benchmark: { date: string; close: number }[],
): BenchmarkComparison | null {
  if (strategy.length === 0 || benchmark.length === 0) return null;

  const bMap = new Map(benchmark.map((b) => [b.date, Number(b.close)]));
  const aligned: { date: string; sv: number; bv: number }[] = [];

  for (const p of strategy) {
    const bv = bMap.get(p.date);
    if (bv != null) aligned.push({ date: p.date, sv: Number(p.total_value), bv });
  }
  if (aligned.length < 2) return null;

  const baseS = aligned[0].sv;
  const baseB = aligned[0].bv;
  const series = aligned.map((a) => ({
    date: a.date,
    strategy: round((a.sv / baseS) * 100, 2),
    benchmark: round((a.bv / baseB) * 100, 2),
  }));

  const last = series[series.length - 1];
  const stratRet = last.strategy - 100;
  const benchRet = last.benchmark - 100;

  return {
    series,
    strategy_return_pct: round(stratRet, 2),
    benchmark_return_pct: round(benchRet, 2),
    alpha_pct: round(stratRet - benchRet, 2),
  };
}
