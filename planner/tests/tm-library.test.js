/* References must use engine parameters; analysis must describe the selected
   client's current return rather than the separate training workbooks. */
const test = require('node:test');
const assert = require('node:assert/strict');
global.window = globalThis;
const TM = require('../src/tm-modules.js');
global.TM = TM;
require('../src/seed.js');
require('../src/tm-seed.js');
require('../src/tm-sources.js');
const Library = require('../src/tm-library.js');
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => (value < 0 ? '−$' : '$') + Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (value, places = 0) => (value * 100).toFixed(places) + '%';
function setup(index = 0) {
  const clients = TM_DEMO_CLIENTS(SEED).map(clone);
  let active = index, renders = 0;
  const state = { data: { tm: { clients, active: clients[active].id }, w1040: SEED.w1040, rental: SEED.rental, hnwi: SEED.hnwi }, ui: {} };
  const library = Library({ state, esc, money, pct, head: (group, title, lede, right) => '<h1>' + esc(title) + '</h1><p>' + esc(lede) + '</p>' + (right || ''), active: () => clients[active], walk: () => TM.walkClient(clients[active]), render: () => renders++ });
  return { library, clients, state, active: () => clients[active], switch: i => { active = i; }, renders: () => renders };
}
const find = (model, label) => model.rows.find(row => row.label === label);

test('reference amounts and all bracket slices use the selected engine year and filing status', () => {
  for (const year of [2025, 2026]) for (const [status] of TM.STATUSES) {
    const model = Library.referenceModel(TM, year, status), p = TM.params(year, status);
    assert.equal(model.year, year);
    assert.equal(model.status, status);
    assert.deepEqual(model.brackets.map(row => [row.to, row.rate]), p.brackets);
    assert.equal(model.brackets[0].from, 0);
    assert.equal(model.brackets[6].to, Infinity);
    assert.equal(find(model, 'Standard deduction').value, p.std);
    assert.equal(find(model, 'SALT deduction cap').value, p.saltCap);
    assert.equal(find(model, 'QBI taxable-income threshold').value, p.qbiThr);
    assert.equal(find(model, 'HSA family annual contribution limit').value, p.hsaFamily);
    assert.equal(find(model, 'HSA catch-up at age 55+').value, 1000);
    assert.ok(model.rows.every(row => Library.SOURCES[row.authority]), 'Each parameter needs a source link');
    assert.ok(model.rows.every(row => Array.isArray(row.value) ? row.value.every(Number.isFinite) : Number.isFinite(row.value)));
  }
});

test('retirement and IRA references share the planner constants, including 2026 catch-up inflation', () => {
  assert.equal(typeof TM.planningLimits, 'function', 'Expose the planner limits rather than duplicating them in the reference page');
  for (const year of [2025, 2026]) {
    const model = Library.referenceModel(TM, year, 'single'), limits = TM.planningLimits(year);
    assert.equal(model.limitsAvailable, true);
    assert.equal(find(model, '401(k) employee elective-deferral limit').value, limits.deferral);
    assert.equal(find(model, 'IRA catch-up at age 50+').value, limits.iraCatchup);
    assert.deepEqual(find(model, 'IRA deduction phase-out: covered, filing jointly or qualifying surviving spouse').value, limits.coveredJoint);
    limits.coveredJoint[0] = -1;
    assert.notEqual(TM.planningLimits(year).coveredJoint[0], -1, 'Reference consumers cannot mutate engine constants');
  }
  const model = Library.referenceModel(TM, 2026, 'mfs');
  assert.equal(find(model, '401(k) employee elective-deferral limit').value, 24500);
  assert.equal(find(model, 'IRA catch-up at age 50+').value, 1100);
  assert.equal(find(model, 'SALT deduction cap').value, 20200);
});

test('analysis is recomputed from current source records and does not mix client households', () => {
  const setupResult = setup(1), first = setupResult.library.data.analysis(), c = setupResult.active();
  assert.equal(first.client, c.info.name);
  assert.equal(first.totalTax, TM.walkClient(c).cols[0].r.f.l24);
  c.w2[0].wages += 20000;
  const second = setupResult.library.data.analysis();
  assert.equal(second.agi - first.agi, 20000);
  assert.notEqual(second.revision, first.revision);
  assert.ok(second.totalTax > first.totalTax);
  setupResult.switch(0);
  const other = setupResult.library.data.analysis();
  assert.equal(other.client, setupResult.clients[0].info.name);
  assert.notEqual(other.clientId, first.clientId);
  assert.ok(!JSON.stringify(other).includes(first.client), 'Other client data must not be included in the analysis snapshot');
});

