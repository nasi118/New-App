'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, TMSheets } = require('../src/tm-sheets.js');
const ID = 'spreadsheet_test_123';
const copy = (v) => JSON.parse(JSON.stringify(v));
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => copy(body) });
function fixture(options = {}) {
  const state = { data: { marker: 'local', notes: '=IMPORTXML("private")' }, settings: { googleSheets: { clientId: '123-public.apps.googleusercontent.com', spreadsheetId: ID } }, audit: [] };
  const remote = new Map([['Unrelated budget', [['Keep me', 123]]], ['TM_Unrelated', [['Preserve this too']]]]);
  let nextId = 1, clock = 100000, writes = 0, applied = 0, revoked = '', status = 0, deferredRead = null;
  const ids = new Map([...remote.keys()].map((n) => [n, nextId++]));
  const authorization = [];
  const workbook = {
    toWorkbook(s) { return { sheets: [{ name: 'Workbook info', rows: [['Format', 'test']] }, { name: 'Sources', rows: [['Marker', 'Notes'], [s.data.marker, s.data.notes]] }] }; },
    fromWorkbook(m) {
      const rows = (m.sheets.find((s) => s.name === 'Sources') || {}).rows;
      if (!rows || !rows[1] || rows[1][0] === 'invalid') throw new Error('Invalid Tax Master workbook');
      return { state: { data: { marker: rows[1][0], notes: rows[1][1] }, settings: {}, audit: [] }, preview: { clients: [], fields: 2, auditEntries: 0 } };
    }
  };
  const calls = [];
  async function fetch(url, options = {}) {
    calls.push({ url, options });
    if (url === '/api/integrations/google-config') return response({ clientId: options.serverClientId || '' });
    if (status) return response({ error: {} }, status);
    if (url.includes('/drive/v3/about')) return response({ user: { emailAddress: 'planner@example.com' } });
    if (url.includes('includeGridData=true')) {
      if (deferredRead) { const gate = deferredRead; deferredRead = null; gate.started(); await gate.wait; }
      const ranges = new URL(url).searchParams.getAll('ranges');
      return response({ sheets: ranges.map((range) => {
        const title = range.slice(1, -1).replace(/''/g, "'");
        return { properties: { title }, data: [{ rowData: (remote.get(title) || []).map((row) => ({ values: row.map((v) => ({ userEnteredValue: v && typeof v === 'object' && v.googleFormula ? { formulaValue: v.googleFormula } : typeof v === 'number' ? { numberValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: v == null ? '' : String(v) } })) })) }] };
      }) });
    }
    if (url.includes('/values:batchGet')) {
      const ranges = new URL(url).searchParams.getAll('ranges');
      return response({ valueRanges: ranges.map((range) => ({ range, values: remote.get(range.slice(1, -1).replace(/''/g, "'")) || [] })) });
    }
    if (url.endsWith(':batchUpdate')) {
      writes++;
      for (const r of JSON.parse(options.body).requests) {
        if (r.addSheet) { const p = r.addSheet.properties; ids.set(p.title, p.sheetId); remote.set(p.title, []); }
        if (r.updateCells) {
          const name = [...ids.keys()].find((n) => ids.get(n) === r.updateCells.range.sheetId);
          assert.ok(name.startsWith('TM_'));
          remote.set(name, r.updateCells.rows.map((row) => row.values.map((c) => { const v = c.userEnteredValue || {}; return v.stringValue ?? v.numberValue ?? v.boolValue ?? ''; })));
        }
      }
      return response({ replies: [] });
    }
    if (options.method === 'POST' && url.endsWith('/v4/spreadsheets')) { remote.set('TM_Sync', []); ids.set('TM_Sync', nextId++); return response({ spreadsheetId: ID, properties: { title: 'New workbook' } }); }
    if (url.includes('/v4/spreadsheets/')) return response({ spreadsheetId: ID, properties: { title: 'Test workbook' }, sheets: [...ids].map(([title, sheetId]) => ({ properties: { title, sheetId, gridProperties: { rowCount: 100, columnCount: 10 } } })) });
    throw new Error('Unhandled URL: ' + url);
  }
  const app = TMSheets({ state, render() {}, save() {}, async applyImportedState(imported) { applied++; state.data = imported.data; state.settings = imported.settings; state.audit = imported.audit; } }, {
    workbook: options.workbook || workbook, fetch: options.fetch || fetch, now: () => clock,
    authorize: options.authorize || (async (o) => { authorization.push(o); return { access_token: 'secret_oauth_token', expires_in: 3600, scope: Core.SCOPE }; }),
    revoke: async (token) => { revoked = token; },
    pick: async () => ({ id: ID, name: 'Picked file' })
  });
  function pauseNextRead() {
    let release, started;
    const wait = new Promise((resolve) => { release = resolve; }), reached = new Promise((resolve) => { started = resolve; });
    deferredRead = { wait, started };
    return { reached, release };
  }
  return { app, state, remote, calls, authorization, pauseNextRead, setClock: (v) => { clock = v; }, setStatus: (v) => { status = v; }, writes: () => writes, applied: () => applied, revoked: () => revoked };
}

