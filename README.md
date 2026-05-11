# Cuantitativo · Quant Agent

Agente cuantitativo autónomo que descubre oportunidades de trading swing en US equities, las evalúa con Claude (Anthropic) y simula las operaciones en un portfolio paper para validar si las predicciones generan edge **antes** de operar capital real.

> ⚠️ **Research only.** Esto no es asesoría financiera. Úsalo para investigar, validar, y aprender. Operar mercados reales conlleva riesgo de pérdida total del capital.

---

## ¿Qué hace?

Cada día hábil, el agente:

1. **Descubre** (06:00 ET) — Pull de top movers del mercado US, filtra por liquidez y movimiento razonable, busca catalizadores noticiosos. ~25 candidatos.
2. **Analiza** (06:15 ET) — Para cada candidato con noticia, calcula RSI/ATR/SMAs y manda todo a Claude para análisis estructurado de sentimiento + señal.
3. **Genera señales** — Top 5 señales del día con: dirección (LONG/SHORT/HOLD), score 0–100, convicción (HIGH/MEDIUM/LOW), entry/stop/target, sizing por ATR, y rationale en español.
4. **Mark-to-market** (cada 2h durante mercado) — Actualiza precios de posiciones abiertas, cierra automáticamente si tocan stop o target.
5. **End-of-day** (16:30 ET) — Snapshot diario para curva de equity.

Tú decides desde el dashboard cuáles paper-tradear. Si después de unas semanas el `hit_rate` y P&L acumulado son positivos → tienes evidencia de edge antes de arriesgar capital real.

---

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | Vite + React 18 + TypeScript + Tailwind + Recharts |
| Backend | Netlify Functions (Scheduled + HTTP), TypeScript |
| Database | Supabase Postgres (free tier, 500MB) |
| LLM | Claude Sonnet 4.5 (Anthropic API) |
| Datos de mercado | Alpha Vantage (top movers + history) + Finnhub (noticias + quotes) |

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
2. Anota la `Project URL` y `service_role` key (Settings → API)
3. Abre el SQL Editor y ejecuta **en este orden**:
   - `supabase/schema.sql` (crea todas las tablas, vistas e índices)
   - `supabase/seed_universe.sql` (inserta ~120 tickers iniciales)

### 3. Conseguir API keys gratis

| Servicio | URL | Free tier |
|----------|-----|-----------|
| Anthropic | console.anthropic.com | $5 trial credit |
| Alpha Vantage | alphavantage.co/support/#api-key | 25 req/día (suficiente) |
| Finnhub | finnhub.io/register | 60 req/min |

### 4. Conectar a Netlify

1. Netlify → "Add new site" → "Import an existing project" → GitHub → tu repo
2. Build settings se autodetectan desde `netlify.toml`
3. **Site settings → Environment variables**, añade:

```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   # service_role
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...   # anon (mismo proyecto)
ALPHA_VANTAGE_KEY=...
FINNHUB_KEY=...
```

4. Trigger un deploy. Las **Scheduled Functions** se registran automáticamente.

### 5. Verificación

Después del primer deploy, en Netlify → Functions, deberías ver:
- `discovery` (scheduled)
- `analyze` (scheduled)
- `update-prices` (scheduled)
- `end-of-day` (scheduled)
- `api-signals`, `api-portfolio`, `api-performance`, `api-execute`, `api-close-trade`

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
| `end-of-day` | `30 21 * * 1-5` | L–V 16:30 ET (post-cierre) |

> Netlify Scheduled Functions corren siempre en UTC. Si quieres ajustar a tu zona, edita `netlify.toml`.

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
            [Alpha Vantage TIME_SERIES_DAILY]               │
                          │                                 ▼
                          ▼                       ┌──────────────────────┐
                ┌──────────────────────┐          │ analyze (cron 11:15) │
                │ indicators.ts (RSI,  │ ────────►│  → Claude API        │
                │ ATR, SMA20/50/200)   │          │  → signals (DB)      │
                └──────────────────────┘          └──────────────────────┘
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
                │  auto-close stops    │         └──────────────────────┘
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
| Drawdown máximo | < 15% del capital inicial |
| P&L acumulado | > 0% |

Si esos números son positivos durante un período representativo (incluyendo distintos regímenes de mercado), entonces tiene sentido considerar capital real **muy gradualmente**.

---

## Estructura del repo

```
cuantitativo-agent/
├── netlify.toml                     # config + crons
├── supabase/
│   ├── schema.sql                   # tablas, vistas, índices
│   └── seed_universe.sql            # ~120 tickers iniciales
├── netlify/functions/
│   ├── _shared/                     # libs reutilizables
│   │   ├── supabase.ts              # cliente DB + observability
│   │   ├── claude.ts                # wrapper Anthropic + prompts
│   │   ├── alphavantage.ts          # precios + top movers
│   │   ├── finnhub.ts               # noticias + quotes
│   │   ├── indicators.ts            # RSI / ATR / SMA en TS puro
│   │   └── risk.ts                  # position sizing por ATR
│   ├── discovery.ts                 # cron — descubre candidatos
│   ├── analyze.ts                   # cron — LLM + señales
│   ├── update-prices.ts             # cron — mark-to-market
│   ├── end-of-day.ts                # cron — equity snapshot
│   ├── api-signals.ts               # GET /api/signals
│   ├── api-portfolio.ts             # GET /api/portfolio
│   ├── api-performance.ts           # GET /api/performance
│   ├── api-execute.ts               # POST /api/execute
│   └── api-close-trade.ts           # POST /api/close-trade
├── src/                             # frontend React
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── lib/api.ts                   # cliente HTTP + tipos
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   ├── StatCard.tsx
│   │   └── SignalCard.tsx
│   └── pages/
│       ├── Dashboard.tsx
│       ├── Signals.tsx
│       ├── Portfolio.tsx
│       └── Performance.tsx
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
| `risk.ts` | `risk_pct` | 1.0 | % capital por trade |
| `risk.ts` | `atr_multiplier_stop` | 1.5 | Stop = 1.5×ATR |
| `risk.ts` | `atr_multiplier_target` | 2.5 | Target = 2.5×ATR |

---

## Próximos pasos (fase 2)

- [ ] Notificaciones a Telegram cuando hay señal HIGH conviction
- [ ] Backtesting histórico con datos de 2+ años
- [ ] Métricas avanzadas: Sharpe, Sortino, Calmar, max drawdown
- [ ] Auth de Supabase para soportar multi-usuario
- [ ] Comparativa contra benchmark (SPY)
- [ ] Alertas por correo cuando se cierra un trade

---

## Licencia

MIT — úsalo, modifícalo, rómpelo. Solo no me culpes si pierdes plata.
