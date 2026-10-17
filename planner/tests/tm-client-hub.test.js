const test = require('node:test');
const assert = require('node:assert/strict');
const TM = require('../src/tm-modules.js');
const Hub = require('../src/tm-client-hub.js');

const blank = (options = {}) => Hub.createBlankClient({ name: 'New household', year: 2025, status: 'single', ...options });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);
function assertFinite(value, path = 'return') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is not finite`);
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    // Parameter tables intentionally use Infinity for the final tax bracket.
    // Check calculated amounts and diagnostics, not that open-ended boundary.
    if (key === 'p' && value.f && value.x) continue;
    assertFinite(child, path + '.' + key);
  }
}

test('new clients have secure unique identities and empty independent source modules', () => {
  const first = blank(), second = blank({ existingClients: [first] });
  assert.match(first.id, /^client-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first.id, second.id);
  assert.equal(first.info.clientNumber, 'C0001'); assert.equal(second.info.clientNumber, 'C0002');
  assert.equal(first.info.tpDob, ''); assert.equal(first.info.spDob, '');
  assert.equal(first.info.tpFirst, ''); assert.equal(first.info.address, '');
  assert.deepEqual(first.deps, []); assert.deepEqual(first.w2, []); assert.deepEqual(first.other, {});
  assert.deepEqual(first.mod.portfolio.interest, []); assert.deepEqual(first.mod.portfolio.dividends, []);
  assert.deepEqual(first.mod.capital.invest, []); assert.deepEqual(first.mod.capital.business, []);
  assert.deepEqual(first.mod.schC.businesses, []); assert.deepEqual(first.mod.rents.properties, []); assert.deepEqual(first.mod.k1.entities, []);
  for (const field of ['iso', 'nso', 'rsu', 'restricted', 'sales']) assert.deepEqual(first.mod.equity[field], []);
  assert.deepEqual(first.cols, []); assert.deepEqual(first.direct, {}); assert.deepEqual(first.adjustments, {}); assert.deepEqual(first.elections, {});
  first.mod.portfolio.interest.push({ taxable: 100 });
  assert.deepEqual(second.mod.portfolio.interest, []);
  assert.equal(Hub.nextClientNumber([{ info: { clientNumber: ' c0001 ' } }, { info: { clientNumber: 'C0003' } }]), 'C0002');
});

test('blank returns calculate without nonfinite values for every supported year and filing status', () => {
  for (const year of Hub.supportedYears) for (const [status] of TM.STATUSES) {
    const client = blank({ year, status }), walk = TM.walkClient(client);
    assert.equal(walk.cols.length, 1); assertFinite(walk);
    near(walk.cols[0].r.f.l24, 0); near(walk.cols[0].r.agi, 0); near(walk.cols[0].r.net, 0);
    assert.ok(Object.values(walk.feeds.x).every((value) => value === null || value === 0));
  }
  assert.throws(() => blank({ year: 2027 }), /Only tax years 2025 and 2026/);
  assert.throws(() => blank({ name: '  ' }), /Enter a client name/);
  assert.throws(() => blank({ status: 'unknown' }), /supported filing status/);
});

test('source inputs feed the base, planning columns and recomputed tax after subsequent edits', () => {
  const client = blank();
  client.w2.push({ employer: 'Entered employer', wages: 150000, ssWages: 150000, fedWh: 35000 });
  client.mod.schC.businesses.push({ name: 'Entered practice', gross: 60000, exp: { supplies: 10000 } });
  client.mod.portfolio.interest.push({ payer: 'Entered bank', taxable: 2000, exempt: 500 });
  client.mod.portfolio.dividends.push({ payer: 'Entered fund', ordinary: 3000, qualified: 2000, capGainDist: 4000 });
  client.adjustments.wages = 5000;
  client.cols.push({ id: 'test-plan', name: 'Entered plan', year: 2025, status: 'single', adjustments: { wages: 10000 }, ov: {}, lv: {} });
  const before = JSON.stringify(client), walk = TM.walkClient(client), base = walk.cols[0], plan = walk.cols[1];
  assert.equal(JSON.stringify(client), before);
  near(walk.feeds.x.wages, 150000); near(base.x.wages, 155000); near(plan.x.wages, 165000);
  for (const column of walk.cols) {
    near(column.r.s1.l3, 50000); near(column.r.f.l2b, 2000); near(column.r.f.l2a, 500);
    near(column.r.f.l3b, 3000); near(column.r.f.l3a, 2000); near(column.r.f.l7, 4000); near(column.r.f.l25a, 35000);
    near(column.r.f.l24, TM.computeReturn(column.x, column.ctx).f.l24); assertFinite(column);
  }
  assert.ok(plan.r.f.l24 > base.r.f.l24);
  client.w2[0].wages = 160000; client.mod.schC.businesses[0].gross = 70000; client.mod.portfolio.interest[0].taxable = 2500;
  const revised = TM.walkClient(client);
  near(revised.cols[0].x.wages, 165000); near(revised.cols[1].x.wages, 175000);
  for (const column of revised.cols) { near(column.r.s1.l3, 60000); near(column.r.f.l2b, 2500); }
  assert.ok(revised.cols[0].r.f.l24 > base.r.f.l24);
});

test('new client inputs reach the same report and compliance totals before and after edits', () => {
  const Review = require('../src/tm-review.js');
  const client = blank();
  client.w2.push({ employer: 'Entered employer', wages: 80000, fedWh: 15000 });
  client.mod.schC.businesses.push({ name: 'Entered business', gross: 35000, exp: { office: 5000 } });
  client.mod.portfolio.interest.push({ payer: 'Entered bank', taxable: 1500 });
  client.cols.push({ id: 'client-plan', name: 'Client plan', year: 2026, status: 'single', ov: {}, adjustments: { wages: 10000 } });
  const before = JSON.stringify(client);
  for (let pass = 0; pass < 2; pass++) {
    const walk = TM.walkClient(client), report = Review.data(client), reconciliation = Review.reconcile(client);
    for (const [index, column] of walk.cols.entries()) {
      near(report.columns[index].r.f.l24, column.r.f.l24);
      near(report.rows.find((row) => row.key === 'l1a').values[index], column.r.f.l1a);
      near(report.rows.find((row) => row.key === 'l11').values[index], column.r.agi);
      near(report.rows.find((row) => row.key === 'l24').values[index], column.r.f.l24);
    }
    near(reconciliation.rows.find((row) => row.key === 'l24').value, walk.cols[0].r.f.l24);
    assert.equal(reconciliation.rows.find((row) => row.key === 'l24').status, 'pending');
    if (pass === 0) {
      assert.equal(JSON.stringify(client), before);
      client.w2[0].wages = 95000; client.mod.schC.businesses[0].gross = 45000; client.mod.portfolio.interest[0].taxable = 2500;
    }
  }
});

test('roll-forward defaults to blank sources and preserves prior return, including manual corrections', () => {
  const prior = blank({ name: 'Prior household' });
  prior.info.tpDob = '1980-04-02'; prior.info.tpFirst = 'Entered'; prior.info.address = 'Entered address';
  prior.deps.push({ name: 'Dependent', age: 16, rel: 'child', ssn: true });
  prior.w2.push({ employer: 'Entered employer', wages: 100000, fedWh: 12000 });
  prior.mod.portfolio.interest.push({ payer: 'Bank', taxable: 1000 });
  prior.direct.wages = 105000; prior.adjustments.taxableInt = 500;
  prior.cols.push({ id: 'old-plan', name: 'Old scenario', year: 2026, status: 'single', ov: { wages: 200000 } });
  prior.elections = { hsa: { mode: 'max', coverage: 'self', age: 45 } };
  const snapshot = JSON.stringify(prior), base = TM.walkClient(prior).cols[0].r;
  const next = Hub.rollForwardClient(prior, { existingClients: [prior] });
  assert.equal(JSON.stringify(prior), snapshot); assert.notEqual(next.id, prior.id);
  assert.equal(next.info.year, 2026); assert.equal(next.info.name, 'Prior household');
  near(next.info.priorTax, base.f.l24); near(next.info.priorAgi, base.agi);
  assert.equal(next.info.tpFirst, ''); assert.equal(next.info.tpDob, ''); assert.equal(next.info.address, '');
  assert.deepEqual(next.deps, []); assert.deepEqual(next.w2, []); assert.deepEqual(next.mod.portfolio.interest, []);
  assert.deepEqual(next.direct, {}); assert.deepEqual(next.adjustments, {}); assert.deepEqual(next.elections, {}); assert.deepEqual(next.cols, []);
  assert.equal(next.rollForward.priorClientId, prior.id); assert.equal(next.rollForward.copiedSourceValues, false);
});

test('roll-forward copies only explicit choices into independent records and rejects unsupported next years', () => {
  const prior = blank(); prior.info.tpDob = '1980-02-03'; prior.info.tpFirst = 'Entered';
  prior.w2.push({ employer: 'Entered employer', wages: 100000 }); prior.mod.capital.invest.push({ desc: 'Prior sale', sold: '2025-10-01', proceeds: 5000, basis: 2000, term: 'LT' });
  prior.deps.push({ name: 'Known age', age: 16, rel: 'child' }, { name: 'Age missing', age: '', rel: 'other' });
  const identity = Hub.rollForwardClient(prior, { copyIdentity: true });
  assert.equal(identity.info.tpDob, prior.info.tpDob); assert.equal(identity.deps[0].age, 17); assert.equal(identity.deps[1].age, ''); assert.deepEqual(identity.w2, []);
  const sources = Hub.rollForwardClient(prior, { copySourceValues: true });
  assert.deepEqual(sources.w2, prior.w2); assert.deepEqual(sources.mod.capital.invest, prior.mod.capital.invest);
  assert.equal(sources.info.tpDob, ''); assert.deepEqual(sources.deps, []);
  assert.match(sources.info.notes, /Review every amount, payment, transaction date/);
  sources.w2[0].wages = 200000; sources.mod.capital.invest[0].proceeds = 9000;
  assert.equal(prior.w2[0].wages, 100000); assert.equal(prior.mod.capital.invest[0].proceeds, 5000);
  assert.throws(() => Hub.rollForwardClient(blank({ year: 2026 })), /Only tax years 2025 and 2026/);
  assert.throws(() => Hub.rollForwardClient(prior, { year: 2025 }), /immediately following/);
});

test('audit filters use stable client IDs, mark legacy indices and include global events only by choice', () => {
  const first = blank({ name: 'First' }), second = blank({ name: 'Second' });
  const state = { data: { tm: { clients: [first, second], active: first.id } }, audit: [
    { ts: '2026-10-01', clientId: first.id, clientName: 'First at edit', path: 'tm.clients.0.w2.0.wages', from: 1, to: 2, note: 'Wage correction', by: 'you' },
    { ts: '2026-10-02', clientId: second.id, clientName: 'Second', path: 'tm.clients.1.info.name', from: 'Old', to: 'Second', note: 'Rename', by: 'advisor' },
    { ts: '2026-10-03', path: 'tm.clients.0.mod.portfolio.interest.0.taxable', from: 1, to: 3, note: 'Legacy bank input', by: 'you' },
    { ts: '2026-10-04', path: 'settings.theme', from: 'light', to: 'dark', by: 'you' },
  ] };
  let rows = Hub.auditRows(state);
  assert.deepEqual(rows.map((row) => row.index), [2, 0]);
  assert.equal(rows[0].client.legacy, true); assert.match(rows[0].client.name, /Legacy index 1/);
  assert.equal(rows[1].client.name, 'First at edit');
  assert.deepEqual(Hub.auditRows(state, { includeGlobal: true }).map((row) => row.index), [3, 2, 0]);
  assert.deepEqual(Hub.auditRows(state, { clientId: 'all' }).map((row) => row.index), [2, 1, 0]);
  assert.deepEqual(Hub.auditRows(state, { clientId: 'all', query: 'advisor' }).map((row) => row.index), [1]);
  state.data.tm.clients.reverse();
  rows = Hub.auditRows(state, { query: 'Wage correction' });
  assert.equal(rows.length, 1); assert.equal(rows[0].client.id, first.id);
});

function uiHarness() {
  const existing = blank();
  const state = { data: { tm: { clients: [existing], active: existing.id } }, ui: {}, audit: [] };
  const calls = { saves: 0, renders: 0, route: '', toast: '' };
  const api = { state, esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), money: (v) => '$' + Math.round(v),
    head: (e, title, sub) => '<h1>' + title + '</h1><p>' + sub + '</p>', save: () => calls.saves++, render: () => calls.renders++, invalidate: () => {}, go: (route) => { calls.route = route; }, toast: (text) => { calls.toast = text; }, undo: (index) => { calls.undo = index; } };
  return { state, calls, hub: Hub(api) };
}

test('client creation makes one scoped history entry and legacy delete actions retain all records', () => {
  const { state, calls, hub } = uiHarness();
  hub.action('new-client');
  hub.onChange({ dataset: { hubField: 'name' }, value: 'Entered household', type: 'text' });
  hub.action('hub-create');
  assert.equal(state.data.tm.clients.length, 2); assert.equal(calls.route, 'client');
  assert.equal(state.audit.length, 1); assert.equal(state.audit[0].clientId, state.data.tm.active);
  assert.equal(state.audit[0].clientName, 'Entered household'); assert.equal(state.audit[0].recordYear, 2026); assert.equal(state.audit[0].noUndo, true);
  assert.equal(state.data.tm.clients[1].w2.length, 0);
  for (const action of ['del-client', 'del-client-yes', 'del-client-no']) assert.equal(hub.action(action), true);
  assert.equal(state.data.tm.clients.length, 2);
  assert.match(hub.VIEWS.clients(), /href="#data"/);
});

test('audit view escapes stored text, displays complete object changes and never offers undo for creation', () => {
  const { state, hub } = uiHarness();
  state.audit.push({ ts: '2026-10-01', clientId: state.data.tm.active, clientName: '<script>client</script>', path: 'tm.clients.0.mod.schC.businesses.0.gross', from: { veryLong: 'x'.repeat(200) }, to: '<img src=x onerror=alert(1)>', by: 'advisor', note: '<script>reason</script>', noUndo: true });
  const html = hub.VIEWS.audit();
  assert.ok(html.includes('&lt;script&gt;client&lt;/script&gt;')); assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('x'.repeat(200))); assert.ok(html.includes('AI advisor')); assert.ok(html.includes('not independent audit verification'));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('data-action="hub-undo"'));
});
