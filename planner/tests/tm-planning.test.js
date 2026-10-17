const test = require('node:test');
const assert = require('node:assert/strict');
const TM = require('../src/tm-modules.js');
const leaves = (x) => Object.assign(TM.blankLeaves(), x);
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);
const client = (elections = {}) => ({ info: { year: 2025, status: 'single', tpDob: '1980-04-15' }, direct: { wages: 60000, schC: 100000 }, elections, cols: [{ id: 'plan', name: 'Plan', year: 2026, status: 'single', ov: {} }] });

test('absent elections preserve all leaf values and legacy levers exactly', () => {
  const c = client(); c.cols[0].lv = { sepIra: 8000 };
  const w = TM.walkClient(c);
  for (const column of w.cols) {
    let expected = Object.assign({}, w.feeds.x, c.direct);
    if (column.col.lv) expected = TM.applyLevers(expected, column.col.lv);
    assert.deepEqual(column.x, expected);
    assert.equal(column.r.f.l24, TM.computeReturn(expected, column.ctx).f.l24);
    assert.equal(column.planning.retirement.configured, false);
  }
});

test('retirement elections recalculate per column year and preserve input objects', () => {
  const c = client({ retirement: { plan: 'solo401k', age: 62 } });
  const before = JSON.stringify(c), w = TM.walkClient(c);
  assert.equal(JSON.stringify(c), before);
  const b = w.cols[0], p = w.cols[1];
  near(b.planning.retirement.base, 100000 - b.r.se.ded);
  near(b.x.sepIra, 23500 + 11250 + b.planning.retirement.base * 0.2);
  near(p.x.sepIra, 24500 + 11250 + p.planning.retirement.base * 0.2);
  assert.equal(p.planning.retirement.options.length, 6);
  c.cols[0].elections = { retirement: { plan: 'sep' } };
  const changed = TM.walkClient(c);
  assert.equal(changed.cols[1].planning.retirement.plan, 'sep');
  assert.equal(changed.cols[1].planning.retirement.age, 62);
  near(changed.cols[0].x.sepIra, b.x.sepIra);
});

test('employer-only plans respect annual additions, and all plans floor net losses at zero', () => {
  for (const plan of ['sep', 'profitshare', 'solo401k', 'simple3', 'simple2']) {
    const c = { elections: { retirement: { plan, age: 62 } } };
    const rich = TM.inlinePlanning(c, {}, leaves({ schC: 1000000 }), { year: 2026, status: 'single' });
    assert.ok(rich.x.sepIra <= (plan === 'solo401k' ? 83250 : 72000));
    if (plan === 'sep' || plan === 'profitshare') near(rich.x.sepIra, 72000);
    const loss = TM.inlinePlanning(c, {}, leaves({ schC: -10000 }), { year: 2026, status: 'single' });
    near(loss.x.sepIra, 0);
    for (const o of loss.details.retirement.options) {
      near(o.total, 0); assert.ok(o.employee >= 0 && o.employer >= 0 && o.catchup >= 0);
    }
  }
});

test('retirement deferral zero is intentional; SIMPLE nonelective contribution still applies', () => {
  const input = leaves({ schC: 100000 });
  for (const plan of ['solo401k', 'simple3', 'simple2']) {
    const o = TM.inlinePlanning({ elections: { retirement: { plan, age: 62, deferral: 0 } } }, {}, input, { year: 2025, status: 'single' });
    near(o.details.retirement.employee, 0); near(o.details.retirement.catchup, 0);
    if (plan === 'simple3') near(o.x.sepIra, 0);
    if (plan === 'simple2') near(o.x.sepIra, o.details.retirement.base * 0.02);
  }
});

test('HSA mode, catch-up, employer contributions and manual limits are applied per column', () => {
  const c = { elections: { hsa: { mode: 'max', coverage: 'family', age: 55, employerContributions: 2000 } } };
  const ctx = { year: 2026, status: 'mfj' };
  const max = TM.inlinePlanning(c, {}, leaves({ hsa: 200 }), ctx);
  near(max.x.hsa, 7750); near(max.details.hsa.limit, 9750);
  const capped = TM.inlinePlanning(c, { elections: { hsa: { mode: 'manual', amount: 9000 } } }, leaves({ hsa: 200 }), ctx);
  near(capped.x.hsa, 7750); near(capped.details.hsa.excess, 1250);
  near(TM.inlinePlanning(c, { elections: { hsa: { mode: 'off' } } }, leaves({ hsa: 200 }), ctx).x.hsa, 0);
  near(TM.inlinePlanning(c, { elections: { hsa: { mode: 'manual', amount: -100 } } }, leaves(), ctx).x.hsa, 0);
});

