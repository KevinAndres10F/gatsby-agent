/**
 * SCAN-MOVERS — Cron cada 5 min en horario de mercado US.
 *
 * Detecta acciones que se mueven RÁPIDO (aceleración intradía) y alerta al
 * instante por Telegram (vía notify), sin LLM, para operar rápido.
 *
 * Híbrido:
 *  - Finnhub /quote (tiempo real) sobre el universo + watchlist temporal,
 *    midiendo velocidad = % de cambio respecto al último snapshot (~5 min).
 *  - Alpha Vantage TOP_GAINERS_LOSERS 2x/día (slots ~10:00 y ~14:00 ET) para
 *    sumar movers de TODO el mercado a `mover_watchlist` (expiran el mismo día).
 *
 * Usa la tabla `quotes` como almacén de snapshots intradía (precio + updated_at).
 */

import type { Config } from '@netlify/functions';
import { getSupabase, logRunStart, logRunComplete } from './_shared/supabase.ts';
import { getFinnhubQuote, throttledMap } from './_shared/finnhub.ts';
import { getTopMovers } from './_shared/alphavantage.ts';
import { notify } from './_shared/notify.ts';

export const config: Config = {
  // Cada 5 min, 13:00–21:55 UTC, L-V. El gate interno afina a 9:30–16:00 ET.
  schedule: '*/5 13-21 * * 1-5',
};

const ENABLED = process.env.MOVER_SCAN_ENABLED !== 'false';
const VELOCITY_PCT = parseFloat(process.env.MOVER_VELOCITY_PCT ?? '2');
const COOLDOWN_MIN = parseInt(process.env.MOVER_COOLDOWN_MIN ?? '30', 10);
const MIN_PRICE = parseFloat(process.env.MOVER_MIN_PRICE ?? '1');
const AV_HOT_THRESHOLD = parseFloat(process.env.AV_HOT_THRESHOLD ?? '5');
const MAX_SYMBOLS = 150;
// Ventana válida de velocidad: descarta snapshots viejos (primer escaneo del
// día) o demasiado cercanos. minutos ∈ [2, 15].
const MIN_GAP_MIN = 2;
const MAX_GAP_MIN = 15;

/** Hora local en una timezone IANA. */
function nowInTz(tz: string): { hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    hour: parseInt(get('hour'), 10) % 24,
    minute: parseInt(get('minute'), 10),
    weekday: wdMap[get('weekday')] ?? 0,
  };
}

