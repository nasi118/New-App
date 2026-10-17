/* Active-client compliance review and client reports. All amounts come from
   TM.walkClient: this module never copies values from the training workbooks. */
(function (root) {
  'use strict';
  const TM = root.TM || (typeof require === 'function' ? require('./tm-modules.js') : null);
  const path = (obj, key) => key.split('.').reduce((o, k) => o == null ? undefined : o[k], obj);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const numeric = (v) => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v));
  const clientLabel = (c) => (c.info || {}).name || [(c.info || {}).tpFirst, (c.info || {}).tpLast].filter(Boolean).join(' ') || 'Client';
  const ROWS = [
    ['l1a', '1a', 'Wages', 'f.l1a'], ['l1h', '1b–1h', 'Other earned income', 'x.otherEarned'], ['l1z', '1z', 'Total earned income', 'f.l1z'],
    ['l2a', '2a', 'Tax-exempt interest', 'f.l2a'], ['l2b', '2b', 'Taxable interest', 'f.l2b'],
    ['l3a', '3a', 'Qualified dividends', 'f.l3a'], ['l3b', '3b', 'Ordinary dividends', 'f.l3b'],
    ['l4b', '4b', 'Taxable IRA distributions', 'f.l4b'], ['l5b', '5b', 'Taxable pensions and annuities', 'f.l5b'],
    ['l6a', '6a', 'Social security benefits', 'f.l6a'], ['l6b', '6b', 'Taxable social security benefits', 'f.l6b'],
    ['l7', '7', 'Capital gain or loss', 'f.l7'], ['l8', '8', 'Additional income, Schedule 1', 'f.l8'],
    ['l9', '9', 'Total income', 'f.l9'], ['l10', '10', 'Adjustments to income', 'f.l10'], ['l11', '11', 'Adjusted gross income', 'f.l11'],
    ['l12', '12', 'Standard or itemized deduction', 'f.l12'], ['l13a', '13a', 'Qualified business income deduction', 'f.l13a'],
    ['l13b', '13b', 'Schedule 1-A deductions', 'f.l13b'], ['l14', '14', 'Total deductions', 'f.l14'], ['l15', '15', 'Taxable income', 'f.l15'],
    ['l16', '16', 'Income tax before AMT and credits', 'f.l16'], ['l17', '17', 'Alternative minimum tax', 'f.l17'], ['l18', '18', 'Tax before credits', 'f.l18'],
    ['l19', '19', 'Child and other dependent credits', 'f.l19'], ['l20', '20', 'Other nonrefundable credits', 'f.l20'],
    ['l21', '21', 'Total nonrefundable credits', 'f.l21'], ['l22', '22', 'Tax after nonrefundable credits', 'f.l22'],
    ['l23', '23', 'Other taxes', 'f.l23'], ['l24', '24', 'Total federal tax', 'f.l24'],
    ['l25a', '25a', 'Federal withholding, W-2', 'f.l25a'], ['l25b', '25b–25c', 'Other federal withholding', 'f.l25b'], ['l25d', '25d', 'Total withholding', 'f.l25d'],
    ['l26', '26', 'Estimated payments', 'f.l26'], ['l28', '28', 'Additional child tax credit', 'f.l28'],
    ['l31', '31', 'Other payments and refundable credits', 'f.l31'], ['l32', '32', 'Total other payments and refundable credits', 'f.l32'],
    ['l33', '33', 'Total payments', 'f.l33'], ['l34', '34', 'Overpayment before allocation', 'f.l34'], ['l37', '37', 'Amount owed before penalties', 'f.l37'],
  ];
  const METRICS = [
    ['Adjusted gross income', 'f.l11'], ['Taxable income', 'f.l15'], ['Total federal tax', 'f.l24'],
    ['Alternative minimum tax', 'f.l17'], ['Total payments', 'f.l33'], ['Overpayment before allocation', 'f.l34'], ['Amount owed before penalties', 'f.l37'],
  ];
  const MODULES = [
    { id: 'w2', label: 'W-2 wages', route: 'client', arrays: ['w2'], feeds: '1040 lines 1a and 25a' },
    { id: 'portfolio', label: 'Portfolio income', route: 'm-portfolio', arrays: ['mod.portfolio.interest', 'mod.portfolio.dividends'], feeds: 'Interest, dividends, distributions, withholding and credits' },
    { id: 'schc', label: 'Business income', route: 'm-schc', arrays: ['mod.schC.businesses'], feeds: 'Schedule C, Schedule SE and QBI' },
    { id: 'capital', label: 'Capital transactions', route: 'm-capital', arrays: ['mod.capital.invest', 'mod.capital.business'], feeds: 'Schedule D, Form 4797 and recapture' },
    { id: 'equity', label: 'Equity compensation', route: 'm-capital', arrays: ['mod.equity.iso', 'mod.equity.nso', 'mod.equity.rsu', 'mod.equity.restricted', 'mod.equity.sales'], feeds: 'Earned income, capital gains and AMT; check W-2 overlap' },
    { id: 'rents', label: 'Rents and royalties', route: 'm-rents', arrays: ['mod.rents.properties'], feeds: 'Schedule E, passive losses, NIIT and QBI' },
    { id: 'k1', label: 'Passthrough K-1s', route: 'm-k1', arrays: ['mod.k1.entities'], feeds: 'Schedule E and separately stated K-1 items' },
  ];
  const DOC_STATUS = [['pending', 'Pending'], ['requested', 'Requested'], ['received', 'Received'], ['reviewed', 'Reviewed'], ['not-applicable', 'Not applicable']];
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => [k, stable(value[k])]));
    return value;
  };
  function fingerprint(c, settings) {
    const input = clone(c);
    if (input.report) { delete input.report.generated; if (!Object.keys(input.report).length) delete input.report; }
    const serialized = JSON.stringify(stable({ client: input, preparer: (settings || {}).preparer || '', firm: (settings || {}).firm || '' }));
    let hash = 2166136261;
    for (let i = 0; i < serialized.length; i++) { hash ^= serialized.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8) + ':' + serialized.length;
  }
  function sourceCoverage(c) {
    const rows = MODULES.map((m) => Object.assign({}, m, {
      count: m.arrays.reduce((total, p) => total + (Array.isArray(path(c, p)) ? path(c, p).length : 0), 0),
    }));
    rows.push({ id: 'itemized', label: 'Itemized deductions', route: 'm-itemized', count: Object.values(path(c, 'mod.itemized') || {}).filter((v) => numeric(v) && Number(v) !== 0).length, unit: 'entered fields', feeds: 'Schedule A; standard deduction is selected when applicable' });
    rows.push({ id: 'other', label: 'Other income, adjustments and payments', route: 'client', count: Object.values(c.other || {}).filter((v) => numeric(v) && Number(v) !== 0).length, unit: 'entered fields', feeds: 'Direct client inputs on the Form 1040 walk' });
    return rows;
  }
  function documents(c) {
    const definitions = [{ id: 'identity', label: 'Filing facts, dependents and identification', route: 'client' }, { id: 'prior', label: 'Prior-year return and carryforward schedules', route: 'client' }];
    sourceCoverage(c).filter((r) => r.count > 0).forEach((r) => definitions.push({ id: r.id, label: r.label + ' supporting documents', route: r.route }));
    const custom = path(c, 'compliance.customDocuments') || [];
    const status = path(c, 'compliance.documents') || {};
    return definitions.map((d) => Object.assign({}, d, { status: (status[d.id] || {}).status || 'pending', note: (status[d.id] || {}).note || '' }))
      .concat(custom.map((d, i) => ({ id: d.id || 'custom-' + i, label: d.label || 'Additional document', status: d.status || 'pending', note: d.note || '', customIndex: i })));
  }
  function diagnostics(w) {
    const base = w.cols[0];
    const out = (base.r.diag || []).map((d) => Object.assign({ source: '1040 engine' }, d));
    const detail = (w.feeds || {}).detail || {};
    Object.entries(detail).forEach(([key, value]) => {
      if (value && Array.isArray(value.checks)) value.checks.forEach((d) => out.push(Object.assign({ source: key }, d)));
    });
    const dedup = new Set();
    return out.filter((d) => { const key = [d.sev, d.line || '', d.text].join('|'); if (dedup.has(key)) return false; dedup.add(key); return true; });
  }
  function reconcile(c, w, tolerance) {
    w = w || TM.walkClient(c);
    const amounts = path(c, 'compliance.returnAmounts') || {};
    const rawTolerance = tolerance == null ? path(c, 'compliance.tolerance') : tolerance;
    const limit = numeric(rawTolerance) && Number(rawTolerance) >= 0 ? Number(rawTolerance) : 1;
    const rows = ROWS.map(([key, line, label, p]) => {
      const raw = path(w.cols[0].r, p), value = numeric(raw) ? Number(raw) : null;
      const entered = Object.prototype.hasOwnProperty.call(amounts, key) && numeric(amounts[key]);
      const external = entered ? Number(amounts[key]) : null;
      const delta = entered && value != null ? value - external : null;
      return { key, line, label, value, external, delta, status: value == null ? 'unavailable' : !entered ? 'pending' : Math.abs(delta) <= limit ? 'matched' : 'difference' };
    });
    return { rows, tolerance: limit, matched: rows.filter((r) => r.status === 'matched').length, differences: rows.filter((r) => r.status === 'difference').length, pending: rows.filter((r) => r.status === 'pending').length, unavailable: rows.filter((r) => r.status === 'unavailable').length };
  }
  function data(c, w, settings) {
    w = w || TM.walkClient(c); settings = settings || {};
    const report = c.report || {}, selected = report.columns || {};
    const columns = w.cols.filter((column, index) => index === 0 || selected[column.col.id] !== false).map((column, index) => ({
      id: column.col.id, name: column.col.name, year: column.r.year, status: column.r.status, base: index === 0,
      r: column.r, planning: column.planning, inputs: column.x, overrides: column.col.base ? (c.direct || {}) : (column.col.ov || {}),
      adjustments: column.col.base ? (c.adjustments || {}) : (column.col.adjustments || {}), levers: column.col.lv || {}, growth: column.col.growth || 0,
    }));
    const base = columns[0];
    const metrics = METRICS.map(([label, p]) => ({ label, values: columns.map((column) => Number(path(column.r, p))), deltas: columns.map((column) => Number(path(column.r, p)) - Number(path(base.r, p))) }));
    const reconciliation = reconcile(c, w);
    const docs = documents(c);
    const checks = diagnostics(w);
    const nowFingerprint = fingerprint(c, settings), generated = report.generated || null;
    return {
      clientId: c.id, client: clientLabel(c), year: (c.info || {}).year, filingStatus: (c.info || {}).status,
      preparer: report.preparer ?? ((c.info || {}).preparer || settings.preparer || ''), firm: report.firm ?? settings.firm ?? '',
      reviewer: (c.info || {}).reviewer || '', notes: report.notes ?? (c.info || {}).notes ?? '', recommendations: report.recommendations || '',
      columns, metrics, coverage: sourceCoverage(c), diagnostics: checks, documents: docs, reconciliation,
      scenarioDiagnostics: columns.slice(1).map((column) => ({ name: column.name, year: column.year, checks: column.r.diag || [] })),
      inputChanges: Object.keys(c.direct || {}).length + Object.keys(c.adjustments || {}).length,
      pendingDocuments: docs.filter((d) => !['reviewed', 'not-applicable'].includes(d.status)).length,
      fingerprint: nowFingerprint, generatedAt: generated && generated.at || null, stale: !!generated && generated.fingerprint !== nowFingerprint,
      rows: ROWS.map(([key, line, label, p]) => ({ key, line, label, values: columns.map((column) => numeric(path(column.r, p)) ? Number(path(column.r, p)) : null) })),
    };
  }
  const csvCell = (value) => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  function csv(model) {
    // Formula-leading free text is quoted and prefixed before Excel opens it.
    const textCell = (v) => csvCell(/^[=+\-@\t\r]/.test(String(v == null ? '' : v)) ? "'" + v : v);
    const row = (a, numbers) => a.map((v, i) => numbers && i >= numbers ? csvCell(v) : textCell(v)).join(',');
    return '\ufeff' + [row(['Client', model.client]), row(['Base tax year', model.year]), row(['Generated', model.generatedAt || 'Live view']), row(['Line', 'Description', ...model.columns.map((c) => c.name + ' · TY' + c.year)]), ...model.rows.map((r) => row([r.line, r.label, ...r.values], 2))].join('\r\n');
  }

  function factory(api) {
    const state = api.state;
    const esc = api.esc || ((v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const money = api.money || ((v) => numeric(v) ? Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—');
    const pct = api.pct || ((v) => (Number(v) * 100).toFixed(1) + '%');
    const C = api.active || api.client || (() => state.data.tm.clients.find((c) => c.id === state.data.tm.active) || state.data.tm.clients[0]);
    const cp = api.clientPath || ((rel) => 'tm.clients.' + state.data.tm.clients.indexOf(C()) + '.' + rel);
    const walk = () => api.compute ? api.compute().tmw : TM.walkClient(C());
    const model = () => data(C(), walk(), state.settings);
    const title = (group, heading, lede, actions) => api.head ? api.head(group, heading, lede, actions || '') : '<div class="pagehead"><div class="eyebrow">' + esc(group) + '</div><h1>' + esc(heading) + '</h1><p class="lede">' + esc(lede) + '</p>' + (actions || '') + '</div>';
    const bindText = (rel, value, label) => '<input class="cell txt" id="review-' + esc(rel) + '" data-bind="' + esc(cp(rel)) + '" data-type="text" value="' + esc(value || '') + '" aria-label="' + esc(label) + '">';
    const bindArea = (rel, value, label) => '<textarea id="review-' + esc(rel) + '" data-bind="' + esc(cp(rel)) + '" data-type="text" aria-label="' + esc(label) + '">' + esc(value || '') + '</textarea>';
    const statusLabel = (status) => ({ pending: 'Pending entry', matched: 'Within tolerance', difference: 'Difference', unavailable: 'Not calculated' }[status] || status);
    const statusChip = (status) => '<span class="chip ' + (status === 'matched' ? 'ok' : status === 'difference' ? 'bad' : 'info') + '">' + esc(statusLabel(status)) + '</span>';
    const checksHTML = (checks) => checks.length ? '<ul class="review-checks">' + checks.map((d) => '<li><span class="chip ' + (d.sev === 'err' ? 'bad' : d.sev === 'warn' ? 'warn' : 'info') + '">' + esc(d.sev === 'err' ? 'Error' : d.sev === 'warn' ? 'Check' : 'Note') + '</span> <b>' + esc(d.line || d.source) + '</b> ' + esc(d.text) + (d.cite ? ' <span class="muted">' + esc(d.cite) + '</span>' : '') + '</li>').join('') + '</ul>' : '<p class="muted">No engine or module diagnostics for the current inputs.</p>';
    function coverageHTML(m) {
      return '<div class="tablewrap"><table class="t"><thead><tr><th>Source module</th><th>Entered data</th><th>Flows to</th></tr></thead><tbody>' + m.coverage.map((r) => '<tr><td><a href="#' + esc(r.route) + '">' + esc(r.label) + '</a></td><td>' + r.count + ' ' + esc(r.unit || (r.count === 1 ? 'row' : 'rows')) + '</td><td class="wrap">' + esc(r.feeds) + '</td></tr>').join('') + '</tbody></table></div>';
    }
    function docsHTML(m) {
      return '<div class="tablewrap"><table class="t"><thead><tr><th>Document / workpaper</th><th>Status</th><th>Review note</th><th></th></tr></thead><tbody>' + m.documents.map((d) => {
        const rel = d.customIndex == null ? 'compliance.documents.' + d.id : 'compliance.customDocuments.' + d.customIndex;
        return '<tr><td class="wrap">' + (d.route ? '<a href="#' + esc(d.route) + '">' + esc(d.label) + '</a>' : bindText(rel + '.label', d.label, 'Document name')) + '</td><td><select class="cell" data-bind="' + esc(cp(rel + '.status')) + '" data-type="text" aria-label="Status for ' + esc(d.label) + '">' + DOC_STATUS.map(([key, label]) => '<option value="' + key + '"' + (key === d.status ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></td><td>' + bindText(rel + '.note', d.note, 'Review note for ' + d.label) + '</td><td>' + (d.customIndex == null ? '' : '<button class="btn small ghost" data-action="review-remove-document" data-index="' + d.customIndex + '" aria-label="Remove ' + esc(d.label) + '">Remove</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div><p><button class="btn small" data-action="review-add-document">Add document</button></p>';
    }
    const VIEWS = {};
    VIEWS['c-client'] = () => {
      const m = model();
      const totals = m.reconciliation;
      let html = title('Compliance · ' + m.client + ' · TY' + m.year, 'Client compliance review', 'Review the active client’s source coverage, calculated return and documents. Changes in Client info, income modules and the Form 1040 walk flow here through the same tax engine.', '<a class="btn" href="#c-reconcile">Reconcile return</a> <a class="btn primary" href="#report">Client report</a>');
      html += '<div class="review-summary">' + [['Calculated total tax', money(m.columns[0].r.f.l24)], ['External amounts pending', totals.pending], ['Differences to review', totals.differences], ['Document items pending', m.pendingDocuments]].map(([label, value]) => '<section class="panel pad"><div class="muted small">' + esc(label) + '</div><strong>' + esc(value) + '</strong></section>').join('') + '</div>';
      html += '<div class="banner"><span><b>Active client: ' + esc(m.client) + '.</b> Source row counts describe entered data. Document review status is set by you; entering a number does not verify a document or a filed return.</span></div>';
      html += '<section class="panel pad"><h2>Source coverage</h2>' + coverageHTML(m) + '</section>';
      html += '<section class="panel pad"><h2>Source documents and workpapers</h2><p class="muted small">This checklist is saved for this client. Add any missing statements or workpapers and record the review performed.</p>' + docsHTML(m) + '</section>';
      html += '<section class="panel pad"><h2>Current calculation diagnostics</h2>' + checksHTML(m.diagnostics) + '</section>';
      html += '<section class="panel pad"><label class="field">Compliance review notes' + bindArea('compliance.notes', path(C(), 'compliance.notes'), 'Compliance review notes') + '</label></section>';
      return html;
    };
    VIEWS['c-reconcile'] = () => {
      const m = model(), comparison = m.reconciliation;
      return title('Compliance · ' + m.client + ' · TY' + m.year, 'Client return reconciliation', 'Compare the active client’s base 1040 walk with amounts entered from a prepared return or tax software. Blank entries remain pending. External amounts never replace the calculated return.', '<a class="btn" href="#c-client">Compliance review</a> <a class="btn" href="#walk">1040 walk</a>') +
        '<div class="panel pad review-reconcile-controls"><label class="field">Difference tolerance ($)<input class="cell" inputmode="decimal" data-review-tolerance="1" value="' + comparison.tolerance + '" aria-label="Difference tolerance in dollars"></label><span>' + comparison.matched + ' within tolerance · ' + comparison.differences + ' differences · ' + comparison.pending + ' pending</span><button class="btn" data-action="review-recalculate">Recalculate</button><button class="btn" data-action="review-export-reconciliation">Export reconciliation CSV</button></div>' +
        '<div class="tablewrap"><table class="t review-reconciliation"><thead><tr><th>1040 line</th><th>Description</th><th class="n">Calculated base</th><th class="n">Return / software</th><th class="n">Calculated − entered</th><th>Status</th></tr></thead><tbody>' + comparison.rows.map((r) => '<tr class="' + (r.status === 'difference' ? 'var' : '') + '"><td>' + esc(r.line) + '</td><td class="wrap">' + esc(r.label) + '</td><td class="n">' + (r.value == null ? '—' : money(r.value)) + '</td><td class="n"><input class="cell" id="client-return-' + esc(r.key) + '" data-bind="' + esc(cp('compliance.returnAmounts.' + r.key)) + '" data-type="numopt" inputmode="decimal" value="' + esc(r.external == null ? '' : r.external) + '" placeholder="Pending" aria-label="Return or software amount for line ' + esc(r.line) + ' ' + esc(r.label) + '"></td><td class="n">' + (r.delta == null ? '—' : money(r.delta)) + '</td><td>' + statusChip(r.status) + '</td></tr>').join('') + '</tbody></table></div>' +
        '<p class="small muted">This comparison covers the lines calculated by the planner. Earned income credit, additional tax forms, refund allocation and penalties require separate review when applicable. Matching totals do not certify filing accuracy.</p>';
    };
    function reportHTML(m, standalone) {
      const base = m.columns[0];
      let html = '<article class="client-report" id="clientReport"><header class="report-heading"><div><div class="eyebrow">' + esc(m.firm || 'Tax Master Planner') + '</div><h1>Tax planning report</h1><h2>' + esc(m.client) + ' · TY' + esc(m.year) + '</h2><p>' + esc(TM.statusLabel(m.filingStatus)) + (m.preparer ? ' · Prepared by ' + esc(m.preparer) : '') + (m.reviewer ? ' · Reviewer: ' + esc(m.reviewer) : '') + '</p></div><div class="small muted">' + (m.generatedAt ? 'Generated ' + esc(new Date(m.generatedAt).toLocaleString()) : 'Live report · generate to record a date') + '</div></header>';
      html += '<p class="report-purpose">The base return and planning comparisons below use the active client’s current Form 1040 walk and supporting modules. The report is a planning summary; review assumptions and source documents before implementing a recommendation.</p>';
      html += '<div class="review-summary">' + [['Federal tax', money(base.r.f.l24)], ['Effective rate', pct(base.r.effective)], ['Taxable income', money(base.r.f.l15)], [base.r.net >= 0 ? 'Overpayment before allocation' : 'Amount owed before penalties', money(Math.abs(base.r.net))]].map(([label, value]) => '<section class="report-metric"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></section>').join('') + '</div>';
      html += '<section><h2>Base return and selected planning comparisons</h2><div class="tablewrap"><table class="t"><thead><tr><th>Metric</th>' + m.columns.map((column) => '<th class="n">' + esc(column.name) + '<br><span class="muted small">TY' + column.year + ' · ' + esc(TM.statusLabel(column.status)) + '</span></th>').join('') + '</tr></thead><tbody>' + m.metrics.map((metric) => '<tr><th>' + esc(metric.label) + '</th>' + metric.values.map((value, index) => '<td class="n">' + money(value) + (index ? '<br><span class="muted small">Δ ' + money(metric.deltas[index]) + '</span>' : '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div><p class="small muted">Δ is the planning column minus the base. A lower tax amount can reflect income changes, deductions, timing or a different tax year; it is not automatically an economic saving.</p></section>';
      html += '<section><h2>Assumptions and planning inputs</h2><ul>' + m.columns.map((column) => {
        const assumptions = ['TY' + column.year, TM.statusLabel(column.status)];
        if (column.growth) assumptions.push('income growth assumption ' + pct(column.growth));
        if (column.planning && column.planning.retirement.configured) assumptions.push('retirement plan ' + column.planning.retirement.plan + ': ' + money(column.inputs.sepIra));
        if (column.planning && column.planning.hsa.configured) assumptions.push('HSA ' + column.planning.hsa.mode + ': ' + money(column.inputs.hsa));
        if (column.planning && column.planning.ira.configured) assumptions.push('IRA ' + column.planning.ira.mode + ', deductible ' + money(column.inputs.iraDed));
        const entries = (object) => Object.entries(object).filter(([, value]) => numeric(value)).map(([key, value]) => ((TM.LEAF[key] || {}).label || key) + ': ' + money(value));
        if (Object.keys(column.levers).length) assumptions.push('scenario moves — ' + entries(column.levers).join('; '));
        if (Object.keys(column.adjustments).length) assumptions.push('source adjustments — ' + entries(column.adjustments).join('; '));
        if (Object.keys(column.overrides).length) assumptions.push('manual totals — ' + entries(column.overrides).join('; '));
        return '<li><b>' + esc(column.name) + ':</b> ' + esc(assumptions.join(' · ')) + '</li>';
      }).join('') + '</ul><p class="small muted">HSA elections assume full-year eligibility and one account owner. Eligibility, workplace-plan coverage, prior-year carryovers and transaction character remain subject to source review. Calculations use the planner’s supported federal rules for TY2025 and TY2026.</p></section>';
      html += '<section><h2>Recommendations and next steps</h2>' + (m.recommendations ? '<p class="report-prewrap">' + esc(m.recommendations) + '</p>' : '<p class="muted">No preparer recommendations entered.</p>') + '<ul><li>' + m.pendingDocuments + ' document items await completed review.</li><li>' + m.reconciliation.pending + ' prepared-return amounts have not been entered; ' + m.reconciliation.differences + ' entered amounts differ beyond tolerance.</li>' + (m.diagnostics.length ? '<li>Resolve or document the calculation diagnostics listed below.</li>' : '') + '</ul></section>';
      html += '<section><h2>Calculation diagnostics</h2><h3>Base return and source modules</h3>' + checksHTML(m.diagnostics) + m.scenarioDiagnostics.map((scenario) => '<h3>' + esc(scenario.name) + ' · TY' + scenario.year + '</h3>' + checksHTML(scenario.checks)).join('') + '</section>';
      html += '<section><h2>Source coverage</h2><p class="small muted">Counts reflect entered data, not verified documents.</p>' + coverageHTML(m) + '</section>';
      html += '<section><h2>Notes</h2><p class="report-prewrap">' + esc(m.notes || 'No preparer notes entered.') + '</p></section>';
      html += '<footer class="small muted">Prepared from the active client’s deterministic 1040 walk. This report does not file a tax return or verify completeness of source documents.</footer></article>';
      if (!standalone) return html;
      return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(m.client) + ' — tax planning report</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#182638;background:#fff;max-width:1100px;margin:32px auto;padding:0 24px}h1{font-size:30px;margin-bottom:8px}h2{font-size:20px;margin-top:28px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:9px;border:1px solid #c8d1dd;vertical-align:top}.n{text-align:right}.muted,.small{color:#526174}.small{font-size:13px}.review-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.report-metric{border:1px solid #c8d1dd;padding:14px}.report-metric span{display:block;font-size:13px}.report-metric strong{display:block;font-size:23px}.report-prewrap{white-space:pre-wrap}.chip{font-size:12px;font-weight:600}a{color:inherit;text-decoration:none}footer{margin-top:28px}@media(max-width:650px){.review-summary{grid-template-columns:1fr 1fr}.tablewrap{overflow:auto}}@media print{body{margin:0;padding:0;font-size:11pt}section{break-inside:avoid}table{font-size:9pt}a{color:inherit}.tablewrap{overflow:visible}}</style></head><body>' + html + '</body></html>';
    }
    VIEWS.report = () => {
      const m = model(), c = C();
      let html = title('Client deliverables', 'Generate client report', 'Build a report from the active client’s current return and selected 1040 planning columns. Recalculate or edit a source, then regenerate to record the updated version.', '<button class="btn primary" data-action="review-generate-report">Generate report</button> <button class="btn" data-action="review-print-report">Print / Save PDF</button> <button class="btn" data-action="review-export-html">Download HTML</button> <button class="btn" data-action="review-export-csv">Export report CSV</button>');
      html += '<div class="banner' + (m.stale ? ' warn' : '') + '" role="status">' + (m.stale ? '<b>Inputs changed after the last generation.</b><span>The preview below shows current values. Generate again to record this version before sharing.</span>' : m.generatedAt ? '<b>Report is current.</b><span>Generated ' + esc(new Date(m.generatedAt).toLocaleString()) + ' from the current inputs.</span>' : '<b>Live report preview.</b><span>Generate, print or download to record a report generation date.</span>') + '</div>';
      html += '<details class="panel pad review-report-options" open><summary><b>Report options and preparer notes</b></summary><div class="form"><label class="field">Preparer' + bindText('report.preparer', m.preparer, 'Report preparer') + '</label><label class="field">Firm' + bindText('report.firm', m.firm, 'Report firm') + '</label></div><fieldset class="review-column-picker"><legend>Planning columns to include</legend>' + walk().cols.slice(1).map((column) => '<label><input type="checkbox" data-review-column="' + esc(column.col.id) + '"' + (((c.report || {}).columns || {})[column.col.id] !== false ? ' checked' : '') + '> ' + esc(column.col.name) + ' · TY' + column.col.year + '</label>').join('') + (walk().cols.length < 2 ? '<p class="muted small">Add a planning column on the Form 1040 walk to include a comparison.</p>' : '') + '</fieldset><label class="field">Recommendations' + bindArea('report.recommendations', m.recommendations, 'Client report recommendations') + '</label><label class="field">Report notes' + bindArea('report.notes', m.notes, 'Client report notes') + '</label></details>';
      return html + reportHTML(m, false);
    };
    function download(name, content, type) {
      const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    const filename = (m, ext) => String(m.client).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') + '-TY' + m.year + '-tax-report.' + ext;
    function generate() {
      if (api.invalidate) api.invalidate();
      const current = model();
      api.applyChange(cp('report.generated'), { fingerprint: current.fingerprint, at: new Date().toISOString() }, 'you', 'Generated current client report');
      return model();
    }
    function action(a, target) {
      if (a === 'review-recalculate') { if (api.invalidate) api.invalidate(); if (api.render) api.render(); if (api.toast) api.toast('Recalculated the active client’s return, comparisons and report.'); return true; }
      if (a === 'review-add-document') { const docs = clone(path(C(), 'compliance.customDocuments') || []); docs.push({ id: 'doc-' + Date.now().toString(36), label: 'Additional document', status: 'pending', note: '' }); api.applyChange(cp('compliance.customDocuments'), docs, 'you', 'Added client document checklist item'); api.render(); return true; }
      if (a === 'review-remove-document') { const docs = clone(path(C(), 'compliance.customDocuments') || []); const i = Number(target.dataset.index); if (Number.isInteger(i) && i >= 0 && i < docs.length) { docs.splice(i, 1); api.applyChange(cp('compliance.customDocuments'), docs, 'you', 'Removed client document checklist item'); api.render(); } return true; }
      if (a === 'review-generate-report') { generate(); api.render(); if (api.toast) api.toast('Generated the report from the active client’s current calculations.'); return true; }
      if (a === 'review-print-report') { generate(); api.render(); root.print(); return true; }
      if (a === 'review-export-html') { const m = generate(); download(filename(m, 'html'), reportHTML(m, true), 'text/html;charset=utf-8'); api.render(); return true; }
      if (a === 'review-export-csv') { const m = generate(); download(filename(m, 'csv'), csv(m), 'text/csv;charset=utf-8'); api.render(); return true; }
      if (a === 'review-export-reconciliation') {
        const m = model(); const rows = [['Client', m.client], ['Tax year', m.year], ['Line', 'Description', 'Calculated base', 'Return / software', 'Calculated minus entered', 'Status'], ...m.reconciliation.rows.map((r) => [r.line, r.label, r.value, r.external, r.delta, statusLabel(r.status)])];
        // Numeric columns are engine values; descriptive cells are escaped for Excel.
        const escaped = rows.map((row) => row.map((v) => csvCell(typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v)).join(',')).join('\r\n');
        download(filename(m, 'csv').replace('-tax-report', '-return-reconciliation'), '\ufeff' + escaped, 'text/csv;charset=utf-8'); return true;
      }
      return false;
    }
    function onChange(el) {
      if (el.dataset.reviewTolerance) {
        const raw = String(el.value).trim().replace(/[$,\s]/g, ''), value = raw === '' ? 1 : Number(raw);
        if (!Number.isFinite(value) || value < 0) { if (api.toast) api.toast('Enter a tolerance of zero or a positive dollar amount.'); el.focus(); return true; }
        api.applyChange(cp('compliance.tolerance'), value, 'you', 'Changed client reconciliation tolerance'); api.render(); return true;
      }
      if (el.dataset.reviewColumn) {
        // Store selections as an object update so arbitrary imported column IDs
        // cannot become data-binding paths.
        const selections = Object.assign({}, path(C(), 'report.columns') || {});
        Object.defineProperty(selections, el.dataset.reviewColumn, { value: !!el.checked, enumerable: true, writable: true, configurable: true });
        api.applyChange(cp('report.columns'), selections, 'you', 'Changed report comparison selection'); api.render(); return true;
      }
      return false;
    }
    return { VIEWS, action, onChange, data: model, reportHTML: (standalone) => reportHTML(model(), standalone), generate };
  }
  factory.data = data; factory.reconcile = reconcile; factory.sourceCoverage = sourceCoverage; factory.documents = documents;
  factory.fingerprint = fingerprint; factory.csv = csv; factory.ROWS = ROWS;
  root.TMReview = factory;
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
})(typeof window !== 'undefined' ? window : globalThis);
