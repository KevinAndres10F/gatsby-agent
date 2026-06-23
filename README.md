# Cuantitativo · Quant Agent

Agente cuantitativo autónomo que descubre oportunidades de trading swing en US equities, las evalúa con Claude (Anthropic) y simula las operaciones en un portfolio paper para validar si las predicciones generan edge **antes** de operar capital real.

> ⚠️ **Research only.** Esto no es asesoría financiera. Úsalo para investigar, validar, y aprender. Operar mercados reales conlleva riesgo de pérdida total del capital.

---

## ¿Qué hace?

Cada día hábil, el agente:

1. **Descubre** (06:00 ET) — Pull de top movers del mercado US, filtra por liquidez y movimiento razonable, busca catalizadores noticiosos. ~25 candidatos.
2. **Analiza** (06:15 ET) — Para cada candidato con noticia, calcula RSI/ATR/SMAs y manda todo a Claude para análisis estructurado de sentimiento + señal. Con caché de precios para evitar refetch innecesarios.
3. **Genera señales** — Top 5 señales del día con dirección (LONG/SHORT/HOLD), score 0–100, convicción (HIGH/MEDIUM/LOW), entry/stop/target, sizing por ATR, y rationale en español. Notifica HIGH conviction por Telegram (si está configurado).
4. **Mark-to-market** (cada 2h durante mercado) — Actualiza precios de posiciones abiertas, cierra automáticamente si tocan stop o target y envía aviso a Telegram.
5. **End-of-day** (17:30 ET) — Snapshot diario para curva de equity y refresco del benchmark (SPY).

Tú decides desde el dashboard cuáles paper-tradear. Si después de unas semanas el `hit_rate`, P&L acumulado, **Sharpe**, **Sortino** y **alpha vs SPY** son positivos → tienes evidencia de edge antes de arriesgar capital real.

---

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | Vite + React 18 + TypeScript + Tailwind + Recharts |
| Backend | Netlify Functions (Scheduled + HTTP), TypeScript |
| Database | Supabase Postgres (free tier, 500MB) + Auth |
| LLM | Claude Sonnet 4.6 (Anthropic API) |
| Datos de mercado | Alpha Vantage (top movers + history + SPY) + Finnhub (noticias + quotes) |
| Notificaciones | Telegram Bot API (opcional) |

**Costo mensual estimado:** ~$1–2 (solo la API de Claude; el resto es free tier).

---

## Setup paso a paso

### 1. Clonar y push a GitHub

```bash
git clone <esta-carpeta> cuantitativo-agent
cd cuantitativo-agent
git init
git add .
git commit -m "init"
git remote add origin git@github.com:TUUSUARIO/cuantitativo-agent.git
git push -u origin main
```

### 2. Crear proyecto Supabase

1. Ve a https://supabase.com → New project (free tier)
2. Anota la `Project URL`, la `anon` key (para frontend) y la `service_role` key (para backend). En Settings → API.
3. Abre el SQL Editor y ejecuta **en este orden**:
   - `supabase/schema.sql` — tablas, vistas e índices base
   - `supabase/seed_universe.sql` — ~120 tickers + ETFs (SPY/QQQ/XLK/XLE)
   - `supabase/migrations_v2.sql` — fase 2: benchmark, backtest, multi-usuario + RLS
   - `supabase/migrations_v3_notifications.sql` — fase 3: notificaciones (tabla `notifications` + `notification_prefs`) y columnas de riesgo en `signals`

### 3. Conseguir API keys gratis

| Servicio | URL | Free tier |
|----------|-----|-----------|
| Anthropic | console.anthropic.com | $5 trial credit |
| Alpha Vantage | alphavantage.co/support/#api-key | 25 req/día, 5 req/min |
| Finnhub | finnhub.io/register | 60 req/min |
| Telegram (opcional) | crea bot con @BotFather | gratis |

### 4. Conectar a Netlify

1. Netlify → "Add new site" → "Import an existing project" → GitHub → tu repo
2. Build settings se autodetectan desde `netlify.toml`
3. **Site settings → Environment variables**, añade:

```
# Backend (todas)
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   # service_role (bypassea RLS)
ALPHA_VANTAGE_KEY=...
FINNHUB_KEY=...

# Frontend (Vite)
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...   # anon (mismo proyecto)

# Telegram (opcional — si no se setean, las notificaciones son no-op)
TELEGRAM_BOT_TOKEN=123:ABC...
TELEGRAM_CHAT_ID=-100123...      # chat por defecto / fallback single-user

# Notificaciones y Risk Manager (opcionales)
STOP_PROXIMITY_PCT=1.5           # % para avisar proximidad a stop/target
RISK_REVIEW_MODEL=               # vacío = Opus 4.8; o claude-sonnet-4-6
```

