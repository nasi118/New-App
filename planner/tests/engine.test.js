const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('../src/seed.js');
const E = require('../src/engine.js');
const SEED = window.SEED;
const clone = (o) => JSON.parse(JSON.stringify(o));
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('expression evaluator', () => {
  const look = (id) => ({ G: 10, K: 2, L: 4, Rate: 0.5 })[id];
  near(E.evalFormula('G*((1+0.1)^2-1)*Rate', look), 1.05);
  near(E.evalFormula('AVERAGE(K:L)', look), 3);
  near(E.evalFormula('MAX(0,G-K*L)', look), 2);
  near(E.evalFormula('-2^2', look), 4); // Excel precedence
  near(E.evalFormula('85%*G', look), 8.5);
  assert.throws(() => E.evalFormula('G*Nope', look), /Unknown name/);
});

test('HNWI matches the workbook cached values', () => {
  const r = E.calcHnwi(clone(SEED.hnwi));
  near(r.byNo[1].benefit, 1581695.3930857093);
  near(r.byNo[3].benefit, 607600.0000000006);
  near(r.byNo[9].benefit, 14318129.645396316);
  near(r.dashboard.total, 97173924.24004178, 0.01);
  near(r.dashboard.min, 11100);
  assert.deepStrictEqual(r.dashboard.risk, { High: 17, Medium: 22, Low: 11 });
  assert.deepStrictEqual(r.dashboard.top.slice(0, 5), [9, 25, 4, 12, 48]);
  near(r.all.cost, 2350500);
  near(r.all.net, 94823424.24004178, 0.01);
  near(r.all.medianRatio, 20.10767497988737, 1e-6);
  assert.strictEqual(r.all.below1, 3);
  assert.strictEqual(r.all.negative, 3);
  near(r.checklist.cost, 1894500);
  near(r.byNo[40].low, SEED.hnwi.strategies[39].K);
});

test('rental: as-built reproduces the negative deduction, corrected floors it', () => {
  const d = clone(SEED.rental);
  const wb = E.calcRental(d, 'workbook');
  near(wb.tot.qbi, -106600);
  near(wb.summary.q20, -21320);
  near(wb.summary.ded, -21320);
  assert.ok(wb.rep.pass);
  assert.ok(wb.agg.pass);
  const c = E.calcRental(d, 'corrected');
  near(c.summary.ded, 0);
  near(c.summary.carry, -106600);
  near(c.election.withElection, -106600);
  near(c.election.repNoElection, -42000); // only Oak has >500 hours
  near(c.election.value, 64600 * 0.35);
});

test('rental: positive QBI path and phase-in', () => {
  const d = clone(SEED.rental);
  d.properties.forEach((p) => { p.rents *= 1.5; });
  const wb = E.calcRental(d, 'workbook');
  assert.ok(wb.tot.qbi > 0);
  near(wb.summary.ded, Math.min(Math.min(wb.tot.qbi * 0.2, Math.max(wb.tot.wages * 0.5, wb.tot.wages * 0.25 + wb.tot.ubia * 0.025)), (750000 - 50000) * 0.2));
  d.taxableIncome = 403500 + 75000;
  const c = E.calcRental(d, 'corrected');
  assert.strictEqual(c.summary.phase, c.summary.wageLimit < c.summary.q20 ? 'phase-in' : 'full');
});

test('1040 as-built ties to hand calculation', () => {
  const d = clone(SEED.w1040);
  const v = E.calc1040(d, 'workbook');
  near(v.c.l31, 35900);
  near(v.se.j, 1189);
  near(v.schE.total, -150 + 4150);
  near(v.s1.l10, 600 + 35900 + 4000 + 400);
  near(v.f.l9, 197000 + 2125 + 3800 + 9500 + 40900);
  near(v.f.l11b, 253325 - (594.5 + 3000 + 1200));
  near(v.a.l12e, 40300);
  near(v.q.l15, Math.min(0.2 * (35900 + 14500), 0.2 * (v.q.l11 - 9500)));
  near(v.f.l19, 500);
  near(v.f.l28, 500);
  near(v.f.l16, 32900);
  near(v.f.l24, v.f.l16 - 500 - 75 + 1189 + 850);
  near(v.f.l33, 29200 + 4000 + 500 + 1500);
});

