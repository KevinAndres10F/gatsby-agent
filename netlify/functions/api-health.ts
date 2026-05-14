/**
 * GET /api/health?days=7
 *
 * Devuelve los últimos runs de cada función cron (discovery, analyze,
 * update-prices, end-of-day) más métricas agregadas: tasa de éxito,
 * duración promedio y costo de LLM. Permite detectar crons silenciosamente
 * caídos antes de que se acumulen días sin señales.
 */

import { getSupabase } from './_shared/supabase.ts';

const CRON_FUNCTIONS = ['discovery', 'analyze', 'update-prices', 'end-of-day'];

export default async (req: Request) => {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get('days') ?? '7', 10);
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const supabase = getSupabase();
  const { data: runs, error } = await supabase
    .from('function_runs')
    .select(
      'id, function_name, started_at, completed_at, status, duration_ms, records_processed, llm_tokens_used, llm_cost_usd, error_message, metadata',
    )
    .in('function_name', CRON_FUNCTIONS)
    .gte('started_at', since)
    .order('started_at', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Aggregate per function
  const byFunction: Record<string, any> = {};
  for (const fn of CRON_FUNCTIONS) {
    byFunction[fn] = {
      function_name: fn,
      total_runs: 0,
      success_runs: 0,
      error_runs: 0,
      partial_runs: 0,
      avg_duration_ms: null as number | null,
      total_cost_usd: 0,
      total_records: 0,
      last_run: null as any,
      last_success: null as any,
    };
  }

  let totalCost = 0;
  for (const r of runs ?? []) {
    const fn = r.function_name;
    if (!byFunction[fn]) continue;
    const agg = byFunction[fn];
    agg.total_runs++;
    if (r.status === 'success') agg.success_runs++;
    else if (r.status === 'error') agg.error_runs++;
    else if (r.status === 'partial') agg.partial_runs++;
    agg.total_cost_usd += Number(r.llm_cost_usd ?? 0);
    agg.total_records += Number(r.records_processed ?? 0);
    if (!agg.last_run) agg.last_run = r;
    if (!agg.last_success && (r.status === 'success' || r.status === 'partial')) {
      agg.last_success = r;
    }
    totalCost += Number(r.llm_cost_usd ?? 0);
  }

  // Compute avg duration
  for (const fn of CRON_FUNCTIONS) {
    const fnRuns = (runs ?? []).filter(
      (r: any) => r.function_name === fn && r.duration_ms,
    );
    if (fnRuns.length > 0) {
      byFunction[fn].avg_duration_ms =
        fnRuns.reduce((a: number, r: any) => a + r.duration_ms, 0) / fnRuns.length;
    }
  }

  return new Response(
    JSON.stringify({
      since,
      days,
      total_cost_usd: totalCost,
      functions: CRON_FUNCTIONS.map((fn) => byFunction[fn]),
      recent_runs: (runs ?? []).slice(0, 50),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
      },
    },
  );
};
