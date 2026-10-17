const test = require('node:test');
const assert = require('node:assert/strict');
const TM = require('../src/tm-modules.js');
const Review = require('../src/tm-review.js');
const copy = (v) => JSON.parse(JSON.stringify(v));
const client = (id = 'one', wages = 80000) => ({
  id, info: { name: id + ' household', year: 2025, status: 'single', tpDob: '1980-03-01', preparer: 'Alex', notes: 'Check election eligibility.' },
  deps: [], w2: [{ employer: 'Example employer', wages, ssWages: wages, fedWh: 10000 }], other: {}, direct: {},
  mod: { portfolio: { interest: [{ payer: 'Bank', taxable: 200 }], dividends: [] }, schC: { businesses: [] }, capital: { invest: [], business: [] }, rents: { properties: [] }, k1: { entities: [] }, itemized: {} },
  cols: [{ id: 'saving', name: 'HSA planning', year: 2025, status: 'single', ov: {}, lv: { hsa: 3000 } }],
});
const get = (o, p) => p.split('.').reduce((v, k) => v == null ? undefined : v[k], o);
function harness(clients) {
  const state = { data: { tm: { clients, active: clients[0].id } }, settings: { firm: 'Example firm' }, ui: {}, audit: [] };
  let renders = 0;
  const api = {
    state, compute: () => ({ tmw: TM.walkClient(clients.find((c) => c.id === state.data.tm.active)) }), invalidate() {}, render() { renders++; },
    applyChange(p, value) { const ks = p.split('.'); let o = state.data; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] || (o[ks[i]] = {}); if (value === undefined) delete o[ks.at(-1)]; else o[ks.at(-1)] = value; state.audit.push({ path: p }); },
    toast() {},
  };
  return { review: Review(api), state, api, renders: () => renders };
}

test('editing an entered W-2 flows through walk, active-client reconciliation and report without a saved amount cache', () => {
  const c = client(), h = harness([c]);
  const initial = h.review.data();
  const before = copy(c);
  assert.equal(initial.rows.find((r) => r.key === 'l1a').values[0], 80000);
  assert.equal(initial.columns[0].r.f.l24, TM.walkClient(c).cols[0].r.f.l24);
  assert.deepEqual(c, before, 'reading a report must not mutate client inputs');
  c.w2[0].wages = 95000;
  const fresh = h.review.data();
  assert.equal(fresh.reconciliation.rows.find((r) => r.key === 'l1a').value, 95000);
  assert.equal(fresh.rows.find((r) => r.key === 'l1a').values[0], 95000);
  assert.equal(fresh.metrics.find((r) => r.label === 'Adjusted gross income').values[0], 95200);
  assert.ok(fresh.columns[0].r.f.l24 > initial.columns[0].r.f.l24);
});

test('prepared return blanks are pending, explicit zero is compared, tolerance is inclusive and values never overwrite sources', () => {
  const c = client(); c.compliance = { tolerance: 1, returnAmounts: { l1a: 79999, l2a: 0, l2b: '', l3a: null, l3b: ' ', l7: 2, l8: false } };
  const original = copy(c), rows = Review.reconcile(c).rows;
  const line = (key) => rows.find((r) => r.key === key);
  assert.equal(line('l1a').status, 'matched');
  assert.equal(line('l1a').delta, 1);
  assert.equal(line('l2a').status, 'matched');
  for (const key of ['l2b', 'l3a', 'l3b', 'l8', 'l24']) { assert.equal(line(key).status, 'pending'); assert.equal(line(key).external, null); assert.equal(line(key).delta, null); }
  assert.equal(line('l7').status, 'difference'); assert.equal(line('l7').delta, -2);
  assert.deepEqual(c, original);
});

test('active clients keep return comparisons, document status, report notes and generation state isolated', () => {
  const first = client('first', 60000), second = client('second', 160000), h = harness([first, second]);
  h.api.applyChange('tm.clients.0.compliance.returnAmounts.l1a', 60000);
  h.api.applyChange('tm.clients.0.compliance.documents.w2.status', 'reviewed');
  h.api.applyChange('tm.clients.0.report.notes', 'First client only');
  h.review.generate();
  assert.equal(h.review.data().reconciliation.matched, 1);
  h.state.data.tm.active = 'second';
  const m = h.review.data();
  assert.equal(m.clientId, 'second'); assert.equal(m.columns[0].r.f.l1a, 160000);
  assert.equal(m.reconciliation.matched, 0); assert.equal(m.generatedAt, null);
  assert.equal(m.documents.find((d) => d.id === 'w2').status, 'pending');
  assert.notEqual(m.notes, 'First client only');
  h.review.action('review-add-document', {});
  assert.equal(second.compliance.customDocuments.length, 1);
  assert.equal(get(first, 'compliance.customDocuments'), undefined);
});

test('report comparisons use the same planning column results and accurately signed base deltas', () => {
  const c = client(), w = TM.walkClient(c), m = Review.data(c, w);
  assert.equal(m.columns.length, 2);
  const tax = m.metrics.find((r) => r.label === 'Total federal tax');
  assert.equal(tax.values[0], w.cols[0].r.f.l24); assert.equal(tax.values[1], w.cols[1].r.f.l24);
  assert.equal(tax.deltas[0], 0); assert.equal(tax.deltas[1], w.cols[1].r.f.l24 - w.cols[0].r.f.l24);
  assert.ok(tax.deltas[1] < 0);
  c.report = { columns: { saving: false } };
  assert.equal(Review.data(c).columns.length, 1);
  assert.equal(Review.data(c).rows.find((r) => r.key === 'l24').values.length, 1);
});