test('IRA workplace-plan phaseout endpoints, rounding and minimum deduction', () => {
  const c = { elections: { ira: { mode: 'deductible', covered: true, amount: 7000 } } };
  const run = (wages) => TM.inlinePlanning(c, {}, leaves({ wages }), { year: 2025, status: 'single' });
  near(run(79000).x.iraDed, 7000);
  near(run(84000).x.iraDed, 3500);
  near(run(84001).x.iraDed, 3500);
  near(run(88999).x.iraDed, 200);
  near(run(89000).x.iraDed, 0);
  near(run(89000).details.ira.nondeductible, 7000);
});

test('IRA contribution limits depend on compensation independently of MAGI phaseout', () => {
  const c = { elections: { ira: { mode: 'deductible', covered: true, amount: 7000 } } };
  const r = TM.inlinePlanning(c, {}, leaves({ wages: 1000, taxableInt: 83000 }), { year: 2025, status: 'single' });
  near(r.x.iraDed, 1000); near(r.details.ira.excess, 6000);
  const loss = TM.inlinePlanning(c, {}, leaves({ wages: 3000, schC: -10000 }), { year: 2025, status: 'single' });
  near(loss.details.ira.compensation, 3000); near(loss.x.iraDed, 3000);
  const noCompensation = TM.inlinePlanning(c, {}, leaves({ taxableInt: 60000 }), { year: 2025, status: 'single' });
  near(noCompensation.x.iraDed, 0);
});

test('IRA spouse coverage, year catch-up, deliberate nondeductible mode and overrides', () => {
  const c = { elections: { ira: { mode: 'deductible', covered: false, spouseCovered: true, age: 50 } } };
  const phased = TM.inlinePlanning(c, {}, leaves({ wages: 247000 }), { year: 2026, status: 'mfj' });
  near(phased.details.ira.limit, 8600); near(phased.x.iraDed, 4300);
  const nondeductible = TM.inlinePlanning(c, { elections: { ira: { mode: 'nondeductible', amount: 8000 } } }, leaves({ wages: 247000 }), { year: 2026, status: 'mfj' });
  near(nondeductible.x.iraDed, 0); near(nondeductible.details.ira.nondeductible, 8000);
  const zero = TM.inlinePlanning(c, { elections: { ira: { amount: 0 } } }, leaves({ wages: 100000 }), { year: 2026, status: 'mfj' });
  near(zero.x.iraDed, 0);
});

test('typed leaf overrides take priority and feed dependent IRA calculations', () => {
  const c = client({ retirement: { plan: 'sep' }, hsa: { mode: 'max' }, ira: { mode: 'deductible', covered: false } });
  c.cols[0].ov = { schC: 10000, wages: 0, sepIra: 9000, hsa: 1000, iraDed: 123 };
  const w = TM.walkClient(c), p = w.cols[1];
  near(p.x.sepIra, 9000); near(p.x.hsa, 1000); near(p.x.iraDed, 123);
  near(p.planning.ira.compensation, 10000 - p.r.se.ded - 9000);
  assert.ok(w.cols[0].x.sepIra > p.x.sepIra);
});

test('typed totals store a fixed correction that survives module source edits', () => {
  const c = { info: { year: 2025, status: 'single' }, w2: [{ wages: 50000 }], adjustments: { wages: 2000, taxableInt: null }, cols: [{ id: 'plan', year: 2025, status: 'single', adjustments: { wages: 3000 }, ov: {} }] };
  let w = TM.walkClient(c);
  near(w.cols[0].sourceX.wages, 50000); near(w.cols[0].x.wages, 52000);
  near(w.cols[1].sourceX.wages, 52000); near(w.cols[1].x.wages, 55000);
  c.w2[0].wages = 60000;
  w = TM.walkClient(c);
  near(w.cols[0].sourceX.wages, 60000); near(w.cols[0].x.wages, 62000);
  near(w.cols[1].sourceX.wages, 62000); near(w.cols[1].x.wages, 65000);
  near(w.feeds.x.wages, 60000); near(w.baseX.wages, 62000);
  assert.deepEqual(c.adjustments, { wages: 2000, taxableInt: null });
});

