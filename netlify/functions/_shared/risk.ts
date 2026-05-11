/**
 * Risk management.
 * Position sizing basado en ATR y % de riesgo por trade.
 */

export interface RiskParams {
  capital: number;          // capital disponible en USD
  risk_pct: number;         // % de capital a arriesgar por trade (típico: 1)
  atr_multiplier_stop: number;       // típico: 1.5
  atr_multiplier_target: number;     // típico: 2.5 (ratio R:R = 1.67)
}

export interface TradePlan {
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  shares: number;
  capital_used: number;
  risk_usd: number;
  risk_pct_of_capital: number;
  rr_ratio: number;
}

const DEFAULT_PARAMS: RiskParams = {
  capital: 10000,
  risk_pct: 1.0,
  atr_multiplier_stop: 1.5,
  atr_multiplier_target: 2.5,
};

/**
 * Calcula plan de trade para LONG.
 * - stop_loss = entry - 1.5 * ATR
 * - shares = (capital * risk%) / (entry - stop_loss)
 */
export function planLongTrade(
  entryPrice: number,
  atr14: number,
  params: Partial<RiskParams> = {},
): TradePlan | null {
  const p = { ...DEFAULT_PARAMS, ...params };
  if (!atr14 || atr14 <= 0 || entryPrice <= 0) return null;

  const stopDistance = p.atr_multiplier_stop * atr14;
  const targetDistance = p.atr_multiplier_target * atr14;

  const stopLoss = entryPrice - stopDistance;
  const takeProfit = entryPrice + targetDistance;

  const riskUsd = (p.capital * p.risk_pct) / 100;
  const shares = Math.floor(riskUsd / stopDistance);

  if (shares <= 0) return null;

  const capitalUsed = shares * entryPrice;
  // No exceder el capital disponible
  if (capitalUsed > p.capital) {
    const cappedShares = Math.floor(p.capital / entryPrice);
    if (cappedShares <= 0) return null;
    return {
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      shares: cappedShares,
      capital_used: cappedShares * entryPrice,
      risk_usd: cappedShares * stopDistance,
      risk_pct_of_capital: ((cappedShares * stopDistance) / p.capital) * 100,
      rr_ratio: targetDistance / stopDistance,
    };
  }

  return {
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    shares,
    capital_used: capitalUsed,
    risk_usd: riskUsd,
    risk_pct_of_capital: p.risk_pct,
    rr_ratio: targetDistance / stopDistance,
  };
}
