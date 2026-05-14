/**
 * ANALYZE — Cron diario L-V 6:15 AM ET (11:15 UTC)
 *
 * Toma los candidatos del día generados por `discovery` y produce señales:
 * 1. Para cada candidato con noticias: pull histórico (con caché), calcula indicadores
 * 2. Envía noticias a Claude (batch) → análisis estructurado
 * 3. Envía contextos a Claude (batch) → señales con score, dirección, conviction
 * 4. Calcula stop/target/sizing con risk.ts (LONG y SHORT)
 * 5. Persiste en `signals`
 * 6. Notifica HIGH conviction por Telegram
 */

import type { Config } from '@netlify/functions';
import {
  getSupabase,
  logRunStart,
  logRunComplete,
} from './_shared/supabase.ts';
import { getDailyHistory, type DailyBar } from './_shared/alphavantage.ts';
import { computeIndicators } from './_shared/indicators.ts';
import {
  analyzeNews,
  generateSignals,
  type NewsItem,
  type SignalContext,
} from './_shared/claude.ts';
import { planTrade } from './_shared/risk.ts';
import { notifySignals, type SignalSummary } from './_shared/telegram.ts';

export const config: Config = {
  schedule: '15 11 * * 1-5',
};

const TOP_N_FINAL_SIGNALS = 5;     // máximo de señales que generamos al día
const MIN_LLM_CONFIDENCE = 0.4;    // si Claude marca conf < 0.4, descartamos
const ALPHA_VANTAGE_THROTTLE_MS = 12_500; // 5 req/min free tier
const DAYS_FOR_INDICATORS = 220;   // necesarios para SMA200

/**
 * Carga histórico de un ticker desde Supabase. Si tiene la vela de hoy,
 * o suficiente data fresca, evita la llamada a Alpha Vantage.
 */
async function loadBarsWithCache(
  supabase: ReturnType<typeof getSupabase>,
  ticker: string,
  today: string,
): Promise<{ bars: DailyBar[]; usedCache: boolean }> {
  const cutoff = new Date(Date.now() - DAYS_FOR_INDICATORS * 86400_000)
    .toISOString()
    .slice(0, 10);

  const { data: cached } = await supabase
    .from('prices')
    .select('date, open, high, low, close, volume')
    .eq('ticker', ticker)
    .gte('date', cutoff)
    .order('date', { ascending: true });

  const latestCached = cached && cached.length > 0 ? cached[cached.length - 1].date : null;
  const hasToday = latestCached === today;

  if (cached && hasToday && cached.length >= 200) {
    return {
      bars: cached.map((r: any) => ({
        date: r.date,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      })),
      usedCache: true,
    };
  }

  const fresh = await getDailyHistory(ticker, 'compact');
  return { bars: fresh, usedCache: false };
}

