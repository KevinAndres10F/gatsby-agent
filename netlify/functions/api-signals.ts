/**
 * GET /api/signals?days=7
 * Devuelve señales recientes con su trade asociado (si existe).
 */

import { getSupabase } from './_shared/supabase.ts';

export default async (req: Request) => {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get('days') ?? '7', 10);
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('signals')
    .select('*, trades(id, status, pnl_usd, pnl_pct, exit_reason)')
    .gte('date', since)
    .order('generated_at', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ signals: data }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  });
};