test('adjusted business income drives retirement and deduction corrections are added exactly once', () => {
  const c = { info: { year: 2025, status: 'single' }, mod: { schC: { businesses: [{ name: 'Practice', gross: 100000 }] } }, elections: { retirement: { plan: 'sep' }, hsa: { mode: 'max' }, ira: { mode: 'deductible', covered: false } }, adjustments: { schC: 10000, sepIra: -1000, hsa: -300 }, cols: [{ id: 'plan', year: 2025, status: 'single', adjustments: { schC: 20000, sepIra: 500, hsa: 100, iraDed: -100 }, ov: {} }] };
  const w = TM.walkClient(c), [base, plan] = w.cols;
  near(base.x.schC, 110000); near(plan.x.schC, 130000);
  near(base.planning.retirement.base, 110000 - base.r.se.ded);
  near(plan.planning.retirement.base, 130000 - plan.r.se.ded);
  near(base.sourceX.sepIra, base.planning.retirement.base * 0.2);
  near(base.x.sepIra, base.sourceX.sepIra - 1000);
  near(plan.sourceX.sepIra, plan.planning.retirement.base * 0.2 - 1000);
  near(plan.x.sepIra, plan.sourceX.sepIra + 500);
  near(base.x.hsa, 4000); near(plan.sourceX.hsa, 4000); near(plan.x.hsa, 4100);
  for (const column of w.cols) {
    const correction = column.col.base ? c.adjustments : c.cols[0].adjustments;
    for (const [key] of TM.LEAVES) {
      if (column.x[key] === null) continue;
      near(column.x[key], TM.n(column.sourceX[key]) + TM.n(correction[key]));
    }
    near(column.planning.ira.magi, column.r.agi + column.x.iraDed + column.x.studentLoan);
  }
});

test('legacy exact overrides outrank corrections and elections until cleared', () => {
  const c = { info: { year: 2025, status: 'single' }, w2: [{ wages: 50000 }], direct: { wages: 75000, hsa: 1234 }, elections: { hsa: { mode: 'max' } }, adjustments: { wages: 2000, hsa: 100 }, cols: [{ id: 'plan', year: 2025, status: 'single', adjustments: { wages: 3000, hsa: 200 }, ov: { wages: 90000, hsa: 2345 } }] };
  let w = TM.walkClient(c);
  near(w.cols[0].x.wages, 75000); near(w.cols[0].x.hsa, 1234);
  near(w.cols[1].x.wages, 90000); near(w.cols[1].x.hsa, 2345);
  c.direct = {}; c.cols[0].ov = {};
  w = TM.walkClient(c);
  near(w.cols[0].x.wages, 52000); near(w.cols[0].x.hsa, 4400);
  near(w.cols[1].x.wages, 55000); near(w.cols[1].x.hsa, 4600);
});

const rentalClient = () => ({ info: { year: 2025, status: 'single', tpDob: '1980-01-01' }, w2: [{ wages: 110000 }], mod: { rents: { properties: [{ name: 'Rental', type: 'rental', participation: 'active', gross: 0, exp: { depreciation: 25000 } }] } }, cols: [] });

test('elected HSA and the same source deduction produce identical passive losses and tax', () => {
  const manual = rentalClient(), elected = rentalClient();
  manual.other = { hsa: 4300 };
  elected.elections = { hsa: { mode: 'max', coverage: 'self', age: 45 } };
  const m = TM.walkClient(manual).cols[0], e = TM.walkClient(elected).cols[0];
  near(m.x.schE, -22150); near(m.r.agi, 83550); near(m.r.f.l24, 9830);
  assert.deepEqual(e.x, m.x);
  assert.deepEqual(e.r.f, m.r.f);
  near(e.passive.magi, 105700);
  near(e.sourceX.schE, -22150);
});

