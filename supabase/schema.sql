-- =============================================================
-- Cuantitativo Agent — Schema PostgreSQL (Supabase)
-- =============================================================
-- Ejecuta este archivo completo en el SQL Editor de Supabase
-- después de crear el proyecto.
-- =============================================================

-- Universo de tickers que monitoreamos (S&P 500 + NASDAQ 100)
CREATE TABLE IF NOT EXISTS universe (
  ticker        VARCHAR(10) PRIMARY KEY,
  name          VARCHAR(200),
  sector        VARCHAR(100),
  market_cap_b  NUMERIC(10,2),                  -- en billions USD
  indices       TEXT[],                         -- ['SP500', 'NASDAQ100']
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Candidatos diarios que pasaron el filtro cuantitativo
CREATE TABLE IF NOT EXISTS candidates (
  id            BIGSERIAL PRIMARY KEY,
  ticker        VARCHAR(10) NOT NULL,
  date          DATE NOT NULL,
  reason        VARCHAR(50),                    -- 'gainer', 'loser', 'volume_spike', etc
  metrics       JSONB,                          -- métricas crudas que activaron candidatura
  has_news      BOOLEAN DEFAULT false,
  passed_to_llm BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ticker, date)
);

CREATE INDEX IF NOT EXISTS idx_candidates_date ON candidates(date DESC);

-- Precios históricos con indicadores técnicos pre-computados
CREATE TABLE IF NOT EXISTS prices (
  ticker        VARCHAR(10) NOT NULL,
  date          DATE NOT NULL,
  open          NUMERIC(12,4),
  high          NUMERIC(12,4),
  low           NUMERIC(12,4),
  close         NUMERIC(12,4),
  volume        BIGINT,
  -- Indicadores técnicos
  rsi_14        NUMERIC(6,2),
  atr_14        NUMERIC(12,4),
  sma_20        NUMERIC(12,4),
  sma_50        NUMERIC(12,4),
  sma_200       NUMERIC(12,4),
  PRIMARY KEY (ticker, date)
);

