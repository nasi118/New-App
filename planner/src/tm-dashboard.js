/* Income composition for the dashboard. Amounts come from the computed return;
   source losses remain signed and the reconciliation always ends at line 9. */
(function (root) {
  'use strict';

  const num = (value) => Number.isFinite(+value) ? +value : 0;

  function incomeModel(result) {
    const r = result || {}, f = r.f || {}, s1 = r.s1 || {};
    const definitions = [
      ['Wages and earned income', 'Form 1040, line 1z', num(f.l1z)],
      ['Interest and dividends', 'Taxable interest + ordinary dividends; lines 2b and 3b', num(f.l2b) + num(f.l3b)],
      ['IRA and pension distributions', 'Taxable amounts; lines 4b and 5b', num(f.l4b) + num(f.l5b)],
      ['Social Security benefits', 'Taxable amount only; line 6b', num(f.l6b)],
      ['Capital gains or losses', 'Allowed on the return; line 7', num(f.l7)],
      ['Business income or loss', 'Schedule C; Schedule 1, line 3', num(s1.l3)],
      ['Rental and K-1 income or loss', 'Schedule E; Schedule 1, line 5', num(s1.l5)],
      ['Business-property gains or losses', 'Form 4797; Schedule 1, line 4', num(s1.l4)],
      ['Other income', 'Remaining Schedule 1 income', num(f.l8) - num(s1.l3) - num(s1.l4) - num(s1.l5)],
    ];
    const totalIncome = num(f.l9);
    const accounted = definitions.reduce((sum, row) => sum + row[2], 0);
    // Retain any additional income represented in line 9, including future
    // engine extensions, instead of silently dropping it from the chart.
    if (Math.abs(totalIncome - accounted) > 0.000001) {
      definitions.push(['Other Form 1040 income', 'Remaining amount included in line 9', totalIncome - accounted]);
    }
    const sources = definitions.filter((row) => row[2] !== 0).map(([label, detail, amount]) => ({ label, detail, amount }));
    const positiveIncome = sources.reduce((sum, source) => sum + Math.max(0, source.amount), 0);
    const lossAdjustments = sources.reduce((sum, source) => sum + Math.min(0, source.amount), 0);
    const tax = num(f.l24);
    return {
      sources: sources.map((source) => ({ ...source, share: positiveIncome > 0 ? source.amount / positiveIncome : null })),
      positiveIncome, lossAdjustments, totalIncome, tax,
      taxShare: totalIncome > 0 ? tax / totalIncome : null,
      incomeLessTax: totalIncome - tax,
    };
  }

  function render(result, helpers) {
    const { esc, money, pct } = helpers;
    const m = incomeModel(result);
    const percentage = (share) => share == null ? '—' : pct(share, 1);
    let html = '<div class="income-composition">';
    html += '<p class="income-denominator">Source shares use <strong>' + esc(money(m.positiveIncome)) + '</strong> of positive income before source losses. Losses reduce the total below.</p>';

    if (m.sources.length) {
      html += '<table class="income-source-table"><caption class="source-detail">Income reported on Form 1040, line 9</caption><thead><tr><th scope="col">Income source</th><th scope="col" class="source-amount">Amount</th><th scope="col" class="source-share">Share</th></tr></thead><tbody>';
      m.sources.forEach((source) => {
        const loss = source.amount < 0;
        html += '<tr' + (loss ? ' class="source-loss-row"' : '') + '><th scope="row"><span class="source-label">' + esc(source.label) + '</span><span class="source-detail">' + esc(source.detail) + '</span>';
        if (!loss && source.share != null) {
          html += '<span class="source-bar-track" aria-hidden="true"><span class="source-bar" style="width:' + (source.share * 100).toFixed(4) + '%"></span></span>';
        }
        html += '</th><td class="source-amount">' + esc(money(source.amount)) + '</td><td class="source-share">' + esc(percentage(source.share)) + '</td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<p class="income-empty">No income reported on line 9.</p>';
    }

    html += '<dl class="income-reconciliation"><div><dt>Positive income</dt><dd>' + esc(money(m.positiveIncome)) + '</dd></div>';
    if (m.lossAdjustments < 0) html += '<div><dt>Source losses</dt><dd>' + esc(money(m.lossAdjustments)) + '</dd></div>';
    html += '<div class="income-total"><dt>Total income · line 9</dt><dd>' + esc(money(m.totalIncome)) + '</dd></div></dl>';
    if (m.positiveIncome === 0 && m.lossAdjustments < 0) html += '<p class="source-detail">Source shares are unavailable because there is no positive income.</p>';

    html += '<div class="tax-outcome"><div class="tax-outcome-item"><span>Total federal tax · line 24</span><strong>' + esc(money(m.tax)) + '</strong><span class="source-detail">' + (m.taxShare == null ? 'Income share unavailable when line 9 is zero or negative' : esc(pct(m.taxShare, 1)) + ' of total income on line 9') + '</span></div>';
    html += '<div class="tax-outcome-item' + (m.incomeLessTax < 0 ? ' source-loss-row' : '') + '"><span>Income less federal tax</span><strong>' + esc(money(m.incomeLessTax)) + '</strong><span class="source-detail">Line 9 minus line 24</span></div></div>';
    html += '<p class="tax-outcome-note">Return-income comparison; excludes tax-exempt income and cash-flow items. Withholding and estimated payments affect the balance due, not total tax.</p>';
    return html + '</div>';
  }

  render.data = incomeModel;
  root.TMDashboardCharts = render;
  if (typeof module !== 'undefined' && module.exports) module.exports = render;
})(typeof window !== 'undefined' ? window : globalThis);
