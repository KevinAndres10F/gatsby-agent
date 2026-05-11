import { useState } from 'react';
import { ArrowUpRight, Check, Loader2 } from 'lucide-react';
import { apiPost, fmtUsd, fmtPct } from '../lib/api';
import type { Signal } from '../lib/api';

interface Props {
  signal: Signal;
  onExecuted?: () => void;
}

export default function SignalCard({ signal, onExecuted }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLong = signal.direction === 'LONG';
  const convictionColor =
    signal.conviction === 'HIGH'
      ? 'text-amber-glow border-amber-glow/30 bg-amber-glow/5'
      : signal.conviction === 'MEDIUM'
        ? 'text-cyan-glow border-cyan-glow/30 bg-cyan-glow/5'
        : 'text-fg-muted border-bg-border bg-bg-surface';

  const handleExecute = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiPost('execute', { signal_id: signal.id });
      onExecuted?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const rrRatio =
    Math.abs(signal.take_profit - signal.entry_price) /
    Math.max(Math.abs(signal.entry_price - signal.stop_loss), 0.01);

  return (
    <div className="panel hover:border-amber/40 transition-colors">
      <div className="px-5 py-4 border-b border-bg-border">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="ticker-pill text-sm px-2.5 py-1">{signal.ticker}</span>
              <span
                className={`num text-xs font-medium px-2 py-0.5 rounded ${
                  isLong ? 'bg-bull/10 text-bull' : 'bg-bear/10 text-bear'
                }`}
              >
                {signal.direction}
              </span>
              <span
                className={`text-2xs uppercase tracking-widest px-2 py-0.5 rounded border ${convictionColor}`}
              >
                {signal.conviction}
              </span>
            </div>
            <div className="num text-2xs text-fg-subtle mt-1.5">
              entry @ {fmtUsd(signal.entry_price)} · score {signal.score}/100
            </div>
          </div>

          {/* Score badge */}
          <div className="flex flex-col items-center justify-center min-w-[3rem]">
            <div className="num text-2xl text-amber-glow font-medium leading-none">
              {signal.score}
            </div>
            <div className="text-2xs text-fg-subtle uppercase tracking-widest mt-1">
              score
            </div>
          </div>
        </div>
      </div>

      {/* Levels grid */}
      <div className="grid grid-cols-3 divide-x divide-bg-border border-b border-bg-border">
        <Cell label="stop" value={fmtUsd(signal.stop_loss)} accent="bear" />
        <Cell label="entry" value={fmtUsd(signal.entry_price)} />
        <Cell label="target" value={fmtUsd(signal.take_profit)} accent="bull" />
      </div>

      {/* Sub-scores */}
      <div className="grid grid-cols-3 divide-x divide-bg-border border-b border-bg-border text-2xs">
        <Cell label="técnico" value={`${signal.technical_score}`} small />
        <Cell label="sentim." value={`${signal.sentiment_score}`} small />
        <Cell label="r:r" value={rrRatio.toFixed(2)} small />
      </div>

      {/* Rationale */}
      <div className="px-5 py-3.5">
        <p className="text-sm text-fg leading-relaxed">{signal.rationale}</p>
      </div>

      {/* Action */}
      <div className="px-5 pb-4">
        {signal.executed ? (
          <div className="flex items-center gap-2 text-2xs text-bull">
            <Check size={14} />
            <span>Ejecutada como paper trade</span>
          </div>
        ) : (
          <button
            onClick={handleExecute}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5
                       bg-amber/10 hover:bg-amber/20 text-amber-glow
                       border border-amber/30 rounded
                       text-xs uppercase tracking-widest
                       transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ArrowUpRight size={14} />
            )}
            Ejecutar paper trade
          </button>
        )}
        {error && <div className="text-2xs text-bear mt-2">{error}</div>}
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: string;
  accent?: 'bull' | 'bear';
  small?: boolean;
}) {
  const colorClass =
    accent === 'bull' ? 'text-bull' : accent === 'bear' ? 'text-bear' : 'text-fg';
  return (
    <div className="px-3 py-2.5">
      <div className="text-2xs uppercase tracking-widest text-fg-subtle">{label}</div>
      <div className={`num font-medium mt-0.5 ${colorClass} ${small ? 'text-sm' : ''}`}>
        {value}
      </div>
    </div>
  );
}
