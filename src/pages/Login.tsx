import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { Loader2 } from 'lucide-react';

type Mode = 'signin' | 'signup';

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        await signUp(email, password);
        setInfo('Cuenta creada. Revisa tu correo para confirmar (si Supabase lo requiere).');
      }
    } catch (e: any) {
      setError(e.message ?? 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm panel p-8">
        <div className="text-2xs uppercase tracking-widest text-fg-subtle mb-1 text-center">
          cuantitativo · quant agent
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-center mb-6">
          {mode === 'signin' ? 'Iniciar sesión' : 'Crear cuenta'}
        </h1>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-2xs uppercase tracking-widest text-fg-subtle mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-sm num focus:outline-none focus:border-amber/40"
            />
          </div>
          <div>
            <label className="block text-2xs uppercase tracking-widest text-fg-subtle mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-sm num focus:outline-none focus:border-amber/40"
            />
          </div>

          {error && <div className="text-2xs text-bear">{error}</div>}
          {info && <div className="text-2xs text-bull">{info}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber/10 hover:bg-amber/20 text-amber-glow border border-amber/30 rounded text-xs uppercase tracking-widest disabled:opacity-50"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {mode === 'signin' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        <div className="text-center mt-5 text-2xs text-fg-muted">
          {mode === 'signin' ? (
            <>
              ¿No tienes cuenta?{' '}
              <button
                onClick={() => setMode('signup')}
                className="text-amber-glow hover:underline"
              >
                Regístrate
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{' '}
              <button
                onClick={() => setMode('signin')}
                className="text-amber-glow hover:underline"
              >
                Inicia sesión
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
