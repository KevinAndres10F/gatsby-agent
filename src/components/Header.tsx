import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

export default function Header() {
  const [now, setNow] = useState(new Date());
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const utc = now.toISOString().replace('T', ' ').slice(0, 19);
  const local = now.toLocaleTimeString('es-ES');

  return (
    <header className="h-14 border-b border-bg-border bg-bg-elevated/80 backdrop-blur flex items-center px-4 sm:px-6 pl-14 lg:pl-6">
      <div className="flex items-center gap-4 sm:gap-6 text-2xs min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-fg-subtle uppercase tracking-widest hidden sm:inline">
            market
          </span>
          <span className="num text-fg">NYSE · NASDAQ</span>
        </div>
        <div className="w-px h-4 bg-bg-border hidden sm:block" />
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-fg-subtle uppercase tracking-widest">utc</span>
          <span className="num text-fg-muted">{utc}</span>
        </div>
        <div className="w-px h-4 bg-bg-border hidden md:block" />
        <div className="hidden md:flex items-center gap-2">
          <span className="text-fg-subtle uppercase tracking-widest">local</span>
          <span className="num text-fg-muted">{local}</span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3 text-2xs shrink-0">
        <span className="text-fg-subtle hidden lg:inline">
          research only · not financial advice
        </span>
        <span className="ticker-pill">v0.1</span>
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
          title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          className="flex items-center justify-center w-8 h-8 rounded-md border border-bg-border
                     text-fg-muted hover:text-amber-glow hover:border-amber/40
                     bg-bg-surface/50 transition-colors"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
