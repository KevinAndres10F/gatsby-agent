import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import Signals from './pages/Signals';
import Portfolio from './pages/Portfolio';
import Performance from './pages/Performance';
import Backtest from './pages/Backtest';
import Login from './pages/Login';
import { useAuth } from './lib/auth';

export default function App() {
  const { user, loading, authEnabled } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-fg-muted">
        Cargando…
      </div>
    );
  }

  // Si la auth está habilitada y no hay sesión → login
  if (authEnabled && !user) {
    return <Login />;
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6 lg:p-8 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/backtest" element={<Backtest />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