4. Trigger un deploy. Las **Scheduled Functions** se registran automáticamente.

### 5. Habilitar Email Auth en Supabase

1. Supabase → Authentication → Providers → habilita **Email**.
2. (Opcional) Authentication → Settings → desactiva "Confirm email" durante desarrollo.
3. La primera vez que cualquier usuario se registre desde `/login`, un trigger crea su `portfolio` inicial automáticamente (ver `migrations_v2.sql`).

> Si NO defines `VITE_SUPABASE_ANON_KEY`, el frontend opera en modo single-user (sin login). Es retrocompatible con el MVP original.

### 6. Verificación

Después del primer deploy, en Netlify → Functions, deberías ver:
- `discovery`, `analyze`, `update-prices`, `end-of-day` (scheduled)
- `api-signals`, `api-portfolio`, `api-performance`, `api-execute`, `api-close-trade`, `api-backtest-runs`
- `backtest` (HTTP, on-demand)

Para probar manualmente sin esperar al cron:

```bash
curl -X POST https://TUSITIO.netlify.app/.netlify/functions/discovery
curl -X POST https://TUSITIO.netlify.app/.netlify/functions/analyze
```

Después de unos minutos, abre el dashboard. Deberías ver señales pobladas en `/`.

---

## Cron schedule (UTC)

| Función | Cron | Equivalente ET |
|---------|------|----------------|
| `discovery` | `0 11 * * 1-5` | L–V 06:00 ET (EST) / 07:00 ET (EDT) |
| `analyze` | `15 11 * * 1-5` | L–V 06:15 ET |
| `update-prices` | `0 14,16,18,20 * * 1-5` | cada 2h durante mercado |
| `end-of-day` | `30 21 * * 1-5` | L–V 17:30 ET (EDT) · also refreshes SPY benchmark |

> Netlify Scheduled Functions corren siempre en UTC. Si quieres ajustar a tu zona, edita `netlify.toml`.

---

## Features de fase 2 (implementadas)

### Métricas avanzadas (`/performance`)
- **Sharpe ratio** anualizado con rf 4% diario
- **Sortino ratio** (penaliza solo el downside)
- **Calmar ratio** = CAGR / |max drawdown|
- **Max drawdown %** peor caída desde un peak previo
- **Volatilidad anualizada** y **CAGR**

### Benchmark vs SPY (`/performance`)
- `end-of-day` refresca el histórico de SPY en `benchmark_prices`
- Chart comparativo (base 100) y cálculo de **alpha**

### Backtesting (`/backtest`)
- Función `netlify/functions/backtest.ts` que corre una estrategia técnica (SMA20 cross-up + RSI + tendencia) sobre 2+ años de data Alpha Vantage
- UI para ejecutar runs ad-hoc, configurando tickers y período
- Persiste cada run y sus trades en `backtest_runs` / `backtest_trades`
- Devuelve hit rate, retorno, Sharpe/Sortino y max drawdown

### Notificaciones
Todas las notificaciones pasan por una capa única (`_shared/notify.ts`): se
**persisten** en la tabla `notifications`, se **deduplican** por `dedup_key`, se
filtran por las **preferencias del usuario** (`notification_prefs`: canales,
severidad mínima, horas de silencio) y se rutean por usuario. Canal actual:
Telegram (el diseño deja listos email/in-app como adaptadores futuros).

Tipos de alerta:
- `signal_high` — señales HIGH **aprobadas por el Risk Manager** (`analyze`)
- `digest_morning` — resumen matutino de las señales del día (`analyze`)
- `trade_closed` — cierre por stop/target (`update-prices`)
- `stop_proximity` — precio dentro de `STOP_PROXIMITY_PCT` del stop/target (`update-prices`)
- `digest_eod` — P&L de cierre de mercado (`end-of-day`)
- `system_error` — **crítica**: un cron terminó en error (`logRunComplete`)

Configura el bot con `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` (si faltan, son
no-op silenciosos). Personaliza canales, severidad y horas de silencio por
usuario en **Ajustes** (`/settings`); cada usuario puede registrar su propio
`telegram_chat_id`.

