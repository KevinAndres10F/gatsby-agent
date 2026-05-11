/**
 * ANALYZE — Cron diario L-V 6:15 AM ET (11:15 UTC)
 *
 * Toma los candidatos del día generados por `discovery` y produce señales:
 * 1. Para cada candidato con noticias: pull histórico, calcula indicadores
 * 2. Envía noticias a Claude (batch) → análisis estructurado
 * 3. Envía contextos a Claude (batch) → señales con score, dirección, conviction
 * 4. Calcula stop/target/sizing con risk.ts
 * 5. Persiste en `signals`
 */

import type { Config } from '@netlify/functions';
import {
  getSupabase,
  logRunStart,
  logRunComplete,
} from './_shared/supabase.ts';
import { getDailyHistory } from './_shared/alphavantage.ts';
import { computeIndicators } from './_shared/indicators.ts';
import {
  analyzeNews,
  generateSignals,
  type NewsItem,
  type SignalContext,
} from './_shared/claude.ts';
import { planLongTrade } from './_shared/risk.ts';

export const config: Config = {
  schedule: '15 11 * * 1-5',
};

const TOP_N_FINAL_SIGNALS = 5;     // máximo de señales que generamos al día
const MIN_LLM_CONFIDENCE = 0.4;    // si Claude marca conf < 0.4, descartamos

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
      .is('sentiment', null);          // solo noticias no analizadas aún
    if (nErr) throw nErr;

    if (!newsRows || newsRows.length === 0) {
      console.log('[analyze] No new news to analyze.');
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

    // Persistir análisis en cada noticia (matching por orden + ticker + título)
    const updates = newsResult.analyses.map((a, i) => ({
      id: newsRows[i].id,
      sentiment: a.sentiment,
      risk_level: a.risk_level,
      novelty: a.novelty,
      confidence: a.confidence,
      summary: a.summary,
      catalysts: a.catalysts,
      tokens_used: Math.round(
        (newsResult.usage.input_tokens + newsResult.usage.output_tokens) /
          newsRows.length,
      ),
      cost_usd: newsResult.usage.cost_usd / newsRows.length,
    }));

    for (const u of updates) {
      await supabase.from('news').update(u).eq('id', u.id);
    }

    // ---- 4. Construir contextos para señales (un contexto por ticker) ----
    const contexts: SignalContext[] = [];

    for (const cand of candidates) {
      try {
        // Histórico para indicadores
        const bars = await getDailyHistory(cand.ticker, 'compact');
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

        // Persistir prices snapshot
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

        // Pequeña pausa para no rebasar Alpha Vantage rate limit
        await new Promise((r) => setTimeout(r, 12_500));
      } catch (e) {
        console.error(`[analyze] error en ${cand.ticker}:`, e);
      }
    }

    if (contexts.length === 0) {
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

    // Filtrar y rankear
    const ranked = sigResult.signals
      .filter((s) => s.direction !== 'HOLD')
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N_FINAL_SIGNALS);

    // ---- 6. Persistir señales con plan de trade ----
    let inserted = 0;
    for (const sig of ranked) {
      const ctx = contexts.find((c) => c.ticker === sig.ticker);
      if (!ctx || !ctx.technical.atr_14) continue;

      const plan =
        sig.direction === 'LONG'
          ? planLongTrade(ctx.current_price, ctx.technical.atr_14)
          : null;
      if (!plan) continue;

      const { data: portfolio } = await supabase
        .from('portfolio')
        .select('cash')
        .order('id')
        .limit(1)
        .single();
      const positionPct = portfolio
        ? (plan.capital_used / portfolio.cash) * 100
        : 10;

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
          entry_price: plan.entry_price,
          stop_loss: plan.stop_loss,
          take_profit: plan.take_profit,
          position_size_pct: positionPct,
          technical_score: sig.technical_score,
          sentiment_score: sig.sentiment_score,
          rationale: sig.rationale,
          news_ids: newsIds,
        },
        { onConflict: 'ticker,date' },
      );
      if (!sErr) inserted++;
    }

    console.log(`[analyze] Signals generated: ${inserted}`);

    await logRunComplete(runId, 'success', {
      records_processed: inserted,
      llm_tokens_used: totalTokensIn + totalTokensOut,
      llm_cost_usd: totalCost,
      metadata: {
        candidates_processed: candidates.length,
        news_analyzed: newsRows.length,
        signals_generated: inserted,
      },
    });

    return new Response(
      JSON.stringify({ ok: true, signals: inserted, cost_usd: totalCost }),
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