test('1040 corrected applies each fix', () => {
  const d = clone(SEED.w1040);
  const c = E.calc1040(d, 'corrected');
  near(c.schE.k1, 20500);
  near(c.schE.rows[0].allowed, 0); // condo loss suspended
  near(c.se.g, 52000);
  near(c.se.j, Math.round(Math.min(44400 * 0.9235, 176100 - 52000) * 0.124 + 44400 * 0.9235 * 0.029));
  near(c.f.l19, 2700);
  near(c.f.l28, 0);
  near(c.f.l2b, 2125 + 1470);
  near(c.f.l3a, 2600 + 830);
  near(c.pal.ptpSuspended, 6000);
  const r = E.w1040Findings(d);
  assert.ok(r.findings.length >= 12);
  const tie = E.tieOut(d, r.corrected, r.asBuilt, 1);
  assert.ok(tie.variances > 5);
  const same = E.tieOut(d, r.asBuilt, r.asBuilt, 1);
  assert.strictEqual(same.variances, 0);
});

test('2025 MFJ tax with QD&CG worksheet', () => {
  near(E.tax2025Mfj(96950, 0, 0), 2385 + 8772);
  near(E.tax2025Mfj(198150.5, 2600, 8100), 2385 + 8772 + (187450.5 - 96950) * 0.22 + 10700 * 0.15, 0.01);
  near(E.tax2025Mfj(50000, 0, 10000), E.tax2025Mfj(40000, 0, 0)); // gain in 0% band
});

test('planning: scenarios, projection and safe harbor', () => {
  const d = clone(SEED.w1040);
  const base = E.scenario1040(d, {}, 2025);
  const sep = E.scenario1040(d, { sepIra: 6000 }, 2025);
  near(base.v.s1.l16, 0);
  near(sep.v.s1.l16, 6000);
  assert.ok(sep.v.f.l24 < base.v.f.l24, 'SEP lowers tax');
  assert.ok(base.marginal > 0.2 && base.marginal < 0.3, 'marginal ' + base.marginal);
  assert.ok(base.sepMax > 5000 && base.sepMax < 7000, 'sepMax ' + base.sepMax);
  const h = E.scenario1040(d, { harvest: 20000 }, 2025);
  near(h.v.f.l7a, -3000);
  const p = E.project1040(d, 2026, 0.03);
  near(p.w2[0].wages, Math.round(145000 * 1.03));
  near(p.schA.standard, 32200);
  assert.strictEqual(p.deps[1].ctc, false);
  const proj = E.scenario1040(p, {}, 2026);
  assert.ok(proj.v.f.l24 > 0);
  const sh = E.safeHarbor(37000, 269000, 40000, 30000, 1000);
  near(sh.required, Math.min(37000 * 1.1, 36000));
  near(sh.quarter, (36000 - 30000) / 4);
  near(E.taxMfj(2026, 100800, 0, 0), 2480 + (100800 - 24800) * 0.12);
});

test('compliance calendar', () => {
  const data = clone(SEED); data.calendar = {};
  data.hnwi.strategies[0].selected = true; data.hnwi.strategies[49].selected = true;
  const rental = E.calcRental(data.rental, 'corrected');
  const cal = E.calendar(data, { w1040: { openHigh: 4 }, rental, safeHarbor: { quarter: 1500 } }, '2026-09-28T12:00:00');
  const ids = cal.map((c) => c.id);
  assert.ok(ids.includes('riv-1040') && ids.includes('doe-469') && ids.includes('doe-Form709') && ids.includes('doe-FinCEN114'), ids.join(','));
  const riv = cal.find((c) => c.id === 'riv-1040');
  assert.strictEqual(riv.due, '2026-10-15'); assert.strictEqual(riv.days, 17); assert.strictEqual(riv.state, 'soon');
  assert.strictEqual(cal[0].id, 'riv-1040');
});
