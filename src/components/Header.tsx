import { useEffect, useState } from 'react';

export default function Header() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const utc = now.toISOString().replace('T', ' ').slice(0, 19);
  const local = now.toLocaleTimeString('es-ES');

  return (
    <header className="h-14 border-b border-bg-border bg-bg-elevated/80 backdrop-blur flex items-center px-6 pl-14 lg:pl-6">
      <div className="flex items-center gap-6 text-2xs">
        <div className="flex items-center gap-2">
          <span className="text-fg-subtle uppercase tracking-widest">market</span>
          <span className="num text-fg">NYSE · NASDAQ</span>
        </div>
        <div className="w-px h-4 bg-bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-fg-subtle uppercase tracking-widest">utc</span>
          <span className="num text-fg-muted">{utc}</span>
        </div>
        <div className="w-px h-4 bg-bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-fg-subtle uppercase tracking-widest">local</span>
          <span className="num text-fg-muted">{local}</span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3 text-2xs">
        <span className="ticker-pill">v0.1</span>
        <span className="text-fg-subtle">research only · not financial advice</span>
      </div>
    </header>
  );
}
