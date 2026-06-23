/**
 * Telegram = adaptador de canal de bajo nivel detrás de notify().
 * Env vars:
 *   TELEGRAM_BOT_TOKEN   token del bot creado con @BotFather
 *   TELEGRAM_CHAT_ID     chat/canal por defecto (fallback single-user)
 * Si falta el token o no hay chat (ni override ni env), las llamadas son no-op.
 *
 * Usamos parse_mode='HTML' (no Markdown) para evitar fallos 400 cuando el
 * rationale del LLM contiene caracteres especiales como `_`, `*` o backticks.
 *
 * Las funciones de formato (escapeHtml, dirIcon, etc.) se exportan para que
 * notify.ts construya los cuerpos de los mensajes y se reutilicen entre canales.
 */

const API = 'https://api.telegram.org';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Envía un mensaje por Telegram. `chatIdOverride` permite ruteo por usuario
 * (notification_prefs.telegram_chat_id); si falta, cae al TELEGRAM_CHAT_ID global.
 */
export async function sendTelegram(
  text: string,
  chatIdOverride?: string | null,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = chatIdOverride || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[telegram] credentials not configured, skipping');
    return false;
  }
  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error(`[telegram] HTTP ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[telegram] send failed:', e);
    return false;
  }
}

export interface SignalSummary {
  ticker: string;
  direction: 'LONG' | 'SHORT' | 'HOLD';
  conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  score: number;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  rationale: string;
}

export function dirIcon(d: SignalSummary['direction']): string {
  if (d === 'LONG') return '🟢 LONG';
  if (d === 'SHORT') return '🔴 SHORT';
  return '⚪ HOLD';
}

export function convBadge(c: SignalSummary['conviction']): string {
  if (c === 'HIGH') return '🎯';
  if (c === 'MEDIUM') return '🔸';
  return '🔹';
}

/** Línea de cabecera de una señal: "🎯 TICKER 🟢 LONG · score 85/100 · HIGH" */
export function formatSignalHeadline(s: SignalSummary): string {
  return (
    `${convBadge(s.conviction)} <b>${escapeHtml(s.ticker)}</b> ${dirIcon(s.direction)}` +
    ` · score <b>${s.score}/100</b> · ${s.conviction}`
  );
}

/**
 * Cuerpo HTML de una señal (plan de trade + rationale), sin la cabecera.
 * Apto para Telegram y reutilizable por otros canales.
 */
export function formatSignalBody(s: SignalSummary): string {
  const hasPlan =
    s.direction !== 'HOLD' &&
    s.entry_price != null &&
    s.stop_loss != null &&
    s.take_profit != null;

  if (!hasPlan) {
    return `<i>${escapeHtml(s.rationale)}</i>`;
  }

  const rr =
    Math.abs((s.take_profit as number) - (s.entry_price as number)) /
    Math.max(Math.abs((s.entry_price as number) - (s.stop_loss as number)), 0.01);

  return [
    `R:R ${rr.toFixed(2)}`,
    `entry <code>$${(s.entry_price as number).toFixed(2)}</code>  ` +
      `stop <code>$${(s.stop_loss as number).toFixed(2)}</code>  ` +
      `target <code>$${(s.take_profit as number).toFixed(2)}</code>`,
    `<i>${escapeHtml(s.rationale)}</i>`,
  ].join('\n');
}

export function formatTradeClosedBody(payload: {
  ticker: string;
  direction: string;
  pnl_usd: number;
  pnl_pct: number;
  exit_reason: string;
}): string {
  const win = payload.pnl_usd >= 0;
  const sign = win ? '+' : '-';
  const absUsd = Math.abs(payload.pnl_usd).toFixed(2);
  const absPct = Math.abs(payload.pnl_pct).toFixed(2);
  return (
    `${escapeHtml(payload.ticker)} ${escapeHtml(payload.direction)} cerrado por ` +
    `<b>${escapeHtml(payload.exit_reason)}</b>\n` +
    `P&amp;L: <code>${sign}$${absUsd}</code> (<code>${sign}${absPct}%</code>)`
  );
}
