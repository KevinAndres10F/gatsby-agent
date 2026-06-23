import { useEffect, useState, useCallback } from 'react';
import {
  getNotifications,
  markNotificationsRead,
  fmtDateTime,
  type AppNotification,
} from '../lib/api';
import { Bell, Check, RefreshCw } from 'lucide-react';

type Cat = 'ALL' | 'mover' | 'signal' | 'trade' | 'digest' | 'system';

const FILTERS: { key: Cat; label: string }[] = [
  { key: 'ALL', label: 'Todas' },
  { key: 'mover', label: 'Movimientos' },
  { key: 'signal', label: 'Señales' },
  { key: 'trade', label: 'Trades' },
  { key: 'digest', label: 'Digests' },
  { key: 'system', label: 'Sistema' },
];

const TYPE_META: Record<string, { label: string; icon: string }> = {
  fast_mover: { label: 'Movimiento rápido', icon: '🚀' },
  signal_high: { label: 'Señal HIGH', icon: '🎯' },
  trade_closed: { label: 'Trade cerrado', icon: '✅' },
  stop_proximity: { label: 'Proximidad stop/target', icon: '⚠️' },
  digest_morning: { label: 'Digest matutino', icon: '📊' },
  digest_eod: { label: 'Cierre del día', icon: '📊' },
  system_error: { label: 'Sistema', icon: '🚨' },
};

function catOf(type: string): Cat {
  if (type.startsWith('fast') || type.startsWith('mover')) return 'mover';
  if (type.startsWith('signal')) return 'signal';
  if (type.startsWith('trade') || type.startsWith('stop')) return 'trade';
  if (type.startsWith('digest')) return 'digest';
  return 'system';
}

function sevColor(sev: AppNotification['severity']): string {
  if (sev === 'critical') return 'text-bear';
  if (sev === 'warning') return 'text-amber-glow';
  return 'text-fg-muted';
}

export default function Alerts() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Cat>('ALL');

  const load = useCallback(async () => {
    try {
      const r = await getNotifications({ limit: 100 });
      setItems(r.notifications);
      setUnread(r.unread_count);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000); // refresco suave cada 30s
    return () => clearInterval(id);
  }, [load]);

  const markOne = async (id: number) => {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    setUnread((u) => Math.max(0, u - 1));
    try {
      await markNotificationsRead({ ids: [id] });
    } catch (e) {
      console.error(e);
      load();
    }
  };

  const markAll = async () => {
    setItems((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
    );
    setUnread(0);
    try {
      await markNotificationsRead({ all: true });
    } catch (e) {
      console.error(e);
      load();
    }
  };

  const filtered =
    filter === 'ALL' ? items : items.filter((n) => catOf(n.type) === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-2xs uppercase tracking-widest text-fg-subtle mb-1">
            notificaciones · {unread} sin leer
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Bell size={24} /> Alertas
          </h1>
          <p className="text-sm text-fg-muted mt-1">
            Movimientos rápidos, señales, trades y digests — el mismo historial
            que llega a Telegram.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-2xs uppercase tracking-widest text-fg-muted hover:text-fg px-3 py-2 rounded-md border border-bg-border bg-bg-surface/50 transition-colors"
          >
            <RefreshCw size={13} /> Refrescar
          </button>
          <button
            onClick={markAll}
            disabled={unread === 0}
            className="flex items-center gap-1.5 text-2xs uppercase tracking-widest text-amber-glow hover:text-amber px-3 py-2 rounded-md border border-amber/30 bg-amber/10 disabled:opacity-40 transition-colors"
          >
            <Check size={13} /> Marcar todas
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n =
            f.key === 'ALL'
              ? items.length
              : items.filter((i) => catOf(i.type) === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                filter === f.key
                  ? 'bg-amber/10 text-amber-glow border-amber/30'
                  : 'border-bg-border text-fg-muted hover:text-fg'
              }`}
            >
              {f.label} <span className="num text-2xs text-fg-subtle">{n}</span>
            </button>
          );
        })}
      </div>

      {loading && <div className="text-center py-12 text-fg-muted">Cargando…</div>}

      {!loading && filtered.length === 0 && (
        <div className="panel p-10 text-center text-fg-muted">
          No hay alertas en esta categoría todavía.
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((n) => {
          const meta = TYPE_META[n.type] ?? { label: n.type, icon: '🔔' };
          const isUnread = !n.read_at;
          return (
            <div
              key={n.id}
              className={`panel p-4 flex gap-3 ${
                isUnread ? 'border-l-2 border-l-amber' : ''
              }`}
            >
              <div className="text-lg leading-none mt-0.5 select-none">
                {meta.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-medium ${sevColor(n.severity)}`}>
                    {n.title}
                  </span>
                  <span className="text-2xs uppercase tracking-widest text-fg-subtle">
                    {meta.label}
                  </span>
                  {isUnread && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-glow" />
                  )}
                </div>
                {n.body && (
                  <div
                    className="alert-body text-sm text-fg-muted mt-1 whitespace-pre-line break-words"
                    dangerouslySetInnerHTML={{ __html: n.body }}
                  />
                )}
                <div className="text-2xs text-fg-subtle num mt-1.5">
                  {fmtDateTime(n.created_at)}
                </div>
              </div>
              {isUnread && (
                <button
                  onClick={() => markOne(n.id)}
                  title="Marcar como leída"
                  className="text-fg-subtle hover:text-bull transition-colors p-1 self-start"
                >
                  <Check size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