export default async () => {
  const runId = await logRunStart('analyze');
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCost = 0;

  try {
    // ---- 1. Cargar candidatos del día con noticias ----
    const { data: candidates, error: cErr } = await supabase
      .from('candidates')
      .select('ticker, reason, metrics')
      .eq('date', today)
      .eq('has_news', true);
    if (cErr) throw cErr;

    if (!candidates || candidates.length === 0) {
      console.log('[analyze] No candidates with news today.');
      await notifySignals([]).catch((e) =>
        console.error('[analyze] telegram notify failed:', e),
      );
      await logRunComplete(runId, 'success', { records_processed: 0 });
      return new Response(JSON.stringify({ ok: true, signals: 0 }));
    }
    console.log(`[analyze] Candidates with news: ${candidates.length}`);

    // ---- 2. Cargar noticias de esos candidatos ----
    const tickers = candidates.map((c) => c.ticker);
    const yesterday = new Date(Date.now() - 86400000).toISOString();

    const { data: newsRows, error: nErr } = await supabase
      .from('news')
      .select('id, ticker, title, source, published_at')
      .in('ticker', tickers)
      .gte('published_at', yesterday)
      .is('sentiment', null);
    if (nErr) throw nErr;

    if (!newsRows || newsRows.length === 0) {
      console.log('[analyze] No new news to analyze.');
      await notifySignals([]).catch((e) =>
        console.error('[analyze] telegram notify failed:', e),
      );
      await logRunComplete(runId, 'success', { records_processed: 0 });
      return new Response(JSON.stringify({ ok: true, signals: 0 }));
    }
    console.log(`[analyze] News articles to analyze: ${newsRows.length}`);

    // ---- 3. Análisis de noticias con Claude (batch) ----
    const newsItems: NewsItem[] = newsRows.map((n) => ({
      ticker: n.ticker,
      title: n.title,
      source: n.source ?? undefined,
      published_at: n.published_at ?? undefined,
    }));

    const newsResult = await analyzeNews(newsItems);
    totalTokensIn += newsResult.usage.input_tokens;
    totalTokensOut += newsResult.usage.output_tokens;
    totalCost += newsResult.usage.cost_usd;

    // ---- C. Batch update news (1 upsert vs N updates) ----
    const tokensPerNews = Math.round(
      (newsResult.usage.input_tokens + newsResult.usage.output_tokens) / newsRows.length,
    );
    const costPerNews = newsResult.usage.cost_usd / newsRows.length;

    const newsUpdates = newsResult.analyses.map((a, i) => ({
      id: newsRows[i].id,
      ticker: newsRows[i].ticker,
      title: newsRows[i].title,
      sentiment: a.sentiment,
      risk_level: a.risk_level,
      novelty: a.novelty,
      confidence: a.confidence,
      summary: a.summary,
      catalysts: a.catalysts,
      tokens_used: tokensPerNews,
      cost_usd: costPerNews,
    }));

    const { error: updErr } = await supabase
      .from('news')
      .upsert(newsUpdates, { onConflict: 'id' });
    if (updErr) console.error('[analyze] news batch upsert error:', updErr.message);

    // ---- 4. Construir contextos para señales ----
    const contexts: SignalContext[] = [];
    let cachedCount = 0;
    let fetchedCount = 0;

    for (const cand of candidates) {
      try {
        const { bars, usedCache } = await loadBarsWithCache(supabase, cand.ticker, today);
        if (usedCache) cachedCount++; else fetchedCount++;

        if (bars.length < 30) {
          console.log(`[analyze] ${cand.ticker}: insufficient history`);
          continue;
        }
        const ind = computeIndicators(bars);

        // Análisis de noticias asociado
        const ctxNews = newsResult.analyses.filter(
          (a, i) =>
            newsRows[i].ticker === cand.ticker &&
            a.confidence >= MIN_LLM_CONFIDENCE,
        );

        if (ctxNews.length === 0) continue;

        // Persistir prices snapshot solo si no estaba en caché
        if (!usedCache) {
          const lastBar = bars[bars.length - 1];
          await supabase.from('prices').upsert({
            ticker: cand.ticker,
            date: lastBar.date,
            open: lastBar.open,
            high: lastBar.high,
            low: lastBar.low,
            close: lastBar.close,
            volume: lastBar.volume,
            rsi_14: ind.rsi_14,
            atr_14: ind.atr_14,
            sma_20: ind.sma_20,
            sma_50: ind.sma_50,
            sma_200: ind.sma_200,
          });
        }

        contexts.push({
          ticker: cand.ticker,
          current_price: ind.current_close,
          technical: {
            rsi_14: ind.rsi_14,
            atr_14: ind.atr_14,
            sma_20: ind.sma_20,
            sma_50: ind.sma_50,
            sma_200: ind.sma_200,
            distance_to_sma20_pct: ind.distance_to_sma20_pct,
            distance_to_sma50_pct: ind.distance_to_sma50_pct,
          },
          news_analyses: ctxNews,
        });

        // Solo throttle si tocamos la API de Alpha Vantage
        if (!usedCache) {
          await new Promise((r) => setTimeout(r, ALPHA_VANTAGE_THROTTLE_MS));
        }
      } catch (e) {
        console.error(`[analyze] error en ${cand.ticker}:`, e);
      }
    }

    console.log(`[analyze] Bars: ${cachedCount} cached / ${fetchedCount} fetched`);

    if (contexts.length === 0) {
      await notifySignals([]).catch((e) =>
        console.error('[analyze] telegram notify failed:', e),
      );
      await logRunComplete(runId, 'partial', {
        records_processed: 0,
        llm_tokens_used: totalTokensIn + totalTokensOut,
        llm_cost_usd: totalCost,
        metadata: { reason: 'No contexts built' },
      });
      return new Response(JSON.stringify({ ok: true, signals: 0 }));
    }

    // ---- 5. Generación de señales finales ----
    const sigResult = await generateSignals(contexts);
    totalTokensIn += sigResult.usage.input_tokens;
    totalTokensOut += sigResult.usage.output_tokens;
    totalCost += sigResult.usage.cost_usd;

    // Conservamos top N por score, incluyendo HOLD para que la web refleje
    // que el agente sí corrió y razonó sobre los candidatos.
    const ranked = sigResult.signals
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N_FINAL_SIGNALS);

    // ---- 6. Persistir señales (con plan solo para LONG/SHORT) ----
    const { data: portfolio } = await supabase
      .from('portfolio')
      .select('cash')
      .order('id')
      .limit(1)
      .single();

    const insertedSignals: SignalSummary[] = [];

    for (const sig of ranked) {
      const ctx = contexts.find((c) => c.ticker === sig.ticker);
      if (!ctx) continue;

      const isActionable = sig.direction === 'LONG' || sig.direction === 'SHORT';
      const plan = isActionable && ctx.technical.atr_14
        ? planTrade(
            sig.direction as 'LONG' | 'SHORT',
            ctx.current_price,
            ctx.technical.atr_14,
            { capital: portfolio?.cash ?? 10000 },
          )
        : null;

      // Para HOLD (o LONG/SHORT sin ATR), guardamos precio de referencia
      // pero sin stop/target ni sizing — la señal es informativa.
      const entryPrice = plan?.entry_price ?? ctx.current_price;
      const stopLoss = plan?.stop_loss ?? null;
      const takeProfit = plan?.take_profit ?? null;
      const positionPct = plan && portfolio
        ? (plan.capital_used / portfolio.cash) * 100
        : 0;

      const newsIds = newsRows
        .filter((n) => n.ticker === sig.ticker)
        .map((n) => n.id);

      const { error: sErr } = await supabase.from('signals').upsert(
        {
          ticker: sig.ticker,
          date: today,
          score: sig.score,
          direction: sig.direction,
          conviction: sig.conviction,
          entry_price: entryPrice,
          stop_loss: stopLoss,
          take_profit: takeProfit,
          position_size_pct: positionPct,
          technical_score: sig.technical_score,
          sentiment_score: sig.sentiment_score,
          rationale: sig.rationale,
          news_ids: newsIds,
        },
        { onConflict: 'ticker,date' },
      );
      if (!sErr) {
        insertedSignals.push({
          ticker: sig.ticker,
          direction: sig.direction,
          score: sig.score,
          entry_price: entryPrice,
          stop_loss: stopLoss,
          take_profit: takeProfit,
          rationale: sig.rationale,
          conviction: sig.conviction,
        });
      }
    }

    const actionableCount = insertedSignals.filter(
      (s) => s.direction !== 'HOLD',
    ).length;
    const highConviction = insertedSignals.filter((s) => s.conviction === 'HIGH');
    console.log(
      `[analyze] Signals generated: ${insertedSignals.length} (${actionableCount} actionable, ${highConviction.length} HIGH)`,
    );

    // ---- 7. Notificación Telegram (todas las señales del día) ----
    try {
      await notifySignals(insertedSignals);
    } catch (e) {
      console.error('[analyze] telegram notify failed:', e);
    }

    await logRunComplete(runId, 'success', {
      records_processed: insertedSignals.length,
      llm_tokens_used: totalTokensIn + totalTokensOut,
      llm_cost_usd: totalCost,
      metadata: {
        candidates_processed: candidates.length,
        news_analyzed: newsRows.length,
        signals_generated: insertedSignals.length,
        bars_cached: cachedCount,
        bars_fetched: fetchedCount,
        high_conviction: highConviction.length,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        signals: insertedSignals.length,
        high_conviction: highConviction.length,
        cost_usd: totalCost,
      }),
    );
  } catch (err: any) {
    console.error('[analyze] FATAL:', err);
    await logRunComplete(runId, 'error', {
      error_message: err.message,
      llm_tokens_used: totalTokensIn + totalTokensOut,
      llm_cost_usd: totalCost,
    });
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
    });
  }
};
