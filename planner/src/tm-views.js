/* Tax Master — client views: summary dashboard, client info, the Form 1040
   walk with planning columns, and the income and deduction modules.
   app.js calls window.TMViews(api) and merges the returned views. */
(function () {
  'use strict';
  window.TMViews = function (api) {
    const { state, esc, money, moneyM, pct, fmtNum, cellNum, chip, inputNum, inputText, selectBind, head, tabs, tile, kv, getPath } = api;
    const TM = window.TM; const n = TM.n;
    const V = {};
    const MAX_COLS = 6; // base + 5 planning columns

    /* ---------------- client helpers ---------------- */
    const tmData = () => state.data.tm;
    const ci = () => { const t = tmData(); const i = t.clients.findIndex((c) => c.id === t.active); return i < 0 ? 0 : i; };
    const C = () => tmData().clients[ci()];
    const cp = (rel) => 'tm.clients.' + ci() + '.' + rel;
    const walk = () => api.compute().tmw;
    const clientLabel = (c) => c.info.name || [c.info.tpFirst, c.info.tpLast].filter(Boolean).join(' ') || 'Client';
    const yearOpts = [['2025', 'TY2025'], ['2026', 'TY2026']];
    const num = (path, v, o) => inputNum(path, v, o);
    const optNum = (path, v, o) => '<input class="cell' + (o && o.cls ? ' ' + o.cls : '') + '" id="in-' + esc(path) + '" inputmode="decimal" data-bind="' + esc(path) + '" data-type="numopt" value="' + esc(v == null ? '' : v) + '"' + (o && o.ph != null ? ' placeholder="' + esc(o.ph) + '"' : '') + (o && o.source != null ? ' data-total-source="' + esc(o.source) + '"' : '') + ' aria-label="' + esc((o && o.label) || path) + '"' + (o && o.title ? ' title="' + esc(o.title) + '"' : '') + '>';
    const dateIn = (path, v, label) => '<input class="cell txt" type="date" id="in-' + esc(path) + '" data-bind="' + esc(path) + '" data-type="text" value="' + esc(v || '') + '" aria-label="' + esc(label || path) + '">';
    const check = (path, v, label) => '<input type="checkbox" id="in-' + esc(path) + '" data-bind="' + esc(path) + '" data-type="bool"' + (v ? ' checked' : '') + ' aria-label="' + esc(label || path) + '">';
    const sevChip = (s) => (s === 'err' ? chip('bad', 'Error') : s === 'warn' ? chip('warn', 'Check') : chip('info', 'Note'));
    const checksList = (list) => (list && list.length ? '<div class="checks">' + list.map((c) => '<div class="check-row">' + sevChip(c.sev) + '<span>' + esc(c.text) + '</span>' + (c.cite ? '<span class="muted small">' + esc(c.cite) + '</span>' : '') + '</div>').join('') + '</div>' : '<p class="muted small">No issues found.</p>');

    /* Editable grid over an array in client data.
       cols: [{k, l, t:'num'|'text'|'date'|'bool'|'sel', o:[...], w}], calc: [{l, f(row, i), num}] */
    function grid(rel, rows, cols, opt) {
      opt = opt || {};
      const path = cp(rel);
      let h = '<div class="tablewrap"><table class="t grid"><thead><tr>' + cols.map((c) => '<th' + (c.t === 'num' ? ' class="n"' : '') + (c.w ? ' style="min-width:' + c.w + 'px"' : '') + '>' + esc(c.l) + '</th>').join('') +
        (opt.calc || []).map((c) => '<th class="n">' + esc(c.l) + '</th>').join('') + '<th></th></tr></thead><tbody>';
      if (!rows.length) h += '<tr><td colspan="' + (cols.length + (opt.calc || []).length + 1) + '" class="muted small">No rows yet.</td></tr>';
      rows.forEach((r, i) => {
        h += '<tr' + (opt.sel != null && opt.sel === i ? ' class="selrow"' : '') + '>' + cols.map((c) => {
          const p = path + '.' + i + '.' + c.k; const v = getPath(r, c.k);
          if (c.t === 'num') return '<td class="n">' + num(p, v == null ? '' : v, { label: c.l }) + '</td>';
          if (c.t === 'date') return '<td>' + dateIn(p, v, c.l) + '</td>';
          if (c.t === 'bool') return '<td style="text-align:center">' + check(p, v, c.l) + '</td>';
          if (c.t === 'sel') return '<td>' + selectBind(p, v == null ? '' : v, c.o, { label: c.l }) + '</td>';
          return '<td>' + inputText(p, v == null ? '' : v, { label: c.l }) + '</td>';
        }).join('') + (opt.calc || []).map((c) => { const v = c.f(r, i); return c.num === false ? '<td class="small">' + esc(v) + '</td>' : cellNum(v); }).join('') +
          '<td style="white-space:nowrap">' + (opt.open ? '<button class="btn small ghost" data-action="sel-row" data-key="' + esc(opt.open) + '" data-val="' + i + '">' + (opt.sel === i ? 'Close' : 'Detail') + '</button>' : '') + '<button class="btn small ghost" data-action="del-row" data-path="' + esc(path) + '" data-val="' + i + '" aria-label="Remove row" title="Remove row">×</button></td></tr>';
      });
      if (opt.totals) h += '<tr class="total"><td colspan="' + cols.length + '">Total</td>' + opt.totals.map((v) => (v == null ? '<td></td>' : cellNum(v))).join('') + '<td></td></tr>';
      h += '</tbody></table></div><p style="margin:8px 0 0"><button class="btn small" data-action="add-row" data-path="' + esc(path) + '" data-tpl="' + esc(JSON.stringify(opt.tpl || {})) + '">' + esc(opt.add || 'Add row') + '</button></p>';
      return h;
    }
    // "Feeds the 1040" strip at the top of a module
    function feedStrip(items) {
      const w = walk(); const x = w.baseX; const ov = C().direct || {}; const adjustments = C().adjustments || {};
      return '<div class="feeds">' + items.map(([leaf, line]) => {
        const manual = ov[leaf] != null, adjusted = adjustments[leaf] != null;
        const election = w.cols[0].planning[{ sepIra: 'retirement', hsa: 'hsa', iraDed: 'ira' }[leaf]];
        const badge = manual ? 'manual total' : adjusted ? 'adjusted' : election && election.configured ? 'planned' : '';
        const hint = manual ? 'Saved manual total on the 1040 walk.' : adjusted ? 'Includes a source adjustment of ' + money(adjustments[leaf]) + '.' : election && election.configured ? 'Includes the selected planning election.' : 'Calculated from the supporting module.';
        const value = leaf === 'qbiDed' ? w.cols[0].r.f.l13a : x[leaf];
        return '<a class="feed' + (badge ? ' typed' : '') + '" href="#walk" title="' + esc(hint) + '"><span class="ln">' + esc(line) + '</span><span class="lb">' + esc(TM.LEAF[leaf].label) + '</span><b>' + fmtNum(value) + '</b>' + (badge ? '<span class="chip info">' + badge + '</span>' : '') + '</a>';
      }).join('') + '</div>';
    }
    function modHead(title, lede, right) {
      const c = C();
      return head('Modules · ' + clientLabel(c) + ' · TY' + c.info.year, title, lede, (right || '') + ' <a class="btn" href="#walk">Open 1040 walk</a>');
    }

    /* ================= SUMMARY DASHBOARD ================= */
    function incomeChart(r) {
      return window.TMDashboardCharts(r, { esc, money, pct });
    }
    const QDATES = (y) => [[y + '-04-15', 'Q1'], [y + '-06-15', 'Q2'], [y + '-09-15', 'Q3'], [(y + 1) + '-01-15', 'Q4']];
    // Estimated payments. A TY2025 base plans TY2026 from a projection; a TY2026 base (the
    // latest year with parameters) is tested against the prior-year safe harbor instead.
    function nextYearPlan(c, base) {
      if (base.year >= 2026) {
        const sh = TM.safeHarbor(c.info.priorTax, c.info.priorAgi, base.f.l24, base.f.l25d, base.x.estimates, c.info.status);
        return { ny: base.year, proj: base, sh, current: true, paid: n(base.x.estimates) };
      }
      const ny = base.year + 1;
      const ctx = Object.assign({}, TM.clientCtx(c, ny, c.info.status), { qbiItems: walk().feeds.items });
      const proj = TM.computeReturn(TM.project(walk().baseX, (c.scen || {}).growth || 0.03), ctx);
      const sh = TM.safeHarbor(base.f.l24, base.agi, proj.f.l24, proj.f.l25d, 0, c.info.status);
      return { ny, proj, sh, current: false, paid: 0 };
    }
    const planNote = (c, plan) => 'Safe harbor: ' + (plan.sh.basis === 'prior' ? Math.round(plan.sh.pct * 100) + '% of ' + (plan.current ? 'prior-year' : 'this year\'s') + ' tax' : '90% of ' + (plan.current ? '' : 'projected ') + 'TY' + plan.ny + ' tax') +
      (plan.current ? ' (prior-year tax from Client info)' : '. Projection grows income ' + pct((c.scen || {}).growth || 0.03, 1)) + '.';
    const planKv = (plan) => kv('Required annual payment', money(plan.sh.required)) + kv((plan.current ? '' : 'Projected ') + 'withholding', money(plan.proj.f.l25d)) + kv('Needed from estimates', money(plan.sh.fromEst)) +
      (plan.current ? kv('Estimates paid so far', money(plan.paid)) + kv('Still to pay', money(plan.sh.remaining)) : '');
    V.home = () => {
      const c = C(); const w = walk(); const base = w.cols[0].r; const cols = w.cols;
      const best = cols.slice(1).reduce((b, x) => (!b || x.r.f.l24 < b.r.f.l24 ? x : b), null);
      const saving = best ? base.f.l24 - best.r.f.l24 : 0;
      const allChecks = moduleChecks(w);
      const errs = base.diag.filter((d) => d.sev === 'err').length + allChecks.filter((d) => d.sev === 'err').length;
      const warns = base.diag.filter((d) => d.sev === 'warn').length + allChecks.filter((d) => d.sev === 'warn').length;
      const plan = nextYearPlan(c, base);
      let h = '<div class="cmd">';
      h += '<div class="cmd-head"><div><div class="eyebrow">Tax Master · Summary dashboard</div><h1>' + esc(clientLabel(c)) + '</h1><p>' + esc(TM.statusLabel(c.info.status)) + ' · TY' + c.info.year + ' · ' + esc(c.info.state || '') + ' · ' + (cols.length - 1) + ' planning column' + (cols.length === 2 ? '' : 's') + '</p></div>' +
        '<div class="cmd-actions"><label class="small">Client ' + clientPicker() + '</label><a class="btn" href="#client">Client info</a><a class="btn primary" href="#walk">Form 1040 walk</a></div></div>';
      const k = (lab, val, sub, cls) => '<div class="kpi' + (cls ? ' ' + cls : '') + '"><div class="k">' + esc(lab) + '</div><div class="v">' + esc(val) + '</div><div class="d">' + esc(sub || '') + '</div></div>';
      h += '<div class="kpis">' + k('Total federal tax', money(base.f.l24), 'line 24 · ' + w.cols[0].col.name) + k('Effective rate', pct(base.effective, 1), 'of AGI · marginal ' + pct(base.marginal, 1)) + k('Adjusted gross income', moneyM(base.agi), 'taxable ' + moneyM(base.f.l15)) +
        k(base.net >= 0 ? 'Projected refund' : 'Projected balance due', money(Math.abs(base.net)), 'payments ' + money(base.f.l33), base.net < 0 ? 'neg' : 'pos') +
        k('Best planning column', saving > 0 ? money(saving) : '—', best ? best.col.name : 'add a column on the walk', saving > 0 ? 'pos' : '') + k('Review items', errs + ' / ' + warns, 'errors / checks in diagnostics and modules', errs ? 'neg' : '') + '</div>';
      h += '<div class="cmd-grid">';
      h += '<section class="cpanel span2"><header><h2>Income composition & federal tax</h2><span class="muted small">' + esc(w.cols[0].col.name) + '</span></header>' + incomeChart(base) + '</section>';
      // Scenario comparison
      const maxT = Math.max(...cols.map((x) => x.r.f.l24), 1);
      h += '<section class="cpanel"><header><h2>Planning columns</h2><a class="small" href="#walk">Edit</a></header><div class="cbars">' + cols.map((x, i) => '<div class="cbar"><div class="lbl">' + (i === 0 ? 'Base · ' : 'P' + i + ' · ') + esc(x.col.name) + '<span class="muted"> · TY' + x.col.year + '</span></div><div class="track"><div class="fill' + (i === 0 ? ' base' : '') + '" style="width:' + (100 * x.r.f.l24 / maxT).toFixed(1) + '%"></div></div><div class="val">' + moneyM(x.r.f.l24) + (i ? '<span class="' + (x.r.f.l24 <= base.f.l24 ? 'pos' : 'neg') + '"> ' + (x.r.f.l24 <= base.f.l24 ? '−' : '+') + moneyM(Math.abs(x.r.f.l24 - base.f.l24)).replace('−', '') + '</span>' : '') + '</div></div>').join('') + '</div>' +
        '<div style="overflow-x:auto"><table class="ctable"><thead><tr><th></th>' + cols.map((x, i) => '<th title="' + esc(x.col.name) + '">' + (i === 0 ? 'Base' : 'P' + i) + '</th>').join('') + '</tr></thead><tbody>' +
        [['AGI', (r) => r.agi], ['Taxable income', (r) => r.f.l15], ['Regular tax', (r) => r.f.l16], ['AMT', (r) => r.amt.amt], ['NIIT', (r) => r.s2.l12], ['Total tax', (r) => r.f.l24]].map(([t, fn]) => '<tr><td>' + t + '</td>' + cols.map((x) => '<td>' + moneyM(fn(x.r)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></section>';
      // Forecast: next-year estimates
      h += '<section class="cpanel"><header><h2>TY' + plan.ny + ' estimated payments</h2><a class="small" href="#scen">Scenarios</a></header><p class="small muted" style="margin:0 0 8px">' + esc(planNote(c, plan)) + '</p><dl class="kv">' + planKv(plan) + '</dl><table class="ctable" style="margin-top:10px"><tbody>' +
        QDATES(plan.ny).map(([d, q]) => '<tr><td>' + q + '</td><td>' + new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '</td><td>' + money(plan.sh.quarter) + '</td></tr>').join('') + '</tbody></table></section>';
      // Modules
      const det = w.feeds.detail;
      const mods = [['m-portfolio', 'Portfolio income', base.f.l2b + base.f.l3b, det.pf.checks], ['m-schc', 'Schedule C', base.s1.l3, det.sc.checks], ['m-capital', 'Capital transactions', base.f.l7 + base.s1.l4, det.cap.checks.concat(det.eq.checks)],
        ['m-rents', 'Rents & royalty', sum(det.rents.rows, (r) => r.net), det.rents.checks], ['m-k1', 'Passthrough (K-1)', sum(det.k1.rows, (r) => r.ordAllowed), det.k1.checks], ['m-qbi', 'QBI deduction', base.f.l13a, []], ['m-itemized', 'Itemized deductions', base.a.l17, []]];
      h += '<section class="cpanel"><header><h2>Modules</h2><span class="muted small">feeding the 1040</span></header><table class="ctable"><tbody>' + mods.map(([v, t, amt, ch]) => { const e = ch.filter((x) => x.sev === 'err').length, wn = ch.filter((x) => x.sev === 'warn').length; return '<tr><td><a href="#' + v + '">' + t + '</a></td><td>' + moneyM(amt) + '</td><td>' + (e ? '<span class="neg">' + e + ' err</span> ' : '') + (wn ? '<span class="warnc">' + wn + ' chk</span>' : (e ? '' : '<span class="pos">OK</span>')) + '</td></tr>'; }).join('') + '</tbody></table></section>';
      // Diagnostics
      h += '<section class="cpanel"><header><h2>Diagnostics</h2><a class="small" href="#walk">1040 walk</a></header>' + (base.diag.length ? '<ul class="dlist">' + base.diag.slice(0, 7).map((d) => '<li class="' + d.sev + '"><b>' + esc(d.line) + '</b> ' + esc(d.text) + '</li>').join('') + '</ul>' : '<p class="muted small">None.</p>') + '</section>';
      // Deadlines
      const last = String(c.info.tpLast || '').toLowerCase();
      const cal = (api.compute().calendar || []).filter((x) => x.state !== 'done' && String(x.client).toLowerCase().includes(last)).slice(0, 5);
      h += '<section class="cpanel"><header><h2>Upcoming filings</h2><a class="small" href="#calendar">Calendar</a></header>' + (cal.length ? '<table class="ctable"><tbody>' + cal.map((x) => '<tr><td>' + esc(x.due || x.event || '') + '</td><td>' + esc(x.form) + '</td><td class="muted">' + esc(x.status) + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted small">No filings on the calendar for this client.</p>') + '</section>';
      h += '</div></div>';
      return h;
    };
    const sum = TM.sum;
    function moduleChecks(w) { const d = w.feeds.detail; return [].concat(d.pf.checks, d.sc.checks, d.cap.checks, d.eq.checks, d.k1.checks, d.rents.checks); }
    function clientPicker() {
      const t = tmData();
      return '<select class="cell" id="clientPick" data-client-pick="1" aria-label="Active client">' + t.clients.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === t.active ? ' selected' : '') + '>' + esc(clientLabel(c)) + ' · TY' + c.info.year + '</option>').join('') + '</select>';
    }

    /* ================= CLIENT INFO ================= */
    V.client = () => {
      const c = C(); const i = c.info; const P = (k) => cp('info.' + k);
      const married = i.status === 'mfj' || i.status === 'qss' || i.status === 'mfs';
      const ctx = TM.clientCtx(c);
      let h = head('Overview', 'Client info', 'Who the return is for, the filing facts that drive every column, and the income that does not belong to a module. Each client keeps its own modules, 1040 walk and planning columns.',
        '<span style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' + clientPicker() + '<button class="btn small" data-action="new-client">New client</button><button class="btn small" data-action="dup-client">Duplicate</button>' + (tmData().clients.length > 1 ? '<button class="btn small ghost" data-action="del-client">Delete</button>' : '') + '</span>');
      if (state.ui.confirmDelClient) h += '<div class="banner warn"><span>Delete ' + esc(clientLabel(c)) + ' and all of its modules and columns? This cannot be undone.</span><button class="btn small" data-action="del-client-yes">Delete client</button><button class="btn small ghost" data-action="del-client-no">Cancel</button></div>';
      h += '<div class="panel pad"><h3 style="margin-top:0">Return</h3><div class="form">' +
        '<label class="field">Client name' + inputText(P('name'), i.name) + '</label>' +
        '<label class="field">Tax year' + selectBind(P('year'), String(i.year), yearOpts, { num: true }) + '<span class="hint">2026 figures from Rev. Proc. 2025-32; confirm before advising</span></label>' +
        '<label class="field">Filing status' + selectBind(P('status'), i.status, TM.STATUSES) + '</label>' +
        '<label class="field">State of residence' + inputText(P('state'), i.state) + '</label>' +
        '<label class="field">Base column name' + inputText(P('baseName'), i.baseName || 'Base') + '</label>' +
        '<label class="field">Occupation' + inputText(P('occupation'), i.occupation) + '</label></div>';
      h += '<h3>Taxpayer' + (married ? ' and spouse' : '') + '</h3><div class="form">' +
        '<label class="field">Taxpayer first name' + inputText(P('tpFirst'), i.tpFirst) + '</label><label class="field">Last name' + inputText(P('tpLast'), i.tpLast) + '</label>' +
        '<label class="field">Date of birth' + dateIn(P('tpDob'), i.tpDob, 'Taxpayer date of birth') + '<span class="hint">Age at year end: ' + (ctx.tpAge == null ? '—' : ctx.tpAge) + '</span></label>' +
        '<label class="field" style="flex-direction:row;gap:8px;align-items:center">' + check(P('tpBlind'), i.tpBlind, 'Taxpayer blind') + ' Taxpayer is blind</label>' +
        (married ? '<label class="field">Spouse first name' + inputText(P('spFirst'), i.spFirst) + '</label><label class="field">Last name' + inputText(P('spLast'), i.spLast) + '</label>' +
          '<label class="field">Date of birth' + dateIn(P('spDob'), i.spDob, 'Spouse date of birth') + '<span class="hint">Age at year end: ' + (ctx.spAge == null ? '—' : ctx.spAge) + '</span></label>' +
          '<label class="field" style="flex-direction:row;gap:8px;align-items:center">' + check(P('spBlind'), i.spBlind, 'Spouse blind') + ' Spouse is blind</label>' : '') +
        '<label class="field">Address' + inputText(P('address'), i.address) + '</label></div>';
      h += '<p class="small muted" style="margin:10px 0 0">' + ctx.seniors + ' taxpayer(s) 65 or older' + (ctx.seniors ? ' — additional standard deduction and the Schedule 1-A senior deduction apply' : '') + '. ' + ctx.ctcKids + ' child tax credit child(ren), ' + ctx.odcDeps + ' other dependent(s).</p></div>';
      h += '<h2>Dependents</h2>' + grid('deps', c.deps || [], [{ k: 'name', l: 'Name', w: 160 }, { k: 'age', l: 'Age at year end', t: 'num' }, { k: 'rel', l: 'Relationship', t: 'sel', o: [['child', 'Qualifying child'], ['other', 'Other dependent']] }, { k: 'ssn', l: 'SSN valid for work', t: 'bool' }],
        { calc: [{ l: 'Credit', num: false, f: (d) => (n(d.age) < 17 && d.rel !== 'other' && d.ssn !== false ? 'Child tax credit' : 'Other dependent credit') }], add: 'Add dependent', tpl: { name: '', age: 0, rel: 'child', ssn: true } });
      h += '<h2>Wages (Form W-2)</h2>' + grid('w2', c.w2 || [], [{ k: 'who', l: 'Employee', w: 90 }, { k: 'employer', l: 'Employer', w: 170 }, { k: 'wages', l: 'Box 1 wages', t: 'num' }, { k: 'ssWages', l: 'Box 3 SS wages', t: 'num' }, { k: 'fedWh', l: 'Box 2 federal tax', t: 'num' }, { k: 'stateWh', l: 'State tax withheld', t: 'num' }],
        { totals: [], add: 'Add W-2', tpl: { who: i.tpFirst || 'Taxpayer', employer: '', wages: 0, ssWages: 0, fedWh: 0, stateWh: 0 } });
      const o = c.other || {}; const O = (k) => cp('other.' + k);
      const fields = [['iraDist', '4b'], ['pensions', '5b'], ['ssBenefits', '6a'], ['stateRefund', 'S1-1'], ['alimonyRec', 'S1-2a'], ['unemployment', 'S1-7'], ['otherIncome', 'S1-8'], ['otherEarned', '1b–1h'],
        ['educator', 'S1-11'], ['hsa', 'S1-13'], ['iraDed', 'S1-20'], ['studentLoan', 'S1-21'], ['alimonyPaid', 'S1-19a'], ['otherAdj', 'S1-24'],
        ['tips', '1-A'], ['overtime', '1-A'], ['carLoanInt', '1-A'], ['childCare', 'S3-2'], ['education', 'S3-3'], ['otherNonref', 'S3-6'], ['otherTax', 'S2-17'],
        ['whOther', '25b'], ['estimates', '26'], ['extension', 'S3-10'], ['otherPayments', 'S3-15']];
      h += '<h2>Other income, adjustments, credits and payments</h2><p class="lede small">Amounts that are not built from a module. They flow to the 1040 walk, where any line can also be typed over.</p><div class="panel pad"><div class="form">' +
        fields.map(([k, ln]) => '<label class="field"><span><b class="ln-tag">' + esc(ln) + '</b> ' + esc(TM.LEAF[k].label) + '</span>' + num(O(k), o[k] == null ? '' : o[k], { label: TM.LEAF[k].label }) + '</label>').join('') + '</div></div>';
      h += '<h2>Prior year and planning facts</h2><div class="panel pad"><div class="form">' +
        '<label class="field">Prior-year total tax' + num(P('priorTax'), i.priorTax) + '<span class="hint">Used for the current-year safe harbor (100% / 110% of prior-year tax)</span></label>' +
        '<label class="field">Prior-year AGI' + num(P('priorAgi'), i.priorAgi) + '</label>' +
        '<label class="field">Preparer' + inputText(P('preparer'), i.preparer) + '</label><label class="field">Reviewer' + inputText(P('reviewer'), i.reviewer) + '</label></div>' +
        '<label class="field" style="margin-top:12px">Notes<textarea data-bind="' + esc(P('notes')) + '" data-type="text" id="in-' + esc(P('notes')) + '">' + esc(i.notes || '') + '</textarea></label></div>';
      h += '<p class="small muted" style="margin-top:14px">Demo data only. Use fictional or de-identified information; do not enter real taxpayer data in a public deployment.</p>';
      return h;
    };

    /* ================= FORM 1040 WALK ================= */
    const L = (leaf) => (r) => n(r.x[leaf]);
    const WALK = [
      { s: 'Income' },
      { k: 'l1a', ln: '1a', d: 'Wages, salaries, tips (W-2 box 1)', a: '§61(a)(1)', leaf: 'wages', mod: 'client', sub: [{ k: 'ssw', ln: 'SE-8a', d: 'Social security wages of the self-employed spouse', a: '§1402(b)', leaf: 'ssWages', mod: 'client' }] },
      { k: 'l1h', ln: '1b–1h', d: 'Other earned income (equity comp not on a W-2, household wages, etc.)', a: '§§61, 83, 421(b)', leaf: 'otherEarned', mod: 'equity' },
      { k: 'l1z', ln: '1z', d: 'Total from lines 1a through 1h', v: (r) => r.f.l1z, tot: 1 },
      { k: 'l2a', ln: '2a', d: 'Tax-exempt interest', a: '§103', leaf: 'taxExemptInt', mod: 'portfolio' },
      { k: 'l2b', ln: '2b', d: 'Taxable interest (Schedule B part I)', a: '§61(a)(4)', leaf: 'taxableInt', mod: 'portfolio' },
      { k: 'l3a', ln: '3a', d: 'Qualified dividends', a: '§1(h)(11)', leaf: 'qualDiv', mod: 'portfolio' },
      { k: 'l3b', ln: '3b', d: 'Ordinary dividends (Schedule B part II)', a: '§61(a)(7)', leaf: 'ordDiv', mod: 'portfolio' },
      { k: 'l4b', ln: '4b', d: 'IRA distributions, taxable amount', a: '§408(d)', leaf: 'iraDist', mod: 'client' },
      { k: 'l5b', ln: '5b', d: 'Pensions and annuities, taxable amount', a: '§72', leaf: 'pensions', mod: 'client' },
      { k: 'l6a', ln: '6a', d: 'Social security benefits', a: '§86', leaf: 'ssBenefits', mod: 'client' },
      { k: 'l6b', ln: '6b', d: 'Taxable social security benefits', a: '§86(a)', v: (r) => r.f.l6b },
      { k: 'l7', ln: '7', d: 'Capital gain or (loss) — Schedule D', a: '§§1222, 1211(b)', v: (r) => r.f.l7, mod: 'capital', sub: [
        { k: 'd7', ln: 'D-7', d: 'Net short-term gain (loss): Form 8949 Part I, K-1s, equity sales', a: '§1222(5)', leaf: 'stGain', mod: 'capital' },
        { k: 'd6', ln: 'D-6', d: 'Short-term capital loss carryover', a: '§1212(b)', leaf: 'stCarry', mod: 'capital' },
        { k: 'd15', ln: 'D-15', d: 'Net long-term gain (loss): Part II, Form 4797 §1231, distributions, K-1s', a: '§§1222(7), 1231', leaf: 'ltGain', mod: 'capital' },
        { k: 'd14', ln: 'D-14', d: 'Long-term capital loss carryover', a: '§1212(b)', leaf: 'ltCarry', mod: 'capital' },
        { k: 'd16', ln: 'D-16', d: 'Net capital gain (loss)', v: (r) => r.d.l16 },
        { k: 'd18', ln: 'D-18', d: '28% rate gain (collectibles)', a: '§1(h)(4)', leaf: 'collect28', mod: 'capital' },
        { k: 'd19', ln: 'D-19', d: 'Unrecaptured §1250 gain', a: '§1(h)(6)', leaf: 'unrecap1250', mod: 'capital' },
        { k: 'd21', ln: 'D-21', d: 'Capital loss carried to next year', a: '§1212(b)', v: (r) => -r.d.carryforward },
      ] },
      { k: 'l8', ln: '8', d: 'Additional income — Schedule 1 line 10', a: '§61', v: (r) => r.f.l8, sub: [
        { k: 's11', ln: 'S1-1', d: 'Taxable refunds of state and local income taxes', a: '§111', leaf: 'stateRefund', mod: 'client' },
        { k: 's12', ln: 'S1-2a', d: 'Alimony received (pre-2019 instruments)', a: '§71 (repealed)', leaf: 'alimonyRec', mod: 'client' },
        { k: 's13', ln: 'S1-3', d: 'Business income (loss) — Schedule C', a: '§§61(a)(2), 162', leaf: 'schC', mod: 'schC' },
        { k: 's14', ln: 'S1-4', d: 'Other gains (losses) — Form 4797', a: '§§1245, 1250, 1231(a)', leaf: 'f4797ord', mod: 'capital' },
        { k: 's15', ln: 'S1-5', d: 'Rents, royalties, partnerships, S corporations, trusts — Schedule E', a: '§§469, 702, 1366', leaf: 'schE', mod: 'rents' },
        { k: 's16', ln: 'S1-6', d: 'Farm income (loss)', a: '§61(a)(2)', leaf: 'farm', mod: 'client' },
        { k: 's17', ln: 'S1-7', d: 'Unemployment compensation', a: '§85', leaf: 'unemployment', mod: 'client' },
        { k: 's18', ln: 'S1-8', d: 'Other income', a: '§61', leaf: 'otherIncome', mod: 'client' },
      ] },
      { k: 'l9', ln: '9', d: 'Total income', a: '§61(a)', v: (r) => r.f.l9, tot: 1 },
      { k: 'l10', ln: '10', d: 'Adjustments to income — Schedule 1 line 26', a: '§62(a)', v: (r) => r.f.l10, sub: [
        { k: 'a11', ln: 'S1-11', d: 'Educator expenses', a: '§62(a)(2)(D)', leaf: 'educator', mod: 'client' },
        { k: 'a13', ln: 'S1-13', d: 'Health savings account deduction', a: '§223', leaf: 'hsa', mod: 'client' },
        { k: 'a15', ln: 'S1-15', d: 'Deductible part of self-employment tax', a: '§164(f)', v: (r) => r.s1.l15 },
        { k: 'a16', ln: 'S1-16', d: 'SEP, SIMPLE and qualified plans', a: '§404', leaf: 'sepIra', mod: 'schC' },
        { k: 'a17', ln: 'S1-17', d: 'Self-employed health insurance', a: '§162(l)', leaf: 'seHealth', mod: 'schC' },
        { k: 'a18', ln: 'S1-18', d: 'Penalty on early withdrawal of savings', a: '§62(a)(9)', leaf: 'earlyPenalty', mod: 'portfolio' },
        { k: 'a19', ln: 'S1-19a', d: 'Alimony paid', a: '§215 (repealed)', leaf: 'alimonyPaid', mod: 'client' },
        { k: 'a20', ln: 'S1-20', d: 'IRA deduction', a: '§219', leaf: 'iraDed', mod: 'client' },
        { k: 'a21', ln: 'S1-21', d: 'Student loan interest deduction', a: '§221', leaf: 'studentLoan', mod: 'client' },
        { k: 'a24', ln: 'S1-24z', d: 'Other adjustments', a: '§62', leaf: 'otherAdj', mod: 'client' },
      ] },
      { k: 'l11', ln: '11', d: 'Adjusted gross income', a: '§62', v: (r) => r.agi, tot: 1 },
      { s: 'Deductions' },
      { k: 'l12', ln: '12', d: (r) => (r.a.itemize ? 'Itemized deductions — Schedule A' : 'Standard deduction') + (r.a.nonItemCharity ? ' + charitable deduction for non-itemizers' : ''), a: '§§63, 161–170', v: (r) => r.f.l12, mod: 'itemized', sub: [
        { k: 'sd', ln: 'Std', d: 'Standard deduction (incl. age 65 / blind)', a: '§63(c), (f)', v: (r) => r.a.std },
        { k: 'am', ln: 'A-1', d: 'Medical and dental expenses (before the 7.5% floor)', a: '§213', leaf: 'medical', mod: 'itemized' },
        { k: 'a4', ln: 'A-4', d: 'Medical deduction after 7.5% of AGI', a: '§213(a)', v: (r) => r.a.l4 },
        { k: 'a5a', ln: 'A-5a', d: 'State and local income (or sales) taxes', a: '§164(a)(3)', leaf: 'stateTax', mod: 'itemized' },
        { k: 'a5b', ln: 'A-5b', d: 'State and local real estate taxes', a: '§164(a)(1)', leaf: 'realEstateTax', mod: 'itemized' },
        { k: 'a5c', ln: 'A-5c', d: 'State and local personal property taxes', a: '§164(a)(2)', leaf: 'persPropTax', mod: 'itemized' },
        { k: 'a5e', ln: 'A-5e', d: 'SALT deduction after the cap', a: '§164(b)(6), (7)', v: (r) => r.a.l5e },
        { k: 'a8', ln: 'A-8a', d: 'Home mortgage interest and points', a: '§163(h)(3)', leaf: 'mortgageInt', mod: 'itemized' },
        { k: 'a9', ln: 'A-9', d: 'Investment interest (limited to net investment income)', a: '§163(d)', leaf: 'invInt', mod: 'itemized' },
        { k: 'a11c', ln: 'A-11', d: 'Gifts to charity, cash', a: '§170(b)(1)(G)', leaf: 'charityCash', mod: 'itemized' },
        { k: 'a12c', ln: 'A-12', d: 'Gifts to charity, other than cash', a: '§170(b)(1)(C)', leaf: 'charityNoncash', mod: 'itemized' },
        { k: 'a14', ln: 'A-14', d: 'Charitable deduction after AGI limits' + ' and the 0.5% floor (2026)', a: '§170(b)', v: (r) => r.a.charity },
        { k: 'a15', ln: 'A-15', d: 'Casualty and theft losses', a: '§165(h)', leaf: 'casualty', mod: 'itemized' },
        { k: 'a16', ln: 'A-16', d: 'Other itemized deductions', a: '§67(b)', leaf: 'otherItemized', mod: 'itemized' },
        { k: 'a17', ln: 'A-17', d: 'Total itemized deductions (after the 2026 2/37 limit)', a: '§68', v: (r) => r.a.l17 },
      ] },
      { k: 'l13a', ln: '13a', d: 'Qualified business income deduction', a: '§199A', leaf: 'qbiDed', opt: true, v: (r) => r.f.l13a, mod: 'qbi' },
      { k: 'l13b', ln: '13b', d: 'Schedule 1-A: tips, overtime, car loan interest, seniors', a: '§§224, 225, 163(h)(4), 151(f)', v: (r) => r.f.l13b, sub: [
        { k: 'tp', ln: '1-A', d: 'Qualified tips (cap $25,000)', a: '§224', leaf: 'tips', mod: 'client' },
        { k: 'ot', ln: '1-A', d: 'Qualified overtime premium', a: '§225', leaf: 'overtime', mod: 'client' },
        { k: 'cl', ln: '1-A', d: 'Qualified passenger vehicle loan interest', a: '§163(h)(4)', leaf: 'carLoanInt', mod: 'client' },
        { k: 'sn', ln: '1-A', d: 'Enhanced deduction for seniors ($6,000 each)', a: '§151(f)', v: (r) => r.s1a.senior },
      ] },
      { k: 'l14', ln: '14', d: 'Total deductions', v: (r) => r.f.l14 },
      { k: 'l15', ln: '15', d: 'Taxable income', a: '§63(a)', v: (r) => r.f.l15, tot: 1 },
      { s: 'Tax and credits' },
      { k: 'l16', ln: '16', d: 'Tax (rates, Qualified Dividends / Schedule D worksheets)', a: '§1(a)–(d), (h)', v: (r) => r.f.l16 },
      { k: 'l17', ln: '17', d: 'Alternative minimum tax — Schedule 2 line 2 (Form 6251)', a: '§55', v: (r) => r.f.l17, sub: [
        { k: 'pab', ln: '6251-2g', d: 'Private activity bond interest', a: '§57(a)(5)', leaf: 'pabInt', mod: 'portfolio' },
        { k: 'iso', ln: '6251-2i', d: 'Incentive stock options exercised and held', a: '§56(b)(3)', leaf: 'isoSpread', mod: 'equity' },
        { k: 'oaa', ln: '6251-2k+', d: 'Other AMT adjustments (dispositions, K-1 items)', a: '§§56, 58', leaf: 'otherAmtAdj', mod: 'k1' },
        { k: 'amti', ln: '6251-4', d: 'Alternative minimum taxable income', a: '§55(b)(2)', v: (r) => r.amt.amti },
        { k: 'amtx', ln: '6251-5', d: 'Exemption after phase-out', a: '§55(d)', v: (r) => r.amt.exemption },
        { k: 'tmt', ln: '6251-9', d: 'Tentative minimum tax', a: '§55(b)(1)', v: (r) => r.amt.tmt },
      ] },
      { k: 'l18', ln: '18', d: 'Add lines 16 and 17', v: (r) => r.f.l18 },
      { k: 'l19', ln: '19', d: 'Child tax credit and credit for other dependents', a: '§24', v: (r) => r.f.l19, sub: [
        { k: 'ck', ln: '8812', d: 'Children for the child tax credit', a: '§24(c)', leaf: 'ctcKids', mod: 'client', cnt: 1 },
        { k: 'od', ln: '8812', d: 'Other dependents', a: '§24(h)(4)', leaf: 'odcDeps', mod: 'client', cnt: 1 },
      ] },
      { k: 'l20', ln: '20', d: 'Other nonrefundable credits — Schedule 3 line 8', a: '§§27, 21, 25A, 53', v: (r) => r.f.l20, sub: [
        { k: 'ftc', ln: 'S3-1', d: 'Foreign tax credit', a: '§§27, 901', leaf: 'ftc', mod: 'portfolio' },
        { k: 'cc', ln: 'S3-2', d: 'Child and dependent care credit', a: '§21', leaf: 'childCare', mod: 'client' },
        { k: 'ed', ln: 'S3-3', d: 'Education credits', a: '§25A', leaf: 'education', mod: 'client' },
        { k: 'mtc', ln: 'S3-6b', d: 'Minimum tax credit available (Form 8801)', a: '§53', leaf: 'amtCredit', mod: 'equity' },
        { k: 'mtcu', ln: '8801', d: 'Minimum tax credit used this year', a: '§53(c)', v: (r) => r.amt.creditUsed },
        { k: 'onr', ln: 'S3-6z', d: 'Other nonrefundable credits', leaf: 'otherNonref', mod: 'client' },
      ] },
      { k: 'l22', ln: '22', d: 'Tax after nonrefundable credits', v: (r) => r.f.l22 },
      { k: 'l23', ln: '23', d: 'Other taxes — Schedule 2 line 21', a: '§§1401, 3101(b)(2), 1411', v: (r) => r.f.l23, sub: [
        { k: 'set', ln: 'S2-4', d: 'Self-employment tax (Schedule SE)', a: '§1401', v: (r) => r.se.tax },
        { k: 'sek', ln: 'SE-2', d: 'Self-employment earnings from K-1s', a: '§1402(a)', leaf: 'seK1', mod: 'k1' },
        { k: 'am9', ln: 'S2-11', d: 'Additional Medicare Tax (Form 8959)', a: '§§3101(b)(2), 1401(b)(2)', v: (r) => r.s2.l11 },
        { k: 'nit', ln: 'S2-12', d: 'Net investment income tax (Form 8960)', a: '§1411', v: (r) => r.s2.l12 },
        { k: 'nio', ln: '8960', d: 'Passive, royalty and other net investment income', a: '§1411(c)', leaf: 'niiOther', mod: 'k1' },
        { k: 'ott', ln: 'S2-17', d: 'Other additional taxes', leaf: 'otherTax', mod: 'client' },
      ] },
      { k: 'l24', ln: '24', d: 'Total tax', v: (r) => r.f.l24, tot: 1 },
      { s: 'Payments and refund' },
      { k: 'l25a', ln: '25a', d: 'Federal income tax withheld — Forms W-2', a: '§31', leaf: 'wh', mod: 'client' },
      { k: 'l25b', ln: '25b', d: 'Federal income tax withheld — Forms 1099 and other', a: '§31', leaf: 'whOther', mod: 'portfolio' },
      { k: 'l26', ln: '26', d: 'Estimated tax payments', a: '§6654', leaf: 'estimates', mod: 'client' },
      { k: 'l28', ln: '28', d: 'Additional child tax credit', a: '§24(d)', v: (r) => r.f.l28 },
      { k: 'l31', ln: '31', d: 'Other payments and refundable credits — Schedule 3 line 15', v: (r) => r.f.l31, sub: [
        { k: 'ext', ln: 'S3-10', d: 'Amount paid with extension request', a: '§6081', leaf: 'extension', mod: 'client' },
        { k: 'opy', ln: 'S3-14', d: 'Other payments and refundable credits', leaf: 'otherPayments', mod: 'client' },
      ] },
      { k: 'l33', ln: '33', d: 'Total payments', v: (r) => r.f.l33, tot: 1 },
      { k: 'l34', ln: '34', d: 'Overpaid (refund)', a: '§6402', v: (r) => r.f.l34 },
      { k: 'l37', ln: '37', d: 'Amount you owe', a: '§6151', v: (r) => r.f.l37, tot: 1 },
    ];
    const MOD_VIEW = { portfolio: 'm-portfolio', schC: 'm-schc', capital: 'm-capital', equity: 'm-capital', rents: 'm-rents', k1: 'm-k1', qbi: 'm-qbi', itemized: 'm-itemized', client: 'client' };
    const MOD_CHECKS = (det) => ({ portfolio: det.pf.checks, schC: det.sc.checks, capital: det.cap.checks, equity: det.eq.checks, rents: det.rents.checks, k1: det.k1.checks });
    const rowVal = (row, r) => (row.v ? row.v(r) : n(r.x[row.leaf]));
    const lnKey = (s) => String(s || '').replace(/^Std$/, '12');
    function rowStatus(row, res, baseRes, det, j) {
      const r = res.r; const ln = lnKey(row.ln);
      if (r.diag.some((d) => d.sev === 'err' && d.line === ln)) return 'err';
      const mc = row.mod && MOD_CHECKS(det)[row.mod];
      if (row.leaf && mc && mc.some((c) => c.sev === 'err')) return 'err';
      if (row.leaf && mc && mc.some((c) => c.sev === 'warn')) return 'inc';
      if (r.diag.some((d) => d.sev === 'warn' && d.line === ln)) return 'inc';
      if (res.col.growth) return 'est';
      if (j > 0 && Math.abs(rowVal(row, r) - rowVal(row, baseRes.r)) > 0.5) return 'est';
      if (row.leaf && j === 0 && ((C().direct || {})[row.leaf] != null || (C().adjustments || {})[row.leaf] != null)) return 'est';
      if (row.leaf && j > 0 && ((res.col.ov || {})[row.leaf] != null || (res.col.adjustments || {})[row.leaf] != null)) return 'est';
      return 'ok';
    }
    const ST = { ok: ['ok', 'OK'], est: ['info', 'EST'], inc: ['warn', 'INC'], err: ['bad', 'ERR'] };
    const walkUI = window.TMWalkUI(Object.assign({}, api, {
      client: C, clientPath: cp, walk, rows: WALK, rowVal, rowStatus,
      modViews: MOD_VIEW, renderModule: (key) => V[key](),
    }));

    V.walk = () => {
      const c = C(); const w = walk(); const cols = w.cols; const det = w.feeds.detail;
      const ui = state.ui; const aj = Math.min(ui.walkCol || 0, cols.length - 1); const act = cols[aj];
      const showAuth = ui.walkAuth !== false, hideZero = !!ui.walkHideZero, showNotes = !!ui.walkNotes;
      const base = cols[0];
      // Toolbar
      let h = '<div class="walk-head"><div><div class="eyebrow">Form 1040 walk · ' + esc(clientLabel(c)) + '</div><h1>Form 1040 walk</h1></div>' +
        '<div class="walk-tools"><div class="seg" role="group" aria-label="Tax year">' + yearOpts.map(([y, t]) => '<button data-action="base-year" data-val="' + y + '" class="' + (String(c.info.year) === y ? 'on' : '') + '">' + t + '</button>').join('') + '</div>' +
        selectBind(cp('info.status'), c.info.status, TM.STATUSES, { label: 'Filing status' }) +
        '<button class="btn small" data-action="undo-last" title="Undo the last change">Undo</button><button class="btn small" data-action="calc" aria-expanded="' + !!ui.calcOpen + '">Calculator</button>' +
        '<button class="btn small' + (showNotes ? ' on' : '') + '" data-action="walk-notes" aria-pressed="' + showNotes + '">Notes</button>' +
        '<button class="btn small primary" data-ask="' + esc('Walk me through ' + clientLabel(c) + '\'s Form 1040 for TY' + c.info.year + ' and compare the planning columns. What drives the difference, what should I watch for, and which column would you recommend?') + '">Ask AI</button>' +
        '<a class="btn small ghost" href="#settings" aria-label="Settings" title="Settings">⚙</a></div></div>';
      // Working-on chips
      h += '<div class="working"><span class="muted small">Working on</span>' + cols.map((x, j) => '<button class="wchip' + (j === aj ? ' on' : '') + '" data-action="walk-col" data-val="' + j + '"><b>' + esc(x.col.name) + '</b><span>' + moneyM(x.r.f.l24) + ' · ' + pct(x.r.effective, 1) + '</span></button>').join('') +
        (cols.length < MAX_COLS ? '<span class="addcol"><button class="btn small" data-action="add-col" data-val="base">+ Planning column</button>' + (aj > 0 ? '<button class="btn small ghost" data-action="add-col" data-val="dup">Duplicate “' + esc(act.col.name) + '”</button>' : '') + '</span>' : '<span class="muted small">5 planning columns is the maximum</span>') + '</div>';
      h += '<div class="walk-opts"><button class="btn small ghost" data-action="walk-expand" data-val="1">Expand all</button><button class="btn small ghost" data-action="walk-expand" data-val="0">Collapse all</button>' +
        '<label class="small"><input type="checkbox" data-action-check="walkHideZero"' + (hideZero ? ' checked' : '') + '> Hide zero lines</label><label class="small"><input type="checkbox" data-action-check="walkAuth"' + (showAuth ? ' checked' : '') + '> Authority</label>' +
        '<span class="legend-note" style="margin:0"><span><i class="sw"></i>Source adjustment / manual total</span><span><i class="sw diff"></i>Differs from base</span></span></div>';
      h += '<div class="walk-layout"><div class="walk-main"><div class="tablewrap walkwrap"><table class="t walk"><thead><tr><th class="ln">Line</th><th>Description</th>' + 
        cols.map((x, j) => '<th class="n colh' + (j === aj ? ' act' : '') + '">' + colHead(x, j) + '</th>').join('') + '<th>Status</th>' + (showNotes ? '<th>Notes</th>' : '') + '</tr></thead><tbody>';
      // Planning moves (levers) per column
      const lvOpen = !!ui.open['w:levers'];
      h += '<tr class="sec clickable" data-toggle="w:levers" tabindex="0"><td colspan="' + (3 + cols.length + (showNotes ? 1 : 0)) + '"><span class="caret">' + (lvOpen ? '▾' : '▸') + '</span> Planning moves <span class="muted small">' + (lvOpen ? 'applied to the base before typed amounts' : cols.slice(1).map((x) => esc(x.col.name) + ': ' + (leverSummary(x.col) || 'none')).join(' · ')) + '</span></td></tr>';
      if (lvOpen) {
        h += '<tr class="lever"><td class="ln">%</td><td>Income growth (projection)</td>' + cols.map((x, j) => '<td class="n">' + (j === 0 ? '<span class="muted small">—</span>' : inputNum(cp('cols.' + (j - 1) + '.growth'), x.col.growth || 0, { pct: true, dp: 1, label: 'Income growth for ' + x.col.name })) + '</td>').join('') + '<td></td>' + (showNotes ? '<td></td>' : '') + '</tr>';
        TM.LEVERS.forEach((lv) => {
          h += '<tr class="lever"><td class="ln">±</td><td>' + esc(lv.label) + '<div class="muted small">' + esc(lv.hint) + '</div></td>' + cols.map((x, j) => '<td class="n">' + (j === 0 ? '<span class="muted small">—</span>' : optNum(cp('cols.' + (j - 1) + '.lv.' + lv.key), (x.col.lv || {})[lv.key], { label: lv.label + ' for ' + x.col.name })) + '</td>').join('') + '<td></td>' + (showNotes ? '<td></td>' : '') + '</tr>';
        });
      }
      const renderRow = (row, depth) => {
        if (row.s) return '<tr class="sec"><td colspan="' + (3 + cols.length + (showNotes ? 1 : 0)) + '">' + esc(row.s) + '</td></tr>';
        const vals = cols.map((x) => rowVal(row, x.r));
        if (hideZero && vals.every((v) => Math.abs(v) < 0.5) && !row.tot) return '';
        const open = row.sub && (ui.open['w:' + row.k] || ui.walkAll);
        const st = rowStatus(row, act, base, det, aj);
        const desc = typeof row.d === 'function' ? row.d(act.r) : row.d;
        let tr = '<tr class="' + (row.tot ? 'total ' : '') + (depth ? 'subrow ' : '') + (row.sub ? 'clickable ' : '') + '"' + (row.sub ? ' data-toggle="w:' + row.k + '" tabindex="0" aria-expanded="' + !!open + '"' : '') + '>' +
          '<td class="ln">' + esc(row.ln) + '</td><td class="wrap"><span style="padding-left:' + depth * 16 + 'px;display:inline-block">' + (row.sub ? '<span class="caret">' + (open ? '▾' : '▸') + '</span> ' : '') + esc(desc) + '</span>' +
          (row.mod && MOD_VIEW[row.mod] && row.mod !== 'client' ? ' <a class="modlink" href="#' + MOD_VIEW[row.mod] + '" title="Open the module that feeds this line">module</a>' : '') + (showAuth && row.a ? '<div class="auth" style="padding-left:' + (depth * 16 + (row.sub ? 16 : 0)) + 'px">IRC ' + esc(row.a) + '</div>' : '') + walkUI.rowActions(row) + '</td>';
        cols.forEach((x, j) => {
          const v = vals[j]; const diff = j > 0 && Math.abs(v - vals[0]) > 0.5;
          if (row.leaf) {
            const legacy = !!row.opt || (j === 0 ? (c.direct || {})[row.leaf] != null : (x.col.ov || {})[row.leaf] != null);
            const adjustments = j === 0 ? (c.adjustments || {}) : (x.col.adjustments || {});
            const path = j === 0 ? cp((legacy ? 'direct.' : 'adjustments.') + row.leaf) : cp('cols.' + (j - 1) + (legacy ? '.ov.' : '.adjustments.') + row.leaf);
            const typed = j === 0 ? (c.direct || {})[row.leaf] != null || adjustments[row.leaf] != null : (x.col.ov || {})[row.leaf] != null || adjustments[row.leaf] != null;
            const source = x.sourceX ? n(x.sourceX[row.leaf]) : v - n(adjustments[row.leaf]);
            const shown = row.opt && !typed ? '' : (row.cnt ? v : fmtIn(v));
            tr += '<td class="n' + (j === aj ? ' act' : '') + '">' + optNum(path, shown, { cls: (typed ? 'ovr' : '') + (diff ? ' diff' : ''), ph: row.opt ? fmtNum(v) : '', label: desc + ' — ' + x.col.name, source: legacy ? null : source, title: typed ? (j === 0 ? (legacy ? 'Saved manual total. ' : 'Source subtotal ' + money(source) + ' plus an adjustment. ') + 'Clear the cell to use the source calculation.' : 'Adjusted for this column. Clear the cell to follow its source calculation.') : '' }) +
              (diff ? '<div class="delta ' + (v > vals[0] ? 'up' : 'down') + '">' + (v > vals[0] ? '+' : '−') + fmtNum(Math.abs(v - vals[0])) + '</div>' : '') + walkUI.controls(row, x, j) + '</td>';
          } else tr += '<td class="n' + (j === aj ? ' act' : '') + (v < -0.004 ? ' neg' : '') + (diff ? ' diffc' : '') + '">' + fmtNum(v) + (diff ? '<div class="delta ' + (v > vals[0] ? 'up' : 'down') + '">' + (v > vals[0] ? '+' : '−') + fmtNum(Math.abs(v - vals[0])) + '</div>' : '') + '</td>';
        });
        tr += '<td>' + chip(ST[st][0], ST[st][1]) + '</td>' + (showNotes ? '<td class="notecell"><input class="cell txt" data-bind="' + esc(cp('notes.' + row.k)) + '" data-type="text" id="note-' + row.k + '" value="' + esc((c.notes || {})[row.k] || '') + '" aria-label="Note for line ' + esc(row.ln) + '" placeholder="Add a note"></td>' : '') + '</tr>';
        if (open) row.sub.forEach((s) => { tr += renderRow(s, depth + 1); });
        return tr;
      };
      let section = '';
      WALK.forEach((row) => {
        if (row.s) section = row.s;
        if (!ui.walkSection || ui.walkSection === 'all' || ui.walkSection === section) h += renderRow(row, 0);
      });
      h += '</tbody></table></div></div>';
      h += walkSide(act, base, aj, w);
      h += '</div>';
      return h + walkUI.renderPanel();
    };
    function leverSummary(col) {
      const parts = TM.LEVERS.filter((l) => (col.lv || {})[l.key] != null && (col.lv || {})[l.key] !== '').map((l) => l.label.split(' (')[0] + ' ' + moneyM(col.lv[l.key]));
      if (col.growth) parts.unshift('growth ' + pct(col.growth, 1));
      const ov = Object.keys(col.ov || {}).filter((k) => col.ov[k] != null).length;
      if (ov) parts.push(ov + ' typed line' + (ov === 1 ? '' : 's'));
      return parts.join(', ');
    }
    const fmtIn = (v) => (v === '' || v == null ? '' : (Math.round(+v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }));
    function colHead(x, j) {
      if (j === 0) return '<div class="colname">' + esc(x.col.name) + '</div><div class="colmeta">TY' + x.col.year + ' · ' + esc(x.col.status.toUpperCase()) + ' · base</div>';
      const i = j - 1;
      return '<div class="colctl">' + inputText(cp('cols.' + i + '.name'), x.col.name, { label: 'Column name' }) + '<button class="btn small ghost" data-action="del-col" data-val="' + i + '" aria-label="Remove ' + esc(x.col.name) + '" title="Remove column">×</button></div>' +
        '<div class="colctl">' + selectBind(cp('cols.' + i + '.year'), String(x.col.year), [['2025', 'TY25'], ['2026', 'TY26']], { num: true, label: 'Tax year for ' + x.col.name }) + selectBind(cp('cols.' + i + '.status'), x.col.status, TM.STATUSES.map(([k]) => [k, k.toUpperCase()]), { label: 'Filing status for ' + x.col.name }) + '</div>';
    }
    function walkSide(act, base, aj, w) {
      const r = act.r; const c = C();
      const counts = { ok: 0, est: 0, inc: 0, err: 0 };
      const det = w.feeds.detail;
      const each = (rows) => rows.forEach((row) => { if (row.s) return; counts[rowStatus(row, act, base, det, aj)]++; if (row.sub) each(row.sub); });
      each(WALK);
      const priorReq = TM.safeHarbor(c.info.priorTax, c.info.priorAgi, r.f.l24, r.f.l25d, r.f.l26, r.status).required;
      const paid = r.f.l25d + r.f.l26;
      let h = '<aside class="walk-side">' + walkUI.sectionNav() + walkUI.toolbox(act) + '<div class="panel pad"><h3>Live projection</h3><div class="muted small" style="margin:-4px 0 8px">' + esc(act.col.name) + ' · TY' + r.year + ' · ' + esc(TM.statusLabel(r.status)) + '</div><dl class="kv">' +
        kv('Adjusted gross income', money(r.agi)) + kv('Taxable income', money(r.f.l15)) + kv('Total tax', money(r.f.l24)) + kv('Total payments', money(r.f.l33)) +
        kv('Effective rate (of AGI)', pct(r.effective, 1)) + kv('Marginal rate, next $1,000', pct(r.marginal, 1)) + '</dl>' +
        '<div class="proj ' + (r.net >= 0 ? 'pos' : 'neg') + '"><span>' + (r.net >= 0 ? 'Projected refund' : 'Projected balance due') + '</span><b>' + money(Math.abs(r.net)) + '</b></div>' +
        (aj > 0 ? '<div class="small" style="margin-top:6px">vs base: <b class="' + (r.f.l24 <= base.r.f.l24 ? 'pos' : 'neg') + '">' + (r.f.l24 <= base.r.f.l24 ? 'saves ' : 'costs ') + money(Math.abs(base.r.f.l24 - r.f.l24)) + '</b></div>' : '') +
        '<dl class="kv" style="margin-top:10px">' + kv('Safe-harbor requirement (§6654(d))', money(priorReq)) + kv('Withholding + estimates', money(paid)) + kv(paid >= priorReq ? 'Safe harbor met' : 'Shortfall', money(Math.abs(paid - priorReq))) + '</dl></div>';
      h += '<div class="panel pad"><h3>Line status</h3><div class="stat-counts">' + Object.entries(counts).map(([k, v]) => '<span>' + chip(ST[k][0], ST[k][1]) + ' <b>' + v + '</b></span>').join('') + '</div><p class="muted small" style="margin:6px 0 0">EST: projected, planned or typed over a module. INC: a module check needs attention. ERR: inconsistent input.</p></div>';
      h += '<div class="panel pad"><h3>Diagnostics</h3>' + (r.diag.length ? '<ul class="dlist light">' + r.diag.map((d) => '<li class="' + d.sev + '"><b>' + esc(d.line) + '</b> ' + esc(d.text) + (d.cite ? ' <span class="muted">' + esc(d.cite) + '</span>' : '') + '</li>').join('') + '</ul>' : '<p class="muted small">No diagnostics for this column.</p>') + '</div>';
      const a = r.amt;
      h += '<div class="panel pad"><h3>AMT estimate (Form 6251)</h3><dl class="kv">' + kv('Taxable income before deductions added back', money(a.l1)) + kv('Taxes / standard deduction added back', money(a.l2a)) + kv('Preferences and adjustments', money(a.pab + a.iso + a.other)) +
        kv('AMTI', money(a.amti)) + kv('Exemption', money(a.exemption)) + kv('Tentative minimum tax', money(a.tmt)) + kv('Regular tax less FTC', money(a.regular)) + kv('AMT', money(a.amt)) + (a.creditCarry ? kv('Minimum tax credit carryforward', money(a.creditCarry)) : '') + '</dl></div>';
      return h + '</aside>';
    }

    /* ================= MODULES ================= */
    V['m-portfolio'] = () => {
      const c = C(); const d = walk().feeds.detail.pf; const m = c.mod.portfolio;
      let h = modHead('Portfolio income', 'Interest and dividends from Forms 1099-INT, 1099-OID and 1099-DIV, and the investment items that go with them. Totals feed Form 1040 lines 2a–3b, capital gain distributions feed Schedule D line 13, and AMT, foreign tax and withholding items feed their lines.');
      h += feedStrip([['taxableInt', '2b'], ['taxExemptInt', '2a'], ['ordDiv', '3b'], ['qualDiv', '3a'], ['pabInt', '6251-2g'], ['ftc', 'S3-1'], ['reitPtp', '8995-6']]);
      h += '<h2>Interest <span class="sub">Schedule B part I</span></h2>' + grid('mod.portfolio.interest', m.interest, [{ k: 'payer', l: 'Payer', w: 180 }, { k: 'taxable', l: 'Taxable (box 1 + 3)', t: 'num' }, { k: 'exempt', l: 'Tax-exempt (box 8)', t: 'num' }, { k: 'pab', l: 'PAB interest (box 9)', t: 'num' }, { k: 'treasury', l: 'U.S. Treasury', t: 'bool' }, { k: 'penalty', l: 'Early-withdrawal penalty', t: 'num' }, { k: 'foreignTax', l: 'Foreign tax', t: 'num' }, { k: 'wh', l: 'Federal tax withheld', t: 'num' }],
        { add: 'Add interest payer', tpl: { payer: '', taxable: 0, exempt: 0 }, totals: [] });
      h += '<h2>Dividends <span class="sub">Schedule B part II</span></h2>' + grid('mod.portfolio.dividends', m.dividends, [{ k: 'payer', l: 'Payer', w: 180 }, { k: 'ordinary', l: 'Ordinary (1a)', t: 'num' }, { k: 'qualified', l: 'Qualified (1b)', t: 'num' }, { k: 'capGainDist', l: 'Cap. gain dist. (2a)', t: 'num' }, { k: 'unrecap1250', l: '§1250 (2b)', t: 'num' }, { k: 'collect28', l: '28% (2d)', t: 'num' }, { k: 'sec199a', l: '§199A (5)', t: 'num' }, { k: 'foreignTax', l: 'Foreign tax (7)', t: 'num' }, { k: 'exemptInt', l: 'Exempt-interest div. (12)', t: 'num' }, { k: 'pab', l: 'PAB (13)', t: 'num' }],
        { add: 'Add dividend payer', tpl: { payer: '', ordinary: 0, qualified: 0 } });
      h += '<h2>Totals</h2><div class="grid2"><div class="panel pad"><dl class="kv">' + kv('Taxable interest', money(d.taxableInt)) + kv('Tax-exempt interest (incl. exempt-interest dividends)', money(d.taxExemptInt + d.exemptDiv)) + kv('U.S. Treasury interest (state-exempt)', money(d.treasury)) + kv('Private activity bond interest (AMT)', money(d.pabInt + d.pabDiv)) + '</dl></div>' +
        '<div class="panel pad"><dl class="kv">' + kv('Ordinary dividends', money(d.ordDiv)) + kv('Qualified dividends', money(d.qualDiv)) + kv('Capital gain distributions → Sch D line 13', money(d.cgd)) + kv('Section 199A dividends → QBI', money(d.sec199a)) + kv('Foreign tax paid', money(d.ftc)) + '</dl></div></div>';
      h += '<h2>Checks</h2>' + checksList(d.checks);
      return h;
    };

    V['m-schc'] = () => {
      const c = C(); const w = walk(); const d = w.feeds.detail.sc; const m = c.mod.schC; const r = w.cols[0].r; const sel = state.ui.sel && state.ui.sel.schc;
      let h = modHead('Schedule C — Business income', 'Profit or loss from each sole proprietorship. Net profit feeds Schedule 1 line 3, Schedule SE and the QBI deduction; retirement contributions and self-employed health insurance feed Schedule 1 part II.');
      h += feedStrip([['schC', 'S1-3'], ['sepIra', 'S1-16'], ['seHealth', 'S1-17']]);
      h += '<h2>Businesses</h2>' + grid('mod.schC.businesses', m.businesses, [{ k: 'name', l: 'Business', w: 200 }, { k: 'owner', l: 'Owner', t: 'sel', o: [['tp', 'Taxpayer'], ['sp', 'Spouse']] }, { k: 'gross', l: 'Gross receipts (1)', t: 'num' }, { k: 'returns', l: 'Returns (2)', t: 'num' }, { k: 'cogs', l: 'COGS (4)', t: 'num' }, { k: 'homeOffice', l: 'Home office (30)', t: 'num' }, { k: 'sstb', l: 'SSTB', t: 'bool' }],
        { calc: [{ l: 'Expenses (28)', f: (b, i) => d.rows[i].l28 }, { l: 'Net profit (31)', f: (b, i) => d.rows[i].l31 }], open: 'schc', sel, add: 'Add business', tpl: { name: 'New business', owner: 'tp', gross: 0, exp: {}, homeOffice: 0, w2Paid: 0, ubia: 0, sstb: false }, totals: [d.net] });
      if (sel != null && m.businesses[sel]) {
        const b = m.businesses[sel]; const P = 'mod.schC.businesses.' + sel;
        h += '<div class="panel pad detailpanel"><h3 style="margin-top:0">' + esc(b.name) + ' — expenses</h3><div class="form">' + TM.SCHC_EXPENSES.map(([k, ln, t]) => '<label class="field"><span><b class="ln-tag">' + ln + '</b> ' + esc(t) + '</span>' + num(cp(P + '.exp.' + k), (b.exp || {})[k] || '', { label: t }) + '</label>').join('') +
          '<label class="field"><span><b class="ln-tag">6</b> Other income</span>' + num(cp(P + '.otherIncome'), b.otherIncome || '') + '</label><label class="field"><span><b class="ln-tag">QBI</b> W-2 wages paid</span>' + num(cp(P + '.w2Paid'), b.w2Paid || '') + '</label><label class="field"><span><b class="ln-tag">QBI</b> UBIA of qualified property</span>' + num(cp(P + '.ubia'), b.ubia || '') + '</label></div>' +
          '<p class="small muted" style="margin:10px 0 0">Meals are entered at cost; 50% is deducted (§274(n)).</p></div>';
      }
      h += '<h2>Retirement and health</h2><div class="panel pad"><div class="form"><label class="field">SEP / solo 401(k) / SIMPLE contributions' + num(cp('mod.schC.sepIra'), m.sepIra) + '<span class="hint">Schedule 1 line 16; limit about 20% of net earnings for a SEP (§404(a)(8))</span></label>' +
        '<label class="field">Self-employed health insurance' + num(cp('mod.schC.seHealth'), m.seHealth) + '<span class="hint">Schedule 1 line 17, limited to net profit</span></label></div></div>';
      h += '<h2>Schedule SE <span class="sub">base column</span></h2><div class="panel pad"><dl class="kv">' + kv('Net profit from Schedule C', money(r.s1.l3)) + kv('SE earnings from K-1s', money(r.x.seK1)) + kv('Net earnings from self-employment (× 92.35%)', money(r.se.ne)) + kv('Social security wages already taxed', money(r.x.ssWages)) +
        kv('Social security portion (12.4%)', money(r.se.ss)) + kv('Medicare portion (2.9%)', money(r.se.med)) + kv('Self-employment tax', money(r.se.tax)) + kv('Deductible half', money(r.se.ded)) + '</dl></div>';
      h += '<h2>Checks</h2>' + checksList(d.checks);
      return h;
    };

    V['m-capital'] = () => {
      const c = C(); const w = walk(); const det = w.feeds.detail; const cap = det.cap; const eq = det.eq; const m = c.mod.capital;
      const tab = state.tab.cap || 'invest';
      let h = modHead('Capital transactions', 'Sales of investment and business assets, built from the capital-gains workbook. Investment lots go to Form 8949 and Schedule D; business assets go to Form 4797 with depreciation recapture first, then §1231 netting and the five-year lookback. Equity compensation sales and ISO adjustments are on their own tab.');
      h += feedStrip([['stGain', 'D-7'], ['ltGain', 'D-15'], ['f4797ord', 'S1-4'], ['unrecap1250', 'D-19'], ['collect28', 'D-18'], ['isoSpread', '6251-2i']]);
      h += tabs('cap', [['invest', 'a) Investment assets'], ['business', 'b) Business assets'], ['equity', 'c) Equity compensation'], ['summary', 'Summary & forms']]);
      if (tab === 'invest') {
        h += '<p class="lede small">Stock, funds, collectibles, investment land and partnership interests. Gain = proceeds − selling expenses − basis + column (g) adjustment. Term follows the dates (more than one year is long-term) unless set.</p>';
        h += grid('mod.capital.invest', m.invest, [{ k: 'desc', l: 'Description', w: 170 }, { k: 'kind', l: 'Type', t: 'sel', o: [['stock', 'Stock / fund'], ['collectible', 'Collectible'], ['realestate', 'Investment land'], ['partnership', 'Partnership interest'], ['other', 'Other']] }, { k: 'acquired', l: 'Acquired', t: 'date' }, { k: 'sold', l: 'Sold', t: 'date' },
          { k: 'proceeds', l: 'Proceeds', t: 'num' }, { k: 'sellingExp', l: 'Selling exp.', t: 'num' }, { k: 'basis', l: 'Basis', t: 'num' }, { k: 'code', l: '8949 code' }, { k: 'adj', l: 'Adj. (g)', t: 'num' }, { k: 'sec751', l: '§751 ordinary', t: 'num' }, { k: 'box', l: 'Box', t: 'sel', o: ['A', 'B', 'C', 'D', 'E', 'F'] }],
          { calc: [{ l: 'Term', num: false, f: (x, i) => (cap.lots[i].lt ? 'Long' : 'Short') }, { l: 'Gain (loss)', f: (x, i) => cap.lots[i].capital }], add: 'Add lot', tpl: { desc: '', kind: 'stock', proceeds: 0, basis: 0, box: 'A' }, totals: [null, cap.st + cap.lt8949] });
        h += '<div class="form" style="margin-top:14px;max-width:560px"><label class="field">Short-term loss carryover (D-6)' + num(cp('mod.capital.stCarry'), m.stCarry) + '</label><label class="field">Long-term loss carryover (D-14)' + num(cp('mod.capital.ltCarry'), m.ltCarry) + '</label></div>';
      } else if (tab === 'business') {
        h += '<p class="lede small">Depreciable property and land used in a trade or business (Form 4797). §1245 recapture = lesser of gain or depreciation; §1250 recapture = additional depreciation; the rest is §1231 gain, and the straight-line depreciation inside it is unrecaptured §1250 gain taxed at up to 25%. Tick installment to report under §453 (recapture is still recognized in the year of sale).</p>';
        h += grid('mod.capital.business', m.business, [{ k: 'desc', l: 'Asset', w: 170 }, { k: 'type', l: 'Type', t: 'sel', o: [['1245', '§1245 personal'], ['1250', '§1250 real'], ['land', 'Land / §1231']] }, { k: 'acquired', l: 'Acquired', t: 'date' }, { k: 'sold', l: 'Sold', t: 'date' }, { k: 'cost', l: 'Cost + improvements', t: 'num' }, { k: 'depreciation', l: 'Depreciation', t: 'num' }, { k: 'addlDepr', l: 'Addl. depr. over SL', t: 'num' },
          { k: 'proceeds', l: 'Amount realized', t: 'num' }, { k: 'sellingExp', l: 'Selling exp.', t: 'num' }, { k: 'installment', l: 'Installment', t: 'bool' }, { k: 'contractPrice', l: 'Contract price', t: 'num' }, { k: 'principalThisYear', l: 'Principal received', t: 'num' }],
          { calc: [{ l: 'Gain', f: (x, i) => cap.assets[i].gain }, { l: 'Ordinary', f: (x, i) => cap.assets[i].ordinary }, { l: '§1231', f: (x, i) => cap.assets[i].s1231 }, { l: 'Deferred', f: (x, i) => cap.assets[i].deferred }], add: 'Add asset', tpl: { desc: '', type: '1245', cost: 0, depreciation: 0, proceeds: 0 } });
        h += '<div class="form" style="margin-top:14px;max-width:560px"><label class="field">Nonrecaptured §1231 losses, prior five years' + num(cp('mod.capital.priorNonrecap1231'), m.priorNonrecap1231) + '<span class="hint">§1231(c) lookback; Form 4797 line 8</span></label></div>';
      } else if (tab === 'equity') {
        const E = c.mod.equity;
        h += '<p class="lede small">From the stock-options workbook, with its unsold-lot error fixed: an ISO lot without a sale date is held, so its spread is a Form 6251 line 2i adjustment. Disqualifying dispositions are compensation; qualifying dispositions are long-term gain with a negative AMT adjustment for the earlier spread.</p>';
        h += '<h3>Incentive stock options</h3>' + grid('mod.equity.iso', E.iso, [{ k: 'lotId', l: 'Lot', w: 90 }, { k: 'grantDate', l: 'Granted', t: 'date' }, { k: 'exerciseDate', l: 'Exercised', t: 'date' }, { k: 'shares', l: 'Shares', t: 'num' }, { k: 'strike', l: 'Strike', t: 'num' }, { k: 'fmvExercise', l: 'FMV at exercise', t: 'num' }, { k: 'saleDate', l: 'Sold', t: 'date' }, { k: 'salePrice', l: 'Sale price', t: 'num' }, { k: 'notInW2', l: 'Not in W-2', t: 'bool' }],
          { calc: [{ l: 'Status', num: false, f: (x, i) => eq.iso[i].status }, { l: 'Compensation', f: (x, i) => eq.iso[i].ordinary }, { l: 'Capital gain', f: (x, i) => eq.iso[i].capital }, { l: 'AMT adj.', f: (x, i) => eq.iso[i].iso2i + eq.iso[i].amtAdj }], add: 'Add ISO lot', tpl: { lotId: 'Grant', shares: 0, strike: 0, fmvExercise: 0 } });
        h += '<h3>RSU vesting</h3>' + grid('mod.equity.rsu', E.rsu, [{ k: 'vestDate', l: 'Vested', t: 'date' }, { k: 'shares', l: 'Shares vested', t: 'num' }, { k: 'fmvVest', l: 'FMV at vest', t: 'num' }, { k: 'withheld', l: 'Shares withheld', t: 'num' }, { k: 'notInW2', l: 'Not in W-2', t: 'bool' }], { calc: [{ l: 'Income', f: (x, i) => (eq.rsu[i] || {}).income || 0 }], add: 'Add vest', tpl: { shares: 0, fmvVest: 0, withheld: 0 } });
        h += '<h3>NSO exercises</h3>' + grid('mod.equity.nso', E.nso, [{ k: 'exerciseDate', l: 'Exercised', t: 'date' }, { k: 'shares', l: 'Shares', t: 'num' }, { k: 'strike', l: 'Strike', t: 'num' }, { k: 'fmvExercise', l: 'FMV at exercise', t: 'num' }, { k: 'notInW2', l: 'Not in W-2', t: 'bool' }], { calc: [{ l: 'Income', f: (x, i) => (eq.nso[i] || {}).income || 0 }], add: 'Add NSO exercise', tpl: { shares: 0, strike: 0, fmvExercise: 0 } });
        h += '<h3>Restricted stock and §83(b)</h3>' + grid('mod.equity.restricted', E.restricted, [{ k: 'desc', l: 'Grant', w: 150 }, { k: 'transferDate', l: 'Transferred', t: 'date' }, { k: 'shares', l: 'Shares', t: 'num' }, { k: 'pricePaid', l: 'Price paid', t: 'num' }, { k: 'fmvTransfer', l: 'FMV at transfer', t: 'num' }, { k: 'election83b', l: '§83(b) elected', t: 'bool' }, { k: 'electionFiled', l: 'Election filed', t: 'date' }, { k: 'notInW2', l: 'Not in W-2', t: 'bool' }], { calc: [{ l: 'Income', f: (x, i) => eq.rs[i].income }], add: 'Add grant', tpl: { desc: '', shares: 0, election83b: true } });
        h += '<div class="form" style="margin-top:14px;max-width:560px"><label class="field">Prior-year minimum tax credit carryforward' + num(cp('mod.equity.amtCreditPrior'), E.amtCreditPrior) + '<span class="hint">Form 8801; used when regular tax exceeds tentative minimum tax</span></label></div>';
        h += '<div class="grid2" style="margin-top:14px"><div class="panel pad"><dl class="kv">' + kv('Compensation income', money(eq.compIncome)) + kv('Already in W-2 box 1', money(eq.inW2)) + kv('Added to line 1h', money(eq.notInW2)) + '</dl></div><div class="panel pad"><dl class="kv">' + kv('Form 6251 line 2i (exercised, held)', money(eq.line2i)) + kv('Line 2k (dispositions)', money(eq.line2k)) + kv('Short-term gain', money(eq.st)) + kv('Long-term gain', money(eq.lt)) + '</dl></div></div>';
        h += '<h2>Checks</h2>' + checksList(eq.checks);
        return h;
      } else {
        h += '<div class="grid2"><div class="panel pad"><h3 style="margin-top:0">Form 4797</h3><dl class="kv">' + kv('Ordinary gain before §1231 netting', money(cap.ordinaryPre)) + kv('Net §1231 gain (loss), incl. K-1s', money(cap.net1231)) + kv('Lookback recapture (line 8)', money(cap.lookback)) + kv('Ordinary gain → Schedule 1 line 4', money(cap.finalOrdinary)) + kv('§1231 gain → Schedule D line 11', money(cap.remaining1231)) + kv('Gain deferred under §453', money(cap.deferred)) + '</dl></div>' +
          '<div class="panel pad"><h3 style="margin-top:0">Schedule D</h3><dl class="kv">' + kv('Form 8949 short-term (Part I)', money(cap.st)) + kv('Form 8949 long-term (Part II)', money(cap.lt8949)) + kv('Unrecaptured §1250 gain (line 19)', money(cap.unrecap)) + kv('28% rate gain (line 18)', money(cap.collect28)) + kv('Line 16 on the return', money(w.cols[0].r.d.l16)) + kv('Line 7 (after the loss limit)', money(w.cols[0].r.f.l7)) + '</dl></div></div>';
        h += '<h2>Form 8949 by box</h2><div class="tablewrap"><table class="t"><thead><tr><th>Box</th><th>Lots</th><th class="n">Proceeds</th><th class="n">Basis</th><th class="n">Adjustments</th><th class="n">Gain (loss)</th></tr></thead><tbody>' +
          Object.entries(cap.f8949).filter(([, l]) => l.length).map(([b, l]) => '<tr><td class="line">' + b + '</td><td>' + l.length + '</td>' + cellNum(sum(l, (x) => x.realized)) + cellNum(sum(l, (x) => x.basis)) + cellNum(sum(l, (x) => x.adj)) + cellNum(sum(l, (x) => x.capital)) + '</tr>').join('') + '</tbody></table></div>';
      }
      h += '<h2>Checks</h2>' + checksList(cap.checks);
      return h;
    };

    V['m-rents'] = () => {
      const c = C(); const w = walk(); const det = w.feeds.detail; const R = det.rents; const pas = w.cols[0].passive || det.pas; const m = c.mod.rents; const sel = state.ui.sel && state.ui.sel.rent;
      let h = modHead('Rents & royalty', 'Schedule E part I. Each property\'s net result goes through the passive activity rules with any passive K-1s (Form 8582) before it reaches Schedule 1 line 5.');
      h += feedStrip([['schE', 'S1-5'], ['niiOther', '8960']]);
      h += '<div class="panel pad" style="margin-bottom:14px"><label class="field" style="flex-direction:row;gap:8px;align-items:center">' + check(cp('mod.rents.rep'), m.rep, 'Real estate professional') + ' Taxpayer qualifies as a real estate professional (§469(c)(7)) — rentals with material participation are nonpassive</label><p class="small muted" style="margin:6px 0 0">See <a href="#r-469">Rental election & ownership</a> for the hours tests and the §469(c)(7)(A) aggregation election.</p></div>';
      h += grid('mod.rents.properties', m.properties, [{ k: 'name', l: 'Property', w: 170 }, { k: 'type', l: 'Type', t: 'sel', o: [['rental', 'Rental'], ['royalty', 'Royalty']] }, { k: 'participation', l: 'Participation', t: 'sel', o: [['active', 'Active'], ['material', 'Material'], ['none', 'None']] }, { k: 'material', l: 'REP material', t: 'bool' }, { k: 'gross', l: 'Rents / royalties (3–4)', t: 'num' }, { k: 'priorSuspended', l: 'Prior suspended loss', t: 'num' }, { k: 'qbiTrade', l: '§199A trade', t: 'bool' }],
        { calc: [{ l: 'Expenses (20)', f: (x, i) => R.rows[i].exp }, { l: 'Net (21)', f: (x, i) => R.rows[i].net }, { l: 'Passive?', num: false, f: (x, i) => (R.rows[i].royalty ? 'Royalty' : R.rows[i].passive ? 'Passive' : 'Nonpassive') }], open: 'rent', sel, add: 'Add property', tpl: { name: 'New property', type: 'rental', participation: 'active', gross: 0, exp: {} }, totals: [null, R.net, null] });
      if (sel != null && m.properties[sel]) {
        const p = m.properties[sel]; const P = 'mod.rents.properties.' + sel;
        h += '<div class="panel pad detailpanel"><h3 style="margin-top:0">' + esc(p.name) + ' — expenses</h3><div class="form">' + TM.RENT_EXPENSES.map(([k, ln, t]) => '<label class="field"><span><b class="ln-tag">' + ln + '</b> ' + esc(t) + '</span>' + num(cp(P + '.exp.' + k), (p.exp || {})[k] || '', { label: t }) + '</label>').join('') +
          '<label class="field"><span><b class="ln-tag">QBI</b> W-2 wages</span>' + num(cp(P + '.w2'), p.w2 || '') + '</label><label class="field"><span><b class="ln-tag">QBI</b> UBIA</span>' + num(cp(P + '.ubia'), p.ubia || '') + '</label></div></div>';
      }
      h += '<h2>Passive activity loss limit <span class="sub">Form 8582 · with passive K-1s</span></h2><div class="grid2"><div class="panel pad"><dl class="kv">' + kv('MAGI for the $25,000 allowance', money(pas.magi)) + kv('Special allowance available', money(pas.allowance)) + kv('Passive income', money(pas.income)) + kv('Passive losses incl. prior years', money(pas.losses)) + kv('Loss allowed this year', money(pas.totalAllowedLoss)) + kv('Suspended to next year', money(pas.suspended)) + '</dl></div>' +
        '<div class="tablewrap"><table class="t"><thead><tr><th>Activity</th><th class="n">Net</th><th class="n">Allowed</th><th class="n">Suspended</th></tr></thead><tbody>' + (pas.acts.length ? pas.acts.map((a) => '<tr><td>' + esc(a.name) + (a.ptp ? ' <span class="chip plain">PTP</span>' : '') + '</td>' + cellNum(a.net) + cellNum(a.allowedNet) + cellNum(a.suspended) + '</tr>').join('') : '<tr><td colspan="4" class="muted small">No passive activities.</td></tr>') + '</tbody></table></div></div>';
      h += '<h2>Checks</h2>' + checksList(R.checks);
      return h;
    };

    V['m-k1'] = () => {
      const c = C(); const w = walk(); const det = w.feeds.detail; const K = det.k1; const m = c.mod.k1; const sel = state.ui.sel && state.ui.sel.k1;
      let h = modHead('Passthrough income (Schedule K-1)', 'One row per K-1 from partnerships (1065), S corporations (1120-S) and estates or trusts (1041). Losses are limited in order — basis, at-risk, then the passive rules — and every box flows to its 1040 destination.');
      h += feedStrip([['schE', 'S1-5'], ['seK1', 'SE-2'], ['otherAmtAdj', '6251'], ['niiOther', '8960']]);
      h += '<h2>K-1 register</h2>' + grid('mod.k1.entities', m.entities, [{ k: 'name', l: 'Entity', w: 190 }, { k: 'form', l: 'Form', t: 'sel', o: ['1065', '1120-S', '1041'] }, { k: 'ein', l: 'EIN', w: 100 }, { k: 'passive', l: 'Passive', t: 'bool' }, { k: 'ptp', l: 'PTP', t: 'bool' }, { k: 'sstb', l: 'SSTB', t: 'bool' }, { k: 'basisBegin', l: 'Beginning basis', t: 'num' }, { k: 'atRisk', l: 'At risk', t: 'num' }, { k: 'distributions', l: 'Distributions', t: 'num' }],
        { calc: [{ l: 'Ordinary (net)', f: (x, i) => K.rows[i].ord }, { l: 'After basis / at-risk', f: (x, i) => K.rows[i].ordAllowed }], open: 'k1', sel, add: 'Add K-1', tpl: { name: 'New entity', form: '1065', passive: false } });
      if (sel != null && m.entities[sel]) {
        const e = m.entities[sel]; const P = 'mod.k1.entities.' + sel; const row = K.rows[sel];
        h += '<div class="panel pad detailpanel"><h3 style="margin-top:0">' + esc(e.name) + ' — boxes (' + esc(e.form) + ')</h3><div class="form">' + TM.K1_FIELDS.map(([k, box, t]) => '<label class="field"><span><b class="ln-tag">' + box + '</b> ' + esc(t) + '</span>' + num(cp(P + '.' + k), e[k] == null ? '' : e[k], { label: t }) + '</label>').join('') +
          '<label class="field"><span><b class="ln-tag">8582</b> Prior-year suspended passive loss</span>' + num(cp(P + '.priorSuspended'), e.priorSuspended || '') + '</label><label class="field"><span><b class="ln-tag">Basis</b> Contributions this year</span>' + num(cp(P + '.contributions'), e.contributions || '') + '</label></div>' +
          '<div class="grid2" style="margin-top:12px"><dl class="kv">' + kv('Basis before losses', row.basisBefore == null ? '—' : money(row.basisBefore)) + kv('Suspended by basis', money(row.basisSusp)) + kv('Suspended by at-risk', money(row.riskSusp)) + kv('Ending basis (estimate)', row.endBasis == null ? '—' : money(row.endBasis)) + '</dl>' +
          '<dl class="kv">' + kv('Schedule E line 28', money(row.ordAllowed)) + kv('Interest → 2b, dividends → 3a/3b', money(n(e.interest) + n(e.ordDiv))) + kv('Capital gains → Schedule D', money(n(e.stcg) + n(e.ltcg))) + kv('§1231 → Form 4797', money(e.sec1231)) + kv('§199A QBI / W-2 / UBIA', money(e.qbi) + ' / ' + money(e.w2) + ' / ' + money(e.ubia)) + '</dl></div></div>';
      }
      h += '<h2>Where K-1 items go</h2><div class="tablewrap"><table class="t"><thead><tr><th>Box</th><th>Item</th><th class="n">Total</th><th>1040 destination</th></tr></thead><tbody>' +
        [['1–3, 4, 7, 11', 'Ordinary, rental, guaranteed payments, royalties, other', sum(K.rows, (r) => r.ord), 'Schedule E line 28 (passive or nonpassive) → S1-5'], ['5', 'Interest', K.interest, 'Line 2b'], ['6a / 6b', 'Ordinary / qualified dividends', K.ordDiv, 'Lines 3b / 3a'], ['8 / 9a', 'Short / long-term capital gain', K.stcg + K.ltcg, 'Schedule D lines 5 / 12'],
          ['9b / 9c', 'Collectibles / unrecaptured §1250', K.collect + K.unrecap, 'Schedule D worksheets (lines 18 / 19)'], ['10', 'Net §1231 gain (loss)', K.sec1231, 'Form 4797 Part I'], ['13', 'Charitable contributions', K.charity, 'Schedule A line 11–12'], ['14A', 'Self-employment earnings', K.se, 'Schedule SE line 2'],
          ['16 / 21', 'Foreign taxes', K.ftc, 'Schedule 3 line 1'], ['17', 'AMT items', K.amt, 'Form 6251'], ['20Z', '§199A information', sum(K.rows, (r) => n(r.qbi)), 'Form 8995 / 8995-A']].map(([b, t, v, d]) => '<tr><td class="line">' + b + '</td><td>' + t + '</td>' + cellNum(v) + '<td class="small">' + d + '</td></tr>').join('') + '</tbody></table></div>';
      h += '<h2>Checks</h2>' + checksList(K.checks);
      return h;
    };

    V['m-qbi'] = () => {
      const c = C(); const w = walk(); const cols = w.cols; const r = cols[0].r; const q = r.q;
      let h = modHead('QBI workbench', 'The §199A deduction for each column, built from Schedule C, K-1 box 20Z, qualifying rentals and REIT / PTP income. Above the threshold the W-2 wage and UBIA limits phase in and specified service businesses phase out.');
      h += feedStrip([['qbiDed', '13a'], ['qbiCarry', '8995-3'], ['reitPtp', '8995-6']]);
      h += '<div class="tiles" style="margin-bottom:14px">' + tile('Taxable income before QBI', money(r.agi - r.f.l12 - r.f.l13b)) + tile('Threshold (' + r.year + ')', money(q.thr), q.overThreshold ? (q.pct >= 1 ? 'fully phased in' : Math.round(q.pct * 100) + '% into the phase-in range of ' + money(q.range)) : 'below — 20% of QBI') + tile('Overall limit (20% of TI less net capital gain)', money(q.limit)) + tile('QBI deduction', money(r.f.l13a), q.typed ? 'typed on the walk' : (q.minApplied ? '$400 minimum applied' : '')) + '</div>';
      h += '<div class="tablewrap"><table class="t"><thead><tr><th>Business</th><th>Source</th><th class="n">QBI</th><th class="n">After loss netting / SSTB</th><th class="n">W-2 wages</th><th class="n">UBIA</th><th class="n">20% of QBI</th><th class="n">Wage / UBIA limit</th><th class="n">Component</th></tr></thead><tbody>' +
        (q.rows.length ? q.rows.map((x) => '<tr><td>' + esc(x.name) + (x.sstb ? ' <span class="chip warn">SSTB</span>' : '') + '</td><td class="small">' + ({ schC: 'Schedule C', k1: 'K-1', rent: 'Rental' }[x.src] || x.src) + '</td>' + cellNum(x.qbi) + cellNum(x.adjQbi) + cellNum(x.w2) + cellNum(x.ubia) + cellNum(x.twenty) + cellNum(x.lim) + cellNum(x.comp) + '</tr>').join('') : '<tr><td colspan="9" class="muted small">No qualified business income.</td></tr>') +
        '<tr class="total"><td colspan="8">Combined QBI component' + (q.netQbi <= 0 ? ' (net QBI is a loss)' : '') + '</td>' + cellNum(q.combined) + '</tr><tr><td colspan="8">REIT dividends and PTP income × 20%</td>' + cellNum(q.reit) + '</tr></tbody></table></div>';
      h += '<div class="form" style="margin-top:14px;max-width:620px"><label class="field">Qualified business loss carryforward from prior years' + num(cp('mod.qbi.carry'), (c.mod.qbi || {}).carry) + '<span class="hint">Reduces this year\'s QBI (§199A(c)(2))</span></label></div>';
      h += '<h2>By column</h2><div class="tablewrap"><table class="t"><thead><tr><th>Column</th><th class="n">TI before QBI</th><th class="n">Net QBI</th><th class="n">Limit</th><th class="n">Deduction</th></tr></thead><tbody>' + cols.map((x) => '<tr><td>' + esc(x.col.name) + '</td>' + cellNum(x.r.agi - x.r.f.l12 - x.r.f.l13b) + cellNum(x.r.q.netQbi) + cellNum(x.r.q.limit) + cellNum(x.r.f.l13a) + '</tr>').join('') + '</tbody></table></div>';
      h += '<p class="small muted" style="margin-top:10px">Rental real estate counts only when it rises to a §162 trade or business or meets the Rev. Proc. 2019-38 safe harbor; mark it on the Rents & royalty module. Aggregation under Reg. §1.199A-4 is modeled on the <a href="#r-469">Rental election</a> page.</p>';
      return h;
    };

    V['m-itemized'] = () => {
      const c = C(); const w = walk(); const cols = w.cols; const r = cols[0].r; const a = r.a; const m = c.mod.itemized; const P = (k) => cp('mod.itemized.' + k);
      const f = (k, lab, hint) => '<label class="field">' + esc(lab) + num(P(k), m[k] == null ? '' : m[k], { label: lab }) + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</label>';
      let h = modHead('Itemized deductions', 'Schedule A inputs. The engine applies the 7.5% medical floor, the SALT cap and its phase-down above ' + money(TM.params(r.year, r.status).saltThr) + ' of MAGI, the charitable AGI limits, the mortgage debt limit and, from 2026, the 0.5% charitable floor and the 2/37 limit for the 37% bracket.');
      h += '<div class="panel pad"><div class="form">' + f('medical', 'Medical and dental expenses') + f('stateTax', 'State and local income taxes') + f('salesTax', 'General sales taxes (if elected)') +
        '<label class="field" style="flex-direction:row;gap:8px;align-items:center">' + check(P('useSalesTax'), m.useSalesTax, 'Use sales tax') + ' Deduct sales tax instead of income tax</label>' +
        f('realEstateTax', 'Real estate taxes') + f('persPropTax', 'Personal property taxes') + f('mortgageInt', 'Home mortgage interest (Form 1098)') + f('points', 'Points not on a 1098') + f('avgDebt', 'Average acquisition debt', 'Interest is limited above $750,000 ($1,000,000 for pre-12/16/2017 debt)') +
        '<label class="field" style="flex-direction:row;gap:8px;align-items:center">' + check(P('debtPre2018'), m.debtPre2018, 'Grandfathered debt') + ' Debt incurred before December 16, 2017</label>' +
        f('invInt', 'Investment interest expense', 'Form 4952; limited to net investment income') + f('charityCash', 'Cash gifts to charity') + f('charityNoncash', 'Noncash gifts (appreciated property)') + f('charityCarry', 'Charitable carryover from prior years') + f('casualty', 'Casualty losses (federally declared disaster)') + f('other', 'Other itemized deductions') +
        '<label class="field" style="flex-direction:row;gap:8px;align-items:center">' + check(P('forceItemize'), m.forceItemize, 'Itemize anyway') + ' Itemize even if less than the standard deduction</label></div></div>';
      h += '<h2>Schedule A <span class="sub">' + esc(cols[0].col.name) + '</span></h2><div class="grid2"><div class="panel pad"><dl class="kv">' + kv('Medical after 7.5% of AGI', money(a.l4)) + kv('State and local taxes paid', money(a.l5d)) + kv('SALT cap this year', money(a.cap)) + kv('SALT deducted', money(a.l5e)) + kv('Mortgage interest', money(a.l8a)) + kv('Investment interest allowed', money(a.l9)) + '</dl></div>' +
        '<div class="panel pad"><dl class="kv">' + kv('Charitable gifts allowed', money(a.charity)) + kv('Carried forward (over AGI limits)', money(a.charityCarry)) + kv('2/37 limitation (2026)', money(-a.limit)) + kv('Total itemized', money(a.l17)) + kv('Standard deduction', money(a.std)) + kv('Method used', a.method) + '</dl></div></div>';
      h += '<h2>By column</h2><div class="tablewrap"><table class="t"><thead><tr><th>Column</th><th class="n">SALT deducted</th><th class="n">Charity</th><th class="n">Itemized</th><th class="n">Standard</th><th>Method</th><th class="n">Line 12</th></tr></thead><tbody>' + cols.map((x) => '<tr><td>' + esc(x.col.name) + '</td>' + cellNum(x.r.a.l5e) + cellNum(x.r.a.charity) + cellNum(x.r.a.l17) + cellNum(x.r.a.std) + '<td>' + x.r.a.method + '</td>' + cellNum(x.r.f.l12) + '</tr>').join('') + '</tbody></table></div>';
      if (walk().feeds.detail.it.mortgageLimited > 0) h += '<p class="small muted">' + money(walk().feeds.detail.it.mortgageLimited) + ' of mortgage interest is on debt above the limit and is not deductible (§163(h)(3)(F)).</p>';
      return h;
    };

    /* ================= TAX SCENARIOS & ESTIMATES ================= */
    V.scen = () => {
      const c = C(); const w = walk(); const base0 = w.cols[0]; const sc = c.scen || (c.scen = { growth: 0.03, scenarios: [{ name: 'Baseline', levers: {} }] });
      const proj = !!sc.project; const year = proj ? Math.min(2026, base0.col.year + 1) : base0.col.year;
      const ctx = Object.assign({}, TM.clientCtx(c, year, c.info.status), { qbiItems: w.feeds.items });
      const bx = proj ? TM.project(w.baseX, sc.growth) : w.baseX;
      const res = sc.scenarios.map((s) => { const x = TM.applyLevers(bx, s.levers); const r = TM.computeReturn(x, ctx); r.marginal = TM.marginal(x, ctx, r); r.cash = sum(TM.LEVERS.filter((l) => l.key !== 'extraEst' && l.key !== 'deferIncome'), (l) => (l.op === 'set' ? Math.max(0, n(s.levers[l.key]) - n(bx[l.leaf])) : l.key === 'roth' || l.key === 'harvest' ? 0 : n(s.levers[l.key]))); return { s, r }; });
      const b = res[0].r;
      let h = head('Modules · ' + clientLabel(c), 'Tax scenarios & estimates', 'Compare planning moves side by side on ' + (proj ? 'a TY' + year + ' projection' : 'the TY' + year + ' return') + '. Every scenario starts from the base column of the 1040 walk and is figured with the same engine. Send a scenario to the walk to see it line by line.', '<a class="btn" href="#walk">Open 1040 walk</a>');
      h += '<div class="form" style="margin-bottom:14px;grid-template-columns:repeat(auto-fit,minmax(200px,260px))"><label class="field">Starting point' + selectBind(cp('scen.project'), String(proj), [['false', 'TY' + base0.col.year + ' return (what-if)'], ['true', 'TY' + Math.min(2026, base0.col.year + 1) + ' projection']], { bool: true }) + '</label>' +
        (proj ? '<label class="field">Income growth' + inputNum(cp('scen.growth'), sc.growth, { pct: true, dp: 1 }) + '</label>' : '') + '</div>';
      h += '<div class="tablewrap"><table class="t"><thead><tr><th style="min-width:230px">Planning move</th>' + res.map((x, i) => '<th class="n" style="min-width:150px">' + (i === 0 ? 'Baseline' : '<span style="display:inline-flex;gap:4px;align-items:center">Scenario ' + (i + 1) + '<button class="btn small ghost" data-action="del-scen" data-val="' + i + '" aria-label="Remove ' + esc(x.s.name) + '" title="Remove scenario">×</button></span>') + '</th>').join('') + '</tr></thead><tbody>';
      h += '<tr><td>Scenario name</td>' + sc.scenarios.map((x, i) => '<td>' + inputText(cp('scen.scenarios.' + i + '.name'), x.name, { label: 'Scenario name' }) + '</td>').join('') + '</tr>';
      TM.LEVERS.forEach((lv) => {
        h += '<tr><td>' + esc(lv.label) + '<div class="muted small">' + esc(lv.hint) + '</div></td>' + sc.scenarios.map((x, i) => '<td class="n">' + (i === 0 ? '<span class="muted small">' + (lv.op === 'set' ? money(bx[lv.leaf]) : '—') + '</span>' : inputNum(cp('scen.scenarios.' + i + '.levers.' + lv.key), x.levers[lv.key] == null ? '' : x.levers[lv.key], { label: lv.label + ' for ' + x.name })) + '</td>').join('') + '</tr>';
      });
      const row = (t, fn, o) => { o = o || {}; return '<tr class="' + (o.total ? 'total' : '') + '"><td>' + t + '</td>' + res.map((x) => (o.fmt ? '<td class="n">' + o.fmt(x.r) + '</td>' : cellNum(fn(x.r)))).join('') + '</tr>'; };
      h += '<tr><td colspan="' + (res.length + 1) + '" class="secrow">Results</td></tr>';
      h += row('Adjusted gross income', (r) => r.agi) + row('Deduction', null, { fmt: (r) => fmtNum(r.f.l12) + ' <span class="muted small">' + r.a.method.toLowerCase() + '</span>' }) + row('QBI deduction', (r) => r.f.l13a) + row('Taxable income', (r) => r.f.l15) +
        row('Income tax (line 16)', (r) => r.f.l16) + row('Alternative minimum tax', (r) => r.amt.amt) + row('Self-employment tax', (r) => r.se.tax) + row('Net investment income tax', (r) => r.s2.l12) + row('Credits', (r) => r.f.l21 + r.f.l28) +
        row('Total tax (line 24)', (r) => r.f.l24, { total: true }) + row('Change from baseline', (r) => r.f.l24 - b.f.l24) + row('Marginal rate on the next $1,000', null, { fmt: (r) => pct(r.marginal, 1) }) +
        row('Capital loss carried forward', (r) => -r.d.carryforward) + row('Refund (+) or balance due (−)', (r) => r.net);
      h += '<tr><td></td>' + res.map((x, i) => '<td class="n">' + (i === 0 ? '' : '<button class="btn small" data-action="scen-to-walk" data-val="' + i + '"' + (w.cols.length >= MAX_COLS ? ' disabled title="The walk already has 5 planning columns"' : '') + '>Send to 1040 walk</button>') + '</td>').join('') + '</tr>';
      h += '</tbody></table></div>';
      h += '<p style="margin:10px 0 0;display:flex;gap:8px;flex-wrap:wrap">' + (sc.scenarios.length < 6 ? '<button class="btn small" data-action="add-scen">Add scenario</button>' : '') + '<button class="btn small" data-ask="' + esc('Compare the tax scenarios on screen for ' + clientLabel(c) + ' and recommend which moves to make, with the reasoning and deadlines.') + '">Ask the advisor to compare</button></p>';
      // Estimates
      const plan = nextYearPlan(c, base0.r);
      h += '<h2>TY' + plan.ny + ' estimated payments' + (plan.current ? ' <span class="sub">current year</span>' : '') + '</h2><p class="lede small">' + esc(planNote(c, plan)) + '</p><div class="grid2"><div class="panel pad"><dl class="kv">' +
        (plan.current ? kv('Prior-year tax', money(c.info.priorTax)) + kv('Prior-year AGI', money(c.info.priorAgi)) : kv('TY' + base0.col.year + ' total tax (base)', money(base0.r.f.l24)) + kv('TY' + base0.col.year + ' AGI', money(base0.r.agi))) +
        kv('Prior-year safe harbor (' + Math.round(plan.sh.pct * 100) + '%)', money(plan.sh.prior)) + kv('90% of ' + (plan.current ? '' : 'projected ') + 'TY' + plan.ny + ' tax', money(plan.sh.cur)) + planKv(plan) + '</dl></div>' +
        '<div class="tablewrap"><table class="t"><thead><tr><th>Installment</th><th>Due</th><th class="n">Amount</th></tr></thead><tbody>' + QDATES(plan.ny).map(([d, q]) => '<tr><td>' + q + '</td><td>' + new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + '</td>' + cellNum(plan.sh.quarter) + '</tr>').join('') + '</tbody></table></div></div>';
      h += '<p class="small muted">Due dates shift to the next business day when they fall on a weekend or holiday. Annualized installments (Form 2210 Schedule AI) can lower early payments when income is uneven.</p>';
      return h;
    };

    /* ================= actions ================= */
    function audit(path, from, to, note) { state.audit.push({ ts: new Date().toISOString(), by: 'you', path, from, to, note, noUndo: true }); }
    const uid = () => 'c' + Math.random().toString(36).slice(2, 9);
    function blankClient() {
      return { id: uid(), info: { name: 'New client', tpFirst: '', tpLast: '', status: 'mfj', year: 2026, state: '', baseName: 'Base' }, deps: [], w2: [], other: {},
        mod: { portfolio: { interest: [], dividends: [] }, schC: { businesses: [], sepIra: 0, seHealth: 0 }, capital: { invest: [], business: [], stCarry: 0, ltCarry: 0, priorNonrecap1231: 0 }, equity: { iso: [], nso: [], rsu: [], restricted: [], sales: [], amtCreditPrior: 0 }, rents: { rep: false, properties: [] }, k1: { entities: [] }, itemized: {}, qbi: { carry: 0 } },
        direct: {}, cols: [], scen: { growth: 0.03, scenarios: [{ name: 'Baseline', levers: {} }] }, notes: {} };
    }
    function action(a, t) {
      if (walkUI.action(a, t)) return true;
      const c = C(); const done = () => { api.save(); api.invalidate(); api.render(); return true; };
      if (a === 'add-row') { const arr = getPath(state.data, t.dataset.path); if (!arr) return true; arr.push(JSON.parse(t.dataset.tpl || '{}')); audit(t.dataset.path, null, arr.length, 'Added row'); return done(); }
      if (a === 'del-row') { const arr = getPath(state.data, t.dataset.path); const i = +t.dataset.val; if (!arr) return true; const gone = arr.splice(i, 1)[0]; audit(t.dataset.path + '.' + i, (gone && (gone.name || gone.desc || gone.payer || gone.lotId)) || 'row', null, 'Removed row'); state.ui.sel = {}; return done(); }
      if (a === 'sel-row') { state.ui.sel = state.ui.sel || {}; const k = t.dataset.key, v = +t.dataset.val; state.ui.sel[k] = state.ui.sel[k] === v ? null : v; api.render(); return true; }
      if (a === 'new-client' || a === 'dup-client') { const nc = a === 'new-client' ? blankClient() : JSON.parse(JSON.stringify(c)); if (a === 'dup-client') { nc.id = uid(); nc.info.name = clientLabel(c) + ' (copy)'; } tmData().clients.push(nc); tmData().active = nc.id; audit('tm.clients', null, nc.info.name, a === 'new-client' ? 'New client' : 'Duplicated client'); api.go('client'); return done(); }
      if (a === 'del-client') { state.ui.confirmDelClient = true; api.render(); return true; }
      if (a === 'del-client-no') { state.ui.confirmDelClient = false; api.render(); return true; }
      if (a === 'del-client-yes') { const t2 = tmData(); const i = ci(); const gone = t2.clients.splice(i, 1)[0]; t2.active = t2.clients[0].id; state.ui.confirmDelClient = false; audit('tm.clients', gone.info.name, null, 'Deleted client'); return done(); }
      if (a === 'base-year') { api.applyChange(cp('info.year'), +t.dataset.val, 'you'); api.render(); return true; }
      if (a === 'walk-col') { state.ui.walkCol = +t.dataset.val; api.render(); return true; }
      if (a === 'add-col') {
        if (c.cols.length >= MAX_COLS - 1) return true;
        const src = t.dataset.val === 'dup' && state.ui.walkCol > 0 ? c.cols[state.ui.walkCol - 1] : null;
        const col = src ? JSON.parse(JSON.stringify(src)) : { year: c.info.year, status: c.info.status, ov: {}, lv: {} };
        col.id = uid(); col.name = src ? src.name + ' (copy)' : 'Planning ' + (c.cols.length + 1);
        c.cols.push(col); state.ui.walkCol = c.cols.length; audit(cp('cols'), null, col.name, 'Added planning column'); return done();
      }
      if (a === 'del-col') { const i = +t.dataset.val; const gone = c.cols.splice(i, 1)[0]; state.ui.walkCol = 0; audit(cp('cols'), gone.name, null, 'Removed planning column'); return done(); }
      if (a === 'walk-expand') { state.ui.walkAll = t.dataset.val === '1'; if (!state.ui.walkAll) Object.keys(state.ui.open).forEach((k) => { if (k.startsWith('w:') && k !== 'w:levers') delete state.ui.open[k]; }); api.render(); return true; }
      if (a === 'walk-notes') { state.ui.walkNotes = !state.ui.walkNotes; api.render(); return true; }
      if (a === 'calc') { state.ui.calcOpen = !state.ui.calcOpen; api.render(); if (state.ui.calcOpen) { const el = document.getElementById('calcIn'); if (el) el.focus(); } return true; }
      if (a === 'undo-last') { for (let i = state.audit.length - 1; i >= 0; i--) { const x = state.audit[i]; if (!x.undone && !x.noUndo && x.note !== 'Undo') { api.undo(i); api.toast('Undid ' + api.label(x.path) + '.'); return true; } } api.toast('Nothing to undo.'); return true; }
      if (a === 'add-scen') { const sc = c.scen.scenarios; sc.push({ name: 'Scenario ' + (sc.length + 1), levers: {} }); audit(cp('scen.scenarios'), null, sc.length, 'Added scenario'); return done(); }
      if (a === 'del-scen') { const i = +t.dataset.val; if (i > 0) { const gone = c.scen.scenarios.splice(i, 1)[0]; audit(cp('scen.scenarios'), gone.name, null, 'Removed scenario'); } return done(); }
      if (a === 'scen-to-walk') {
        if (c.cols.length >= MAX_COLS - 1) { api.toast('The walk already has 5 planning columns.'); return true; }
        const s = c.scen.scenarios[+t.dataset.val]; const proj = !!c.scen.project;
        const col = { id: uid(), name: s.name, year: proj ? Math.min(2026, c.info.year + 1) : c.info.year, status: c.info.status, ov: {}, lv: JSON.parse(JSON.stringify(s.levers)), growth: proj ? c.scen.growth : 0 };
        c.cols.push(col); state.ui.walkCol = c.cols.length; audit(cp('cols'), null, col.name, 'Scenario sent to the 1040 walk'); api.save(); api.invalidate(); api.go('walk'); return true;
      }
      return false;
    }
    function onChange(el) {
      if (el.dataset.totalSource != null) {
        const raw = el.value.trim();
        const entered = raw === '' ? undefined : api.parseVal('num', raw);
        if (entered === null) { api.toast('Enter a number, for example 12500 or (1,200).'); el.focus(); return true; }
        api.applyChange(el.dataset.bind, entered === undefined ? undefined : entered - Number(el.dataset.totalSource), 'you', 'Form 1040 source adjustment');
        api.render(); return true;
      }
      if (el.dataset.clientPick) { tmData().active = el.value; state.ui.walkCol = 0; state.ui.sel = {}; api.save(); api.invalidate(); api.render(); return true; }
      if (el.dataset.actionCheck) { const k = el.dataset.actionCheck; state.ui[k] = k === 'walkAuth' ? el.checked : el.checked; api.render(); return true; }
      return false;
    }
    function onInput(el) {
      if (el.id === 'calcIn') {
        state.ui.calcExpr = el.value;
        let out = '';
        try { if (el.value.trim()) { const v = window.Engine.evalFormula(el.value.replace(/[$,]/g, ''), () => 0); out = '= ' + (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v)); } } catch (e) { out = 'Not a valid expression'; }
        state.ui.calcOut = out; const o = document.getElementById('calcOut'); if (o) o.textContent = out;
        return true;
      }
      return false;
    }

    const NAV = [
      { group: 'Overview', items: [['home', 'Summary dashboard'], ['client', 'Client info'], ['walk', 'Form 1040 walk']] },
      { group: 'Modules', items: [['m-portfolio', 'Portfolio income'], ['m-schc', 'Schedule C — Business income'], ['m-capital', 'Capital transactions'], ['m-rents', 'Rents & royalty'], ['m-k1', 'Passthrough income (K-1)'], ['scen', 'Tax scenarios & estimates'], ['m-qbi', 'QBI workbench'], ['r-469', 'Rental election & ownership'], ['m-itemized', 'Itemized deductions']] },
      { group: 'Wealth strategy', items: [['h-dash', 'Wealth strategy dashboard'], ['h-matrix', 'Strategy matrix'], ['h-cost', 'Cost-benefit & package'], ['h-check', 'Implementation checklist']] },
      { group: 'Review & compliance', items: [['c-home', 'Compliance dashboard'], ['w-tie', 'Form 1040 tie-out'], ['findings', 'Review findings'], ['calendar', 'Filing calendar'], ['w-sources', 'Source documents'], ['w-sched', 'Schedules'], ['w-review', 'Review & sign-off'], ['r-props', 'Rental properties'], ['r-199a', 'Rental return positions'], ['r-statements', 'Election statements']] },
    ];
    return { VIEWS: V, NAV, action, onChange, onInput, clientLabel, active: C, walkRows: WALK, rowVal, explainLine: walkUI.explainLine, afterRender: walkUI.afterRender, onKeydown: (e) => { if (e.key === 'Enter' && e.target.id === 'calcIn') { e.preventDefault(); walkUI.evaluate(); return true; } return false; } };
  };
})();
