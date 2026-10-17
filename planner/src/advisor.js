/* Tax Master — AI tax advisor.
 * OpenAI:   same-origin server endpoint; no browser credential
 *   claude.ai: the artifact runtime's `sample` capability (viewer's own Claude account, page tools)
 *   API key:   legacy Anthropic Messages API connection, with the same page tools
 */
(function () {
  'use strict';
  const TMP = window.TMP, E = window.Engine;
  const esc = TMP.esc;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const RULES = [
    'You are the tax advisor built into Tax Master, an individual Form 1040 planning tool (TY2025 and TY2026) for a U.S. tax professional.',
    'Tax Master is organized by client. Each client has Client info (filing status, year, dependents, W-2s, other income), modules (Portfolio income, Schedule C, Capital transactions with investment assets, business assets and equity compensation, Rents & royalty, Passthrough K-1s, QBI, Itemized deductions) that feed leaf inputs of a Form 1040 walk, and up to five planning columns beside the base return. A planning column has its own year, filing status, planning moves (levers) and typed line overrides. The engine computes every column: tax with the Schedule D worksheet, AMT (Form 6251), SE tax, Additional Medicare Tax, NIIT, QBI with W-2/UBIA limits, the SALT cap phase-down, Schedule 1-A and the 2026 itemized limits.',
    'Demo clients are fictional: the Doe household (TY2026, high-net-worth investor with executive equity, a rental HoldCo, private-fund K-1s and asset sales) and the Rivera household (TY2025, mapped from a Form 1040 reconciliation workpaper).',
    'Three more models come from workbooks: (1) the Rivera Form 1040 reconciliation workpaper (Review & compliance views); (2) the Doe rental holding company analysis (JD Rental Holdings LLC, TY2026) covering the §469(c)(7)(A) election and §199A aggregation; (3) a 50-strategy high-net-worth planning comparison for John Doe (Wealth strategy views).',
    'Each model runs in "workbook" mode (formulas exactly as built) or "corrected" mode (review fixes applied). Findings list the formula and technical issues with dollar impacts.',
    '',
    'How to answer:',
    '- Answer the question directly first, then give the reasoning. Be concise; use short paragraphs, bullets, and small Markdown tables for numbers.',
    '- Ground every figure in the app. Use the tools to read schedules, strategies and findings instead of guessing, and say which line or schedule a number comes from.',
    '- Cite the controlling authority (IRC section, Treasury regulation, form instructions, revenue procedure) when you state a rule. Do not invent citations; if unsure, say what to verify.',
    '- Tax law changed under Pub. L. 119-21 (OBBBA, July 2025). Flag 2026 inflation-adjusted amounts and any figure you are not certain of as items to confirm.',
    '- Use what_if to test a change without touching the client file. Use set_input only when the user clearly asks you to change an input; say what you changed. Every change is logged and can be undone.',
    '- This is professional decision support, not a substitute for the preparer\'s judgment. Do not add generic disclaimers beyond one short line when the question calls for a client-facing conclusion.',
  ].join('\n');

  /* ---------------- tools ---------------- */
  const SCHEDS = ['f1040', 'control', 'schA', 'schB', 'schC', 'schD', 'schE', 'f8582', 'schSE', 'f8995', 's8812', 'sch1', 'sch2', 'sch3', 'taxCalc'];
  const r0 = (v) => Math.round(v * 100) / 100;
  function metrics(data) {
    const s = TMP.state.settings;
    const opt = { taxSource: s.taxSource, niitSource: s.niitSource };
    const w = E.calc1040(data.w1040, s.mode, opt);
    const ropt = { threshold: s.rentalThreshold, phaseRange: s.rentalPhaseRange, marginalRate: s.rentalMarginal };
    const rr = E.calcRental(data.rental, s.mode, ropt);
    const hn = E.calcHnwi(data.hnwi);
    return {
      w1040: { agi: r0(w.f.l11b), deduction: r0(w.f.l12e), qbiDeduction: r0(w.f.l13a), taxableIncome: r0(w.f.l15), tax: r0(w.f.l16), engineTax: r0(w.tax.engine), seTax: w.se.j, totalTax: r0(w.f.l24), payments: r0(w.f.l33), refundOrOwed: r0(w.net) },
      rental: { netRentalQbi: rr.tot.qbi, deduction199A: r0(rr.summary.ded), qbiCarryforward: rr.summary.carry, repTestsPass: rr.rep.pass, aggregationPass: rr.agg.pass, electionValue: r0(rr.election.value) },
      hnwi: { totalBenefitAll: r0(hn.dashboard.total), selectedCount: hn.selected.count, selectedNet: r0(hn.selected.net) },
      tm: tmMetrics(data),
      _hn: hn,
    };
  }
  function activeIndex(data) { const t = data.tm; const i = t.clients.findIndex((c) => c.id === t.active); return i < 0 ? 0 : i; }
  function tmMetrics(data) {
    const w = window.TM.walkClient(data.tm.clients[activeIndex(data)]);
    const out = {};
    w.cols.forEach((x, j) => { const r = x.r; out[j === 0 ? 'base' : 'col' + j] = { name: x.col.name, agi: r0(r.agi), taxableIncome: r0(r.f.l15), tax: r0(r.f.l16), amt: r0(r.amt.amt), niit: r0(r.s2.l12), seTax: r0(r.se.tax), qbiDeduction: r0(r.f.l13a), totalTax: r0(r.f.l24), refundOrOwed: r0(r.net) }; });
    return out;
  }
  function parseValue(v) { if (typeof v === 'number' || typeof v === 'boolean') return v; const s = String(v).trim(); if (/^(true|false)$/i.test(s)) return /^true$/i.test(s); const x = s.replace(/[$,]/g, ''); return x !== '' && isFinite(+x) ? +x : s; }
  const ELECTION_FIELDS = {
    retirement: { plan: ['', 'none', 'sep', 'solo401k', 'simple3', 'simple2', 'profitshare'], age: 'age', deferral: 'amount' },
    hsa: { mode: ['', 'off', 'max', 'manual'], coverage: ['self', 'family'], age: 'age', employerContributions: 'amount', amount: 'amount' },
    ira: { mode: ['', 'off', 'deductible', 'nondeductible'], age: 'age', amount: 'amount', covered: 'boolean', spouseCovered: 'boolean', livedApart: 'boolean' }
  };
  function controlPath(path) {
    const match = /^tm\.clients\.(\d+)\.(?:cols\.(\d+)\.)?(adjustments|elections)\.(.+)$/.exec(path);
    if (!match) return null;
    const client = TMP.state.data.tm.clients[+match[1]];
    if (!client || match[2] !== undefined && !client.cols[+match[2]]) throw new Error('Unknown client or planning column.');
    if (match[3] === 'adjustments') {
      if (!Object.prototype.hasOwnProperty.call(window.TM.LEAF, match[4])) throw new Error('Unknown Form 1040 adjustment leaf.');
      return 'adjustment';
    }
    const [group, field, extra] = match[4].split('.');
    if (extra || !Object.prototype.hasOwnProperty.call(ELECTION_FIELDS, group) || !Object.prototype.hasOwnProperty.call(ELECTION_FIELDS[group], field)) throw new Error('Unknown planning election field.');
    return ELECTION_FIELDS[group][field];
  }
  function inputValue(path, value) {
    const type = controlPath(path);
    if (type && value === null) return undefined; // clear the optional input
    const parsed = parseValue(value);
    if (type === 'adjustment' && parsed === '') return undefined;
    if (Array.isArray(type) && !type.includes(parsed)) throw new Error('Unsupported election value for ' + path + '.');
    if (type === 'boolean' && typeof parsed !== 'boolean') throw new Error(path + ' requires true or false.');
    if (['adjustment', 'amount', 'age'].includes(type) && (typeof parsed !== 'number' || !Number.isFinite(parsed) || type !== 'adjustment' && parsed < 0 || type === 'age' && parsed > 120)) throw new Error(path + ' requires a valid ' + (type === 'adjustment' ? 'number.' : type === 'age' ? 'age from 0 to 120.' : 'nonnegative amount.'));
    return parsed;
  }
  function setCopyValue(data, path, value) {
    const keys = path.split('.'); let target = data;
    for (let i = 0; i < keys.length - 1; i++) target = target[keys[i]] || (target[keys[i]] = {});
    if (value === undefined) delete target[keys[keys.length - 1]];
    else target[keys[keys.length - 1]] = value;
  }
  function checkPath(path) {
    if (typeof path !== 'string' || !/^(w1040|rental|hnwi|calendar|tm)\.[\w.-]+$/.test(path)) throw new Error('Path must start with tm., w1040., rental., hnwi. or calendar. and use dot notation, for example tm.clients.0.cols.0.lv.charity or w1040.other.cashCharity');
    if (path.split('.').some(key => !key || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Invalid input path.');
    const control = controlPath(path);
    const cur = TMP.getPath(TMP.state.data, path);
    if (cur === undefined && control) return control === 'adjustment' ? 0 : null;
    if (cur === undefined && /^calendar\./.test(path)) return 'Not started';
    if (cur === undefined && /^w1040\.planning\.scenarios\.\d+\.levers\.\w+$/.test(path)) return 0;
    if (cur === undefined && /^tm\.clients\.\d+\.(direct|cols\.\d+\.(ov|lv)|scen\.scenarios\.\d+\.levers|other)\.\w+$/.test(path)) return null;
    if (cur === undefined) throw new Error('No input at ' + path + '. Read the schedule or strategy first to find input paths.');
    if (cur !== null && typeof cur === 'object') throw new Error(path + ' is a group, not a single input.');
    return cur;
  }
  function diff(a, b) {
    const out = {};
    ['w1040', 'rental', 'hnwi', 'tm'].forEach((m) => { Object.keys(a[m]).forEach((k) => { if (JSON.stringify(a[m][k]) !== JSON.stringify(b[m][k])) out[m + '.' + k] = { before: a[m][k], after: b[m][k] }; }); });
    return out;
  }
  const TOOLS = [
    {
      name: 'get_client_return',
      description: 'Read the active client and every Form 1040 column, including amounts, source subtotals, direct adjustments, effective elections, retirement/HSA/IRA calculations, passive-activity detail and diagnostics. Editable paths (prefix tm.clients.<clientIndex>.): base adjustments.<leaf>; planning column j (0-based) cols.<j>.adjustments.<leaf>. Election paths: elections.<retirement|hsa|ira>.<field>, or cols.<j>.elections.<group>.<field>. Retirement fields: plan (none, sep, solo401k, simple3, simple2, profitshare), age, deferral. HSA: mode (off, max, manual), coverage (self, family), age, employerContributions, amount. IRA: mode (off, deductible, nondeductible), age, amount, covered, spouseCovered, livedApart. Null clears an optional adjustment or election. Legacy totals: direct.<leaf>, cols.<j>.ov.<leaf>. Planning moves: cols.<j>.lv.<sepIra|hsa|charity|harvest|roth|schCExpense|deferIncome|extraEst>; growth, year, status live on cols.<j>. Module inputs: mod.* (for example mod.itemized.charityCash).',
      inputSchema: { type: 'object', properties: { lines: { type: 'string', enum: ['summary', 'all'], description: 'summary = key lines only (default); all = every line incl. sub-lines' } } },
      run(input) {
        const TMV = TMP.TMV; const c = TMV.active(); const ci = activeIndex(TMP.state.data); const w = TMP.compute().tmw;
        const flat = []; const walkRows = (rows, depth) => rows.forEach((row) => { if (row.s) return; if (depth === 0 || (input && input.lines === 'all')) flat.push(row); if (row.sub) walkRows(row.sub, depth + 1); });
        walkRows(TMV.walkRows, 0);
        const det = w.feeds.detail;
        return {
          clientIndex: ci, client: { name: TMV.clientLabel(c), year: c.info.year, status: c.info.status, state: c.info.state, dependents: c.deps, priorYearTax: c.info.priorTax, priorYearAgi: c.info.priorAgi },
          columns: w.cols.map((x, j) => ({ index: j === 0 ? 'base' : j - 1, name: x.col.name, year: x.col.year, status: x.col.status, growth: x.col.growth || 0, moves: x.col.lv || {}, typed: j === 0 ? c.direct : x.col.ov,
            adjustments: (j === 0 ? c.adjustments : x.col.adjustments) || {},
            elections: Object.fromEntries(Object.keys(ELECTION_FIELDS).map(key => [key, Object.assign({}, (c.elections || {})[key], (x.col.elections || {})[key])])),
            planning: x.planning, sourceX: x.sourceX, passive: x.passive, diagnostics: x.r.diag,
            totalTax: r0(x.r.f.l24), effectiveRate: r0(x.r.effective), marginalRate: r0(x.r.marginal), refundOrOwed: r0(x.r.net), amt: { amti: r0(x.r.amt.amti), exemption: r0(x.r.amt.exemption), tmt: r0(x.r.amt.tmt), amt: r0(x.r.amt.amt) } })),
          lines: flat.map((row) => ({ line: row.ln, desc: typeof row.d === 'function' ? row.d(w.cols[0].r) : row.d, authority: row.a || undefined, leaf: row.leaf || undefined, values: w.cols.map((x) => r0(TMV.rowVal(row, x.r))) })),
          diagnostics: w.cols[0].r.diag, moduleChecks: [].concat(det.pf.checks, det.sc.checks, det.cap.checks, det.eq.checks, det.k1.checks, det.rents.checks),
        };
      },
    },
    {
      name: 'get_tax_scenarios',
      description: 'Read the active client\'s Tax scenarios & estimates page: scenario names and planning moves (paths tm.clients.<i>.scen.scenarios.<j>.levers.<key>), whether it projects the next year (scen.project, scen.growth). Use get_client_return for results by column; use what_if with planning-move paths to compare.',
      run() { const c = TMP.TMV.active(); return { clientIndex: activeIndex(TMP.state.data), project: !!c.scen.project, growth: c.scen.growth, scenarios: c.scen.scenarios, levers: window.TM.LEVERS.map((l) => ({ key: l.key, label: l.label, hint: l.hint })) }; },
    },
    {
      name: 'get_filing_calendar',
      description: 'Read the compliance filing calendar for both households: due date, days away, form, what it is, what created it (compliance file or a selected strategy) and status. Status is editable at calendar.<id>.',
      run() { return TMP.compute().calendar.map((c) => ({ id: c.id, client: c.client, form: c.form, title: c.title, due: c.due, extendedDue: c.ext, event: c.event, days: c.days, status: c.status, createdBy: c.source, amount: c.amount })); },
    },
    {
      name: 'get_1040_schedule',
      description: 'Read one schedule of the Rivera Form 1040 workpaper in the current logic mode. Returns rows of {key, line, desc, workpaper, returnSoftware, variance, inputPath}. inputPath, when present, is the editable input behind the row (prefix it with "w1040.").',
      inputSchema: { type: 'object', properties: { schedule: { type: 'string', enum: SCHEDS, description: 'f1040 = Form 1040 lines 1-38; control = control panel' } }, required: ['schedule'] },
      run(input) {
        const sch = String(input.schedule);
        if (!SCHEDS.includes(sch)) throw new Error('Unknown schedule. Use one of ' + SCHEDS.join(', '));
        const rows = TMP.compute().tie.rows[sch];
        return { mode: TMP.state.settings.mode, schedule: sch, rows: rows.map((r) => ({ key: r.key, line: r.line, desc: r.desc, workpaper: r0(r.value), returnSoftware: r0(r.ret), variance: r0(r.variance), inputPath: r.input || undefined })) };
      },
    },
    {
      name: 'get_rental_analysis',
      description: 'Read the Doe rental holding company model: property P&L and QBI, real estate professional tests, §199A aggregation tests, the QBI deduction in both workbook and corrected logic, owner split, election value and safe-harbor enterprise hours. Inputs live under rental.* (e.g. rental.taxableIncome, rental.properties.0.rents, rental.hours.johnRP).',
      run() {
        const r = TMP.compute().rent; const pick = (x) => ({ tot: x.tot, summary: Object.fromEntries(Object.entries(x.summary).map(([k, v]) => [k, typeof v === 'number' ? r0(v) : v])), owners: x.owners.map((o) => ({ name: o.name, pct: o.pct, ded: r0(o.ded), binding: o.binding })) });
        return { mode: TMP.state.settings.mode, properties: r.cur.props, repTests: r.cur.rep, aggregation: r.cur.agg, taxableIncome: r.cur.TI, netCapitalGain: r.cur.NCG, asBuilt: pick(r.asBuilt), corrected: pick(r.corrected), election: r.corrected.election, enterprises: r.corrected.enterprises, threshold: r.cur.threshold, phaseRange: r.cur.range };
      },
    },
    {
      name: 'get_strategy',
      description: 'Read one of John Doe\'s 50 planning strategies by number: facts, mechanics, inputs G-L, benefit formula, computed benefit/low/high, costs, net, rank, conflicts and checklist steps. Input paths are hnwi.strategies.<index>.<G|H|I|J|K|L|formula|selected> where index = number - 1. Pass no=0 for a ranked list of all 50.',
      inputSchema: { type: 'object', properties: { no: { type: 'integer', description: 'Strategy number 1-50, or 0 for the list' } }, required: ['no'] },
      run(input) {
        const no = parseInt(input.no, 10); const d = TMP.state.data.hnwi; const hn = TMP.compute().hn;
        if (!no) return { horizonYears: d.horizon, assumptions: d.assumptions.map((a) => ({ name: a.name, value: a.value })), strategies: d.strategies.map((s) => ({ no: s.no, title: s.title, category: s.category, risk: s.risk, benefit: Math.round(hn.byNo[s.no].benefit), net: Math.round(hn.byNo[s.no].net), rank: hn.byNo[s.no].rank, selected: !!s.selected })) };
        const i = d.strategies.findIndex((s) => s.no === no); if (i < 0) throw new Error('Strategy numbers run from 1 to 50.');
        const s = d.strategies[i]; const x = hn.byNo[no];
        return { index: i, strategy: s, result: { benefit: r0(x.benefit), low: r0(x.low), high: r0(x.high), oneTimeCost: x.oneTime, annualCost: x.recurring, horizonCost: x.horizonCost, net: r0(x.net), ratio: r0(x.ratio), rank: x.rank, flag: x.flag, error: x.error }, inputLabels: { G: 'Starting asset / deduction / gain', H: 'Basis or offset', I: 'Growth / return rate', J: 'Horizon years', K: 'Other input 1', L: 'Other input 2' }, checklist: d.checklist.filter((c) => c.no === no).map((c) => ({ phase: c.phase, item: c.item, cost: c.cost, status: c.status, timeline: c.timeline })) };
      },
    },
    {
      name: 'list_findings',
      description: 'List the review findings (formula errors and technical issues) with severity, detail, affected line and dollar impact of the correction. Optionally filter by model.',
      inputSchema: { type: 'object', properties: { model: { type: 'string', enum: ['all', 'w1040', 'rental', 'hnwi'] } } },
      run(input) { const m = input && input.model && input.model !== 'all' ? input.model : null; return TMP.compute().findings.filter((f) => !m || f.module === m).map((f) => ({ id: f.id, model: f.module, severity: f.severity, status: f.status, title: f.title, detail: f.detail, line: f.line, impact: f.impact == null ? null : r0(f.impact) })); },
    },
    {
      name: 'what_if',
      description: 'Test changes without saving them. Give one or more {path, value} pairs (paths as returned by the other tools, e.g. tm.clients.0.cols.0.lv.charity, tm.clients.0.direct.wages, w1040.other.cashCharity, rental.taxableIncome, hnwi.strategies.8.I). Returns key results before and after, including every Tax Master column.',
      inputSchema: { type: 'object', properties: { changes: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, value: {} }, required: ['path', 'value'] } } }, required: ['changes'] },
      run(input) {
        const changes = Array.isArray(input.changes) ? input.changes : [];
        if (!changes.length) throw new Error('Pass at least one change.');
        const before = metrics(TMP.state.data); const data = clone(TMP.state.data);
        changes.forEach((c) => { checkPath(c.path); setCopyValue(data, c.path, inputValue(c.path, c.value)); });
        const after = metrics(data);
        const out = { mode: TMP.state.settings.mode, changes, changed: diff(before, after) };
        const sNo = changes.map((c) => /^hnwi\.strategies\.(\d+)\./.exec(c.path)).filter(Boolean).map((m) => +m[1] + 1);
        sNo.forEach((no) => { out['strategy' + no] = { benefitBefore: r0(before._hn.byNo[no].benefit), benefitAfter: r0(after._hn.byNo[no].benefit), netAfter: r0(after._hn.byNo[no].net) }; });
        return out;
      },
    },
    {
      name: 'set_input',
      description: 'Change one input in the client file and recalculate. Only use when the user asked for the change. The change is logged as made by the advisor and can be undone. Returns key results before and after.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, value: {}, reason: { type: 'string', description: 'Short note for the change log' } }, required: ['path', 'value'] },
      run(input) {
        const from = checkPath(input.path); const value = inputValue(input.path, input.value);
        if (typeof from === 'number' && typeof value !== 'number' && value !== undefined) throw new Error(input.path + ' needs a number.');
        const before = metrics(TMP.state.data);
        TMP.applyChange(input.path, value, 'advisor', String(input.reason || '').slice(0, 120));
        TMP.render();
        TMP.toast('Advisor changed ' + input.path.split('.').slice(-2).join(' ') + '. See the change log to undo.');
        return { changed: input.path, from, to: value, results: diff(before, metrics(TMP.state.data)) };
      },
    },
    {
      name: 'open_view',
      description: 'Show a view to the user. Overview: home (summary dashboard), client, walk (Form 1040 walk). Modules: m-portfolio, m-schc, m-capital, m-rents, m-k1, scen (tax scenarios & estimates), m-qbi, r-469 (rental election & ownership), m-itemized. Wealth strategy: h-dash, h-matrix, h-cost, h-check. Review & compliance: c-home, w-tie, findings, calendar, w-sources, w-sched, w-review, r-props, r-199a, r-statements. Library: sources, audit, settings. For w-sched pass tab (schA, schB, schC, schD, schE, f8582, schSE, f8995, s8812, sch1, sch2, sch3, taxCalc).',
      inputSchema: { type: 'object', properties: { view: { type: 'string' }, tab: { type: 'string' } }, required: ['view'] },
      run(input) { const v = String(input.view); if (!TMP.VIEWS[v]) throw new Error('Unknown view ' + v); if (input.tab) TMP.state.tab.sched = String(input.tab); TMP.go(v); return { opened: v }; },
    },
  ];
  const SCHED_NAME = { f1040: 'Form 1040', control: 'the control panel', schA: 'Schedule A', schB: 'Schedule B', schC: 'Schedule C', schD: 'Schedule D', schE: 'Schedule E', f8582: 'Form 8582', schSE: 'Schedule SE', f8995: 'Form 8995', s8812: 'Schedule 8812', sch1: 'Schedule 1', sch2: 'Schedule 2', sch3: 'Schedule 3', taxCalc: 'the tax calculation' };
  const TOOL_LABEL = { get_1040_schedule: (i) => 'Reading ' + (SCHED_NAME[i.schedule] || 'a schedule'), get_rental_analysis: () => 'Reading the rental analysis', get_strategy: (i) => (i.no ? 'Reading strategy #' + i.no : 'Listing strategies'), list_findings: () => 'Reading findings', what_if: () => 'Running a what-if', set_input: (i) => 'Changing ' + i.path, open_view: (i) => 'Opening ' + i.view, get_tax_scenarios: () => 'Reading the tax scenarios', get_client_return: () => 'Reading the 1040 walk', get_filing_calendar: () => 'Reading the filing calendar' };

  /* ---------------- UI ---------------- */
  const turns = []; // {role, text}
  let apiMessages = []; // full content blocks for the API connection
  let openaiInput = []; // Responses items, including encrypted reasoning and tool results
  let selectedContext = null;
  let connection = null, connectionCheck = null;
  let accessToken = '', accessRevision = 0;
  let busy = false, ctl = null, samplePromise = null;
  const aside = document.getElementById('advisor');
  function sampleFn() {
    if (!samplePromise) samplePromise = (window.claude && window.claude.use) ? window.claude.use('sample').catch(() => null) : Promise.resolve(null);
    return samplePromise;
  }
  async function backend() {
    const s = TMP.state.settings;
    if (s.advisorBackend === 'api') return s.apiKey ? 'api' : null;
    if (s.advisorBackend === 'openai') return (await serverConnection()).configured ? 'openai' : null;
    if (s.advisorBackend !== 'claude' && (await serverConnection()).configured) return 'openai';
    const sm = await sampleFn();
    if (s.advisorBackend === 'claude') return sm ? 'claude' : null;
    return sm ? 'claude' : (s.apiKey ? 'api' : null);
  }
  async function serverConnection() {
    for (;;) {
      const revision = accessRevision;
      if (connection && connection.expires > Date.now()) return connection;
      if (!connectionCheck || connectionCheck.revision !== revision) {
        const check = { revision };
        check.promise = (async () => {
          let result = { configured: false };
          try {
            if (!window.location || window.location.protocol !== 'file:') {
              const signal = AbortSignal.timeout(5000);
              const response = await fetch('/api/ai/chat', { signal, headers: serverHeaders(), cache: 'no-store' });
              // Static hosts may serve the SPA HTML at an unknown API path.
              if (response.ok && /application\/json/i.test(response.headers.get('content-type') || '')) {
                const data = await response.json();
                if (data.provider === 'openai') result = { configured: data.configured === true, model: data.model, message: data.message, accessRequired: data.accessRequired };
              }
            }
          } catch (_) { /* local line explanations remain available */ }
          const checked = Object.assign(result, { expires: Date.now() + 30000 });
          if (revision === accessRevision) connection = checked;
          return checked;
        })().finally(() => { if (connectionCheck === check) connectionCheck = null; });
        connectionCheck = check;
      }
      const checked = await connectionCheck.promise;
      // A caller already waiting on the previous token must use the current
      // check too; an obsolete result must never answer a newly authorized ask.
      if (revision === accessRevision) return checked;
    }
  }
  function serverHeaders(json) {
    const headers = { accept: 'application/json' };
    if (json) headers['content-type'] = 'application/json';
    if (accessToken) headers.authorization = 'Bearer ' + accessToken;
    return headers;
  }
  function setAccessToken(value) {
    accessToken = String(value || '').trim();
    accessRevision++; connection = null;
    paintStatus();
  }
  function bindAccessToken() {
    const input = document.getElementById('in-advisor-access');
    if (input) { input.value = accessToken; input.onchange = () => setAccessToken(input.value); }
  }
  const SUGGEST = {
    t: ['Which planning column should we recommend, and why?', 'Why does AMT apply in the base column, and how could we reduce it?', 'What would harvesting another $100,000 of losses save?'],
    p: ['Which Rivera scenario should we act on, and by when?', 'How much should the Riveras pay for the January estimate?', 'Which Doe strategies give the best net benefit at low or medium risk?'],
    c: ['What is due in the next 30 days, and what blocks it?', 'Summarize the high-severity findings', 'What should I fix first in the Rivera workpaper?'],
    w: ['Why does the corrected return owe more than the workbook?', 'Walk me through the SE tax wage-base fix', 'What should line 16 be after the corrections?'],
    r: ['Should the Does make the §469(c)(7)(A) election?', 'Why is the §199A deduction zero?', 'What if taxable income drops to $480,000?'],
    h: ['Which five strategies give the best net benefit at low or medium risk?', 'Which selected strategies conflict with each other?', 'Explain the GRAT math for strategy #3'],
    x: ['Summarize the high-severity findings', 'What should I fix first in the 1040 workpaper?', 'Explain the rental election in plain terms'],
  };
  function shell() {
    aside.innerHTML = '<header><div style="flex:1"><h2>Tax advisor</h2><p id="advSub">Discuss the return, selected line, or planning scenario</p></div><button class="btn small ghost" id="advClear" title="Start a new conversation">New</button><button class="btn small ghost" id="advClose" aria-label="Close advisor">Close</button></header>' +
      '<div class="log" id="advLog" aria-live="polite"></div><div class="suggest" id="advSuggest"></div><div class="status" id="advStatus"></div>' +
      '<form id="advForm"><textarea id="advInput" rows="2" placeholder="Ask about a line, a rule or a strategy…" aria-label="Question for the advisor"></textarea><button class="btn primary" id="advSend" type="submit">Ask</button></form>';
    document.getElementById('advClose').onclick = toggle;
    document.getElementById('advClear').onclick = () => { if (ctl) ctl.abort(); turns.length = 0; apiMessages = []; openaiInput = []; selectedContext = null; paintLog(); };
    document.getElementById('advForm').onsubmit = (e) => { e.preventDefault(); if (busy) { ctl && ctl.abort(); return; } const t = document.getElementById('advInput'); const q = t.value.trim(); if (q) { t.value = ''; send(q); } };
    document.getElementById('advInput').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('advForm').requestSubmit(); } };
    paintLog(); paintSuggest(); paintStatus();
  }
  function paintSuggest() {
    const el = document.getElementById('advSuggest'); if (!el) return;
    const v = TMP.state.view; const key = ['home', 'client', 'walk', 'scen'].includes(v) || v.startsWith('m-') ? 't' : v === 'p-home' || v === 'p-rivera' ? 'p' : v === 'c-home' || v === 'calendar' || v === 'findings' ? 'c' : v[0] === 'w' || v[0] === 'r' || v[0] === 'h' ? v[0] : 'x';
    const list = SUGGEST[key];
    el.innerHTML = turns.length ? '' : list.map((q) => '<button type="button">' + esc(q) + '</button>').join('');
    el.querySelectorAll('button').forEach((b) => { b.onclick = () => send(b.textContent); });
  }
  async function paintStatus() {
    const el = document.getElementById('advStatus'); if (!el) return;
    const b = await backend();
    const openai = b === 'openai' ? await serverConnection() : null;
    el.innerHTML = openai && openai.configured ? 'OpenAI server connection' + (openai.model ? ' · ' + esc(openai.model) : '') : b === 'claude' ? 'Using your Claude account. The first question asks for permission.' : b === 'api' ? 'Using your Anthropic API key · ' + esc(TMP.state.settings.apiModel) : (connection && connection.message ? esc(connection.message) + ' <a href="#settings">Advisor Settings</a>.' : 'AI chat is not connected. Configure the server connection in <a href="#settings">Settings</a>. Line explanations work without a connection.');
  }
  function paintLog() {
    const log = document.getElementById('advLog'); if (!log) return;
    log.innerHTML = turns.length ? turns.map((t, i) => '<div class="msg ' + (t.role === 'user' ? 'user' : 'bot') + '" data-i="' + i + '">' + (t.role === 'user' ? esc(t.text) : renderBot(t)) + '</div>').join('') :
      '<div class="msg bot"><p>Ask about any line, column, rule or strategy. I can read the 1040 walk and every module, test a change with a what-if, and change an input when you ask me to.</p></div>';
    log.scrollTop = log.scrollHeight;
    paintSuggest();
  }
  function renderBot(t) {
    return (t.tools || []).map((x) => '<div class="tool">' + esc(x) + '</div>').join('') + (t.text ? md(t.text) : (t.pending ? '<div class="thinking">Thinking…</div>' : '')) + (t.error ? '<div class="err">' + esc(t.error) + '</div>' : '') + (t.note ? '<div class="muted small">' + esc(t.note) + '</div>' : '');
  }
  function updateLast(t) { const log = document.getElementById('advLog'); const el = log && log.querySelector('[data-i="' + (turns.length - 1) + '"]'); if (el) { el.innerHTML = renderBot(t); log.scrollTop = log.scrollHeight; } }
  function setBusy(b) { busy = b; const btn = document.getElementById('advSend'); if (btn) { btn.textContent = b ? 'Stop' : 'Ask'; btn.classList.toggle('primary', !b); } }

  function toggle() { const app = document.querySelector('.app'); const open = !app.classList.contains('advisor-open'); app.classList.toggle('advisor-open', open); aside.hidden = !open; if (open) { paintStatus(); paintSuggest(); setTimeout(() => { const i = document.getElementById('advInput'); i && i.focus(); }, 50); } }
  function ask(q, context) { const app = document.querySelector('.app'); if (!app.classList.contains('advisor-open')) toggle(); return send(q, context === undefined ? null : context); }

  function localExplanation(context) {
    if (!context || typeof context !== 'object' || !context.lineKey || !Number.isFinite(context.value)) return '';
    const lines = [
      '**Local calculation explanation**',
      'Line ' + context.line + ' · ' + context.label + ' · ' + context.column + (context.year ? ' · TY' + context.year : ''),
      '**Current amount: ' + TMP.money(context.value) + '**' + (context.status ? ' · ' + context.status : ''),
      context.how || 'This amount comes from the current tax engine and client inputs.'
    ];
    const values = (title, rows) => {
      if (!Array.isArray(rows) || !rows.length) return;
      lines.push('**' + title + '**', rows.map(row => '- ' + row.label + ': ' + TMP.money(row.value)).join('\n'));
    };
    values('Calculation detail', context.details);
    values('Source detail', context.sources);
    if (context.authority) lines.push('**Authority:** ' + context.authority);
    if (Array.isArray(context.diagnostics) && context.diagnostics.length) lines.push('**Review items**', context.diagnostics.map(item => '- ' + item.text).join('\n'));
    if (Array.isArray(context.changes) && context.changes.length) lines.push('**What changes this line**', context.changes.map(text => '- ' + text).join('\n'));
    return lines.join('\n\n');
  }

  async function send(q, context) {
    if (busy) return;
    q = String(q || '').trim();
    if (!q) return;
    if (context !== undefined) selectedContext = context;
    if (selectedContext && selectedContext.lineKey && TMP.TMV.explainLine) selectedContext = TMP.TMV.explainLine(selectedContext.lineKey, selectedContext.columnIndex) || selectedContext;
    const contextualQuestion = selectedContext ? q + '\n\n[Selected Form 1040 line and column context]\n' + (typeof selectedContext === 'string' ? selectedContext : JSON.stringify(selectedContext)) : q;
    setBusy(true); ctl = new AbortController();
    turns.push({ role: 'user', text: q });
    const bot = { role: 'assistant', text: '', tools: [], pending: true };
    turns.push(bot); paintLog();
    try {
      const b = await backend();
      ctl.signal.throwIfAborted();
      if (!b) {
        bot.text = localExplanation(selectedContext);
        if (bot.text) bot.note = 'Calculated locally from the current return. Connect OpenAI in Settings for a conversational answer.';
        else bot.error = connection && connection.message || 'AI chat is not connected. Configure OPENAI_API_KEY in the server environment. You can still use the line explanations and all tax calculations.';
        return;
      }
      if (b === 'openai') await viaOpenAI(contextualQuestion, bot, ctl.signal);
      else if (b === 'claude') await viaClaude(contextualQuestion, bot, ctl.signal);
      else await viaApi(contextualQuestion, bot, ctl.signal);
    } catch (e) {
      if (e && e.code === 'cancelled' || (e && e.name === 'AbortError')) { bot.note = 'Stopped.'; if (e.text) bot.text = e.text; }
      else { bot.error = errorText(e); if (e && e.text) bot.text = e.text; }
    } finally {
      bot.pending = false; updateLast(bot); setBusy(false); ctl = null;
    }
  }

  /* ---- OpenAI server connection ---- */
  async function viaOpenAI(q, bot, signal) {
    openaiInput.push({ role: 'user', content: '[Current state of the app]\n' + TMP.summary() + '\n\n[Question]\n' + q });
    const tools = TOOLS.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema || { type: 'object', properties: {} }, strict: false }));
    for (let round = 0; round < 8; round++) {
      signal.throwIfAborted();
      const response = await fetch('/api/ai/chat', {
        method: 'POST', headers: serverHeaders(true),
        body: JSON.stringify({ instructions: RULES, input: openaiInput, tools }), signal
      });
      if (!/application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('The AI server route is unavailable. Run the app with its Node server or deploy the API routes.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The AI request failed (' + response.status + ').');
      if (!Array.isArray(data.output)) throw new Error('The AI server returned an unreadable response.');
      // Preserve the entire Responses output, including reasoning, before tools.
      openaiInput.push(...data.output);
      if (data.text) { bot.text += (bot.text ? '\n\n' : '') + data.text; bot.pending = false; updateLast(bot); }
      if (data.truncated) { bot.note = 'The answer reached its length limit. Ask a narrower question.'; return; }
      const calls = data.output.filter(item => item.type === 'function_call');
      if (!calls.length) return;
      for (const call of calls) {
        signal.throwIfAborted();
        let output;
        try {
          const tool = TOOLS.find(t => t.name === call.name);
          if (!tool) throw new Error('Unknown advisor tool.');
          const args = JSON.parse(call.arguments);
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments.');
          bot.tools.push(TOOL_LABEL[tool.name](args)); updateLast(bot);
          output = JSON.stringify(tool.run(args));
        } catch (e) { output = JSON.stringify({ error: e.message }); }
        openaiInput.push({ type: 'function_call_output', call_id: call.call_id, output });
      }
    }
    bot.note = 'Stopped after 8 tool rounds. Ask a narrower follow-up question.';
  }
  function errorText(e) {
    const c = e && e.code;
    const map = { not_granted: 'Claude access was not allowed for this page. Reload to be asked again, or use an API key in Settings.', sampling_disabled: 'Claude is not available for this account.', rate_limited: 'Too many requests right now. Wait a minute and ask again.', session_expired: 'Your claude.ai session expired. Sign in again.', refused: 'Claude declined this request. Rephrase the question.', prompt_too_large: 'The conversation is too long. Start a new one.', tools_unavailable: 'This view cannot run the advisor tools.', empty_completion: 'No answer came back. Try a simpler question.' };
    if (c && map[c]) return map[c];
    return (e && e.message) || 'The advisor could not answer. Try again.';
  }

  /* ---- claude.ai connection ---- */
  async function viaClaude(q, bot, signal) {
    const sample = await sampleFn();
    let tools = TOOLS;
    try { const lim = await sample.limits(); if (!lim.tools) tools = null; else if (lim.tools.maxCount < TOOLS.length) tools = TOOLS.slice(0, lim.tools.maxCount); } catch (e) { /* use all */ }
    const history = turns.slice(0, -2).filter((t) => t.text).slice(-10).map((t) => ({ role: t.role, content: t.text }));
    const input = [{ role: 'user', content: RULES + '\n\nCurrent state of the app:\n' + TMP.summary() + '\n\nAnswer in Markdown.' }, ...history, { role: 'user', content: q }];
    const opts = {
      signal, cache: false, modelTier: TMP.state.settings.advisorTier || 'default',
      onText: ({ text }) => { bot.text = text; bot.pending = false; updateLast(bot); },
    };
    if (tools) {
      delete opts.cache;
      opts.tools = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema || { type: 'object', properties: {} }, execute: (inp) => { bot.tools.push(TOOL_LABEL[t.name](inp || {})); updateLast(bot); return t.run(inp || {}); } }));
    }
    const res = await sample(input, opts);
    bot.text = res.text;
    if (res.truncated) bot.note = 'The answer was cut short. Ask for less at a time.';
  }

  /* ---- Anthropic API connection ---- */
  async function viaApi(q, bot, signal) {
    const s = TMP.state.settings;
    const model = (s.apiModel || 'claude-opus-5').trim();
    apiMessages.push({ role: 'user', content: '[Current state of the app]\n' + TMP.summary() + '\n\n[Question]\n' + q });
    const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} }, eager_input_streaming: true }));
    const withFallback = /^claude-(opus-5|fable-5)/.test(model);
    for (let round = 0; round < 8; round++) {
      const body = { model, max_tokens: 16000, stream: true, system: RULES, messages: apiMessages, tools, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } };
      if (withFallback) body.fallbacks = 'default';
      const headers = { 'content-type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
      if (withFallback) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      const resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal });
      if (!resp.ok) {
        let msg = 'Request failed (' + resp.status + ').';
        try { const j = await resp.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) { /* keep */ }
        if (resp.status === 401) msg = 'The API key was rejected. Check it in Settings.';
        if (resp.status === 429) msg = 'Rate limited by the API. Wait a moment and ask again.';
        apiMessages.pop();
        throw new Error(msg);
      }
      const baseText = bot.text ? bot.text + '\n\n' : '';
      const msg = await readStream(resp, (text) => { bot.text = baseText + text; bot.pending = false; updateLast(bot); });
      apiMessages.push({ role: 'assistant', content: msg.content });
      if (msg.stop_reason === 'refusal') { bot.error = 'Claude declined this request. Rephrase the question.'; apiMessages.splice(-2, 2); return; }
      if (msg.stop_reason === 'max_tokens') { bot.note = 'The answer hit the length limit.'; return; }
      if (msg.stop_reason !== 'tool_use') return;
      const results = [];
      for (const blk of msg.content.filter((c) => c.type === 'tool_use')) {
        const t = TOOLS.find((x) => x.name === blk.name);
        let content, isErr = false;
        try {
          if (!t) throw new Error('Unknown tool ' + blk.name);
          if (blk._badJson) throw new Error('INVALID_JSON: the tool input could not be parsed. Send it again.');
          bot.tools.push(TOOL_LABEL[t.name](blk.input || {})); updateLast(bot);
          content = JSON.stringify(t.run(blk.input || {}));
        } catch (e) { content = 'Error: ' + e.message; isErr = true; }
        results.push({ type: 'tool_result', tool_use_id: blk.id, content, is_error: isErr || undefined });
      }
      msg.content.forEach((c) => { delete c._badJson; });
      apiMessages.push({ role: 'user', content: results });
    }
    bot.note = 'Stopped after 8 tool rounds.';
  }
  async function readStream(resp, onText) {
    const reader = resp.body.getReader(); const dec = new TextDecoder();
    let buf = '', text = '';
    const blocks = []; let stop = null;
    const partial = {};
    function handle(ev) {
      if (ev.type === 'content_block_start') {
        const b = Object.assign({}, ev.content_block); blocks[ev.index] = b;
        if (b.type === 'tool_use') { b.input = {}; partial[ev.index] = ''; }
      } else if (ev.type === 'content_block_delta') {
        const b = blocks[ev.index]; const d = ev.delta;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; text += d.text; onText(text); }
        else if (d.type === 'input_json_delta') partial[ev.index] += d.partial_json;
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        else if (d.type === 'citations_delta') { (b.citations = b.citations || []).push(d.citation); }
      } else if (ev.type === 'content_block_stop') {
        const b = blocks[ev.index];
        if (b && b.type === 'tool_use') { try { b.input = partial[ev.index] ? JSON.parse(partial[ev.index]) : {}; if (typeof b.input !== 'object' || Array.isArray(b.input)) throw new Error('bad'); } catch (e) { b.input = {}; b._badJson = true; } }
        if (b && b.type === 'text' && text && !text.endsWith('\n')) { text += '\n\n'; }
      } else if (ev.type === 'message_delta') { if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason; }
      else if (ev.type === 'error') { throw new Error((ev.error && ev.error.message) || 'Stream error'); }
    }
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (data) { let ev; try { ev = JSON.parse(data); } catch (e) { continue; } handle(ev); }
      }
    }
    return { content: blocks.filter(Boolean), stop_reason: stop };
  }

  /* ---------------- tiny Markdown renderer (escapes first) ---------------- */
  function inline(s) {
    return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/(^|[\s(])#(w-tie|w-sources|w-sched|w-review|r-props|r-469|r-199a|r-statements|h-dash|h-matrix|h-cost|h-check|findings)\b/g, '$1<a href="#$2">#$2</a>');
  }
  function md(src) {
    const lines = esc(src).split('\n'); let out = '', list = null, para = [];
    const flushP = () => { if (para.length) { out += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
    const flushL = () => { if (list) { out += '</' + list + '>'; list = null; } };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        flushP(); flushL();
        const cells = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
        out += '<table><thead><tr>' + cells(l).map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>';
        i += 2; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { out += '<tr>' + cells(lines[i]).map((c) => '<td>' + c + '</td>').join('') + '</tr>'; i++; }
        i--; out += '</tbody></table>'; continue;
      }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { flushP(); flushL(); out += '<p><strong>' + inline(m[2]) + '</strong></p>'; }
      else if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { flushP(); if (list !== 'ul') { flushL(); out += '<ul>'; list = 'ul'; } out += '<li>' + inline(m[1]) + '</li>'; }
      else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { flushP(); if (list !== 'ol') { flushL(); out += '<ol>'; list = 'ol'; } out += '<li>' + inline(m[1]) + '</li>'; }
      else if (!l.trim()) { flushP(); flushL(); }
      else { flushL(); para.push(l); }
    }
    flushP(); flushL();
    return out;
  }

  window.Advisor = TMP.advisor = { toggle, ask, md, tools: TOOLS, setAccessToken };
  shell();
  bindAccessToken();
  document.addEventListener('tmp:render', () => { bindAccessToken(); if (!aside.hidden) { paintSuggest(); paintStatus(); } });
})();
