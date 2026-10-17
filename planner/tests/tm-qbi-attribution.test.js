const test = require('node:test');
const assert = require('node:assert/strict');
const TM = require('../src/tm-modules.js');

const leaves = (values) => Object.assign(TM.blankLeaves(), values);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);
const byName = (result, name) => result.q.rows.find((row) => row.name === name).qbi;
const ctx = (qbiItems) => ({ year: 2025, status: 'mfj', qbiItems });

// Qualified retirement-plan deductions reduce attributable QBI under
// Reg. 1.199A-3(b)(1)(vi); see irs.gov/irb/2019-09_IRB and
// irs.gov/instructions/i8995, "Determining Your Qualified Business Income."
test('K-1-only self-employment SEP election reduces partnership QBI', () => {
  const client = {
    info: { year: 2025, status: 'mfj', tpDob: '1980-01-01' },
    w2: [{ who: 'tp', wages: 100000, ssWages: 100000 }],
    mod: { k1: { entities: [{ name: 'Partnership', form: '1065', box1: 100000, se: 100000, qbi: 100000 }] } },
    elections: { retirement: { plan: 'sep' } }, cols: [],
  };
  const column = TM.walkClient(client).cols[0];
  assert.ok(column.x.sepIra > 0);
  const expectedQbi = 100000 - column.r.se.ded - column.x.sepIra;
  near(byName(column.r, 'Partnership'), expectedQbi);
  near(column.r.f.l13a, expectedQbi * 0.2);
});

test('mixed Schedule C and K-1 earnings allocate retirement once and preserve other deductions', () => {
  const items = [
    { name: 'Practice', src: 'schC', gross: 60000 },
    { name: 'Partnership', src: 'k1', qbi: 20000, se: 40000 },
    { name: 'S corporation', src: 'k1', qbi: 25000, se: 0 },
  ];
  const beforeItems = JSON.stringify(items);
  const inputs = leaves({ wages: 100000, ssWages: 100000, schC: 60000, schE: 65000, seK1: 40000, seHealth: 1500 });
  const before = TM.computeReturn(inputs, ctx(items));
  const after = TM.computeReturn({ ...inputs, sepIra: 10000 }, ctx(items));
  near(before.se.ded, after.se.ded);
  near(byName(before, 'Practice'), 60000 - before.se.ded * 0.6 - 1500);
  near(byName(before, 'Partnership'), 20000 - before.se.ded * 0.4);
  near(byName(before, 'Practice') - byName(after, 'Practice'), 6000);
  near(byName(before, 'Partnership') - byName(after, 'Partnership'), 4000);
  near(byName(after, 'S corporation'), 25000);
  near(before.q.netQbi - after.q.netQbi, 10000);
  assert.equal(JSON.stringify(items), beforeItems, 'input business records remain intact');
});

test('retirement attribution uses positive SE earnings and leaves loss and non-SE sources intact', () => {
  const items = [
    { name: 'Profitable practice', src: 'schC', gross: 70000 },
    { name: 'Practice loss', src: 'schC', gross: -20000 },
    { name: 'Partnership A', src: 'k1', qbi: 5000, se: 10000 },
    { name: 'Partnership B', src: 'k1', qbi: -5000, se: 20000 },
    { name: 'Partnership loss', src: 'k1', qbi: -5000, se: -5000 },
    { name: 'Rental', src: 'rent', qbi: 15000 },
  ];
  const inputs = leaves({ wages: 100000, schC: 50000, schE: 40000, seK1: 25000 });
  const before = TM.computeReturn(inputs, ctx(items));
  const after = TM.computeReturn({ ...inputs, sepIra: 10000 }, ctx(items));
  for (const [name, reduction] of [['Profitable practice', 7000], ['Partnership A', 1000], ['Partnership B', 2000], ['Practice loss', 0], ['Partnership loss', 0], ['Rental', 0]]) {
    near(byName(before, name) - byName(after, name), reduction);
  }
  near(before.q.netQbi - after.q.netQbi, 10000);
});

test('non-QBI K-1 SE income keeps its retirement share outside qualified business records', () => {
  const items = [{ name: 'Practice', src: 'schC', gross: 60000 }];
  // The K-1 contributes SE income but has no qualifying 199A item. Its share of
  // retirement contributions must not be reassigned to the unrelated practice.
  const inputs = leaves({ wages: 100000, schC: 60000, schE: 40000, seK1: 40000 });
  const before = TM.computeReturn(inputs, ctx(items));
  const after = TM.computeReturn({ ...inputs, sepIra: 10000 }, ctx(items));
  near(byName(before, 'Practice') - byName(after, 'Practice'), 6000);
});

test('a manual retirement amount with no positive qualifying SE earnings stays finite', () => {
  const items = [{ name: 'Practice loss', src: 'schC', gross: -10000 }, { name: 'Rental', src: 'rent', qbi: 15000 }];
  const inputs = leaves({ wages: 100000, schC: -10000, schE: 15000 });
  const before = TM.computeReturn(inputs, ctx(items));
  const after = TM.computeReturn({ ...inputs, sepIra: 1000 }, ctx(items));
  near(byName(after, 'Practice loss'), byName(before, 'Practice loss'));
  near(byName(after, 'Rental'), byName(before, 'Rental'));
  assert.ok(Number.isFinite(after.q.netQbi));
});