test('analysis preserves selected planning column, adjustments, manual totals and source checks', () => {
  const { library, active, state } = setup(0), c = active();
  c.cols[0].adjustments = { wages: 1200 };
  c.cols[0].ov = { qbiDed: 3000 };
  c.cols[0].elections = { hsa: { mode: 'max', coverage: 'family', age: 55 } };
  c.mod.portfolio.dividends.push({ payer: 'Invalid qualified dividends', ordinary: 0, qualified: 1000 });
  state.ui.analysisColumn = 1;
  const model = library.data.analysis(), col = TM.walkClient(c).cols[1];
  assert.equal(model.columnIndex, 1);
  assert.equal(model.totalTax, col.r.f.l24);
  assert.equal(model.agi, col.r.agi);
  assert.equal(model.taxChange, col.r.f.l24 - TM.walkClient(c).cols[0].r.f.l24);
  assert.deepEqual(model.adjustments, [['wages', 1200]]);
  assert.deepEqual(model.overrides, [['qbiDed', 3000]]);
  assert.equal(model.planning.hsa.allowed, col.planning.hsa.allowed);
  assert.ok(model.diagnostics.some(row => /qualified/i.test(row.text)));
  state.ui.analysisColumn = 100;
  assert.equal(library.data.analysis().columnIndex, c.cols.length);
});

test('run analysis passes a fresh current-client snapshot with real local explanation details', () => {
  const { library, active } = setup(1), captured = [];
  global.Advisor = { ask: (question, context) => captured.push({ question, context }) };
  const before = library.data.analysis();
  active().w2[0].wages += 10000;
  assert.equal(library.action('library-run-analysis', { dataset: {} }), true);
  assert.equal(captured.length, 1);
  const { question, context } = captured[0];
  assert.match(question, /current return/);
  assert.equal(context.lineKey, '__return_analysis__');
  assert.equal(context.value, TM.walkClient(active()).cols[0].r.f.l24);
  assert.notEqual(context.revision, before.revision);
  assert.ok(context.details.every(row => Number.isFinite(row.value)));
  assert.equal(context.client, active().info.name);
  assert.equal(library.action('unrelated', {}), false);
  delete global.Advisor;
});

test('reference and analysis selectors change the view without changing client tax facts', () => {
  const { library, state, active, renders } = setup(0), before = clone(active().info);
  assert.equal(library.onChange({ dataset: { libraryReference: 'year' }, value: '2025' }), true);
  assert.equal(library.onChange({ dataset: { libraryReference: 'status' }, value: 'mfs' }), true);
  assert.equal(library.onChange({ dataset: { libraryAnalysisColumn: '' }, value: '1' }), true);
  assert.equal(state.ui.referenceYear, 2025);
  assert.equal(state.ui.referenceStatus, 'mfs');
  assert.equal(state.ui.analysisColumn, 1);
  assert.equal(renders(), 3);
  assert.deepEqual(active().info, before);
  assert.equal(library.onChange({ dataset: {}, value: '' }), false);
});

test('guide documents shared dataflow and training workbook separation; pages safely escape client names', () => {
  const { library, active } = setup(0);
  active().info.name = '<img src=x onerror=alert(1)>';
  const analysis = library.VIEWS['ai-analysis'](), refs = library.VIEWS.references(), guide = library.VIEWS.guide();
  assert.ok(analysis.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.doesNotMatch(analysis, /<img src=x/);
  assert.match(analysis, /Local calculation review/);
  assert.match(analysis, /AI replies describe the snapshot/);
  assert.match(refs, /No upper limit/);
  assert.match(refs, /target="_blank" rel="noopener noreferrer"/);
  assert.match(guide, /do not automatically replace the selected client/);
  for (const route of ['data', 'report', 'connections', 'clients', 'c-client', 'audit']) assert.ok(guide.includes('href="#' + route + '"'));
  assert.ok(Library.FLOW.some(row => row.route === 'home' && /base return and planning columns/.test(row.input)));
});

test('original citation links resolve to primary statutory or regulatory text without trusting relative library URLs', () => {
  assert.equal(Library.sourceUrl({ ref: '/library/irc/title_26/section_1001', title: 'IRC §1001' }), 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section1001&num=0&edition=prelim');
  assert.equal(Library.sourceUrl({ title: 'Treas. Reg. §1.83-2' }), 'https://www.ecfr.gov/current/title-26/section-1.83-2');
  assert.equal(Library.sourceUrl({ ref: 'javascript:alert(1)', title: 'Unlinked source' }), null);
});
