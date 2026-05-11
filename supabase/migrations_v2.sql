-- =============================================================
-- Migración v2 — features fase 2 (IDEMPOTENTE, safe para re-ejecutar)
--   * benchmark_prices: histórico SPY para comparación
--   * backtest_runs + backtest_trades: corridas de backtesting
--   * users: columnas user_id en portfolio/trades/signals/equity_snapshots
--   * RLS policies + trigger de portfolio al sign-up
-- Ejecutar DESPUÉS de schema.sql
-- =============================================================

-- ============ 1. Columnas user_id ============
ALTER TABLE portfolio         ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE trades            ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE signals           ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE equity_snapshots  ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user    ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_signals_user   ON signals(user_id);

-- ============ 2. equity_snapshots — PK (user_id, date) ============
-- PostgreSQL no admite expresiones en PRIMARY KEY → usamos un UUID sentinel
-- '00000000-0000-0000-0000-000000000000' para el modo single-user.
UPDATE equity_snapshots
   SET user_id = '00000000-0000-0000-0000-000000000000'::uuid
 WHERE user_id IS NULL;
ALTER TABLE equity_snapshots
  ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
ALTER TABLE equity_snapshots ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE equity_snapshots DROP CONSTRAINT IF EXISTS equity_snapshots_pkey;
ALTER TABLE equity_snapshots
  ADD CONSTRAINT equity_snapshots_pkey PRIMARY KEY (user_id, date);

-- ============ 3. Benchmark prices (SPY) ============
CREATE TABLE IF NOT EXISTS benchmark_prices (
  ticker  VARCHAR(10) NOT NULL DEFAULT 'SPY',
  date    DATE NOT NULL,
  close   NUMERIC(12,4),
  PRIMARY KEY (ticker, date)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_date ON benchmark_prices(date DESC);

-- ============ 4. Backtest runs + trades ============
CREATE TABLE IF NOT EXISTS backtest_runs (
  id                 BIGSERIAL PRIMARY KEY,
  started_at         TIMESTAMPTZ DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  status             VARCHAR(20) DEFAULT 'running',  -- running | success | error
  from_date          DATE NOT NULL,
  to_date            DATE NOT NULL,
  tickers_count      INT,
  initial_capital    NUMERIC(14,2) DEFAULT 10000.00,
  total_trades       INT,
  winning_trades     INT,
  losing_trades      INT,
  hit_rate_pct       NUMERIC(6,2),
  total_pnl_usd      NUMERIC(14,2),
  total_return_pct   NUMERIC(10,4),
  max_drawdown_pct   NUMERIC(8,4),
  sharpe             NUMERIC(8,3),
  sortino            NUMERIC(8,3),
  params             JSONB,
  error_message      TEXT
);
CREATE INDEX IF NOT EXISTS idx_backtest_started ON backtest_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS backtest_trades (
  id           BIGSERIAL PRIMARY KEY,
  run_id       BIGINT REFERENCES backtest_runs(id) ON DELETE CASCADE,
  ticker       VARCHAR(10) NOT NULL,
  direction    VARCHAR(10),
  entry_date   DATE,
  entry_price  NUMERIC(12,4),
  exit_date    DATE,
  exit_price   NUMERIC(12,4),
  exit_reason  VARCHAR(20),         -- stop | target | time
  pnl_pct      NUMERIC(10,4)
);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_run ON backtest_trades(run_id);

-- ============ 5. Vista v_open_positions con soporte SHORT ============
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
  t.user_id,
  q.price AS current_price,
  ROUND(
    CASE WHEN t.direction = 'SHORT'
      THEN ((t.entry_price - q.price) * t.shares)
      ELSE ((q.price - t.entry_price) * t.shares)
    END::numeric, 2) AS floating_pnl_usd,
  ROUND(
    CASE WHEN t.direction = 'SHORT'
      THEN (((t.entry_price - q.price) / t.entry_price) * 100)
      ELSE (((q.price - t.entry_price) / t.entry_price) * 100)
    END::numeric, 2) AS floating_pnl_pct
FROM trades t
LEFT JOIN quotes q ON q.ticker = t.ticker
WHERE t.status = 'OPEN';

-- ============ 6. Row Level Security ============
-- Modelo: tablas de mercado son públicas. portfolio/trades/equity_snapshots usan RLS.
-- Las funciones cron operan con SUPABASE_SERVICE_KEY que bypasea RLS.
ALTER TABLE portfolio         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades            ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_snapshots  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portfolio_select ON portfolio;
CREATE POLICY portfolio_select ON portfolio
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS portfolio_modify ON portfolio;
CREATE POLICY portfolio_modify ON portfolio
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS trades_select ON trades;
CREATE POLICY trades_select ON trades
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS trades_modify ON trades;
CREATE POLICY trades_modify ON trades
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS signals_select ON signals;
CREATE POLICY signals_select ON signals
  FOR SELECT USING (true);

DROP POLICY IF EXISTS equity_select ON equity_snapshots;
CREATE POLICY equity_select ON equity_snapshots
  FOR SELECT
  USING (user_id = '00000000-0000-0000-0000-000000000000'::uuid
         OR auth.uid() = user_id);

-- ============ 7. Trigger: portfolio inicial al sign-up ============
CREATE OR REPLACE FUNCTION public.create_portfolio_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.portfolio (user_id, initial_capital, cash)
  VALUES (NEW.id, 10000.00, 10000.00);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_portfolio_for_new_user();
