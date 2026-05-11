# Prompt Engineering · v2

Documenta las decisiones de diseño de los prompts que usa el agente. Iterar acá antes de tocar `claude.ts`.

## Filosofía

Disciplina antes que entusiasmo. El LLM es un analista junior brillante pero impresionable: si no le ponemos rieles claros, va a sobre-reaccionar a titulares dramáticos. Por eso:

1. **JSON estructurado siempre**, nunca prosa abierta.
2. **Separar análisis de noticia de generación de señal** — son tareas distintas, mezclarlas degrada calidad.
3. **Pedirle escepticismo explícito** — `novelty` y `confidence` son antídotos contra hype circular.
4. **Conviction HIGH solo si hay evidencia múltiple** — no basta con un titular bullish.

---

## Prompt 1: Análisis de noticia

**Propósito:** Para cada artículo, extraer evaluación estructurada y reproducible.

**Output schema:**
```ts
{
  ticker: string,
  sentiment: 'bullish' | 'bearish' | 'neutral',
  risk_level: 1-10,        // ¿qué tan disruptivo si se materializa?
  novelty: 1-10,           // ¿información nueva o ya descontada?
  confidence: 0.0-1.0,     // credibilidad + verificabilidad
  summary: string,         // ≤20 palabras
  catalysts: string[]      // p.ej. ["FDA approval", "earnings beat"]
}
```

**Decisiones clave:**
- `novelty` evita que el agente "descubra" repetidamente la misma noticia rebotada.
- `confidence < 0.3` ⇒ se descarta el artículo.
- `summary` corto fuerza condensación; titulares clickbait pierden poder.

---

## Prompt 2: Generación de señal

**Propósito:** Decidir LONG/SHORT/HOLD con score y rationale a partir de **técnico + análisis de noticias agregado**.

**Reglas hard-coded en el prompt:**
- LONG solo si: noticias agregadas bullish con `confidence > 0.5` Y setup técnico favorable (cerca de soporte, RSI ≤ 70, momentum positivo).
- SHORT solo en setups muy claros (bias del prompt: preferimos HOLD).
- `conviction = HIGH` solo si `score ≥ 80` Y promedio de confidence en noticias `> 0.7`.
- `rationale` ≤ 60 palabras citando 2-3 factores decisivos.

---

## Iteraciones futuras

- [ ] Few-shot examples de señales históricas que funcionaron y otras que fallaron
- [ ] Self-critique: pedir al LLM que liste 3 razones por las que la señal podría fallar
- [ ] Multi-pass: generar señal → criticarla → revisar → finalizar
- [ ] Ablation: comparar con/sin el prompt de news para medir contribución incremental

---

## Tracking de costos

Cada call a Claude registra `input_tokens`, `output_tokens` y `cost_usd` en `function_runs`. Revisar regularmente:

```sql
SELECT
  date_trunc('day', started_at) AS dia,
  SUM(llm_tokens_used) AS tokens,
  SUM(llm_cost_usd) AS costo_usd
FROM function_runs
WHERE function_name = 'analyze'
GROUP BY 1 ORDER BY 1 DESC;
```

Si el costo diario supera $0.50, hay algo mal (posible loop o prompt inflado).