### Risk Manager (segunda opinión multi-agente)
Tras generar las señales, un segundo pase con **Claude Opus 4.8** actúa como
Risk Manager: revisa el top N, **aprueba/veta** cada señal, ajusta la convicción
y registra `risk_flags`/`risk_rationale` en `signals`. Solo las señales HIGH que
pasan esta revisión disparan alerta HIGH y auto-execute. Configurable con
`RISK_REVIEW_MODEL` (ej. `claude-sonnet-4-6` para abaratar).

### ETFs
El universo incluye ETFs líquidos (SPY, QQQ, XLK, XLE). Como `TOP_GAINERS_LOSERS`
de Alpha Vantage es solo acciones, `discovery` los inyecta como watchlist fija
(`ETF_WATCHLIST`). CFDs no están soportados por los proveedores actuales
(requeriría otro feed tipo OANDA/IG).

### Multi-usuario (Supabase Auth)
- Email + password con Supabase Auth
- Cada usuario tiene su propio portfolio y trades (RLS habilitado)
- Trigger crea `portfolio` inicial al sign-up
- El frontend muestra `/login` cuando hay auth habilitada y no hay sesión
- Las **señales son globales** (todos los usuarios ven las mismas, pero cada uno ejecuta en su propio portfolio)

### Caché de precios y batch updates
- `analyze` reutiliza precios cacheados en Supabase si ya tienes la vela del día → reduce el tiempo total de ~5 min a ~30 s en runs siguientes
- Update de noticias en un solo upsert (en vez de N updates secuenciales)

### Soporte SHORT en risk.ts
- `planShortTrade` / `planTrade(direction, ...)` con stop/target invertidos
- La vista `v_open_positions` calcula P&L flotante correctamente para SHORT

---

## Arquitectura del flujo

```
[Alpha Vantage TOP_GAINERS_LOSERS]                  [Finnhub /company-news]
            │                                                  │
            ▼                                                  ▼
   ┌──────────────────────────┐                ┌──────────────────────────┐
   │  discovery (cron 11:00)  │ ─────────────► │  candidates + news (DB)  │
   └──────────────────────────┘                └──────────────────────────┘
                                                            │
            [Alpha Vantage TIME_SERIES_DAILY] (con cache)   │
                          │                                 ▼
                          ▼                       ┌──────────────────────┐
                ┌──────────────────────┐          │ analyze (cron 11:15) │
                │ indicators.ts (RSI,  │ ────────►│  → Claude API        │
                │ ATR, SMA20/50/200)   │          │  → signals (DB)      │
                └──────────────────────┘          │  → Telegram (HIGH)   │
                                                  └──────────────────────┘
                                                            │
                                                            ▼
                                                  ┌──────────────────┐
                                                  │   Dashboard UI   │
                                                  │   (paper trade)  │
                                                  └──────────────────┘
                                                            │
                                                            ▼
                                                  ┌──────────────────┐
                                                  │ trades + equity  │
                                                  │   (DB)           │
                                                  └──────────────────┘
                                                            ▲
                          ┌────────────────────────────────┤
                          │                                 │
                ┌──────────────────────┐         ┌──────────────────────┐
                │ update-prices (2h)   │         │  end-of-day (21:30)  │
                │  Finnhub quotes      │         │  equity snapshot     │
                │  auto-close stops    │         │  + refresh SPY       │
                │  → Telegram (close)  │         └──────────────────────┘
                └──────────────────────┘
```

---

## Validación del edge

El objetivo de este MVP es responder **una pregunta**:

> ¿Las señales del agente generan edge positivo ajustado por riesgo?

Para responderla, deja correr el sistema **al menos 4 semanas** acumulando trades cerrados, luego revisa en `/performance`:

| Métrica | Mínimo aceptable |
|---------|------------------|
| Total trades cerrados | ≥ 30 (significancia estadística básica) |
| Hit rate | ≥ 45% |
| P&L promedio por trade | > 0% (con R:R ≥ 1.5, hasta 40% hit rate puede ser rentable) |
| Sharpe ratio | ≥ 1.0 |
| Sortino ratio | ≥ 1.5 |
| Max drawdown | > -15% del capital inicial |
| Alpha vs SPY | > 0% |

Si esos números son positivos durante un período representativo (incluyendo distintos regímenes de mercado), entonces tiene sentido considerar capital real **muy gradualmente**.

---

## Estructura del repo

