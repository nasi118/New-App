const test = require('node:test');
const assert = require('node:assert/strict');
const TM = require('../src/tm-modules.js');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);

function client() {
  return { id: 'source-client', info: { name: 'Entered household', year: 2025, status: 'single', tpDob: '1980-01-01' },
    w2: [{ employer: 'Entered employer', wages: 110000, ssWages: 110000, fedWh: 20000 }],
    mod: {
      schC: { businesses: [{ name: 'Practice', gross: 35000, exp: { office: 5000 } }] },
      rents: { properties: [{ name: 'Rental', type: 'rental', participation: 'active', qbiTrade: true, gross: 0, exp: { depreciation: 25000 } }] },
      portfolio: { interest: [{ payer: 'Entered bank', taxable: 1500 }], dividends: [{ payer: 'Entered fund', ordinary: 2000, qualified: 1200 }] },
    },
    elections: { retirement: { plan: 'sep', age: 45 }, hsa: { mode: 'max', coverage: 'self', age: 45 }, ira: { mode: 'deductible', covered: true, amount: 7000 } },
    adjustments: { wages: 1000, schE: 500, niiOther: 200 }, direct: {},
    cols: [{ id: 'existing-plan', name: 'Existing plan', year: 2026, status: 'single', ov: { wages: 250000 } }],
    scen: { project: false, growth: 0.05, scenarios: [
      { name: 'Baseline', levers: {} },
      { name: 'Business expense and giving', levers: { schCExpense: 10000, charity: 15000, extraEst: 5000 } },
      { name: 'Conversion and harvest', levers: { roth: 20000, harvest: 12000, deferIncome: 5000 } },
      { name: 'Entered contributions', levers: { sepIra: 5000, hsa: 2000 } },
    ] },
  };
}

function assertMatchesSentColumns(c) {
  const before = JSON.stringify(c), existingWalk = TM.walkClient(c), scenarios = TM.scenarioClient(c, existingWalk);
  for (let i = 0; i < c.scen.scenarios.length; i++) {
    const scenario = c.scen.scenarios[i], projection = !!c.scen.project;
    // This reproduces the existing scen-to-walk action's saved column shape.
    const sent = { id: 'sent-' + i, name: scenario.name, year: projection ? Math.min(2026, c.info.year + 1) : c.info.year, status: c.info.status,
      ov: {}, lv: JSON.parse(JSON.stringify(scenario.levers)), growth: projection ? c.scen.growth : 0 };
    const updated = Object.assign({}, c, { cols: c.cols.concat(sent) }), column = TM.walkClient(updated).cols.at(-1);
    assert.deepEqual(scenarios.res[i].r.f, column.r.f, `Scenario ${i} Form 1040 differs from sent column`);
    assert.deepEqual(scenarios.res[i].r.s1, column.r.s1);
    assert.deepEqual(scenarios.res[i].r.s2, column.r.s2);
    assert.deepEqual(scenarios.res[i].r.q, column.r.q);
    assert.deepEqual(scenarios.columns[i].x, column.x);
    assert.deepEqual(scenarios.columns[i].planning, column.planning);
    assert.deepEqual(scenarios.columns[i].passive, column.passive);
    near(scenarios.res[i].r.net, column.r.net); near(scenarios.res[i].r.marginal, column.r.marginal);
  }
  assert.equal(JSON.stringify(c), before, 'Scenario calculations must not mutate client inputs');
  return scenarios;
}

test('scenario results equal sent walk columns with elections, passive losses, QBI and source corrections', () => {
  const c = client();
  const result = assertMatchesSentColumns(c);
  assert.ok(result.columns[1].x.schE < result.columns[0].x.schE, 'Business expense should change the allowed passive loss');
  assert.notEqual(result.res[1].r.f.l13a, result.res[0].r.f.l13a, 'QBI should reflect the changed business income and allowed rental loss');
  assert.ok(result.columns[0].planning.retirement.configured); assert.ok(result.columns[0].planning.hsa.configured); assert.ok(result.columns[0].planning.ira.configured);
});

test('projection scenarios recalculate each election using next-year limits and projected passive inputs', () => {
  const c = client(); c.scen.project = true;
  const result = assertMatchesSentColumns(c), base = TM.walkClient(c).cols[0];
  assert.equal(result.year, 2026); near(result.bx.wages, Math.round(base.x.wages * 1.05));
  near(result.columns[0].x.hsa, 4400);
  assert.notEqual(result.columns[0].planning.ira.limit, base.planning.ira.limit);
  assert.notEqual(result.columns[0].planning.retirement.base, base.planning.retirement.base);
  assert.notEqual(result.columns[0].passive.magi, base.passive.magi);
});

test('HSA planning lever recomputes the passive allowance instead of freezing the base Schedule E loss', () => {
  const c = { info: { year: 2025, status: 'single', tpDob: '1980-01-01' }, w2: [{ wages: 110000 }],
    mod: { rents: { properties: [{ name: 'Rental', type: 'rental', participation: 'active', gross: 0, exp: { depreciation: 25000 } }] } },
    cols: [], scen: { growth: 0, scenarios: [{ name: 'Baseline', levers: {} }, { name: 'HSA', levers: { hsa: 4300 } }] } };
  const result = assertMatchesSentColumns(c);
  near(result.columns[0].x.schE, -20000); near(result.columns[1].x.schE, -22150);
  near(result.res[1].r.agi, 83550); near(result.res[1].r.f.l24, 9830);
});

