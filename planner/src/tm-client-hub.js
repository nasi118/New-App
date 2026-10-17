/* Client register and local change history. Pure helpers also run in Node.
   A roll-forward creates a separate record; it never changes the prior year. */
(function (root) {
  'use strict';
  const TM = root.TM || (typeof require !== 'undefined' ? require('./tm-modules.js') : null);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const YEARS = [2025, 2026];
  const label = (client) => client && client.info && (client.info.name || [client.info.tpFirst, client.info.tpLast].filter(Boolean).join(' ')) || 'Client';
  function newId() {
    const crypto = root.crypto || (typeof require !== 'undefined' ? require('node:crypto') : null);
    if (crypto && crypto.randomUUID) return 'client-' + crypto.randomUUID();
    if (!crypto || !crypto.getRandomValues) throw new Error('Secure client ID generation is unavailable in this browser.');
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return 'client-' + h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function nextClientNumber(clients) {
    const used = new Set((clients || []).map((c) => String((c.info || {}).clientNumber || '').trim().toUpperCase()));
    let i = 1;
    while (used.has('C' + String(i).padStart(4, '0'))) i++;
    return 'C' + String(i).padStart(4, '0');
  }
  function createBlankClient(options = {}) {
    const name = String(options.name || '').trim();
    const year = Number(options.year == null ? 2026 : options.year);
    const status = options.status || 'mfj';
    if (!name) throw new Error('Enter a client name.');
    if (name.length > 160) throw new Error('Keep the client name to 160 characters.');
    if (!YEARS.includes(year)) throw new Error('Only tax years 2025 and 2026 have supported calculation parameters.');
    if (!TM.STATUSES.some(([key]) => key === status)) throw new Error('Choose a supported filing status.');
    return {
      id: newId(),
      info: { name, clientNumber: nextClientNumber(options.existingClients), year, status,
        tpFirst: '', tpLast: '', tpDob: '', tpBlind: false, spFirst: '', spLast: '', spDob: '', spBlind: false,
        state: '', address: '', occupation: '', priorTax: null, priorAgi: null, preparer: '', reviewer: '', notes: '', baseName: 'TY' + year + ' base' },
      deps: [], w2: [], other: {},
      mod: {
        portfolio: { interest: [], dividends: [] }, schC: { businesses: [], sepIra: 0, seHealth: 0 },
        capital: { invest: [], business: [], stCarry: 0, ltCarry: 0, priorNonrecap1231: 0 },
        equity: { iso: [], nso: [], rsu: [], restricted: [], sales: [], amtCreditPrior: 0 },
        rents: { rep: false, properties: [] }, k1: { entities: [] }, itemized: {}, qbi: { carry: 0 },
      },
      direct: {}, adjustments: {}, elections: {}, cols: [],
      scen: { growth: 0.03, scenarios: [{ name: 'Baseline', levers: {} }] }, notes: {},
    };
  }
  function rollForwardClient(prior, options = {}) {
    if (!prior || !prior.info) throw new Error('Choose a prior-year client.');
    const priorYear = Number(prior.info.year), year = Number(options.year == null ? priorYear + 1 : options.year);
    if (year !== priorYear + 1) throw new Error('The new record must be for the immediately following tax year.');
    const client = createBlankClient({ ...options, name: options.name || label(prior), year, status: options.status || prior.info.status });
    if (options.copyIdentity === true) {
      for (const key of ['tpFirst', 'tpLast', 'tpDob', 'tpBlind', 'spFirst', 'spLast', 'spDob', 'spBlind', 'state', 'address', 'occupation', 'preparer', 'reviewer']) {
        if (prior.info[key] != null) client.info[key] = clone(prior.info[key]);
      }
      client.deps = clone(prior.deps || []).map((dependent) => ({ ...dependent,
        age: dependent.age != null && dependent.age !== '' && Number.isFinite(Number(dependent.age)) ? Number(dependent.age) + 1 : dependent.age }));
    }
    if (options.copySourceValues === true) {
      client.w2 = clone(prior.w2 || []); client.other = clone(prior.other || {});
      // Start with the full blank shape so older imports can omit a module.
      for (const key of Object.keys(client.mod)) if (prior.mod && prior.mod[key]) client.mod[key] = { ...client.mod[key], ...clone(prior.mod[key]) };
    }
    const base = TM.walkClient(prior).cols[0].r;
    if (!Number.isFinite(base.f.l24) || !Number.isFinite(base.agi)) throw new Error('The prior-year base return could not be calculated.');
    client.info.priorTax = base.f.l24; client.info.priorAgi = base.agi;
    client.rollForward = { priorClientId: prior.id, priorYear, copiedIdentity: options.copyIdentity === true, copiedSourceValues: options.copySourceValues === true };
    client.info.notes = 'Created from the TY' + priorYear + ' base return. Prior-year tax and AGI use its calculated results. ' +
      (options.copySourceValues === true ? 'Prior source inputs were copied by request. Review every amount, payment, transaction date, carryforward and eligibility fact for the new year.' : 'Financial source inputs start blank.');
    return client;
  }
  function resolveAuditClient(entry, clients) {
    if (entry.clientId) {
      const current = clients.find((c) => c.id === entry.clientId);
      return { id: entry.clientId, name: entry.clientName || (current && label(current)) || 'Unavailable client', legacy: false, global: false };
    }
    const match = /^tm\.clients\.(\d+)(?:\.|$)/.exec(String(entry.path || ''));
    if (match) {
      const index = Number(match[1]), current = clients[index];
      return { id: current ? current.id : null, name: 'Legacy index ' + (index + 1) + (current ? ' · currently ' + label(current) : ' · client unavailable'), legacy: true, global: false };
    }
    return { id: null, name: 'Workspace / global', legacy: false, global: true };
  }
  function auditRows(state, options = {}) {
    const tm = state.data && state.data.tm || { clients: [], active: null }, query = String(options.query || '').trim().toLowerCase();
    const selected = options.clientId || tm.active;
    return (state.audit || []).map((entry, index) => ({ entry, index, client: resolveAuditClient(entry, tm.clients || []) })).filter((row) => {
      if (row.client.global ? !options.includeGlobal : selected !== 'all' && row.client.id !== selected) return false;
      return !query || JSON.stringify([row.client.name, row.entry.ts, row.entry.by, row.entry.path, row.entry.from, row.entry.to, row.entry.note]).toLowerCase().includes(query);
    }).reverse();
  }

  function factory(api) {
    const { state, esc, money } = api;
    const tm = () => state.data.tm;
    const active = () => tm().clients.find((client) => client.id === tm().active) || tm().clients[0];
    const ui = () => state.ui.clientHub || (state.ui.clientHub = { mode: 'blank', name: '', year: 2026, status: 'mfj', copyIdentity: false, copySourceValues: false });
    const auditUI = () => state.ui.clientAudit || (state.ui.clientAudit = { scope: 'active', query: '', includeGlobal: false });
    const select = (field, current, options, aria) => '<select class="cell" id="hub-' + esc(field) + '" data-hub-field="' + esc(field) + '" aria-label="' + esc(aria || field) + '">' + options.map(([value, text]) => '<option value="' + esc(value) + '"' + (String(value) === String(current) ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select>';
    const textInput = (field, value, aria) => '<input class="cell txt" id="hub-' + esc(field) + '" data-hub-field="' + esc(field) + '" value="' + esc(value) + '" maxlength="160" aria-label="' + esc(aria) + '">';
    const checkbox = (field, checked, text) => '<label class="hub-check"><input type="checkbox" id="hub-' + esc(field) + '" data-hub-field="' + esc(field) + '"' + (checked ? ' checked' : '') + '> ' + esc(text) + '</label>';
    function clientsView() {
      const draft = ui(), prior = tm().clients.find((c) => c.id === draft.priorId) || active();
      const rolling = draft.mode === 'rollforward', unsupported = rolling && Number(prior.info.year) + 1 > 2026;
      let h = api.head('Workspace', 'Clients & tax years', 'Each record has its own source inputs, Form 1040, scenarios and reports. Start blank or create a separate next-year record from a prior return.', '<a class="btn" href="#client">Active client details</a>');
      h += '<section class="panel pad"><h2 class="hub-section-title">Create a client record</h2><div class="form">' +
        '<label class="field">Start with' + select('mode', draft.mode, [['blank', 'Blank client'], ['rollforward', 'Roll forward a prior year']]) + '</label>' +
        (rolling ? '<label class="field">Prior-year record' + select('priorId', prior.id, tm().clients.map((c) => [c.id, label(c) + ' · TY' + c.info.year])) + '</label>' : '') +
        '<label class="field">New record name' + textInput('name', draft.name, 'New client record name') + '</label>' +
        (rolling ? '<div class="field"><span>New tax year</span><strong>TY' + (Number(prior.info.year) + 1) + '</strong><span class="hint">The prior-year record stays unchanged.</span></div>' : '<label class="field">Tax year' + select('year', draft.year, YEARS.map((year) => [year, 'TY' + year])) + '</label>') +
        '<label class="field">Filing status' + select('status', draft.status, TM.STATUSES) + '</label></div>';
      if (rolling) {
        h += '<div class="hub-copy-options">' + checkbox('copyIdentity', draft.copyIdentity, 'Copy household names, dates of birth, address and dependents; advance dependent ages by one year.') +
          checkbox('copySourceValues', draft.copySourceValues, 'Copy prior source amounts as a starting point; review all amounts, dated transactions and payments.') + '</div>' +
          '<p class="small muted">Prior-year tax and AGI come from the prior base calculation. Planning columns, manual 1040 adjustments and elections start blank. Source inputs are copied only when selected above.</p>';
      } else h += '<p class="small muted">Every financial module starts empty. No demo names, dates of birth or planning amounts are copied. You can enter source documents manually or use Excel import from Data & sync.</p>';
      if (unsupported) h += '<div class="banner warn" role="status">TY' + (Number(prior.info.year) + 1) + ' parameters are not available. Roll-forward creation is disabled until that tax year is supported.</div>';
      if (draft.error) h += '<p class="neg" role="alert">' + esc(draft.error) + '</p>';
      h += '<div class="hub-actions"><button class="btn primary" data-action="hub-create"' + (unsupported ? ' disabled' : '') + '>' + (rolling ? 'Create separate next-year record' : 'Create blank client') + '</button><a class="btn" href="#data">Import / export Excel</a></div></section>';
      h += '<h2>Client register</h2><div class="tablewrap"><table class="t"><thead><tr><th>Client</th><th>Record number</th><th>Tax year</th><th>Filing status</th><th class="n">Federal tax</th><th>Open</th></tr></thead><tbody>' + tm().clients.map((client) => {
        const isActive = client.id === tm().active;
        let tax = 'Review inputs'; try { tax = money(TM.walkClient(client).cols[0].r.f.l24); } catch (_) { /* one invalid import must not hide the register */ }
        return '<tr' + (isActive ? ' class="selrow"' : '') + '><td><strong>' + esc(label(client)) + '</strong>' + (isActive ? '<span class="chip info">Active</span>' : '') + '</td><td>' + esc(client.info.clientNumber || 'Existing record') + '</td><td>TY' + esc(client.info.year) + '</td><td>' + esc(TM.statusLabel(client.info.status)) + '</td><td class="n">' + esc(tax) + '</td><td><button class="btn small" data-action="hub-open" data-client-id="' + esc(client.id) + '">Open client</button> <button class="btn small ghost" data-action="hub-rollforward" data-client-id="' + esc(client.id) + '">Next year</button></td></tr>';
      }).join('') + '</tbody></table></div><p class="small muted">Client records are kept in this browser. Export a backup before moving devices. This register does not delete prior records.</p>';
      return h;
    }
    function formatValue(value) {
      if (value == null) return '<span class="muted">—</span>';
      const full = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
      if (full.length < 100 && !full.includes('\n')) return esc(full);
      return '<details class="hub-audit-value"><summary>' + esc(full.replace(/\s+/g, ' ').slice(0, 90)) + '…</summary><pre>' + esc(full) + '</pre></details>';
    }
    const friendlyPath = (path) => String(path || '').replace(/^tm\.clients\.\d+\.?/, '').replace(/^mod\./, '').replace(/\.(\d+)\./g, (_, i) => ' › row ' + (Number(i) + 1) + ' › ').replace(/\./g, ' › ').replace(/([a-z])([A-Z])/g, '$1 $2');
    function auditView() {
      const filter = auditUI(), scope = filter.scope === 'active' ? tm().active : filter.scope;
      const rows = auditRows(state, { clientId: scope, query: filter.query, includeGlobal: filter.includeGlobal });
      let h = api.head('Review', 'Audit trail', 'A searchable history of changes saved in this browser, including advisor edits and reversals. Select a client to follow its inputs.');
      h += '<div class="panel pad"><div class="form"><label class="field">Client scope<select class="cell" id="hub-audit-scope" data-hub-audit="scope"><option value="active"' + (filter.scope === 'active' ? ' selected' : '') + '>Active client · ' + esc(label(active())) + '</option><option value="all"' + (filter.scope === 'all' ? ' selected' : '') + '>All clients</option>' + tm().clients.map((c) => '<option value="' + esc(c.id) + '"' + (filter.scope === c.id ? ' selected' : '') + '>' + esc(label(c)) + ' · TY' + esc(c.info.year) + '</option>').join('') + '</select></label><label class="field">Search changes<input class="cell txt" id="hub-audit-query" type="search" data-hub-audit="query" value="' + esc(filter.query) + '" placeholder="Input, actor, reason, amount"></label></div><label class="hub-check"><input type="checkbox" data-hub-audit="includeGlobal"' + (filter.includeGlobal ? ' checked' : '') + '> Include workspace settings and global events</label><p class="small muted">' + rows.length + ' matching change' + (rows.length === 1 ? '' : 's') + '. Older entries without a saved client ID are labeled “Legacy index”; their current index association may differ from the original if a legacy record was removed or imported. This local history is not independent audit verification.</p></div>';
      h += '<div class="tablewrap hub-audit-wrap"><table class="t"><thead><tr><th>Timestamp</th><th>Client</th><th>Actor</th><th>Input</th><th>Before</th><th>After</th><th>Reason</th><th>Undo</th></tr></thead><tbody>' + (rows.length ? rows.map(({ entry, index, client }) => {
        const date = new Date(entry.ts), when = Number.isNaN(date.getTime()) ? entry.ts || 'Unknown time' : date.toLocaleString();
        return '<tr><td class="small">' + esc(when) + '</td><td class="small">' + esc(client.name) + (entry.recordYear ? '<div class="muted">TY' + esc(entry.recordYear) + '</div>' : '') + '</td><td>' + esc(entry.by === 'advisor' ? 'AI advisor' : entry.by || 'Local user') + '</td><td class="small"><strong>' + esc(friendlyPath(entry.path)) + '</strong><div class="muted hub-path">' + esc(entry.path) + '</div></td><td class="small">' + formatValue(entry.from) + '</td><td class="small">' + formatValue(entry.to) + '</td><td class="small">' + esc(entry.note || 'Input updated') + '</td><td>' + (entry.undone ? '<span class="muted small">Undone</span>' : entry.noUndo ? (entry.importCheckpoint ? '<span class="muted small" title="An import replaced this client record. Earlier changes remain in the history and cannot be undone.">Before import</span>' : '<span class="muted small">Recorded</span>') : '<button class="btn small" data-action="hub-undo" data-index="' + index + '">Undo</button>') + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="muted">No changes match these filters.</td></tr>') + '</tbody></table></div>';
      return h;
    }
    function startRollForward(client) {
      Object.assign(ui(), { mode: 'rollforward', priorId: client.id, name: label(client), status: client.info.status, copyIdentity: false, copySourceValues: false, error: '' });
      api.go('clients'); api.render(); return true;
    }
    function action(actionName, element) {
      if (typeof actionName !== 'string') return false;
      if (['new-client', 'hub-new-client'].includes(actionName)) { state.ui.clientHub = { mode: 'blank', name: '', year: 2026, status: 'mfj', copyIdentity: false, copySourceValues: false }; api.go('clients'); api.render(); return true; }
      if (actionName === 'dup-client') return startRollForward(active());
      if (actionName.startsWith('del-client')) { state.ui.confirmDelClient = false; api.toast('Client records are retained. Use Clients & tax years to create a separate blank or next-year record.'); api.render(); return true; }
      if (actionName === 'hub-open') {
        const selected = tm().clients.find((client) => client.id === element.dataset.clientId);
        if (!selected) return true;
        tm().active = selected.id; state.ui.walkCol = 0; state.ui.sel = {}; api.save(); api.invalidate(); api.go('client'); api.render(); return true;
      }
      if (actionName === 'hub-rollforward') { const selected = tm().clients.find((client) => client.id === element.dataset.clientId); return selected ? startRollForward(selected) : true; }
      if (actionName === 'hub-create') {
        const draft = ui();
        try {
          const options = { ...draft, existingClients: tm().clients };
          const prior = tm().clients.find((client) => client.id === draft.priorId) || active();
          const client = draft.mode === 'rollforward' ? rollForwardClient(prior, { ...options, year: Number(prior.info.year) + 1 }) : createBlankClient(options);
          tm().clients.push(client); tm().active = client.id; state.ui.walkCol = 0; state.ui.sel = {};
          state.audit.push({ ts: new Date().toISOString(), by: 'you', path: 'tm.clients.' + (tm().clients.length - 1), clientId: client.id, clientName: label(client), recordYear: client.info.year,
            from: null, to: { id: client.id, clientNumber: client.info.clientNumber, name: label(client), year: client.info.year, ...(client.rollForward || {}) },
            note: draft.mode === 'rollforward' ? 'Created separate next-year record; prior record preserved' : 'Created blank client with empty source modules', noUndo: true });
          draft.error = ''; api.save(); api.invalidate(); api.go('client'); api.render(); api.toast('Created ' + label(client) + ' · TY' + client.info.year + '.');
        } catch (error) { draft.error = error.message; api.render(); }
        return true;
      }
      if (actionName === 'hub-undo') { const index = Number(element.dataset.index), entry = state.audit[index]; if (entry && !entry.noUndo && !entry.undone) api.undo(index); return true; }
      return false;
    }
    function onChange(element) {
      if (element.dataset.hubField) {
        const draft = ui(), field = element.dataset.hubField;
        if (!['mode', 'name', 'year', 'status', 'priorId', 'copyIdentity', 'copySourceValues'].includes(field)) return false;
        draft[field] = element.type === 'checkbox' ? element.checked : field === 'year' ? Number(element.value) : element.value;
        draft.error = '';
        if (field === 'priorId' || field === 'mode' && draft.mode === 'rollforward') {
          const prior = tm().clients.find((client) => client.id === draft.priorId) || active();
          draft.priorId = prior.id; draft.name = label(prior); draft.status = prior.info.status;
          draft.copyIdentity = false; draft.copySourceValues = false;
        }
        // A text blur immediately before Create must not replace that button.
        if (field !== 'name') api.render();
        return true;
      }
      if (element.dataset.hubAudit) {
        const field = element.dataset.hubAudit;
        if (!['scope', 'query', 'includeGlobal'].includes(field)) return false;
        auditUI()[field] = element.type === 'checkbox' ? element.checked : element.value; api.render(); return true;
      }
      return false;
    }
    return { VIEWS: { clients: clientsView, audit: auditView }, action, onChange };
  }
  Object.assign(factory, { createBlankClient, rollForwardClient, nextClientNumber, resolveAuditClient, auditRows, supportedYears: YEARS.slice() });
  root.TMClientHub = factory;
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
})(typeof window !== 'undefined' ? window : globalThis);
