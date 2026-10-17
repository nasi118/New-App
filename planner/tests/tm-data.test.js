const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {} };
for (const name of ['seed', 'engine', 'tm-seed']) vm.runInNewContext(fs.readFileSync(require.resolve('../src/' + name + '.js'), 'utf8'), context);
global.TM = require('../src/tm-modules.js');
global.Engine = context.window.Engine;
global.TMExcel = require('../src/tm-excel.js');
const DataUI = require('../src/tm-data.js');
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture() {
  const data = clone(context.window.SEED);
  data.tm = { clients: clone(context.window.TM_DEMO_CLIENTS(context.window.SEED)), active: 'doe' };
  data.w1040.planning = { year: 2026, growth: 0, paid2026: 0, scenarios: [{ name: 'Base', levers: {} }] };
  return { data, settings: { mode: 'corrected', taxSource: 'software', niitSource: 'input', tolerance: 1, rentalThreshold: 403500, rentalPhaseRange: 150000, rentalMarginal: .35, apiKey: 'current-private-key', rememberKey: false }, audit: [], ui: {} };
}
test('client import updates matching records and retains other clients and shared workbooks', () => {
  const current = fixture(), incoming = clone(current), before = clone(current);
  incoming.data.tm.clients = [incoming.data.tm.clients[0]];
  incoming.data.tm.clients[0].w2[0].wages += 10000;
  const newClient = clone(incoming.data.tm.clients[0]); newClient.id = 'new-imported'; newClient.info.name = 'New imported client'; incoming.data.tm.clients.push(newClient);
  incoming.data.rental.name = 'Other workbook';
  const next = DataUI.mergeState(current, incoming, 'merge');
  assert.equal(next.data.tm.clients.length, 3);
  assert.equal(next.data.tm.clients.find((client) => client.id === 'doe').w2[0].wages, before.data.tm.clients[0].w2[0].wages + 10000);
  assert.deepEqual(next.data.tm.clients.find((client) => client.id === 'rivera'), before.data.tm.clients[1]);
  assert.deepEqual(next.data.rental, current.data.rental);
  assert.deepEqual(current, before);
});
test('stable client identity preserves history after incoming arrays compact and destination indices differ', () => {
  const current = fixture(), incoming = fixture();
  current.data.tm.clients.unshift({ ...clone(current.data.tm.clients[0]), id: 'other' });
  incoming.data.tm.clients = [incoming.data.tm.clients[1]]; incoming.data.tm.active = 'rivera';
  incoming.audit = [{ ts: '2026-10-17', by: 'you', path: 'tm.clients.1.w2.0.wages', clientId: 'rivera', from: 1, to: 2 }, { ts: '2026-10-16', path: 'archive:tm.clients.0.info.name', unresolvedClient: true, from: 'Former', to: 'Earlier' }];
  const next = DataUI.mergeState(current, incoming, 'merge');
  assert.equal(next.audit.length, 2);
  assert.equal(next.audit[0].path, 'tm.clients.2.w2.0.wages');
  assert.equal(next.audit[0].clientId, 'rivera');
  assert.ok(next.audit.every((entry) => entry.noUndo && entry.imported));
  assert.equal(next.audit[1].unresolvedClient, true);
});
test('reimporting current history does not duplicate events and imported records are display-only', () => {
  const current = fixture(); current.audit.push({ ts: '2026-10-17', by: 'you', path: 'tm.clients.0.info.name', from: 'Old', to: 'New' });
  const incoming = clone(current); incoming.audit.push({ ts: '2026-10-18', by: 'you', path: 'tm.clients.0.info.name', from: 'New', to: 'Latest' });
  const first = DataUI.mergeState(current, incoming, 'merge'), second = DataUI.mergeState(first, incoming, 'merge');
  assert.equal(first.audit.length, 2); assert.equal(second.audit.length, 2);
  assert.equal(first.audit[0].noUndo, undefined); assert.equal(first.audit[1].noUndo, true);
});
test('workspace restore keeps the current private key, not an imported credential', () => {
  const current = fixture(), incoming = fixture(); incoming.settings.apiKey = 'untrusted-imported-key'; incoming.audit = [{ path: 'tm.clients.0.info.name', from: 'Previous', to: 'Restored' }];
  const restored = DataUI.mergeState(current, incoming, 'replace');
  assert.equal(restored.settings.apiKey, 'current-private-key');
  assert.ok(restored.audit[0].noUndo && restored.audit[0].imported);
});
test('import preview and failed calculations leave the whole workspace unchanged', () => {
  const state = fixture(), before = clone(state); let saved = 0;
  const api = { state, esc: String, money: String, head: String, render() {}, toast() {}, save() { saved++; }, invalidate() {}, go() {}, active: () => state.data.tm.clients[0], compute() { throw new Error('Compatibility check failed'); } };
  const ui = DataUI(api), incoming = { data: clone(state.data), settings: clone(state.settings), audit: [] };
  incoming.data.tm.clients[0].w2[0].wages += 1000;
  ui.prepare(incoming, 'test.xlsx'); assert.deepEqual(state, before);
  assert.throws(() => ui.applyImportedState(incoming, { source: 'test.xlsx' }), /Compatibility check failed/);
  assert.deepEqual({ data: state.data, settings: state.settings, audit: state.audit }, { data: before.data, settings: before.settings, audit: before.audit });
  assert.equal(saved, 0);
  incoming.data.tm.clients[0].mod.portfolio.interest = { invalid: true };
  assert.throws(() => ui.prepare(incoming, 'bad.xlsx'));
  assert.deepEqual(state.data, before.data);
});
test('a storage failure rolls back imported clients, settings and history', () => {
  const state = fixture(), before = clone(state);
  const api = { state, esc: String, money: String, head: String, render() {}, toast() {}, save: () => false, invalidate() {}, go() {}, active: () => state.data.tm.clients[0], compute() {} };
  const ui = DataUI(api), incoming = { data: clone(state.data), settings: clone(state.settings), audit: [] };
  incoming.data.tm.clients[0].w2[0].wages += 1000;
  assert.throws(() => ui.applyImportedState(incoming, { source: 'test.xlsx' }), /could not save/);
  assert.deepEqual({ data: state.data, settings: state.settings, audit: state.audit }, { data: before.data, settings: before.settings, audit: before.audit });
});
