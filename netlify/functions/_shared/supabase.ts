import { createClient, SupabaseClient } from '@supabase/supabase-js';

// UUID sentinel para snapshots/registros del modo single-user (sin auth).
// equity_snapshots tiene PK (user_id, date) que no admite NULL.
export const SINGLE_USER_ID = '00000000-0000-0000-0000-000000000000';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
  });

  return _client;
}

/**
 * Extrae el user_id (auth.uid()) del JWT enviado en el header Authorization.
 * Devuelve null si no hay token o es inválido. NO arroja error: las funciones
 * que llaman deciden si requieren auth o aceptan modo single-user.
 */
export async function getUserIdFromRequest(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * Registra el inicio de una función para observabilidad.
 * Devuelve el ID del run para poder completarlo después.
 */
export async function logRunStart(functionName: string): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('function_runs')
    .insert({ function_name: functionName, status: 'running' })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

export async function logRunComplete(
  runId: number,
  status: 'success' | 'error' | 'partial',
  payload: {
    records_processed?: number;
    llm_tokens_used?: number;
    llm_cost_usd?: number;
    error_message?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const supabase = getSupabase();
  const startedAt = await supabase
    .from('function_runs')
    .select('started_at, function_name')
    .eq('id', runId)
    .single();

  const durationMs = startedAt.data
    ? Date.now() - new Date(startedAt.data.started_at).getTime()
    : null;

  await supabase
    .from('function_runs')
    .update({
      completed_at: new Date().toISOString(),
      status,
      duration_ms: durationMs,
      ...payload,
    })
    .eq('id', runId);

  // Alerta proactiva si un cron falla. Import dinámico para evitar ciclo
  // de dependencias (notify.ts importa este módulo).
  if (status === 'error') {
    try {
      const fn = startedAt.data?.function_name ?? 'unknown';
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const hour = now.getUTCHours();
      const { notify } = await import('./notify.ts');
      await notify({
        type: 'system_error',
        severity: 'critical',
        dedup_key: `system_error:${fn}:${date}:${hour}`,
        title: `🚨 Falla en ${fn}`,
        body: payload.error_message
          ? `Error: ${String(payload.error_message).slice(0, 300)}`
          : 'El cron terminó con estado error.',
        payload: { function_name: fn, run_id: runId },
      });
    } catch (e) {
      console.error('[supabase] system_error notify failed:', e);
    }
  }
}
