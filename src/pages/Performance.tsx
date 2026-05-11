import { useEffect, useState } from 'react';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
  Legend,
} from 'recharts';
import { apiGet, fmtUsd, fmtPct, fmtDate, fmtNum } from '../lib/api';
import type { Performance } from '../lib/api';
import StatCard from '../components/StatCard';

export default function PerformancePage() {
  const [perf, setPerf] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Performance>('performance')
      .then(setPerf)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-fg-muted">Cargando…</div>;
  }
  if (!perf) {
    return <div className="text-center py-12 text-fg-muted">Sin datos.</div>;
  }

  const { performance: m, advanced, equity_curve, benchmark, recent_closed_trades } = perf;
  const initial = equity_curve[0]?.total_value ?? 10000;
  const last = equity_curve[equity_curve.length - 1]?.total_value ?? initial;
  const totalReturn = ((last - initial) / initial) * 100;

  const chartData = equity_curve.map((p) => ({
    date: p.date.slice(5),
    value: Number(p.total_value),
    pnl: Number(p.daily_pnl_pct),
  }));

  const winCount = m.winning_trades;
  const lossCount = m.losing_trades;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xs uppercase tracking-widest text-fg-subtle mb-1">
          performance · backtest paper
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Resultados del agente
        </h1>
        <p className="text-sm text-fg-muted mt-1">
          ¿Estamos ganando con las predicciones? Validación antes de operar capital real.
        </p>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Hit Rate"
          value={`${m.hit_rate_pct.toFixed(1)}%`}
          hint={`${m.winning_trades} ganadores · ${m.losing_trades} perdedores`}
        />
        <StatCard
          label="P&L Realizado"
          value={fmtUsd(m.total_pnl_usd)}
          deltaPositive={m.total_pnl_usd >= 0}
          delta={fmtPct(totalReturn)}
        />
        <StatCard
          label="P&L Promedio"
          value={fmtPct(m.avg_pnl_pct)}
          hint="por trade cerrado"
        />
        <StatCard
          label="Trades Total"
          value={String(m.total_trades)}
          hint="cerrados (paper)"
        />
      </div>

      {/* Risk-adjusted KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Sharpe"
          value={fmtNum(advanced.sharpe)}
          hint="anualizado · rf 4%"
          deltaPositive={(advanced.sharpe ?? 0) >= 1}
          delta={
            advanced.sharpe == null
              ? undefined
              : advanced.sharpe >= 1
                ? 'bueno'
                : advanced.sharpe >= 0
                  ? 'flojo'
                  : 'malo'
          }
        />
        <StatCard
          label="Sortino"
          value={fmtNum(advanced.sortino)}
          hint="downside risk"
          deltaPositive={(advanced.sortino ?? 0) >= 1}
        />
        <StatCard
          label="Max Drawdown"
          value={fmtPct(advanced.max_drawdown_pct)}
          hint="peor caída desde peak"
          deltaPositive={(advanced.max_drawdown_pct ?? 0) > -15}
        />
        <StatCard
          label="Calmar"
          value={fmtNum(advanced.calmar)}
          hint="CAGR / |MaxDD|"
          deltaPositive={(advanced.calmar ?? 0) >= 1}
        />
      </div>

      {/* Equity curve */}
      <section className="panel">
        <div className="panel-header">
          <span>equity curve · {chartData.length} días</span>
          <span className={totalReturn >= 0 ? 'text-bull num' : 'text-bear num'}>
            {fmtPct(totalReturn)}
          </span>
        </div>
        <div className="p-5">
          {chartData.length < 2 ? (
            <div className="h-64 flex items-center justify-center text-fg-muted text-sm">
              Aún no hay suficientes datos. Vuelve después de algunos cierres diarios.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={chartData}>
                <defs>
                  <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#2a2a31" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke="#5a5a68"
                  tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="#5a5a68"
                  tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                  axisLine={false}
                  tickLine={false}
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#121215',
                    border: '1px solid #2a2a31',
                    borderRadius: 6,
                    fontFamily: 'IBM Plex Mono',
                    fontSize: 12,
                  }}
                  formatter={(v: any) => fmtUsd(Number(v))}
                  labelStyle={{ color: '#9090a0' }}
                />
                <ReferenceLine
                  y={initial}
                  stroke="#5a5a68"
                  strokeDasharray="4 4"
                  label={{ value: 'inicial', position: 'right', fill: '#5a5a68', fontSize: 10 }}
                />
                <Area type="monotone" dataKey="value" stroke="none" fill="url(#eq)" />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#fbbf24' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Benchmark vs SPY */}
      {benchmark && benchmark.series.length > 1 && (
        <section className="panel">
          <div className="panel-header">
            <span>estrategia vs SPY · base 100</span>
            <span
              className={`num ${benchmark.alpha_pct >= 0 ? 'text-bull' : 'text-bear'}`}
            >
              α {fmtPct(benchmark.alpha_pct)}
            </span>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4 mb-4 text-2xs">
              <div>
                <div className="text-fg-subtle uppercase tracking-widest">estrategia</div>
                <div className="num text-amber-glow text-lg mt-1">
                  {fmtPct(benchmark.strategy_return_pct)}
                </div>
              </div>
              <div>
                <div className="text-fg-subtle uppercase tracking-widest">SPY</div>
                <div className="num text-cyan-glow text-lg mt-1">
                  {fmtPct(benchmark.benchmark_return_pct)}
                </div>
              </div>
              <div>
                <div className="text-fg-subtle uppercase tracking-widest">alpha</div>
                <div
                  className={`num text-lg mt-1 ${
                    benchmark.alpha_pct >= 0 ? 'text-bull' : 'text-bear'
                  }`}
                >
                  {fmtPct(benchmark.alpha_pct)}
                </div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={benchmark.series.map((d) => ({ ...d, date: d.date.slice(5) }))}>
                <CartesianGrid stroke="#2a2a31" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke="#5a5a68"
                  tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="#5a5a68"
                  tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                  axisLine={false}
                  tickLine={false}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#121215',
                    border: '1px solid #2a2a31',
                    borderRadius: 6,
                    fontFamily: 'IBM Plex Mono',
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} />
                <ReferenceLine y={100} stroke="#5a5a68" strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="strategy"
                  name="estrategia"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  name="SPY"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Distribución W/L + métricas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="panel">
          <div className="panel-header">distribución w/l</div>
          <div className="p-5">
            <div className="flex items-end gap-1 h-32">
              <div className="flex-1 flex flex-col justify-end items-center gap-2">
                <div className="num text-bull">{winCount}</div>
                <div
                  className="w-full bg-bull/30 border-t-2 border-bull"
                  style={{
                    height:
                      winCount + lossCount > 0
                        ? `${(winCount / (winCount + lossCount)) * 100}%`
                        : '0%',
                  }}
                />
                <div className="text-2xs uppercase tracking-widest text-fg-subtle">
                  wins
                </div>
              </div>
              <div className="flex-1 flex flex-col justify-end items-center gap-2">
                <div className="num text-bear">{lossCount}</div>
                <div
                  className="w-full bg-bear/30 border-t-2 border-bear"
                  style={{
                    height:
                      winCount + lossCount > 0
                        ? `${(lossCount / (winCount + lossCount)) * 100}%`
                        : '0%',
                  }}
                />
                <div className="text-2xs uppercase tracking-widest text-fg-subtle">
                  losses
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">risk-adjusted</div>
          <div className="p-5 space-y-3">
            <RowKv label="CAGR" value={fmtPct(advanced.cagr_pct)} />
            <RowKv label="Volatilidad anual" value={fmtPct(advanced.volatility_annual_pct)} />
            <RowKv label="Sharpe (rf 4%)" value={fmtNum(advanced.sharpe)} />
            <RowKv label="Sortino" value={fmtNum(advanced.sortino)} />
            <RowKv label="Max drawdown" value={fmtPct(advanced.max_drawdown_pct)} />
            <RowKv label="Calmar" value={fmtNum(advanced.calmar)} />
            <RowKv
              label="Edge ¿positivo?"
              value={m.total_pnl_usd > 0 ? 'SÍ ✓' : 'AÚN NO'}
              valueClass={m.total_pnl_usd > 0 ? 'text-bull' : 'text-fg-muted'}
            />
          </div>
        </section>
      </div>

      {/* Trades recientes */}
      <section className="panel">
        <div className="panel-header">últimos trades cerrados</div>
        {recent_closed_trades.length === 0 ? (
          <div className="p-8 text-center text-fg-muted">Aún no hay cierres.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg-surface/50 text-2xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="text-left px-4 py-2.5">Ticker</th>
                <th className="text-left px-4 py-2.5">Cerrado</th>
                <th className="text-left px-4 py-2.5">Razón</th>
                <th className="text-right px-4 py-2.5">P&L</th>
                <th className="text-right px-4 py-2.5">P&L %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {recent_closed_trades.slice(0, 10).map((t: any, i: number) => (
                <tr key={i}>
                  <td className="px-4 py-2.5">
                    <span className="ticker-pill">{t.ticker}</span>
                  </td>
                  <td className="px-4 py-2.5 text-2xs text-fg-muted num">
                    {fmtDate(t.exit_date)}
                  </td>
                  <td className="px-4 py-2.5 text-2xs uppercase tracking-wider text-fg-muted">
                    {t.exit_reason}
                  </td>
                  <td className={`px-4 py-2.5 num text-right ${t.pnl_usd >= 0 ? 'text-bull' : 'text-bear'}`}>
                    {fmtUsd(t.pnl_usd)}
                  </td>
                  <td className={`px-4 py-2.5 num text-right ${t.pnl_pct >= 0 ? 'text-bull' : 'text-bear'}`}>
                    {fmtPct(t.pnl_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function RowKv({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-2xs uppercase tracking-widest text-fg-muted">{label}</span>
      <span className={`num ${valueClass ?? 'text-fg'}`}>{value}</span>
    </div>
  );
}
