import { useEffect, useState } from 'react';
import { apiGet, fmtUsd, fmtPct, fmtDate } from '../lib/api';
import type { Signal } from '../lib/api';
import SignalCard from '../components/SignalCard';
import { Filter } from 'lucide-react';

type Direction = 'ALL' | 'LONG' | 'SHORT';
type Conviction = 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW';
type Status = 'ALL' | 'PENDING' | 'EXECUTED';

export default function Signals() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [direction, setDirection] = useState<Direction>('ALL');
  const [conviction, setConviction] = useState<Conviction>('ALL');
  const [status, setStatus] = useState<Status>('ALL');

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiGet<{ signals: Signal[] }>(`signals?days=${days}`);
      setSignals(r.signals);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [days]);

  const filtered = signals.filter((s) => {
    if (direction !== 'ALL' && s.direction !== direction) return false;
    if (conviction !== 'ALL' && s.conviction !== conviction) return false;
    if (status === 'EXECUTED' && !s.executed) return false;
    if (status === 'PENDING' && s.executed) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xs uppercase tracking-widest text-fg-subtle mb-1">
          señales · histórico
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Historial de señales
        </h1>
        <p className="text-sm text-fg-muted mt-1">
          Todas las señales generadas por el agente. Filtra por dirección, convicción
          o estado de ejecución.
        </p>
      </div>

      {/* Filters bar */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3 text-2xs uppercase tracking-widest text-fg-muted">
          <Filter size={12} />
          <span>filtros</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <FilterGroup
            label="Período"
            value={String(days)}
            options={[
              { v: '1', l: 'Hoy' },
              { v: '7', l: '7d' },
              { v: '30', l: '30d' },
              { v: '90', l: '90d' },
            ]}
            onChange={(v) => setDays(Number(v))}
          />
          <FilterGroup
            label="Dirección"
            value={direction}
            options={[
              { v: 'ALL', l: 'Todas' },
              { v: 'LONG', l: 'LONG' },
              { v: 'SHORT', l: 'SHORT' },
            ]}
            onChange={(v) => setDirection(v as Direction)}
          />
          <FilterGroup
            label="Convicción"
            value={conviction}
            options={[
              { v: 'ALL', l: 'Todas' },
              { v: 'HIGH', l: 'HIGH' },
              { v: 'MEDIUM', l: 'MEDIUM' },
              { v: 'LOW', l: 'LOW' },
            ]}
            onChange={(v) => setConviction(v as Conviction)}
          />
          <FilterGroup
            label="Estado"
            value={status}
            options={[
              { v: 'ALL', l: 'Todas' },
              { v: 'PENDING', l: 'Pendientes' },
              { v: 'EXECUTED', l: 'Ejecutadas' },
            ]}
            onChange={(v) => setStatus(v as Status)}
          />
        </div>
      </div>

      {/* Stats inline */}
      <div className="grid grid-cols-3 gap-4">
        <StatBlock label="total" value={String(filtered.length)} />
        <StatBlock
          label="ejecutadas"
          value={String(filtered.filter((s) => s.executed).length)}
        />
        <StatBlock
          label="score promedio"
          value={
            filtered.length > 0
              ? (
                  filtered.reduce((a, s) => a + s.score, 0) / filtered.length
                ).toFixed(1)
              : '—'
          }
        />
      </div>

      {/* Signal cards */}
      {loading && <div className="text-center py-12 text-fg-muted">Cargando…</div>}

      {!loading && filtered.length === 0 && (
        <div className="panel p-8 text-center">
          <p className="text-fg-muted">No hay señales que coincidan con los filtros.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((s) => (
          <SignalCard key={s.id} signal={s} onExecuted={load} />
        ))}
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { v: string; l: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-widest text-fg-subtle mb-1.5">
        {label}
      </div>
      <div className="flex bg-bg-surface rounded border border-bg-border overflow-hidden">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`px-3 py-1.5 text-xs transition-colors ${
              value === o.v
                ? 'bg-amber/10 text-amber-glow'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel px-5 py-3">
      <div className="text-2xs uppercase tracking-widest text-fg-subtle">{label}</div>
      <div className="num text-xl font-medium mt-1">{value}</div>
    </div>
  );
}
