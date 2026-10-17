/* Dashboard comparisons use the current walk calculation. Prior-year figures
   are historical inputs from Client information, not a reconstructed return. */
(function (root) {
  'use strict';
  const METRICS = [
    { key: 'tax', label: 'Total federal tax', detail: 'Form 1040, line 24' },
    { key: 'agi', label: 'Adjusted gross income', detail: 'Form 1040, line 11' },
    { key: 'taxable', label: 'Taxable income', detail: 'Form 1040, line 15' },
    { key: 'effective', label: 'Effective tax rate', detail: 'Total federal tax divided by positive AGI', rate: true },
    { key: 'balance', label: 'Refund / balance due', detail: 'Positive = refund; negative = balance due' },
  ];
  const number = (value) => !['number', 'string'].includes(typeof value) || typeof value === 'string' && value.trim() === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const finite = (value) => Number.isFinite(value) ? value : null;
  function change(current, prior) {
    const delta = current == null || prior == null ? null : finite(current - prior);
    return { delta, percent: delta == null || prior <= 0 ? null : finite(delta / prior) };
  }
  function axis(value, maximum) {
    value = number(value);
    const width = value == null || !Number.isFinite(maximum) || maximum <= 0 ? 0 : Math.min(50, Math.max(0, 50 * (Math.abs(value) / maximum)));
    return { width, left: value < 0 ? 50 - width : 50, negative: value < 0, zero: value === 0 };
  }
  function metricValue(result, key) {
    const r = result || {}, f = r.f || {};
    if (key === 'agi') return number(r.agi);
    if (key === 'taxable') return number(f.l15);
    if (key === 'effective') return number(r.agi) > 0 ? number(r.effective) : null;
    if (key === 'balance') return number(r.net);
    return number(f.l24);
  }
  function data(client, walk, metric = 'tax') {
    const info = client && client.info || {}, columns = walk && walk.cols || [], base = columns[0] || {}, result = base.r || {};
    const year = number(base.col && base.col.year) || number(info.year);
    const priorYear = year == null ? null : year - 1;
    const history = [
      { key: 'agi', label: 'Adjusted gross income', detail: 'Form 1040, line 11', current: number(result.agi), prior: number(info.priorAgi) },
      { key: 'tax', label: 'Total federal tax', detail: 'Form 1040, line 24', current: number(result.f && result.f.l24), prior: number(info.priorTax) },
    ].map((row) => {
      const maximum = Math.max(Math.abs(row.current || 0), Math.abs(row.prior || 0), 1);
      return { ...row, ...change(row.current, row.prior), maximum, currentBar: axis(row.current, maximum), priorBar: axis(row.prior, maximum) };
    });
    const selected = METRICS.find((item) => item.key === metric) || METRICS[0];
    const baseValue = metricValue(result, selected.key);
    const planning = columns.map((column, index) => {
      const value = metricValue(column.r, selected.key), metadata = column.col || {};
      return { id: metadata.id || String(index), index, name: metadata.name || (index ? 'Plan ' + index : 'Base'), year: number(metadata.year), status: metadata.status || '',
        value, delta: value == null || baseValue == null ? null : finite(value - baseValue) };
    });
    const maximum = Math.max(...planning.map((row) => Math.abs(row.value || 0)), 0);
    return { year, priorYear, history, missingHistory: history.some((row) => row.prior == null),
      metric: { ...selected }, metrics: METRICS.map((item) => ({ ...item })), planning: planning.map((row) => ({ ...row, bar: axis(row.value, maximum) })) };
  }
  function render(client, walk, helpers) {
    const { esc, money, pct } = helpers;
    const model = data(client, walk, helpers.metric);
    const signed = (value, isRate) => (value > 0 ? '+' : '') + (isRate ? pct(value, 1) : money(value));
    const amount = (value) => value == null ? 'Not entered' : money(value);
    const graph = (bar) => '<span class="trend-track" aria-hidden="true"><span class="trend-zero"></span><span class="trend-bar' + (bar.negative ? ' trend-negative' : '') + '" style="left:' + bar.left.toFixed(4) + '%;width:' + bar.width.toFixed(4) + '%"></span></span>';
    let html = '<section class="tm-trends cpanel" aria-labelledby="dashboard-trends-title"><header><h2 id="dashboard-trends-title">Year-over-year & planning comparisons</h2><a class="small" href="#client">Edit prior-year figures</a></header>';
    html += '<p class="small muted trend-intro">Current amounts flow from this client’s source modules and Form 1040 base. Prior-year AGI and tax are historical figures entered in Client information; they are not recalculated here.</p><div class="trend-history">';
    model.history.forEach((row) => {
      const year = model.year == null ? 'Current year' : 'TY' + model.year, prior = model.priorYear == null ? 'Prior year' : 'TY' + model.priorYear;
      html += '<article class="trend-history-card"><h3>' + esc(row.label) + '</h3><span class="small muted">' + esc(row.detail) + '</span><div class="trend-value-row"><span>' + esc(prior) + ' · entered</span><strong>' + esc(amount(row.prior)) + '</strong></div>' + graph(row.priorBar) +
        '<div class="trend-value-row"><span>' + esc(year) + ' · current base</span><strong>' + esc(amount(row.current)) + '</strong></div>' + graph(row.currentBar);
      if (row.prior == null) html += '<p class="small trend-change"><a href="#client">Enter prior-year ' + (row.key === 'agi' ? 'AGI' : 'total tax') + '</a> to compare.</p>';
      else if (row.delta == null) html += '<p class="small muted trend-change">Change unavailable.</p>';
      else html += '<p class="small trend-change"><strong>' + esc(signed(row.delta, false)) + '</strong> change' + (row.percent == null ? '<span class="muted"> · percentage unavailable' + (row.prior <= 0 ? ' when the prior amount is zero or negative' : '') + '</span>' : ' · ' + esc(signed(row.percent, true))) + '</p>';
      html += '</article>';
    });
    html += '</div><div class="trend-planning"><div class="trend-planning-heading"><div><h3>Compare return columns</h3><p class="small muted">' + esc(model.metric.detail) + '</p></div><label class="field">Comparison metric<select class="cell" id="dashboard-comparison-metric" data-trend-metric="1" aria-label="Dashboard comparison metric">' + model.metrics.map((metric) => '<option value="' + esc(metric.key) + '"' + (metric.key === model.metric.key ? ' selected' : '') + '>' + esc(metric.label) + '</option>').join('') + '</select></label></div>';
    html += '<div class="trend-column-list">' + model.planning.map((row) => {
      const rate = !!model.metric.rate;
      const value = row.value == null ? 'Unavailable' : rate ? pct(row.value, 1) : money(row.value);
      const outcome = model.metric.key === 'balance' && row.value != null ? row.value > 0 ? ' · refund' : row.value < 0 ? ' · balance due' : ' · settled' : '';
      const delta = row.index && row.delta != null ? rate ? (row.delta > 0 ? '+' : '') + (row.delta * 100).toFixed(1) + ' percentage points vs base' : signed(row.delta, false) + ' vs base' : '';
      return '<div class="trend-column"><div class="trend-value-row"><span><strong>' + esc(row.index ? 'P' + row.index : 'Base') + '</strong> · ' + esc(row.name) + '<span class="muted">' + esc((row.year == null ? '' : ' · TY' + row.year) + (row.status ? ' · ' + row.status.toUpperCase() : '')) + '</span></span><strong>' + esc(value + outcome) + '</strong></div>' + graph(row.bar) + (delta ? '<div class="small muted trend-column-delta">' + esc(delta) + '</div>' : '') + (rate && row.value == null ? '<div class="small muted trend-column-delta">A positive AGI is needed to calculate the effective rate.</div>' : '') + '</div>';
    }).join('') + '</div>';
    if (model.planning.length < 2) html += '<p class="small muted">Add a planning column on the <a href="#walk">Form 1040 walk</a> to compare alternatives.</p>';
    html += '<p class="small muted trend-axis-note">Bars share a scale within each comparison. The center line is zero; negative values extend left and positive values extend right. Bar lengths show magnitude. Withholding and estimates change the refund or balance due, rather than total tax.</p></div></section>';
    return html;
  }
  render.data = data; render.axis = axis; render.metrics = METRICS.map((metric) => ({ ...metric }));
  root.TMTrends = render;
  if (typeof module !== 'undefined' && module.exports) module.exports = render;
})(typeof window !== 'undefined' ? window : globalThis);