test('each column recomputes passive allowances after retirement and income changes', () => {
  const c = rentalClient(); c.w2[0].wages = 100000;
  c.mod.schC = { businesses: [{ name: 'Practice', gross: 40000 }] };
  c.cols = [
    { id: 'retire', year: 2025, status: 'single', elections: { retirement: { plan: 'sep' } } },
    { id: 'higher-income', year: 2025, status: 'single', elections: { retirement: { plan: 'sep' } }, adjustments: { wages: 30000 } },
  ];
  const [base, retirement, higher] = TM.walkClient(c).cols;
  near(base.passive.magi, 140000); near(base.x.schE, -5000);
  near(retirement.passive.magi, 140000 - retirement.x.sepIra);
  near(retirement.x.schE, -(25000 - 0.5 * (retirement.passive.magi - 100000)));
  near(higher.x.schE, 0);
  near(higher.passive.magi, 170000 - higher.x.sepIra);
  const manual = JSON.parse(JSON.stringify(c)); manual.cols = []; manual.mod.schC.sepIra = retirement.x.sepIra;
  const sameAmount = TM.walkClient(manual).cols[0];
  near(sameAmount.x.schE, retirement.x.schE); near(sameAmount.r.f.l24, retirement.r.f.l24);
});

test('passive recomputation preserves fixed corrections and exact Schedule E/NII overrides', () => {
  const c = rentalClient();
  c.adjustments = { schE: 1000, niiOther: 300 };
  c.elections = { hsa: { mode: 'max', coverage: 'self', age: 45 } };
  c.cols = [{ id: 'corrected', year: 2025, status: 'single', adjustments: { schE: -500, niiOther: 200 } }, { id: 'typed', year: 2025, status: 'single', ov: { schE: -12000, niiOther: 1500 } }];
  let w = TM.walkClient(c);
  near(w.cols[0].x.schE, w.cols[0].sourceX.schE + 1000);
  near(w.cols[1].x.schE, w.cols[1].sourceX.schE - 500);
  near(w.cols[1].x.niiOther, w.cols[1].sourceX.niiOther + 200);
  near(w.cols[2].x.schE, -12000); near(w.cols[2].x.niiOther, 1500);
  const previousSource = w.cols[1].sourceX.schE;
  c.w2[0].wages += 10000;
  w = TM.walkClient(c);
  assert.notEqual(w.cols[1].sourceX.schE, previousSource);
  near(w.cols[1].x.schE, w.cols[1].sourceX.schE - 500);
  near(w.cols[2].x.schE, -12000);
});

test('QBI uses each column allowed rental and K-1 losses without mutating source items', () => {
  for (const kind of ['rent', 'k1']) {
    const c = rentalClient(); c.mod.schC = { businesses: [{ name: 'Practice', gross: 30000 }] };
    if (kind === 'rent') c.mod.rents.properties[0].qbiTrade = true;
    else {
      c.mod.rents.properties = [];
      c.mod.k1 = { entities: [{ name: 'Rental K-1', form: '1065', passive: true, activeRental: true, box2: -25000, qbi: -25000, basisBegin: 100000 }] };
    }
    c.cols = [{ id: 'hsa', year: 2025, status: 'single', elections: { hsa: { mode: 'max', coverage: 'self', age: 45 } } }];
    const snapshot = JSON.stringify(c), w = TM.walkClient(c);
    for (const column of w.cols) {
      const qbi = column.ctx.qbiItems.find((item) => item.src === kind);
      near(qbi.qbi, column.x.schE);
      const q = column.r.q.rows.find((item) => item.src === kind);
      near(q.qbi, column.x.schE);
    }
    assert.ok(w.cols[1].x.schE < w.cols[0].x.schE);
    near(w.feeds.rawItems.find((item) => item.src === kind).qbi, -25000);
    assert.equal(JSON.stringify(c), snapshot);
  }
});

test('IRA election uses resolved passive losses while the rental MAGI adds IRA deductions back', () => {
  const c = rentalClient();
  c.elections = { hsa: { mode: 'max', coverage: 'self', age: 45 }, ira: { mode: 'deductible', covered: true, amount: 7000 } };
  const column = TM.walkClient(c).cols[0];
  near(column.x.schE, -22150); near(column.passive.magi, 105700);
  near(column.planning.ira.magi, 83550); near(column.x.iraDed, 3820);
});