test('Google authorization is per-user, drive.file scoped, and never persisted or exposed', async () => {
  const f = fixture(); await f.app.connect();
  assert.equal(f.app.snapshot().connected, true);
  assert.equal(f.authorization[0].scope, Core.SCOPE);
  assert.equal(f.authorization[0].prompt, 'consent select_account');
  assert.equal(f.state.settings.googleSheets.accountDisplay, 'planner@example.com');
  assert.ok(!JSON.stringify(f.state).includes('secret_oauth_token'));
  assert.ok(!JSON.stringify(f.app.snapshot()).includes('secret_oauth_token'));
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer secret_oauth_token');
  await f.app.disconnect();
  assert.equal(f.revoked(), 'secret_oauth_token');
  assert.equal(f.app.snapshot().connected, false);
  assert.equal(f.state.settings.googleSheets.accountDisplay, undefined);
});

test('push requires a preview and explicit confirmation; preserves unrelated tabs and literal formulas', async () => {
  const f = fixture(); await f.app.connect(); await f.app.confirmPush();
  assert.match(f.app.snapshot().error, /Preview the push/); assert.equal(f.writes(), 0);
  await f.app.preparePush(); assert.equal(f.writes(), 0); assert.equal(f.app.snapshot().pending.type, 'push');
  await f.app.confirmPush();
  assert.equal(f.writes(), 1); assert.equal(f.app.snapshot().error, '');
  assert.deepEqual(f.remote.get('Unrelated budget'), [['Keep me', 123]]);
  assert.deepEqual(f.remote.get('TM_Unrelated'), [['Preserve this too']]);
  assert.equal(f.remote.get('TM_Sources')[1][1], '=IMPORTXML("private")');
  const req = f.calls.find((c) => c.url.endsWith(':batchUpdate'));
  assert.ok(!req.options.body.includes('formulaValue'));
  assert.match(f.app.snapshot().message, /Push verified/);
});

test('pull validates and previews without changing local data, then applies and preserves connection', async () => {
  const f = fixture(); await f.app.connect(); await f.app.preparePush(); await f.app.confirmPush();
  f.remote.get('TM_Sources')[1][0] = 'remote';
  await f.app.preparePull();
  assert.equal(f.state.data.marker, 'local'); assert.equal(f.applied(), 0);
  assert.equal(f.app.snapshot().pending.type, 'pull');
  await f.app.applyPull();
  assert.equal(f.state.data.marker, 'remote'); assert.equal(f.applied(), 1);
  assert.equal(f.state.settings.googleSheets.spreadsheetId, ID);
  assert.ok(f.state.settings.googleSheets.remoteFingerprint);
});

test('changes since last transfer block push until a pull is reviewed', async () => {
  const f = fixture(); await f.app.connect(); await f.app.preparePush(); await f.app.confirmPush();
  f.remote.get('TM_Sources')[1][0] = 'another editor';
  await f.app.preparePush();
  assert.match(f.app.snapshot().error, /Conflict:.*last transfer/); assert.equal(f.writes(), 1);
});

test('edits after push preview stop overwrite', async () => {
  const f = fixture(); await f.app.connect(); await f.app.preparePush(); await f.app.confirmPush(); await f.app.preparePush();
  f.remote.set('TM_Sources', [['Marker', 'Notes'], ['remote', 'edited']]);
  await f.app.confirmPush(); assert.match(f.app.snapshot().error, /Conflict: Google changed/); assert.equal(f.writes(), 1);
});

