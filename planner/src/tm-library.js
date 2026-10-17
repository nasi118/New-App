/* Client guides, engine-backed regulatory references and a current-return
   analysis workspace. No network requests or tax calculations are duplicated. */
(function (root) {
  'use strict';
  const SOURCES = {
    annual2025: { title: 'Rev. Proc. 2024-40, amended by Pub. L. 119-21', url: 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf' },
    annual2026: { title: 'Rev. Proc. 2025-32', url: 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf' },
    law: { title: 'Pub. L. 119-21', url: 'https://www.govinfo.gov/content/pkg/PLAW-119publ21/pdf/PLAW-119publ21.pdf' },
    retirement2025: { title: 'Notice 2024-80', url: 'https://www.irs.gov/pub/irs-drop/n-24-80.pdf' },
    retirement2026: { title: 'Notice 2025-67', url: 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf' },
    hsa2025: { title: 'Rev. Proc. 2024-25', url: 'https://www.irs.gov/pub/irs-drop/rp-24-25.pdf' },
    hsa2026: { title: 'Rev. Proc. 2025-19', url: 'https://www.irs.gov/pub/irs-drop/rp-25-19.pdf' },
    retirement: { title: 'Publication 560 — Retirement plans for small business', url: 'https://www.irs.gov/publications/p560' },
    ira: { title: 'Publication 590-A — IRA contributions', url: 'https://www.irs.gov/publications/p590a' },
    hsa: { title: 'Publication 969 — HSAs and other tax-favored health plans', url: 'https://www.irs.gov/publications/p969' },
    se: { title: 'Schedule SE instructions', url: 'https://www.irs.gov/instructions/i1040sse' },
    qbi: { title: 'Form 8995-A instructions', url: 'https://www.irs.gov/instructions/i8995a' },
    itemized: { title: 'Schedule A instructions', url: 'https://www.irs.gov/instructions/i1040sca' },
    estimates: { title: 'Form 1040-ES', url: 'https://www.irs.gov/forms-pubs/about-form-1040-es' },
    return: { title: 'Form 1040 instructions', url: 'https://www.irs.gov/instructions/i1040gi' },
  };
  const FLOW = [
    { route: 'client', title: 'Client info', input: 'Tax year, filing status, ages, dependents, W-2s and other income.', output: 'Filing facts and income used by every column of this client’s return.' },
    { route: 'm-portfolio', title: 'Portfolio income', input: 'Interest and dividend ledgers, tax-exempt interest and withholding.', output: 'Form 1040 lines 2a, 2b, 3a and 3b; capital distributions and related credits.' },
    { route: 'm-schc', title: 'Schedule C', input: 'Business receipts, expenses and self-employed deductions.', output: 'Schedule 1 business income; Schedule SE; retirement and QBI inputs.' },
    { route: 'm-capital', title: 'Capital transactions', input: 'Investment sales, business dispositions, basis and carryovers.', output: 'Schedule D, Form 4797 ordinary gain, recapture and preferential tax rates.' },
    { route: 'm-rents', title: 'Rents & royalty', input: 'Income, expenses, depreciation, participation and prior passive losses.', output: 'Schedule E income after the modeled passive-loss limits; QBI inputs.' },
    { route: 'm-k1', title: 'Passthrough income (K-1)', input: 'Entity-level income, deductions, credits, SE earnings and QBI facts.', output: 'Applicable income lines, passive-loss review, SE tax and QBI.' },
    { route: 'm-itemized', title: 'Itemized deductions', input: 'Medical, state and local taxes, interest and charitable gifts.', output: 'Schedule A; the engine compares itemized deductions with the standard deduction.' },
    { route: 'walk', title: 'Form 1040 walk', input: 'Module totals, source adjustments, elections and planning columns.', output: 'The shared return engine calculates income, deductions, credits, taxes and payments.' },
    { route: 'scen', title: 'Tax scenarios & estimates', input: 'Baseline return, growth assumptions and scenario levers.', output: 'Independent comparisons and safe-harbor estimates. Send to 1040 walk creates a planning column; it does not change the base.' },
    { route: 'home', title: 'Summary dashboard', input: 'The base return and planning columns on the Form 1040 walk.', output: 'Income composition, tax totals, comparisons, diagnostics and estimated-payment summaries.' },
    { route: 'c-client', title: 'Client compliance', input: 'The same selected client, source modules and computed base return.', output: 'A focused review of completeness and calculation diagnostics before delivery.' },
    { route: 'report', title: 'Client report', input: 'The selected client’s computed return and planning comparisons.', output: 'A client-facing report. Review the selected client and columns before generating it.' },
  ];

  function referenceModel(TM, year, status) {
    const p = TM.params(year, status), limits = TM.planningLimits ? TM.planningLimits(p.year) : null;
    let previous = 0;
    const brackets = p.brackets.map(([top, rate]) => { const row = { from: previous, to: top, rate }; previous = top; return row; });
    const rows = [];
    const add = (group, label, value, authority, note, format) => rows.push({ group, label, value, authority, note: note || '', format: format || 'money' });
    const annual = 'annual' + p.year, retire = 'retirement' + p.year;
    add('Income and deductions', 'Standard deduction', p.std, annual, 'Before age, blindness or dependent adjustments.');
    add('Income and deductions', 'Additional standard deduction per age / blindness condition', p.married || p.status === 'mfs' ? p.addlStdMarried : p.addlStdSingle, annual);
    add('Income and deductions', '0% long-term capital-gain taxable-income ceiling', p.cg0, annual, 'Qualified dividends and eligible net capital gains stack above ordinary income.');
    add('Income and deductions', '15% long-term capital-gain taxable-income ceiling', p.cg15, annual);
    add('Income and deductions', 'Annual net capital-loss deduction limit', p.capLossLimit, 'return');
    add('Income and deductions', 'Child tax credit per qualifying child', p.ctc, 'law', 'Before eligibility, income phase-out and refundable-credit limits.');
    add('Income and deductions', 'Other-dependent credit per qualifying dependent', p.odc, 'return');
    add('Itemized deductions', 'SALT deduction cap', p.saltCap, 'law', 'Before the MAGI phase-down; filing separately uses half of the joint cap.');
    add('Itemized deductions', 'SALT MAGI phase-down starts', p.saltThr, 'law', 'Cap reduces by 30% of MAGI above this threshold, subject to the floor.');
    add('Itemized deductions', 'SALT minimum cap after phase-down', p.saltFloor, 'law');
    add('Itemized deductions', 'Charitable AGI floor for itemizers', p.charityFloor, 'law', p.year === 2026 ? 'Applies to modeled itemized charitable deductions starting in 2026.' : 'No 0.5% charitable floor in the 2025 model.', 'percent');
    const nonItemized = typeof p.charityNonItem === 'number' ? p.charityNonItem : 0;
    add('Itemized deductions', 'Non-itemizer cash-charity deduction ceiling', nonItemized, 'law', 'Separate qualifying cash-gift deduction starting in 2026; eligibility rules apply.');
    add('Business and additional taxes', 'Social Security wage base', p.wageBase, 'se', 'W-2 Social Security wages reduce the wage base available for SE earnings.');
    add('Business and additional taxes', 'QBI taxable-income threshold', p.qbiThr, 'qbi', 'Threshold is measured before the QBI deduction.');
    add('Business and additional taxes', 'QBI limitation phase-in range', p.qbiRange, annual, 'Wage / UBIA and specified-service limits phase in over this range.');
    add('Business and additional taxes', 'NIIT MAGI threshold', p.niitThr, 'return', '3.8% tax applies to the lesser of net investment income or excess MAGI.');
    add('Business and additional taxes', 'Additional Medicare Tax earnings threshold', p.addlMedThr, 'return');
    add('Alternative minimum tax', 'AMT exemption before phase-out', p.amtEx, annual);
    add('Alternative minimum tax', 'AMT exemption phase-out begins', p.amtPhase, 'law');
    add('Alternative minimum tax', 'AMT exemption phase-out rate', p.amtPhaseRate, 'law', '', 'percent');
    add('Alternative minimum tax', 'AMT 26% / 28% breakpoint', p.amtBp, annual);
    add('HSA', 'HSA self-only annual contribution limit', p.hsaSelf, 'hsa' + p.year, 'Employer contributions count toward the same limit.');
    add('HSA', 'HSA family annual contribution limit', p.hsaFamily, 'hsa' + p.year, 'The walk’s maximum assumes full-year eligibility.');
    if (TM.inlinePlanning) {
      const age55 = TM.inlinePlanning({ elections: { hsa: { mode: 'max', coverage: 'self', age: 55 } } }, {}, TM.blankLeaves(), { year: p.year, status: p.status, tpAge: 55 });
      add('HSA', 'HSA catch-up at age 55+', age55.details.hsa.limit - p.hsaSelf, 'hsa', 'Each eligible spouse’s catch-up must be contributed to that spouse’s HSA.');
    }
    if (limits) {
      add('Retirement and IRA', '401(k) employee elective-deferral limit', limits.deferral, retire, 'Other employer-plan deferrals share the individual limit.');
      add('Retirement and IRA', '401(k) catch-up at age 50+', limits.catchup, retire, 'Ages 60–63 use the higher catch-up below instead.');
      add('Retirement and IRA', '401(k) catch-up at ages 60–63', limits.superCatchup, retire);
      add('Retirement and IRA', 'Defined-contribution annual additions limit', limits.additions, retire, 'Employee plus employer contributions; eligible catch-up is separate.');
      add('Retirement and IRA', 'Annual compensation limit', limits.compensation, retire);
      add('Retirement and IRA', 'Standard SIMPLE employee deferral', limits.simple, retire, 'The inline planner models the standard SIMPLE limits; special enhanced employer limits require separate review.');
      add('Retirement and IRA', 'Standard SIMPLE catch-up at age 50+', limits.simpleCatchup, retire);
      add('Retirement and IRA', 'SIMPLE catch-up at ages 60–63', limits.simpleSuperCatchup, retire);
      add('Retirement and IRA', 'Traditional / Roth IRA combined contribution limit', limits.ira, retire, 'Compensation and eligibility can reduce the amount. This is a contribution limit, not a guaranteed deduction.');
      add('Retirement and IRA', 'IRA catch-up at age 50+', limits.iraCatchup, retire);
      add('Retirement and IRA', 'IRA deduction phase-out: covered, single / head of household', limits.coveredSingle, retire, 'The IRA deduction also depends on workplace coverage, filing status and MAGI.', 'range');
      add('Retirement and IRA', 'IRA deduction phase-out: covered, filing jointly or qualifying surviving spouse', limits.coveredJoint, retire, '', 'range');
      add('Retirement and IRA', 'IRA deduction phase-out: uncovered, spouse covered, filing jointly', limits.spouseJoint, retire, 'Married filing separately generally uses $0–$10,000; lived-apart facts matter.', 'range');
    }
    return { year: p.year, status: p.status, brackets, rows, limitsAvailable: !!limits };
  }

  function analysisModel(TM, client, walk, index) {
    const j = Math.max(0, Math.min(Number(index) || 0, walk.cols.length - 1)), selected = walk.cols[j], r = selected.r, base = walk.cols[0].r;
    const diagnostics = (r.diag || []).map((d) => Object.assign({}, d));
    for (const [module, result] of Object.entries(walk.feeds.detail || {})) {
      for (const check of result && Array.isArray(result.checks) ? result.checks : []) diagnostics.push(Object.assign({ module }, check));
    }
    const adjustments = Object.entries(j ? selected.col.adjustments || {} : client.adjustments || {}).filter(([, value]) => value != null && value !== '');
    const overrides = Object.entries(j ? selected.col.ov || {} : client.direct || {}).filter(([, value]) => value != null && value !== '');
    const data = { client: client.info.name || [client.info.tpFirst, client.info.tpLast].filter(Boolean).join(' ') || 'Client', clientId: client.id, column: selected.col.name, columnIndex: j, year: r.year, status: r.status, totalIncome: r.f.l9, agi: r.agi, taxableIncome: r.f.l15, incomeTax: r.f.l16, totalTax: r.f.l24, payments: r.f.l33, net: r.net, seTax: r.se.tax, amt: r.amt.amt, niit: r.s2.l12, qbiDeduction: r.f.l13a, marginalRate: r.marginal, taxChange: r.f.l24 - base.f.l24, diagnostics, adjustments, overrides, planning: selected.planning || {}, comparisons: walk.cols.map((x) => ({ name: x.col.name, year: x.r.year, status: x.r.status, agi: x.r.agi, taxableIncome: x.r.f.l15, totalTax: x.r.f.l24, net: x.r.net })), inputs: Object.assign({}, selected.x) };
    // Identifies current inputs rather than the render time; a changed source or
    // election creates a different revision even when total tax stays the same.
    const serialized = JSON.stringify({ client, columnIndex: j, result: data });
    let hash = 2166136261;
    for (let i = 0; i < serialized.length; i++) hash = Math.imul(hash ^ serialized.charCodeAt(i), 16777619);
    data.revision = (hash >>> 0).toString(16).padStart(8, '0');
    return data;
  }

  function sourceUrl(source) {
    const ref = source.ref || '';
    if (/^https:\/\//i.test(ref)) return ref;
    const section = ref.match(/\/section_([\dA-Za-z]+)(?:$|[/?#])/);
    if (section) return 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section' + encodeURIComponent(section[1]) + '&num=0&edition=prelim';
    const title = source.title || '';
    for (const [pattern, key] of [[/Rev\. Proc\. 2025-32/, 'annual2026'], [/Rev\. Proc\. 2024-40/, 'annual2025'], [/119-21|OBBBA/, 'law'], [/Notice 2025-67/, 'retirement2026'], [/Notice 2024-80/, 'retirement2025']]) if (pattern.test(title)) return SOURCES[key].url;
    const irc = title.match(/^(?:IRC|§)\s*§?\s*(\d+[A-Za-z]?)/);
    if (irc) return 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section' + encodeURIComponent(irc[1]) + '&num=0&edition=prelim';
    const regulation = title.match(/(?:Treas\. Reg\.|Regulation)\s*§?\s*(1\.[\dA-Za-z]+-\d+)/);
    if (regulation) return 'https://www.ecfr.gov/current/title-26/section-' + regulation[1];
    return null;
  }

  function factory(api) {
    const TM = root.TM, state = api.state, esc = api.esc, money = api.money, pct = api.pct;
    const VIEWS = {}, C = api.active || (() => root.TMP.TMV.active()), W = api.walk || (() => TM.walkClient(C()));
    const link = (route, title) => '<a href="#' + esc(route) + '">' + esc(title) + '</a>';
    const external = (source) => '<a href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">' + esc(source.title) + '</a>';
    const head = (title, lede, right) => api.head('Library · ' + (C().info.name || 'Active client'), title, lede, right || '');
    const card = (title, body) => '<section class="panel pad library-card"><h2>' + esc(title) + '</h2>' + body + '</section>';
    const steps = (items) => '<ol class="library-steps">' + items.map(([title, text]) => '<li><strong>' + title + '</strong><p>' + text + '</p></li>').join('') + '</ol>';
    const display = (row) => row.format === 'percent' ? pct(row.value, 1) : row.format === 'range' ? row.value.map(money).join('–') : money(row.value);
    const sourceLink = (key) => SOURCES[key] ? external(SOURCES[key]) : '';
    const guideLinks = '<nav class="library-links" aria-label="Help pages">' + link('guide', 'Instructions') + link('planning-guide', 'Planning guide') + link('references', 'Regulatory references') + link('audit', 'Audit trail') + '</nav>';

    VIEWS.guide = () => {
      let h = head('Instructions', 'Start with a client, enter or import the supporting data, then review the same return from planning, compliance and reporting.', '<a class="btn primary" href="#clients">Client workspace</a>') + guideLinks;
      h += '<div class="grid2">' + card('A practical workflow', steps([
        [link('clients', '1. Select or create the client'), 'Check ' + link('client', 'Client info') + ' for tax year, filing status, ages and prior-year payment facts. The client badge tells you whose return is active.'],
        [link('data', '2. Enter or import source data'), 'Use the income and deduction modules for supporting rows. Open Import & export for Excel workbooks and a complete JSON backup; review an import before applying it. Prior-year data stays identified by its tax year.'],
        [link('walk', '3. Review the base Form 1040'), 'Expand a line to see its schedules. Explain shows the calculation and authority. Details opens the source module. Inline retirement, HSA and IRA elections recompute the selected column.'],
        [link('scen', '4. Build a planning comparison'), 'Create a planning column or evaluate a scenario, then use Send to 1040 walk. The base remains the reference for the comparison. Check the year and assumptions for each column.'],
        [link('c-client', '5. Complete the compliance review'), 'Review diagnostics, source completeness and any manually adjusted amounts. Recalculate after changes and compare the results before delivery.'],
        [link('report', '6. Generate and retain the client report'), 'Review the current client and selected columns. Export the workbook and retain a JSON backup with its audit trail. ' + link('connections', 'Google Sheets connections') + ' provides a separate connected workflow.'],
      ])) + card('How the interface behaves', '<ul class="library-list"><li><strong>Navigation:</strong> Planning and Compliance group related work. Open a group to see its pages; collapse it to shorten the sidebar.</li><li><strong>Recalculate:</strong> calculations normally refresh after a committed edit. Recalculate refreshes the current results from saved inputs.</li><li><strong>Amount cells:</strong> a typed total on a source-fed 1040 line records the difference from its source subtotal. Future module edits still flow through. Clear the cell to remove that adjustment.</li><li><strong>Manual totals:</strong> existing fixed overrides and a manually entered QBI deduction remain fixed until cleared. Explain identifies them.</li><li><strong>Undo and audit:</strong> the ' + link('audit', 'Audit trail') + ' shows who changed a value, its prior value and its replacement. Available Undo buttons restore that change.</li><li><strong>Tools:</strong> the calculator can insert current return values and send its tape to client notes. Appearance controls are in ' + link('settings', 'Settings') + '.</li><li><strong>AI analysis:</strong> ' + link('ai-analysis', 'AI analysis') + ' starts with current engine results and local review items. OpenAI adds conversational analysis when connected in Settings.</li></ul>') + '</div>';
      h += '<h2>What flows from where</h2><p class="lede small">These pages use the selected client’s shared return data. Open a source page to change the inputs; open the walk to inspect the result.</p><div class="tablewrap"><table class="t library-flow"><thead><tr><th scope="col">Page</th><th scope="col">Reads</th><th scope="col">Feeds or explains</th></tr></thead><tbody>' + FLOW.map((row) => '<tr><th scope="row">' + link(row.route, row.title) + '</th><td>' + esc(row.input) + '</td><td>' + esc(row.output) + '</td></tr>').join('') + '</tbody></table></div>';
      h += card('Training workbooks and the active client', '<p>The original Form 1040 reconciliation, Rental HoldCo and wealth-strategy workbooks contain separate training records. Their named household, imported software amounts and strategy estimates do not automatically replace the selected client’s source modules. Use Client compliance and the client report for the active return; use the training workbooks as worked examples.</p><p>A regulatory reference describes the engine’s rule and annual parameters. It does not show that every eligibility fact has been entered. Compare the ' + link('references', 'applicable year and filing status') + ' with the source documents and diagnostic messages.</p>');
      return h;
    };

    VIEWS['planning-guide'] = () => head('Planning guide', 'Use the base as a documented starting point, then compare one or more changes with clear assumptions.', '<a class="btn primary" href="#scen">Tax scenarios & estimates</a>') + guideLinks + '<div class="grid2">' + card('From a return to a decision', steps([
      ['Establish the baseline', 'Populate the source modules and review ' + link('walk', 'Form 1040 walk') + '. Confirm the tax year, filing status, participation and carryover facts before comparing changes.'],
      ['Choose the comparison year', 'A same-year column tests a change in the existing return. A projection uses another supported tax year and its own annual parameters. Growth is an assumption; review it before using the result.'],
      ['Model the move', 'Use ' + link('scen', 'Tax scenarios & estimates') + ' or add a planning column. Inline elections show the employee, employer, catch-up or nondeductible components that produce the allowed amount.'],
      ['Review the whole result', 'Compare total tax, cash contributions, payments, AMT, QBI and carryovers. A lower deduction or refund is not enough to judge a strategy on its own. Explain and Details show the source of each line.'],
      ['Document the recommendation', 'Use ' + link('ai-analysis', 'AI analysis') + ' for a current-return review, then ' + link('report', 'generate the client report') + '. Keep assumptions and unresolved review items with the client file.'],
    ])) + card('Questions to resolve before using a maximum', '<ul class="library-list"><li><strong>Retirement:</strong> identify the owner’s earned income, age and other employer-plan deferrals. The self-employed contribution calculation uses net earnings after the deductible half of SE tax. Plan establishment and funding deadlines depend on the plan.</li><li><strong>HSA:</strong> verify coverage, full-year eligibility, Medicare status and employer contributions. The inline maximum models one owner’s catch-up; a spouse’s catch-up belongs in that spouse’s HSA.</li><li><strong>IRA:</strong> distinguish contribution eligibility from deduction eligibility. Workplace coverage, spouse coverage, compensation and IRA MAGI determine the deductible amount.</li><li><strong>Rental and K-1:</strong> participation, basis, at-risk and passive-loss facts can change the deduction and QBI. Review supporting workpapers for limitations beyond the modeled facts.</li><li><strong>Estimated payments:</strong> prior-year tax and AGI drive the safe harbor. Annualized installments and shifted due dates require review when income is uneven.</li></ul><p>' + sourceLink('retirement') + ' · ' + sourceLink('ira') + ' · ' + sourceLink('hsa') + ' · ' + sourceLink('estimates') + '</p>') + '</div>' + card('Use the reference for the selected year', '<p>The ' + link('references', 'Regulatory references') + ' page reads the same parameter functions as the return engine. It shows ordinary-income brackets, standard deductions, capital-gain ceilings, SALT, QBI, AMT, HSA and retirement limits for 2025 and 2026. Select a filing status before comparing thresholds.</p><p>The ' + link('home', 'Summary dashboard') + ' summarizes the base and planning columns. Scenarios remain separate until you send one to the walk; sending a scenario creates a new column rather than editing the base.</p>');

    VIEWS.references = () => {
      const c = C(), year = state.ui.referenceYear || +c.info.year, status = state.ui.referenceStatus || c.info.status, model = referenceModel(TM, year, status);
      let h = head('Regulatory references', 'Annual limits and tax rules used by the return engine, with links to the underlying authority. Select a year and filing status to see the applicable amounts.') + guideLinks;
      h += '<div class="panel pad library-selectors"><label>Tax year<select id="library-reference-year" data-library-reference="year" aria-label="Reference tax year">' + [2025, 2026].map((y) => '<option value="' + y + '"' + (y === model.year ? ' selected' : '') + '>TY' + y + '</option>').join('') + '</select></label><label>Filing status<select id="library-reference-status" data-library-reference="status" aria-label="Reference filing status">' + TM.STATUSES.map(([key, title]) => '<option value="' + esc(key) + '"' + (key === model.status ? ' selected' : '') + '>' + esc(title) + '</option>').join('') + '</select></label><p class="small muted">Reference selection does not change the client’s return. Engine parameters: TY' + model.year + ' · ' + esc(TM.statusLabel(model.status)) + '.</p></div>';
      h += '<h2>Ordinary-income brackets · TY' + model.year + '</h2><p class="small muted">Rates apply to each taxable-income slice. They are not a flat rate on total income. Qualified dividends and eligible capital gains use a separate rate calculation.</p><div class="tablewrap"><table class="t"><thead><tr><th scope="col">Taxable income above</th><th scope="col">Through</th><th scope="col" class="n">Marginal rate</th></tr></thead><tbody>' + model.brackets.map((row) => '<tr><td>' + money(row.from) + '</td><td>' + (Number.isFinite(row.to) ? money(row.to) : 'No upper limit') + '</td><td class="n">' + pct(row.rate, 0) + '</td></tr>').join('') + '</tbody></table></div><p class="small">' + sourceLink('annual' + model.year) + ' · ' + sourceLink('law') + '</p>';
      for (const group of [...new Set(model.rows.map((row) => row.group))]) h += '<h2>' + esc(group) + '</h2><div class="tablewrap"><table class="t"><thead><tr><th scope="col">Parameter</th><th scope="col" class="n">TY' + model.year + '</th><th scope="col">Application and authority</th></tr></thead><tbody>' + model.rows.filter((row) => row.group === group).map((row) => '<tr><th scope="row">' + esc(row.label) + '</th><td class="n library-amount">' + display(row) + '</td><td><span class="small">' + esc(row.note) + '</span><div class="small">' + sourceLink(row.authority) + '</div></td></tr>').join('') + '</tbody></table></div>';
      h += card('How the annual limits become a deduction', '<p>A limit is a ceiling, not an automatic deduction. The walk’s retirement election uses the selected year, age and self-employment earnings; HSA elections reduce the remaining limit by employer contributions; IRA elections apply compensation and MAGI phase-outs. Review the calculation in the line’s Explain drawer.</p><p>2026 statutory changes are included where the engine models them: the SALT amounts and phase-down, wider QBI limitation range, AMT exemption phase-out, charitable floor and the itemized-deduction limit. Amounts shown above are read directly from the current engine; source links may display the IRS’s most recent revision.</p>');
      h += '<h2>Reference tabs from the original workbooks</h2><p class="small muted">Citation IDs are retained within their workbook group. These excerpts explain their original workpapers; they are not imported client facts.</p>';
      const legacy = state.data || {};
      const groups = [...(root.TM_SOURCES || []), ...[['1040 reconciliation workpaper', legacy.w1040], ['Rental HoldCo', legacy.rental], ['Wealth strategies', legacy.hnwi]].filter(([, d]) => d && Array.isArray(d.sources)).map(([title, d]) => ({ title, list: d.sources }))];
      for (const group of groups) h += '<details class="panel library-source-group"><summary>' + esc(group.title) + ' <span class="muted small">(' + group.list.length + ' citations)</span></summary><div class="tablewrap"><table class="t"><thead><tr><th scope="col">ID</th><th scope="col">Authority</th><th scope="col">Reference excerpt</th></tr></thead><tbody>' + group.list.map((source) => { const url = sourceUrl(source); return '<tr><td class="line">' + esc(source.id) + '</td><td>' + (url ? external({ title: source.title, url }) : esc(source.title)) + '</td><td class="small">' + esc(source.excerpt || '') + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
      return h;
    };

    function currentAnalysis() { return analysisModel(TM, C(), W(), state.ui.analysisColumn); }
    function aiContext(model) {
      return Object.assign({}, model, { lineKey: '__return_analysis__', line: '24 / return overview', label: 'Current return analysis', value: model.totalTax, filingStatus: TM.statusLabel(model.status), status: model.diagnostics.some((d) => d.sev === 'err') ? 'Review errors' : model.diagnostics.some((d) => d.sev === 'warn') ? 'Review checks' : 'Current engine results', how: 'Current selected-client snapshot, revision ' + model.revision + '. Source modules feed the base return; this selected column’s assumptions, elections and adjustments produce the amounts below. This is a deterministic calculation review, not a completed AI opinion.', authority: 'Form 1040 instructions; year-specific engine parameters and linked regulatory references.', details: [{ label: 'Total income', value: model.totalIncome }, { label: 'Adjusted gross income', value: model.agi }, { label: 'Taxable income', value: model.taxableIncome }, { label: 'Income tax', value: model.incomeTax }, { label: 'Self-employment tax', value: model.seTax }, { label: 'AMT', value: model.amt }, { label: 'NIIT', value: model.niit }, { label: 'QBI deduction', value: model.qbiDeduction }, { label: 'Total tax', value: model.totalTax }, { label: 'Total payments', value: model.payments }, { label: 'Refund (+) / balance due (−)', value: model.net }, { label: 'Tax change from base', value: model.taxChange }], sources: [], changes: ['Change source details in the client’s income and deduction modules, then review the recomputed return.', 'Compare the base with each planning column and review its year, assumptions and elections.', 'Review diagnostic messages and manual totals before preparing the client report.'] });
    }
    VIEWS['ai-analysis'] = () => {
      const model = currentAnalysis(), w = W();
      let h = head('AI analysis', 'Review the selected client’s current calculation, then ask OpenAI to explain the drivers, compare columns or identify missing facts.', '<button class="btn primary" data-action="library-run-analysis">Run analysis</button>') + '<div class="panel pad library-selectors"><label>Return column<select id="library-analysis-column" data-library-analysis-column aria-label="Analysis return column">' + w.cols.map((x, i) => '<option value="' + i + '"' + (i === model.columnIndex ? ' selected' : '') + '>' + esc(x.col.name) + ' · TY' + x.r.year + '</option>').join('') + '</select></label><p class="small muted">' + esc(model.client) + ' · ' + esc(TM.statusLabel(model.status)) + ' · calculation revision ' + esc(model.revision) + '. Current inputs are read each time you open this page or run analysis.</p></div>';
      h += '<div class="panel pad library-local"><span class="chip info">Local calculation review</span><p>The figures and review items below come directly from the return engine. Run analysis sends a fresh snapshot to the configured OpenAI connection. When disconnected, the advisor shows a local explanation. AI replies describe the snapshot used for that reply; run again after editing inputs.</p><p><a href="#settings">OpenAI settings</a> · <a href="#references">Regulatory references</a> · <a href="#walk">Inspect Form 1040</a></p></div>';
      h += '<div class="library-metrics">' + [['Adjusted gross income', model.agi], ['Taxable income', model.taxableIncome], ['Total federal tax', model.totalTax], [model.net >= 0 ? 'Refund' : 'Balance due', Math.abs(model.net)]].map(([title, value]) => '<div class="kpi"><div class="k">' + esc(title) + '</div><div class="v">' + money(value) + '</div></div>').join('') + '</div><div class="grid2">';
      h += card('Calculation drivers', '<dl class="kv">' + [['Regular income tax', model.incomeTax], ['Self-employment tax', model.seTax], ['Alternative minimum tax', model.amt], ['Net investment income tax', model.niit], ['QBI deduction', model.qbiDeduction], ['Payments', model.payments], ['Tax change from base', model.taxChange]].map(([title, value]) => '<dt>' + esc(title) + '</dt><dd>' + money(value) + '</dd>').join('') + '</dl><p class="small">' + model.adjustments.length + ' source adjustment(s) and ' + model.overrides.length + ' fixed manual total(s) in this column. Review them on the Form 1040 walk.</p>');
      h += card('Review items', model.diagnostics.length ? '<ul class="library-list">' + model.diagnostics.map((d) => '<li><span class="chip ' + (d.sev === 'err' ? 'bad' : d.sev === 'warn' ? 'warn' : 'info') + '">' + (d.sev === 'err' ? 'Error' : d.sev === 'warn' ? 'Check' : 'Note') + '</span> ' + esc(d.text || d.message || '') + (d.cite ? '<span class="muted small"> · ' + esc(d.cite) + '</span>' : '') + '</li>').join('') + '</ul>' : '<p>No calculation diagnostics for the entered facts. Confirm source completeness and eligibility before relying on the result.</p>');
      h += '</div><h2>Planning comparison</h2><div class="tablewrap"><table class="t"><thead><tr><th scope="col">Column</th><th scope="col">Year / filing status</th><th class="n" scope="col">AGI</th><th class="n" scope="col">Total tax</th><th class="n" scope="col">Change from base</th></tr></thead><tbody>' + model.comparisons.map((row, i) => '<tr' + (i === model.columnIndex ? ' class="total"' : '') + '><th scope="row">' + esc(row.name) + '</th><td>TY' + row.year + ' · ' + esc(TM.statusLabel(row.status)) + '</td><td class="n">' + money(row.agi) + '</td><td class="n">' + money(row.totalTax) + '</td><td class="n">' + money(row.totalTax - model.comparisons[0].totalTax) + '</td></tr>').join('') + '</tbody></table></div>';
      h += '<div class="library-links"><button class="btn" data-action="library-ai-prompt" data-prompt="drivers">Explain tax drivers</button><button class="btn" data-action="library-ai-prompt" data-prompt="compare">Compare planning columns</button><button class="btn" data-action="library-ai-prompt" data-prompt="review">Review missing facts</button><a class="btn" href="#report">Prepare client report</a></div>';
      return h;
    };
    function action(name, target) {
      if (name !== 'library-run-analysis' && name !== 'library-ai-prompt') return false;
      const model = currentAnalysis();
      const prompts = { drivers: 'Explain the main federal tax drivers and the calculation of this selected column. Cite relevant current-year authority and distinguish deductions from cash savings.', compare: 'Compare this client’s planning columns with the base. Explain what drives each tax difference, the contribution or cash cost, and the assumptions to confirm. Do not combine independent strategy savings.', review: 'Review this current client return for missing facts, manual totals and diagnostic items. Prioritize the questions to resolve before delivering a report.' };
      const prompt = prompts[target && target.dataset && target.dataset.prompt] || 'Analyze this client’s current return and compare the planning columns. Explain the tax drivers, identify review items and missing eligibility facts, and suggest practical next steps. Cite current-year authority and distinguish engine results from recommendations.';
      if (root.Advisor && root.Advisor.ask) root.Advisor.ask(prompt, aiContext(model));
      else if (api.toast) api.toast('The advisor is unavailable. The local calculation review remains available here.');
      return true;
    }
    function onChange(element) {
      if (element.dataset.libraryReference) {
        if (element.dataset.libraryReference === 'year') state.ui.referenceYear = +element.value === 2026 ? 2026 : 2025;
        else state.ui.referenceStatus = TM.STATUSES.some(([key]) => key === element.value) ? element.value : C().info.status;
        api.render(); return true;
      }
      if (element.dataset.libraryAnalysisColumn != null) { state.ui.analysisColumn = +element.value || 0; api.render(); return true; }
      return false;
    }
    return { VIEWS, action, onChange, data: { references: (year, status) => referenceModel(TM, year, status), analysis: currentAnalysis, aiContext } };
  }
  factory.referenceModel = referenceModel;
  factory.analysisModel = analysisModel;
  factory.sourceUrl = sourceUrl;
  factory.SOURCES = SOURCES;
  factory.FLOW = FLOW;
  root.TMLibrary = factory;
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
})(typeof window !== 'undefined' ? window : globalThis);
