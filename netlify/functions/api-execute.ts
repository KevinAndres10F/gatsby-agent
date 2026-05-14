/**
 * POST /api/execute
 * Body: { signal_id: number }
 *
 * Ejecuta un paper trade basado en una señal (click manual del usuario).
 * La lógica está en _shared/execute.ts para reuso desde el auto-execute.
 */

import { getSupabase, getUserIdFromRequest } from './_shared/supabase.ts';
import { executeSignal } from './_shared/execute.ts';

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: { signal_id?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  if (!body.signal_id) {
    return new Response(JSON.stringify({ error: 'signal_id required' }), { status: 400 });
  }

  const supabase = getSupabase();
  const userId = await getUserIdFromRequest(req);
  const result = await executeSignal(supabase, body.signal_id, userId);

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, trade: result.trade }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
