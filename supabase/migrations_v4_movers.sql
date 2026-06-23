-- =============================================================
-- Migración v4 — Escáner de movimientos rápidos (fast movers)
-- (IDEMPOTENTE). Ejecutar DESPUÉS de migrations_v3_notifications.sql
--   * mover_watchlist: acciones de todo el mercado (top movers AV) que se
--     suman temporalmente al escaneo intradía (expiran el mismo día).
--   * notification_prefs.channels_mover: canal/toggle para alertas fast_mover.
-- =============================================================

-- ============ 1. Watchlist temporal de movers de mercado ============
CREATE TABLE IF NOT EXISTS mover_watchlist (
  ticker      VARCHAR(10) PRIMARY KEY,
  reason      VARCHAR(20),                 -- 'gainer' | 'loser'
  change_pct  NUMERIC(8,4),
  added_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at  DATE NOT NULL                -- normalmente = hoy
);
CREATE INDEX IF NOT EXISTS idx_mover_watchlist_expires ON mover_watchlist(expires_at);

-- Dato de mercado (no sensible), igual que quotes/universe: sin RLS.
ALTER TABLE mover_watchlist DISABLE ROW LEVEL SECURITY;

-- ============ 2. Canal de preferencias para movers ============
ALTER TABLE notification_prefs
  ADD COLUMN IF NOT EXISTS channels_mover TEXT[] DEFAULT '{telegram}';
