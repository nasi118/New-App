/* Bounded browser checks: all provider responses are mocked; no credits used. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_HOME || 'playwright')); }
catch { ({ chromium } = require(process.env.PLAYWRIGHT_HOME || '/opt/codex/cua_node/lib/node_modules/playwright')); }
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + sep)) throw new Error('invalid path');
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] || 'text/plain';
    res.writeHead(200, { 'content-type': type }); res.end(await readFile(path));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  const bodies = [];
  const reasoning = { type: 'reasoning', id: 'rs_mock', summary: [], encrypted_content: 'opaque-mocked-reasoning' };
  const call = { type: 'function_call', id: 'fc_mock', name: 'get_client_return', call_id: 'call_mock', arguments: '{"lines":"all"}' };
  await page.route('**/api/ai/chat', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { provider: 'openai', configured: true, model: 'mock-openai' } });
    bodies.push(route.request().postDataJSON());
    const output = bodies.length === 1 ? [reasoning, call] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The selected column uses the engine tax calculation.' }] }];
    await route.fulfill({ json: { output, text: bodies.length === 1 ? '' : 'The selected column uses the engine tax calculation.', status: 'completed' } });
  });
  await page.goto(base + '/planner/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.TMP?.advisor);
  const context = { line: '16', column: 'Planning: max retirement', value: 12345, authority: 'Form 1040 instructions' };
  await page.evaluate(context => window.TMP.advisor.ask('Explain this line.', context), context);
  assert.equal(bodies.length, 2, 'OpenAI completes one browser tool round');
  assert.match(bodies[0].input[0].content, /Planning: max retirement/);
  assert.deepEqual(bodies[1].input[1], reasoning, 'encrypted reasoning is retained');
  assert.deepEqual(bodies[1].input[2], call, 'original call identifiers are retained');
  const result = bodies[1].input[3];
  assert.equal(result.type, 'function_call_output');
  assert.equal(result.call_id, 'call_mock');
  assert.ok(JSON.parse(result.output).columns.length > 0, 'tool reads real deterministic engine results');
  for (const column of JSON.parse(result.output).columns) {
    for (const field of ['adjustments', 'elections', 'planning', 'sourceX', 'passive']) assert.ok(Object.hasOwn(column, field), 'return tool includes column ' + field);
  }
  assert.match(await page.locator('#advLog').innerText(), /selected column uses the engine/);
  assert.match(await page.locator('#advStatus').innerText(), /OpenAI/);
  assert.equal(await page.evaluate(() => TMP.state.settings.apiKey), '', 'OpenAI does not require a browser key');
  await page.fill('#advInput', 'What about the other column?');
  await page.click('#advSend');
  await page.waitForFunction(() => document.querySelector('#advSend').textContent === 'Ask');
  assert.equal(bodies.length, 3, 'follow-up remains in the same Responses conversation');
  assert.ok(bodies[2].input.some(item => item.role === 'assistant'));
  assert.match(bodies[2].input.at(-1).content, /Planning: max retirement/, 'follow-up retains selected line context');
  console.log('✓ OpenAI auto selection, selected line context, tool execution, reasoning retention, and follow-up');

  const inputs = await page.evaluate(() => {
    const whatIf = Advisor.tools.find(tool => tool.name === 'what_if');
    const setInput = Advisor.tools.find(tool => tool.name === 'set_input');
    const prefix = 'tm.clients.0.';
    const before = JSON.stringify(TMP.state.data);
    const preview = whatIf.run({ changes: [
      { path: prefix + 'cols.0.elections.retirement.plan', value: 'solo401k' },
      { path: prefix + 'cols.0.elections.hsa.mode', value: 'max' },
      { path: prefix + 'cols.0.adjustments.wages', value: -10000 }
    ] });
    const unchanged = before === JSON.stringify(TMP.state.data);
    const errors = [];
    for (const [path, value] of [
      ['cols.0.elections.retirement.plan', 'invalid'], ['cols.0.elections.hsa.amount', -1],
      ['cols.0.elections.ira.covered', 'maybe'], ['cols.0.elections.ira.age', 121],
      ['cols.0.elections.ira.unknown', true], ['cols.0.adjustments.unknown', 20],
      ['cols.99.adjustments.wages', 20], ['cols.0.elections.__proto__.bad', true]
    ]) {
      try { whatIf.run({ changes: [{ path: prefix + path, value }] }); } catch (error) { errors.push(error.message); }
    }
    setInput.run({ path: prefix + 'cols.0.elections.hsa.mode', value: 'max', reason: 'Test restored control.' });
    const changed = TMP.TMV.active().cols[0].elections.hsa.mode === 'max';
    setInput.run({ path: prefix + 'cols.0.elections.hsa.mode', value: null, reason: 'Clear test control.' });
    return { unchanged, changed, cleared: !Object.hasOwn(TMP.TMV.active().cols[0].elections.hsa, 'mode'), errors: errors.length, preview: Object.keys(preview.changed).length };
  });
  assert.equal(inputs.unchanged, true);
  assert.equal(inputs.changed, true);
  assert.equal(inputs.cleared, true);
  assert.equal(inputs.errors, 8);
  assert.ok(inputs.preview > 0);
  console.log('✓ Advisor reads restored controls, previews optional inputs, validates fields, saves and clears elections');

  // The existing explicit Anthropic selection must still use its streamed loop.
  const legacyBodies = [];
  await page.route('https://api.anthropic.com/v1/messages', async route => {
    legacyBodies.push(route.request().postDataJSON());
    const events = legacyBodies.length === 1 ? [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'legacy_call', name: 'get_client_return', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
    ] : [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Legacy advisor connection works.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
    ];
    await route.fulfill({ contentType: 'text/event-stream', body: events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') });
  });
  await page.click('#advClear');
  await page.evaluate(() => { TMP.state.settings.advisorBackend = 'api'; TMP.state.settings.apiKey = 'test-only-anthropic'; return Advisor.ask('Read the client return.'); });
  assert.equal(legacyBodies.length, 2);
  assert.equal(legacyBodies[1].messages[2].content[0].type, 'tool_result');
  assert.ok(JSON.parse(legacyBodies[1].messages[2].content[0].content).columns.length > 0);
  assert.match(await page.locator('#advLog').innerText(), /Legacy advisor connection works/);
  console.log('✓ Explicit Anthropic selection preserves the streamed tool loop');

  const offline = await browser.newPage();
  await offline.route('**/api/ai/chat', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Static app fallback</h1>' }));
  await offline.goto(base + '/planner/index.html', { waitUntil: 'domcontentloaded' });
  await offline.waitForFunction(() => !!window.TMP?.advisor);
  await offline.evaluate(() => Advisor.ask('Explain my return.'));
  assert.match(await offline.locator('#advLog').innerText(), /AI chat is not connected/);
  assert.equal(await offline.evaluate(() => Number.isFinite(TMP.compute().tmw.cols[0].r.f.l24)), true);
  await offline.click('#advClear');
  const local = await offline.evaluate(async () => {
    const context = TMP.TMV.explainLine('l16', 1);
    // ask must refresh the stale supplied amount from the deterministic engine.
    await Advisor.ask('Explain this tax line.', { ...context, value: -123 });
    return { amount: TMP.money(context.value), column: context.column };
  });
  const localText = await offline.locator('#advLog').innerText();
  assert.match(localText, /Local calculation explanation/);
  assert.match(localText, /Calculated locally from the current return/);
  assert.ok(localText.includes(local.amount), 'offline line response uses the current engine amount');
  assert.ok(localText.includes(local.column), 'offline line response identifies the selected planning column');
  assert.match(localText, /Calculation detail/);
  assert.match(localText, /Authority/);
  assert.equal(await offline.locator('#advLog .err').count(), 0, 'line-context fallback is a useful explanation rather than a connection failure');
  assert.deepEqual(errors, []);
  console.log('✓ Offline line context produces a refreshed local calculation explanation; free-form questions show connection guidance');

  const privatePage = await browser.newPage();
  const appToken = 'test-only-private-app-access';
  let privatePosts = 0;
  await privatePage.route('**/api/ai/chat', async route => {
    const authorized = route.request().headers().authorization === 'Bearer ' + appToken;
    if (route.request().method() === 'GET') return route.fulfill({ json: { provider: 'openai', configured: authorized, accessRequired: !authorized, message: authorized ? '' : 'Enter the app access token in Advisor Settings.' } });
    assert.equal(authorized, true);
    privatePosts++;
    assert.equal(route.request().postData().includes(appToken), false, 'app token stays in header only');
    await route.fulfill({ json: { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Private advisor works.' }] }], text: 'Private advisor works.' } });
  });
  await privatePage.goto(base + '/planner/index.html', { waitUntil: 'domcontentloaded' });
  await privatePage.waitForFunction(() => !!window.TMP?.advisor);
  await privatePage.evaluate(() => Advisor.ask('Explain the return.'));
  assert.match(await privatePage.locator('#advLog').innerText(), /app access token/);
  assert.equal(privatePosts, 0);
  await privatePage.evaluate(() => TMP.go('settings'));
  await privatePage.fill('#in-advisor-access', appToken);
  await privatePage.dispatchEvent('#in-advisor-access', 'change');
  await privatePage.evaluate(() => Advisor.ask('Explain the return.'));
  assert.equal(privatePosts, 1);
  assert.match(await privatePage.locator('#advLog').innerText(), /Private advisor works/);
  assert.equal(await privatePage.evaluate(token => JSON.stringify(localStorage).includes(token) || JSON.stringify(TMP.state).includes(token), appToken), false, 'app token stays out of persisted client state');
  await privatePage.reload({ waitUntil: 'domcontentloaded' });
  await privatePage.waitForFunction(() => !!window.TMP?.advisor);
  await privatePage.evaluate(() => Advisor.ask('Explain the return.'));
  assert.equal(privatePosts, 1, 'reload clears the in-memory app token');
  console.log('✓ Hosted advisor requires an app access token; token stays in memory and same-origin authorization headers');

  const racePage = await browser.newPage();
  const raceTrace = [], raceErrors = [];
  racePage.on('pageerror', error => raceErrors.push(error.message));
  let releaseOldCheck, sawOldCheck;
  const heldCheck = new Promise(resolve => { releaseOldCheck = resolve; });
  const oldCheckStarted = new Promise(resolve => { sawOldCheck = resolve; });
  let racePosts = 0;
  await racePage.route('**/api/ai/chat', async route => {
    const authorized = route.request().headers().authorization === 'Bearer ' + appToken;
    raceTrace.push({ method: route.request().method(), authorized });
    if (route.request().method() === 'GET') {
      if (!authorized) { sawOldCheck(); await heldCheck; }
      return route.fulfill({ json: { provider: 'openai', configured: authorized, accessRequired: !authorized, message: authorized ? '' : 'Enter the app access token.' } });
    }
    assert.equal(authorized, true);
    racePosts++;
    await route.fulfill({ json: { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'New token wins the race.' }] }], text: 'New token wins the race.' } });
  });
  await racePage.goto(base + '/planner/index.html', { waitUntil: 'domcontentloaded' });
  await oldCheckStarted;
  await racePage.waitForFunction(() => !!window.TMP?.advisor);
  await racePage.evaluate(() => { window.pendingTokenQuestion = Advisor.ask('Use my private advisor.'); TMP.go('settings'); });
  await racePage.locator('#in-advisor-access').waitFor();
  // Navigation can render again on hashchange while the new token is being
  // entered. Force that ordering instead of depending on browser scheduling.
  await racePage.evaluate(token => {
    const input = document.getElementById('in-advisor-access');
    input.value = token;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    TMP.render();
  }, appToken);
  await racePage.dispatchEvent('#in-advisor-access', 'change');
  releaseOldCheck();
  await racePage.evaluate(() => window.pendingTokenQuestion);
  const raceState = await racePage.evaluate(token => ({
    log: document.querySelector('#advLog').innerText,
    status: document.querySelector('#advStatus').innerText,
    button: document.querySelector('#advSend').textContent,
    inputMatches: document.querySelector('#in-advisor-access')?.value === token
  }), appToken);
  assert.equal(racePosts, 1, 'question awaiting an old configuration check retries with the newly entered token: ' + JSON.stringify({ trace: raceTrace, errors: raceErrors, ...raceState }));
  assert.match(await racePage.locator('#advLog').innerText(), /New token wins the race/);
  console.log('✓ Delayed unauthenticated config cannot override a newly entered access token or its waiting question');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
