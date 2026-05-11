interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean;
  hint?: string;
}

export default function StatCard({ label, value, delta, deltaPositive, hint }: StatCardProps) {
  return (
    <div className="panel p-5">
      <div className="stat-label">{label}</div>
      <div className="stat-value mt-2">{value}</div>
      {delta && (
        <div
          className={`num text-sm mt-1 ${
            deltaPositive ? 'text-bull' : 'text-bear'
          }`}
        >
          {delta}
        </div>
      )}
      {hint && <div className="text-2xs text-fg-subtle mt-1">{hint}</div>}
    </div>
  );
}
