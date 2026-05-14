/**
 * Telegram bot client. Notifica todas las señales del día y eventos de cierre.
 * Env vars:
 *   TELEGRAM_BOT_TOKEN   token del bot creado con @BotFather
 *   TELEGRAM_CHAT_ID     chat o canal donde se envía
 * Si alguna está ausente, las llamadas son no-op (silenciosas).
 *
 * Usamos parse_mode='HTML' (no Markdown) para evitar fallos 400 cuando el
 * rationale del LLM contiene caracteres especiales como `_`, `*` o backticks.
 */

const API = 'https://api.telegram.org';

function getCreds(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function sendTelegram(text: string): Promise<boolean> {
  const c = getCreds();
  if (!c) {
    console.log('[telegram] credentials not configured, skipping');
    return false;
  }
  try {
    const res = await fetch(`${API}/bot${c.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: c.chatId,
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

function dirIcon(d: SignalSummary['direction']): string {
  if (d === 'LONG') return '🟢 LONG';
  if (d === 'SHORT') return '🔴 SHORT';
  return '⚪ HOLD';
}

function convBadge(c: SignalSummary['conviction']): string {
  if (c === 'HIGH') return '🎯';
  if (c === 'MEDIUM') return '🔸';
  return '🔹';
}

/**
 * Envía un mensaje con todas las señales del día. Si no hay ninguna,
 * envía un resumen "sin señales" para que sepas que el agente sí corrió.
 */
export async function notifySignals(signals: SignalSummary[]): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);

  if (signals.length === 0) {
    await sendTelegram(
      `📊 <b>Reporte ${date}</b>\nEl agente corrió pero no encontró señales accionables hoy.`,
    );
    return;
  }

  const actionable = signals.filter((s) => s.direction !== 'HOLD').length;
  const header =
    `📊 <b>${signals.length} señal(es) · ${date}</b>` +
    (actionable < signals.length
      ? `\n<i>${actionable} accionable(s) · ${signals.length - actionable} en HOLD</i>`
      : '');

  const body = signals
    .map((s) => {
      const head =
        `\n${convBadge(s.conviction)} <b>${escapeHtml(s.ticker)}</b> ${dirIcon(s.direction)}` +
        ` · score <b>${s.score}/100</b> · ${s.conviction}`;

      const hasPlan =
        s.direction !== 'HOLD' &&
        s.entry_price != null &&
        s.stop_loss != null &&
        s.take_profit != null;

      if (!hasPlan) {
        return [head, `<i>${escapeHtml(s.rationale)}</i>`].join('\n');
      }

      const rr =
        Math.abs((s.take_profit as number) - (s.entry_price as number)) /
        Math.max(Math.abs((s.entry_price as number) - (s.stop_loss as number)), 0.01);

      return [
        head + ` · R:R ${rr.toFixed(2)}`,
        `entry <code>$${(s.entry_price as number).toFixed(2)}</code>  ` +
          `stop <code>$${(s.stop_loss as number).toFixed(2)}</code>  ` +
          `target <code>$${(s.take_profit as number).toFixed(2)}</code>`,
        `<i>${escapeHtml(s.rationale)}</i>`,
      ].join('\n');
    })
    .join('\n');

  await sendTelegram(header + body);
}

export async function notifyTradeClosed(payload: {
  ticker: string;
  direction: string;
  pnl_usd: number;
  pnl_pct: number;
  exit_reason: string;
}): Promise<void> {
  const win = payload.pnl_usd >= 0;
  const emoji = win ? '✅' : '🛑';
  const sign = win ? '+' : '-';
  const absUsd = Math.abs(payload.pnl_usd).toFixed(2);
  const absPct = Math.abs(payload.pnl_pct).toFixed(2);
  const text =
    `${emoji} <b>${escapeHtml(payload.ticker)}</b> ${escapeHtml(payload.direction)} cerrado por <b>${escapeHtml(payload.exit_reason)}</b>\n` +
    `P&amp;L: <code>${sign}$${absUsd}</code> (<code>${sign}${absPct}%</code>)`;
  await sendTelegram(text);
}
