import { useEffect, useState } from 'react';
import { apiGet, fmtUsd, fmtDateTime } from '../lib/api';
import { Activity, AlertCircle, CheckCircle, Clock, Zap } from 'lucide-react';

interface FunctionAgg {
  function_name: string;
  total_runs: number;
  success_runs: number;
  error_runs: number;
  partial_runs: number;
  avg_duration_ms: number | null;
  total_cost_usd: number;
  total_records: number;
  last_run: any | null;
  last_success: any | null;
}

interface HealthData {
  since: string;
  days: number;
  total_cost_usd: number;
  functions: FunctionAgg[];
  recent_runs: any[];
}

const FN_LABELS: Record<string, string> = {
  discovery: 'Discovery (6:00 ET)',
  analyze: 'Analyze (6:15 ET)',
  'update-prices': 'Update Prices (cada 2h)',
  'end-of-day': 'End of Day (17:30 ET)',
  'scan-movers': 'Fast Movers (cada 5 min)',
};

const EXPECTED_RUNS_PER_DAY: Record<string, number> = {
  discovery: 1,
  analyze: 1,
  'update-prices': 4,
  'end-of-day': 1,
  'scan-movers': 78, // ~cada 5 min, 9:30–16:00 ET
};

export default function Health() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  useEffect(() => {
    setLoading(true);
    apiGet<HealthData>(`health?days=${days}`)
      .then(setData)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xs uppercase tracking-widest text-fg-subtle mb-1">
          system · observabilidad
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Health
        </h1>
        <p className="text-sm text-fg-muted mt-1">
          Estado de los crons del agente. Si ves error_runs &gt; 0 o un
          last_run viejo, revisa los logs de Netlify.
        </p>
      </div>

      {/* Period selector */}
      <div className="panel p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex bg-bg-surface rounded border border-bg-border overflow-hidden">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs transition-colors ${
                days === d
                  ? 'bg-amber/10 text-amber-glow'
                  : 'text-fg-muted hover:text-fg'
              }`}
            >
              {d === 1 ? 'Hoy' : `${d}d`}
            </button>
          ))}
        </div>
        {data && (
          <div className="text-2xs uppercase tracking-widest text-fg-subtle">
            costo LLM total: <span className="text-amber-glow num">{fmtUsd(data.total_cost_usd)}</span>
          </div>
        )}
      </div>

      {loading && <div className="text-center py-12 text-fg-muted">Cargando…</div>}

      {/* Function status grid */}
      {!loading && data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.functions.map((fn) => (
            <FunctionCard key={fn.function_name} fn={fn} days={days} />
          ))}
        </div>
      )}

      {/* Recent runs table */}
      {!loading && data && data.recent_runs.length > 0 && (
        <section>
          <h2 className="font-display text-xl font-semibold mb-4">
            Últimos runs
          </h2>
          <div className="panel overflow-hidden">
            <div className="table-scroll">
            <table className="w-full text-sm min-w-[42rem]">
              <thead className="bg-bg-surface text-2xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="text-left px-4 py-2.5">Función</th>
                  <th className="text-left px-4 py-2.5">Inicio</th>
                  <th className="text-left px-4 py-2.5">Estado</th>
                  <th className="text-right px-4 py-2.5">Duración</th>
                  <th className="text-right px-4 py-2.5">Records</th>
                  <th className="text-right px-4 py-2.5">Costo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {data.recent_runs.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 num">{r.function_name}</td>
                    <td className="px-4 py-2 num text-2xs text-fg-muted">
                      {fmtDateTime(r.started_at)}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2 num text-right text-2xs text-fg-muted">
                      {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-4 py-2 num text-right text-2xs">
                      {r.records_processed ?? 0}
                    </td>
                    <td className="px-4 py-2 num text-right text-2xs text-fg-muted">
                      {r.llm_cost_usd ? fmtUsd(Number(r.llm_cost_usd)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function FunctionCard({ fn, days }: { fn: FunctionAgg; days: number }) {
  const successRate = fn.total_runs > 0 ? (fn.success_runs / fn.total_runs) * 100 : null;
  const expected = (EXPECTED_RUNS_PER_DAY[fn.function_name] ?? 1) * days;
  const coverage = expected > 0 ? (fn.total_runs / expected) * 100 : null;
  const lastRunAge = fn.last_run
    ? (Date.now() - new Date(fn.last_run.started_at).getTime()) / 3600_000
    : null;
  const stale = lastRunAge != null && lastRunAge > 30; // > 30h sin run = sospechoso

  return (
    <div className="panel">
      <div className="px-5 py-4 border-b border-bg-border flex items-start justify-between">
        <div>
          <div className="font-display text-base font-semibold">
            {FN_LABELS[fn.function_name] ?? fn.function_name}
          </div>
          <div className="text-2xs uppercase tracking-widest text-fg-subtle mt-1">
            {fn.function_name}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {fn.error_runs > 0 ? (
            <AlertCircle size={18} className="text-bear" />
          ) : stale ? (
            <Clock size={18} className="text-amber-glow" />
          ) : (
            <CheckCircle size={18} className="text-bull" />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-bg-border">
        <div className="px-5 py-3">
          <div className="text-2xs uppercase tracking-widest text-fg-subtle">success</div>
          <div className={`num text-lg font-medium ${fn.error_runs > 0 ? 'text-bear' : 'text-bull'}`}>
            {successRate != null ? `${successRate.toFixed(0)}%` : '—'}
          </div>
          <div className="text-2xs text-fg-subtle">
            {fn.success_runs}/{fn.total_runs} runs
          </div>
        </div>
        <div className="px-5 py-3">
          <div className="text-2xs uppercase tracking-widest text-fg-subtle">cobertura</div>
          <div
            className={`num text-lg font-medium ${
              coverage != null && coverage < 80
                ? 'text-amber-glow'
                : 'text-fg'
            }`}
          >
            {coverage != null ? `${coverage.toFixed(0)}%` : '—'}
          </div>
          <div className="text-2xs text-fg-subtle">{fn.total_runs}/{expected} esperados</div>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-bg-border border-t border-bg-border">
        <Mini icon={<Activity size={12} />} label="records" value={String(fn.total_records)} />
        <Mini icon={<Clock size={12} />} label="avg ms" value={fn.avg_duration_ms ? `${(fn.avg_duration_ms / 1000).toFixed(1)}s` : '—'} />
        <Mini icon={<Zap size={12} />} label="costo" value={fmtUsd(fn.total_cost_usd)} />
      </div>
      <div className="px-5 py-3 border-t border-bg-border text-2xs">
        <div className="flex justify-between text-fg-subtle">
          <span>último run</span>
          <span className="text-fg-muted">
            {fn.last_run ? fmtDateTime(fn.last_run.started_at) : '—'}
          </span>
        </div>
        {fn.last_run?.error_message && (
          <div className="mt-2 text-bear text-2xs">⚠ {fn.last_run.error_message}</div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    success: { color: 'bg-bull/10 text-bull', label: 'OK' },
    error: { color: 'bg-bear/10 text-bear', label: 'ERROR' },
    partial: { color: 'bg-amber/10 text-amber-glow', label: 'PARTIAL' },
    running: { color: 'bg-cyan-glow/10 text-cyan-glow', label: 'RUNNING' },
  };
  const m = map[status] ?? { color: 'bg-bg-surface text-fg-muted', label: status };
  return (
    <span className={`text-2xs uppercase tracking-widest px-2 py-0.5 rounded ${m.color}`}>
      {m.label}
    </span>
  );
}

function Mini({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1 text-2xs uppercase tracking-widest text-fg-subtle">
        {icon}
        <span>{label}</span>
      </div>
      <div className="num text-sm mt-0.5">{value}</div>
    </div>
  );
}
