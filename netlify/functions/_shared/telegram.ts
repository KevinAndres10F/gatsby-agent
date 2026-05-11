/**
 * Telegram bot client. Notifica señales HIGH conviction y eventos críticos.
 * Env vars:
 *   TELEGRAM_BOT_TOKEN   token del bot creado con @BotFather
 *   TELEGRAM_CHAT_ID     chat o canal donde se envía
 * Si alguna está ausente, las llamadas son no-op (silenciosas).
 */

const API = 'https://api.telegram.org';

function getCreds(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
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
        parse_mode: 'Markdown',
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

export interface HighConvictionSignal {
  ticker: string;
  direction: 'LONG' | 'SHORT';
  score: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  rationale: string;
}

export async function notifyHighConvictionSignals(
  signals: HighConvictionSignal[],
): Promise<void> {
  if (signals.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  const header = `🎯 *${signals.length} señal(es) HIGH conviction · ${date}*\n`;
  const body = signals
    .map((s) => {
      const arrow = s.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
      const rr =
        Math.abs(s.take_profit - s.entry_price) /
        Math.max(Math.abs(s.entry_price - s.stop_loss), 0.01);
      return [
        `\n*${s.ticker}* ${arrow}  ·  score *${s.score}/100*  ·  R:R ${rr.toFixed(2)}`,
        `entry \`$${s.entry_price.toFixed(2)}\`  stop \`$${s.stop_loss.toFixed(2)}\`  target \`$${s.take_profit.toFixed(2)}\``,
        `_${s.rationale}_`,
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
  const sign = payload.pnl_usd >= 0 ? '+' : '';
  const text =
    `${emoji} *${payload.ticker}* ${payload.direction} cerrado por *${payload.exit_reason}*\n` +
    `P&L: \`${sign}$${payload.pnl_usd.toFixed(2)}\` (\`${sign}${payload.pnl_pct.toFixed(2)}%\`)`;
  await sendTelegram(text);
}
