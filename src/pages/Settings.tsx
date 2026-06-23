import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Bell, Save, CheckCircle, AlertCircle } from 'lucide-react';

const SENTINEL = '00000000-0000-0000-0000-000000000000';

type Severity = 'info' | 'warning' | 'critical';

interface Prefs {
  telegram_chat_id: string | null;
  channels_signal: string[];
  channels_trade: string[];
  channels_digest: string[];
  channels_system: string[];
  min_severity: Severity;
  quiet_start: number | null;
  quiet_end: number | null;
  tz: string;
  enabled: boolean;
}

const DEFAULTS: Prefs = {
  telegram_chat_id: '',
  channels_signal: ['telegram'],
  channels_trade: ['telegram'],
  channels_digest: ['telegram'],
  channels_system: ['telegram'],
  min_severity: 'info',
  quiet_start: null,
  quiet_end: null,
  tz: 'America/New_York',
  enabled: true,
};

const CATEGORIES: { key: keyof Prefs; label: string; desc: string }[] = [
  { key: 'channels_signal', label: 'Señales HIGH', desc: 'Alertas de señales de alta convicción aprobadas por el Risk Manager' },
  { key: 'channels_trade', label: 'Trades y proximidad', desc: 'Cierres por stop/target y avisos de proximidad' },
  { key: 'channels_digest', label: 'Digests', desc: 'Resumen matutino y de cierre de mercado' },
  { key: 'channels_system', label: 'Sistema', desc: 'Fallos de los crons del agente (críticos)' },
];

export default function Settings() {
  const { user, authEnabled } = useAuth();
  const userId = user?.id ?? SENTINEL;
  const canEdit = authEnabled && !!user;

  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    supabase
      .from('notification_prefs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setPrefs({
            ...DEFAULTS,
            ...data,
            telegram_chat_id: data.telegram_chat_id ?? '',
          });
        }
        setLoading(false);
      });
  }, [userId]);

  const toggleChannel = (key: keyof Prefs) => {
    const arr = prefs[key] as string[];
    const next = arr.includes('telegram') ? [] : ['telegram'];
    setPrefs({ ...prefs, [key]: next });
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const payload = {
      user_id: userId,
      telegram_chat_id: prefs.telegram_chat_id?.trim() || null,
      channels_signal: prefs.channels_signal,
      channels_trade: prefs.channels_trade,
      channels_digest: prefs.channels_digest,
      channels_system: prefs.channels_system,
      min_severity: prefs.min_severity,
      quiet_start: prefs.quiet_start,
      quiet_end: prefs.quiet_end,
      tz: prefs.tz || 'America/New_York',
      enabled: prefs.enabled,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('notification_prefs')
      .upsert(payload, { onConflict: 'user_id' });
    setSaving(false);
    setMsg(
      error
        ? { ok: false, text: error.message }
        : { ok: true, text: 'Preferencias guardadas.' },
    );
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="text-2xs uppercase tracking-widest text-fg-subtle mb-1">
          system · notificaciones
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Bell size={24} /> Ajustes de notificaciones
        </h1>
        <p className="text-sm text-fg-muted mt-1">
          Controla qué alertas recibes por Telegram, su severidad mínima y las
          horas de silencio.
        </p>
      </div>

      {!canEdit && (
        <div className="panel p-4 text-sm text-amber-glow flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <span>
            Modo single-user (sin sesión). Estas preferencias se gestionan por
            variables de entorno del servidor. Inicia sesión para personalizarlas
            por usuario.
          </span>
        </div>
      )}

      {loading && <div className="text-center py-12 text-fg-muted">Cargando…</div>}

      {!loading && (
        <fieldset disabled={!canEdit} className="space-y-6">
          {/* Master toggle */}
          <div className="panel p-5 flex items-center justify-between">
            <div>
              <div className="font-display text-base font-semibold">
                Notificaciones activas
              </div>
              <div className="text-2xs text-fg-subtle mt-0.5">
                Interruptor general. Las críticas (fallos del sistema) ignoran
                las horas de silencio.
              </div>
            </div>
            <Toggle
              on={prefs.enabled}
              onClick={() => setPrefs({ ...prefs, enabled: !prefs.enabled })}
            />
          </div>

          {/* Telegram chat id */}
          <div className="panel p-5 space-y-2">
            <label className="font-display text-base font-semibold">
              Telegram Chat ID
            </label>
            <p className="text-2xs text-fg-subtle">
              Tu chat de Telegram (déjalo vacío para usar el chat global del
              servidor). Obtenlo con @userinfobot.
            </p>
            <input
              type="text"
              value={prefs.telegram_chat_id ?? ''}
              onChange={(e) =>
                setPrefs({ ...prefs, telegram_chat_id: e.target.value })
              }
              placeholder="-100123456789"
              className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-sm num focus:outline-none focus:border-amber"
            />
          </div>

          {/* Categories */}
          <div className="panel divide-y divide-bg-border">
            {CATEGORIES.map((c) => (
              <div key={c.key} className="p-5 flex items-center justify-between">
                <div>
                  <div className="font-display text-base font-semibold">
                    {c.label}
                  </div>
                  <div className="text-2xs text-fg-subtle mt-0.5">{c.desc}</div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(prefs[c.key] as string[]).includes('telegram')}
                    onChange={() => toggleChannel(c.key)}
                    className="accent-amber"
                  />
                  Telegram
                </label>
              </div>
            ))}
          </div>

          {/* Severity + quiet hours */}
          <div className="panel p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="font-display text-base font-semibold">
                Severidad mínima
              </label>
              <select
                value={prefs.min_severity}
                onChange={(e) =>
                  setPrefs({ ...prefs, min_severity: e.target.value as Severity })
                }
                className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-amber"
              >
                <option value="info">Info (todo)</option>
                <option value="warning">Warning y críticas</option>
                <option value="critical">Solo críticas</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="font-display text-base font-semibold">
                Zona horaria
              </label>
              <input
                type="text"
                value={prefs.tz}
                onChange={(e) => setPrefs({ ...prefs, tz: e.target.value })}
                placeholder="America/New_York"
                className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-amber"
              />
            </div>
            <div className="space-y-2">
              <label className="font-display text-base font-semibold">
                Silencio desde (hora)
              </label>
              <HourSelect
                value={prefs.quiet_start}
                onChange={(v) => setPrefs({ ...prefs, quiet_start: v })}
              />
            </div>
            <div className="space-y-2">
              <label className="font-display text-base font-semibold">
                Silencio hasta (hora)
              </label>
              <HourSelect
                value={prefs.quiet_end}
                onChange={(v) => setPrefs({ ...prefs, quiet_end: v })}
              />
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || !canEdit}
              className="flex items-center gap-2 bg-amber/10 text-amber-glow border border-amber/30 rounded px-4 py-2 text-sm hover:bg-amber/20 disabled:opacity-50 transition-colors"
            >
              <Save size={16} />
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            {msg && (
              <span
                className={`flex items-center gap-1.5 text-sm ${
                  msg.ok ? 'text-bull' : 'text-bear'
                }`}
              >
                {msg.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                {msg.text}
              </span>
            )}
          </div>
        </fieldset>
      )}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-11 h-6 rounded-full transition-colors relative ${
        on ? 'bg-amber/40' : 'bg-bg-surface border border-bg-border'
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-fg transition-transform ${
          on ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function HourSelect({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-amber"
    >
      <option value="">—</option>
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, '0')}:00
        </option>
      ))}
    </select>
  );
}