-- Quotes en tiempo real (mark-to-market durante el día)
CREATE TABLE IF NOT EXISTS quotes (
  ticker        VARCHAR(10) PRIMARY KEY,
  price         NUMERIC(12,4),
  change_pct    NUMERIC(8,4),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Noticias procesadas por el LLM
CREATE TABLE IF NOT EXISTS news (
  id              BIGSERIAL PRIMARY KEY,
  ticker          VARCHAR(10),
  published_at    TIMESTAMPTZ,
  title           TEXT NOT NULL,
  source          VARCHAR(100),
  url             TEXT,
  url_hash        VARCHAR(64) UNIQUE,           -- dedup por hash de URL
  -- Análisis del LLM
  sentiment       VARCHAR(20),                  -- 'bullish' | 'bearish' | 'neutral'
  risk_level      INT CHECK (risk_level BETWEEN 1 AND 10),
  novelty         INT CHECK (novelty BETWEEN 1 AND 10),
  confidence      NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
  summary         TEXT,
  catalysts       TEXT[],
  -- Métricas de costo
  tokens_used     INT,
  cost_usd        NUMERIC(8,5),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_ticker_date ON news(ticker, published_at DESC);

-- Señales finales generadas por el motor de reglas
CREATE TABLE IF NOT EXISTS signals (
  id                 BIGSERIAL PRIMARY KEY,
  ticker             VARCHAR(10) NOT NULL,
  generated_at       TIMESTAMPTZ DEFAULT NOW(),
  date               DATE NOT NULL,
  -- Score y dirección
  score              INT CHECK (score BETWEEN 0 AND 100),
  direction          VARCHAR(10) CHECK (direction IN ('LONG', 'SHORT', 'HOLD')),
  conviction         VARCHAR(20) CHECK (conviction IN ('HIGH', 'MEDIUM', 'LOW')),
  -- Niveles de operación
  entry_price        NUMERIC(12,4),
  stop_loss          NUMERIC(12,4),
  take_profit        NUMERIC(12,4),
  position_size_pct  NUMERIC(5,2),              -- % del portfolio sugerido
  -- Sub-scores (auditoría)
  technical_score    INT,
  sentiment_score    INT,
  -- Justificación
  rationale          TEXT,
  news_ids           BIGINT[],                  -- IDs de noticias que sustentan la señal
  -- Status
  executed           BOOLEAN DEFAULT false,     -- ¿se ejecutó como paper trade?
  UNIQUE(ticker, date)
);

CREATE INDEX IF NOT EXISTS idx_signals_date ON signals(date DESC);
CREATE INDEX IF NOT EXISTS idx_signals_score ON signals(score DESC);

-- Portfolio (paper trading)
CREATE TABLE IF NOT EXISTS portfolio (
  id                BIGSERIAL PRIMARY KEY,
  initial_capital   NUMERIC(14,2) DEFAULT 10000.00,
  cash              NUMERIC(14,2) DEFAULT 10000.00,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar portfolio inicial
INSERT INTO portfolio (initial_capital, cash) VALUES (10000.00, 10000.00)
ON CONFLICT DO NOTHING;

-- Trades (paper)
CREATE TABLE IF NOT EXISTS trades (
  id              BIGSERIAL PRIMARY KEY,
  signal_id       BIGINT REFERENCES signals(id),
  portfolio_id    BIGINT REFERENCES portfolio(id) DEFAULT 1,
  ticker          VARCHAR(10) NOT NULL,
  direction       VARCHAR(10),
  status          VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  -- Entry
  entry_price     NUMERIC(12,4),
  entry_date      TIMESTAMPTZ DEFAULT NOW(),
  shares          INT,
  capital_used    NUMERIC(14,2),
  -- Risk management
  stop_loss       NUMERIC(12,4),
  take_profit     NUMERIC(12,4),
  -- Exit (cuando status = CLOSED)
  exit_price      NUMERIC(12,4),
  exit_date       TIMESTAMPTZ,
  exit_reason     VARCHAR(50),                  -- 'stop' | 'target' | 'manual' | 'time'
  -- P&L
  pnl_usd         NUMERIC(14,2),
  pnl_pct         NUMERIC(8,4)
);

CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker);

-- Snapshots diarios de equity curve
CREATE TABLE IF NOT EXISTS equity_snapshots (
  date                DATE PRIMARY KEY,
  cash                NUMERIC(14,2),
  positions_value     NUMERIC(14,2),
  total_value         NUMERIC(14,2),
  num_open_positions  INT,
  daily_pnl_pct       NUMERIC(8,4)
);

-- Observabilidad: logs de ejecución de cada función
CREATE TABLE IF NOT EXISTS function_runs (
  id                BIGSERIAL PRIMARY KEY,
  function_name     VARCHAR(50),
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  status            VARCHAR(20),                -- 'success' | 'error' | 'partial'
  duration_ms       INT,
  records_processed INT,
  llm_tokens_used   INT,
  llm_cost_usd      NUMERIC(8,5),
  error_message     TEXT,
  metadata          JSONB
);

CREATE INDEX IF NOT EXISTS idx_function_runs_date ON function_runs(started_at DESC);

-- =============================================================
-- VISTAS para Power BI / Dashboard
-- =============================================================

-- Performance acumulada
CREATE OR REPLACE VIEW v_performance AS
SELECT
  COUNT(*) FILTER (WHERE status = 'CLOSED') AS total_trades,
  COUNT(*) FILTER (WHERE status = 'CLOSED' AND pnl_usd > 0) AS winning_trades,
  COUNT(*) FILTER (WHERE status = 'CLOSED' AND pnl_usd <= 0) AS losing_trades,
  COALESCE(AVG(pnl_pct) FILTER (WHERE status = 'CLOSED'), 0) AS avg_pnl_pct,
  COALESCE(SUM(pnl_usd) FILTER (WHERE status = 'CLOSED'), 0) AS total_pnl_usd,
  CASE
    WHEN COUNT(*) FILTER (WHERE status = 'CLOSED') > 0
    THEN ROUND(
      100.0 * COUNT(*) FILTER (WHERE status = 'CLOSED' AND pnl_usd > 0) /
      COUNT(*) FILTER (WHERE status = 'CLOSED'),
      2
    )
    ELSE 0
  END AS hit_rate_pct
FROM trades;

-- Posiciones abiertas con P&L flotante
CREATE OR REPLACE VIEW v_open_positions AS
SELECT
  t.id,
  t.ticker,
  t.direction,
  t.entry_price,
  t.shares,
  t.capital_used,
  t.stop_loss,
  t.take_profit,
  t.entry_date,
  q.price AS current_price,
  ROUND(((q.price - t.entry_price) * t.shares)::numeric, 2) AS floating_pnl_usd,
  ROUND((((q.price - t.entry_price) / t.entry_price) * 100)::numeric, 2) AS floating_pnl_pct
FROM trades t
LEFT JOIN quotes q ON q.ticker = t.ticker
WHERE t.status = 'OPEN';

-- =============================================================
-- Row Level Security (Supabase)
-- =============================================================
-- Para MVP: deshabilitamos RLS (la app es single-user)
-- En producción: añadir auth de Supabase y políticas RLS
ALTER TABLE universe DISABLE ROW LEVEL SECURITY;
ALTER TABLE candidates DISABLE ROW LEVEL SECURITY;
ALTER TABLE prices DISABLE ROW LEVEL SECURITY;
ALTER TABLE quotes DISABLE ROW LEVEL SECURITY;
ALTER TABLE news DISABLE ROW LEVEL SECURITY;
ALTER TABLE signals DISABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio DISABLE ROW LEVEL SECURITY;
ALTER TABLE trades DISABLE ROW LEVEL SECURITY;
ALTER TABLE equity_snapshots DISABLE ROW LEVEL SECURITY;
ALTER TABLE function_runs DISABLE ROW LEVEL SECURITY;