test('a generated report records only provenance, stays current after generation and becomes stale when source or notes change', () => {
  const c = client(), h = harness([c]);
  const generated = h.review.generate();
  assert.equal(generated.stale, false); assert.ok(generated.generatedAt);
  assert.deepEqual(Object.keys(c.report.generated).sort(), ['at', 'fingerprint']);
  const savedTax = generated.columns[0].r.f.l24;
  c.mod.portfolio.interest[0].taxable += 20000;
  const changed = h.review.data();
  assert.equal(changed.stale, true); assert.ok(changed.columns[0].r.f.l24 > savedTax, 'stale report preview still uses current values');
  h.review.generate(); assert.equal(h.review.data().stale, false);
  c.report.recommendations = 'Review the HSA coverage.'; assert.equal(h.review.data().stale, true);
  h.review.generate(); h.state.settings.theme = 'dark'; assert.equal(h.review.data().stale, false, 'appearance does not affect report provenance');
  h.state.settings.firm = 'Changed firm'; assert.equal(h.review.data().stale, true);
});

test('source coverage counts entered rows without treating them as reviewed source documents', () => {
  const c = client(); c.mod.capital.invest.push({ desc: 'Loss sale', proceeds: 0, basis: 20000 });
  const before = copy(c), m = Review.data(c);
  assert.equal(m.coverage.find((r) => r.id === 'capital').count, 1);
  assert.equal(m.documents.find((d) => d.id === 'capital').status, 'pending');
  assert.ok(m.pendingDocuments >= 3);
  assert.deepEqual(c, before);
  c.compliance = { documents: { capital: { status: 'reviewed', note: 'Confirmed against broker statement' } } };
  assert.equal(Review.data(c).documents.find((d) => d.id === 'capital').status, 'reviewed');
});

test('report output escapes taxpayer text and CSV text cannot execute as an Excel formula', () => {
  const c = client(); c.info.name = '=HYPERLINK("https://example.test")'; c.report = { notes: '<img src=x onerror=alert(1)>', recommendations: '<script>danger()</script>' };
  c.cols[0].name = '+SUM(1,1)';
  const h = harness([c]), html = h.review.reportHTML(true), csv = Review.csv(h.review.data());
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;')); assert.ok(html.includes('&lt;script&gt;danger()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img '));
  assert.ok(csv.includes('"\'=HYPERLINK(')); assert.ok(csv.includes('"\'+SUM(1,1)'));
  assert.ok(csv.includes('"Line","Description"'));
});

test('explicitly clearing report notes or identity fields keeps inherited client metadata out of the report', () => {
  const c = client(), h = harness([c]);
  c.info.notes = 'Internal preparer note';
  assert.equal(h.review.data().notes, 'Internal preparer note', 'unset report fields initially inherit client metadata');
  assert.equal(h.review.data().preparer, 'Alex'); assert.equal(h.review.data().firm, 'Example firm');
  h.review.generate();
  h.api.applyChange('tm.clients.0.report.notes', '');
  h.api.applyChange('tm.clients.0.report.preparer', '');
  h.api.applyChange('tm.clients.0.report.firm', '');
  const current = h.review.data();
  assert.equal(current.notes, ''); assert.equal(current.preparer, ''); assert.equal(current.firm, '');
  assert.equal(current.stale, true);
  const html = h.review.reportHTML(true);
  assert.ok(!html.includes('Internal preparer note')); assert.ok(!html.includes('Prepared by Alex')); assert.ok(!html.includes('Example firm'));
  assert.equal(c.info.notes, 'Internal preparer note', 'report editing does not erase internal client notes');
  h.review.generate(); assert.equal(h.review.data().stale, false); assert.equal(h.review.data().notes, '');
});

test('custom document actions audit the current client, and a removed item does not change other checklists', () => {
  const c = client(), h = harness([c]);
  h.review.action('review-add-document', {}); h.review.action('review-add-document', {});
  assert.equal(c.compliance.customDocuments.length, 2);
  h.review.action('review-remove-document', { dataset: { index: '0' } });
  assert.equal(c.compliance.customDocuments.length, 1);
  assert.equal(h.state.audit.length, 3);
  assert.equal(h.review.action('unrelated', {}), false);
  assert.equal(h.review.onChange({ dataset: {} }), false);
});

test('report selection uses imported column IDs as keys, not nested binding paths', () => {
  const c = client(); c.cols[0].id = 'plan.2025'; const h = harness([c]);
  assert.equal(h.review.onChange({ dataset: { reviewColumn: 'plan.2025' }, checked: false }), true);
  assert.equal(c.report.columns['plan.2025'], false); assert.equal(c.report.columns.plan, undefined);
  assert.equal(h.review.data().columns.length, 1);
});

test('reconciliation tolerance rejects invalid negative input and accepts exact matching at zero', () => {
  const c = client(), h = harness([c]); let focused = false;
  h.review.onChange({ dataset: { reviewTolerance: '1' }, value: '-1', focus() { focused = true; } });
  assert.equal(focused, true); assert.equal(get(c, 'compliance.tolerance'), undefined);
  h.review.onChange({ dataset: { reviewTolerance: '1' }, value: '0' });
  c.compliance.returnAmounts = { l1a: 80000.01 };
  assert.equal(Review.reconcile(c).rows.find((r) => r.key === 'l1a').status, 'difference');
});
