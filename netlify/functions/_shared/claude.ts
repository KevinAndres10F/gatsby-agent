import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  _client = new Anthropic({ apiKey });
  return _client;
}

// Modelo recomendado: balance costo/calidad
const MODEL = 'claude-sonnet-4-6';

// Pricing aproximado para tracking de costos (USD per 1M tokens)
const PRICE_INPUT_PER_M = 3.0;
const PRICE_OUTPUT_PER_M = 15.0;

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
  cost_usd: number;
}

function calculateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICE_INPUT_PER_M +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M
  );
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
    return { analyses: [], usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 } };
  }

  const client = getClient();

  const userContent = newsItems
    .map(
      (n, i) =>
        `[${i + 1}] TICKER: ${n.ticker}\nTITLE: ${n.title}\nSOURCE: ${n.source || 'unknown'}\nPUBLISHED: ${n.published_at || 'unknown'}`,
    )
    .join('\n\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: NEWS_ANALYSIS_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  const analyses = extractJson<NewsAnalysis[]>(text);

  const usage: ClaudeUsage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cost_usd: calculateCost(response.usage.input_tokens, response.usage.output_tokens),
  };

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
    return { signals: [], usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 } };
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

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SIGNAL_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  const signals = extractJson<SignalRecommendation[]>(text);

  const usage: ClaudeUsage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cost_usd: calculateCost(response.usage.input_tokens, response.usage.output_tokens),
  };

  return { signals, usage };
}
