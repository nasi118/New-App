// Tax Master 1040 engine and module tests. Run: node --test planner/tests/tm-engine.test.js
const test = require('node:test');
const assert = require('node:assert');
global.window = globalThis;
require('../src/seed.js');
const E = require('../src/engine.js');
const TM = require('../src/tm-modules.js');
require('../src/tm-seed.js');
const SEED = window.SEED;
const clone = (o) => JSON.parse(JSON.stringify(o));
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const leaves = (o) => Object.assign(TM.blankLeaves(), o);
const clients = () => window.TM_DEMO_CLIENTS(clone(SEED));

test('ordinary and preferential rates by filing status (2025, 2026)', () => {
  // Taxable income at the top of the 12% bracket
  near(TM.computeReturn(leaves({ wages: 96950 + 31500 }), { year: 2025, status: 'mfj' }).f.l16, 2385 + (96950 - 23850) * 0.12);
  near(TM.computeReturn(leaves({ wages: 50400 + 16100 }), { year: 2026, status: 'single' }).f.l16, 1240 + (50400 - 12400) * 0.12);
  // Qualified dividends inside the 0% band are untaxed
  const r = TM.computeReturn(leaves({ ordDiv: 60000, qualDiv: 60000 }), { year: 2025, status: 'mfj' });
  near(r.f.l16, 0);
  // MFS top bracket starts lower than single
  const p = TM.params(2026, 'mfs'); assert.strictEqual(p.br[5], 384350);
});

test('stock-option workbook fixture: corrected AMT and Form 8801 credit', () => {
  const save = TM.YEARS[2026].itemizedCap; TM.YEARS[2026].itemizedCap = false; // the workbook predates the 2/37 limit
  try {
    const eq = TM.calcEquity(clients()[0].mod.equity, 2026);
    near(eq.compIncome, 858000); near(eq.line2i, 900000); near(eq.line2k, -96000); near(eq.st, 120000); near(eq.lt, 512000);
    const x = leaves({ wages: 1758000, taxableInt: 75000, ordDiv: 120000, qualDiv: 120000, ltGain: 350000 + eq.lt, stGain: eq.st, otherItemized: 180000, isoSpread: eq.line2i, otherAmtAdj: eq.line2k, amtGainAdj: eq.line2k });
    const r = TM.computeReturn(x, { year: 2026, status: 'single' });
    near(r.f.l15, 2755000); near(r.f.l16, 808367.25); near(r.amt.amti, 3559000); near(r.amt.tmt, 920750); near(r.amt.amt, 112382.75);
  } finally { TM.YEARS[2026].itemizedCap = save; }
});

test('capital transactions workbook fixture (corrected): recapture, §1231 netting, installment sale', () => {
  const cap = TM.calcCapital(clients()[0].mod.capital, 2026);
  const without = cap.lots.filter((l) => /harvest/.test(l.desc)).reduce((s, l) => s + l.capital, 0);
  near(cap.finalOrdinary, 118000);
  near(cap.net1231, 296000);
  near(cap.lt, 494000); // the workbook shows 499,000 because it ignores land selling expenses
  near(cap.st - without, 0);
  near(cap.unrecap, 100000);
  near(cap.collect28, 14000);
  near(cap.deferred, 184000);
  // Five-year lookback turns §1231 gain into ordinary income
  const m = clone(clients()[0].mod.capital); m.priorNonrecap1231 = 50000;
  const c2 = TM.calcCapital(m, 2026);
  near(c2.finalOrdinary, 168000); near(c2.remaining1231, 246000);
});

test('Rivera household matches the corrected workpaper engine', () => {
  const riv = clients().find((c) => c.id === 'rivera');
  const r = TM.walkClient(riv).cols[0].r;
  const old = E.calc1040(SEED.w1040, 'corrected', { taxSource: 'engine', niitSource: 'engine' });
  near(r.agi, old.f.l11b, 1); near(r.f.l15, old.f.l15, 1); near(r.f.l16, old.f.l16, 1); near(r.f.l13a, old.f.l13a, 1); near(r.f.l24, old.f.l24, 1);
  near(r.s1.l5, old.s1.l5, 1); near(r.se.tax, old.se.j, 1);
});

