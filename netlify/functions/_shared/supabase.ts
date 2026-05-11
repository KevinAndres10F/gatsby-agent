import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
    .select('started_at')
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
}
