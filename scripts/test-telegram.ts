/**
 * Smoke test del módulo telegram.ts (adaptador + formatters).
 * Mockea fetch para capturar lo que se enviaría a la API sin requests reales.
 * Ejecutar con:  npx tsx scripts/test-telegram.ts
 */

process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
process.env.TELEGRAM_CHAT_ID = '-100TEST';

interface CapturedRequest {
  url: string;
  body: any;
}

const captured: CapturedRequest[] = [];

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  captured.push({
    url: String(url),
    body: init?.body ? JSON.parse(init.body) : null,
  });
  return new Response('{"ok":true}', { status: 200 });
}) as typeof fetch;

const {
  sendTelegram,
  formatSignalHeadline,
  formatSignalBody,
  formatTradeClosedBody,
  escapeHtml,
} = await import('../netlify/functions/_shared/telegram.ts');

function divider(title: string) {
  console.log('\n' + '─'.repeat(72));
  console.log('▶ ' + title);
  console.log('─'.repeat(72));
}

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures++;
  }
}

// ─── Test 1: sendTelegram usa parse_mode HTML y chat por defecto ─────────
divider('Test 1 — sendTelegram (envío básico)');
captured.length = 0;
await sendTelegram('<b>hola</b>');
assert(captured.length === 1, 'envió exactamente 1 mensaje');
assert(captured[0].body.parse_mode === 'HTML', 'usa parse_mode HTML');
assert(captured[0].body.chat_id === '-100TEST', 'usa el chat_id del env por defecto');

// ─── Test 2: override de chat_id (ruteo por usuario) ────────────────────
divider('Test 2 — override de chat_id por usuario');
captured.length = 0;
await sendTelegram('hola', '-100OTRO');
assert(captured[0].body.chat_id === '-100OTRO', 'respeta el chat_id override');

// ─── Test 3: formatSignalBody con plan (LONG) ───────────────────────────
divider('Test 3 — formatSignalBody (LONG con R:R)');
const longBody = formatSignalBody({
  ticker: 'NVDA',
  direction: 'LONG',
  conviction: 'HIGH',
  score: 85,
  entry_price: 432.1,
  stop_loss: 425.0,
  take_profit: 450.0,
  rationale: 'Beat de earnings con guidance optimista.',
});
console.log(longBody);
assert(/entry <code>\$432\.10<\/code>/.test(longBody), 'entry formateado');
assert(/R:R 2\.52/.test(longBody), 'R:R calculado (17.9/7.1 ≈ 2.52)');

// ─── Test 4: HOLD no muestra plan ───────────────────────────────────────
divider('Test 4 — formatSignalBody (HOLD sin plan)');
const holdBody = formatSignalBody({
  ticker: 'AAPL',
  direction: 'HOLD',
  conviction: 'LOW',
  score: 45,
  entry_price: 195.3,
  stop_loss: null,
  take_profit: null,
  rationale: 'Señales mixtas, sin convicción direccional.',
});
assert(!/entry <code>/.test(holdBody), 'HOLD no muestra entry/stop/target');

// ─── Test 5: escape de caracteres HTML en el rationale ──────────────────
divider('Test 5 — escapeHtml en rationale (< > &)');
const escBody = formatSignalBody({
  ticker: 'TSLA',
  direction: 'LONG',
  conviction: 'MEDIUM',
  score: 72,
  entry_price: 250,
  stop_loss: 240,
  take_profit: 270,
  rationale: 'Margin > 20% & guidance < previa.',
});
assert(/Margin &gt; 20% &amp; guidance &lt; previa/.test(escBody),
  '<, >, & escapados a entities');
assert(!/Margin > 20% &/.test(escBody), 'no quedan caracteres HTML crudos');

// ─── Test 6: _ y * pasan tal cual (no son especiales en HTML) ───────────
divider('Test 6 — _ y * pasan tal cual (HTML, no Markdown)');
const mdBody = formatSignalBody({
  ticker: 'AMZN',
  direction: 'LONG',
  conviction: 'HIGH',
  score: 82,
  entry_price: 180,
  stop_loss: 175,
  take_profit: 190,
  rationale: 'AWS *crece* 19% YoY. Tasa _libre_ de riesgo estable.',
});
assert(/AWS \*crece\* 19% YoY/.test(mdBody), 'asteriscos sin tocar');
assert(/Tasa _libre_ de riesgo/.test(mdBody), 'guiones bajos sin tocar');

// ─── Test 7: headline + formatTradeClosedBody ───────────────────────────
divider('Test 7 — headline y trade cerrado');
const headline = formatSignalHeadline({
  ticker: 'NVDA',
  direction: 'LONG',
  conviction: 'HIGH',
  score: 85,
  entry_price: 432.1,
  stop_loss: 425,
  take_profit: 450,
  rationale: '',
});
assert(/🎯/.test(headline) && /NVDA/.test(headline) && /85\/100/.test(headline),
  'headline incluye badge, ticker y score');

const win = formatTradeClosedBody({
  ticker: 'NVDA',
  direction: 'LONG',
  pnl_usd: 145.3,
  pnl_pct: 4.2,
  exit_reason: 'target',
});
assert(/\+\$145\.30/.test(win), 'win con signo +');
assert(/P&amp;L/.test(win), 'P&L escapa el ampersand');

const loss = formatTradeClosedBody({
  ticker: 'META',
  direction: 'SHORT',
  pnl_usd: -85.1,
  pnl_pct: -2.1,
  exit_reason: 'stop',
});
assert(/-\$85\.10/.test(loss), 'loss con signo -');

// ─── Test 8: sin credenciales → no-op silencioso ────────────────────────
divider('Test 8 — sin credenciales (no-op silencioso)');
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
captured.length = 0;
const sent = await sendTelegram('hola');
assert(sent === false, 'sendTelegram devuelve false sin credenciales');
assert(captured.length === 0, 'NO se hizo ninguna llamada HTTP');

// escapeHtml directo
assert(escapeHtml('a<b>&c') === 'a&lt;b&gt;&amp;c', 'escapeHtml básico');

// ─── Resultado ──────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
if (failures === 0) {
  console.log('✓ Todos los asserts pasaron');
  process.exit(0);
} else {
  console.log(`✗ ${failures} assert(s) fallaron`);
  process.exit(1);
}

// Restore
globalThis.fetch = originalFetch;