test('QBI: 20% below the threshold, wage limit above it, SSTB phase-out', () => {
  const p = TM.params(2026, 'mfj');
  near(TM.qbi([{ name: 'A', qbi: 100000, w2: 0, ubia: 0 }], 300000, 0, 0, 0, p).ded, 20000);
  // Fully above: limited to 50% of W-2 wages
  near(TM.qbi([{ name: 'A', qbi: 400000, w2: 60000, ubia: 0 }], 700000, 0, 0, 0, p).ded, 30000);
  // SSTB fully above the range: nothing
  near(TM.qbi([{ name: 'A', qbi: 400000, w2: 500000, ubia: 0, sstb: true }], 700000, 0, 0, 0, p).ded, 0);
  // Losses net against positive QBI; a net loss carries forward
  const q = TM.qbi([{ name: 'A', qbi: 50000 }, { name: 'B', qbi: -80000 }], 200000, 0, 0, 0, p);
  near(q.ded, 0); near(q.carryforward, -30000);
  // 2026 minimum deduction of $400
  near(TM.qbi([{ name: 'A', qbi: 1500, w2: 0, ubia: 0 }], 900000, 0, 0, 0, p).ded, 400);
});

test('SALT cap phases down above the MAGI threshold, never below the floor', () => {
  const base = { stateTax: 60000, realEstateTax: 20000, forceItemize: 1 };
  near(TM.computeReturn(leaves(Object.assign({ wages: 300000 }, base)), { year: 2025, status: 'mfj' }).a.l5e, 40000);
  near(TM.computeReturn(leaves(Object.assign({ wages: 550000 }, base)), { year: 2025, status: 'mfj' }).a.l5e, 25000);
  near(TM.computeReturn(leaves(Object.assign({ wages: 900000 }, base)), { year: 2025, status: 'mfj' }).a.l5e, 10000);
  near(TM.computeReturn(leaves(Object.assign({ wages: 900000 }, base)), { year: 2025, status: 'mfs' }).a.l5e, 5000);
});

test('capital loss limit and carryforward; SE tax uses the owner\'s wages', () => {
  const r = TM.computeReturn(leaves({ wages: 100000, stGain: -10000 }), { year: 2025, status: 'mfs' });
  near(r.f.l7, -1500); near(r.d.carryforward, -8500);
  const se = TM.computeReturn(leaves({ wages: 200000, ssWages: 0, schC: 50000 }), { year: 2025, status: 'mfj' });
  near(se.se.tax, 50000 * 0.9235 * 0.153, 1);
});

test('passive losses: $25,000 allowance phases out between $100,000 and $150,000 of MAGI', () => {
  const rents = TM.calcRents({ rep: false, properties: [{ name: 'Condo', type: 'rental', participation: 'active', gross: 10000, exp: { depreciation: 40000 } }] });
  const k1 = TM.calcK1({ entities: [] });
  near(TM.calcPassive(rents, k1, 90000, 'mfj').totalAllowedLoss, 25000);
  near(TM.calcPassive(rents, k1, 130000, 'mfj').totalAllowedLoss, 10000);
  near(TM.calcPassive(rents, k1, 160000, 'mfj').suspended, 30000);
});

test('planning columns: levers, typed overrides and cleared overrides', () => {
  const doe = clients()[0];
  const w = TM.walkClient(doe);
  assert.strictEqual(w.cols.length, 3);
  // DAF bunching lowers tax; the retirement column adds the SEP contribution
  assert.ok(w.cols[2].r.f.l24 < w.cols[0].r.f.l24);
  near(w.cols[1].x.sepIra - w.cols[0].x.sepIra, 26000);
  // A typed override replaces the module value; null clears it
  doe.direct = { wages: 1000000 };
  near(TM.walkClient(doe).cols[0].r.f.l1a, 1000000);
  doe.direct = { wages: null };
  near(TM.walkClient(doe).cols[0].r.f.l1a, 1758000);
  // A planning column can switch year and status
  doe.cols[0].status = 'mfs'; doe.cols[0].year = 2025;
  const c = TM.walkClient(doe).cols[1];
  assert.strictEqual(c.r.status, 'mfs'); assert.strictEqual(c.r.year, 2025);
});

test('K-1 limits: basis then at-risk; distributions over basis flagged', () => {
  const k = TM.calcK1({ entities: [{ name: 'LP', form: '1065', box1: -50000, basisBegin: 20000, atRisk: 15000 }, { name: 'S', form: '1120-S', box1: 1000, distributions: 9000, basisBegin: 2000 }] });
  near(k.rows[0].ordAllowed, -15000); near(k.rows[0].basisSusp, 30000); near(k.rows[0].riskSusp, 5000);
  near(k.rows[1].excessDist, 6000);
  assert.ok(k.checks.some((c) => c.sev === 'err' && /distributions exceed basis/.test(c.text)));
});

test('safe harbor uses 110% of prior-year tax above $150,000 of AGI', () => {
  const sh = TM.safeHarbor(100000, 200000, 150000, 20000, 30000, 'mfj');
  near(sh.required, 110000); near(sh.fromEst, 90000); near(sh.remaining, 60000);
});
