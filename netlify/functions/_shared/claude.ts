import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  _client = new Anthropic({ apiKey });
  return _client;
}

// Modelos: Haiku para sentimiento de noticias (más barato y rápido),
// Sonnet para síntesis final de señales (mejor razonamiento), Opus para la
// segunda opinión del Risk Manager (juicio de mayor riesgo, pocos candidatos).
const MODEL_NEWS = 'claude-haiku-4-5-20251001';
const MODEL_SIGNAL = 'claude-sonnet-4-6';
// Override opcional para abaratar (ej. RISK_REVIEW_MODEL=claude-sonnet-4-6).
const MODEL_RISK = process.env.RISK_REVIEW_MODEL || 'claude-opus-4-8';

// Pricing aproximado para tracking de costos (USD per 1M tokens)
const PRICE_SONNET_INPUT = 3.0;
const PRICE_SONNET_OUTPUT = 15.0;
const PRICE_HAIKU_INPUT = 1.0;
const PRICE_HAIKU_OUTPUT = 5.0;
const PRICE_OPUS_INPUT = 5.0;
const PRICE_OPUS_OUTPUT = 25.0;
// Prompt caching: write = 1.25x input, read = 0.1x input
const CACHE_WRITE_MULT = 1.25;
const CACHE_READ_MULT = 0.1;

/** Precios [input, output] por modelo, para buildUsage. */
function pricesFor(model: string): [number, number] {
  if (model.includes('opus')) return [PRICE_OPUS_INPUT, PRICE_OPUS_OUTPUT];
  if (model.includes('haiku')) return [PRICE_HAIKU_INPUT, PRICE_HAIKU_OUTPUT];
  return [PRICE_SONNET_INPUT, PRICE_SONNET_OUTPUT];
}

export interface NewsAnalysis {
  ticker: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  risk_level: number;        // 1-10
  novelty: number;           // 1-10
  confidence: number;        // 0.0-1.0
  summary: string;           // <= 20 words
  catalysts: string[];
}

export interface SignalRecommendation {
  ticker: string;
  score: number;             // 0-100
  direction: 'LONG' | 'SHORT' | 'HOLD';
  conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;         // <= 60 words
  technical_score: number;   // 0-100
  sentiment_score: number;   // 0-100
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number;
}

function calculateCost(
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  },
  priceIn: number,
  priceOut: number,
): number {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return (
    (usage.input_tokens / 1_000_000) * priceIn +
    (usage.output_tokens / 1_000_000) * priceOut +
    (cacheWrite / 1_000_000) * priceIn * CACHE_WRITE_MULT +
    (cacheRead / 1_000_000) * priceIn * CACHE_READ_MULT
  );
}

function buildUsage(
  apiUsage: any,
  priceIn: number,
  priceOut: number,
): ClaudeUsage {
  return {
    input_tokens: apiUsage.input_tokens ?? 0,
    output_tokens: apiUsage.output_tokens ?? 0,
    cache_creation_input_tokens: apiUsage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: apiUsage.cache_read_input_tokens ?? 0,
    cost_usd: calculateCost(apiUsage, priceIn, priceOut),
  };
}

/**
 * Extrae JSON de la respuesta del LLM, tolerando markdown fences.
 */
function extractJson<T>(text: string): T {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(cleaned) as T;
}

/**
 * Structured outputs: el esquema fuerza al modelo a devolver JSON válido con la
 * forma exacta esperada, eliminando los fallos silenciosos de parseo. Se pasa
 * como output_config.format y es compatible con prompt caching.
 * Se conserva extractJson como fallback robusto si el SDK ignora el parámetro.
 * Nota: structured outputs no admite min/max numéricos → los rangos van en el prompt.
 */
const NEWS_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticker: { type: 'string' },
    sentiment: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
    risk_level: { type: 'integer' },
    novelty: { type: 'integer' },
    confidence: { type: 'number' },
    summary: { type: 'string' },
    catalysts: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'ticker',
    'sentiment',
    'risk_level',
    'novelty',
    'confidence',
    'summary',
    'catalysts',
  ],
} as const;

const SIGNAL_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticker: { type: 'string' },
    score: { type: 'integer' },
    direction: { type: 'string', enum: ['LONG', 'SHORT', 'HOLD'] },
    conviction: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    rationale: { type: 'string' },
    technical_score: { type: 'integer' },
    sentiment_score: { type: 'integer' },
  },
  required: [
    'ticker',
    'score',
    'direction',
    'conviction',
    'rationale',
    'technical_score',
    'sentiment_score',
  ],
} as const;

const RISK_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticker: { type: 'string' },
    approved: { type: 'boolean' },
    adjusted_conviction: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    risk_flags: { type: 'array', items: { type: 'string' } },
    risk_rationale: { type: 'string' },
  },
  required: [
    'ticker',
    'approved',
    'adjusted_conviction',
    'risk_flags',
    'risk_rationale',
  ],
} as const;

