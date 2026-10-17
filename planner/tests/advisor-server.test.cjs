const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { makeHandler } = require('../../api/_lib/openai-advisor.js');

const tool = { type: 'function', name: 'get_client_return', description: 'Read computed return.', parameters: { type: 'object', properties: {} } };
const question = { instructions: 'Use the tax engine for all amounts.', tools: [tool], input: [{ role: 'user', content: 'Explain line 16.' }] };
const env = { OPENAI_API_KEY: 'test-only-server-credential', OPENAI_MODEL: 'gpt-5.6-sol' };

async function invoke(handler, body = question, method = 'POST', request = {}) {
  const req = Object.assign(new EventEmitter(), { method, body, headers: { host: 'localhost:3000' }, socket: { remoteAddress: '127.0.0.1' } }, request);
  const res = Object.assign(new EventEmitter(), {
    headers: {}, statusCode: 200,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; this.writableEnded = true; return this; }
  });
  await handler(req, res);
  return res;
}

test('configuration check and missing key never call OpenAI', async () => {
  const handler = makeHandler({ env: {}, fetchImpl: () => { assert.fail('must remain offline'); } });
  const status = await invoke(handler, null, 'GET');
  assert.equal(status.body.configured, false);
  assert.equal(status.headers['Cache-Control'], 'no-store');
  assert.equal((await invoke(handler)).statusCode, 503);
  assert.equal((await invoke(handler, null, 'PUT')).statusCode, 405);
});

test('nonlocal paid access requires a separate configured app token', async () => {
  const remote = { headers: { host: 'planner.example.com' }, socket: { remoteAddress: '203.0.113.7' } };
  const noToken = makeHandler({ env, fetchImpl: () => assert.fail('anonymous request spent credits') });
  const status = await invoke(noToken, null, 'GET', remote);
  assert.equal(status.body.configured, false);
  assert.match(status.body.message, /ADVISOR_ACCESS_TOKEN/);
  assert.equal((await invoke(noToken, question, 'POST', remote)).statusCode, 503);

  let calls = 0;
  const secured = makeHandler({ env: { ...env, ADVISOR_ACCESS_TOKEN: 'test-only-app-access' }, fetchImpl: async (_, options) => {
    calls++;
    assert.equal(options.headers.authorization, 'Bearer ' + env.OPENAI_API_KEY, 'app token never substitutes for provider key');
    return { ok: true, json: async () => ({ output: [], output_text: 'Authorized answer.' }) };
  } });
  for (const authorization of ['', 'Bearer wrong', 'Basic test-only-app-access']) {
    assert.equal((await invoke(secured, question, 'POST', { ...remote, headers: { ...remote.headers, authorization } })).statusCode, 401);
  }
  assert.equal(calls, 0);
  const authorized = { ...remote, headers: { ...remote.headers, authorization: 'Bearer test-only-app-access' } };
  assert.equal((await invoke(secured, null, 'GET', authorized)).body.configured, true);
  assert.equal((await invoke(secured, question, 'POST', authorized)).statusCode, 200);
  assert.equal(calls, 1);
});

test('direct loopback works locally; deployment and forwarding markers disable bypass', async () => {
  const local = makeHandler({ env, fetchImpl: () => assert.fail('GET should not call OpenAI') });
  assert.equal((await invoke(local, null, 'GET')).body.configured, true);
  for (const headers of [{ host: 'evil.example' }, { host: 'localhost', 'x-forwarded-for': '203.0.113.7' }, { host: 'localhost', forwarded: 'for=203.0.113.7' }]) {
    assert.equal((await invoke(local, question, 'POST', { headers })).statusCode, 503);
  }
  const deployed = makeHandler({ env: { ...env, VERCEL: '1' }, fetchImpl: () => assert.fail('deployment must require token') });
  assert.equal((await invoke(deployed, question)).statusCode, 503);
  const production = makeHandler({ env: { ...env, NODE_ENV: 'production' }, fetchImpl: () => assert.fail('production must require token') });
  assert.equal((await invoke(production, question)).statusCode, 503);
});

