import { useState } from 'react';
import { apiPost, fmtPct, fmtUsd, fmtNum, fmtDate } from '../lib/api';
import type { BacktestRun } from '../lib/api';
import { Loader2, Play } from 'lucide-react';
import StatCard from '../components/StatCard';

type Mode = 'technical' | 'llm-replay';
type Conviction = 'LOW' | 'MEDIUM' | 'HIGH';

export default function Backtest() {
  const [mode, setMode] = useState<Mode>('technical');
  const [tickers, setTickers] = useState('SPY,AAPL,MSFT,NVDA,AMZN');
  const [years, setYears] = useState(2);
  const [minConviction, setMinConviction] = useState<Conviction>('LOW');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    run_id: number;
    total_trades: number;
    hit_rate_pct: number;
    total_return_pct: number;
    sharpe: number | null;
    sortino: number | null;
    max_drawdown_pct: number | null;
    signals_replayed?: number;
  } | null>(null);
  const [history, setHistory] = useState<BacktestRun[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - years * 365 * 86400_000)
        .toISOString()
        .slice(0, 10);

      let endpoint: string;
      let body: Record<string, unknown>;
      if (mode === 'technical') {
        const tickerList = tickers
          .split(',')
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean);
        endpoint = '/.netlify/functions/backtest';
        body = { tickers: tickerList, from, to: today };
      } else {
        endpoint = '/.netlify/functions/backtest-llm-replay';
        body = { from, to: today, min_conviction: minConviction };
      }

      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as any).error ?? `HTTP ${r.status}`);
      }
      const json = await r.json();
      setResult(json);
    } catch (e: any) {
      setError(e.message ?? 'Error en backtest');
    } finally {
      setRunning(false);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const r = await apiPost<{ runs: BacktestRun[] }>('backtest-runs', {});
      setHistory(r.runs ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xs uppercase tracking-widest text-fg-subtle mb-1">
          backtest · histórico
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Backtesting
        </h1>
        <p className="text-sm text-fg-muted mt-1">
          {mode === 'technical'
            ? 'Estrategia técnica clásica (SMA cross + RSI) sobre datos históricos.'
            : 'Replay de las señales LLM ya generadas como paper trades. Valida si las señales tienen edge real.'}
        </p>
      </div>

      {/* Mode selector */}
      <div className="panel p-4">
        <div className="text-2xs uppercase tracking-widest text-fg-subtle mb-2">
          modo
        </div>
        <div className="flex bg-bg-surface rounded border border-bg-border overflow-hidden w-fit">
          <button
            onClick={() => setMode('technical')}
            className={`px-4 py-1.5 text-xs transition-colors ${
              mode === 'technical'
                ? 'bg-amber/10 text-amber-glow'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            Técnico
          </button>
          <button
            onClick={() => setMode('llm-replay')}
            className={`px-4 py-1.5 text-xs transition-colors ${
              mode === 'llm-replay'
                ? 'bg-amber/10 text-amber-glow'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            LLM Replay
          </button>
        </div>
      </div>

      {/* Form */}
      <section className="panel p-6 space-y-5">
        {mode === 'technical' && (
          <div>
            <label className="block text-2xs uppercase tracking-widest text-fg-subtle mb-2">
              Tickers (separados por coma)
            </label>
            <input
              type="text"
              value={tickers}
              onChange={(e) => setTickers(e.target.value)}
              className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-sm num focus:outline-none focus:border-amber/40"
              placeholder="SPY,AAPL,MSFT"
            />
            <p className="text-2xs text-fg-subtle mt-2">
              Cada ticker consume 1 request de Alpha Vantage (free tier: 25/día). Ideal: 3-8 tickers.
            </p>
          </div>
        )}
        {mode === 'llm-replay' && (
          <div>
            <label className="block text-2xs uppercase tracking-widest text-fg-subtle mb-2">
              Convicción mínima
            </label>
            <div className="flex gap-2">
              {(['LOW', 'MEDIUM', 'HIGH'] as Conviction[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setMinConviction(c)}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    minConviction === c
                      ? 'bg-amber/10 text-amber-glow border-amber/30'
                      : 'border-bg-border text-fg-muted hover:text-fg'
                  }`}
                >
                  {c}+
                </button>
              ))}
            </div>
            <p className="text-2xs text-fg-subtle mt-2">
              Replay toma las señales ya persistidas en <code>signals</code>. Sin coste de Claude.
              Limitado al sample acumulado hasta hoy.
            </p>
          </div>
        )}
        <div>
          <label className="block text-2xs uppercase tracking-widest text-fg-subtle mb-2">
            Período
          </label>
          <div className="flex gap-2">
            {[1, 2, 3, 5].map((y) => (
              <button
                key={y}
                onClick={() => setYears(y)}
                className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                  years === y
                    ? 'bg-amber/10 text-amber-glow border-amber/30'
                    : 'border-bg-border text-fg-muted hover:text-fg'
                }`}
              >
                {y}y
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber/10 hover:bg-amber/20 text-amber-glow border border-amber/30 rounded text-xs uppercase tracking-widest disabled:opacity-50"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? 'Ejecutando…' : 'Ejecutar backtest'}
        </button>
        {error && <div className="text-2xs text-bear">{error}</div>}
        {running && (
          <div className="text-2xs text-fg-subtle">
            {mode === 'technical'
              ? 'Esto tarda ~13s por ticker (rate limit Alpha Vantage). Tomá un café ☕'
              : 'Tarda ~13s por ticker único en las señales. Más rápido cuanto menos diversidad.'}
          </div>
        )}
      </section>

      {/* Result */}
      {result && (
        <section className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total trades"
              value={String(result.total_trades)}
              hint="ejecutados en simulación"
            />
            <StatCard
              label="Hit rate"
              value={`${result.hit_rate_pct.toFixed(1)}%`}
              deltaPositive={result.hit_rate_pct >= 45}
            />
            <StatCard
              label="Retorno total"
              value={fmtPct(result.total_return_pct)}
              deltaPositive={result.total_return_pct >= 0}
            />
            <StatCard
              label="Sharpe"
              value={fmtNum(result.sharpe)}
              deltaPositive={(result.sharpe ?? 0) >= 1}
              hint={`Sortino ${fmtNum(result.sortino)} · MaxDD ${fmtPct(result.max_drawdown_pct)}`}
            />
          </div>
          <div className="text-2xs text-fg-subtle">
            Run #{result.run_id} guardado en <code>backtest_runs</code>
            {result.signals_replayed != null && ` · ${result.signals_replayed} señales replicadas`}.
            Puedes revisar los trades individuales en Supabase.
          </div>
        </section>
      )}

      {/* History */}
      <section className="panel">
        <div className="panel-header">
          <span>historial de runs</span>
          <button
            onClick={loadHistory}
            disabled={loadingHistory}
            className="text-2xs uppercase tracking-widest text-amber-glow hover:text-amber disabled:opacity-50"
          >
            {loadingHistory ? 'Cargando…' : 'Refrescar'}
          </button>
        </div>
        {history.length === 0 ? (
          <div className="p-8 text-center text-fg-muted text-sm">
            {loadingHistory ? 'Cargando…' : 'Click "Refrescar" para ver runs anteriores.'}
          </div>
        ) : (
          <div className="table-scroll">
          <table className="w-full text-sm min-w-[44rem]">
            <thead className="bg-bg-surface/50 text-2xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="text-left px-4 py-2.5">Run</th>
                <th className="text-left px-4 py-2.5">Período</th>
                <th className="text-right px-4 py-2.5">Trades</th>
                <th className="text-right px-4 py-2.5">Hit %</th>
                <th className="text-right px-4 py-2.5">Return</th>
                <th className="text-right px-4 py-2.5">Sharpe</th>
                <th className="text-right px-4 py-2.5">Max DD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 num text-2xs text-fg-muted">
                    #{r.id} · {fmtDate(r.started_at)}
                  </td>
                  <td className="px-4 py-2.5 num text-2xs text-fg-muted">
                    {r.from_date} → {r.to_date}
                  </td>
                  <td className="px-4 py-2.5 num text-right">{r.total_trades ?? '—'}</td>
                  <td className="px-4 py-2.5 num text-right">
                    {r.hit_rate_pct != null ? `${r.hit_rate_pct.toFixed(1)}%` : '—'}
                  </td>
                  <td
                    className={`px-4 py-2.5 num text-right ${
                      (r.total_return_pct ?? 0) >= 0 ? 'text-bull' : 'text-bear'
                    }`}
                  >
                    {fmtPct(r.total_return_pct)}
                  </td>
                  <td className="px-4 py-2.5 num text-right">{fmtNum(r.sharpe)}</td>
                  <td className="px-4 py-2.5 num text-right text-bear">
                    {fmtPct(r.max_drawdown_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </div>
  );
}
