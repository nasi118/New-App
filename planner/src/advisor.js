/* Tax Master Planner — AI tax advisor.
 * Two connections:
 *   claude.ai: the artifact runtime's `sample` capability (viewer's own Claude account, page tools)
 *   API key:   Anthropic Messages API from the browser, streamed, with the same page tools
 */
(function () {
  'use strict';
  const TMP = window.TMP, E = window.Engine;
  const esc = TMP.esc;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const RULES = [
    'You are the tax advisor built into Tax Master Planner, a working tool for a U.S. tax professional.',
    'The app has two workspaces over the same client data. Planning: Rivera tax scenarios and 2026 safe-harbor estimates, the Doe rental election and ownership analysis, and John Doe\'s wealth strategy package. Compliance: the Rivera 2025 Form 1040 tie-out and review, the Doe rental return positions and election statements, review findings, and a filing calendar that also picks up filings created by selected planning strategies.',
    'The client models were rebuilt from spreadsheets: (1) a Form 1040 reconciliation workpaper for Jordan and Casey Rivera, MFJ, tax year 2025 (fictional training data); (2) a rental holding company analysis for John and Jane Doe (JD Rental Holdings LLC, four disregarded property LLCs, TY2026) covering the §469(c)(7)(A) real estate professional election and §199A aggregation; (3) a 50-strategy high-net-worth planning comparison for John Doe (2026).',
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
      _hn: hn,
    };
  }
  function parseValue(v) { if (typeof v === 'number' || typeof v === 'boolean') return v; const s = String(v).trim(); if (/^(true|false)$/i.test(s)) return /^true$/i.test(s); const x = s.replace(/[$,]/g, ''); return x !== '' && isFinite(+x) ? +x : s; }
  function checkPath(path) {
    if (typeof path !== 'string' || !/^(w1040|rental|hnwi|calendar)\.[\w.-]+$/.test(path)) throw new Error('Path must start with w1040., rental., hnwi. or calendar. and use dot notation, for example w1040.other.cashCharity');
    const cur = TMP.getPath(TMP.state.data, path);
    if (cur === undefined && /^calendar\./.test(path)) return 'Not started';
    if (cur === undefined && /^w1040\.planning\.scenarios\.\d+\.levers\.\w+$/.test(path)) return 0;
    if (cur === undefined) throw new Error('No input at ' + path + '. Read the schedule or strategy first to find input paths.');
    if (cur !== null && typeof cur === 'object') throw new Error(path + ' is a group, not a single input.');
    return cur;
  }
  function diff(a, b) {
    const out = {};
    ['w1040', 'rental', 'hnwi'].forEach((m) => { Object.keys(a[m]).forEach((k) => { if (JSON.stringify(a[m][k]) !== JSON.stringify(b[m][k])) out[m + '.' + k] = { before: a[m][k], after: b[m][k] }; }); });
    return out;
  }
  const TOOLS = [
    {
      name: 'get_tax_scenarios',
      description: 'Read the Rivera planning scenarios (2025 what-if or 2026 projection) with each scenario\'s levers and results, plus the 2026 safe-harbor estimated tax. Lever inputs are at w1040.planning.scenarios.<i>.levers.<sepIra|hsa|charity|harvest|roth|schCExpense|extraEst>; year at w1040.planning.year; growth at w1040.planning.growth.',
      run() {
        const r = TMP.compute(); const pl = TMP.state.data.w1040.planning;
        return { year: pl.year, growth: pl.growth, scenarios: r.scen.map((x, i) => ({ index: i, name: x.name, levers: pl.scenarios[i].levers, agi: r0(x.v.f.l11b), taxableIncome: r0(x.v.f.l15), incomeTax: r0(x.v.f.l16), seTax: x.v.se.j, niit: r0(x.v.s2.l12), totalTax: r0(x.v.f.l24), marginalRate: r0(x.marginal), cashOutlay: x.cash, refundOrOwed: r0(x.v.net), sepIraMax: Math.round(x.sepMax) })), safeHarbor: r.safeHarbor };
      },
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
      description: 'Test changes without saving them. Give one or more {path, value} pairs (paths as returned by the other tools, e.g. w1040.other.cashCharity, rental.taxableIncome, hnwi.strategies.8.I). Returns key results before and after.',
      inputSchema: { type: 'object', properties: { changes: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, value: {} }, required: ['path', 'value'] } } }, required: ['changes'] },
      run(input) {
        const changes = Array.isArray(input.changes) ? input.changes : [];
        if (!changes.length) throw new Error('Pass at least one change.');
        const before = metrics(TMP.state.data); const data = clone(TMP.state.data);
        changes.forEach((c) => { checkPath(c.path); const ks = c.path.split('.'); let o = data; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = parseValue(c.value); });
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
        const from = checkPath(input.path); const value = parseValue(input.value);
        if (typeof from === 'number' && typeof value !== 'number') throw new Error(input.path + ' needs a number.');
        const before = metrics(TMP.state.data);
        TMP.applyChange(input.path, value, 'advisor', String(input.reason || '').slice(0, 120));
        TMP.render();
        TMP.toast('Advisor changed ' + input.path.split('.').slice(-2).join(' ') + '. See the change log to undo.');
        return { changed: input.path, from, to: value, results: diff(before, metrics(TMP.state.data)) };
      },
    },
    {
      name: 'open_view',
      description: 'Show a view to the user. Planning views: p-home, p-rivera, r-props, r-469, h-dash, h-matrix, h-cost, h-check. Compliance views: c-home, calendar, findings, w-tie, w-sources, w-sched, w-review, r-199a, r-statements. Library: sources, audit, settings. For w-sched pass tab (schA, schB, schC, schD, schE, f8582, schSE, f8995, s8812, sch1, sch2, sch3, taxCalc).',
      inputSchema: { type: 'object', properties: { view: { type: 'string' }, tab: { type: 'string' } }, required: ['view'] },
      run(input) { const v = String(input.view); if (!TMP.VIEWS[v]) throw new Error('Unknown view ' + v); if (input.tab) TMP.state.tab.sched = String(input.tab); TMP.go(v); return { opened: v }; },
    },
  ];
  const SCHED_NAME = { f1040: 'Form 1040', control: 'the control panel', schA: 'Schedule A', schB: 'Schedule B', schC: 'Schedule C', schD: 'Schedule D', schE: 'Schedule E', f8582: 'Form 8582', schSE: 'Schedule SE', f8995: 'Form 8995', s8812: 'Schedule 8812', sch1: 'Schedule 1', sch2: 'Schedule 2', sch3: 'Schedule 3', taxCalc: 'the tax calculation' };
  const TOOL_LABEL = { get_1040_schedule: (i) => 'Reading ' + (SCHED_NAME[i.schedule] || 'a schedule'), get_rental_analysis: () => 'Reading the rental analysis', get_strategy: (i) => (i.no ? 'Reading strategy #' + i.no : 'Listing strategies'), list_findings: () => 'Reading findings', what_if: () => 'Running a what-if', set_input: (i) => 'Changing ' + i.path, open_view: (i) => 'Opening ' + i.view, get_tax_scenarios: () => 'Reading the tax scenarios', get_filing_calendar: () => 'Reading the filing calendar' };

  /* ---------------- UI ---------------- */
  const turns = []; // {role, text}
  let apiMessages = []; // full content blocks for the API connection
  let busy = false, ctl = null, samplePromise = null;
  const aside = document.getElementById('advisor');
  function sampleFn() {
    if (!samplePromise) samplePromise = (window.claude && window.claude.use) ? window.claude.use('sample').catch(() => null) : Promise.resolve(null);
    return samplePromise;
  }
  async function backend() {
    const s = TMP.state.settings;
    if (s.advisorBackend === 'api') return s.apiKey ? 'api' : null;
    const sm = await sampleFn();
    if (s.advisorBackend === 'claude') return sm ? 'claude' : null;
    return sm ? 'claude' : (s.apiKey ? 'api' : null);
  }
  const SUGGEST = {
    p: ['Which Rivera scenario should we act on, and by when?', 'How much should the Riveras pay for the January estimate?', 'Which Doe strategies give the best net benefit at low or medium risk?'],
    c: ['What is due in the next 30 days, and what blocks it?', 'Summarize the high-severity findings', 'What should I fix first in the Rivera workpaper?'],
    w: ['Why does the corrected return owe more than the workbook?', 'Walk me through the SE tax wage-base fix', 'What should line 16 be after the corrections?'],
    r: ['Should the Does make the §469(c)(7)(A) election?', 'Why is the §199A deduction zero?', 'What if taxable income drops to $480,000?'],
    h: ['Which five strategies give the best net benefit at low or medium risk?', 'Which selected strategies conflict with each other?', 'Explain the GRAT math for strategy #3'],
    x: ['Summarize the high-severity findings', 'What should I fix first in the 1040 workpaper?', 'Explain the rental election in plain terms'],
  };
  function shell() {
    aside.innerHTML = '<header><div style="flex:1"><h2>Tax advisor</h2><p id="advSub">Asks Claude about the figures on screen</p></div><button class="btn small ghost" id="advClear" title="Start a new conversation">New</button><button class="btn small ghost" id="advClose" aria-label="Close advisor">Close</button></header>' +
      '<div class="log" id="advLog" aria-live="polite"></div><div class="suggest" id="advSuggest"></div><div class="status" id="advStatus"></div>' +
      '<form id="advForm"><textarea id="advInput" rows="2" placeholder="Ask about a line, a rule or a strategy…" aria-label="Question for the advisor"></textarea><button class="btn primary" id="advSend" type="submit">Ask</button></form>';
    document.getElementById('advClose').onclick = toggle;
    document.getElementById('advClear').onclick = () => { if (ctl) ctl.abort(); turns.length = 0; apiMessages = []; paintLog(); };
    document.getElementById('advForm').onsubmit = (e) => { e.preventDefault(); if (busy) { ctl && ctl.abort(); return; } const t = document.getElementById('advInput'); const q = t.value.trim(); if (q) { t.value = ''; send(q); } };
    document.getElementById('advInput').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('advForm').requestSubmit(); } };
    paintLog(); paintSuggest(); paintStatus();
  }
  function paintSuggest() {
    const el = document.getElementById('advSuggest'); if (!el) return;
    const v = TMP.state.view; const key = v === 'p-home' || v === 'p-rivera' ? 'p' : v === 'c-home' || v === 'calendar' || v === 'findings' ? 'c' : v[0] === 'w' || v[0] === 'r' || v[0] === 'h' ? v[0] : 'x';
    const list = SUGGEST[key];
    el.innerHTML = turns.length ? '' : list.map((q) => '<button type="button">' + esc(q) + '</button>').join('');
    el.querySelectorAll('button').forEach((b) => { b.onclick = () => send(b.textContent); });
  }
  async function paintStatus() {
    const el = document.getElementById('advStatus'); if (!el) return;
    const b = await backend();
    el.innerHTML = b === 'claude' ? 'Using your Claude account. The first question asks for permission.' : b === 'api' ? 'Using your Anthropic API key · ' + esc(TMP.state.settings.apiModel) : 'Not connected. Open this page on claude.ai, or add an Anthropic API key in <a href="#settings">Settings</a>.';
  }
  function paintLog() {
    const log = document.getElementById('advLog'); if (!log) return;
    log.innerHTML = turns.length ? turns.map((t, i) => '<div class="msg ' + (t.role === 'user' ? 'user' : 'bot') + '" data-i="' + i + '">' + (t.role === 'user' ? esc(t.text) : renderBot(t)) + '</div>').join('') :
      '<div class="msg bot"><p>Ask about any figure, rule or strategy in the three client files. I can read every schedule, test a change with a what-if, and change an input when you ask me to.</p></div>';
    log.scrollTop = log.scrollHeight;
    paintSuggest();
  }
  function renderBot(t) {
    return (t.tools || []).map((x) => '<div class="tool">' + esc(x) + '</div>').join('') + (t.text ? md(t.text) : (t.pending ? '<div class="thinking">Thinking…</div>' : '')) + (t.error ? '<div class="err">' + esc(t.error) + '</div>' : '') + (t.note ? '<div class="muted small">' + esc(t.note) + '</div>' : '');
  }
  function updateLast(t) { const log = document.getElementById('advLog'); const el = log && log.querySelector('[data-i="' + (turns.length - 1) + '"]'); if (el) { el.innerHTML = renderBot(t); log.scrollTop = log.scrollHeight; } }
  function setBusy(b) { busy = b; const btn = document.getElementById('advSend'); if (btn) { btn.textContent = b ? 'Stop' : 'Ask'; btn.classList.toggle('primary', !b); } }

  function toggle() { const app = document.querySelector('.app'); const open = !app.classList.contains('advisor-open'); app.classList.toggle('advisor-open', open); aside.hidden = !open; if (open) { paintStatus(); paintSuggest(); setTimeout(() => { const i = document.getElementById('advInput'); i && i.focus(); }, 50); } }
  function ask(q) { const app = document.querySelector('.app'); if (!app.classList.contains('advisor-open')) toggle(); send(q); }

  async function send(q) {
    if (busy) return;
    const b = await backend();
    turns.push({ role: 'user', text: q });
    const bot = { role: 'assistant', text: '', tools: [], pending: true };
    turns.push(bot); paintLog();
    if (!b) { bot.pending = false; bot.error = 'The advisor is not connected. Open this page on claude.ai, or add an Anthropic API key in Settings.'; updateLast(bot); return; }
    setBusy(true); ctl = new AbortController();
    try {
      if (b === 'claude') await viaClaude(q, bot, ctl.signal); else await viaApi(q, bot, ctl.signal);
    } catch (e) {
      if (e && e.code === 'cancelled' || (e && e.name === 'AbortError')) { bot.note = 'Stopped.'; if (e.text) bot.text = e.text; }
      else { bot.error = errorText(e); if (e && e.text) bot.text = e.text; }
    } finally {
      bot.pending = false; updateLast(bot); setBusy(false); ctl = null;
    }
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

  window.Advisor = { toggle, ask, md, tools: TOOLS };
  shell();
  document.addEventListener('tmp:render', () => { if (!aside.hidden) { paintSuggest(); paintStatus(); } });
})();
