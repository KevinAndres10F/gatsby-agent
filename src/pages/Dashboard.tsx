import { useEffect, useState } from 'react';
import { apiGet, fmtUsd, fmtPct } from '../lib/api';
import type { Signal, PortfolioState, Performance } from '../lib/api';
import StatCard from '../components/StatCard';
import SignalCard from '../components/SignalCard';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [s, p, pf] = await Promise.all([
        apiGet<{ signals: Signal[] }>('signals?days=1'),
        apiGet<PortfolioState>('portfolio'),
        apiGet<Performance>('performance'),
      ]);
      setSignals(s.signals);
      setPortfolio(p);
      setPerf(pf);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const todaysSignals = signals.filter((s) => !s.executed).slice(0, 5);
  const isProfit = (portfolio?.portfolio.total_return_pct ?? 0) >= 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="text-2xs uppercase tracking-widest text-fg-subtle mb-1">
          dashboard · {new Date().toLocaleDateString('es-ES')}
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Mercado de hoy
        </h1>
        <p className="text-sm text-fg-muted mt-1">
          Señales generadas por el agente y estado de tu portfolio paper.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Value"
          value={fmtUsd(portfolio?.portfolio.total_value)}
          delta={
            portfolio
              ? fmtPct(portfolio.portfolio.total_return_pct)
              : undefined
          }
          deltaPositive={isProfit}
          hint="vs capital inicial"
        />
        <StatCard
          label="Cash"
          value={fmtUsd(portfolio?.portfolio.cash)}
          hint={`${portfolio?.positions.length ?? 0} posiciones abiertas`}
        />
        <StatCard
          label="Hit Rate"
          value={`${(perf?.performance.hit_rate_pct ?? 0).toFixed(1)}%`}
          hint={`${perf?.performance.winning_trades ?? 0}W / ${
            perf?.performance.losing_trades ?? 0
          }L`}
        />
        <StatCard
          label="P&L Realizado"
          value={fmtUsd(perf?.performance.total_pnl_usd)}
          deltaPositive={(perf?.performance.total_pnl_usd ?? 0) >= 0}
          delta={fmtPct(perf?.performance.avg_pnl_pct)}
          hint="promedio por trade"
        />
      </div>

      {/* Señales del día */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Señales de hoy</h2>
            <p className="text-2xs text-fg-subtle uppercase tracking-widest mt-1">
              generadas a las 06:15 ET · ranked por score
            </p>
          </div>
          <Link
            to="/signals"
            className="text-2xs uppercase tracking-widest text-amber-glow hover:text-amber"
          >
            Ver historial →
          </Link>
        </div>

        {loading && (
          <div className="text-center py-12 text-fg-muted">Cargando…</div>
        )}

        {!loading && todaysSignals.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="text-fg-muted">
              No hay señales nuevas hoy. El agente corre L–V a las 6:15 AM ET.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {todaysSignals.map((s) => (
            <SignalCard key={s.id} signal={s} onExecuted={load} />
          ))}
        </div>
      </section>

      {/* Posiciones abiertas */}
      {portfolio && portfolio.positions.length > 0 && (
        <section>
          <h2 className="font-display text-xl font-semibold mb-4">
            Posiciones abiertas
          </h2>
          <div className="panel overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-surface text-2xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="text-left px-4 py-2.5">Ticker</th>
                  <th className="text-right px-4 py-2.5">Entry</th>
                  <th className="text-right px-4 py-2.5">Current</th>
                  <th className="text-right px-4 py-2.5">P&L</th>
                  <th className="text-right px-4 py-2.5">P&L %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {portfolio.positions.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <span className="ticker-pill">{p.ticker}</span>
                    </td>
                    <td className="px-4 py-3 num text-right">
                      {fmtUsd(p.entry_price)}
                    </td>
                    <td className="px-4 py-3 num text-right">
                      {fmtUsd(p.current_price)}
                    </td>
                    <td
                      className={`px-4 py-3 num text-right font-medium ${
                        (p.floating_pnl_usd ?? 0) >= 0 ? 'text-bull' : 'text-bear'
                      }`}
                    >
                      {fmtUsd(p.floating_pnl_usd)}
                    </td>
                    <td
                      className={`px-4 py-3 num text-right font-medium ${
                        (p.floating_pnl_pct ?? 0) >= 0 ? 'text-bull' : 'text-bear'
                      }`}
                    >
                      {fmtPct(p.floating_pnl_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
