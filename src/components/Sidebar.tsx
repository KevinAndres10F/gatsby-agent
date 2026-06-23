import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Activity,
  Briefcase,
  TrendingUp,
  Menu,
  X,
  History,
  HeartPulse,
  Settings as SettingsIcon,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../lib/auth';

const items = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/signals', label: 'Señales', icon: Activity },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/performance', label: 'Performance', icon: TrendingUp },
  { to: '/backtest', label: 'Backtest', icon: History },
  { to: '/health', label: 'Health', icon: HeartPulse },
  { to: '/settings', label: 'Ajustes', icon: SettingsIcon },
];

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const { user, authEnabled, signOut } = useAuth();

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-md bg-bg-elevated border border-bg-border text-fg-muted hover:text-fg"
      >
        <Menu size={20} />
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-56 border-r border-bg-border bg-bg-elevated flex flex-col
          transform transition-transform duration-200 ease-out
          ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="px-5 py-6 border-b border-bg-border flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-amber-glow animate-pulse-slow" />
              <span className="font-display text-base font-semibold tracking-tight">
                cuantitativo
              </span>
            </div>
            <div className="text-2xs uppercase tracking-widest text-fg-subtle mt-1 ml-4">
              quant agent
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden p-1 text-fg-muted hover:text-fg"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-bg-surface text-fg border-l-2 border-amber'
                    : 'text-fg-muted hover:text-fg hover:bg-bg-surface/50'
                }`
              }
            >
              <Icon size={16} strokeWidth={1.5} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-bg-border text-2xs text-fg-subtle space-y-1.5">
          <div className="flex justify-between">
            <span>system</span>
            <span className="text-bull">● online</span>
          </div>
          <div className="flex justify-between">
            <span>mode</span>
            <span className="text-amber-glow">paper</span>
          </div>
          {authEnabled && user && (
            <>
              <div className="flex justify-between truncate gap-2">
                <span>user</span>
                <span className="text-fg-muted truncate" title={user.email ?? ''}>
                  {user.email?.split('@')[0] ?? '—'}
                </span>
              </div>
              <button
                onClick={() => signOut()}
                className="w-full flex items-center justify-between mt-2 px-2 py-1.5 rounded hover:bg-bg-surface text-fg-muted hover:text-fg transition-colors"
              >
                <span>sign out</span>
                <LogOut size={12} />
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