test('local edits after transfer preview require a new preview', async () => {
  const f = fixture(); await f.app.connect(); await f.app.preparePush(); f.state.data.marker = 'edited';
  await f.app.confirmPush(); assert.match(f.app.snapshot().error, /local workspace changed/); assert.equal(f.writes(), 0);
});

test('local edits during deferred push verification cause zero additional remote writes', async () => {
  const f = fixture(); await f.app.connect(); await f.app.preparePush(); await f.app.confirmPush(); await f.app.preparePush();
  const beforeRemote = copy([...f.remote]), gate = f.pauseNextRead(), transfer = f.app.confirmPush();
  await gate.reached;
  f.state.data.marker = 'new local work during request';
  gate.release(); await transfer;
  assert.match(f.app.snapshot().error, /local workspace changed while Google was being checked/);
  assert.equal(f.writes(), 1); assert.deepEqual([...f.remote], beforeRemote);
  assert.equal(f.state.data.marker, 'new local work during request');
});

test('local edits during deferred pull verification are preserved without applying remote state', async () => {
  const f = fixture(); await f.app.connect(); await f.app.preparePush(); await f.app.confirmPush();
  f.remote.get('TM_Sources')[1][0] = 'remote version'; await f.app.preparePull();
  const gate = f.pauseNextRead(), transfer = f.app.applyPull();
  await gate.reached;
  f.state.data.marker = 'new local work during request';
  gate.release(); await transfer;
  assert.match(f.app.snapshot().error, /local workspace changed while Google was being checked/);
  assert.equal(f.applied(), 0); assert.equal(f.state.data.marker, 'new local work during request');
});

test('remote edits after pull preview stop local replacement', async () => {
  const f = fixture(); await f.app.connect(); await f.app.preparePush(); await f.app.confirmPush(); await f.app.preparePull();
  f.remote.get('TM_Sources')[1][0] = 'new remote';
  await f.app.applyPull(); assert.match(f.app.snapshot().error, /Google changed after the pull preview/); assert.equal(f.applied(), 0);
});

test('invalid imported workbook cannot change the local workspace', async () => {
  const f = fixture(); await f.app.connect(); await f.app.preparePush(); await f.app.confirmPush();
  f.remote.get('TM_Sources')[1][0] = 'invalid';
  await f.app.preparePull(); assert.match(f.app.snapshot().error, /Invalid Tax Master workbook/); assert.equal(f.applied(), 0);
});

test('Google formulas in editable tables are rejected while literal formula-like text survives', async () => {
  const f = fixture(); await f.app.connect(); await f.app.preparePush(); await f.app.confirmPush();
  await f.app.preparePull(); assert.equal(f.app.snapshot().error, '');
  f.remote.get('TM_Sources')[1][0] = { googleFormula: '=1+1' };
  await f.app.preparePull();
  assert.match(f.app.snapshot().error, /formulas in editable tables.*TM_Sources/);
  assert.equal(f.applied(), 0); assert.equal(f.state.data.marker, 'local');
});

test('missing OAuth client configuration is actionable', async () => {
  const f = fixture(); f.state.settings.googleSheets.clientId = '';
  await f.app.connect(); assert.match(f.app.snapshot().error, /not configured.*GOOGLE_CLIENT_ID/); assert.equal(f.app.snapshot().connected, false);
});

test('OAuth cancellation leaves data unchanged', async () => {
  const f = fixture({ authorize: async () => { throw new Error('Google sign-in was canceled.'); } });
  await f.app.connect(); assert.match(f.app.snapshot().error, /canceled/); assert.equal(f.state.data.marker, 'local');
});

test('expired and revoked authorization require reconnect', async () => {
  const f = fixture(); await f.app.connect(); f.setClock(99999999); await f.app.preparePush();
  assert.match(f.app.snapshot().error, /expired|disconnected/); assert.equal(f.app.snapshot().connected, false);
  const g = fixture(); await g.app.connect(); g.setStatus(401); await g.app.preparePush();
  assert.match(g.app.snapshot().error, /revoked/); assert.equal(g.app.snapshot().connected, false);
});

