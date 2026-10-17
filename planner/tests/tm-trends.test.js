const test = require('node:test');
const assert = require('node:assert/strict');
const Trends = require('../src/tm-trends.js');
const TM = require('../src/tm-modules.js');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
const helpers = {
  esc: (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  money: (value) => (value < 0 ? '−$' : '$') + Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 }),
  pct: (value, places) => (value * 100).toFixed(places) + '%',
};
const client = () => ({ info: { name: 'Entered household', year: 2026, status: 'single', priorAgi: 80000, priorTax: 10000 },
  w2: [{ employer: 'Entered employer', wages: 100000, fedWh: 20000 }],
  mod: { portfolio: { interest: [{ payer: 'Entered bank', taxable: 2000 }] }, schC: { businesses: [{ name: 'Entered business', gross: 30000, exp: { office: 5000 } }] } },
  cols: [{ id: 'plan', name: 'Plan', year: 2026, status: 'single', adjustments: { wages: -15000 }, ov: {} }] });

test('historical comparisons use entered values and current source edits flow through the live return', () => {
  const c = client(), snapshot = JSON.stringify(c), walk = TM.walkClient(c);
  const model = Trends.data(c, walk);
  assert.equal(model.year, 2026); assert.equal(model.priorYear, 2025);
  near(model.history[0].prior, 80000); near(model.history[0].current, walk.cols[0].r.agi);
  near(model.history[1].prior, 10000); near(model.history[1].current, walk.cols[0].r.f.l24);
  near(model.history[0].delta, walk.cols[0].r.agi - 80000);
  near(model.history[0].percent, (walk.cols[0].r.agi - 80000) / 80000);
  assert.equal(JSON.stringify(c), snapshot);
  c.w2[0].wages += 20000; c.mod.schC.businesses[0].gross += 10000; c.mod.portfolio.interest[0].taxable += 500;
  const revisedWalk = TM.walkClient(c), revised = Trends.data(c, revisedWalk);
  near(revised.history[0].current, revisedWalk.cols[0].r.agi); near(revised.history[1].current, revisedWalk.cols[0].r.f.l24);
  assert.ok(revised.history[0].current > model.history[0].current);
  assert.ok(revised.history[1].current > model.history[1].current);
  near(revised.history[0].prior, 80000); near(revised.history[1].prior, 10000);
  assert.match(Trends(c, revisedWalk, helpers), /historical figures entered in Client information; they are not recalculated here/);
});

test('missing history differs from deliberate zero and has no invented percentage denominator', () => {
  const c = client(); delete c.info.priorAgi; c.info.priorTax = '';
  let model = Trends.data(c, TM.walkClient(c));
  assert.equal(model.missingHistory, true); assert.equal(model.history[0].prior, null); assert.equal(model.history[1].prior, null);
  assert.ok(model.history.every((row) => row.delta === null && row.percent === null));
  assert.match(Trends(c, TM.walkClient(c), helpers), /Enter prior-year AGI/);
  c.info.priorAgi = 0; c.info.priorTax = '0';
  model = Trends.data(c, TM.walkClient(c));
  assert.equal(model.missingHistory, false); near(model.history[0].prior, 0); near(model.history[1].prior, 0);
  assert.ok(model.history.every((row) => row.percent === null));
  near(model.history[0].delta, model.history[0].current);
  assert.match(Trends(c, TM.walkClient(c), helpers), /percentage unavailable when the prior amount is zero or negative/);
  c.info.priorAgi = -5000;
  model = Trends.data(c, TM.walkClient(c));
  assert.equal(model.history[0].percent, null); assert.equal(model.history[0].priorBar.negative, true); assert.ok(model.history[0].priorBar.left < 50);
});

test('each selectable planning metric uses exactly the matching live engine amount', () => {
  const c = client(), walk = TM.walkClient(c);
  const getters = { tax: (r) => r.f.l24, agi: (r) => r.agi, taxable: (r) => r.f.l15, effective: (r) => r.effective, balance: (r) => r.net };
  for (const [metric, getter] of Object.entries(getters)) {
    const model = Trends.data(c, walk, metric);
    assert.equal(model.metric.key, metric);
    model.planning.forEach((row, i) => { near(row.value, getter(walk.cols[i].r)); near(row.delta, getter(walk.cols[i].r) - getter(walk.cols[0].r)); });
    const html = Trends(c, walk, { ...helpers, metric });
    assert.match(html, new RegExp('value="' + metric + '" selected'));
    assert.match(html, /data-trend-metric="1"/);
  }
  assert.equal(Trends.data(c, walk, 'unsupported').metric.key, 'tax');
  const html = Trends(c, walk, { ...helpers, metric: 'effective' });
  assert.match(html, /percentage points vs base/);
  assert.doesNotMatch(html, /\$[\d.,]+ percentage points/);
});

test('refunds and balances keep their signs and negative values extend left from zero', () => {
  const c = client(); c.w2[0].fedWh = 100000; c.cols[0].ov = { wh: 0 };
  const walk = TM.walkClient(c), model = Trends.data(c, walk, 'balance');
  assert.ok(model.planning[0].value > 0); assert.ok(model.planning[1].value < 0);
  assert.equal(model.planning[0].bar.left, 50); assert.ok(model.planning[1].bar.left < 50); assert.equal(model.planning[1].bar.negative, true);
  const html = Trends(c, walk, { ...helpers, metric: 'balance' });
  assert.match(html, /refund/); assert.match(html, /−\$[\d.,]+ · balance due/); assert.match(html, /trend-negative/);
  assert.match(html, /positive values extend right/);
});

test('effective rates are unavailable without positive AGI and remain untruncated above 100%', () => {
  const c = { info: { year: 2026, status: 'single', priorAgi: null, priorTax: null }, w2: [{ wages: 1000 }], other: { otherTax: 1500 }, cols: [] };
  let walk = TM.walkClient(c), model = Trends.data(c, walk, 'effective');
  near(model.planning[0].value, walk.cols[0].r.f.l24 / walk.cols[0].r.agi);
  assert.ok(model.planning[0].value > 1);
  assert.match(Trends(c, walk, { ...helpers, metric: 'effective' }), /150\.0%/);
  c.w2[0].wages = 0;
  walk = TM.walkClient(c); model = Trends.data(c, walk, 'effective');
  assert.equal(model.planning[0].value, null); assert.equal(model.planning[0].bar.width, 0);
  assert.match(Trends(c, walk, { ...helpers, metric: 'effective' }), /positive AGI is needed/);
});

test('chart widths stay bounded for zero, negative, extreme and missing values; stored names are escaped', () => {
  const c = client(); c.cols[0].name = '<script>unsafe</script>'; c.info.priorAgi = -100000;
  const cases = [TM.walkClient(c), { cols: [{ col: { year: 2026, name: 'Extreme' }, r: { agi: Number.MAX_VALUE, f: { l24: -Number.MAX_VALUE } } }] }, { cols: [] }];
  for (const walk of cases) for (const metric of Trends.metrics) {
    const html = Trends(c, walk, { ...helpers, metric: metric.key });
    assert.doesNotMatch(html, /NaN|Infinity|<script>/);
    for (const match of html.matchAll(/style="left:([\d.]+)%;width:([\d.]+)%"/g)) {
      assert.ok(Number(match[1]) >= 0 && Number(match[1]) <= 50); assert.ok(Number(match[2]) >= 0 && Number(match[2]) <= 50);
    }
  }
  assert.match(Trends(c, TM.walkClient(c), helpers), /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.deepEqual(Trends.axis(NaN, 100), { width: 0, left: 50, negative: false, zero: false });
});
