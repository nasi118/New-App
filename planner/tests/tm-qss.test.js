const test = require('node:test');
const assert = require('node:assert/strict');
const TM = require('../src/tm-modules.js');
const leaves = (x) => Object.assign(TM.blankLeaves(), x);
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} != ${b}`);
const calc = (status, input, ctx = {}) => TM.computeReturn(leaves(input), { year: 2025, status, ...ctx });

// Primary sources reviewed for these cases (not the legacy training fixtures):
// irs.gov/pub/irs-pdf/f8995.pdf, TY2025 eligibility and MFJ-only threshold;
// irs.gov/pub/irs-drop/rp-25-32.pdf, sections 3.01/.03/.13/.26, TY2026;
// irs.gov/pub/irs-pdf/f1040s1a.pdf, lines 9–12/15–20/26–29/32–37;
// irs.gov/pub/irs-pdf/i1040s8.pdf, Schedule 8812 $400k MFJ / $200k others;
// irs.gov/pub/irs-pdf/p915.pdf, Worksheet 1 lines 9 and 11;
// irs.gov/pub/irs-pdf/f8959.pdf, lines 5/9/15;
// irs.gov/pub/irs-pdf/i8960.pdf, Application to Individuals;
// irs.gov/pub/irs-pdf/f6251.pdf and irs.gov/pub/irs-pdf/p590a.pdf, Table 1-2.

test('QSS retains joint ordinary/preferential brackets, standard deduction, AMT and NIIT parameters', () => {
  for (const year of [2025, 2026]) {
    const q = TM.params(year, 'qss'), j = TM.params(year, 'mfj');
    for (const key of ['br', 'brackets', 'std', 'cg0', 'cg15', 'amtEx', 'amtPhase', 'amtPhaseRate', 'amtBp', 'niitThr']) assert.deepEqual(q[key], j[key], year + ' ' + key);
    assert.equal(q.joint, false); assert.equal(j.joint, true);
    assert.equal(q.niitThr, 250000);
    const base = { wages: 100000, ordDiv: 5000, qualDiv: 5000 };
    near(calc('qss', base, { year }).f.l16, calc('mfj', base, { year }).f.l16);
    near(calc('qss', { wages: 400000, isoSpread: 200000 }, { year }).amt.amt, calc('mfj', { wages: 400000, isoSpread: 200000 }, { year }).amt.amt);
  }
});

test('QSS uses nonjoint QBI threshold/range, including phase-in boundaries', () => {
  for (const [year, threshold, range] of [[2025, 197300, 50000], [2026, 201750, 75000]]) {
    const q = TM.params(year, 'qss'), j = TM.params(year, 'mfj');
    assert.equal(q.qbiThr, threshold); assert.equal(q.qbiRange, range);
    const items = [{ name: 'Business', qbi: 100000, w2: 0, ubia: 0, passive: true }];
    // Passive=true avoids the separate active-business $400 minimum in TY2026.
    const ded = (income, p = q) => TM.qbi(items, income, 0, 0, 0, p).ded;
    near(ded(threshold), 20000);
    near(ded(threshold + range / 2), 10000);
    near(ded(threshold + range), 0);
    near(ded(threshold + range, j), 20000);
  }
});

test('TY2026 MFS QBI threshold is $201,775 while QSS and single use $201,750', () => {
  const p = TM.params(2026, 'mfs');
  assert.equal(p.qbiThr, 201775); assert.equal(p.qbiRange, 75000);
  assert.equal(TM.params(2026, 'qss').qbiThr, 201750);
  const items = [{ qbi: 100000, w2: 0, ubia: 0, passive: true }];
  near(TM.qbi(items, 201775, 0, 0, 0, p).ded, 20000);
  near(TM.qbi(items, 276775, 0, 0, 0, p).ded, 0);
});

test('QSS child credit starts its phaseout at $200,000 rather than the joint $400,000', () => {
  for (const year of [2025, 2026]) {
    near(calc('qss', { wages: 200000, ctcKids: 1 }, { year }).k8812.afterPhase, 2200);
    near(calc('qss', { wages: 200001, ctcKids: 1 }, { year }).k8812.afterPhase, 2150);
    near(calc('mfj', { wages: 200001, ctcKids: 1 }, { year }).k8812.afterPhase, 2200);
    near(calc('qss', { wages: 244000, ctcKids: 1 }, { year }).k8812.afterPhase, 0);
  }
});

test('QSS social security benefits use the $25,000/$34,000 provisional-income thresholds', () => {
  near(calc('qss', { wages: 20000, ssBenefits: 10000 }).f.l6b, 0);
  near(calc('qss', { wages: 20001, ssBenefits: 10000 }).f.l6b, 0.5);
  near(calc('qss', { wages: 21000, ssBenefits: 20000 }).f.l6b, 3000);
  near(calc('mfj', { wages: 21000, ssBenefits: 20000 }).f.l6b, 0);
  near(calc('qss', { wages: 24000, ssBenefits: 20000 }).f.l6b, 4500);
  near(calc('qss', { wages: 25000, ssBenefits: 20000 }).f.l6b, 5350);
});

test('QSS Additional Medicare threshold is $200,000 while NIIT stays at $250,000', () => {
  for (const year of [2025, 2026]) {
    near(calc('qss', { wages: 200000 }, { year }).s2.l11, 0);
    near(calc('qss', { wages: 225000 }, { year }).s2.l11, 225);
    near(calc('mfj', { wages: 225000 }, { year }).s2.l11, 0);
    near(calc('qss', { wages: 200000, taxableInt: 40000 }, { year }).s2.l12, 0);
    near(calc('single', { wages: 200000, taxableInt: 40000 }, { year }).s2.l12, 1520);
    near(calc('qss', { wages: 250000, taxableInt: 10000 }, { year }).s2.l12, 380);
    near(calc('mfj', { wages: 250000, taxableInt: 10000 }, { year }).s2.l12, 380);
  }
});

test('QSS senior deduction phases out above $75,000 and includes one taxpayer', () => {
  near(calc('qss', { wages: 75000 }, { seniors: 1 }).s1a.senior, 6000);
  near(calc('qss', { wages: 75001 }, { seniors: 1 }).s1a.senior, 5999.94);
  near(calc('qss', { wages: 125000 }, { seniors: 1 }).s1a.senior, 3000);
  near(calc('qss', { wages: 175000 }, { seniors: 1 }).s1a.senior, 0);
  near(calc('qss', { wages: 75000 }, { seniors: 2 }).s1a.senior, 6000);
  near(calc('qss', { wages: 50000 }, { seniors: 2, blind: 2 }).a.std, 34700);
});

test('QSS client context excludes a deceased spouse’s age and blindness from the living taxpayer’s deductions', () => {
  const client = { info: { year: 2025, status: 'qss', tpDob: '1965-02-01', spDob: '1955-02-01', spBlind: true }, w2: [{ wages: 50000 }], cols: [] };
  const ctx = TM.clientCtx(client), base = TM.walkClient(client).cols[0].r;
  assert.equal(ctx.tpAge, 60); assert.equal(ctx.spAge, null);
  assert.equal(ctx.seniors, 0); assert.equal(ctx.blind, 0);
  near(base.a.std, 31500); near(base.s1a.senior, 0);
  client.info.tpDob = '1955-02-01'; client.info.tpBlind = true;
  const senior = TM.walkClient(client).cols[0].r;
  near(senior.a.std, 34700); near(senior.s1a.senior, 6000);
  // MFJ still includes both living spouses when that status is selected.
  client.info.status = 'mfj';
  assert.equal(TM.clientCtx(client).seniors, 2); assert.equal(TM.clientCtx(client).blind, 2);
});

test('MFJ two-senior phaseout applies to each spouse per Schedule 1-A lines 35, 36a/36b and 37', () => {
  // At $200k MAGI: line35 = $6k - 6%*$50k = $3k each; line37 = $6k.
  // The legacy training engine's $9k fixture subtracts the phaseout once
  // from the combined $12k; it is not an authoritative active-client result.
  near(calc('mfj', { wages: 150000 }, { seniors: 2 }).s1a.senior, 12000);
  near(calc('mfj', { wages: 200000 }, { seniors: 2 }).s1a.senior, 6000);
  near(calc('mfj', { wages: 200000 }, { seniors: 1 }).s1a.senior, 3000);
  near(calc('mfj', { wages: 250000 }, { seniors: 2 }).s1a.senior, 0);
  near(calc('mfs', { wages: 50000 }, { seniors: 1 }).s1a.senior, 0);
});

test('QSS tips/overtime use nonjoint limits and floor whole $1,000 phaseout steps', () => {
  for (const [wages, tips, overtime] of [[150000, 25000, 12500], [150999, 25000, 12500], [151000, 24900, 12400], [151999, 24900, 12400], [152000, 24800, 12300]]) {
    const r = calc('qss', { wages, tips: 30000, overtime: 30000 });
    near(r.s1a.tips, tips); near(r.s1a.overtime, overtime);
  }
  const joint = calc('mfj', { wages: 151000, tips: 30000, overtime: 30000 });
  near(joint.s1a.tips, 25000); near(joint.s1a.overtime, 25000);
});

test('tips and overtime whole-thousand floor also applies at other filing status thresholds', () => {
  for (const status of ['single', 'hoh', 'mfj']) {
    const threshold = status === 'mfj' ? 300000 : 150000;
    const before = calc(status, { wages: threshold + 999, tips: 10000, overtime: 10000 });
    near(before.s1a.tips, 10000); near(before.s1a.overtime, 10000);
    const after = calc(status, { wages: threshold + 1000, tips: 10000, overtime: 10000 });
    near(after.s1a.tips, 9900); near(after.s1a.overtime, 9900);
  }
});

test('QSS car-loan deduction phases above $100,000 and retains upward rounding', () => {
  for (const [wages, expected] of [[100000, 10000], [100001, 9800], [100999, 9800], [101000, 9800], [101001, 9600], [150000, 0]]) near(calc('qss', { wages, carLoanInt: 10000 }).s1a.car, expected);
  near(calc('mfj', { wages: 150000, carLoanInt: 10000 }).s1a.car, 10000);
});

test('TY2026 QSS nonitemizer charitable cap is $1,000; the $2,000 cap requires a joint return', () => {
  // IRC170(p), as amended by Pub.L.119-21 section70424 (effective TY2026).
  const q = calc('qss', { wages: 60000, charityCash: 3000 }, { year: 2026 });
  const j = calc('mfj', { wages: 60000, charityCash: 3000 }, { year: 2026 });
  near(q.a.nonItemCharity, 1000); near(j.a.nonItemCharity, 2000);
  near(q.f.l12, 33200); near(j.f.l12, 34200);
  near(calc('qss', { wages: 60000, charityCash: 3000 }).a.nonItemCharity, 0);
});

test('covered traditional IRA retains joint phaseout for QSS under Pub.590-A Table1-2', () => {
  const c = { elections: { ira: { mode: 'deductible', covered: true, amount: 7000, age: 45 } } };
  for (const [year, lower, upper] of [[2025, 126000, 146000], [2026, 129000, 149000]]) {
    const run = (status, wages) => TM.inlinePlanning(c, {}, leaves({ wages }), { year, status });
    assert.deepEqual(run('qss', lower).details.ira.range, [lower, upper]);
    near(run('qss', lower).x.iraDed, 7000);
    near(run('qss', upper).x.iraDed, 0);
    near(run('qss', lower + 10000).x.iraDed, run('mfj', lower + 10000).x.iraDed);
    near(run('single', lower).x.iraDed, 0);
  }
});