test('source edits propagate into every scenario and its equivalent sent column without changing history', () => {
  const c = client(); c.scen.project = true;
  const original = assertMatchesSentColumns(c);
  c.w2[0].wages += 12000; c.mod.schC.businesses[0].gross += 8000; c.mod.portfolio.interest[0].taxable += 500;
  const updated = assertMatchesSentColumns(c);
  for (let i = 0; i < updated.res.length; i++) {
    assert.notEqual(updated.res[i].r.agi, original.res[i].r.agi);
    assert.notEqual(updated.res[i].r.f.l24, original.res[i].r.f.l24);
  }
  assert.equal(c.cols.length, 1); assert.equal(c.cols[0].ov.wages, 250000);
});

test('latest-year scenario projections retain the same supported year as Send to walk', () => {
  const c = client(); c.info.year = 2026; c.scen.project = true;
  const result = assertMatchesSentColumns(c);
  assert.equal(result.year, 2026); assert.ok(result.columns.every((column) => column.r.year === 2026));
});

test('funding estimate preserves existing lever semantics and no-scenario clients remain immutable', () => {
  const c = client(); c.elections = {};
  const result = TM.scenarioClient(c);
  near(result.res[1].r.cash, 25000); // $10k business expense + $15k giving; extra estimates excluded.
  near(result.res[2].r.cash, 0); // Conversion, harvesting and deferral excluded.
  near(result.res[3].r.cash, 7000); // $5k additional retirement + $2k HSA above zero.
  const noScenarios = { info: { year: 2025, status: 'single' }, w2: [{ wages: 60000 }] }, before = JSON.stringify(noScenarios);
  const baseline = TM.scenarioClient(noScenarios);
  assert.equal(baseline.res.length, 1); assert.equal(JSON.stringify(noScenarios), before);
});

test('next-year estimates preserve zero growth, default only absent growth, and use the shared election pipeline', () => {
  for (const [entered, expected] of [[0, 0], [undefined, 0.03], [null, 0.03], ['', 0.03]]) {
    const c = client(); c.scen.growth = entered;
    const before = JSON.stringify(c), projection = TM.nextYearProjection(c), base = TM.walkClient(c).cols[0];
    near(projection.growth, expected); assert.equal(projection.year, 2026);
    near(projection.column.x.wages, Math.round(base.x.wages * (1 + expected)));
    const matched = Object.assign({}, c, { scen: Object.assign({}, c.scen, { project: true, growth: expected, scenarios: [{ name: 'Baseline', levers: {} }] }) });
    const scenario = TM.scenarioClient(matched).columns[0];
    assert.deepEqual(projection.column.x, scenario.x); assert.deepEqual(projection.column.r.f, scenario.r.f);
    assert.deepEqual(projection.column.planning, scenario.planning); assert.deepEqual(projection.column.passive, scenario.passive);
    near(projection.column.x.hsa, 4400); near(projection.column.planning.ira.limit, 7500);
    assert.equal(JSON.stringify(c), before);
  }
  const latest = client(); latest.info.year = 2026;
  assert.throws(() => TM.nextYearProjection(latest), /not available beyond tax year 2026/);
});

function scenarioHTML(c) {
  const previousWindow = global.window;
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  global.window = { TM, TMWalkUI: () => ({}) };
  const file = require.resolve('../src/tm-views.js'); delete require.cache[file];
  try {
    require(file);
    const state = { data: { tm: { clients: [c], active: c.id } }, ui: {} };
    const views = global.window.TMViews({ state, esc, money: (value) => '$' + TM.n(value), pct: (value) => String(TM.n(value) * 100) + '%', fmtNum: (value) => String(TM.n(value)),
      head: (_, title, lede) => '<h1>' + esc(title) + '</h1><p>' + esc(lede) + '</p>',
      selectBind: (path, value) => '<select data-bind="' + esc(path) + '"><option>' + esc(value) + '</option></select>',
      inputText: (path, value) => '<input data-bind="' + esc(path) + '" value="' + esc(value) + '">',
      inputNum: (path, value) => '<input data-bind="' + esc(path) + '" value="' + esc(value) + '">',
      cellNum: (value) => '<td>' + esc(value) + '</td>', kv: (key, value) => '<dt>' + esc(key) + '</dt><dd>' + esc(value) + '</dd>',
      compute: () => ({ tmw: TM.walkClient(c) }) });
    return views.VIEWS.scen();
  } finally { delete require.cache[file]; global.window = previousWindow; }
}

test('scenario UI shows calculated election deductions while unaffected planning levers remain editable', () => {
  const c = client(), snapshot = JSON.stringify(c), html = scenarioHTML(c);
  assert.match(html, /Using walk elections/); assert.match(html, /IRA eligibility and deductibility recalculate for each scenario/);
  assert.match(html, /Retirement deduction \(walk election\)/); assert.match(html, /HSA deduction \(walk election\)/);
  assert.equal((html.match(/data-scenario-election="retirement"/g) || []).length, c.scen.scenarios.length);
  assert.equal((html.match(/data-scenario-election="hsa"/g) || []).length, c.scen.scenarios.length);
  assert.doesNotMatch(html, /data-bind="tm\.clients\.0\.scen\.scenarios\.\d+\.levers\.(hsa|sepIra)"/);
  assert.match(html, /data-bind="tm\.clients\.0\.scen\.scenarios\.1\.levers\.charity"/);
  assert.equal(JSON.stringify(c), snapshot, 'Showing a computed election amount must preserve saved lever inputs');
  delete c.elections.retirement; delete c.elections.hsa;
  const editable = scenarioHTML(c);
  assert.match(editable, /data-bind="tm\.clients\.0\.scen\.scenarios\.1\.levers\.hsa"/);
  assert.match(editable, /data-bind="tm\.clients\.0\.scen\.scenarios\.1\.levers\.sepIra"/);
  assert.doesNotMatch(editable, /data-scenario-election=/);
});
