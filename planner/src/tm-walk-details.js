/* Form 1040 line explanations and editors. Uses the same client records and
   calculation results as the walk; local explanations never require an API. */
(function () {
  'use strict';
  window.TMWalkUI = function (api) {
    const { state, esc, money, pct, inputNum, selectBind, rowVal, rowStatus } = api;
    const TM = window.TM;
    const flatten = (rows) => rows.flatMap((row) => row.s ? [] : [row].concat(row.sub ? flatten(row.sub) : []));
    const rows = flatten(api.rows);
    const find = (key) => rows.find((row) => row.k === key);
    const activeIndex = () => Math.min(state.ui.walkCol || 0, api.walk().cols.length - 1);
    const path = (j, suffix) => api.clientPath(j ? 'cols.' + (j - 1) + '.' + suffix : suffix);
    const title = (row, r) => typeof row.d === 'function' ? row.d(r) : row.d;
    const number = (label, value) => '<div><dt>' + esc(label) + '</dt><dd>' + money(value) + '</dd></div>';
    const STATUSES = { ok: 'OK — computed from the data entered', est: 'EST — planned, projected or manually adjusted', inc: 'INC — review the module or diagnostic', err: 'ERR — inconsistent input needs review' };
    const optionalNumber = (p, value, label) => '<input class="cell" inputmode="decimal" data-bind="' + esc(p) + '" data-type="numopt" id="in-' + esc(p) + '" value="' + esc(value == null ? '' : value) + '" aria-label="' + esc(label) + '">';

    function explainLine(key, columnIndex) {
      const row = find(key); if (!row) return null;
      const w = api.walk(), j = columnIndex == null ? activeIndex() : Math.max(0, Math.min(+columnIndex, w.cols.length - 1));
      const x = w.cols[j], r = x.r, c = api.client(), value = rowVal(row, r);
      const status = rowStatus(row, x, w.cols[0], w.feeds.detail, j);
      const detail = [];
      const sources = [];
      const add = (label, val) => { if (Number.isFinite(+val)) detail.push({ label, value: +val }); };
      if (row.leaf === 'wages') (c.w2 || []).forEach((v) => sources.push({ label: v.employer || v.who || 'W-2', value: TM.n(v.wages) }));
      if (['taxableInt', 'taxExemptInt'].includes(row.leaf)) {
        ((c.mod.portfolio || {}).interest || []).forEach((v) => sources.push({ label: v.payer || 'Interest ledger', value: TM.n(v[row.leaf === 'taxableInt' ? 'taxable' : 'exempt']) }));
      }
      if (['ordDiv', 'qualDiv'].includes(row.leaf)) {
        ((c.mod.portfolio || {}).dividends || []).forEach((v) => sources.push({ label: v.payer || 'Dividend ledger', value: TM.n(v[row.leaf === 'ordDiv' ? 'ordinary' : 'qualified']) }));
      }
      if (row.leaf === 'schC') w.feeds.detail.sc.rows.forEach((v) => sources.push({ label: v.name || 'Schedule C', value: v.l31 }));
      (row.sub || []).forEach((v) => add(title(v, r), rowVal(v, r)));
      const specifics = {
        l1z: [['W-2 wages', r.f.l1a], ['Other earned income', r.f.l1h]],
        l6b: [['Social Security benefits', r.f.l6a], ['Taxable benefits', r.f.l6b]],
        l7: [['Short-term net gain / loss', r.d.l7], ['Long-term net gain / loss', r.d.l15], ['Net capital gain / loss', r.d.l16]],
        l9: [['Earned income', r.f.l1z], ['Taxable interest', r.f.l2b], ['Ordinary dividends', r.f.l3b], ['IRA distributions', r.f.l4b], ['Pensions', r.f.l5b], ['Taxable Social Security', r.f.l6b], ['Capital gain / loss', r.f.l7], ['Schedule 1 income', r.f.l8]],
        l11: [['Total income, line 9', r.f.l9], ['Adjustments, line 10', r.f.l10]],
        l12: [['Standard deduction', r.a.std], ['Allowed itemized deductions', r.a.l17], ['Deduction used', r.f.l12]],
        l13a: [['Qualified business income deduction', r.f.l13a]],
        l14: [['Standard / itemized deductions', r.f.l12], ['QBI deduction', r.f.l13a], ['Schedule 1-A deductions', r.f.l13b]],
        l15: [['Adjusted gross income', r.agi], ['Total deductions', r.f.l14]],
        l16: [['Taxable income', r.f.l15], ['Regular income tax', r.f.l16]],
        l17: [['AMTI', r.amt.amti], ['Exemption after phase-out', r.amt.exemption], ['Tentative minimum tax', r.amt.tmt], ['Regular tax less FTC', r.amt.regular], ['AMT', r.amt.amt]],
        l18: [['Regular income tax', r.f.l16], ['Alternative minimum tax', r.f.l17]],
        l22: [['Tax before credits', r.f.l18], ['Child / dependent credits', r.f.l19], ['Other nonrefundable credits', r.f.l20]],
        l24: [['Income tax after credits', r.f.l22], ['Other taxes', r.f.l23]],
        l33: [['Withholding', r.f.l25d], ['Estimated payments', r.f.l26], ['Additional child tax credit', r.f.l28], ['Other payments / refundable credits', r.f.l31]],
        l34: [['Total payments', r.f.l33], ['Total tax', r.f.l24]],
        l37: [['Total tax', r.f.l24], ['Total payments', r.f.l33]],
      };
      (specifics[row.k] || []).forEach(([label, val]) => { if (!detail.some((v) => v.label === label)) add(label, val); });
      const planningKey = { sepIra: 'retirement', hsa: 'hsa', iraDed: 'ira' }[row.leaf];
      const planning = planningKey && x.planning && x.planning[planningKey];
      if (planning && planning.configured) {
        if (planningKey === 'retirement') [['Earned income base', 'base'], ['Employee deferral', 'employee'], ['Employer contribution', 'employer'], ['Catch-up contribution', 'catchup'], ['Allowed deduction', 'allowed']].forEach(([label, k]) => add(label, planning[k]));
        if (planningKey === 'hsa') [['Annual limit', 'limit'], ['Employer contributions', 'employerContributions'], ['Entered contribution', 'requested'], ['Allowed deduction', 'allowed'], ['Excess contribution', 'excess']].forEach(([label, k]) => add(label, planning[k]));
        if (planningKey === 'ira') [['Contribution ceiling', 'contributionCeiling'], ['Entered contribution', 'requested'], ['Deductible contribution', 'deductible'], ['Nondeductible contribution', 'nondeductible'], ['IRA MAGI', 'magi'], ['Excess contribution', 'excess']].forEach(([label, k]) => add(label, planning[k]));
      }
      let how = row.leaf ? 'The amount is built from the client inputs and source module for this line.' : 'The engine calculates this line from the return amounts shown below.';
      const adjustment = j ? TM.n(x.col.adjustments && x.col.adjustments[row.leaf]) : TM.n(c.adjustments && c.adjustments[row.leaf]);
      const overridden = row.leaf && (j ? (x.col.ov || {})[row.leaf] != null : (c.direct || {})[row.leaf] != null);
      if (row.leaf && x.sourceX) add('Source subtotal before this column’s adjustment', x.sourceX[row.leaf]);
      if (adjustment) { add('Direct adjustment to the source subtotal', adjustment); how += ' The entered adjustment is added to the source subtotal; the underlying ledger rows remain intact.'; }
      if (overridden) how = 'A saved manual total overrides this line. Clear the total to use the source module and its adjustments.';
      if (planning && planning.configured) how = 'The selected election is recomputed for this column’s tax year, filing status, age and earnings. Entered contributions and allowed amounts are shown separately.';
      if (j) how += ' This explanation is for ' + x.col.name + ', not the base column.';
      const diagnostics = r.diag.filter((d) => String(d.line) === String(row.ln) || (row.k === 'l17' && /6251|AMT/.test(d.text)));
      const changes = [];
      if (row.leaf) changes.push('Edit the amount in this column. Clear it to return to the source calculation.');
      if (planningKey) changes.push('Change the inline ' + planningKey + ' election or contribution controls.');
      if (row.mod) changes.push('Open Details to review and edit the supporting source module.');
      if (row.sub) changes.push('Expand this line to inspect its contributing schedules.');
      return { lineKey: row.k, line: row.ln, label: title(row, r), value, status: STATUSES[status], how, authority: row.a ? 'IRC ' + row.a : 'Form 1040 line arithmetic', details: detail, sources: sources.filter((v) => v.value !== 0), diagnostics, changes, column: x.col.name, columnIndex: j, year: x.col.year, filingStatus: x.col.status, client: c.info.name, module: row.mod || null };
    }

    const infoRows = (items) => '<dl class="tm-explain-list">' + items.map((v) => number(v.label, v.value)).join('') + '</dl>';
    function explanation(e) {
      return '<p class="tm-line-figure">' + money(e.value) + '</p><p><strong>Status</strong><br>' + esc(e.status) + '</p>' +
        '<h3>How the app got it</h3><p>' + esc(e.how) + '</p>' + (e.sources.length ? '<h3>Source detail</h3>' + infoRows(e.sources) : '') +
        (e.details.length ? '<h3>Calculation detail</h3>' + infoRows(e.details) : '') + '<h3>Authority</h3><p>' + esc(e.authority) + '</p>' +
        (e.diagnostics.length ? '<h3>Review items</h3><ul>' + e.diagnostics.map((d) => '<li>' + esc(d.text) + '</li>').join('') + '</ul>' : '') +
        '<h3>What changes this line</h3><ul>' + e.changes.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>';
    }
    function renderPanel() {
      const p = state.ui.walkPanel; if (!p) return '';
      const row = find(p.key), e = explainLine(p.key, p.column); if (!row || !e) return '';
      const moduleView = row.mod && api.modViews[row.mod];
      let body = explanation(e);
      if (p.kind === 'details' && moduleView) {
        if (e.columnIndex === 0) body = '<p class="tm-inline-hint">These source records feed the base return and every planning column. Scenario-only changes belong in that column’s amount or election controls.</p><div class="tm-module-detail">' + api.renderModule(moduleView) + '</div>';
        else body = '<p class="tm-inline-hint">' + esc(e.column) + ' uses the shared client source records. Change this column’s controls on the walk to test a planning adjustment.</p>' + explanation(e) + '<a class="btn" href="#' + moduleView + '">Open shared source module</a>';
      }
      return '<dialog class="tm-dialog" id="walkDetail" aria-labelledby="walkDetailTitle"><header class="tm-dialog-head"><div><div class="eyebrow">' + esc(e.column) + ' · TY' + e.year + '</div><h2 id="walkDetailTitle">Line ' + esc(e.line) + ' · ' + esc(e.label) + '</h2></div><button class="btn" data-action="walk-panel-close" aria-label="Close line detail">Close</button></header><div class="tm-dialog-body">' + body + '</div><footer class="tm-dialog-head"><span class="small muted">Based on the active return’s calculated data.</span><button class="btn primary" data-action="walk-line-ai" data-key="' + esc(row.k) + '" data-column="' + e.columnIndex + '">Ask AI about this line</button></footer></dialog>';
    }
    function rowActions(row) {
      return '<span class="tm-line-actions"><button class="btn small ghost" data-action="walk-explain" data-key="' + esc(row.k) + '" aria-label="Explain line ' + esc(row.ln) + '">Explain</button>' +
        (row.mod ? '<button class="btn small ghost" data-action="walk-detail" data-key="' + esc(row.k) + '" aria-label="Details for line ' + esc(row.ln) + '">Details</button>' : '') +
        '<button class="btn small ghost" data-action="walk-line-ai" data-key="' + esc(row.k) + '" aria-label="Ask AI about line ' + esc(row.ln) + '">Ask AI</button></span>';
    }
    function controls(row, result, j) {
      const key = { sepIra: 'retirement', hsa: 'hsa', iraDed: 'ira' }[row.leaf]; if (!key) return '';
      const client = api.client(), base = (client.elections || {})[key] || {}, own = j ? ((result.col.elections || {})[key] || {}) : base;
      const cfg = Object.assign({}, base, own), p = path(j, 'elections.' + key + '.');
      const detail = result.planning && result.planning[key];
      const field = (label, html) => '<label>' + esc(label) + html + '</label>';
      let h = '<div class="tm-line-controls" aria-label="' + key + ' controls for ' + esc(result.col.name) + '">';
      if (key === 'retirement') {
        h += field('Plan', selectBind(p + 'plan', cfg.plan || '', [['', 'Use entered amount'], ['none', 'None'], ['sep', 'SEP-IRA'], ['solo401k', 'Solo 401(k)'], ['simple3', 'SIMPLE · 3% match'], ['simple2', 'SIMPLE · 2% employer'], ['profitshare', 'Profit sharing']], { label: 'Retirement plan for ' + result.col.name }));
        if (cfg.plan && cfg.plan !== 'none') h += field('Age', optionalNumber(p + 'age', cfg.age == null ? (result.ctx.tpAge || 45) : cfg.age, 'Retirement age for ' + result.col.name)) +
          field('Employee deferral', optionalNumber(p + 'deferral', cfg.deferral, 'Employee deferral for ' + result.col.name)) + '<span class="tm-inline-hint">Blank uses the annual maximum; enter 0 for no employee deferral.</span>';
      } else if (key === 'hsa') {
        h += field('Contribution', selectBind(p + 'mode', cfg.mode || '', [['', 'Use entered amount'], ['off', 'None'], ['max', 'Maximum'], ['manual', 'Manual']], { label: 'HSA contribution mode for ' + result.col.name }));
        if (cfg.mode && cfg.mode !== 'off') h += field('HDHP coverage', selectBind(p + 'coverage', cfg.coverage || 'self', [['self', 'Self-only'], ['family', 'Family']], { label: 'HSA coverage for ' + result.col.name })) +
          field('Age', optionalNumber(p + 'age', cfg.age == null ? (result.ctx.tpAge || 45) : cfg.age, 'HSA age for ' + result.col.name)) +
          field('Employer contribution', inputNum(p + 'employerContributions', cfg.employerContributions || 0, { label: 'Employer HSA contribution for ' + result.col.name })) +
          (cfg.mode === 'manual' ? field('Your contribution', inputNum(p + 'amount', cfg.amount || 0, { label: 'Manual HSA contribution for ' + result.col.name })) : '');
      } else {
        h += field('IRA treatment', selectBind(p + 'mode', cfg.mode || '', [['', 'Use entered amount'], ['off', 'None'], ['deductible', 'Calculate deduction'], ['nondeductible', 'Nondeductible']], { label: 'IRA treatment for ' + result.col.name }));
        if (cfg.mode && cfg.mode !== 'off') h += field('Contribution', optionalNumber(p + 'amount', cfg.amount, 'IRA contribution for ' + result.col.name)) +
          field('Age', optionalNumber(p + 'age', cfg.age == null ? (result.ctx.tpAge || 45) : cfg.age, 'IRA age for ' + result.col.name)) +
          field('Covered at work', selectBind(p + 'covered', String(cfg.covered == null && detail ? detail.covered : !!cfg.covered), [['false', 'No'], ['true', 'Yes']], { bool: true, label: 'IRA workplace coverage for ' + result.col.name })) +
          field('Spouse covered', selectBind(p + 'spouseCovered', String(cfg.spouseCovered == null && detail ? detail.spouseCovered : !!cfg.spouseCovered), [['false', 'No'], ['true', 'Yes']], { bool: true, label: 'Spouse workplace coverage for ' + result.col.name })) + '<span class="tm-inline-hint">Blank contribution uses the eligible maximum. Workplace coverage can reduce the deduction.</span>';
      }
      if (detail && detail.configured) {
        h += '<span class="tm-inline-hint">Allowed: ' + money(key === 'ira' ? detail.deductible : detail.allowed) +
          (key === 'ira' && detail.nondeductible ? ' · nondeductible: ' + money(detail.nondeductible) : '') +
          (detail.excess ? ' · excess: ' + money(detail.excess) : '') + '</span>' + (detail.assumption ? '<span class="tm-inline-hint">' + esc(detail.assumption) + '</span>' : '');
      }
      return h + '</div>';
    }
    function sectionNav() {
      const current = state.ui.walkSection || 'all';
      return '<nav class="panel pad tm-section-nav" aria-label="Form 1040 sections"><h3>Form sections</h3>' + [['all', 'Entire return'], ['Income', 'Income & adjustments'], ['Deductions', 'Deductions'], ['Tax and credits', 'Tax & credits'], ['Payments and refund', 'Payments & refund']].map(([k, label]) => '<button class="btn small' + (current === k ? ' primary' : ' ghost') + '" data-action="walk-section" data-val="' + esc(k) + '" aria-pressed="' + (current === k) + '">' + label + '</button>').join('') + '</nav>';
    }
    function toolbox(result) {
      const tape = state.ui.calcTape || [];
      let h = '<section class="panel pad tm-toolbox"><h3>Toolbox</h3><button class="btn small" data-action="calc" aria-expanded="' + !!state.ui.calcOpen + '">Calculator</button> <button class="btn small ghost" data-action="walk-notes">Line notes</button>';
      if (state.ui.calcOpen) {
        h += '<label class="field">Expression<input id="calcIn" class="cell txt" aria-label="Expression" value="' + esc(state.ui.calcExpr || '') + '" autocomplete="off"></label><output id="calcOut" class="calc-out">' + esc(state.ui.calcOut || '') + '</output>' +
          '<div class="tm-calc-keys">' + ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '(', '+', ')'].map((v) => '<button class="btn small" data-action="calc-key" data-val="' + v + '">' + v + '</button>').join('') + '<button class="btn small" data-action="calc-clear">C</button><button class="btn small primary" data-action="calc-eval">=</button></div>' +
          '<label class="field">Use a return value<select id="calcMetric" class="cell" aria-label="Calculator return value">' + [['agi', 'AGI'], ['taxable', 'Taxable income'], ['tax', 'Total tax'], ['se', 'SE tax'], ['qbi', 'QBI deduction']].map(([k, label]) => '<option value="' + k + '">' + label + '</option>').join('') + '</select></label><button class="btn small" data-action="calc-metric">Insert value</button>' +
          (tape.length ? '<h4>Calculation tape</h4><ol class="tm-calc-tape">' + tape.slice(-12).map((v) => '<li>' + esc(v.expr) + '<br><b>' + esc(v.result) + '</b></li>').join('') + '</ol><button class="btn small" data-action="calc-note">Tape → notes</button>' : '');
      }
      if ((api.client().notes || {})._calculator) h += '<details><summary>Saved calculation notes</summary><p class="tm-prewrap">' + esc(api.client().notes._calculator) + '</p></details>';
      return h + '</section>';
    }
    function evaluate() {
      try {
        const expr = state.ui.calcExpr || '';
        if (!expr.trim()) return;
        const value = window.Engine.evalFormula(expr.replace(/[$,]/g, ''), () => 0);
        if (!Number.isFinite(value)) throw new Error('Invalid result');
        state.ui.calcOut = '= ' + value.toLocaleString('en-US', { maximumFractionDigits: 2 });
        state.ui.calcTape = (state.ui.calcTape || []).concat({ expr, result: state.ui.calcOut }).slice(-12);
      } catch (_) { state.ui.calcOut = 'Not a valid expression'; }
      api.render();
    }
    function action(a, t) {
      if (a === 'walk-explain' || a === 'walk-detail') {
        state.ui.walkPanel = { kind: a === 'walk-detail' ? 'details' : 'explain', key: t.dataset.key, column: activeIndex() };
        api.render(); return true;
      }
      if (a === 'walk-panel-close') { state.ui.walkPanel = null; api.render(); return true; }
      if (a === 'walk-line-ai') {
        const e = explainLine(t.dataset.key, t.dataset.column == null ? activeIndex() : +t.dataset.column);
        if (e && window.Advisor) {
          state.ui.walkPanel = null; api.render();
          window.Advisor.ask('Explain Form 1040 line ' + e.line + ' — ' + e.label + ' for ' + e.column + '. How was the amount calculated, what authority applies, and what changes it?', e);
        }
        return true;
      }
      if (a === 'walk-section') { state.ui.walkSection = t.dataset.val; api.render(); return true; }
      if (a === 'calc-eval') { evaluate(); return true; }
      if (a === 'calc-key' || a === 'calc-clear' || a === 'calc-metric') {
        const r = api.walk().cols[activeIndex()].r;
        const values = { agi: r.agi, taxable: r.f.l15, tax: r.f.l24, se: r.se.tax, qbi: r.f.l13a };
        const key = document.getElementById('calcMetric');
        const append = a === 'calc-key' ? t.dataset.val : a === 'calc-metric' ? String(values[key ? key.value : 'agi']) : '';
        state.ui.calcExpr = a === 'calc-clear' ? '' : (state.ui.calcExpr || '') + append;
        state.ui.calcOut = ''; api.render(); document.getElementById('calcIn').focus(); return true;
      }
      if (a === 'calc-note') {
        const old = (api.client().notes || {})._calculator || '';
        const lines = (state.ui.calcTape || []).map((v) => v.expr + ' ' + v.result).join('\n');
        api.applyChange(api.clientPath('notes._calculator'), (old ? old + '\n' : '') + lines, 'you', 'Calculator tape saved to notes');
        api.render(); api.toast('Calculation tape saved to client notes.'); return true;
      }
      return false;
    }
    function afterRender() {
      const dialog = document.getElementById('walkDetail');
      if (dialog && !dialog.open) {
        dialog.showModal();
        dialog.addEventListener('cancel', (event) => { event.preventDefault(); state.ui.walkPanel = null; api.render(); });
        dialog.addEventListener('click', (event) => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) { state.ui.walkPanel = null; api.render(); } } });
      }
    }
    return { explainLine, renderPanel, rowActions, controls, sectionNav, toolbox, action, afterRender, evaluate };
  };
})();
