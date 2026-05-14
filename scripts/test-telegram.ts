/**
 * Smoke test del módulo telegram.ts.
 * Mockea fetch para capturar lo que se enviaría a la API sin hacer requests reales.
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

const { notifySignals, notifyTradeClosed, sendTelegram } = await import(
  '../netlify/functions/_shared/telegram.ts'
);

function divider(title: string) {
  console.log('\n' + '─'.repeat(72));
  console.log('▶ ' + title);
  console.log('─'.repeat(72));
}

function show(idx: number) {
  const c = captured[idx];
  console.log('parse_mode:', c.body.parse_mode);
  console.log('chat_id:', c.body.chat_id);
  console.log('text:');
  console.log(c.body.text);
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

// ─── Test 1: sin señales ────────────────────────────────────────────────
divider('Test 1 — notifySignals([]) (caso "sin señales hoy")');
captured.length = 0;
await notifySignals([]);
show(0);
assert(captured.length === 1, 'envió exactamente 1 mensaje');
assert(captured[0].body.parse_mode === 'HTML', 'usa parse_mode HTML');
assert(/no encontró señales/i.test(captured[0].body.text), 'menciona "no encontró señales"');

// ─── Test 2: mix de LONG/SHORT/HOLD ─────────────────────────────────────
divider('Test 2 — mix LONG + SHORT + HOLD');
captured.length = 0;
await notifySignals([
  {
    ticker: 'NVDA',
    direction: 'LONG',
    conviction: 'HIGH',
    score: 85,
    entry_price: 432.10,
    stop_loss: 425.00,
    take_profit: 450.00,
    rationale: 'Beat de earnings con guidance optimista. Setup técnico en breakout sobre SMA20.',
  },
  {
    ticker: 'META',
    direction: 'SHORT',
    conviction: 'MEDIUM',
    score: 68,
    entry_price: 480.50,
    stop_loss: 488.00,
    take_profit: 465.00,
    rationale: 'Anuncio regulatorio negativo. RSI sobrecomprado, divergencia bajista.',
  },
  {
    ticker: 'AAPL',
    direction: 'HOLD',
    conviction: 'LOW',
    score: 45,
    entry_price: 195.30,
    stop_loss: null,
    take_profit: null,
    rationale: 'Señales mixtas: catalizador neutro, RSI en zona media, sin convicción direccional clara.',
  },
]);
show(0);
const text2 = captured[0].body.text;
assert(/NVDA/.test(text2), 'incluye NVDA');
assert(/META/.test(text2), 'incluye META');
assert(/AAPL/.test(text2), 'incluye AAPL');
assert(/LONG/.test(text2), 'menciona LONG');
assert(/SHORT/.test(text2), 'menciona SHORT');
assert(/HOLD/.test(text2), 'menciona HOLD');
assert(/3 señal/.test(text2), 'header dice "3 señal(es)"');
assert(/2 accionable/.test(text2), 'menciona 2 accionables');
assert(/entry <code>\$432\.10<\/code>/.test(text2), 'NVDA tiene entry $432.10');
assert(/R:R 2\.52/.test(text2), 'NVDA R:R calculado (18/7.10 ≈ 2.54)');
// AAPL es HOLD: NO debe tener entry/stop/target en su sección
const aaplSection = text2.split('AAPL')[1] ?? '';
assert(!/entry <code>\$195/.test(aaplSection.split('NVDA')[0] ?? aaplSection),
  'AAPL (HOLD) no muestra entry/stop/target');

// ─── Test 3: rationale con caracteres especiales ────────────────────────
divider('Test 3 — rationale con < > & que podrían romper HTML');
captured.length = 0;
await notifySignals([
  {
    ticker: 'TSLA',
    direction: 'LONG',
    conviction: 'MEDIUM',
    score: 72,
    entry_price: 250.00,
    stop_loss: 240.00,
    take_profit: 270.00,
    rationale: 'Margin > 20% & guidance < expectativa previa. Setup OK.',
  },
]);
show(0);
const text3 = captured[0].body.text;
assert(/Margin &gt; 20% &amp; guidance &lt; expectativa/.test(text3),
  'caracteres <, >, & están escapados a HTML entities');
assert(!/Margin > 20% &/.test(text3), 'no quedan caracteres HTML crudos');

// ─── Test 4: rationale con _ y * (que rompían Markdown) ────────────────
divider('Test 4 — rationale con _ y * (que rompían parse_mode=Markdown)');
captured.length = 0;
await notifySignals([
  {
    ticker: 'AMZN',
    direction: 'LONG',
    conviction: 'HIGH',
    score: 82,
    entry_price: 180.00,
    stop_loss: 175.00,
    take_profit: 190.00,
    rationale: 'AWS *crece* 19% YoY. Tasa _libre_ de riesgo estable.',
  },
]);
show(0);
const text4 = captured[0].body.text;
// En HTML, _ y * no son especiales: deben pasar tal cual
assert(/AWS \*crece\* 19% YoY/.test(text4), 'asteriscos pasan tal cual en HTML');
assert(/Tasa _libre_ de riesgo/.test(text4), 'guiones bajos pasan tal cual en HTML');

// ─── Test 5: notifyTradeClosed ──────────────────────────────────────────
divider('Test 5 — notifyTradeClosed (win y loss)');
captured.length = 0;
await notifyTradeClosed({
  ticker: 'NVDA',
  direction: 'LONG',
  pnl_usd: 145.30,
  pnl_pct: 4.2,
  exit_reason: 'target',
});
show(0);
const text5 = captured[0].body.text;
assert(/✅/.test(text5), 'win usa ✅');
assert(/\+\$145\.30/.test(text5), 'P&L formateado con signo');
assert(/P&amp;L/.test(text5), 'P&L escapa el ampersand');

captured.length = 0;
await notifyTradeClosed({
  ticker: 'META',
  direction: 'SHORT',
  pnl_usd: -85.10,
  pnl_pct: -2.1,
  exit_reason: 'stop',
});
show(0);
const text5b = captured[0].body.text;
assert(/🛑/.test(text5b), 'loss usa 🛑');
assert(/-\$85\.10/.test(text5b), 'loss tiene signo negativo');

// ─── Test 6: sin credenciales → no-op silencioso ────────────────────────
divider('Test 6 — sin credenciales (no-op silencioso)');
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
captured.length = 0;
const sent = await sendTelegram('hola');
console.log('sendTelegram returned:', sent);
console.log('captured.length:', captured.length);
assert(sent === false, 'sendTelegram devuelve false sin credenciales');
assert(captured.length === 0, 'NO se hizo ninguna llamada HTTP');

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