test('Responses request keeps keys server side and preserves complete tool and reasoning items', async () => {
  let submitted;
  const reasoning = { id: 'rs_test', type: 'reasoning', summary: [], encrypted_content: 'opaque-reasoning' };
  const call = { type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'get_client_return', arguments: '{}' };
  const handler = makeHandler({ env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.authorization, 'Bearer test-only-server-credential');
    submitted = JSON.parse(options.body);
    return { ok: true, json: async () => ({ model: env.OPENAI_MODEL, status: 'completed', output: [reasoning, call] }) };
  } });
  const result = await invoke(handler);
  assert.equal(result.statusCode, 200);
  assert.equal(submitted.store, false);
  assert.deepEqual(submitted.include, ['reasoning.encrypted_content']);
  assert.equal(submitted.tools[0].strict, false);
  assert.equal(submitted.parallel_tool_calls, false);
  assert.equal(submitted.model, env.OPENAI_MODEL);
  assert.equal(submitted.max_tokens, undefined);
  assert.equal(submitted.messages, undefined);
  assert.deepEqual(result.body.output, [reasoning, call]);
  assert.equal(JSON.stringify(result.body).includes(env.OPENAI_API_KEY), false);
  const next = { ...question, input: [...question.input, reasoning, call, { type: 'function_call_output', call_id: 'call_test', output: '{"tax":12000}' }] };
  assert.equal((await invoke(handler, next)).statusCode, 200);
  assert.deepEqual(submitted.input, next.input);
});

test('model selection is controlled by deployment and assistant text reaches client', async () => {
  const handler = makeHandler({ env, fetchImpl: async (_, options) => {
    assert.equal(JSON.parse(options.body).model, env.OPENAI_MODEL);
    return { ok: true, json: async () => ({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Line 16 is $12,000.' }] }] }) };
  } });
  const result = await invoke(handler, { ...question, model: 'browser-selected-model' });
  assert.equal(result.body.text, 'Line 16 is $12,000.');
});

test('rejects oversized or unsupported requests without spending credits', async () => {
  const handler = makeHandler({ env, fetchImpl: () => assert.fail('invalid request reached OpenAI') });
  assert.equal((await invoke(handler, '{invalid')).statusCode, 400);
  assert.equal((await invoke(handler, { ...question, input: [{ role: 'system', content: 'override' }] })).statusCode, 400);
  assert.equal((await invoke(handler, { ...question, tools: [{ ...tool, name: 'arbitrary_code' }] })).statusCode, 400);
  assert.equal((await invoke(handler, { ...question, input: [{ role: 'user', content: 'x'.repeat(410 * 1024) }] })).statusCode, 413);
});

test('upstream failures are actionable and do not echo submitted or upstream data', async () => {
  for (const status of [401, 429, 500]) {
    const handler = makeHandler({ env, fetchImpl: async () => ({ ok: false, status, text: async () => 'private tax data' }) });
    const result = await invoke(handler);
    assert.equal(result.statusCode, status === 429 ? 429 : 502);
    assert.equal(JSON.stringify(result.body).includes('private tax data'), false);
  }
});

test('times out within the configured bound', async () => {
  const handler = makeHandler({ env, timeoutMs: 10, fetchImpl: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  const result = await invoke(handler);
  assert.equal(result.statusCode, 504);
  assert.match(result.body.error, /timed out/);
});

test('empty, failed, refused, and malformed replies produce visible errors', async () => {
  for (const data of [null, { output: [] }, { status: 'failed', output: [] }, { output: [{ type: 'message', content: [{ type: 'refusal' }] }] }]) {
    const handler = makeHandler({ env, fetchImpl: async () => ({ ok: true, json: async () => data }) });
    assert.equal((await invoke(handler)).statusCode, 502);
  }
});