```
cuantitativo-agent/
├── netlify.toml                     # config + crons
├── supabase/
│   ├── schema.sql                   # tablas, vistas, índices base
│   ├── seed_universe.sql            # ~120 tickers + ETFs
│   ├── migrations_v2.sql            # fase 2: benchmark, backtest, auth + RLS
│   └── migrations_v3_notifications.sql  # fase 3: notifications + prefs + risk cols
├── netlify/functions/
│   ├── _shared/                     # libs reutilizables
│   │   ├── supabase.ts              # cliente DB + auth + hook system_error
│   │   ├── claude.ts                # wrapper Anthropic + prompts + riskReview (Opus)
│   │   ├── alphavantage.ts          # precios + top movers
│   │   ├── finnhub.ts               # noticias + quotes
│   │   ├── indicators.ts            # RSI / ATR / SMA en TS puro
│   │   ├── risk.ts                  # sizing por ATR (LONG + SHORT)
│   │   ├── metrics.ts               # Sharpe/Sortino/Calmar/MaxDD/benchmark
│   │   ├── notify.ts               # capa única de notificaciones (persist+dedup+ruteo)
│   │   └── telegram.ts              # adaptador Telegram + formatters
│   ├── discovery.ts                 # cron — descubre candidatos
│   ├── analyze.ts                   # cron — LLM + señales (con cache)
│   ├── update-prices.ts             # cron — mark-to-market + auto-close
│   ├── end-of-day.ts                # cron — equity snapshot + SPY refresh
│   ├── backtest.ts                  # HTTP — backtesting histórico
│   ├── api-signals.ts               # GET /api/signals
│   ├── api-portfolio.ts             # GET /api/portfolio (multi-user)
│   ├── api-performance.ts           # GET /api/performance (con advanced + benchmark)
│   ├── api-execute.ts               # POST /api/execute
│   ├── api-close-trade.ts           # POST /api/close-trade
│   └── api-backtest-runs.ts         # POST /api/backtest-runs
├── src/                             # frontend React
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── lib/
│   │   ├── api.ts                   # fetch client (con auth header)
│   │   ├── supabase.ts              # cliente JS supabase (anon)
│   │   └── auth.tsx                 # AuthProvider + useAuth hook
│   ├── components/
│   │   ├── Sidebar.tsx              # nav + sign out
│   │   ├── Header.tsx
│   │   ├── StatCard.tsx
│   │   └── SignalCard.tsx
│   └── pages/
│       ├── Dashboard.tsx
│       ├── Signals.tsx
│       ├── Portfolio.tsx
│       ├── Performance.tsx          # equity + advanced + benchmark
│       ├── Backtest.tsx             # ejecutar runs históricos
│       ├── Settings.tsx             # preferencias de notificaciones
│       └── Login.tsx                # email/password auth
├── docs/
│   └── prompt_v2.md                 # decisiones de prompt engineering
└── README.md
```

---

## Parámetros que puedes ajustar

| Archivo | Constante | Default | Significado |
|---------|-----------|---------|-------------|
| `discovery.ts` | `MAX_CANDIDATES` | 25 | Tope de candidatos diarios |
| `discovery.ts` | `MIN_VOLUME` | 500_000 | Liquidez mínima |
| `discovery.ts` | `MIN_MOVE_PCT` / `MAX_MOVE_PCT` | 1.5 / 20 | Banda de movimiento |
| `analyze.ts` | `TOP_N_FINAL_SIGNALS` | 5 | Señales finales por día |
| `analyze.ts` | `MIN_LLM_CONFIDENCE` | 0.4 | Filtro de confidence |
| `analyze.ts` | `ALPHA_VANTAGE_THROTTLE_MS` | 12_500 | Pausa entre pulls de Alpha Vantage |
| `risk.ts` | `risk_pct` | 1.0 | % capital por trade |
| `risk.ts` | `atr_multiplier_stop` | 1.5 | Stop = 1.5×ATR |
| `risk.ts` | `atr_multiplier_target` | 2.5 | Target = 2.5×ATR |
| `metrics.ts` | `RF_DAILY` (rf 4%) | ~1.59 bp | Risk-free para Sharpe |
| `backtest.ts` | `max_hold_days` | 15 | Forzar salida por tiempo |

---

## Roadmap futuro

- [ ] Backtesting que use **señales del LLM** (no solo técnico)
- [ ] Comparativa multi-régimen (bull/bear/sideways) en `/performance`
- [ ] Alertas por correo (Resend/SendGrid) al cerrar trade
- [ ] Trailing stops
- [ ] Position scaling (pyramiding)
- [ ] Backfilling histórico de equity para usuarios nuevos

---

## Licencia

MIT — úsalo, modifícalo, rómpelo. Solo no me culpes si pierdes plata.
