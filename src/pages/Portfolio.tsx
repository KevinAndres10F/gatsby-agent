import { useEffect, useState } from 'react';
import { apiGet, apiPost, fmtUsd, fmtPct, fmtDateTime } from '../lib/api';
import type { PortfolioState, Performance } from '../lib/api';
import { X, Loader2 } from 'lucide-react';

type Tab = 'open' | 'closed';

export default function Portfolio() {
  const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('open');
  const [closingId, setClosingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [p, pf] = await Promise.all([
        apiGet<PortfolioState>('portfolio'),
        apiGet<Performance>('performance'),
      ]);
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

  const handleClose = async (tradeId: number) => {
    setClosingId(tradeId);
    try {
      await apiPost('close-trade', { trade_id: tradeId });
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setClosingId(null);
    }
  };

  const closedTrades = perf?.recent_closed_trades ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xs uppercase tracking-widest text-fg-subtle mb-1">
          portfolio · paper
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Mi portfolio
        </h1>
        <p className="text-sm text-fg-muted mt-1">
          Operaciones simuladas. Sin riesgo de capital real.
        </p>
      </div>

      {/* Resumen */}
      {portfolio && (
        <div className="panel p-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <div className="stat-label">Capital inicial</div>
              <div className="num text-xl font-medium mt-1.5">
                {fmtUsd(portfolio.portfolio.initial_capital)}
              </div>
            </div>
            <div>
              <div className="stat-label">Cash disponible</div>
              <div className="num text-xl font-medium mt-1.5 text-amber-glow">
                {fmtUsd(portfolio.portfolio.cash)}
              </div>
            </div>
            <div>
              <div className="stat-label">Valor posiciones</div>
              <div className="num text-xl font-medium mt-1.5">
                {fmtUsd(portfolio.portfolio.positions_value)}
              </div>
            </div>
            <div>
              <div className="stat-label">Total + retorno</div>
              <div className="flex items-baseline gap-2 mt-1.5">
                <span className="num text-xl font-medium">
                  {fmtUsd(portfolio.portfolio.total_value)}
                </span>
                <span
                  className={`num text-sm ${
                    portfolio.portfolio.total_return_pct >= 0 ? 'text-bull' : 'text-bear'
                  }`}
                >
                  {fmtPct(portfolio.portfolio.total_return_pct)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-bg-border">
        <TabBtn active={tab === 'open'} onClick={() => setTab('open')}>
          Abiertas ({portfolio?.positions.length ?? 0})
        </TabBtn>
        <TabBtn active={tab === 'closed'} onClick={() => setTab('closed')}>
          Cerradas ({closedTrades.length})
        </TabBtn>
      </div>

      {loading && <div className="text-center py-12 text-fg-muted">Cargando…</div>}

      {/* Open positions */}
      {!loading && tab === 'open' && (
        <div className="panel overflow-hidden">
          {portfolio && portfolio.positions.length === 0 ? (
            <div className="p-8 text-center text-fg-muted">
              Sin posiciones abiertas. Ejecuta una señal desde el dashboard.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-bg-surface text-2xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="text-left px-4 py-3">Ticker</th>
                  <th className="text-left px-4 py-3">Dir</th>
                  <th className="text-right px-4 py-3">Shares</th>
                  <th className="text-right px-4 py-3">Entry</th>
                  <th className="text-right px-4 py-3">Current</th>
                  <th className="text-right px-4 py-3">Stop / Target</th>
                  <th className="text-right px-4 py-3">P&L</th>
                  <th className="text-right px-4 py-3">P&L %</th>
                  <th className="text-right px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {portfolio?.positions.map((p) => (
                  <tr key={p.id} className="hover:bg-bg-surface/30">
                    <td className="px-4 py-3">
                      <span className="ticker-pill">{p.ticker}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`num text-2xs px-1.5 py-0.5 rounded ${
                          p.direction === 'LONG'
                            ? 'bg-bull/10 text-bull'
                            : 'bg-bear/10 text-bear'
                        }`}
                      >
                        {p.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 num text-right">{p.shares}</td>
                    <td className="px-4 py-3 num text-right">{fmtUsd(p.entry_price)}</td>
                    <td className="px-4 py-3 num text-right">{fmtUsd(p.current_price)}</td>
                    <td className="px-4 py-3 num text-right text-fg-muted text-2xs">
                      <div className="text-bear">{fmtUsd(p.stop_loss)}</div>
                      <div className="text-bull">{fmtUsd(p.take_profit)}</div>
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
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleClose(p.id)}
                        disabled={closingId === p.id}
                        className="text-fg-muted hover:text-bear transition-colors p-1"
                        title="Cerrar posición"
                      >
                        {closingId === p.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <X size={14} />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Closed trades */}
      {!loading && tab === 'closed' && (
        <div className="panel overflow-hidden">
          {closedTrades.length === 0 ? (
            <div className="p-8 text-center text-fg-muted">Aún no hay trades cerrados.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-bg-surface text-2xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="text-left px-4 py-3">Ticker</th>
                  <th className="text-left px-4 py-3">Dir</th>
                  <th className="text-left px-4 py-3">Entry → Exit</th>
                  <th className="text-left px-4 py-3">Razón</th>
                  <th className="text-right px-4 py-3">P&L</th>
                  <th className="text-right px-4 py-3">P&L %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {closedTrades.map((t: any, i: number) => (
                  <tr key={i} className="hover:bg-bg-surface/30">
                    <td className="px-4 py-3">
                      <span className="ticker-pill">{t.ticker}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`num text-2xs px-1.5 py-0.5 rounded ${
                          t.direction === 'LONG'
                            ? 'bg-bull/10 text-bull'
                            : 'bg-bear/10 text-bear'
                        }`}
                      >
                        {t.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-2xs text-fg-muted num">
                      {fmtDateTime(t.entry_date)} → {fmtDateTime(t.exit_date)}
                    </td>
                    <td className="px-4 py-3 text-2xs text-fg-muted uppercase tracking-wider">
                      {t.exit_reason}
                    </td>
                    <td
                      className={`px-4 py-3 num text-right font-medium ${
                        t.pnl_usd >= 0 ? 'text-bull' : 'text-bear'
                      }`}
                    >
                      {fmtUsd(t.pnl_usd)}
                    </td>
                    <td
                      className={`px-4 py-3 num text-right font-medium ${
                        t.pnl_pct >= 0 ? 'text-bull' : 'text-bear'
                      }`}
                    >
                      {fmtPct(t.pnl_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-3 text-sm transition-colors border-b-2 ${
        active
          ? 'border-amber text-fg'
          : 'border-transparent text-fg-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}