/** ¿Estamos en horario de mercado regular (9:30–16:00 ET, L-V)? */
function isMarketHours(et: { hour: number; minute: number; weekday: number }): boolean {
  if (et.weekday < 1 || et.weekday > 5) return false;
  const mins = et.hour * 60 + et.minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export default async () => {
  if (!ENABLED) return new Response(JSON.stringify({ ok: true, skipped: 'disabled' }));

  const et = nowInTz('America/New_York');
  if (!isMarketHours(et)) {
    return new Response(JSON.stringify({ ok: true, skipped: 'closed', et }));
  }

  const runId = await logRunStart('scan-movers');
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  try {
    // ---- 1. Híbrido AV (2x/día): sumar movers de mercado a la watchlist ----
    let avAdded = 0;
    const inAvSlot = (et.hour === 10 || et.hour === 14) && et.minute < 5;
    if (inAvSlot) {
      try {
        const { data: uni } = await supabase
          .from('universe')
          .select('ticker')
          .eq('active', true);
        const universeSet = new Set((uni ?? []).map((u) => u.ticker));

        const movers = await getTopMovers();
        const hot = [
          ...movers.gainers.map((m) => ({ ...m, reason: 'gainer' })),
          ...movers.losers.map((m) => ({ ...m, reason: 'loser' })),
        ].filter(
          (m) =>
            !universeSet.has(m.ticker) &&
            Math.abs(m.change_percentage) >= AV_HOT_THRESHOLD &&
            m.price >= MIN_PRICE,
        );

        if (hot.length > 0) {
          const rows = hot.map((m) => ({
            ticker: m.ticker,
            reason: m.reason,
            change_pct: m.change_percentage,
            added_at: new Date().toISOString(),
            expires_at: today,
          }));
          const { error } = await supabase
            .from('mover_watchlist')
            .upsert(rows, { onConflict: 'ticker' });
          if (!error) avAdded = rows.length;
        }
      } catch (e) {
        console.error('[scan-movers] AV hybrid failed (continuamos):', e);
      }
    }

    // ---- 2. Símbolos a escanear: universo activo ∪ watchlist vigente ----
    const [{ data: uni }, { data: watch }] = await Promise.all([
      supabase.from('universe').select('ticker').eq('active', true),
      supabase.from('mover_watchlist').select('ticker').gte('expires_at', today),
    ]);
    const symbols = Array.from(
      new Set([
        ...(uni ?? []).map((u) => u.ticker),
        ...(watch ?? []).map((w) => w.ticker),
      ]),
    ).slice(0, MAX_SYMBOLS);

    if (symbols.length === 0) {
      await logRunComplete(runId, 'success', { records_processed: 0 });
      return new Response(JSON.stringify({ ok: true, scanned: 0 }));
    }

    // ---- 3. Snapshot previo (tabla quotes) ----
    const { data: prevQuotes } = await supabase
      .from('quotes')
      .select('ticker, price, updated_at')
      .in('ticker', symbols);
    const prevMap = new Map(
      (prevQuotes ?? []).map((q) => [
        q.ticker,
        { price: Number(q.price), updatedAt: new Date(q.updated_at).getTime() },
      ]),
    );

    const nowMs = Date.now();
    const bucket = Math.floor(nowMs / 60000 / COOLDOWN_MIN);
    let scanned = 0;
    let alerts = 0;

    // ---- 4. Escaneo con throttle (Finnhub 60/min) ----
    await throttledMap(symbols, async (ticker) => {
      const quote = await getFinnhubQuote(ticker);
      if (!quote || quote.price < MIN_PRICE) return;
      scanned++;

      const prev = prevMap.get(ticker);

      // Upsert del nuevo snapshot (línea base para el próximo escaneo).
      await supabase.from('quotes').upsert({
        ticker,
        price: quote.price,
        change_pct: quote.change_pct,
        updated_at: new Date(nowMs).toISOString(),
      });

      if (!prev || prev.price <= 0) return;
      const gapMin = (nowMs - prev.updatedAt) / 60000;
      if (gapMin < MIN_GAP_MIN || gapMin > MAX_GAP_MIN) return;

      const velocityPct = ((quote.price - prev.price) / prev.price) * 100;
      if (Math.abs(velocityPct) < VELOCITY_PCT) return;

      const up = velocityPct > 0;
      const dir = up ? 'up' : 'down';
      const dayPct = quote.change_pct ?? 0;
      const dayStr = `${dayPct >= 0 ? '+' : ''}${dayPct.toFixed(2)}%`;
      const velStr = `${up ? '+' : ''}${velocityPct.toFixed(2)}%`;

      await notify({
        type: 'fast_mover',
        severity: 'warning',
        dedup_key: `fast_mover:${ticker}:${dir}:${bucket}`,
        title: `${up ? '🚀' : '🔻'} ${ticker} ${up ? 'subiendo' : 'bajando'} rápido`,
        body:
          `<b>${ticker}</b> a <code>$${quote.price.toFixed(2)}</code>\n` +
          `Velocidad: <b>${velStr}</b> en ${Math.round(gapMin)} min · ` +
          `día <code>${dayStr}</code>\n` +
          `<a href="https://finance.yahoo.com/quote/${ticker}">ver gráfico →</a>`,
        payload: {
          ticker,
          price: quote.price,
          velocity_pct: velocityPct,
          gap_min: gapMin,
          day_pct: dayPct,
        },
      }).catch((e) => console.error('[scan-movers] notify failed:', e));
      alerts++;
    });

    await logRunComplete(runId, 'success', {
      records_processed: scanned,
      metadata: { symbols: symbols.length, scanned, alerts, av_added: avAdded },
    });

    return new Response(
      JSON.stringify({ ok: true, scanned, alerts, av_added: avAdded }),
    );
  } catch (err: any) {
    console.error('[scan-movers] FATAL:', err);
    await logRunComplete(runId, 'error', { error_message: err.message });
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
    });
  }
};
