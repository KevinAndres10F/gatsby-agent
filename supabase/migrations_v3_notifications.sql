-- =============================================================
-- Migración v3 — Sistema de notificaciones + segunda opinión de riesgo
-- (IDEMPOTENTE, safe para re-ejecutar). Ejecutar DESPUÉS de migrations_v2.sql
--   * notifications: log persistido + dedup + ruteo por usuario
--   * notification_prefs: preferencias por usuario (canales, severidad, quiet hours)
--   * signals: columnas de la revisión de riesgo (Risk Manager)
--   * RLS espejo del patrón de migrations_v2.sql
-- Centinela single-user: '00000000-0000-0000-0000-000000000000'
-- =============================================================

-- ============ 1. Tabla notifications ============
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  type        VARCHAR(40) NOT NULL,                  -- signal_high | stop_proximity | trade_closed | digest_morning | digest_eod | system_error
  severity    VARCHAR(10) NOT NULL DEFAULT 'info'
              CHECK (severity IN ('info', 'warning', 'critical')),
  title       TEXT NOT NULL,
  body        TEXT,
  payload     JSONB DEFAULT '{}'::jsonb,
  channels    TEXT[] DEFAULT '{}',                   -- canales por los que se envió efectivamente
  dedup_key   VARCHAR(120),
  sent_at     TIMESTAMPTZ,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Dedup: un (user_id, dedup_key) único cuando dedup_key no es NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup
  ON notifications(user_id, dedup_key)
  WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications
  FOR SELECT
  USING (user_id = '00000000-0000-0000-0000-000000000000'::uuid
         OR auth.uid() = user_id);

-- Los usuarios autenticados pueden marcar como leídas sus propias notificaciones.
DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ 2. Tabla notification_prefs ============
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id           UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  telegram_chat_id  TEXT,                            -- override por usuario; si NULL usa TELEGRAM_CHAT_ID (env)
  channels_signal   TEXT[] DEFAULT '{telegram}',
  channels_trade    TEXT[] DEFAULT '{telegram}',
  channels_digest   TEXT[] DEFAULT '{telegram}',
  channels_system   TEXT[] DEFAULT '{telegram}',
  min_severity      VARCHAR(10) DEFAULT 'info'
                    CHECK (min_severity IN ('info', 'warning', 'critical')),
  quiet_start       SMALLINT,                        -- hora local [0-23], NULL = sin quiet hours
  quiet_end         SMALLINT,
  tz                TEXT DEFAULT 'America/New_York',
  enabled           BOOLEAN DEFAULT true,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prefs_select ON notification_prefs;
CREATE POLICY prefs_select ON notification_prefs
  FOR SELECT
  USING (user_id = '00000000-0000-0000-0000-000000000000'::uuid
         OR auth.uid() = user_id);

DROP POLICY IF EXISTS prefs_modify ON notification_prefs;
CREATE POLICY prefs_modify ON notification_prefs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Fila por defecto del centinela single-user.
INSERT INTO notification_prefs (user_id)
VALUES ('00000000-0000-0000-0000-000000000000'::uuid)
ON CONFLICT (user_id) DO NOTHING;

-- Crear prefs automáticamente para cada usuario nuevo (reusa el trigger de auth).
CREATE OR REPLACE FUNCTION public.create_prefs_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.notification_prefs (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_prefs ON auth.users;
CREATE TRIGGER on_auth_user_created_prefs
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_prefs_for_new_user();

-- ============ 3. Columnas de revisión de riesgo en signals ============
ALTER TABLE signals ADD COLUMN IF NOT EXISTS risk_approved  BOOLEAN;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS risk_flags     TEXT[];
ALTER TABLE signals ADD COLUMN IF NOT EXISTS risk_rationale TEXT;