test('growth projects passive rental income and QBI along with wages', () => {
  const c = rentalClient(); c.w2[0].wages = 50000;
  c.mod.rents.properties = [{ name: 'Rental', type: 'rental', participation: 'active', gross: 20000, exp: { depreciation: 10000 }, qbiTrade: true }];
  c.cols = [{ id: 'growth', year: 2025, status: 'single', growth: 0.1 }];
  const [base, projected] = TM.walkClient(c).cols;
  near(base.x.schE, 10000); near(base.x.niiOther, 10000);
  near(projected.x.wages, 55000); near(projected.x.schE, 11000); near(projected.x.niiOther, 11000);
  near(projected.r.agi, 66000);
  near(projected.ctx.qbiItems.find((item) => item.src === 'rent').qbi, 11000);
  near(projected.r.q.rows.find((item) => item.src === 'rent').qbi, 11000);
});

test('growth projects passive K-1, nonpassive K-1 and royalty source amounts consistently', () => {
  const c = rentalClient(); c.w2[0].wages = 50000;
  c.mod.rents.properties = [
    { name: 'Rental', type: 'rental', participation: 'active', gross: 20000, exp: { depreciation: 10000 }, qbiTrade: true },
    { name: 'Royalty', type: 'royalty', gross: 5000, qbiTrade: true },
  ];
  c.mod.k1 = { entities: [
    { name: 'Passive K-1', form: '1065', passive: true, box1: 4000, qbi: 4000 },
    { name: 'Active K-1', form: '1120-S', box1: 2000, qbi: 2000 },
  ] };
  c.cols = [{ id: 'growth', year: 2025, status: 'single', growth: 0.1 }];
  const [base, projected] = TM.walkClient(c).cols;
  near(base.x.schE, 21000); near(projected.x.schE, 23100);
  near(base.x.niiOther, 19000); near(projected.x.niiOther, 20900);
  near(projected.r.agi, 78100);
  for (const item of projected.ctx.qbiItems) {
    const original = base.ctx.qbiItems.find((original) => original.name === item.name && original.src === item.src);
    near(item.qbi, Math.round(original.qbi * 1.1));
  }
});

test('projected rental and K-1 losses use projected income phaseouts and allowed-loss QBI', () => {
  for (const kind of ['rent', 'k1']) {
    const c = rentalClient(); c.mod.rents.properties[0].qbiTrade = true;
    if (kind === 'k1') {
      c.mod.rents.properties = [];
      c.mod.k1 = { entities: [{ name: 'Rental K-1', form: '1065', passive: true, activeRental: true, box2: -25000, qbi: -25000, basisBegin: 100000 }] };
    }
    c.cols = [{ id: 'growth', year: 2025, status: 'single', growth: 0.1 }];
    const [base, projected] = TM.walkClient(c).cols;
    near(base.x.schE, -20000);
    near(projected.x.wages, 121000); near(projected.passive.losses, 27500);
    near(projected.passive.magi, 121000); near(projected.x.schE, -14500);
    near(projected.x.niiOther, -14500); near(projected.r.agi, 106500);
    near(projected.ctx.qbiItems.find((item) => item.src === kind).qbi, -14500);
    c.w2[0].wages = 50000;
    const belowPhaseout = TM.walkClient(c).cols[1];
    near(belowPhaseout.x.wages, 55000); near(belowPhaseout.x.schE, -25000);
    near(belowPhaseout.ctx.qbiItems.find((item) => item.src === kind).qbi, -25000);
  }
});

test('growth carries saved Schedule E and NII source corrections exactly once', () => {
  const c = rentalClient(); c.w2[0].wages = 50000;
  c.mod.rents.properties = [{ name: 'Rental', type: 'rental', participation: 'active', gross: 20000, exp: { depreciation: 10000 } }];
  c.adjustments = { schE: 1000, niiOther: 500 };
  c.cols = [{ id: 'growth', year: 2025, status: 'single', growth: 0.1, adjustments: { schE: 200, niiOther: 100 } }];
  const w = TM.walkClient(c), projected = w.cols[1];
  near(projected.sourceX.schE, 12100); near(projected.x.schE, 12300);
  near(projected.sourceX.niiOther, 11550); near(projected.x.niiOther, 11650);
  assert.deepEqual(c.adjustments, { schE: 1000, niiOther: 500 });
});

test('columns without passive activities expose finite rental MAGI details', () => {
  const c = client({ hsa: { mode: 'max', coverage: 'self' } });
  for (const column of TM.walkClient(c).cols) {
    assert.equal(column.passive.acts.length, 0);
    assert.ok(Number.isFinite(column.passive.magi));
  }
});
