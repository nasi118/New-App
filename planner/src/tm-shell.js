/* Navigation, appearance preferences and a movable tools rail. UI preferences are
   stored separately from client data; changing them never recalculates a return. */
(function () {
  'use strict';
  const STORE = 'tax-master-planner.ui.v1';
  const DEFAULTS = {
    theme: 'system', palette: 'blue', font: 'system', fontSize: 15, density: 'comfortable',
    customText: '', customBackground: '', customAccent: '', tableBorders: 'rows',
    borderStyle: 'solid', borderWidth: 1, contentWidth: 'full', railWidth: 248, toolsWidth: 300,
    toolsOpen: true, collapsed: {}, toolCollapsed: {}, toolOrder: ['calculate', 'calculator', 'exchange', 'resources'],
    workspace: 'planning', lastView: { planning: 'home', compliance: 'c-client' },
  };
  const FONTS = {
    system: ['System sans', 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'],
    sans: ['Arial / Helvetica', 'Arial, Helvetica, sans-serif'],
    humanist: ['Verdana', 'Verdana, Geneva, sans-serif'],
    serif: ['Georgia', 'Georgia, "Times New Roman", serif'],
    mono: ['Monospace', 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace'],
  };
  const PALETTES = {
    blue: ['Blue', '#1D4ED8', '#93C5FD'], slate: ['Slate', '#334155', '#CBD5E1'],
    teal: ['Teal', '#0F766E', '#99F6E4'], plum: ['Plum', '#6B21A8', '#D8B4FE'],
  };
  const SHARED = new Set(['clients']);
  const LIBRARY = [
    ['clients', 'Client list'], ['guide', 'User guide'], ['planning-guide', 'Planning guide'],
    ['references', 'Reference library'], ['audit', 'Audit trail'], ['data', 'Import & export'],
    ['connections', 'Google Sheets connection'], ['settings', 'Settings'],
  ];
  const EXAMPLES = [
    { id: 'workbook-examples', title: 'Workbook examples · training', closed: true, items: [['c-home', 'Example review dashboard'], ['w-tie', 'Example 1040 tie-out'], ['findings', 'Example review findings'], ['calendar', 'Example filing calendar'], ['w-sources', 'Example source documents'], ['w-sched', 'Example schedules'], ['w-review', 'Example sign-off'], ['r-props', 'Example rental properties'], ['r-469', 'Example rental election'], ['r-199a', 'Example rental positions'], ['r-statements', 'Example election statements']] },
    { id: 'wealth-examples', title: 'Wealth strategy · example client', closed: true, items: [['h-dash', 'Example strategy dashboard'], ['h-matrix', 'Example strategy matrix'], ['h-cost', 'Example cost-benefit'], ['h-check', 'Example implementation']] },
  ];
  const GROUPS = {
    planning: [
      { id: 'planning-overview', title: 'Client workspace', items: [['home', 'Summary dashboard'], ['client', 'Client information'], ['walk', 'Form 1040 walk']] },
      { id: 'planning-inputs', title: 'Income & deductions', closed: true, items: [['m-portfolio', 'Portfolio income'], ['m-schc', 'Schedule C · business income'], ['m-capital', 'Capital transactions'], ['m-rents', 'Rents & royalty'], ['m-k1', 'Passthrough income · K-1'], ['m-qbi', 'QBI workbench'], ['m-itemized', 'Itemized deductions']] },
      { id: 'planning-scenarios', title: 'Planning & analysis', items: [['scen', 'Tax scenarios & estimates'], ['planning-guide', 'Planning guide'], ['ai-analysis', 'AI analysis'], ['report', 'Client report']] },
    ],
    compliance: [
      { id: 'compliance-current', title: 'Active client · compliance', items: [['c-client', 'Compliance overview'], ['c-reconcile', 'Source & return reconciliation'], ['report', 'Client report']] },
    ],
  };
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const color = (v) => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : '';
  const clamp = (v, min, max, fallback) => Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : fallback;
  function rgb(v) { return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)); }
  function hex(v) { return '#' + v.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase(); }
  function mix(a, b, p) { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * p)); }
  function luminance(v) { return rgb(v).map((x) => { x /= 255; return x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }).reduce((a, x, i) => a + x * [.2126, .7152, .0722][i], 0); }
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function readable(fg, backgrounds, target) {
    const good = (c) => backgrounds.every((b) => contrast(c, b) >= target);
    if (good(fg)) return fg;
    const score = (c) => Math.min(...backgrounds.map((b) => contrast(c, b)));
    const end = score('#000000') >= score('#FFFFFF') ? '#000000' : '#FFFFFF';
    for (let i = 1; i <= 100; i++) { const candidate = mix(fg, end, i / 100); if (good(candidate)) return candidate; }
    return end;
  }
  function normalize(raw) {
    const p = Object.assign(copy(DEFAULTS), raw || {});
    if (!['system', 'light', 'dark'].includes(p.theme)) p.theme = 'system';
    if (!PALETTES[p.palette]) p.palette = 'blue';
    if (!FONTS[p.font]) p.font = 'system';
    p.fontSize = clamp(p.fontSize, 13, 20, 15);
    if (!['compact', 'comfortable', 'spacious'].includes(p.density)) p.density = 'comfortable';
    ['customText', 'customBackground', 'customAccent'].forEach((k) => { p[k] = color(p[k]); });
    if (!['rows', 'grid', 'none'].includes(p.tableBorders)) p.tableBorders = 'rows';
    if (!['solid', 'dashed', 'dotted'].includes(p.borderStyle)) p.borderStyle = 'solid';
    p.borderWidth = clamp(p.borderWidth, 1, 3, 1);
    if (!['full', '1200', '1440', '1680'].includes(String(p.contentWidth))) p.contentWidth = 'full';
    p.railWidth = clamp(p.railWidth, 220, 320, 248); p.toolsWidth = clamp(p.toolsWidth, 260, 420, 300);
    p.toolsOpen = p.toolsOpen !== false;
    p.collapsed = p.collapsed && typeof p.collapsed === 'object' && !Array.isArray(p.collapsed) ? p.collapsed : {};
    p.toolCollapsed = p.toolCollapsed && typeof p.toolCollapsed === 'object' && !Array.isArray(p.toolCollapsed) ? p.toolCollapsed : {};
    const allowed = DEFAULTS.toolOrder;
    p.toolOrder = [...new Set([...(Array.isArray(p.toolOrder) ? p.toolOrder.filter((x) => allowed.includes(x)) : []), ...allowed])];
    p.workspace = p.workspace === 'compliance' ? 'compliance' : 'planning';
    p.lastView = Object.assign({}, DEFAULTS.lastView, p.lastView && typeof p.lastView === 'object' ? p.lastView : {});
    return p;
  }
  window.TMShell = function (api) {
    const state = api.state;
    const esc = api.esc || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    let initial = null;
    try { initial = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) { /* unavailable storage */ }
    let prefs = normalize(initial || { theme: state.settings.theme || 'system', workspace: state.settings.workspace });
    let lastRoute = null;
    let mobileToolsOpen = false;
    let effective = null;
    let note = '';
    let focusAfterRender = '';
    const calc = { expression: '', output: '', tape: [] };
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
    const toast = (s) => api.toast && api.toast(s);
    function persist() {
      try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (_) { /* keep in memory */ }
      const settingsChanged = state.settings.workspace !== prefs.workspace || state.settings.theme !== prefs.theme;
      state.settings.workspace = prefs.workspace;
      state.settings.theme = prefs.theme;
      if (settingsChanged && api.save) api.save();
    }
    function render() { if (api.render) api.render(); }
    function context(view) {
      let workspace = prefs.workspace;
      if (!SHARED.has(view) && !LIBRARY.some(([k]) => k === view) && view !== 'report') {
        for (const [ws, groups] of Object.entries(GROUPS)) if (groups.some((g) => g.items.some(([k]) => k === view))) { workspace = ws; break; }
      }
      const groups = GROUPS[workspace];
      const group = groups.find((g) => g.items.some(([k]) => k === view)) || EXAMPLES.find((g) => g.items.some(([k]) => k === view));
      return { workspace, label: workspace === 'compliance' ? 'Compliance' : 'Planning', group: group ? group.title : 'Library', groupId: group ? group.id : 'library', shared: SHARED.has(view) };
    }
    function syncRoute(view) {
      const c = context(view);
      let changed = false;
      if (prefs.workspace !== c.workspace) { prefs.workspace = c.workspace; changed = true; }
      if (view !== lastRoute) {
        mobileToolsOpen = false;
        if (prefs.collapsed[c.groupId] !== false) { prefs.collapsed[c.groupId] = false; changed = true; }
        if (!LIBRARY.some(([k]) => k === view)) { prefs.lastView[c.workspace] = view; changed = true; }
        lastRoute = view;
      }
      if (changed) persist();
      return c;
    }
    function renderNav(opts) {
      opts = opts || {}; const view = opts.view || state.view; const c = syncRoute(view); const counts = opts.counts || {};
      const link = ([key, title]) => '<a href="#' + esc(key) + '"' + (key === view ? ' class="on" aria-current="page"' : '') + '><span>' + esc(title) + '</span>' + (Number(counts[key]) > 0 ? '<span class="count">' + Number(counts[key]) + '</span>' : '') + '</a>';
      const group = (g) => {
        const closed = Object.prototype.hasOwnProperty.call(prefs.collapsed, g.id) ? prefs.collapsed[g.id] : !!g.closed;
        const active = g.items.some(([key]) => key === view);
        return '<section class="tms-nav-group' + (active ? ' tms-group-current' : '') + '"><button class="tms-group-toggle" data-action="shell-nav-group" data-key="' + esc(g.id) + '" aria-expanded="' + !closed + '" aria-controls="tms-nav-' + esc(g.id) + '"><span>' + esc(g.title) + '</span><span class="tms-chevron" aria-hidden="true">' + (closed ? '›' : '⌄') + '</span></button><div class="nav tms-nav-items" id="tms-nav-' + esc(g.id) + '"' + (closed ? ' hidden' : '') + '>' + g.items.map(link).join('') + '</div></section>';
      };
      let h = '<div class="tms-workspace-switch" role="group" aria-label="Workspace">' + ['planning', 'compliance'].map((ws) => '<button data-action="shell-workspace" data-val="' + ws + '" aria-pressed="' + (c.workspace === ws) + '" class="' + (c.workspace === ws ? 'on' : '') + '">' + (ws === 'planning' ? 'Planning' : 'Compliance') + '</button>').join('') + '</div>';
      h += '<p class="tms-workspace-hint">' + (c.workspace === 'planning' ? 'Explore strategies, projections and decisions.' : 'Enter source data, review and prepare filing.') + '</p>';
      h += GROUPS[c.workspace].map(group).join('');
      h += '<div class="tms-workspace-bridge"><button class="btn small" data-action="shell-workspace" data-val="' + (c.workspace === 'planning' ? 'compliance' : 'planning') + '">' + (c.workspace === 'planning' ? 'Open compliance workspace' : 'Open planning workspace') + '</button><span>Both workspaces use the same active client.</span></div>';
      h += group({ id: 'library', title: 'Library & settings', items: LIBRARY, closed: true });
      h += '<div class="tms-library-shortcuts"><a href="#settings">Settings</a><a href="#references">References</a><a href="#guide">Help</a></div>';
      h += EXAMPLES.map(group).join('');
      return h;
    }
    function appearanceColors() {
      const modeDark = prefs.theme === 'dark' || prefs.theme === 'system' && media.matches;
      const paper = prefs.customBackground || (modeDark ? '#111827' : '#F4F6F8');
      // Keep custom surfaces on the same side of the black/white text crossover.
      // Mid-tone backgrounds otherwise cannot share one readable font color.
      const dark = luminance(paper) < .179;
      const surface = prefs.customBackground ? mix(paper, dark ? '#000000' : '#FFFFFF', dark ? .1 : .76) : dark ? '#182233' : '#FFFFFF';
      const surface2 = prefs.customBackground ? mix(paper, dark ? '#000000' : '#FFFFFF', dark ? .16 : .1) : dark ? '#202D40' : '#F1F4F8';
      const backgrounds = [paper, surface, surface2];
      const ink = readable(prefs.customText || (dark ? '#F1F5F9' : '#172230'), backgrounds, 4.5);
      const accent = readable(prefs.customAccent || PALETTES[prefs.palette][dark ? 2 : 1], backgrounds, 4.5);
      const accentInk = contrast(accent, '#FFFFFF') >= contrast(accent, '#111827') ? '#FFFFFF' : '#111827';
      const tintedAccent = mix(surface, accent, dark ? .15 : .07);
      const accentSoft = contrast(accent, tintedAccent) >= 4.5 ? tintedAccent : surface;
      const semantic = {};
      [['good', dark ? '#9ED8AF' : '#166534', dark ? '#1D342A' : '#F0F8F2'], ['warn', dark ? '#F5D089' : '#854D0E', dark ? '#382F1D' : '#FFF8EB'], ['bad', dark ? '#FFB0A9' : '#B42318', dark ? '#3B2428' : '#FFF1F0']].forEach(([name, fg, soft]) => {
        semantic[name + 'Soft'] = prefs.customBackground ? mix(surface, fg, .06) : soft;
        semantic[name] = readable(fg, backgrounds.concat(semantic[name + 'Soft']), 4.5);
      });
      return Object.assign({ paper, surface, surface2, ink, dark, accent, accentInk,
        ink2: readable(mix(ink, surface, .15), backgrounds, 4.5), ink3: readable(mix(ink, surface, .28), backgrounds, 4.5),
        line: dark ? mix(surface, '#FFFFFF', .19) : mix(surface, '#172230', .16),
        lineStrong: dark ? mix(surface, '#FFFFFF', .38) : mix(surface, '#172230', .35),
        accentSoft,
      }, semantic);
    }
    function applyAppearance() {
      const root = document.documentElement;
      effective = appearanceColors(); const c = effective;
      root.dataset.theme = prefs.theme === 'system' ? '' : prefs.theme;
      if (prefs.theme === 'system') delete root.dataset.theme;
      root.dataset.shellDensity = prefs.density; root.dataset.shellBorders = prefs.tableBorders;
      root.style.colorScheme = c.dark ? 'dark' : 'light';
      const vars = {
        '--paper': c.paper, '--surface': c.surface, '--surface-2': c.surface2,
        '--ink': c.ink, '--ink-2': c.ink2, '--ink-3': c.ink3,
        '--line': c.line, '--line-strong': c.lineStrong, '--accent': c.accent,
        '--accent-ink': c.accentInk, '--accent-soft': c.accentSoft, '--mark': c.accent,
        '--input-bg': c.surface, '--input-line': c.lineStrong,
        '--sans': FONTS[prefs.font][1], '--display': 'var(--sans)', '--mono': 'var(--sans)',
        '--shell-font-size': prefs.fontSize + 'px', '--shell-font-scale': String(prefs.fontSize / 15),
        '--shell-row-padding': ({ compact: 5, comfortable: 9, spacious: 13 })[prefs.density] + 'px',
        '--shell-row-x': ({ compact: 9, comfortable: 12, spacious: 15 })[prefs.density] + 'px',
        '--shell-rail-width': prefs.railWidth + 'px', '--shell-tools-width': prefs.toolsWidth + 'px',
        '--shell-content-width': prefs.contentWidth === 'full' ? 'none' : prefs.contentWidth + 'px',
        '--shell-border-width': prefs.borderWidth + 'px', '--shell-border-style': prefs.borderStyle,
        '--good': c.good, '--good-soft': c.goodSoft,
        '--warn': c.warn, '--warn-soft': c.warnSoft,
        '--bad': c.bad, '--bad-soft': c.badSoft,
        '--info': c.accent, '--info-soft': c.accentSoft,
      };
      Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
      const app = document.querySelector('.app'); if (app) { app.classList.add('tms-shell'); app.classList.toggle('tools-open', prefs.toolsOpen); }
      return c;
    }
    const prefInput = (key, value, type, attrs) => '<input id="tms-pref-' + key + '" data-shell-pref="' + key + '" type="' + (type || 'text') + '" value="' + esc(value) + '" ' + (attrs || '') + '>';
    const prefSelect = (key, options) => '<select id="tms-pref-' + key + '" data-shell-pref="' + key + '">' + options.map(([v, text]) => '<option value="' + esc(v) + '"' + (String(prefs[key]) === String(v) ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select>';
    function appearanceSettings() {
      const c = effective || appearanceColors();
      const range = (key, label, min, max, unit) => '<label class="field" for="tms-pref-' + key + '">' + esc(label) + '<div class="tms-range">' + prefInput(key, prefs[key], 'range', 'min="' + min + '" max="' + max + '" step="1"') + '<output data-shell-output="' + key + '">' + esc(prefs[key]) + (unit || '') + '</output></div></label>';
      const custom = (key, label, shown) => '<div class="field"><label for="tms-pref-' + key + '">' + esc(label) + '</label><div class="tms-color-field">' + prefInput(key, prefs[key] || shown, 'color', 'aria-label="' + esc(label) + '"') + '<span>' + (prefs[key] ? esc(prefs[key]) : 'Automatic') + '</span><button class="btn small" data-action="shell-color-reset" data-key="' + key + '"' + (!prefs[key] ? ' disabled' : '') + '>Auto</button></div></div>';
      let h = '<section id="appearance" class="tms-appearance"><h2>Appearance & layout</h2><p class="lede">Customize this browser’s workspace. These preferences leave client inputs and tax calculations unchanged.</p><div class="panel pad"><div class="form">';
      h += '<label class="field" for="tms-pref-theme">Theme' + prefSelect('theme', [['system', 'Use device setting'], ['light', 'Light'], ['dark', 'Dark']]) + '</label>';
      h += '<label class="field" for="tms-pref-palette">Color theme' + prefSelect('palette', Object.entries(PALETTES).map(([k, v]) => [k, v[0]])) + '</label>';
      h += '<label class="field" for="tms-pref-font">Font family' + prefSelect('font', Object.entries(FONTS).map(([k, v]) => [k, v[0]])) + '</label>';
      h += range('fontSize', 'Font size', 13, 20, 'px');
      h += '<label class="field" for="tms-pref-density">Row spacing' + prefSelect('density', [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]) + '</label>';
      h += custom('customText', 'Font color', c.ink) + custom('customBackground', 'Background color', c.paper) + custom('customAccent', 'Accent color', c.accent);
      h += '</div><p class="small muted tms-color-note">Text and accent colors are adjusted when needed for at least 4.5:1 contrast on the workspace surfaces. Custom colors override the automatic theme colors; choose Auto to follow the theme. Status colors retain their meaning.</p><div class="tms-appearance-preview"><strong>Preview · Form 1040</strong><span>Readable labels, editable values and clear table rows.</span><div class="tablewrap"><table class="t"><thead><tr><th>Line</th><th>Description</th><th class="n">Amount</th></tr></thead><tbody><tr><td>11a</td><td>Adjusted gross income</td><td class="n">$125,000</td></tr><tr><td>15</td><td>Taxable income</td><td class="n">$93,500</td></tr></tbody></table></div></div></div>';
      h += '<div class="panel pad tms-appearance-layout"><div class="form"><label class="field" for="tms-pref-tableBorders">Table borders' + prefSelect('tableBorders', [['rows', 'Horizontal rows'], ['grid', 'Full grid'], ['none', 'No row borders']]) + '</label><label class="field" for="tms-pref-borderStyle">Border style' + prefSelect('borderStyle', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]) + '</label>';
      h += range('borderWidth', 'Border width', 1, 3, 'px');
      h += '<label class="field" for="tms-pref-contentWidth">Content width' + prefSelect('contentWidth', [['full', 'Fill available width'], ['1200', 'Up to 1,200px'], ['1440', 'Up to 1,440px'], ['1680', 'Up to 1,680px']]) + '</label>';
      h += range('railWidth', 'Navigation width', 220, 320, 'px') + range('toolsWidth', 'Tools width', 260, 420, 'px');
      h += '</div><p class="small muted">Move tool sections with the arrow buttons. Collapse any section to keep your workspace focused. Rail widths adapt to smaller screens.</p><button class="btn" id="tms-appearance-reset" data-action="shell-appearance-reset">Reset appearance & layout</button></div><p class="small muted" role="status" id="tmsAppearanceStatus">' + esc(note) + '</p></section>';
      return h;
    }
    function calculatorMarkup() {
      const values = metrics();
      return '<label class="field" for="shellCalcIn">Expression<input id="shellCalcIn" class="cell txt" value="' + esc(calc.expression) + '" placeholder="(125000 − 31500) × .22" autocomplete="off" inputmode="decimal"></label><output id="shellCalcOut" class="calc-out" aria-live="polite">' + esc(calc.output) + '</output><div class="tms-calc-buttons"><button class="btn small primary" data-action="shell-calc-equal">Calculate</button><button class="btn small" data-action="shell-calc-clear">Clear</button></div><label class="field" for="shellCalcMetric">Use a return value<select id="shellCalcMetric" class="cell">' + Object.entries(values).map(([key, m]) => '<option value="' + key + '">' + esc(m[0]) + '</option>').join('') + '</select></label><button class="btn small" data-action="shell-calc-insert">Insert value</button>' +
        (calc.tape.length ? '<details class="tms-calc-tape" open><summary>Calculation tape</summary><ol>' + calc.tape.map((item) => '<li><span>' + esc(item.expression) + '</span><strong>' + esc(item.result) + '</strong></li>').join('') + '</ol>' + (api.saveCalculatorNote ? '<button class="btn small" data-action="shell-calc-note">Save tape to client notes</button>' : '') + '</details>' : '');
    }
    function metrics() {
      const r = api.compute ? api.compute() : {};
      const x = r.tmw && r.tmw.cols && r.tmw.cols[0] && r.tmw.cols[0].r;
      return { agi: ['AGI', x ? x.agi : 0], taxable: ['Taxable income', x ? x.f.l15 : 0], tax: ['Total federal tax', x ? x.f.l24 : 0], se: ['Self-employment tax', x ? x.se.tax : 0], qbi: ['QBI deduction', x ? x.f.l13a : 0] };
    }
    function toolSection(id, title, body, index) {
      const closed = !!prefs.toolCollapsed[id];
      return '<section class="tms-tool-section" data-tool-section="' + id + '"><header><button class="tms-tool-toggle" data-action="shell-tool-collapse" data-key="' + id + '" aria-expanded="' + !closed + '" aria-controls="tms-tool-' + id + '"><span>' + title + '</span><span aria-hidden="true">' + (closed ? '›' : '⌄') + '</span></button><div class="tms-move-buttons" role="group" aria-label="Move ' + title + '"><button class="btn small" data-action="shell-tool-move" data-key="' + id + '" data-direction="-1" aria-label="Move ' + title + ' up"' + (index === 0 ? ' disabled' : '') + '>↑</button><button class="btn small" data-action="shell-tool-move" data-key="' + id + '" data-direction="1" aria-label="Move ' + title + ' down"' + (index === prefs.toolOrder.length - 1 ? ' disabled' : '') + '>↓</button></div></header><div class="tms-tool-body" id="tms-tool-' + id + '"' + (closed ? ' hidden' : '') + '>' + body + '</div></section>';
    }
    function toolsMarkup() {
      const bodies = {
        calculate: ['Return tools', '<button class="btn primary" data-action="shell-recalculate">Recalculate all views</button><p class="small muted">Calculations already update as you edit. Recalculate refreshes every view from the saved inputs.</p>' + (state.ui.shellLastRecalc ? '<p class="small muted" role="status">Last refreshed ' + esc(state.ui.shellLastRecalc) + '</p>' : '') + '<a class="btn small" href="#walk">Open Form 1040 walk</a>'],
        calculator: ['Calculator', api.calculatorMarkup ? api.calculatorMarkup() : calculatorMarkup()],
        exchange: ['Import, export & report', '<div class="tms-tool-links"><button class="btn" data-action="' + esc((api.actions || {}).export || 'workbook-export') + '">Export Excel workbook</button><button class="btn" data-action="' + esc((api.actions || {}).import || 'workbook-import') + '">Import Excel workbook</button><a class="btn" href="#data">Import & export options</a><a class="btn" href="#report">Generate client report</a><a class="btn" href="#connections">Google Sheets connection</a></div>'],
        resources: ['Guidance & review', '<div class="tms-tool-links"><a href="#guide">User guide</a><a href="#planning-guide">Planning guide</a><a href="#references">Regulatory reference library</a><a href="#audit">Audit trail</a><a href="#ai-analysis">AI analysis</a><a href="#settings">Appearance & settings</a></div>'],
      };
      return '<header class="tms-tools-head"><div><div class="eyebrow">Workspace</div><h2>Tools</h2></div><button class="btn small" data-action="shell-tools-toggle" aria-label="Close tools">Close</button></header><div class="tms-tools-tabs" role="group" aria-label="Right sidebar"><button class="on" aria-pressed="true">Tools</button><button data-action="shell-open-advisor" aria-pressed="false">AI advisor</button></div><div class="tms-tools-content">' + prefs.toolOrder.map((id, i) => toolSection(id, bodies[id][0], bodies[id][1], i)).join('') + '</div><footer class="tms-tools-footer"><label class="field" for="tmsToolsWidth">Rail width<input type="range" id="tmsToolsWidth" data-shell-pref="toolsWidth" min="260" max="420" step="1" value="' + prefs.toolsWidth + '"></label></footer>';
    }
    function syncRailVisibility() {
      const app = document.querySelector('.app');
      const visible = prefs.toolsOpen && (window.innerWidth > 1100 || mobileToolsOpen) && !(app && app.classList.contains('advisor-open'));
      const rail = document.getElementById('toolsRail');
      if (rail) rail.hidden = !visible;
      document.querySelectorAll('[data-action="shell-tools-toggle"]').forEach((el) => { if (!el.closest('#toolsRail')) el.setAttribute('aria-expanded', String(visible)); });
    }
    function syncMenuVisibility() {
      const app = document.querySelector('.app'), menu = document.querySelector('.topbar [data-action="menu"]');
      if (menu && app) { menu.setAttribute('aria-expanded', String(app.classList.contains('nav-open'))); menu.setAttribute('aria-controls', 'nav'); }
    }
    function afterRender() {
      applyAppearance();
      const app = document.querySelector('.app');
      if (app) app.classList.toggle('tms-mobile-tools-open', mobileToolsOpen);
      const rail = document.getElementById('toolsRail'); if (rail) rail.innerHTML = toolsMarkup();
      syncRailVisibility(); syncMenuVisibility();
      if (focusAfterRender) { const target = document.querySelector(focusAfterRender); focusAfterRender = ''; if (target) target.focus(); }
    }
    function setPref(key, value) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key) || ['collapsed', 'toolCollapsed', 'toolOrder', 'lastView', 'workspace', 'toolsOpen'].includes(key)) return false;
      prefs = normalize(Object.assign({}, prefs, { [key]: value }));
      effective = appearanceColors();
      note = (key === 'customText' && prefs.customText && prefs.customText !== effective.ink) || (key === 'customAccent' && prefs.customAccent && prefs.customAccent !== effective.accent) ? 'The chosen color was adjusted in the preview to keep text readable.' : 'Appearance saved in this browser.';
      persist(); applyAppearance();
      return true;
    }
    function onChange(el) {
      if (!el.dataset.shellPref) return false;
      if (setPref(el.dataset.shellPref, el.value)) {
        if (el.type === 'range') { const status = document.getElementById('tmsAppearanceStatus'); if (status) status.textContent = note; }
        else render();
      }
      return true;
    }
    function onInput(el) {
      if (el.id === 'shellCalcIn') { calc.expression = el.value; return true; }
      if (el.dataset.shellPref && el.type === 'range') {
        setPref(el.dataset.shellPref, el.value);
        document.querySelectorAll('[data-shell-output="' + el.dataset.shellPref + '"]').forEach((o) => { o.textContent = el.value + 'px'; });
        return true;
      }
      return false;
    }
    function evaluate() {
      const expr = calc.expression.replace(/[$,]/g, '').replace(/×/g, '*').replace(/[−–]/g, '-').replace(/÷/g, '/');
      try {
        if (!expr.trim()) { calc.output = ''; return; }
        if (!window.Engine || !window.Engine.evalFormula) throw new Error('unavailable');
        const answer = window.Engine.evalFormula(expr, () => 0);
        if (typeof answer !== 'number' || !Number.isFinite(answer)) throw new Error('invalid');
        calc.output = '= ' + answer.toLocaleString('en-US', { maximumFractionDigits: 4 });
        calc.tape.push({ expression: calc.expression, result: calc.output }); calc.tape = calc.tape.slice(-12);
      } catch (_) { calc.output = 'Enter a valid expression, such as (125000 − 31500) × .22.'; }
    }
    function action(a, t) {
      if (a === 'shell-nav-group') { const g = t.dataset.key; const known = [...GROUPS.planning, ...GROUPS.compliance, ...EXAMPLES].find((x) => x.id === g); const before = Object.prototype.hasOwnProperty.call(prefs.collapsed, g) ? prefs.collapsed[g] : !!(known && known.closed); prefs.collapsed[g] = !before; focusAfterRender = '[data-action="shell-nav-group"][data-key="' + g + '"]'; persist(); render(); return true; }
      if (a === 'shell-workspace') {
        const ws = t.dataset.val === 'compliance' ? 'compliance' : 'planning';
        focusAfterRender = '.tms-workspace-switch [data-val="' + ws + '"]';
        prefs.workspace = ws; persist();
        if (SHARED.has(state.view) || LIBRARY.some(([key]) => key === state.view) || state.view === 'report') { render(); }
        else { lastRoute = null; api.go(prefs.lastView[ws] || (ws === 'compliance' ? 'c-client' : 'home')); }
        return true;
      }
      if (a === 'shell-tools-toggle') {
        const app = document.querySelector('.app');
        if (app && app.classList.contains('advisor-open')) { if (window.Advisor) window.Advisor.toggle(); prefs.toolsOpen = true; mobileToolsOpen = window.innerWidth <= 1100; }
        else if (window.innerWidth <= 1100) { mobileToolsOpen = !mobileToolsOpen; prefs.toolsOpen = true; }
        else prefs.toolsOpen = !prefs.toolsOpen;
        persist(); afterRender();
        if (prefs.toolsOpen && window.innerWidth <= 1100) { const close = document.querySelector('#toolsRail [data-action="shell-tools-toggle"]'); if (close) close.focus(); }
        if (!prefs.toolsOpen || window.innerWidth <= 1100 && !mobileToolsOpen) { const trigger = document.querySelector('.topbar [data-action="shell-tools-toggle"]'); if (trigger) trigger.focus(); }
        return true;
      }
      if (a === 'shell-open-advisor') { const app = document.querySelector('.app'); if (window.Advisor && app && !app.classList.contains('advisor-open')) window.Advisor.toggle(); return true; }
      if (a === 'shell-tool-collapse') { prefs.toolCollapsed[t.dataset.key] = !prefs.toolCollapsed[t.dataset.key]; focusAfterRender = '[data-action="shell-tool-collapse"][data-key="' + t.dataset.key + '"]'; persist(); render(); return true; }
      if (a === 'shell-tool-move') { const i = prefs.toolOrder.indexOf(t.dataset.key), j = i + Number(t.dataset.direction); if (i >= 0 && j >= 0 && j < prefs.toolOrder.length) { [prefs.toolOrder[i], prefs.toolOrder[j]] = [prefs.toolOrder[j], prefs.toolOrder[i]]; persist(); render(); const button = document.querySelector('[data-tool-section="' + t.dataset.key + '"] [data-action="shell-tool-collapse"]'); if (button) button.focus(); toast('Moved ' + t.dataset.key + ' ' + (j < i ? 'up' : 'down') + '.'); } return true; }
      if (a === 'shell-recalculate') {
        state.ui.shellLastRecalc = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        focusAfterRender = '#toolsRail [data-action="shell-recalculate"]';
        if (api.recalculate) api.recalculate();
        else { if (api.invalidate) api.invalidate(); render(); toast('Recalculated all views from the current client inputs.'); }
        return true;
      }
      if (a === 'shell-color-reset') { setPref(t.dataset.key, ''); render(); return true; }
      if (a === 'shell-appearance-reset') { const keep = { workspace: prefs.workspace, collapsed: prefs.collapsed, lastView: prefs.lastView }; prefs = normalize(Object.assign(copy(DEFAULTS), keep)); note = 'Restored the default appearance, widths and tools arrangement.'; persist(); render(); return true; }
      if (a === 'shell-calc-equal') { evaluate(); focusAfterRender = '[data-action="shell-calc-equal"]'; render(); return true; }
      if (a === 'shell-calc-clear') { calc.expression = ''; calc.output = ''; render(); const el = document.getElementById('shellCalcIn'); if (el) el.focus(); return true; }
      if (a === 'shell-calc-insert') { const el = document.getElementById('shellCalcMetric'); const m = metrics()[el ? el.value : 'agi']; calc.expression += String(m ? m[1] : 0); render(); const input = document.getElementById('shellCalcIn'); if (input) input.focus(); return true; }
      if (a === 'shell-calc-note') { if (api.saveCalculatorNote) { api.saveCalculatorNote(calc.tape.map((item) => item.expression + ' ' + item.result).join('\n')); toast('Saved the calculation tape to the active client’s notes.'); } return true; }
      return false;
    }
    function onKeydown(e) {
      if (e.target.id === 'shellCalcIn' && e.key === 'Enter') { e.preventDefault(); evaluate(); focusAfterRender = '#shellCalcIn'; render(); return true; }
      if (e.key === 'Escape' && mobileToolsOpen && window.innerWidth <= 1100 && document.getElementById('toolsRail') && document.getElementById('toolsRail').contains(e.target)) { mobileToolsOpen = false; afterRender(); const trigger = document.querySelector('.topbar [data-action="shell-tools-toggle"]'); if (trigger) trigger.focus(); return true; }
      if (e.key === 'Escape' && window.innerWidth <= 820) { const app = document.querySelector('.app'); if (app && app.classList.contains('nav-open')) { app.classList.remove('nav-open'); syncMenuVisibility(); const trigger = document.querySelector('.topbar [data-action="menu"]'); if (trigger) trigger.focus(); return true; } }
      return false;
    }
    if (media.addEventListener) media.addEventListener('change', () => { if (prefs.theme === 'system') { applyAppearance(); if (state.view === 'settings') render(); } });
    if (window.matchMedia) { const small = window.matchMedia('(max-width: 1100px)'); if (small.addEventListener) small.addEventListener('change', () => { mobileToolsOpen = false; afterRender(); }); }
    const appElement = document.querySelector('.app');
    if (appElement && window.MutationObserver) { let advisorOpen = appElement.classList.contains('advisor-open'), navOpen = appElement.classList.contains('nav-open'); new MutationObserver(() => { const next = appElement.classList.contains('advisor-open'), nextNav = appElement.classList.contains('nav-open'); if (next !== advisorOpen) { advisorOpen = next; syncRailVisibility(); } if (nextNav !== navOpen) { navOpen = nextNav; syncMenuVisibility(); if (nextNav && window.innerWidth <= 820) { const first = document.querySelector('.tms-workspace-switch button'); if (first) first.focus(); } } }).observe(appElement, { attributes: true, attributeFilter: ['class'] }); }
    persist();
    return { renderNav, context, syncRoute, applyAppearance, appearanceSettings, toolsMarkup, afterRender, action, onChange, onInput, onKeydown,
      preferences: () => copy(prefs), routes: () => {
        const entries = Object.entries(GROUPS).flatMap(([workspace, groups]) => groups.flatMap((g) => g.items.map(([key, label]) => ({ key, label, group: g.title, workspace }))));
        entries.push(...LIBRARY.map(([key, label]) => ({ key, label, group: 'Library', workspace: null })), ...EXAMPLES.flatMap((g) => g.items.map(([key, label]) => ({ key, label, group: g.title, workspace: null }))));
        return [...new Map(entries.map((entry) => [entry.key, entry])).values()];
      },
    };
  };
})();
