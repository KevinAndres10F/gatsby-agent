import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import Signals from './pages/Signals';
import Portfolio from './pages/Portfolio';
import Performance from './pages/Performance';

export default function App() {
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
          </Routes>
        </main>
      </div>
    </div>
  );
}
