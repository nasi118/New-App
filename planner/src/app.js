/* Tax Master Planner — UI. Vanilla JS, one render function per view. */
(function () {
  'use strict';
  const E = window.Engine;
  const SEED = window.SEED;
  const STORE = 'tax-master-planner.v2';
  const TM = window.TM;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = E.n;

  const DEFAULT_SETTINGS = {
    mode: 'corrected', tolerance: SEED.w1040.tolerance || 1, taxSource: 'software', niitSource: 'input',
    rentalThreshold: 403500, rentalPhaseRange: 150000, rentalMarginal: 0.35,
    advisorBackend: 'auto', advisorTier: 'default', apiModel: 'claude-opus-5', apiKey: '', rememberKey: false,
    preparer: '', firm: '', workspace: 'planning', theme: 'system',
  };

  function defaultPlanning() {
    return { year: 2026, growth: 0.03, paid2026: 0, scenarios: [
      { name: 'Baseline', levers: {} },
      { name: 'Fund SEP-IRA', levers: { sepIra: 6000 } },
      { name: 'SEP + extra giving', levers: { sepIra: 6000, charity: 6500 } },
      { name: 'Harvest losses', levers: { harvest: 20000 } },
    ] };
  }
  function freshTm() { const clients = window.TM_DEMO_CLIENTS(clone(SEED)); return { clients, active: clients[0].id }; }
  function freshData() {
    const d = clone(SEED);
    d.w1040.returnAmounts = {};
    if (d.w1040.sch1 && d.w1040.sch1.sepIra === undefined) d.w1040.sch1.sepIra = 0;
    d.rental.scenarioPcts = d.rental.owners.map((o) => o.pct);
    d.findingStatus = {};
    d.calendar = {};
    d.w1040.planning = defaultPlanning();
    d.tm = freshTm();
    return d;
  }

  const state = { data: freshData(), settings: clone(DEFAULT_SETTINGS), audit: [], view: 'home', tab: {}, ui: { open: {}, filter: {}, sel: {} } };
  const extensions = [];
  let shellUI, dataUI;
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.data) state.data = saved.data;
      if (saved.settings) state.settings = Object.assign(clone(DEFAULT_SETTINGS), saved.settings);
      if (saved.audit) state.audit = saved.audit;
      if (!state.data.w1040.planning) state.data.w1040.planning = defaultPlanning();
      if (!state.data.calendar) state.data.calendar = {};
      if (!state.data.tm || !state.data.tm.clients || !state.data.tm.clients.length) state.data.tm = freshTm();
      if (state.data.w1040.sch1 && state.data.w1040.sch1.sepIra === undefined) state.data.w1040.sch1.sepIra = 0;
    }
  } catch (e) { /* storage unavailable: run from seed */ }

  function save() {
    try {
      const settings = Object.assign({}, state.settings);
      if (!settings.rememberKey) settings.apiKey = '';
      localStorage.setItem(STORE, JSON.stringify({ data: state.data, settings, audit: state.audit.slice(-500) }));
    } catch (e) { /* ignore */ }
  }

  /* ---------------- formatting ---------------- */
  const fmtNum = (v, dp) => {
    v = n(v); const neg = v < 0 && Math.abs(v) >= (dp ? 0.005 : 0.5);
    const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 });
    return neg ? '(' + s + ')' : s;
  };
  const money = (v) => E.fmt(v);
  const moneyM = (v) => { v = n(v); const a = Math.abs(v); const s = a >= 1e6 ? '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M' : a >= 1e3 ? '$' + Math.round(a / 1e3) + 'K' : '$' + Math.round(a); return (v < 0 ? '−' : '') + s; };
  const pct = (v, dp) => (n(v) * 100).toFixed(dp == null ? 1 : dp) + '%';
  const cellNum = (v, dp) => '<td class="n' + (n(v) < -0.004 ? ' neg' : '') + '">' + fmtNum(v, dp) + '</td>';
  const chip = (cls, text) => '<span class="chip ' + cls + '">' + esc(text) + '</span>';
  const passChip = (ok, yes, no) => chip(ok ? 'ok' : 'bad', ok ? (yes || 'Pass') : (no || 'Fail'));

  /* ---------------- paths & binding ---------------- */
  function pathKeys(path) {
    const keys = String(path).split('.');
    if (keys.some((key) => !key || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Invalid input path.');
    return keys;
  }
  function getPath(obj, path) { return pathKeys(path).reduce((o, k) => (o == null ? undefined : o[k]), obj); }
  function setPath(obj, path, val) {
    const ks = pathKeys(path); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = val;
  }
  function parseVal(type, raw) {
    if (type === 'numopt') { const s = String(raw).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'); return s === '' ? undefined : (isFinite(+s) ? +s : null); }
    if (type === 'num') { const s = String(raw).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'); return s === '' ? 0 : (isFinite(+s) ? +s : null); }
    if (type === 'pct') { const s = String(raw).replace(/[%\s]/g, ''); return s === '' ? 0 : (isFinite(+s) ? +s / 100 : null); }
    if (type === 'bool') return !!raw;
    return raw;
  }
  function label(path) {
    const m = /^tm\.clients\.(\d+)\.(.*)$/.exec(path);
    if (m) { const c = state.data.tm && state.data.tm.clients[+m[1]]; return (c ? (c.info.name || 'Client') : 'Client') + ' › ' + m[2].replace(/^direct\./, '1040 walk › ').replace(/^cols\.(\d+)\.(ov|lv)\./, (x, j, k) => 'Column ' + (+j + 2) + ' › ' + (k === 'lv' ? 'move ' : '')).replace(/^mod\./, ''); }
    return path.replace(/^ret:/, '1040 › Software amount ').replace(/^findingStatus\./, 'Finding › ').replace(/^w1040\./, '1040 › ').replace(/^rental\./, 'Rental › ').replace(/^hnwi\./, 'HNWI › ').replace(/^settings\./, 'Settings › '); }

  // Apply a change to data or settings, with audit trail. Returns {ok, error}
  function applyChange(path, value, by, note) {
    const root = path.startsWith('settings.') ? state : state.data;
    const rel = path.startsWith('settings.') ? path : path;
    const from = getPath(root, rel);
    if (JSON.stringify(from) === JSON.stringify(value)) return { ok: true, unchanged: true };
    if (value === undefined) { const ks = rel.split('.'); const parent = getPath(root, ks.slice(0, -1).join('.')); if (parent) delete parent[ks[ks.length - 1]]; } else setPath(root, rel, value);
    if (!/apiKey/.test(path)) {
      const match = /^tm\.clients\.(\d+)\./.exec(path);
      const client = match && state.data.tm.clients[+match[1]];
      state.audit.push({ ts: new Date().toISOString(), by: by || 'you', path, from: from === undefined ? null : from, to: value, note: note || '',
        ...(client ? { clientId: client.id, clientName: client.info.name, recordYear: client.info.year } : {}) });
    }
    save();
    invalidate();
    return { ok: true, from };
  }
  // Return/software overrides are keyed by line keys that contain dots, so they bypass setPath
  function setReturnAmount(key, value, by, note) {
    const ra = state.data.w1040.returnAmounts || (state.data.w1040.returnAmounts = {});
    const from = key in ra ? ra[key] : null;
    if (from === value) return;
    if (value === null) delete ra[key]; else ra[key] = value;
    state.audit.push({ ts: new Date().toISOString(), by: by || 'you', path: 'ret:' + key, from, to: value, note: note || (value === null ? 'Cleared software amount' : 'Software amount') });
    save(); invalidate();
  }
  function undo(i) {
    const a = state.audit[i]; if (!a || a.undone || a.noUndo) return;
    if (a.path.startsWith('ret:')) { a.undone = true; setReturnAmount(a.path.slice(4), a.from, 'you', 'Undo'); render(); return; }
    if (a.path.startsWith('findingStatus.')) { const id = a.path.split('.')[1]; state.data.findingStatus[id] = Object.assign(state.data.findingStatus[id] || {}, { status: a.from }); }
    const root = a.path.startsWith('settings.') ? state : state.data;
    if (!a.path.startsWith('findingStatus.')) { if (a.from == null && /\.(direct|ov|lv)\./.test(a.path)) { const ks = a.path.split('.'); const parent = getPath(root, ks.slice(0, -1).join('.')); if (parent) delete parent[ks[ks.length - 1]]; } else setPath(root, a.path, a.from); }
    a.undone = true;
    state.audit.push({ ts: new Date().toISOString(), by: 'you', path: a.path, from: a.to, to: a.from, note: 'Undo',
      ...(a.clientId ? { clientId: a.clientId, clientName: a.clientName, recordYear: a.recordYear } : {}) });
    save(); invalidate(); render();
  }

  /* ---------------- compute ---------------- */
  let R = null;
  function invalidate() { R = null; }
  function recalculate() {
    const focused = document.activeElement;
    if (focused && focused.matches('input,select,textarea')) focused.blur();
    invalidate();
    const result = compute();
    state.ui.lastRecalculated = new Date().toISOString();
    render();
    toast('Recalculated ' + TMV.clientLabel(result.tmc) + ': base return and ' + (result.tmw.cols.length - 1) + ' planning columns.');
    return result;
  }
  function compute() {
    if (R) return R;
    const s = state.settings, d = state.data;
    const opt = { taxSource: s.taxSource, niitSource: s.niitSource };
    const w = E.w1040Findings(d.w1040, opt);
    const cur = s.mode === 'corrected' ? w.corrected : w.asBuilt;
    const tie = E.tieOut(d.w1040, cur, w.asBuilt, s.tolerance);
    const ropt = { threshold: s.rentalThreshold, phaseRange: s.rentalPhaseRange, marginalRate: s.rentalMarginal };
    const rent = { asBuilt: E.calcRental(d.rental, 'workbook', ropt), corrected: E.calcRental(d.rental, 'corrected', ropt) };
    rent.cur = s.mode === 'corrected' ? rent.corrected : rent.asBuilt;
    const hn = E.calcHnwi(d.hnwi);
    const findings = [...w.findings, ...E.rentalFindings(d.rental, ropt), ...E.hnwiFindings(d.hnwi, hn)].map((f) => {
      const st = (d.findingStatus || {})[f.id] || {};
      return Object.assign(f, { status: st.status || 'Open', note: st.note || '' });
    });
    const sevRank = { high: 0, medium: 1, low: 2, info: 3 };
    findings.sort((a, b) => (a.status === 'Open' ? 0 : 1) - (b.status === 'Open' ? 0 : 1) || sevRank[a.severity] - sevRank[b.severity]);
    const openItems = d.w1040.openItems.filter((o) => o.status !== 'Closed').length;
    // Planning: Rivera scenarios on the 2025 return or a 2026 projection
    const pl = d.w1040.planning;
    const baseData = pl.year === 2026 ? E.project1040(d.w1040, 2026, pl.growth) : d.w1040;
    const scen = pl.scenarios.map((sc) => Object.assign({ name: sc.name }, E.scenario1040(baseData, sc.levers, pl.year)));
    const proj = pl.year === 2026 ? scen[0] : E.scenario1040(E.project1040(d.w1040, 2026, pl.growth), {}, 2026);
    const safeHarbor = E.safeHarbor(cur.f.l24, cur.f.l11b, proj.v.f.l24, proj.v.f.l25d, pl.paid2026);
    const openHigh = findings.filter((f) => f.module === 'w1040' && f.status === 'Open' && f.severity === 'high').length;
    const calendar = E.calendar(d, { w1040: { openHigh }, rental: rent.corrected, safeHarbor }, new Date());
    const tmc = d.tm.clients.find((c) => c.id === d.tm.active) || d.tm.clients[0];
    const tmw = TM.walkClient(tmc);
    R = { w, cur, tie, rent, hn, findings, openItems, ropt, scen, proj, safeHarbor, calendar, openHigh, tmw, tmc };
    return R;
  }

  /* ---------------- views registry ---------------- */
  const WS = {
    planning: [
      { group: 'Overview', items: [['p-home', 'Planning dashboard']] },
      { group: 'Rivera household', who: 'Jordan & Casey · MFJ', items: [['p-rivera', 'Tax scenarios & estimates']] },
      { group: 'Doe household', who: 'John & Jane · rental HoldCo · wealth plan', items: [['r-props', 'Rental properties'], ['r-469', 'Rental election & ownership'], ['h-dash', 'Wealth strategy dashboard'], ['h-matrix', 'Strategy matrix'], ['h-cost', 'Cost-benefit & package'], ['h-check', 'Implementation checklist']] },
    ],
    compliance: [
      { group: 'Overview', items: [['c-home', 'Compliance dashboard'], ['calendar', 'Filing calendar'], ['findings', 'Review findings']] },
      { group: 'Rivera household', who: 'TY2025 Form 1040 · MFJ', items: [['w-tie', 'Form 1040 tie-out'], ['w-sources', 'Source documents'], ['w-sched', 'Schedules'], ['w-review', 'Review & sign-off']] },
      { group: 'Doe household', who: 'TY2026 returns · JD Rental Holdings', items: [['r-199a', 'Rental return positions'], ['r-statements', 'Election statements']] },
    ],
  };
  const LIB = { group: 'Library', items: [['sources', 'Sources'], ['audit', 'Change log'], ['settings', 'Settings']] };
  const TITLES = {}; const VIEW_WS = {};
  // Compliance views show the corrected / as-built switch
  WS.compliance.forEach((g) => g.items.forEach(([k]) => { VIEW_WS[k] = 'compliance'; }));
  let NAV = [];
  const wsHome = () => 'home';
  const VIEWS = {};

  /* ---------------- shared renderers ---------------- */
  function inputNum(path, value, opts) {
    opts = opts || {};
    const v = opts.pct ? (n(value) * 100).toFixed(opts.dp == null ? 2 : opts.dp).replace(/\.?0+$/, '') : (value == null ? '' : value);
    return '<input class="cell" id="in-' + esc(path) + '" inputmode="decimal" data-bind="' + esc(path) + '" data-type="' + (opts.pct ? 'pct' : 'num') + '" value="' + esc(v) + '" aria-label="' + esc(opts.label || path) + '">';
  }
  function inputText(path, value, opts) {
    opts = opts || {};
    return '<input class="cell txt" id="in-' + esc(path) + '" data-bind="' + esc(path) + '" data-type="text" value="' + esc(value) + '" aria-label="' + esc(opts.label || path) + '"' + (opts.style ? ' style="' + opts.style + '"' : '') + '>';
  }
  function selectBind(path, value, options, opts) {
    opts = opts || {};
    return '<select class="cell" id="in-' + esc(path) + '" data-bind="' + esc(path) + '" data-type="' + (opts.bool ? 'boolsel' : opts.num ? 'numsel' : 'text') + '" aria-label="' + esc(opts.label || path) + '">' +
      options.map((o) => { const [val, text] = Array.isArray(o) ? o : [o, o]; return '<option value="' + esc(val) + '"' + (String(val) === String(value) ? ' selected' : '') + '>' + esc(text) + '</option>'; }).join('') + '</select>';
  }
  function tieTable(rows, opts) {
    opts = opts || {};
    let h = '<div class="tablewrap"><table class="t"><thead><tr><th>Line</th><th>Description</th><th class="n">Workpaper</th><th class="n">Return / software</th><th class="n">Variance</th><th>Status</th>' + (opts.src ? '<th>Source</th>' : '') + '</tr></thead><tbody>';
    rows.forEach((r) => {
      const wp = r.input && !opts.readonly ? '<td class="n">' + inputNum('w1040.' + r.input, getPath(state.data.w1040, r.input), { label: r.desc }) + '</td>' : cellNum(r.value, r.rate ? 4 : 0);
      h += '<tr class="' + (r.total ? 'total ' : '') + (r.ok ? '' : 'var') + '"><td class="line">' + esc(r.line) + '</td><td class="wrap">' + esc(r.desc) + (r.note ? '<div class="muted small">' + esc(r.note) + '</div>' : '') + '</td>' + wp +
        '<td class="n"><input class="cell ret' + (r.retOverride ? ' set' : '') + '" id="ret-' + esc(r.key) + '" data-ret="' + esc(r.key) + '" inputmode="decimal" value="' + esc(r.rate ? r.ret : Math.round(r.ret * 100) / 100) + '" aria-label="Return amount for ' + esc(r.desc) + '"></td>' +
        cellNum(r.variance, r.rate ? 4 : 0) + '<td>' + (r.ok ? chip('ok', 'OK') : chip('bad', 'Variance')) + '</td>' + (opts.src ? '<td class="muted small">' + esc(r.src || '') + '</td>' : '') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  function modeNote() {
    const m = state.settings.mode;
    return '<div class="banner' + (m === 'workbook' ? ' warn' : '') + '"><span>' + (m === 'corrected'
      ? '<b>Corrected logic.</b> Workpaper figures include the review fixes. The return/software column starts from the workbook as built, so each variance shows a line the fixes change.'
      : '<b>Workbook logic, as built.</b> Every figure follows the source workbook\'s formulas, including the issues listed under Review findings.') +
      '</span><span class="spacer" style="flex:1"></span><button class="btn small" data-action="mode" data-val="' + (m === 'corrected' ? 'workbook' : 'corrected') + '">Show ' + (m === 'corrected' ? 'as built' : 'corrected') + '</button></div>';
  }
  function head(eyebrow, title, lede, right) {
    return '<div class="page-head"><div><div class="eyebrow">' + esc(eyebrow) + '</div><h1>' + esc(title) + '</h1>' + (lede ? '<p>' + lede + '</p>' : '') + '</div>' + (right || '') + '</div>';
  }
  function tabs(key, list, counts) {
    const cur = state.tab[key] || list[0][0];
    return '<div class="tabs" role="tablist">' + list.map(([k, t]) => '<button role="tab" aria-selected="' + (k === cur) + '" class="' + (k === cur ? 'on' : '') + '" data-tab="' + key + '" data-val="' + k + '">' + esc(t) + (counts && counts[k] ? '<span class="dot" title="' + counts[k] + ' variance(s)"></span>' : '') + '</button>').join('') + '</div>';
  }
  const sevLabel = { high: 'High', medium: 'Medium', low: 'Low', info: 'Note' };
  const moduleView = { w1040: 'w-tie', rental: 'r-199a', hnwi: 'h-cost' };
  const moduleName = { w1040: '1040 workpaper', rental: 'Rental HoldCo', hnwi: 'HNWI strategies' };
  function findingCard(f) {
    return '<div class="finding sev-' + f.severity + '">' + chip(f.severity, sevLabel[f.severity]) +
      '<div class="t">' + esc(f.title) + '</div><div class="imp">' + (f.impact != null && Math.abs(f.impact) >= 0.5 ? (f.impact > 0 ? '+' : '') + money(f.impact) : '') + '</div>' +
      '<div class="d">' + esc(f.detail) + '</div>' +
      '<div class="where"><span>' + esc(moduleName[f.module]) + (f.line ? ' · ' + esc(f.line) : '') + '</span>' +
      '<label>Status ' + '<select class="cell" style="width:auto;min-width:0;display:inline-block" data-finding="' + esc(f.id) + '" aria-label="Status for ' + esc(f.title) + '">' + ['Open', 'Accepted', 'Won\'t fix'].map((s) => '<option' + (s === f.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' +
      '<a href="#' + moduleView[f.module] + '">Open ' + esc(moduleName[f.module]) + '</a>' +
      '<button class="btn small ghost" data-ask="' + esc('Explain finding ' + f.id + ' (' + f.title + '): why it matters, the rule behind it, and what I should do.') + '">Ask the advisor</button></div></div>';
  }

  /* ================= PLANNING DASHBOARD ================= */
  VIEWS['p-home'] = () => {
    const r = compute(); const rc = r.rent.corrected; const hn = r.hn; const pl = state.data.w1040.planning;
    const best = r.scen.slice(1).reduce((b, x) => (!b || x.v.f.l24 < b.v.f.l24 ? x : b), null);
    const saving = best ? r.scen[0].v.f.l24 - best.v.f.l24 : 0;
    let h = head('Planning workspace', 'Planning dashboard', 'Forward-looking work for both households: tax scenarios and estimated payments for the Riveras, and the rental election and 50-strategy wealth plan for the Does. Planning runs on corrected logic, starting from the compliance figures.');
    h += '<div class="tiles" style="margin-bottom:18px">' +
      tile('Rivera ' + pl.year + ' baseline tax', money(r.scen[0].v.f.l24), pl.year === 2026 ? 'projection at ' + pct(pl.growth, 1) + ' growth' : 'what-if on the 2025 return') +
      tile('Best scenario saves', money(saving), best ? best.name : '') +
      tile('Rivera 2026 estimates still due', money(r.safeHarbor.remaining), r.safeHarbor.basis === 'prior' ? Math.round(r.safeHarbor.pct * 100) + '% of 2025 tax safe harbor' : '90% of 2026 tax') +
      tile('Doe election value', money(rc.election.value), '§469(c)(7)(A), 2026') +
      tile('Doe strategy package', moneyM(hn.selected.net), hn.selected.count + ' of 50 selected') + '</div>';
    h += '<div class="grid2">';
    h += '<div class="panel pad module-card"><div class="meta">Rivera household · MFJ</div><h3>Tax scenarios</h3><div class="tablewrap"><table class="t"><thead><tr><th>Scenario</th><th class="n">Total tax</th><th class="n">vs baseline</th></tr></thead><tbody>' +
      r.scen.map((x) => '<tr><td>' + esc(x.name) + '</td>' + cellNum(x.v.f.l24) + cellNum(x.v.f.l24 - r.scen[0].v.f.l24) + '</tr>').join('') + '</tbody></table></div><div><a class="btn small" href="#p-rivera">Open scenarios</a></div></div>';
    h += '<div class="panel pad module-card"><div class="meta">Doe household · JD Rental Holdings LLC</div><h3>Rental election</h3><dl class="kv">' + kv('Net rental result', money(rc.tot.qbi)) + kv('Deductible with the election', money(rc.election.withElection)) + kv('Without the election', money(rc.election.repNoElection)) + kv('Tax value at ' + pct(rc.rate, 0), money(rc.election.value)) + kv('§199A deduction', money(rc.summary.ded)) + '</dl><div><a class="btn small" href="#r-469">Open rental planning</a></div></div>';
    const top5 = [...r.hn.rows].sort((a, b) => a.rank - b.rank).slice(0, 5);
    h += '<div class="panel pad module-card"><div class="meta">Doe household · John Doe wealth plan</div><h3>Top strategies by net benefit</h3><dl class="kv">' + top5.map((x) => kv('#' + x.no + ' ' + state.data.hnwi.strategies.find((s) => s.no === x.no).title, moneyM(x.net))).join('') + '</dl><div><a class="btn small" href="#h-cost">Build a package</a></div></div>';
    h += '</div>';
    const nextFil = r.calendar.filter((c) => c.state !== 'done').slice(0, 4);
    h += '<h2>Where planning meets compliance</h2><p class="lede">Planning decisions create filing obligations. These are the next items on the compliance calendar.</p><div class="tablewrap"><table class="t"><thead><tr><th>Due</th><th>Client</th><th>Filing</th><th>Created by</th></tr></thead><tbody>' +
      nextFil.map((c) => '<tr><td style="white-space:nowrap">' + dueLabel(c) + '</td><td>' + esc(c.client) + '</td><td><b style="font-weight:600">' + esc(c.form) + '</b> <span class="muted small">' + esc(c.title) + '</span></td><td class="small muted">' + esc(c.source) + '</td></tr>').join('') + '</tbody></table></div><p><a href="#calendar">Open the filing calendar</a></p>';
    return h;
  };

  /* ================= COMPLIANCE DASHBOARD ================= */
  VIEWS['c-home'] = () => {
    const r = compute(); const c = r.cur;
    const open = r.findings.filter((f) => f.status === 'Open');
    const bySev = (s) => open.filter((f) => f.severity === s).length;
    const soon = r.calendar.filter((x) => x.state === 'soon' || x.state === 'overdue');
    const next = r.calendar.find((x) => x.state !== 'done' && x.days != null);
    let h = head('Review & compliance', 'Compliance dashboard', 'Return preparation and review for both households: the Rivera 2025 tie-out, the Doe 2026 return positions and election statements, formula findings, and every filing deadline.');
    h += modeNote();
    h += '<div class="tiles" style="margin-bottom:18px">' +
      tile('Next deadline', next ? next.days + ' days' : '—', next ? next.client + ' ' + next.form + ' · ' + fmtDate(next.due) : '', next && next.days <= 30) +
      tile('Due within 30 days', soon.length, soon.map((x) => x.client + ' ' + x.form).join(', '), soon.length > 0) +
      tile('Open findings', open.length, bySev('high') + ' high · ' + bySev('medium') + ' medium', bySev('high') > 0) +
      tile('Rivera 1040 variances', r.tie.variances, state.settings.mode === 'corrected' ? 'workpaper vs return as built' : 'outside the $' + state.settings.tolerance + ' tolerance', r.tie.variances > 0) +
      tile('Rivera ' + (c.net >= 0 ? 'refund' : 'balance due'), money(Math.abs(c.net)), state.settings.mode === 'corrected' ? 'as built: ' + money(r.w.asBuilt.net) : 'corrected: ' + money(r.w.corrected.net)) + '</div>';
    h += '<div class="grid2">';
    const ready = r.openItems === 0 && r.tie.variances === 0 && r.openHigh === 0;
    h += '<div class="panel pad module-card"><div class="meta">Rivera household · TY2025 · extended to Oct 15, 2026</div><h3>Form 1040 workpaper</h3><dl class="kv">' + kv('Adjusted gross income', money(c.f.l11b)) + kv('Total tax (line 24)', money(c.f.l24)) + kv('Open items', r.openItems) + kv('High findings open', r.openHigh) + kv('Ready for final', ready ? 'Yes' : 'No') + '</dl><div><a class="btn small" href="#w-tie">Open tie-out</a> <a class="btn small" href="#w-review">Review & sign-off</a></div></div>';
    const rc = r.rent.cur;
    h += '<div class="panel pad module-card"><div class="meta">Doe household · TY2026</div><h3>Rental return positions</h3><dl class="kv">' + kv('§469 qualifying taxpayer', rc.rep.pass ? 'Tests met' : 'Tests not met') + kv('§199A aggregation', rc.agg.pass ? 'Supportable' : 'Review') + kv('§199A deduction (' + (state.settings.mode === 'corrected' ? 'corrected' : 'as built') + ')', money(rc.summary.ded)) + kv('Negative QBI carryforward', money(rc.summary.carry)) + kv('Rental findings open', open.filter((f) => f.module === 'rental').length) + '</dl><div><a class="btn small" href="#r-199a">Open return positions</a> <a class="btn small" href="#r-statements">Statements</a></div></div>';
    h += '</div>';
    h += '<h2>Upcoming filings</h2>' + calendarTable(r.calendar.filter((x) => x.state !== 'done').slice(0, 6), true);
    h += '<h2>Highest-priority findings <span class="sub">' + open.length + ' open</span></h2><div class="findings">' + open.slice(0, 3).map(findingCard).join('') + '</div>';
    if (open.length > 3) h += '<p style="margin-top:10px"><a href="#findings">See all ' + open.length + ' findings</a></p>';
    return h;
  };
  const fmtDate = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const dueLabel = (c) => (c.due ? fmtDate(c.due) : esc(c.event || 'Event-driven'));
  const stateChip = (c) => ({ overdue: chip('bad', 'Overdue'), soon: chip('warn', c.days + ' days'), later: chip('plain', c.days + ' days'), event: chip('info', 'On event'), done: chip('ok', c.status) })[c.state];
  function calendarTable(list, compact) {
    if (!list.length) return '<p class="muted">Nothing to show.</p>';
    return '<div class="tablewrap"><table class="t"><thead><tr><th>Due</th><th>When</th><th>Client</th><th>Filing</th>' + (compact ? '' : '<th>Extended due</th>') + '<th>Created by</th><th>Status</th></tr></thead><tbody>' +
      list.map((c) => '<tr><td style="white-space:nowrap">' + dueLabel(c) + '</td><td>' + stateChip(c) + '</td><td>' + esc(c.client) + '</td><td class="wrap"><b style="font-weight:600">' + esc(c.form) + '</b><div class="small muted">' + esc(c.title) + (c.amount ? ' · ' + money(c.amount) : '') + (c.note ? ' · ' + esc(c.note) : '') + '</div></td>' + (compact ? '' : '<td class="small muted" style="white-space:nowrap">' + fmtDate(c.ext) + '</td>') +
        '<td class="small"><a href="#' + esc(c.view) + '">' + esc(c.source) + '</a></td><td>' + selectBind('calendar.' + c.id, c.status, ['Not started', 'In progress', 'Extended', 'Filed', 'N/A'], { label: 'Status for ' + c.form }) + '</td></tr>').join('') + '</tbody></table></div>';
  }
  VIEWS.calendar = () => {
    const r = compute(); const cal = r.calendar;
    let h = head('Review & compliance', 'Filing calendar', 'Every return, statement and information filing both households owe, built from the compliance files and from the strategies selected in planning. Dates assume calendar-year filers; confirm weekend and holiday shifts.');
    const groups = [['Needs attention', cal.filter((c) => c.state === 'overdue' || c.state === 'soon')], ['Upcoming', cal.filter((c) => c.state === 'later')], ['Triggered by an event', cal.filter((c) => c.state === 'event')], ['Filed or not applicable', cal.filter((c) => c.state === 'done')]];
    groups.forEach(([t, list]) => { if (list.length) h += '<h2>' + t + ' <span class="sub">' + list.length + '</span></h2>' + calendarTable(list); });
    const sel = state.data.hnwi.strategies.filter((s) => s.selected).length;
    if (!sel) h += '<div class="banner" style="margin-top:18px"><span>No wealth-plan strategies are selected yet, so no strategy filings appear. Select strategies in planning to add them.</span><a class="btn small" href="#h-cost">Open cost-benefit</a></div>';
    return h;
  };

  /* ================= RIVERA TAX SCENARIOS ================= */
  VIEWS['p-rivera'] = () => {
    const r = compute(); const pl = state.data.w1040.planning; const sc = r.scen; const base = sc[0];
    let h = head('Planning workspace · Rivera household', 'Tax scenarios & estimates', 'Compare planning moves side by side. Every column starts from the compliance return with the review corrections applied, and taxes are figured with the engine so the columns compare like for like.', '<a class="btn" href="#w-tie">Open compliance return</a>');
    h += '<div class="form" style="margin-bottom:14px;grid-template-columns:repeat(auto-fit,minmax(200px,260px))"><label class="field">Tax year' + selectBind('w1040.planning.year', String(pl.year), [['2025', '2025 return (what-if)'], ['2026', '2026 projection']], { num: true }) + '</label>' +
      (pl.year === 2026 ? '<label class="field">Income growth for 2026' + inputNum('w1040.planning.growth', pl.growth, { pct: true, dp: 1 }) + '<span class="hint">Applied to wages, business, rental and investment income</span></label>' : '') + '</div>';
    h += '<div class="banner' + (pl.year === 2025 ? ' warn' : '') + '"><span>' + (pl.year === 2025
      ? '<b>Timing.</b> For 2025 only the SEP-IRA can still be funded, up to the extended due date of October 15, 2026. The other moves had to happen by December 31, 2025 (HSA by April 15, 2026); read them as a guide for 2026.'
      : '<b>2026 projection.</b> Uses 2026 brackets, the $32,200 standard deduction, the $184,500 wage base and the $40,400 SALT cap from Rev. Proc. 2025-32; confirm before advising. Avery turns 13 and keeps the child credit; Mia stays an other dependent.') + '</span></div>';
    const n0 = sc.length;
    h += '<div class="tablewrap"><table class="t"><thead><tr><th style="min-width:230px">Planning move</th>' + sc.map((x, i) => '<th class="n" style="min-width:150px">' + (i === 0 ? 'Baseline' : '<span style="display:inline-flex;gap:4px;align-items:center">Scenario ' + (i + 1) + '<button class="btn small ghost" data-action="del-scen" data-val="' + i + '" aria-label="Remove ' + esc(x.name) + '" title="Remove scenario">×</button></span>') + '</th>').join('') + '</tr></thead><tbody>';
    h += '<tr><td>Scenario name</td>' + pl.scenarios.map((x, i) => '<td>' + inputText('w1040.planning.scenarios.' + i + '.name', x.name, { label: 'Scenario name' }) + '</td>').join('') + '</tr>';
    E.LEVERS.forEach((lv) => {
      h += '<tr><td>' + esc(lv.label) + '<div class="muted small">' + esc(lv.hint) + (lv.key === 'sepIra' ? ' (about ' + money(base.sepMax) + ' here)' : '') + '</div></td>' + pl.scenarios.map((x, i) => '<td class="n">' + (i === 0 ? '<span class="muted small">' + (lv.absolute ? money(base.v.s1.l13) : '—') + '</span>' : inputNum('w1040.planning.scenarios.' + i + '.levers.' + lv.key, x.levers[lv.key] == null ? '' : x.levers[lv.key], { label: lv.label + ' for ' + x.name })) + '</td>').join('') + '</tr>';
    });
    const row = (t, f, opts) => { opts = opts || {}; return '<tr class="' + (opts.total ? 'total' : '') + '"><td>' + t + '</td>' + sc.map((x) => (opts.fmt ? '<td class="n">' + opts.fmt(x) + '</td>' : cellNum(f(x)))).join('') + '</tr>'; };
    h += '<tr><td colspan="' + (n0 + 1) + '" style="background:var(--surface-2);font:600 11px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)">Results</td></tr>';
    h += row('Adjusted gross income', (x) => x.v.f.l11b) + row('Deduction', null, { fmt: (x) => fmtNum(x.v.f.l12e) + ' <span class="muted small">' + (x.v.a.method === 'Itemized' ? 'itemized' : 'standard') + '</span>' }) + row('QBI deduction', (x) => x.v.f.l13a) + row('Taxable income', (x) => x.v.f.l15) +
      row('Income tax (line 16)', (x) => x.v.f.l16) + row('Self-employment tax', (x) => x.v.se.j) + row('Net investment income tax', (x) => x.v.s2.l12) + row('Credits', (x) => x.v.f.l21 + x.v.f.l28) +
      row('Total tax (line 24)', (x) => x.v.f.l24, { total: true }) + row('Change from baseline', (x) => x.v.f.l24 - base.v.f.l24) +
      row('Marginal rate on the next $1,000', null, { fmt: (x) => pct(x.marginal, 1) }) + row('Cash put to work', (x) => x.cash) +
      row('After-tax cost of the move', (x) => x.cash - (base.v.f.l24 - x.v.f.l24)) + row('Capital loss carried forward', (x) => x.v.dd.carryover) +
      row(pl.year === 2026 ? 'Balance due (−) at 2025 payment levels' : 'Refund (+) or balance due (−)', (x) => x.v.net);
    h += '</tbody></table></div>';
    h += '<p style="margin:10px 0 0;display:flex;gap:8px;flex-wrap:wrap">' + (sc.length < 5 ? '<button class="btn small" data-action="add-scen">Add scenario</button>' : '') + '<button class="btn small" data-ask="' + esc('Compare the Rivera tax scenarios on screen and recommend which moves to make for ' + pl.year + ', with the reasoning and any deadlines.') + '">Ask the advisor to compare</button></p>';
    const shv = r.safeHarbor; const proj = r.proj.v;
    const qs = [['2026-04-15', 'First'], ['2026-06-15', 'Second'], ['2026-09-15', 'Third'], ['2027-01-15', 'Fourth']];
    const today = new Date();
    h += '<h2>2026 estimated tax <span class="sub">safe harbor under §6654(d)(1)(B)</span></h2><div class="grid2"><div class="panel pad"><dl class="kv">' +
      kv('2025 total tax (compliance return, line 24)', money(r.cur.f.l24)) + kv('2025 AGI', money(r.cur.f.l11b) + (shv.pct > 1 ? ' · over $150,000' : '')) + kv(Math.round(shv.pct * 100) + '% of 2025 tax', money(shv.prior)) +
      kv('90% of projected 2026 tax (' + money(proj.f.l24) + ')', money(shv.current)) + kv('Required annual payment', money(shv.required)) + kv('Projected 2026 withholding', money(proj.f.l25d)) +
      kv('Needed from estimates', money(shv.fromEst)) +
      (shv.basis === 'current' ? kv('Safer target: 110% of 2025 tax, per quarter', money(Math.max(0, shv.prior - proj.f.l25d) / 4)) : '') + '</dl>' +
      (shv.basis === 'current' ? '<p class="small muted" style="margin:8px 0 0">The required payment is the lower of the two safe harbors. The 90% figure is safe only if the 2026 projection holds; paying toward 110% of the 2025 tax removes that risk.</p>' : '') + '<div class="form" style="margin-top:12px"><label class="field">2026 estimates already paid' + inputNum('w1040.planning.paid2026', pl.paid2026) + '</label></div></div>' +
      '<div class="panel pad"><h3 style="margin-top:0">Installments</h3><div class="tablewrap"><table class="t"><thead><tr><th>Installment</th><th>Due</th><th class="n">Amount</th><th></th></tr></thead><tbody>' +
      qs.map(([d, t]) => { const past = new Date(d + 'T23:59:00') < today; return '<tr><td>' + t + '</td><td>' + fmtDate(d) + '</td>' + cellNum(shv.quarter) + '<td>' + (past ? chip('plain', 'Date passed') : chip('warn', 'Upcoming')) + '</td></tr>'; }).join('') +
      '<tr class="total"><td colspan="2">Still to pay this year</td>' + cellNum(shv.remaining) + '<td></td></tr></tbody></table></div><p class="small muted" style="margin-bottom:0">Paying a late installment now still limits the underpayment penalty on Form 2210; the annualized method may help if income was uneven. The fourth installment is on the <a href="#calendar">filing calendar</a>.</p></div></div>';
    return h;
  };

  const tile = (k, v, d, alert) => '<div class="tile' + (alert ? ' alert' : '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' + (d ? '<div class="d">' + esc(d) + '</div>' : '') + '</div>';
  const kv = (k, v) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>';

  /* ================= FINDINGS ================= */
  VIEWS.findings = () => {
    const r = compute(); const fl = state.ui.filter;
    const mod = fl.fmod || 'all', sev = fl.fsev || 'all', st = fl.fst || 'Open';
    const list = r.findings.filter((f) => (mod === 'all' || f.module === mod) && (sev === 'all' || f.severity === sev) && (st === 'all' || f.status === st));
    let h = head('Review', 'Review findings', 'Formula and technical issues found while rebuilding the three workbooks. Each one names the cell or rule involved and, where it moves a number, the dollar effect of the fix. Impacts compare corrected logic against the workbook as built.');
    const wd = r.w.netDelta;
    h += '<div class="banner"><span>Rivera return: the fixes move the result from ' + money(r.w.asBuilt.net) + ' to ' + money(r.w.corrected.net) + ' (' + (wd >= 0 ? '+' : '') + money(wd) + ') before line 16 tax is updated from the software.</span></div>';
    h += '<div class="form" style="margin-bottom:14px;grid-template-columns:repeat(auto-fit,minmax(160px,220px))">' +
      filterSel('fmod', 'Workbook', mod, [['all', 'All workbooks'], ['w1040', '1040 workpaper'], ['rental', 'Rental HoldCo'], ['hnwi', 'HNWI strategies']]) +
      filterSel('fsev', 'Severity', sev, [['all', 'All'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['info', 'Note']]) +
      filterSel('fst', 'Status', st, [['all', 'All'], ['Open', 'Open'], ['Accepted', 'Accepted'], ['Won\'t fix', 'Won\'t fix']]) + '</div>';
    h += list.length ? '<div class="findings">' + list.map(findingCard).join('') + '</div>' : '<p class="muted">No findings match these filters.</p>';
    return h;
  };
  function filterSel(key, lab, val, opts) {
    return '<label class="field">' + esc(lab) + '<select id="flt-' + key + '" data-filter="' + key + '">' + opts.map(([v, t]) => '<option value="' + esc(v) + '"' + (v === val ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></label>';
  }

  /* ================= 1040: TIE-OUT ================= */
  VIEWS['w-tie'] = () => {
    const r = compute(); const c = r.cur; const t = r.tie.rows;
    let h = head('Rivera household · Form 1040 · TY2025', 'Form 1040 tie-out', 'Line-by-line reconciliation of the workpaper against the return or tax software. Type a software figure into any dashed cell to override it; clear the cell to go back to the seeded amount.',
      '<span style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="#p-rivera">Plan from this return</a><button class="btn" data-action="csv-tie">Export tie-out CSV</button></span>');
    h += modeNote();
    h += '<div class="tiles" style="margin-bottom:6px">' + tile('Adjusted gross income', money(c.f.l11b)) + tile('Taxable income', money(c.f.l15)) + tile('Total tax', money(c.f.l24)) + tile('Total payments', money(c.f.l33)) +
      tile(c.net >= 0 ? 'Refund' : 'Amount owed', money(Math.abs(c.net)), 'Line ' + (c.net >= 0 ? '35a' : '37')) + tile('Variances', r.tie.variances, 'tolerance $' + state.settings.tolerance, r.tie.variances > 0) + '</div>';
    h += '<div class="legend-note"><span><i class="sw"></i>Workpaper input</span><span><i class="sw ret"></i>Return / software (seeded)</span><span><i class="sw set"></i>Return / software (typed)</span></div>';
    h += '<h2>Control panel</h2>' + tieTable(t.control, { readonly: true });
    h += '<h2>Form 1040 lines 1–38</h2>' + tieTable(t.f1040, { src: true });
    return h;
  };

  /* ================= 1040: SOURCES ================= */
  VIEWS['w-sources'] = () => {
    const d = state.data.w1040; const r = compute(); const c = r.cur;
    let h = head('Rivera household · Form 1040 · TY2025', 'Source documents', 'Every raw input from the workbook\'s Source_Docs, K1_Input and Schedule E tabs. Yellow cells are editable; totals and all schedules update when you leave a cell.');
    h += '<h2>W-2 wages</h2><div class="tablewrap"><table class="t"><thead><tr><th>Taxpayer</th><th>Employer</th><th class="n">Box 1 wages</th><th class="n">Federal w/h</th><th class="n">SS wages</th><th class="n">SS tax</th><th class="n">Medicare wages</th><th class="n">State w/h</th></tr></thead><tbody>' +
      d.w2.map((w, i) => '<tr><td>' + inputText('w1040.w2.' + i + '.who', w.who, { style: 'min-width:80px' }) + '</td><td>' + inputText('w1040.w2.' + i + '.employer', w.employer, { style: 'min-width:150px' }) + '</td>' + ['wages', 'fedwh', 'ssWages', 'ssTax', 'medWages', 'stateWh'].map((k) => '<td class="n">' + inputNum('w1040.w2.' + i + '.' + k, w[k]) + '</td>').join('') + '</tr>').join('') +
      '<tr class="total"><td colspan="2">Total</td>' + ['wages', 'fedwh', 'ssWages', 'ssTax', 'medWages', 'stateWh'].map((k) => cellNum(E.sum(d.w2, (w) => w[k]))).join('') + '</tr></tbody></table></div>';
    h += '<div class="grid2"><div><h2>1099-INT</h2><div class="tablewrap"><table class="t"><thead><tr><th>Payer</th><th class="n">Taxable</th><th class="n">Tax-exempt</th><th class="n">Fed w/h</th></tr></thead><tbody>' +
      d.interest.map((x, i) => '<tr><td>' + esc(x.payer) + '</td>' + ['taxable', 'exempt', 'wh'].map((k) => '<td class="n">' + inputNum('w1040.interest.' + i + '.' + k, x[k]) + '</td>').join('') + '</tr>').join('') +
      '<tr class="total"><td>Total</td>' + cellNum(c.int.taxable) + cellNum(c.int.exempt) + cellNum(c.int.wh) + '</tr></tbody></table></div></div>';
    h += '<div><h2>1099-DIV</h2><div class="tablewrap"><table class="t"><thead><tr><th>Payer</th><th class="n">Ordinary</th><th class="n">Qualified</th><th class="n">Cap. gain dist.</th></tr></thead><tbody>' +
      d.dividends.map((x, i) => '<tr><td>' + esc(x.payer) + '</td>' + ['ordinary', 'qualified', 'capGainDist'].map((k) => '<td class="n">' + inputNum('w1040.dividends.' + i + '.' + k, x[k]) + '</td>').join('') + '</tr>').join('') +
      '<tr class="total"><td>Total</td>' + cellNum(c.div.ord) + cellNum(c.div.qual) + cellNum(c.div.cgd) + '</tr></tbody></table></div></div></div>';
    h += '<h2>1099-B capital transactions</h2><div class="tablewrap"><table class="t"><thead><tr><th>Description</th><th>Term</th><th class="n">Proceeds</th><th class="n">Basis</th><th class="n">Adjustment</th><th class="n">Gain (loss)</th></tr></thead><tbody>' +
      d.sales.map((x, i) => '<tr><td>' + esc(x.desc) + '</td><td>' + selectBind('w1040.sales.' + i + '.term', x.term, ['Short-term', 'Long-term']) + '</td>' + ['proceeds', 'basis', 'adj'].map((k) => '<td class="n">' + inputNum('w1040.sales.' + i + '.' + k, x[k]) + '</td>').join('') + cellNum(c.sales[i].gain) + '</tr>').join('') + '</tbody></table></div>';
    const oth = [['stateRefund', 'Taxable state refund', 'Schedule 1 line 1'], ['unemployment', 'Unemployment compensation', 'Schedule 1 line 7'], ['gambling', 'Gambling winnings', 'Schedule 1 line 8b'], ['mortgage', 'Mortgage interest (1098)', 'Schedule A line 8a'], ['stateIncomeTax', 'State income taxes paid', 'Schedule A line 5a'], ['realEstateTax', 'Real estate taxes, residence', 'Schedule A line 5b'], ['personalPropTax', 'Personal property taxes', 'Schedule A line 5c'], ['cashCharity', 'Cash charitable gifts', 'Schedule A line 11'], ['estPayments', '2025 estimated payments', 'Form 1040 line 26'], ['extensionPayment', 'Paid with extension', 'Schedule 3 line 10'], ['educationCredit', 'Education credit', 'Schedule 3 line 3']];
    h += '<h2>Other source inputs</h2><div class="tablewrap"><table class="t"><thead><tr><th>Item</th><th class="n">Amount</th><th>Return area</th></tr></thead><tbody>' + oth.map(([k, t, a]) => '<tr><td>' + esc(t) + '</td><td class="n">' + inputNum('w1040.other.' + k, d.other[k]) + '</td><td class="muted">' + esc(a) + '</td></tr>').join('') + '</tbody></table></div>';
    const kcols = [['box1', 'Box 1 ordinary'], ['box2', 'Box 2 rental'], ['interest', 'Interest'], ['ordDiv', 'Ord. div.'], ['qualDiv', 'Qual. div.'], ['stcg', 'ST gain'], ['ltcg', 'LT gain'], ['charity', 'Charitable'], ['ftc', 'Foreign tax'], ['qbi', '§199A QBI'], ['se', 'SE earnings'], ['distributions', 'Distributions']];
    h += '<h2>Schedule K-1 input <span class="sub">allowed Schedule E amount is computed</span></h2><div class="tablewrap"><table class="t"><thead><tr><th>Entity</th><th>Form</th><th>PTP</th><th>Passive</th><th>Material</th>' + kcols.map(([, t]) => '<th class="n">' + t + '</th>').join('') + '<th class="n">Allowed Sch E</th></tr></thead><tbody>' +
      d.k1.map((k, i) => '<tr><td style="min-width:170px">' + esc(k.entity) + '<div class="muted small">' + esc(k.ein) + '</div></td><td>' + esc(k.form) + '</td>' + ['ptp', 'passive', 'material'].map((f) => '<td>' + selectBind('w1040.k1.' + i + '.' + f, k[f] ? 'true' : 'false', [['true', 'Yes'], ['false', 'No']], { bool: true }) + '</td>').join('') +
        kcols.map(([f]) => '<td class="n">' + inputNum('w1040.k1.' + i + '.' + f, k[f]) + '</td>').join('') + cellNum(c.k1[i].allowed) + '</tr>').join('') +
      '<tr class="total"><td colspan="5">Totals</td>' + kcols.map(([f]) => cellNum(E.sum(d.k1, (k) => k[f]))).join('') + cellNum(c.kt.allowed) + '</tr></tbody></table></div>';
    const ecols = [['gross', 'Gross'], ['advertising', 'Advert.'], ['auto', 'Auto/travel'], ['cleaning', 'Cleaning'], ['commissions', 'Comm.'], ['insurance', 'Insurance'], ['mortgage', 'Mortgage int.'], ['taxes', 'Taxes'], ['repairs', 'Repairs'], ['depreciation', 'Depreciation'], ['other', 'Other']];
    h += '<h2>Schedule E rental and royalty activity</h2><div class="tablewrap"><table class="t"><thead><tr><th>Activity</th><th>Type</th>' + ecols.map(([, t]) => '<th class="n">' + t + '</th>').join('') + '<th class="n">Net</th></tr></thead><tbody>' +
      d.schE.map((e, i) => '<tr><td style="min-width:150px">' + esc(e.name) + '</td><td>' + esc(e.type) + '</td>' + ecols.map(([f]) => '<td class="n">' + inputNum('w1040.schE.' + i + '.' + f, e[f]) + '</td>').join('') + cellNum(c.schE.rows[i].net) + '</tr>').join('') + '</tbody></table></div>';
    h += '<h2>Dependents</h2><div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th class="n">Age</th><th>Valid SSN</th><th>CTC child</th><th>Other dependent</th><th>Note</th></tr></thead><tbody>' +
      d.deps.map((x, i) => '<tr><td>' + esc(x.name) + '</td><td class="n">' + inputNum('w1040.deps.' + i + '.age', x.age) + '</td>' + ['ssn', 'ctc', 'odc'].map((f) => '<td>' + selectBind('w1040.deps.' + i + '.' + f, x[f] ? 'true' : 'false', [['true', 'Yes'], ['false', 'No']], { bool: true }) + '</td>').join('') + '<td class="muted">' + esc(x.note) + '</td></tr>').join('') + '</tbody></table></div>';
    return h;
  };

  /* ================= 1040: SCHEDULES ================= */
  const SCHED_TABS = [['schA', 'Sch A'], ['schB', 'Sch B'], ['schC', 'Sch C'], ['schD', 'Sch D / 8949'], ['schE', 'Sch E'], ['f8582', '8582'], ['schSE', 'Sch SE'], ['f8995', '8995'], ['s8812', '8812'], ['sch1', 'Sch 1'], ['sch2', 'Sch 2'], ['sch3', 'Sch 3'], ['taxCalc', 'Tax calc']];
  const SCHED_NOTES = {
    schA: 'Itemized deductions against the standard deduction. The SALT cap is the OBBBA $40,000 for 2025; corrected logic also applies the phase-down above $500,000 of MAGI.',
    schB: 'Interest and ordinary dividends. Corrected logic adds K-1 portfolio income, which the workbook computes but never links forward.',
    schC: 'Sole proprietor business. Net profit flows to Schedule 1 line 3, Schedule SE and Form 8995.',
    schD: 'Capital gains from 1099-B, 1099-DIV distributions and K-1s.',
    schE: 'Rental, royalty and pass-through rollup after passive loss limits.',
    f8582: 'Passive activity loss limits for rental real estate with active participation. The special allowance phases out between $100,000 and $150,000 of MAGI.',
    schSE: 'Self-employment tax, figured for the spouse who owns the self-employment income.',
    f8995: 'Simplified QBI deduction. Taxable income before QBI is below the 2025 MFJ threshold of $394,600, so the W-2 wage and UBIA limits do not apply.',
    s8812: 'Child tax credit ($2,200 per child for 2025), credit for other dependents ($500) and the refundable additional child tax credit (up to $1,700 per child).',
    sch1: 'Additional income and adjustments to income.', sch2: 'Additional taxes.', sch3: 'Additional credits and payments.',
    taxCalc: 'Line 16 tax is a software input in the workbook. The engine check applies 2025 MFJ brackets with the qualified dividends and capital gain worksheet.',
  };
  VIEWS['w-sched'] = () => {
    const r = compute(); const t = r.tie.rows; const d = state.data.w1040;
    const counts = {}; SCHED_TABS.forEach(([k]) => { counts[k] = (t[k] || []).filter((x) => !x.ok).length; });
    const cur = state.tab.sched || 'schA';
    let h = head('Rivera household · Form 1040 · TY2025', 'Schedules', 'Each schedule ties the workpaper to the return. Red dots mark schedules with variances.');
    h += modeNote() + tabs('sched', SCHED_TABS, counts);
    h += '<p class="lede">' + esc(SCHED_NOTES[cur]) + '</p>';
    if (cur === 'schSE') h += '<div class="form" style="margin-bottom:12px;grid-template-columns:repeat(auto-fit,minmax(200px,260px))"><label class="field">Spouse with the self-employment income' + selectBind('w1040.se.owner', d.se.owner, d.w2.map((w) => w.who)) + '<span class="hint">Used by corrected logic for the wage-base offset</span></label></div>';
    if (cur === 'taxCalc') h += '<div class="form" style="margin-bottom:12px;grid-template-columns:repeat(auto-fit,minmax(200px,260px))"><label class="field">Line 16 source' + selectBind('settings.taxSource', state.settings.taxSource, [['software', 'Software input'], ['engine', 'Engine (2025 MFJ)']]) + '</label><label class="field">Schedule 2 NIIT source' + selectBind('settings.niitSource', state.settings.niitSource, [['input', 'Typed input'], ['engine', 'Engine estimate']]) + '</label></div>';
    h += tieTable(t[cur] || []);
    if (cur === 'schE') {
      const c = r.cur;
      h += '<h3>K-1 detail</h3><div class="tablewrap"><table class="t"><thead><tr><th>Entity</th><th>Passive</th><th class="n">Box 1 + 2</th><th class="n">Allowed</th><th>Treatment</th></tr></thead><tbody>' +
        c.k1.map((k) => '<tr><td>' + esc(k.entity) + '</td><td>' + (k.passive ? 'Yes' : 'No') + (k.ptp ? ' (PTP)' : '') + '</td>' + cellNum(k.ord) + cellNum(k.allowed) + '<td class="muted small">' + (k.suspended ? 'Loss suspended' + (k.ptp ? ' under the PTP rules' : ' on Form 8582') : 'Allowed') + '</td></tr>').join('') + '</tbody></table></div>';
    }
    return h;
  };

  /* ================= 1040: REVIEW ================= */
  VIEWS['w-review'] = () => {
    const d = state.data.w1040; const r = compute();
    const openHigh = r.findings.filter((f) => f.module === 'w1040' && f.status === 'Open' && f.severity === 'high').length;
    const ready = r.openItems === 0 && r.tie.variances === 0 && openHigh === 0;
    let h = head('Rivera household · Form 1040 · TY2025', 'Review & sign-off', 'Workflow steps, the training checklist, open items and reviewer sign-off from the workbook.');
    h += '<div class="tiles" style="margin-bottom:10px">' + tile('Open items', r.openItems, 'logged items not closed', r.openItems > 0) + tile('Form 1040 variances', r.tie.variances, '', r.tie.variances > 0) + tile('Open high findings', openHigh, '1040 workpaper', openHigh > 0) + tile('Ready for final', ready ? 'Yes' : 'No', ready ? 'All clear' : 'Clear the items above') + '</div>';
    h += '<h2>Workflow</h2><div class="tablewrap"><table class="t"><thead><tr><th>Step</th><th>Area</th><th>Action</th><th>Status</th></tr></thead><tbody>' +
      d.steps.map((s, i) => '<tr><td class="line">' + s.no + '</td><td>' + esc(s.area) + '</td><td>' + esc(s.action) + '</td><td>' + selectBind('w1040.steps.' + i + '.status', s.status, ['Open', 'Pending', 'In progress', 'Done']) + '</td></tr>').join('') + '</tbody></table></div>';
    h += '<h2>Open items</h2><div class="tablewrap"><table class="t"><thead><tr><th>ID</th><th>Area</th><th>Entity</th><th>Issue</th><th class="n">Amount</th><th>Priority</th><th>Status</th><th>Resolution</th></tr></thead><tbody>' +
      d.openItems.map((o, i) => '<tr><td class="line">OI-' + String(i + 1).padStart(3, '0') + '</td><td>' + inputText('w1040.openItems.' + i + '.area', o.area) + '</td><td>' + inputText('w1040.openItems.' + i + '.entity', o.entity) + '</td><td style="min-width:240px">' + inputText('w1040.openItems.' + i + '.issue', o.issue) + '</td><td class="n">' + inputNum('w1040.openItems.' + i + '.amount', o.amount) + '</td><td>' + selectBind('w1040.openItems.' + i + '.priority', o.priority, ['High', 'Medium', 'Low']) + '</td><td>' + selectBind('w1040.openItems.' + i + '.status', o.status, ['Open', 'In progress', 'Closed']) + '</td><td style="min-width:180px">' + inputText('w1040.openItems.' + i + '.resolution', o.resolution) + '</td></tr>').join('') +
      '</tbody></table></div><p><button class="btn small" data-action="add-oi">Add open item</button></p>';
    h += '<h2>Training checklist</h2><div class="tablewrap"><table class="t"><thead><tr><th>No.</th><th>Area</th><th>Checklist item</th><th>Prepared</th><th>Reviewed</th></tr></thead><tbody>' +
      d.training.map((x, i) => '<tr><td class="line">' + x.no + '</td><td>' + esc(x.area) + '</td><td>' + esc(x.item) + '</td>' + ['prepared', 'reviewed'].map((f) => '<td><input type="checkbox" id="in-w1040.training.' + i + '.' + f + '" data-bind="w1040.training.' + i + '.' + f + '" data-type="bool"' + (x[f] ? ' checked' : '') + ' aria-label="' + f + '"></td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    const so = d.signoff;
    h += '<h2>Sign-off</h2><div class="panel pad"><div class="form">' + [['preparedBy', 'Prepared by'], ['preparedDate', 'Preparation date'], ['reviewedBy', 'Reviewed by'], ['reviewDate', 'Review date']].map(([k, t]) => '<label class="field">' + t + '<input id="in-so-' + k + '" data-bind="w1040.signoff.' + k + '" data-type="text" value="' + esc(so[k]) + '"' + (/Date/.test(k) ? ' type="date"' : '') + '></label>').join('') +
      '</div><label class="field" style="margin-top:12px">Reviewer notes<textarea id="in-so-notes" data-bind="w1040.signoff.notes" data-type="text">' + esc(so.notes) + '</textarea></label></div>';
    return h;
  };

  /* ================= RENTAL ================= */
  const rentalHead = (t, lede, right) => head('Doe household · JD Rental Holdings LLC · TY2026', t, lede, right);
  VIEWS['r-props'] = () => {
    const d = state.data.rental; const r = compute(); const c = r.rent.corrected;
    let h = rentalHead('Rental properties', esc(d.purpose));
    h += '<div class="tiles" style="margin-bottom:6px">' + tile('Total rental income', money(c.tot.income)) + tile('Total deductions', money(c.tot.deductions)) + tile('Net rental income / QBI', money(c.tot.qbi), '', c.tot.qbi < 0) + tile('W-2 wages', money(c.tot.wages)) + tile('UBIA', money(c.tot.ubia)) + '</div>';
    h += '<h2>Owners and taxpayer inputs</h2><div class="grid2"><div class="tablewrap"><table class="t"><thead><tr><th>Owner</th><th class="n">Ownership %</th><th>Note</th></tr></thead><tbody>' +
      d.owners.map((o, i) => '<tr><td>' + esc(o.name) + '</td><td class="n">' + inputNum('rental.owners.' + i + '.pct', o.pct, { pct: true }) + '</td><td class="muted small">' + esc(o.note) + '</td></tr>').join('') +
      '<tr class="total"><td>' + esc(d.holdco.name) + '</td><td class="n">' + pct(c.agg.common, 0) + '</td><td class="muted small">' + esc(d.holdco.status) + '</td></tr></tbody></table></div>';
    const hrs = [['johnRP', 'John real property trade/business hours'], ['johnTotal', 'John total personal service hours'], ['janeRP', 'Jane real property hours'], ['combinedRental', 'Combined rental activity hours'], ['outsideMgmt', 'Outside property management hours']];
    h += '<div class="tablewrap"><table class="t"><tbody>' + hrs.map(([k, t]) => '<tr><td>' + t + '</td><td class="n">' + inputNum('rental.hours.' + k, d.hours[k]) + '</td></tr>').join('') +
      '<tr><td>Taxable income before QBI deduction</td><td class="n">' + inputNum('rental.taxableIncome', d.taxableIncome) + '</td></tr><tr><td>Net capital gain</td><td class="n">' + inputNum('rental.netCapitalGain', d.netCapitalGain) + '</td></tr></tbody></table></div></div>';
    const cols = [['rents', 'Gross rents'], ['otherIncome', 'Other income'], ['opex', 'Operating exp.'], ['repairs', 'Repairs'], ['taxIns', 'Taxes & ins.'], ['interest', 'Interest'], ['depreciation', 'Depreciation'], ['wages', 'W-2 wages'], ['ubia', 'UBIA'], ['hours', 'Owner hours']];
    h += '<h2>Property inputs</h2><div class="tablewrap"><table class="t"><thead><tr><th>Property</th>' + cols.map(([, t]) => '<th class="n">' + t + '</th>').join('') + '</tr></thead><tbody>' +
      d.properties.map((p, i) => '<tr><td style="min-width:170px">' + esc(p.name) + '<div class="muted small">' + esc(p.type) + ' · ' + esc(p.location) + '</div></td>' + cols.map(([k]) => '<td class="n">' + inputNum('rental.properties.' + i + '.' + k, p[k]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    h += '<h2>Property-level P&L and QBI <span class="sub">QBI is determined per property before aggregation (Reg. §1.199A-3)</span></h2><div class="tablewrap"><table class="t"><thead><tr><th>Property</th><th>Entity</th><th class="n">Total income</th><th class="n">Deductions</th><th class="n">Net / QBI</th><th class="n">W-2 wages</th><th class="n">UBIA</th><th class="n">Hours</th></tr></thead><tbody>' +
      c.props.map((p) => '<tr><td>' + esc(p.name) + '</td><td class="muted">' + esc(p.entity) + '</td>' + cellNum(p.income) + cellNum(p.deductions) + cellNum(p.qbi) + cellNum(p.wages) + cellNum(p.ubia) + cellNum(p.hours) + '</tr>').join('') +
      '<tr class="total"><td colspan="2">Total</td>' + cellNum(c.tot.income) + cellNum(c.tot.deductions) + cellNum(c.tot.qbi) + cellNum(c.tot.wages) + cellNum(c.tot.ubia) + cellNum(c.tot.hours) + '</tr></tbody></table></div>';
    return h;
  };
  function testRow(t, val, ok, note) { return '<div class="test-row"><div>' + esc(t) + (note ? '<div class="muted small">' + esc(note) + '</div>' : '') + '</div><div class="val">' + esc(val) + '</div><div>' + passChip(ok) + '</div></div>'; }
  VIEWS['r-469'] = () => {
    const r = compute(); const c = r.rent.corrected; const d = state.data.rental;
    const co = c;
    let h = rentalHead('Rental election & ownership', 'Planning view: whether the §469(c)(7)(A) election pays, which properties carry the hours, and how an ownership change moves the §199A deduction. Uses corrected logic.', '<a class="btn" href="#r-199a">Open return positions</a>');
    h += '<div class="grid2"><div class="panel pad"><h3 style="margin-top:0">Qualifying taxpayer tests</h3><div class="tests">' +
      testRow('More than 750 hours in real property trades or businesses', fmtNum(c.rep.rpHours) + ' hrs', c.rep.rpPass, '§469(c)(7)(B)(ii)') +
      testRow('More than half of personal services in real property', pct(c.rep.share), c.rep.sharePass, '§469(c)(7)(B)(i)') +
      testRow('One spouse separately meets both tests (joint return)', 'John', c.rep.rpPass && c.rep.sharePass, 'Spouses\' hours are not combined for these two tests') +
      testRow('Material participation in the combined rental activity', fmtNum(c.rep.mp) + ' hrs', c.rep.mpPass, 'Reg. §1.469-5T(a)(1): more than 500 hours; spouses\' hours count together') +
      '</div><div class="banner" style="margin:14px 0 0">' + (c.rep.pass ? '<b>Supportable on these facts.</b> Attach the election statement to the original 2026 return.' : '<b>Review failed tests.</b> The election does not help unless every test is met.') + '</div></div>';
    const e = c.election;
    h += '<div class="panel pad"><h3 style="margin-top:0">What the election is worth</h3><p class="small muted">Net rental result ' + money(e.net) + ' at a ' + inputNum('settings.rentalMarginal', state.settings.rentalMarginal, { pct: true, dp: 1, label: 'Marginal rate' }).replace('class="cell"', 'class="cell" style="width:80px;min-width:0;display:inline-block"') + ' marginal rate</p>' +
      '<div class="tablewrap"><table class="t"><thead><tr><th>Treatment</th><th class="n">Loss deductible now</th></tr></thead><tbody>' +
      '<tr><td>Not a real estate professional (all passive; allowance phased out)</td>' + cellNum(e.noRep) + '</tr>' +
      '<tr><td>Qualifies, no election (each property tested alone)</td>' + cellNum(e.repNoElection) + '</tr>' +
      '<tr class="total"><td>Qualifies and elects to aggregate</td>' + cellNum(e.withElection) + '</tr></tbody></table></div>' +
      '<dl class="kv" style="margin-top:12px">' + kv('Tax value versus no election', money(e.value)) + kv('Tax value versus no REP status', money(e.valueVsNone)) + '</dl>' +
      '<p class="small muted" style="margin-bottom:0">A suspended loss is not lost; it carries forward and is freed on a later disposition. The value shown is the timing benefit in 2026.</p></div></div>';
    h += '<h2>Rental interests covered by the election</h2><div class="tablewrap"><table class="t"><thead><tr><th>Rental real estate interest</th><th class="n">Owner hours</th><th>Meets 500 hours alone</th><th class="n">Net result</th></tr></thead><tbody>' +
      c.props.map((p) => '<tr><td>' + esc(p.entity) + '</td>' + cellNum(p.hours) + '<td>' + passChip(p.hours > 500, 'Yes', 'No') + '</td>' + cellNum(p.qbi) + '</tr>').join('') +
      '<tr class="total"><td>Total</td>' + cellNum(c.tot.hours) + '<td></td>' + cellNum(c.tot.qbi) + '</tr></tbody></table></div>';
    h += '<h2>Ownership scenario</h2><p class="lede">Model a different ownership split. Scenario percentages should total 100%.</p><div class="tablewrap"><table class="t"><thead><tr><th>Owner</th><th class="n">Current %</th><th class="n">Scenario %</th><th class="n">Allocated QBI</th><th class="n">Scenario deduction</th><th class="n">Current</th><th class="n">Change</th><th>Binding</th></tr></thead><tbody>' +
      co.scenario.map((o, i) => '<tr><td>' + esc(o.name) + '</td><td class="n">' + pct(d.owners[i].pct, 0) + '</td><td class="n">' + inputNum('rental.scenarioPcts.' + i, d.scenarioPcts[i], { pct: true }) + '</td>' + cellNum(o.qbi) + cellNum(o.ded) + cellNum(o.current) + cellNum(o.change) + '<td class="muted small">' + esc(o.binding) + '</td></tr>').join('') +
      '<tr class="total"><td colspan="2">Total</td><td class="n">' + pct(co.scenTotal, 1) + ' ' + passChip(co.scenOk, 'OK', 'Check %') + '</td>' + cellNum(E.sum(co.scenario, (o) => o.qbi)) + cellNum(E.sum(co.scenario, (o) => o.ded)) + cellNum(E.sum(co.scenario, (o) => o.current)) + cellNum(E.sum(co.scenario, (o) => o.change)) + '<td></td></tr></tbody></table></div>';
    h += '<p class="lede small" style="margin-top:12px">A qualifying taxpayer may not group rental real estate with nonrental activities. Management work counts only when it is performed for the taxpayer\'s own rental interests; this model assumes all ' + fmtNum(d.hours.combinedRental) + ' owner hours are. [1a] [2a] [3a]</p>';
    return h;
  };
  VIEWS['r-199a'] = () => {
    const r = compute(); const d = state.data.rental; const wb = r.rent.asBuilt, co = r.rent.corrected, cur = r.rent.cur;
    let h = rentalHead('Rental return positions', 'Compliance view: the real estate professional tests behind the §469 election, the §199A aggregation tests, the deduction as built and corrected, and the owner limits.', '<a class="btn" href="#r-469">Open rental planning</a>');
    h += modeNote();
    h += '<div class="panel pad" style="margin-bottom:16px"><h3 style="margin-top:0">§469(c)(7) qualifying taxpayer and material participation</h3><div class="tests">' +
      testRow('John: more than 750 hours in real property trades or businesses', fmtNum(cur.rep.rpHours) + ' hrs', cur.rep.rpPass, '§469(c)(7)(B)(ii)') +
      testRow('John: more than half of personal services in real property', pct(cur.rep.share), cur.rep.sharePass, '§469(c)(7)(B)(i)') +
      testRow('Material participation in the combined rental activity', fmtNum(cur.rep.mp) + ' hrs', cur.rep.mpPass, 'Reg. §1.469-5T(a)(1); spouses\' hours count together') +
      '</div><p class="small muted" style="margin:10px 0 0">Keep contemporaneous time logs. The election statement must be attached to the timely filed original return; see the <a href="#calendar">filing calendar</a>.</p></div>';
    const yn = (k, t, note) => '<div class="test-row"><div>' + esc(t) + '<div class="muted small">' + esc(note || '') + '</div></div><div>' + selectBind('rental.aggregation.' + k, d.aggregation[k], ['Yes', 'No']) + '</div><div>' + passChip(d.aggregation[k] === 'Yes') + '</div></div>';
    h += '<div class="grid2"><div class="panel pad"><h3 style="margin-top:0">Aggregation requirements</h3><div class="tests">' +
      testRow('Common ownership of 50% or more', pct(cur.agg.common, 0), cur.agg.commonPass, d.aggregationNotes.common) +
      yn('majorityYear', 'Ownership for the majority of the year and on the last day', d.aggregationNotes.majorityYear) + yn('sameYear', 'Same taxable year', d.aggregationNotes.sameYear) + yn('noSSTB', 'No business is a specified service business', d.aggregationNotes.noSSTB) +
      yn('factorA', 'Factor A: same or customarily offered property or services', d.aggregationNotes.factorA) + yn('factorB', 'Factor B: shared centralized business elements', d.aggregationNotes.factorB) + yn('factorC', 'Factor C: operated in coordination or reliance', d.aggregationNotes.factorC) +
      testRow('At least two relationship factors', cur.agg.factors + ' of 3', cur.agg.factorsPass) +
      '</div><div class="banner" style="margin:14px 0 0">' + (cur.agg.pass ? '<b>Aggregation supportable on these facts.</b> The RPE must attach an annual aggregation statement to each owner\'s K-1.' : '<b>Review failed tests.</b>') + '</div></div>';
    const line = (t, k, fmtf) => '<tr><td>' + t + '</td>' + [wb, co].map((x) => { const v = typeof k === 'function' ? k(x) : x.summary[k]; return fmtf ? '<td class="n">' + fmtf(v) + '</td>' : cellNum(v); }).join('') + '</tr>';
    h += '<div class="panel pad"><h3 style="margin-top:0">QBI deduction</h3><div class="tablewrap"><table class="t"><thead><tr><th>Step</th><th class="n">As built</th><th class="n">Corrected</th></tr></thead><tbody>' +
      line('Aggregated QBI', (x) => x.tot.qbi) + line('Aggregated W-2 wages', (x) => x.tot.wages) + line('Aggregated UBIA', (x) => x.tot.ubia) +
      line('20% of QBI', 'q20') + line('50% of W-2 wages', 'w50') + line('25% of wages + 2.5% of UBIA', 'alt') + line('Wage / UBIA limitation', 'wageLimit') +
      line('QBI component', 'comp') + line('Taxable-income limitation', 'tiLimit') + '<tr class="total"><td>§199A deduction</td>' + cellNum(wb.summary.ded) + cellNum(co.summary.ded) + '</tr>' +
      line('Negative QBI carried to 2027', 'carry') + '</tbody></table></div>' +
      '<div class="form" style="margin-top:12px"><label class="field">2026 threshold (MFJ)' + inputNum('settings.rentalThreshold', state.settings.rentalThreshold) + '<span class="hint">Confirm against the 2026 inflation adjustment</span></label><label class="field">Phase-in range' + inputNum('settings.rentalPhaseRange', state.settings.rentalPhaseRange) + '<span class="hint">$150,000 MFJ under OBBBA</span></label></div></div></div>';
    h += '<h2>Owner-level limits <span class="sub">informational on a joint return</span></h2><div class="tablewrap"><table class="t"><thead><tr><th>Owner</th><th class="n">Own %</th><th class="n">QBI</th><th class="n">Wages</th><th class="n">UBIA</th><th class="n">20% QBI</th><th class="n">Wage/UBIA limit</th><th class="n">After wage limit</th><th class="n">TI limit</th><th class="n">Deduction</th><th>Binding</th></tr></thead><tbody>' +
      cur.owners.map((o) => '<tr><td>' + esc(o.name) + '</td><td class="n">' + pct(o.pct, 0) + '</td>' + cellNum(o.qbi) + cellNum(o.wages) + cellNum(o.ubia) + cellNum(o.q20) + cellNum(o.wageLimit) + cellNum(o.comp) + cellNum(o.tiLimit) + cellNum(o.ded) + '<td class="muted small">' + esc(o.binding) + '</td></tr>').join('') +
      '<tr class="total"><td colspan="9">Total of owner deductions</td>' + cellNum(cur.ownerTotal) + '<td></td></tr></tbody></table></div>';
    h += '<h2>Safe-harbor enterprises <span class="sub">Rev. Proc. 2019-38, 250 hours each</span></h2><div class="tablewrap"><table class="t"><thead><tr><th>Enterprise</th><th>Properties</th><th class="n">Owner hours</th><th>250-hour test</th></tr></thead><tbody>' +
      co.enterprises.map((e) => '<tr><td>' + esc(e.name) + '</td><td>' + esc(e.names.join(', ')) + '</td>' + cellNum(e.hours) + '<td>' + passChip(e.hours >= 250) + '</td></tr>').join('') + '</tbody></table></div><p class="small muted">Outside-manager hours (' + fmtNum(d.hours.outsideMgmt) + ') also count toward the 250 hours once allocated to an enterprise.</p>';
    return h;
  };
  VIEWS['r-statements'] = () => {
    const d = state.data.rental; const c = compute().rent.cur;
    const ents = d.properties.map((p) => p.entity);
    const john = d.owners[0].name, names = d.owners.map((o) => o.name.split(' ')[0]).join(' and ') + ' ' + d.owners[0].name.split(' ').slice(-1)[0];
    const s1 = 'Taxpayer: ' + names + '. Tax year: 2026.\n\n' + john + ' declares that he is a qualifying taxpayer for the taxable year and elects under section 469(c)(7)(A) of the Internal Revenue Code to treat all interests in rental real estate as a single rental real estate activity. This includes interests held through ' + d.holdco.name + ' and its disregarded property LLCs: ' + ents.join(', ') + '.\n\nThis statement is filed with the taxpayer\'s original income tax return for the year of the election. [1a] [2a]';
    const s2 = d.holdco.name + ' aggregates the rental real estate trades or businesses operated through ' + ents.join(', ') + ' for purposes of section 199A.\n\nThe same person or group owns ' + pct(c.agg.common, 0) + ' of each business for a majority of the taxable year and on its last day; all businesses use the same taxable year; none is a specified service trade or business; and the businesses satisfy ' + c.agg.factors + ' of the relationship factors through common rental real estate services, centralized accounting, legal, leasing and vendor management, and coordinated operations. No trade or business was formed, acquired, disposed of, or ceased during 2026.\n\nThe RPE reports each owner\'s share of QBI, W-2 wages and UBIA on Schedule K-1 attachments. [8a] [9a]';
    let h = rentalHead('Election statements', 'Draft return and K-1 attachment statements, generated from the current facts. Review the wording with the engagement partner before filing. Due dates are on the <a href="#calendar">filing calendar</a>.');
    h += '<div class="statement"><h4>A. §469(c)(7)(A) election statement</h4>' + esc(s1) + '</div><p><button class="btn small" data-copy="' + esc(s1) + '">Copy statement A</button></p>';
    h += '<div class="statement"><h4>B. §199A aggregation statement (RPE K-1 attachment)</h4>' + esc(s2) + '</div><p><button class="btn small" data-copy="' + esc(s2) + '">Copy statement B</button></p>';
    h += '<h2>Aggregated businesses</h2><div class="tablewrap"><table class="t"><thead><tr><th>Entity</th><th>Description</th><th>EIN</th><th>Formed, acquired, disposed or ceased in 2026</th></tr></thead><tbody>' +
      d.properties.map((p) => '<tr><td>' + esc(p.entity) + '</td><td>' + esc(p.type) + '</td><td class="muted">XX-XXXXXXX</td><td>No</td></tr>').join('') + '</tbody></table></div>';
    return h;
  };

  /* ================= HNWI ================= */
  const hnwiHead = (t, lede, right) => head('Doe household · John Doe wealth plan · 2026', t, lede, right);
  const riskCls = { High: 'bad', Medium: 'warn', Low: 'good' };
  VIEWS['h-dash'] = () => {
    const h0 = state.data.hnwi; const r = compute().hn; const db = r.dashboard;
    let h = hnwiHead('Strategy dashboard', esc(h0.purpose) + ' ' + esc(h0.note));
    h += '<div class="tiles">' + tile('Strategies', db.count) + tile('Sum of all benefits', moneyM(db.total), 'not additive; see findings') + tile('Average benefit', moneyM(db.avg)) + tile('Highest', moneyM(db.max)) + tile('Lowest', moneyM(db.min)) + tile('Checklist cost', moneyM(r.checklist.cost), r.checklist.total + ' steps') + '</div>';
    const top = db.top.map((no) => ({ s: h0.strategies.find((x) => x.no === no), r: r.byNo[no] }));
    const maxV = Math.max(...top.map((t) => Math.max(t.r.high, t.r.benefit)));
    const step = niceStep(maxV / 4); const ticks = []; for (let v = 0; v <= maxV + step * 0.01; v += step) ticks.push(v);
    const scaleMax = ticks[ticks.length - 1] < maxV ? ticks[ticks.length - 1] + step : ticks[ticks.length - 1];
    if (ticks[ticks.length - 1] < scaleMax) ticks.push(scaleMax);
    const X = (v) => (Math.max(0, v) / scaleMax * 100).toFixed(2) + '%';
    h += '<h2>Top 15 strategies by estimated benefit <span class="sub">bar = estimate; whisker = low to high case</span></h2><div class="panel pad"><div class="bars" role="list">' +
      top.map((t) => '<a class="bar-row" role="listitem" href="#h-matrix" data-open="' + t.s.no + '" data-tip="' + esc('#' + t.s.no + ' ' + t.s.title + '|' + t.s.category + ' · ' + t.s.risk + ' risk|Estimate ' + money(t.r.benefit) + '|Range ' + money(t.r.low) + ' to ' + money(t.r.high)) + '" style="text-decoration:none;color:inherit"><span class="lbl"><b>' + t.s.no + '</b>' + esc(t.s.title) + '</span><span class="bar-track">' +
        ticks.map((v) => '<i class="grid" style="left:' + X(v) + '"></i>').join('') +
        '<i class="range" style="left:' + X(t.r.low) + ';width:calc(' + X(t.r.high) + ' - ' + X(t.r.low) + ')"></i><i class="bar" style="width:' + X(t.r.benefit) + '"></i><i class="cap" style="left:' + X(t.r.low) + '"></i><i class="cap" style="left:' + X(t.r.high) + '"></i></span><span class="val">' + moneyM(t.r.benefit) + '</span></a>').join('') +
      '</div><div class="axis"><span></span><span class="ticks">' + ticks.map((v) => '<span style="left:' + X(v) + '">' + moneyM(v) + '</span>').join('') + '</span><span></span></div></div>';
    const rk = db.risk; const tot = rk.High + rk.Medium + rk.Low;
    h += '<div class="grid2"><div><h2>Risk profile</h2><div class="panel pad"><div class="risk-dist" aria-hidden="true"><div style="flex:' + rk.High + ';background:var(--bad)"></div><div style="flex:' + rk.Medium + ';background:var(--warn)"></div><div style="flex:' + rk.Low + ';background:var(--good)"></div></div>' +
      '<dl class="kv">' + kv('High risk', rk.High + ' (' + pct(rk.High / tot, 0) + ')') + kv('Medium risk', rk.Medium + ' (' + pct(rk.Medium / tot, 0) + ')') + kv('Low risk', rk.Low + ' (' + pct(rk.Low / tot, 0) + ')') + '</dl></div></div>';
    const cats = Object.entries(db.categories).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    h += '<div><h2>Strategies by category</h2><div class="tablewrap" style="max-height:300px;overflow-y:auto"><table class="t"><thead><tr><th>Category</th><th class="n">Count</th><th class="n">Benefit</th></tr></thead><tbody>' +
      cats.map(([k, v]) => '<tr><td>' + esc(k) + '</td><td class="n">' + v + '</td>' + '<td class="n">' + moneyM(E.sum(h0.strategies.filter((s) => s.category === k), (s) => r.byNo[s.no].benefit)) + '</td></tr>').join('') + '</tbody></table></div></div></div>';
    h += '<h2>Planning assumptions <span class="sub">named inputs used by every strategy formula</span></h2><div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Description</th><th class="n">Value</th><th>Source</th></tr></thead><tbody>' +
      h0.assumptions.map((a, i) => '<tr><td style="font-family:var(--mono);font-size:12px">' + esc(a.name) + '</td><td>' + esc(a.desc) + '</td><td class="n">' + inputNum('hnwi.assumptions.' + i + '.value', a.value, a.format === 'percent' ? { pct: true, dp: 2, label: a.name } : { label: a.name }) + '</td><td class="muted small">' + esc(a.source || '') + '</td></tr>').join('') + '</tbody></table></div>';
    return h;
  };
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
  const GL = [['G', 'Starting asset / deduction / gain'], ['H', 'Basis or offset'], ['I', 'Growth / return rate'], ['J', 'Horizon (years)'], ['K', 'Other input 1'], ['L', 'Other input 2']];
  VIEWS['h-matrix'] = () => {
    const h0 = state.data.hnwi; const r = compute().hn; const fl = state.ui.filter;
    const cat = fl.hcat || 'all', risk = fl.hrisk || 'all', q = (fl.hq || '').toLowerCase(), sort = fl.hsort || 'no';
    let list = h0.strategies.map((s, i) => ({ s, i, r: r.byNo[s.no] })).filter((x) => (cat === 'all' || x.s.category === cat) && (risk === 'all' || x.s.risk === risk) && (!q || (x.s.title + ' ' + x.s.situation + ' ' + x.s.category).toLowerCase().includes(q)));
    if (sort === 'benefit') list.sort((a, b) => b.r.benefit - a.r.benefit); else if (sort === 'net') list.sort((a, b) => a.r.rank - b.r.rank);
    const cats = [...new Set(h0.strategies.map((s) => s.category))].sort();
    let h = hnwiHead('Strategy matrix', 'All 50 strategies with their inputs and benefit formulas. Select a row to edit its inputs or formula; formulas use the row inputs G–L and the named planning assumptions.');
    h += '<div class="form" style="margin-bottom:14px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">' + filterSel('hcat', 'Category', cat, [['all', 'All categories'], ...cats.map((c) => [c, c])]) + filterSel('hrisk', 'Risk', risk, [['all', 'All'], ['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']]) + filterSel('hsort', 'Sort', sort, [['no', 'Strategy number'], ['benefit', 'Estimated benefit'], ['net', 'Net benefit rank']]) +
      '<label class="field">Search<input id="flt-hq" data-filter-text="hq" value="' + esc(fl.hq || '') + '" placeholder="Title or situation"></label></div>';
    h += '<div class="tablewrap"><table class="t"><thead><tr><th>No.</th><th>Strategy</th><th>Category</th><th>Risk</th><th class="n">Estimated benefit</th><th class="n">Low – high</th><th class="n">Net of cost</th><th class="n">Rank</th></tr></thead><tbody>';
    list.forEach(({ s, i, r: x }) => {
      const open = state.ui.open['s' + s.no];
      h += '<tr class="clickable" data-toggle="s' + s.no + '" aria-expanded="' + !!open + '"><td class="line">' + s.no + '</td><td class="wrap"><b style="font-weight:600">' + esc(s.title) + '</b>' + (x.error ? ' ' + chip('bad', 'Formula error') : '') + '<div class="muted small">' + esc(s.situation) + '</div></td><td class="small">' + esc(s.category) + '</td><td>' + chip(riskCls[s.risk], s.risk) + '</td><td class="n">' + money(x.benefit) + '</td><td class="n small">' + moneyM(x.low) + ' – ' + moneyM(x.high) + '</td>' + cellNum(x.net) + '<td class="n">' + x.rank + '</td></tr>';
      if (open) {
        h += '<tr class="detail"><td colspan="8"><div class="grid2"><div><dl class="kv" style="grid-template-columns:auto 1fr">' +
          ['objective', 'mechanics', 'implementation', 'jurisdiction'].map((k) => '<dt>' + { objective: 'Objective', mechanics: 'Mechanics', implementation: 'Implementation', jurisdiction: 'Jurisdiction' }[k] + '</dt><dd style="font-family:var(--sans);text-align:left">' + esc(s[k]) + '</dd>').join('') +
          '<dt>Conflicts</dt><dd style="font-family:var(--sans);text-align:left">' + esc(s.conflict || '—') + '</dd><dt>Sources</dt><dd style="font-family:var(--sans);text-align:left">' + esc(s.sources) + '</dd><dt>Checklist</dt><dd style="font-family:var(--sans);text-align:left">' + x.done + ' of ' + x.items + ' steps complete · <a href="#h-check" data-checkfilter="' + s.no + '">open steps</a></dd></dl></div>' +
          '<div><div class="form" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' + GL.map(([k, t]) => '<label class="field">' + k + ' · ' + t + inputNum('hnwi.strategies.' + i + '.' + k, s[k], { label: t }) + '</label>').join('') + '</div>' +
          '<label class="field" style="margin-top:10px">Benefit formula <span class="hint">' + esc(s.formulaDesc) + '</span>' + inputText('hnwi.strategies.' + i + '.formula', s.formula, { style: 'font-family:var(--mono)' }) + '</label>' +
          (x.error ? '<p class="neg small">' + esc(x.error) + '</p>' : '') +
          '<div class="form" style="margin-top:10px;grid-template-columns:1fr 1fr"><label class="field">Low case formula' + inputText('hnwi.strategies.' + i + '.low', s.low, { style: 'font-family:var(--mono)' }) + '</label><label class="field">High case formula' + inputText('hnwi.strategies.' + i + '.high', s.high, { style: 'font-family:var(--mono)' }) + '</label></div>' +
          '<p style="margin:10px 0 0"><button class="btn small" data-ask="' + esc('Walk me through strategy #' + s.no + ' (' + s.title + ') for John Doe: how the benefit formula works, whether the inputs look reasonable, key risks, and what the implementation steps involve.') + '">Ask the advisor about this strategy</button></p></div></div></td></tr>';
      }
    });
    h += '</tbody></table></div>';
    return h;
  };
  VIEWS['h-cost'] = () => {
    const h0 = state.data.hnwi; const r = compute().hn; const sel = r.selected;
    let h = hnwiHead('Cost-benefit', 'Net benefit and benefit-to-cost ratio for each strategy. Costs roll up from the implementation checklist: one-time is planning, implementation and filing; recurring is annual monitoring times the horizon. Select strategies to build a package.');
    h += '<div class="form" style="margin-bottom:12px;grid-template-columns:repeat(auto-fit,minmax(180px,240px))"><label class="field">Analysis horizon (years)' + inputNum('hnwi.horizon', h0.horizon) + '</label></div>';
    h += '<div class="tiles">' + tile('Selected', sel.count + ' of 50') + tile('Selected benefit', moneyM(sel.benefit)) + tile('One-time cost', moneyM(sel.oneTime)) + tile('Recurring over horizon', moneyM(sel.recurring)) + tile('Selected net benefit', moneyM(sel.net)) + tile('Median ratio (all 50)', r.all.medianRatio.toFixed(1) + '×', r.all.below1 + ' below 1.0×') + '</div>';
    const nFil = compute().calendar.filter((c) => c.strategies).length;
    h += '<div class="banner" style="margin-top:14px"><span>' + (sel.count ? 'The selected package adds <b>' + nFil + ' filing' + (nFil === 1 ? '' : 's') + '</b> to the compliance calendar.' : 'Select strategies to add their required filings (Form 709, 8283, FBAR and others) to the compliance calendar.') + '</span><a class="btn small" href="#calendar">Open filing calendar</a></div>';
    h += '<p style="margin:12px 0"><button class="btn small" data-action="sel-top">Select top 10 by net benefit</button> <button class="btn small" data-action="sel-none">Clear selection</button></p>';
    h += '<div class="tablewrap"><table class="t"><thead><tr><th>Select</th><th>No.</th><th>Strategy</th><th>Risk</th><th class="n">Benefit</th><th class="n">One-time</th><th class="n">Annual</th><th class="n">Horizon cost</th><th class="n">Net</th><th class="n">Ratio</th><th class="n">Rank</th><th>Flag</th></tr></thead><tbody>' +
      h0.strategies.map((s, i) => { const x = r.byNo[s.no]; return '<tr><td><input type="checkbox" id="in-sel-' + s.no + '" data-bind="hnwi.strategies.' + i + '.selected" data-type="bool"' + (s.selected ? ' checked' : '') + ' aria-label="Select ' + esc(s.title) + '"></td><td class="line">' + s.no + '</td><td class="wrap">' + esc(s.title) + (s.conflict ? '<div class="muted small">' + esc(s.conflict) + '</div>' : '') + '</td><td>' + chip(riskCls[s.risk], s.risk) + '</td>' + cellNum(x.benefit) + cellNum(x.oneTime) + cellNum(x.recurring) + cellNum(x.horizonCost) + cellNum(x.net) + '<td class="n">' + x.ratio.toFixed(1) + '×</td><td class="n">' + x.rank + '</td><td>' + chip(x.flag === 'Review' ? 'plain' : x.flag === 'High risk' ? 'warn' : 'bad', x.flag) + '</td></tr>'; }).join('') +
      '<tr class="total"><td colspan="4">All 50 (reference)</td>' + cellNum(r.all.benefit) + cellNum(E.sum(r.rows, (x) => x.oneTime)) + cellNum(E.sum(r.rows, (x) => x.recurring)) + cellNum(r.all.cost) + cellNum(r.all.net) + '<td colspan="3"></td></tr></tbody></table></div>';
    return h;
  };
  const STATUSES = ['Not Started', 'In Progress', 'Waiting on Advisor', 'Complete'];
  VIEWS['h-check'] = () => {
    const h0 = state.data.hnwi; const r = compute().hn; const fl = state.ui.filter;
    const sno = fl.cno || 'all', ph = fl.cph || 'all', st = fl.cst || 'all';
    const list = h0.checklist.map((c, i) => ({ c, i })).filter(({ c }) => (sno === 'all' || String(c.no) === String(sno)) && (ph === 'all' || c.phase === ph) && (st === 'all' || c.status === st));
    let h = hnwiHead('Implementation checklist', 'Four steps per strategy: planning, implementation, filing and monitoring. Update status, priority and cost as the engagement moves; costs feed the cost-benefit view.');
    const cs = r.checklist.status;
    h += '<div class="tiles" style="margin-bottom:12px">' + STATUSES.map((s) => tile(s, cs[s] || 0)).join('') + tile('Estimated cost', moneyM(r.checklist.cost), 'average ' + money(r.checklist.avg) + ' per step') + '</div>';
    h += '<div class="form" style="margin-bottom:14px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">' + filterSel('cno', 'Strategy', String(sno), [['all', 'All strategies'], ...h0.strategies.map((s) => [String(s.no), s.no + ' · ' + s.title])]) + filterSel('cph', 'Phase', ph, [['all', 'All phases'], ['Planning / Diligence', 'Planning / Diligence'], ['Implementation / Funding', 'Implementation / Funding'], ['Tax Filing / Reporting', 'Tax Filing / Reporting'], ['Ongoing Monitoring', 'Ongoing Monitoring']]) + filterSel('cst', 'Status', st, [['all', 'All'], ...STATUSES.map((s) => [s, s])]) + '</div>';
    h += '<p class="small muted">' + list.length + ' of ' + h0.checklist.length + ' steps shown</p><div class="tablewrap"><table class="t"><thead><tr><th>No.</th><th>Phase</th><th>Checklist item</th><th>Responsible</th><th>Timeline</th><th class="n">Cost</th><th>Status</th><th>Priority</th></tr></thead><tbody>' +
      list.map(({ c, i }) => '<tr><td class="line">' + c.no + '</td><td class="small">' + esc(c.phase) + '</td><td class="wrap small">' + esc(c.item) + '<div class="muted">' + esc(c.docs) + '</div></td><td class="small">' + esc(c.party) + '</td><td class="small muted" style="min-width:160px">' + esc(c.timeline) + '</td><td class="n">' + inputNum('hnwi.checklist.' + i + '.cost', c.cost) + '</td><td>' + selectBind('hnwi.checklist.' + i + '.status', c.status, STATUSES) + '</td><td>' + selectBind('hnwi.checklist.' + i + '.priority', c.priority, ['High', 'Medium', 'Low']) + '</td></tr>').join('') + '</tbody></table></div>';
    return h;
  };

  /* ================= LIBRARY ================= */
  VIEWS.sources = () => {
    const d = state.data;
    let h = head('Library', 'Sources', 'Citations carried from each workbook\'s Sources tab. Bracketed markers such as [8a] in notes and statements refer to these rows.');
    [...(window.TM_SOURCES || []).map((g) => [g.title, g.list]), ['1040 reconciliation workpaper', d.w1040.sources], ['Rental HoldCo', d.rental.sources], ['HNWI strategies', d.hnwi.sources]].forEach(([t, list]) => {
      h += '<h2>' + t + ' <span class="sub">' + list.length + ' sources</span></h2><div class="tablewrap"><table class="t"><thead><tr><th>ID</th><th>Title</th><th>Excerpt</th></tr></thead><tbody>' + list.map((s) => '<tr><td class="line">' + esc(s.id) + '</td><td style="min-width:180px">' + esc(s.title) + '<div class="muted small" style="word-break:break-all">' + esc(s.ref || '') + '</div></td><td class="small">' + esc(s.excerpt) + '</td></tr>').join('') + '</tbody></table></div>';
    });
    return h;
  };
  VIEWS.audit = () => {
    let h = head('Library', 'Change log', 'Every input change, with who made it. Changes the advisor makes are marked and can be undone here.');
    const rows = state.audit.map((a, i) => ({ a, i })).reverse();
    h += rows.length ? '<div class="tablewrap"><table class="t"><thead><tr><th>When</th><th>By</th><th>Field</th><th class="n">From</th><th class="n">To</th><th>Note</th><th></th></tr></thead><tbody>' +
      rows.map(({ a, i }) => '<tr><td class="small muted" style="white-space:nowrap">' + esc(new Date(a.ts).toLocaleString()) + '</td><td>' + (a.by === 'advisor' ? chip('info', 'Advisor') : esc(a.by)) + '</td><td class="small" style="font-family:var(--mono)">' + esc(label(a.path)) + '</td><td class="n small">' + esc(show(a.from)) + '</td><td class="n small">' + esc(show(a.to)) + '</td><td class="small muted">' + esc(a.note) + '</td><td>' + (a.undone ? '<span class="muted small">Undone</span>' : a.noUndo ? '' : '<button class="btn small" data-undo="' + i + '">Undo</button>') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">No changes yet. Edit any yellow cell and it will be logged here.</p>';
    return h;
  };
  const show = (v) => (v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v).slice(0, 60));
  VIEWS.settings = () => {
    const s = state.settings;
    let h = head('Library', 'Settings', 'Make the workspace your own. Appearance choices do not change client tax inputs.');
    h += shellUI ? shellUI.appearanceSettings() : '';
    h += '<h2>Report identity</h2><div class="panel pad"><div class="form"><label class="field">Preparer' + inputText('settings.preparer', s.preparer) + '</label><label class="field">Firm' + inputText('settings.firm', s.firm) + '</label></div></div>';
    h += '<h2>OpenAI connection</h2><div class="panel pad"><p>OpenAI connects through the app’s server. The OpenAI API key stays on the server; it is never entered in a client workbook.</p><p id="advisorServerStatus" class="small muted" role="status">Checking server connection…</p><div class="form"><label class="field">Private AI app access token<input id="in-advisor-access" type="password" autocomplete="off" placeholder="Separate app access token"></label></div><p class="small muted">For a hosted app, use the separate app access token configured on your server. It stays in memory until reload. Local line explanations and calculations work without a connection.</p><div class="tm-data-actions"><button class="btn primary" data-action="use-openai">Use OpenAI</button><a class="btn" href="#ai-analysis">Open AI analysis</a><a class="btn" href="#guide">Connection instructions</a></div></div>';
    const connections = extensions.find((extension) => extension.settingsMarkup);
    if (connections) h += '<h2>Google Sheets</h2><div class="panel pad">' + connections.settingsMarkup() + '<p><a class="btn" href="#connections">Connect your Google account & manage transfers</a></p></div>';
    h += '<h2>Data & client reports</h2><div class="panel pad"><p>Download an editable Excel workbook, preview an import, or generate a client report from the active return and selected planning columns.</p><div class="tm-data-actions"><a class="btn primary" href="#data">Import & export</a><a class="btn" href="#report">Client report</a><a class="btn" href="#clients">Clients & tax years</a></div></div>';
    h += '<details class="panel pad" style="margin-top:20px"><summary>Advanced · sample workbook calculation options</summary><p class="small muted">These options affect the separate training workbooks in the Reference library. Active-client planning, reconciliation and reports use the current Form 1040 engine and the client’s own inputs.</p><div class="form">' +
      '<label class="field">Logic' + selectBind('settings.mode', s.mode, [['corrected', 'Corrected'], ['workbook', 'Workbook as built']]) + '<span class="hint">Applies to the 1040 workpaper and the rental model</span></label>' +
      '<label class="field">Variance tolerance ($)' + inputNum('settings.tolerance', s.tolerance) + '</label>' +
      '<label class="field">Form 1040 line 16' + selectBind('settings.taxSource', s.taxSource, [['software', 'Software input'], ['engine', 'Engine (2025 MFJ)']]) + '</label>' +
      '<label class="field">Schedule 2 NIIT' + selectBind('settings.niitSource', s.niitSource, [['input', 'Typed input'], ['engine', 'Engine estimate']]) + '</label>' +
      '<label class="field">§199A threshold, 2026 MFJ' + inputNum('settings.rentalThreshold', s.rentalThreshold) + '</label>' +
      '<label class="field">§199A phase-in range' + inputNum('settings.rentalPhaseRange', s.rentalPhaseRange) + '</label>' +
      '<label class="field">Marginal rate for loss value' + inputNum('settings.rentalMarginal', s.rentalMarginal, { pct: true, dp: 1 }) + '</label></div></details>';
    h += '<details class="panel pad" style="margin-top:16px"><summary>Advanced · legacy advisor providers</summary><p class="small muted">Keep an existing Claude or Anthropic connection if needed. OpenAI is the primary server connection.</p><div class="form">' +
      '<label class="field">Connection' + selectBind('settings.advisorBackend', s.advisorBackend, [['auto', 'Automatic'], ['openai', 'OpenAI · server connection'], ['claude', 'claude.ai account'], ['api', 'Anthropic API key']]) + '</label>' +
      '<label class="field">Depth (claude.ai)' + selectBind('settings.advisorTier', s.advisorTier, [['quick', 'Quick'], ['default', 'Balanced'], ['complex', 'Most thorough']]) + '</label>' +
      '<label class="field">Anthropic model' + inputText('settings.apiModel', s.apiModel) + '</label>' +
      '<label class="field">Anthropic API key<input id="in-apikey" type="password" autocomplete="off" data-bind="settings.apiKey" data-type="text" value="' + esc(s.apiKey) + '" placeholder="sk-ant-…"></label>' +
      '<label class="field" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="in-remember" data-bind="settings.rememberKey" data-type="bool"' + (s.rememberKey ? ' checked' : '') + '> Remember the legacy provider key on this device</label></div></details>';
    return h;
  };

  /* ---------------- render ---------------- */
  const $ = (sel) => document.querySelector(sel);
  function render() {
    if (state.view === 'home' || !VIEWS[state.view]) state.view = wsHome();
    const view = state.view;
    const r = compute();
    const openCount = r.findings.filter((f) => f.status === 'Open' && (f.severity === 'high' || f.severity === 'medium')).length;
    const soon = r.calendar.filter((c) => c.state === 'soon' || c.state === 'overdue').length;
    const tmc = r.tmc;
    $('#clientBadge').innerHTML = '<a href="#client">' + esc(TMV.clientLabel(tmc)) + '</a><span>TY' + esc(tmc.info.year) + ' · ' + esc(TM.statusLabel(tmc.info.status)) + '</span>';
    $('#nav').innerHTML = shellUI ? shellUI.renderNav({ view, counts: { findings: openCount, 'w-tie': r.tie.variances, calendar: soon } }) : NAV.map((g) => '<div class="nav-group"><h4>' + esc(g.group) + '</h4>' + (g.who ? '<div class="who">' + esc(g.who) + '</div>' : '') + '<div class="nav">' +
      g.items.map(([k, t]) => '<a href="#' + k + '" class="' + (k === view ? 'on' : '') + '"' + (k === view ? ' aria-current="page"' : '') + '><span>' + esc(t) + '</span>' + (k === 'findings' && openCount ? '<span class="count">' + openCount + '</span>' : k === 'w-tie' && r.tie.variances ? '<span class="count">' + r.tie.variances + '</span>' : k === 'calendar' && soon ? '<span class="count">' + soon + '</span>' : '') + '</a>').join('') + '</div></div>').join('');
    const [g, t] = TITLES[view] || ['', ''];
    $('#crumbs').innerHTML = esc(g) + ' › <b>' + esc(t) + '</b>';
    $('#modeSeg').hidden = VIEW_WS[view] !== 'compliance';
    document.documentElement.dataset.theme = state.settings.theme === 'system' ? '' : state.settings.theme;
    if (state.settings.theme === 'system') delete document.documentElement.dataset.theme;
    if (shellUI) shellUI.applyAppearance();
    document.querySelector('.app').dataset.view = view;
    $('#modeSeg').innerHTML = '<button data-action="mode" data-val="corrected" class="' + (state.settings.mode === 'corrected' ? 'on' : '') + '">Corrected</button><button data-action="mode" data-val="workbook" class="' + (state.settings.mode === 'workbook' ? 'on' : '') + '">As built</button>';
    const active = document.activeElement && document.activeElement.id;
    const main = $('#content');
    main.innerHTML = VIEWS[view]();
    const tools = $('#toolsRail');
    if (tools && shellUI) tools.innerHTML = shellUI.toolsMarkup();
    if (TMV.afterRender) TMV.afterRender();
    extensions.forEach((extension) => { if (extension.afterRender) extension.afterRender(); });
    if (shellUI) shellUI.afterRender();
    if (active) { const el = document.getElementById(active); if (el && main.contains(el)) { el.focus(); } }
    document.dispatchEvent(new CustomEvent('tmp:render'));
  }
  function go(view) { if (location.hash.slice(1) !== view) location.hash = view; else { state.view = view; render(); } }
  const ALIAS = { 'p-home': 'home', 'p-rivera': 'scen', sheets: 'connections', exchange: 'data', 'client-report': 'report' };
  window.addEventListener('hashchange', () => { let v = location.hash.slice(1); v = ALIAS[v] || v; if (VIEWS[v]) { state.view = v; state.ui.walkPanel = null; document.querySelector('.app').classList.remove('nav-open'); render(); window.scrollTo(0, 0); } });

  /* ---------------- events ---------------- */
  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast'); el.hidden = false; el.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button id="toastAct">' + esc(action.label) + '</button>' : '');
    if (action) $('#toastAct').onclick = () => { action.run(); el.hidden = true; };
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (shellUI && shellUI.onChange(el)) return;
    if (extensions.some((extension) => extension.onChange && extension.onChange(el))) return;
    if (TMV.onChange(el)) return;
    if (el.dataset.bind) {
      const type = el.dataset.type;
      let v = type === 'bool' ? el.checked : type === 'boolsel' ? el.value === 'true' : type === 'numsel' ? +el.value : parseVal(type, el.value);
      if (v === null) { toast('Enter a number, for example 12500 or (1,200).'); el.focus(); return; }
      const path = el.dataset.bind;
      if (path.startsWith('settings.apiKey')) { state.settings.apiKey = v; save(); return; }
      applyChange(path, v, 'you');
      render();
    } else if (el.dataset.ret) {
      const raw = el.value.trim();
      const v = raw === '' ? null : parseVal('num', raw);
      if (raw !== '' && v === null) { toast('Enter a number for the software amount.'); return; }
      setReturnAmount(el.dataset.ret, v, 'you');
      render();
    } else if (el.dataset.filter) { state.ui.filter[el.dataset.filter] = el.value; render(); }
    else if (el.dataset.finding) {
      const fs = state.data.findingStatus || (state.data.findingStatus = {});
      const prev = (fs[el.dataset.finding] || {}).status || 'Open';
      fs[el.dataset.finding] = Object.assign(fs[el.dataset.finding] || {}, { status: el.value });
      state.audit.push({ ts: new Date().toISOString(), by: 'you', path: 'findingStatus.' + el.dataset.finding + '.status', from: prev, to: el.value, note: 'Finding status' });
      save(); invalidate(); render();
    } else if (el.id === 'imp' && el.files && el.files[0]) {
      // Older deep-linked controls use the same validated preview as Data & sync.
      dataUI.receiveFile(el.files[0]);
    }
  });
  let qTimer;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (shellUI && shellUI.onInput && shellUI.onInput(el)) return;
    if (extensions.some((extension) => extension.onInput && extension.onInput(el))) return;
    if (TMV.onInput(el)) return;
    if (el.dataset.filterText) { clearTimeout(qTimer); qTimer = setTimeout(() => { state.ui.filter[el.dataset.filterText] = el.value; render(); }, 250); }
  });
  document.addEventListener('keydown', (e) => {
    if (shellUI && shellUI.onKeydown && shellUI.onKeydown(e)) return;
    if (TMV.onKeydown && TMV.onKeydown(e)) return;
    if (e.key === 'Enter' && e.target.matches('input.cell')) { e.target.blur(); }
    if (e.key === 'Enter' && e.target.matches('tr[data-toggle]')) e.target.click();
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action],[data-tab],[data-toggle],[data-undo],[data-copy],[data-ask],[data-checkfilter],[data-open]');
    if (!t) return;
    if (t.dataset.tab) { state.tab[t.dataset.tab] = t.dataset.val; render(); return; }
    if (t.dataset.toggle) { if (e.target.closest('input,select,a,button')) return; state.ui.open[t.dataset.toggle] = !state.ui.open[t.dataset.toggle]; render(); return; }
    if (t.dataset.undo) { undo(+t.dataset.undo); return; }
    if (t.dataset.open) { state.ui.open['s' + t.dataset.open] = true; state.ui.filter.hsort = 'no'; return; }
    if (t.dataset.checkfilter) { state.ui.filter.cno = t.dataset.checkfilter; return; }
    if (t.dataset.copy) { copyText(t.dataset.copy); return; }
    if (t.dataset.ask) { window.Advisor && window.Advisor.ask(t.dataset.ask); return; }
    const a = t.dataset.action;
    if (shellUI && shellUI.action(a, t)) return;
    if (extensions.some((extension) => extension.action && extension.action(a, t))) return;
    if (a === 'recalculate') { recalculate(); return; }
    if (a === 'use-openai') { applyChange('settings.advisorBackend', 'openai', 'you', 'Selected OpenAI server connection'); render(); return; }
    if (a === 'mode') { applyChange('settings.mode', t.dataset.val, 'you'); render(); }
    else if (TMV.action(a, t)) { /* handled by the client views */ }
    else if (a === 'add-scen-old') { const sc = state.data.w1040.planning.scenarios; if (sc.length < 5) { sc.push({ name: 'Scenario ' + (sc.length + 1), levers: {} }); state.audit.push({ ts: new Date().toISOString(), by: 'you', path: 'w1040.planning.scenarios', from: sc.length - 1, to: sc.length, note: 'Added scenario', noUndo: true }); save(); invalidate(); render(); } }
    else if (a === 'del-scen-old') { const sc = state.data.w1040.planning.scenarios; const i = +t.dataset.val; if (sc.length > 1 && i > 0) { const gone = sc.splice(i, 1)[0]; state.audit.push({ ts: new Date().toISOString(), by: 'you', path: 'w1040.planning.scenarios', from: gone.name, to: null, note: 'Removed scenario', noUndo: true }); save(); invalidate(); render(); } }
    else if (a === 'menu') document.querySelector('.app').classList.toggle('nav-open');
    else if (a === 'advisor') window.Advisor && window.Advisor.toggle();
    else if (a === 'add-oi') { state.data.w1040.openItems.push({ area: '', entity: '', issue: 'New item', amount: 0, priority: 'Medium', owner: '', status: 'Open', resolution: '' }); save(); invalidate(); render(); }
    else if (a === 'sel-top') { const r = compute().hn; const top = [...r.rows].sort((x, y) => x.rank - y.rank).slice(0, 10).map((x) => x.no); state.data.hnwi.strategies.forEach((s, i) => applyChange('hnwi.strategies.' + i + '.selected', top.includes(s.no), 'you', 'Select top 10')); render(); }
    else if (a === 'sel-none') { state.data.hnwi.strategies.forEach((s, i) => { if (s.selected) applyChange('hnwi.strategies.' + i + '.selected', false, 'you', 'Clear selection'); }); render(); }
    else if (a === 'export') dataUI.action('data-json', t);
    else if (a === 'csv-tie') {
      const t2 = compute().tie.rows; const lines = [['Schedule', 'Line', 'Description', 'Workpaper', 'Return/software', 'Variance', 'Status']];
      Object.entries(t2).forEach(([k, rows]) => rows.forEach((r) => lines.push([k, r.line, r.desc, r.value.toFixed(2), n(r.ret).toFixed(2), r.variance.toFixed(2), r.ok ? 'OK' : 'Variance'])));
      saveFile('rivera-1040-tie-out-' + state.settings.mode + '.csv', lines.map((l) => l.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n'));
    }
    else if (a === 'reset') { state.ui.confirmReset = true; render(); }
    else if (a === 'reset-no') { state.ui.confirmReset = false; render(); }
    else if (a === 'reset-yes') { state.data = freshData(); state.audit = []; state.ui.confirmReset = false; save(); invalidate(); render(); toast('Reset to the original workbook data.'); }
  });
  // chart tooltip
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]'); const tip = $('#tip');
    if (!t) { tip.hidden = true; return; }
    const parts = t.dataset.tip.split('|'); tip.innerHTML = '<b>' + esc(parts[0]) + '</b>' + parts.slice(1).map(esc).join('<br>'); tip.hidden = false;
  });
  document.addEventListener('mousemove', (e) => { const tip = $('#tip'); if (!tip.hidden) { tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 290) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; } });

  async function saveFile(name, text) {
    try {
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) { await dl.save({ filename: name, data: text }); toast('Saved ' + name + '.'); return; }
    } catch (err) { if (err && err.code === 'declined') return; if (err && err.code && err.code !== 'unavailable') { toast('Could not save the file (' + err.code + ').'); return; } }
    const url = URL.createObjectURL(new Blob([text], { type: name.endsWith('.csv') ? 'text/csv' : 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function copyText(text) {
    try { navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard.'), () => toast('Copy was blocked; select the text and copy it instead.')); } catch (e) { toast('Copy was blocked; select the text and copy it instead.'); }
  }

  /* ---------------- API for the advisor ---------------- */
  window.TMP = {
    state, compute, render, go, VIEW_WS, applyChange, toast, getPath, esc, money, VIEWS, TITLES, recalculate,
    summary() {
      const r = compute(); const r0 = r; const c = r.cur; const rc = r.rent.cur; const hn = r.hn; const s = state.settings; const pl = state.data.w1040.planning;
      const top = hn.dashboard.top.slice(0, 8).map((no) => { const st = state.data.hnwi.strategies.find((x) => x.no === no); return '#' + no + ' ' + st.title + ' ' + money(hn.byNo[no].benefit) + ' (' + st.risk + ')'; });
      const tmc = r0.tmc; const tw = r0.tmw;
      const tmLine = 'ACTIVE TAX MASTER CLIENT: ' + TMV.clientLabel(tmc) + ' (' + TM.statusLabel(tmc.info.status) + ', TY' + tmc.info.year + '). Columns: ' + tw.cols.map((x) => x.col.name + ' [TY' + x.col.year + ']: AGI ' + money(x.r.agi) + ', taxable ' + money(x.r.f.l15) + ', total tax ' + money(x.r.f.l24) + (x.r.amt.amt ? ' incl. AMT ' + money(x.r.amt.amt) : '') + ', ' + (x.r.net >= 0 ? 'refund ' : 'owed ') + money(Math.abs(x.r.net))).join('; ') + '. Diagnostics: ' + tw.cols[0].r.diag.map((d) => d.line + ' ' + d.text).join(' | ');
      const trainingView = /^(w-|h-)/.test(state.view) || ['c-home', 'findings', 'calendar', 'r-props', 'r-199a', 'r-statements', 'r-469'].includes(state.view);
      if (!trainingView) return [
        'ACTIVE CLIENT WORKSPACE. Answer from this client and the current source modules, return and planning columns. Separate workbook examples are not this client’s data.',
        'Current page: ' + state.view + '. Workspace: ' + state.settings.workspace + '.', tmLine,
        'Prior-year entered facts: tax ' + (tmc.info.priorTax == null ? 'not entered' : money(tmc.info.priorTax)) + '; AGI ' + (tmc.info.priorAgi == null ? 'not entered' : money(tmc.info.priorAgi)) + '.',
        'Client notes: ' + (tmc.info.notes || '') + '. Use get_client_return for source, election, adjustment and planning details. Compliance and reports use the same active base return.'
      ].join('\n');
      return [
        tmLine,
        'Today: ' + new Date().toISOString().slice(0, 10) + '. Workspace: ' + s.workspace + '. Current view: ' + (TITLES[state.view] || []).join(' > ') + '. Compliance logic mode: ' + s.mode + ' (planning always uses corrected logic).',
        'RIVERA household (Jordan & Casey, MFJ, training data). Compliance: TY2025 Form 1040 on extension to 2026-10-15. AGI ' + money(c.f.l11b) + ', deduction ' + money(c.f.l12e) + ' (' + c.a.method + '), QBI ded ' + money(c.f.l13a) + ', taxable income ' + money(c.f.l15) + ', line 16 tax ' + money(c.f.l16) + ' (' + c.tax.source + '; engine ' + money(c.tax.engine) + '), SE tax ' + money(c.se.j) + ', total tax ' + money(c.f.l24) + ', payments ' + money(c.f.l33) + ', ' + (c.net >= 0 ? 'refund ' : 'owed ') + money(Math.abs(c.net)) + '. As built net ' + money(r.w.asBuilt.net) + ', corrected net ' + money(r.w.corrected.net) + '. Tie-out variances: ' + r.tie.variances + '.',
        'Rivera planning (' + pl.year + (pl.year === 2026 ? ' projection, growth ' + pct(pl.growth, 1) : ' what-if') + '): ' + r.scen.map((x) => x.name + ' total tax ' + money(x.v.f.l24)).join('; ') + '. 2026 safe harbor: required ' + money(r.safeHarbor.required) + ', from estimates ' + money(r.safeHarbor.fromEst) + ', quarterly ' + money(r.safeHarbor.quarter) + ', still to pay ' + money(r.safeHarbor.remaining) + '.',
        'DOE household. Rental HoldCo (John 60% / Jane 40%, JD Rental Holdings LLC, TY2026): net rental/QBI ' + money(rc.tot.qbi) + ', wages ' + money(rc.tot.wages) + ', UBIA ' + money(rc.tot.ubia) + ', TI before QBI ' + money(rc.TI) + '; REP tests ' + (rc.rep.pass ? 'pass' : 'fail') + '; aggregation ' + (rc.agg.pass ? 'pass' : 'fail') + '; §199A deduction ' + money(rc.summary.ded) + ' (as built ' + money(r.rent.asBuilt.summary.ded) + '); election value ' + money(r.rent.corrected.election.value) + '.',
        'Doe wealth plan (John Doe, 2026): 50 strategies, sum of benefits ' + moneyM(hn.dashboard.total) + ' (not additive), selected ' + hn.selected.count + ' with net ' + moneyM(hn.selected.net) + ', horizon ' + state.data.hnwi.horizon + ' yrs. Top: ' + top.join('; ') + '.',
        'Filing calendar: ' + r.calendar.filter((x) => x.state !== 'done').slice(0, 8).map((x) => x.client + ' ' + x.form + ' due ' + (x.due || x.event) + ' [' + x.status + ']').join('; ') + '.',
        'Open findings: ' + r.findings.filter((f) => f.status === 'Open').map((f) => f.id + ' [' + f.severity + '] ' + f.title + (f.impact ? ' (' + money(f.impact) + ')' : '')).join('; '),
      ].join('\n');
    },
  };

  /* ---------------- boot ---------------- */
  const TMV = window.TMViews({ state, esc, money, moneyM, pct, fmtNum, cellNum, chip, inputNum, inputText, selectBind, head, tabs, tile, kv, getPath, parseVal, compute, save, invalidate, render: () => render(), go, applyChange, toast, undo, label });
  Object.assign(VIEWS, TMV.VIEWS);
  delete VIEWS['p-home']; delete VIEWS['p-rivera'];
  NAV = [...TMV.NAV, LIB];
  NAV.forEach((g) => g.items.forEach(([k, t]) => { TITLES[k] = [g.group, t]; }));
  window.TMP.TMV = TMV;
  const sharedAPI = { state, esc, money, moneyM, pct, fmtNum, cellNum, chip, inputNum, inputText, selectBind, head, tabs, tile, kv,
    getPath, parseVal, compute, save, invalidate, render, go, applyChange, toast, undo, label, recalculate,
    active: () => TMV.active(), client: () => TMV.active(), clientPath: (suffix) => 'tm.clients.' + state.data.tm.clients.indexOf(TMV.active()) + '.' + suffix,
    walk: () => compute().tmw, walkRows: TMV.walkRows, rowVal: TMV.rowVal };
  dataUI = window.TMDataUI && window.TMDataUI(sharedAPI);
  if (dataUI) extensions.push(dataUI);
  if (window.TMClientHub) extensions.push(window.TMClientHub(sharedAPI));
  if (window.TMReview) extensions.push(window.TMReview(sharedAPI));
  if (window.TMLibrary) extensions.push(window.TMLibrary(sharedAPI));
  if (window.TMSheets) extensions.push(window.TMSheets(Object.assign({}, sharedAPI, { applyImportedState: (imported, options) => dataUI.applyImportedState(imported, options) })));
  extensions.forEach((extension) => Object.assign(VIEWS, extension.VIEWS || {}));
  shellUI = window.TMShell && window.TMShell(Object.assign({}, sharedAPI, { saveCalculatorNote: (text) => {
    const client = TMV.active(); applyChange(sharedAPI.clientPath('notes._calculator'), ((client.notes || {})._calculator ? client.notes._calculator + '\n' : '') + text, 'you', 'Toolbox calculation tape');
  } }));
  window.TMP.extensions = extensions;
  window.TMP.shell = shellUI;
  if (shellUI && shellUI.routes) shellUI.routes().forEach((route) => { TITLES[route.key] = [route.group, route.label]; });
  const v0 = ALIAS[location.hash.slice(1)] || location.hash.slice(1); state.view = VIEWS[v0] ? v0 : wsHome();
  render();
})();