/** output_config.format con un esquema de array top-level. */
function arrayFormat(itemSchema: unknown) {
  return {
    format: {
      type: 'json_schema' as const,
      schema: { type: 'array', items: itemSchema },
    },
  };
}

// =============================================================
// 1) Análisis de noticias (batch por ticker)
// =============================================================

const NEWS_ANALYSIS_PROMPT = `Eres un analista cuantitativo senior de un hedge fund. Tu trabajo es evaluar noticias financieras con disciplina, sin dejarte llevar por titulares sensacionalistas. Para cada noticia evalúa:

1. SENTIMIENTO: "bullish" | "bearish" | "neutral" (impacto direccional sobre el ticker)
2. RISK_LEVEL: 1-10 (¿qué tan disruptivo sería si se materializa?)
3. NOVELTY: 1-10 (¿información nueva, o ya descontada en el precio? Una noticia que circula hace días = baja novedad)
4. CONFIDENCE: 0.0-1.0 (credibilidad de la fuente y verificabilidad del dato)
5. SUMMARY: máximo 20 palabras
6. CATALYSTS: lista corta de catalizadores concretos (ej: ["earnings beat", "FDA approval"])

Si la noticia es irrelevante para el ticker, marca confidence < 0.3.

Devuelve EXCLUSIVAMENTE un array JSON válido, sin markdown, sin texto antes/después.
Formato: [{"ticker": "...", "sentiment": "...", "risk_level": ..., "novelty": ..., "confidence": ..., "summary": "...", "catalysts": [...]}, ...]`;

export interface NewsItem {
  ticker: string;
  title: string;
  source?: string;
  published_at?: string;
}

export async function analyzeNews(
  newsItems: NewsItem[],
): Promise<{ analyses: NewsAnalysis[]; usage: ClaudeUsage }> {
  if (newsItems.length === 0) {
    return {
      analyses: [],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cost_usd: 0,
      },
    };
  }

  const client = getClient();

  const userContent = newsItems
    .map(
      (n, i) =>
        `[${i + 1}] TICKER: ${n.ticker}\nTITLE: ${n.title}\nSOURCE: ${n.source || 'unknown'}\nPUBLISHED: ${n.published_at || 'unknown'}`,
    )
    .join('\n\n');

  // output_config no está tipado en todas las versiones del SDK → params: any.
  const params: any = {
    model: MODEL_NEWS,
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: NEWS_ANALYSIS_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userContent }],
    output_config: arrayFormat(NEWS_ITEM_SCHEMA),
  };
  const response = await client.messages.create(params);

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  const analyses = extractJson<NewsAnalysis[]>(text);
  const usage = buildUsage(response.usage, PRICE_HAIKU_INPUT, PRICE_HAIKU_OUTPUT);

  return { analyses, usage };
}

// =============================================================
// 2) Generación de señal final por ticker
// =============================================================

const SIGNAL_PROMPT = `Eres un analista cuantitativo senior generando señales de trading swing (3-15 días de holding). Recibes datos técnicos y análisis de noticias para varios tickers candidatos. Tu trabajo es producir una recomendación accionable.

Reglas estrictas:
- LONG solo si: sentimiento agregado bullish con alta novedad/confianza, Y setup técnico favorable (cerca de soporte, RSI no sobrecomprado, momentum positivo)
- SHORT solo en setups muy claros (preferimos HOLD si hay duda)
- HOLD si: señales mixtas, baja confianza, o riesgo elevado sin compensación
- score 0-100: combina convicción técnica + fundamental + calidad de datos
- conviction: HIGH solo si score >= 80 y confianza promedio de noticias > 0.7
- rationale: máximo 60 palabras, en español, citando los 2-3 factores decisivos

Devuelve EXCLUSIVAMENTE un array JSON, sin markdown:
[{"ticker": "...", "score": ..., "direction": "LONG|SHORT|HOLD", "conviction": "HIGH|MEDIUM|LOW", "rationale": "...", "technical_score": ..., "sentiment_score": ...}, ...]`;

export interface SignalContext {
  ticker: string;
  current_price: number;
  technical: {
    rsi_14: number | null;
    atr_14: number | null;
    sma_20: number | null;
    sma_50: number | null;
    sma_200: number | null;
    distance_to_sma20_pct: number | null;
    distance_to_sma50_pct: number | null;
  };
  news_analyses: NewsAnalysis[];
}

