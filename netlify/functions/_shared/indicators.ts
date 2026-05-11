/**
 * Indicadores técnicos implementados en TypeScript puro.
 * Todas las funciones reciben arrays ordenados cronológicamente (más antiguo primero).
 */

import type { DailyBar } from './alphavantage.ts';

/**
 * Simple Moving Average. Devuelve null si no hay suficientes datos.
 */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * RSI (Relative Strength Index) clásico de 14 períodos (Wilder).
 */
export function rsi(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  // Primer promedio simple
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Suavizado de Wilder
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * ATR (Average True Range) — clave para position sizing.
 */
export function atr(bars: DailyBar[], period: number = 14): number | null {
  if (bars.length < period + 1) return null;

  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    trs.push(tr);
  }

  // Wilder smoothing
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }
  return atrVal;
}

/**
 * Calcula todos los indicadores para una serie de barras y devuelve
 * un objeto con los valores de la fecha más reciente.
 */
export interface IndicatorSnapshot {
  rsi_14: number | null;
  atr_14: number | null;
  sma_20: number | null;
  sma_50: number | null;
  sma_200: number | null;
  current_close: number;
  distance_to_sma20_pct: number | null;
  distance_to_sma50_pct: number | null;
  volume_ratio_20d: number | null;
}

export function computeIndicators(bars: DailyBar[]): IndicatorSnapshot {
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const lastClose = closes[closes.length - 1];

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const avgVol20 = sma(volumes, 20);
  const lastVol = volumes[volumes.length - 1];

  return {
    rsi_14: rsi(closes, 14),
    atr_14: atr(bars, 14),
    sma_20: sma20,
    sma_50: sma50,
    sma_200: sma200,
    current_close: lastClose,
    distance_to_sma20_pct: sma20 ? ((lastClose - sma20) / sma20) * 100 : null,
    distance_to_sma50_pct: sma50 ? ((lastClose - sma50) / sma50) * 100 : null,
    volume_ratio_20d: avgVol20 && avgVol20 > 0 ? lastVol / avgVol20 : null,
  };
}
