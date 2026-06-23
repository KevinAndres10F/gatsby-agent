/**
 * GET  /api/notifications?limit=50&type=fast_mover&unread=1
 *   Lista las notificaciones del usuario (o del centinela single-user).
 * POST /api/notifications
 *   Body: { ids: number[] }  ó  { all: true }  → marca como leídas.
 *
 * Usa el service key (getSupabase) y valida pertenencia en código, para que
 * funcione también en modo single-user (centinela) donde el anon no puede
 * actualizar por RLS.
 */

import {
  getSupabase,
  getUserIdFromRequest,
  SINGLE_USER_ID,
} from './_shared/supabase.ts';

export default async (req: Request) => {
  const supabase = getSupabase();
  const userId = (await getUserIdFromRequest(req)) ?? SINGLE_USER_ID;

  // -------- POST: marcar como leídas --------
  if (req.method === 'POST') {
    let body: { ids?: number[]; all?: boolean };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    let q = supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);

    if (!body.all) {
      const ids = (body.ids ?? []).filter((n) => Number.isInteger(n));
      if (ids.length === 0) return json({ error: 'ids or all required' }, 400);
      q = q.in('id', ids);
    }

    const { error } = await q;
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // -------- GET: listar --------
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const type = url.searchParams.get('type');
  const unread = url.searchParams.get('unread') === '1';

  let query = supabase
    .from('notifications')
    .select('id, type, severity, title, body, payload, created_at, read_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (type) query = query.eq('type', type);
  if (unread) query = query.is('read_at', null);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const { count: unreadCount } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);

  return json({ notifications: data ?? [], unread_count: unreadCount ?? 0 });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