export async function generateSignals(
  contexts: SignalContext[],
): Promise<{ signals: SignalRecommendation[]; usage: ClaudeUsage }> {
  if (contexts.length === 0) {
    return {
      signals: [],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cost_usd: 0,
      },
    };
  }

  const client = getClient();

  const userContent = contexts
    .map((c) => {
      const newsAgg = c.news_analyses.length > 0
        ? c.news_analyses.map((n) => `  - [${n.sentiment}, conf=${n.confidence}, nov=${n.novelty}] ${n.summary}`).join('\n')
        : '  (no relevant news)';

      return `=== ${c.ticker} ===
Price: $${c.current_price}
Technical:
  RSI(14): ${c.technical.rsi_14}
  ATR(14): ${c.technical.atr_14}
  SMA20: ${c.technical.sma_20} (dist ${c.technical.distance_to_sma20_pct}%)
  SMA50: ${c.technical.sma_50} (dist ${c.technical.distance_to_sma50_pct}%)
  SMA200: ${c.technical.sma_200}
News (${c.news_analyses.length}):
${newsAgg}`;
    })
    .join('\n\n');

  const params: any = {
    model: MODEL_SIGNAL,
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: SIGNAL_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userContent }],
    output_config: arrayFormat(SIGNAL_ITEM_SCHEMA),
  };
  const response = await client.messages.create(params);

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  const signals = extractJson<SignalRecommendation[]>(text);
  const usage = buildUsage(response.usage, PRICE_SONNET_INPUT, PRICE_SONNET_OUTPUT);

  return { signals, usage };
}

// =============================================================
// 3) Risk Manager — segunda opinión sobre las señales candidatas
// =============================================================

const RISK_PROMPT = `Eres el Risk Manager de un hedge fund. Recibes señales de trading swing ya generadas por un analista, junto con su contexto técnico y de noticias. Tu trabajo NO es generar señales, sino CUESTIONARLAS: aprobar solo las que tengan un perfil riesgo/beneficio sólido y vetar o degradar el resto.

Para cada señal evalúa:
- APPROVED: true solo si el setup es claro, el riesgo está acotado y los catalizadores son creíbles. Ante la duda, false.
- ADJUSTED_CONVICTION: HIGH | MEDIUM | LOW (puedes bajar la convicción original; raramente subirla)
- RISK_FLAGS: lista corta de riesgos concretos (ej: ["RSI sobrecomprado", "noticia de baja novedad", "stop demasiado ajustado", "earnings inminente"])
- RISK_RATIONALE: máximo 40 palabras, en español, justificando el veredicto

Reglas:
- HIGH approved solo si convicción técnica y fundamental son fuertes Y no hay flags graves.
- Las señales HOLD se aprueban con convicción LOW (son informativas, sin trade).
- Penaliza: baja novedad/confianza de noticias, RSI extremo contra la dirección, R:R pobre.

Devuelve EXCLUSIVAMENTE un array JSON, sin markdown:
[{"ticker": "...", "approved": true|false, "adjusted_conviction": "HIGH|MEDIUM|LOW", "risk_flags": [...], "risk_rationale": "..."}, ...]`;

export interface RiskVerdict {
  ticker: string;
  approved: boolean;
  adjusted_conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  risk_flags: string[];
  risk_rationale: string;
}

export async function riskReview(
  signals: SignalRecommendation[],
  contexts: SignalContext[],
): Promise<{ verdicts: RiskVerdict[]; usage: ClaudeUsage }> {
  const emptyUsage: ClaudeUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cost_usd: 0,
  };
  if (signals.length === 0) return { verdicts: [], usage: emptyUsage };

  const client = getClient();

  const userContent = signals
    .map((s) => {
      const ctx = contexts.find((c) => c.ticker === s.ticker);
      const tech = ctx
        ? `RSI ${ctx.technical.rsi_14}, dist SMA20 ${ctx.technical.distance_to_sma20_pct}%, dist SMA50 ${ctx.technical.distance_to_sma50_pct}%`
        : '(sin técnico)';
      const news = ctx && ctx.news_analyses.length > 0
        ? ctx.news_analyses
            .map((n) => `[${n.sentiment} conf=${n.confidence} nov=${n.novelty}] ${n.summary}`)
            .join('; ')
        : '(sin noticias relevantes)';
      return `=== ${s.ticker} ===
Señal: ${s.direction} · score ${s.score} · conviction ${s.conviction}
Rationale analista: ${s.rationale}
Técnico: ${tech}
Noticias: ${news}`;
    })
    .join('\n\n');

  // Opus con adaptive thinking para el juicio de mayor riesgo + structured outputs.
  const params: any = {
    model: MODEL_RISK,
    max_tokens: 8192,
    thinking: { type: 'adaptive' },
    system: [
      { type: 'text', text: RISK_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userContent }],
    output_config: arrayFormat(RISK_ITEM_SCHEMA),
  };
  const response = await client.messages.create(params);

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  const verdicts = extractJson<RiskVerdict[]>(text);
  const [pin, pout] = pricesFor(MODEL_RISK);
  const usage = buildUsage(response.usage, pin, pout);

  return { verdicts, usage };
}
