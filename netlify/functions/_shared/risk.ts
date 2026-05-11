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

function buildPlan(
  side: 'LONG' | 'SHORT',
  entryPrice: number,
  atr14: number,
  params: Partial<RiskParams>,
): TradePlan | null {
  const p = { ...DEFAULT_PARAMS, ...params };
  if (!atr14 || atr14 <= 0 || entryPrice <= 0) return null;

  const stopDistance = p.atr_multiplier_stop * atr14;
  const targetDistance = p.atr_multiplier_target * atr14;

  const stopLoss =
    side === 'LONG' ? entryPrice - stopDistance : entryPrice + stopDistance;
  const takeProfit =
    side === 'LONG' ? entryPrice + targetDistance : entryPrice - targetDistance;

  if (takeProfit <= 0 || stopLoss <= 0) return null;

  const riskUsd = (p.capital * p.risk_pct) / 100;
  let shares = Math.floor(riskUsd / stopDistance);
  if (shares <= 0) return null;

  let capitalUsed = shares * entryPrice;
  if (capitalUsed > p.capital) {
    shares = Math.floor(p.capital / entryPrice);
    if (shares <= 0) return null;
    capitalUsed = shares * entryPrice;
  }

  const effectiveRisk = shares * stopDistance;

  return {
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    shares,
    capital_used: capitalUsed,
    risk_usd: effectiveRisk,
    risk_pct_of_capital: (effectiveRisk / p.capital) * 100,
    rr_ratio: targetDistance / stopDistance,
  };
}

export function planLongTrade(
  entryPrice: number,
  atr14: number,
  params: Partial<RiskParams> = {},
): TradePlan | null {
  return buildPlan('LONG', entryPrice, atr14, params);
}

export function planShortTrade(
  entryPrice: number,
  atr14: number,
  params: Partial<RiskParams> = {},
): TradePlan | null {
  return buildPlan('SHORT', entryPrice, atr14, params);
}

export function planTrade(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  atr14: number,
  params: Partial<RiskParams> = {},
): TradePlan | null {
  return buildPlan(direction, entryPrice, atr14, params);
}
