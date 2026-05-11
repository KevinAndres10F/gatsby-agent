/**
 * DISCOVERY — Cron diario L-V 6:00 AM ET (11:00 UTC)
 *
 * Embudo de descubrimiento:
 * 1. Pull Top Gainers/Losers/Most Active de Alpha Vantage (1 API call)
 * 2. Cruza con nuestro universo (S&P 500 + NASDAQ 100)
 * 3. Filtra por liquidez y movimiento razonable
 * 4. Pulls noticias de Finnhub para cada candidato
 * 5. Persiste candidatos para que `analyze` los procese después
 */

import type { Config } from '@netlify/functions';
import { getSupabase, logRunStart, logRunComplete } from './_shared/supabase.ts';
import { getTopMovers } from './_shared/alphavantage.ts';
import { getCompanyNews, throttledMap } from './_shared/finnhub.ts';
import { createHash } from 'node:crypto';

export const config: Config = {
  schedule: '0 11 * * 1-5',
};

const MAX_CANDIDATES = 25;       // máximo de tickers que pasan a analyze
const MIN_VOLUME = 500_000;      // liquidez mínima diaria
const MIN_MOVE_PCT = 1.5;        // movimiento mínimo del día (%)
const MAX_MOVE_PCT = 20;         // descarta moves extremos (probable noise)

export default async () => {
  const runId = await logRunStart('discovery');
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  try {
    // ---- 1. Universo activo ----
    const { data: universe, error: uErr } = await supabase
      .from('universe')
      .select('ticker')
      .eq('active', true);
    if (uErr) throw uErr;
    const universeSet = new Set(universe.map((u) => u.ticker));
    console.log(`[discovery] Universe size: ${universeSet.size}`);

    // ---- 2. Top movers del día ----
    const movers = await getTopMovers();
    console.log(
      `[discovery] Movers: gainers=${movers.gainers.length}, losers=${movers.losers.length}, active=${movers.most_active.length}`,
    );

    type Cand = {
      ticker: string;
      reason: string;
      metrics: Record<string, number>;
    };

    const candidatesMap = new Map<string, Cand>();

    const addIfEligible = (m: any, reason: string) => {
      if (!universeSet.has(m.ticker)) return;
      if (m.volume < MIN_VOLUME) return;
      const movePct = Math.abs(m.change_percentage);
      if (movePct < MIN_MOVE_PCT || movePct > MAX_MOVE_PCT) return;

      // Si ya existe, mantenemos el primer reason y agregamos métricas
      if (!candidatesMap.has(m.ticker)) {
        candidatesMap.set(m.ticker, {
          ticker: m.ticker,
          reason,
          metrics: {
            price: m.price,
            change_pct: m.change_percentage,
            volume: m.volume,
          },
        });
      }
    };

    movers.gainers.forEach((m) => addIfEligible(m, 'gainer'));
    movers.losers.forEach((m) => addIfEligible(m, 'loser'));
    movers.most_active.forEach((m) => addIfEligible(m, 'volume_spike'));

    let candidates = Array.from(candidatesMap.values());
    // Ordena por |change_pct| descendente y tomamos top N
    candidates.sort(
      (a, b) => Math.abs(b.metrics.change_pct) - Math.abs(a.metrics.change_pct),
    );
    candidates = candidates.slice(0, MAX_CANDIDATES);
    console.log(`[discovery] Filtered candidates: ${candidates.length}`);

    if (candidates.length === 0) {
      await logRunComplete(runId, 'success', {
        records_processed: 0,
        metadata: { message: 'No candidates passed filter' },
      });
      return new Response(JSON.stringify({ ok: true, candidates: 0 }));
    }

    // ---- 3. Persistir candidatos ----
    const candRows = candidates.map((c) => ({
      ticker: c.ticker,
      date: today,
      reason: c.reason,
      metrics: c.metrics,
      has_news: false,
      passed_to_llm: false,
    }));

    const { error: insErr } = await supabase
      .from('candidates')
      .upsert(candRows, { onConflict: 'ticker,date' });
    if (insErr) throw insErr;

    // ---- 4. Pulls noticias ----
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let newsCount = 0;

    await throttledMap(candidates, async (c) => {
      try {
        const articles = await getCompanyNews(c.ticker, yesterday, today);
        if (articles.length === 0) return;

        const rows = articles.slice(0, 5).map((a) => ({
          ticker: c.ticker,
          published_at: a.published_at,
          title: a.headline,
          source: a.source,
          url: a.url,
          url_hash: createHash('sha256').update(a.url).digest('hex'),
        }));

        const { error: nErr } = await supabase
          .from('news')
          .upsert(rows, { onConflict: 'url_hash', ignoreDuplicates: true });
        if (!nErr) {
          newsCount += rows.length;
          // Marcar candidate has_news = true
          await supabase
            .from('candidates')
            .update({ has_news: true })
            .eq('ticker', c.ticker)
            .eq('date', today);
        }
      } catch (e) {
        console.error(`[discovery] news error ${c.ticker}:`, e);
      }
    });

    console.log(`[discovery] Inserted ${newsCount} news articles`);

    await logRunComplete(runId, 'success', {
      records_processed: candidates.length,
      metadata: {
        candidates: candidates.length,
        news_articles: newsCount,
      },
    });

    return new Response(
      JSON.stringify({ ok: true, candidates: candidates.length, news: newsCount }),
    );
  } catch (err: any) {
    console.error('[discovery] FATAL:', err);
    await logRunComplete(runId, 'error', { error_message: err.message });
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
    });
  }
};