test('missing file permissions and offline failures are explicit', async () => {
  const f = fixture(); await f.app.connect(); f.setStatus(403); await f.app.preparePull();
  assert.match(f.app.snapshot().error, /cannot access.*Google Picker/);
  const g = fixture({ fetch: async () => { throw new Error('offline'); } }); await g.app.connect(); await g.app.preparePush();
  assert.match(g.app.snapshot().error, /could not be reached/);
});

test('create makes an empty destination; selecting existing requires Picker configuration', async () => {
  const f = fixture(); await f.app.connect(); await f.app.create();
  assert.equal(f.state.settings.googleSheets.spreadsheetId, ID); assert.equal(f.writes(), 0);
  assert.match(f.app.snapshot().message, /empty spreadsheet/);
  await f.app.choose(); assert.match(f.app.snapshot().error, /public browser API key/);
  f.state.settings.googleSheets.pickerKey = 'public_picker_key'; await f.app.choose();
  assert.match(f.app.snapshot().message, /selected/);
});

test('checksums tolerate omitted empty Google cells and reject nonmanaged writes', () => {
  assert.equal(Core.fingerprint({ sheets: [{ name: 'x', rows: [[1, '', null], []] }] }), Core.fingerprint({ sheets: [{ name: 'x', rows: [[1]] }] }));
  assert.throws(() => Core.updateRequests({ sheets: [{ name: 'Other budget', rows: [[1]] }] }, []), /Only known/);
  assert.equal(Core.spreadsheetId('https://docs.google.com/spreadsheets/d/' + ID + '/edit'), ID);
  assert.throws(() => Core.spreadsheetId('bad id'), /valid Google/);
});

test('real shared Excel model round-trips all client and scenario fields through Google cell transport', async () => {
  const workbook = require('../src/tm-excel.js'), f = fixture({ workbook });
  const client = require('../src/tm-client-hub.js').createBlankClient({ name: 'Client one', year: 2025, status: 'single' });
  client.id = 'client-1'; client.w2.push({ wages: 125000 }); client.mod.k1.entities.push({ name: 'Partnership', ordinary: 12345 });
  client.cols.push({ name: '2026 plan', year: 2026, adjustments: { wages: 2500 }, elections: { hsa: { mode: 'max' } } });
  client.notes.retirement = 'Review retirement'; client.info.priorTax = 23000;
  f.state.data.tm = { active: client.id, clients: [client] };
  f.state.audit = [{ ts: '2026-10-17T10:00:00.000Z', path: 'tm.clients.0.info.name', from: 'Old', to: 'Client one', by: 'you' }];
  f.state.settings.apiKey = 'never_send_this_credential';
  const expected = workbook.cleanState(f.state);
  await f.app.connect(); await f.app.preparePush(); await f.app.confirmPush();
  assert.equal(f.app.snapshot().error, '');
  assert.ok(!JSON.stringify([...f.remote]).includes('never_send_this_credential'));
  assert.ok(!JSON.stringify([...f.remote]).includes('secret_oauth_token'));
  assert.ok(!JSON.stringify([...f.remote]).includes('googleSheets'));
  f.state.data.tm.clients[0].w2[0].wages = 1;
  await f.app.preparePull(); assert.equal(f.app.snapshot().error, ''); await f.app.applyPull();
  assert.equal(f.app.snapshot().error, '');
  assert.deepEqual(f.state.data, expected.data);
  assert.deepEqual(f.state.audit, expected.audit);
  assert.equal(f.state.data.tm.clients[0].cols[0].elections.hsa.mode, 'max');
});

test('server config exposes only public OAuth ID and rejects other methods', () => {
  const handler = require('../../api/integrations/google-config.js'), old = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = '123-public.apps.googleusercontent.com';
  try {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(v) { this.code = v; return this; }, json(v) { this.body = v; return this; } };
    handler({ method: 'GET' }, res); assert.deepEqual(res.body, { clientId: '123-public.apps.googleusercontent.com' }); assert.equal(res.headers['Cache-Control'], 'no-store');
    process.env.GOOGLE_CLIENT_ID = 'a-secret-is-not-a-public-client-id'; handler({ method: 'GET' }, res); assert.deepEqual(res.body, { clientId: '' });
    handler({ method: 'POST' }, res); assert.equal(res.code, 405);
  } finally { if (old === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = old; }
});
