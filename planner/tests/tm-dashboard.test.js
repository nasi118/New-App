// Dashboard composition must reconcile to the return and preserve signed loss
// adjustments. Run: node --test planner/tests/tm-dashboard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
global.window = globalThis;
const render = require('../src/tm-dashboard.js');
const TM = require('../src/tm-modules.js');
require('../src/seed.js');
require('../src/tm-seed.js');

const helpers = {
  esc: (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  money: (value) => (value < 0 ? '−$' : '$') + Math.abs(value).toLocaleString('en-US'),
  pct: (value, places) => (value * 100).toFixed(places) + '%',
};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
const compute = (inputs) => TM.computeReturn(Object.assign(TM.blankLeaves(), inputs), { year: 2026, status: 'single' });

function reconciles(result) {
  const model = render.data(result);
  near(model.sources.reduce((sum, source) => sum + source.amount, 0), result.f.l9);
  near(model.positiveIncome + model.lossAdjustments, result.f.l9);
  if (model.positiveIncome > 0) near(model.sources.filter((s) => s.amount > 0).reduce((sum, s) => sum + s.share, 0), 1);
  assert.ok(model.sources.filter((s) => s.amount < 0).every((s) => s.share == null || s.share < 0));
  const html = render(result, helpers);
  assert.doesNotMatch(html, /NaN|Infinity|deductions shield/i);
  for (const match of html.matchAll(/style="width:([\d.]+)%"/g)) assert.ok(+match[1] >= 0 && +match[1] <= 100);
  return { model, html };
}

test('source percentages use positive income before losses, with an explicit denominator', () => {
  const { model, html } = reconciles(compute({ wages: 80000, taxableInt: 20000, schC: -10000 }));
  near(model.positiveIncome, 100000);
  near(model.sources.find((s) => s.label === 'Wages and earned income').share, 0.8);
  near(model.sources.find((s) => s.label === 'Interest and dividends').share, 0.2);
  assert.match(html, /\$100,000<\/strong> of positive income before source losses/);
  assert.match(html, /<table class="income-source-table">/);
  assert.match(html, /<th scope="row">/);
});

test('business and allowed capital losses stay negative and reconcile to line 9', () => {
  const { model, html } = reconciles(compute({ wages: 100000, schC: -30000, stGain: -7000 }));
  near(model.lossAdjustments, -33000); // $3,000 capital-loss limit, not the full $7,000
  near(model.totalIncome, 67000);
  near(model.sources.find((s) => s.label === 'Capital gains or losses').amount, -3000);
  assert.match(html, /source-loss-row/);
  assert.match(html, /[-−]30\.0%/);
  assert.match(html, /Total income · line 9/);
});

test('qualified dividends count once and tax-exempt interest stays outside line 9', () => {
  const { model } = reconciles(compute({ wages: 100000, ordDiv: 10000, qualDiv: 10000, taxExemptInt: 12000 }));
  near(model.positiveIncome, 110000);
  near(model.totalIncome, 110000);
  near(model.sources.find((s) => s.label === 'Interest and dividends').amount, 10000);
});

test('empty and all-loss returns have no percentage denominator', () => {
  const empty = reconciles(compute({}));
  assert.equal(empty.model.sources.length, 0);
  assert.equal(empty.model.taxShare, null);
  assert.match(empty.html, /No income reported on line 9/);
  const losses = reconciles(compute({ schC: -60000 }));
  near(losses.model.totalIncome, -60000);
  assert.equal(losses.model.positiveIncome, 0);
  assert.ok(losses.model.sources.every((s) => s.share === null));
  assert.match(losses.html, /no positive income/);
});

test('tax exceeding income stays above 100% and income less tax stays negative', () => {
  const { model, html } = reconciles(compute({ wages: 1000, otherTax: 1500, wh: 5000 }));
  near(model.tax, 1500); // Withholding changes the balance due, not tax.
  near(model.taxShare, 1.5);
  near(model.incomeLessTax, -500);
  assert.match(html, /150\.0% of total income/);
  assert.match(html, /−\$500/);
});

test('additional return income is retained in the reconciliation', () => {
  const { model } = reconciles({ f: { l1z: 100, l9: 175, l24: 10 }, s1: {} });
  const remaining = model.sources.find((s) => s.label === 'Other Form 1040 income');
  near(remaining.amount, 75);
  near(model.totalIncome, 175);
});

test('every seeded client and planning column reconciles without invalid chart widths', () => {
  const clients = window.TM_DEMO_CLIENTS(JSON.parse(JSON.stringify(window.SEED)));
  for (const client of clients) for (const column of TM.walkClient(client).cols) reconciles(column.r);
});
