/**
 * notify() — capa única de notificaciones.
 *
 * Cada notificación se PERSISTE en la tabla `notifications`, se deduplica por
 * (user_id, dedup_key), se filtra por preferencias del usuario
 * (notification_prefs: canales por categoría, severidad mínima, quiet hours) y
 * se hace fan-out a los canales habilitados. Hoy el único canal de push es
 * Telegram; el diseño deja listos email/in-app como adaptadores futuros sin
 * tocar los call-sites.
 *
 * El fan-out usa Promise.allSettled y nunca lanza: preserva la resiliencia de
 * los crons (un fallo de canal no rompe la corrida).
 */

import { getSupabase, SINGLE_USER_ID } from './supabase.ts';
import { sendTelegram, escapeHtml } from './telegram.ts';

export type Severity = 'info' | 'warning' | 'critical';
export type Channel = 'telegram' | 'email' | 'inapp';

export interface NotifyInput {
  user_id?: string | null;
  type: string; // signal_high | stop_proximity | trade_closed | digest_morning | digest_eod | system_error
  severity: Severity;
  title: string;
  body: string; // HTML (Telegram parse_mode=HTML); persistido tal cual
  payload?: Record<string, unknown>;
  dedup_key?: string;
  channels?: Channel[]; // override; si se omite usa las prefs por categoría
}

interface Prefs {
  telegram_chat_id: string | null;
  channels_signal: string[];
  channels_trade: string[];
  channels_digest: string[];
  channels_system: string[];
  channels_mover: string[];
  min_severity: Severity;
  quiet_start: number | null;
  quiet_end: number | null;
  tz: string;
  enabled: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = { info: 1, warning: 2, critical: 3 };

const DEFAULT_PREFS: Prefs = {
  telegram_chat_id: null,
  channels_signal: ['telegram'],
  channels_trade: ['telegram'],
  channels_digest: ['telegram'],
  channels_system: ['telegram'],
  channels_mover: ['telegram'],
  min_severity: 'info',
  quiet_start: null,
  quiet_end: null,
  tz: 'America/New_York',
  enabled: true,
};

function severityIcon(s: Severity): string {
  if (s === 'critical') return '🚨';
  if (s === 'warning') return '⚠️';
  return 'ℹ️';
}

function categoryFor(
  type: string,
): 'signal' | 'trade' | 'digest' | 'system' | 'mover' {
  if (type.startsWith('fast') || type.startsWith('mover')) return 'mover';
  if (type.startsWith('signal')) return 'signal';
  if (type.startsWith('trade') || type.startsWith('stop')) return 'trade';
  if (type.startsWith('digest')) return 'digest';
  return 'system';
}

function channelsForCategory(prefs: Prefs, type: string): Channel[] {
  switch (categoryFor(type)) {
    case 'mover':
      return prefs.channels_mover as Channel[];
    case 'signal':
      return prefs.channels_signal as Channel[];
    case 'trade':
      return prefs.channels_trade as Channel[];
    case 'digest':
      return prefs.channels_digest as Channel[];
    default:
      return prefs.channels_system as Channel[];
  }
}

function currentHourInTz(tz: string): number {
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    }).format(new Date());
    return parseInt(s, 10) % 24;
  } catch {
    return new Date().getUTCHours();
  }
}

function inQuietHours(prefs: Prefs): boolean {
  if (prefs.quiet_start == null || prefs.quiet_end == null) return false;
  const h = currentHourInTz(prefs.tz);
  const { quiet_start: a, quiet_end: b } = prefs;
  if (a === b) return false;
  return a < b ? h >= a && h < b : h >= a || h < b; // soporta cruce de medianoche
}

async function loadPrefs(
  supabase: ReturnType<typeof getSupabase>,
  userId: string,
): Promise<Prefs> {
  const { data, error } = await supabase
    .from('notification_prefs')
    .select(
      'telegram_chat_id, channels_signal, channels_trade, channels_digest, channels_system, channels_mover, min_severity, quiet_start, quiet_end, tz, enabled',
    )
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return DEFAULT_PREFS;
  return { ...DEFAULT_PREFS, ...data } as Prefs;
}

export async function notify(input: NotifyInput): Promise<void> {
  const supabase = getSupabase();
  const userId = input.user_id ?? SINGLE_USER_ID;

  const row = {
    user_id: userId,
    type: input.type,
    severity: input.severity,
    title: input.title,
    body: input.body,
    payload: input.payload ?? {},
    dedup_key: input.dedup_key ?? null,
    channels: [] as string[],
  };

  // ---- 1. Persistir con dedup ----
  let notificationId: number | null = null;
  try {
    if (input.dedup_key) {
      const { data, error } = await supabase
        .from('notifications')
        .upsert(row, { onConflict: 'user_id,dedup_key', ignoreDuplicates: true })
        .select('id');
      if (error) {
        console.error('[notify] upsert error:', error.message);
        return;
      }
      if (!data || data.length === 0) return; // dedup hit: ya enviada
      notificationId = data[0].id;
    } else {
      const { data, error } = await supabase
        .from('notifications')
        .insert(row)
        .select('id')
        .single();
      if (error) {
        console.error('[notify] insert error:', error.message);
        return;
      }
      notificationId = data.id;
    }
  } catch (e) {
    console.error('[notify] persist failed:', e);
    return;
  }

  // ---- 2. Prefs + filtros ----
  const prefs = await loadPrefs(supabase, userId);
  if (!prefs.enabled) return;
  if (SEVERITY_RANK[input.severity] < SEVERITY_RANK[prefs.min_severity]) return;

  // Quiet hours: las no-críticas quedan persistidas pero no se hace push.
  if (input.severity !== 'critical' && inQuietHours(prefs)) return;

  const channels = input.channels ?? channelsForCategory(prefs, input.type);

  // ---- 3. Fan-out (nunca lanza) ----
  const message = `${severityIcon(input.severity)} <b>${escapeHtml(input.title)}</b>\n${input.body}`;
  const sent: string[] = [];
  const results = await Promise.allSettled([
    (async () => {
      if (!channels.includes('telegram')) return;
      const ok = await sendTelegram(message, prefs.telegram_chat_id);
      if (ok) sent.push('telegram');
    })(),
    // Futuro: email (Resend), inapp (Supabase Realtime) como adaptadores aquí.
  ]);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[notify] channel failed:', r.reason);
  }

  // ---- 4. Marcar enviada ----
  if (notificationId != null) {
    const { error: upErr } = await supabase
      .from('notifications')
      .update({ sent_at: new Date().toISOString(), channels: sent })
      .eq('id', notificationId);
    if (upErr) console.error('[notify] mark sent failed:', upErr.message);
  }
}
