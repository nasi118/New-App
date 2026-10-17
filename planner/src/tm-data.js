/* Workbook exchange: validate and preview before committing imported records. */
(function (root) {
  'use strict';
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const signature = (value) => JSON.stringify({ data: value.data, audit: value.audit });
  const safeName = (value) => String(value || 'workspace').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 65);
  function auditKey(entry, clients) {
    const match = /^tm\.clients\.(\d+)(\.|$)/.exec(entry.path || '');
    const clientId = entry.clientId || (match && clients[+match[1]] && clients[+match[1]].id) || '';
    return JSON.stringify([entry.ts, entry.by, clientId, match ? entry.path.replace(/^tm\.clients\.\d+/, 'client') : entry.path, entry.from, entry.to, entry.note, !!entry.undone]);
  }
  function mergeState(current, incoming, mode) {
    const next = mode === 'replace' ? clone(incoming) : clone(current);
    const oldSettings = current.settings || {};
    next.settings = Object.assign({}, next.settings || {}, { apiKey: oldSettings.apiKey || '', rememberKey: !!oldSettings.rememberKey });
    if (mode === 'replace') next.audit = next.audit.map((entry) => Object.assign(entry, { noUndo: true, imported: true }));
    if (mode !== 'replace') {
      const touched = new Set(incoming.data.tm.clients.map((client) => client.id));
      // A complete client replacement starts a new source timeline. Earlier row
      // indexes may identify different documents after an import; never replay
      // old Undo actions against those replacement records.
      next.audit.forEach((entry) => {
        const path = String(entry.path || ''), match = /^tm\.clients\.(\d+)(\.|$)/.exec(path);
        const indexed = match && current.data.tm.clients[+match[1]];
        const clientId = entry.clientId || indexed && indexed.id;
        const ambiguous = /^tm(?:\.clients)?$/.test(path) || match && (!indexed || entry.clientId && entry.clientId !== indexed.id) || entry.unresolvedClient || path.startsWith('archive:tm.');
        if (touched.has(clientId) || ambiguous) Object.assign(entry, { noUndo: true, importCheckpoint: true });
      });
      const destination = next.data.tm.clients;
      const indexMap = new Map();
      incoming.data.tm.clients.forEach((client, sourceIndex) => {
        let index = destination.findIndex((record) => record.id === client.id);
        if (index < 0) { index = destination.length; destination.push(clone(client)); }
        else destination[index] = clone(client);
        indexMap.set(sourceIndex, index);
      });
      next.data.tm.active = destination.some((client) => client.id === incoming.data.tm.active) ? incoming.data.tm.active : next.data.tm.active;
      const seen = new Set(next.audit.map((entry) => auditKey(entry, destination)));
      (incoming.audit || []).forEach((entry) => {
        const restored = clone(entry);
        const match = /^tm\.clients\.(\d+)(\.|$)/.exec(restored.path || '');
        if (match) {
          const stableIndex = restored.clientId ? incoming.data.tm.clients.findIndex((record) => record.id === restored.clientId) : -1;
          const sourceIndex = stableIndex >= 0 ? stableIndex : +match[1];
          const newIndex = indexMap.get(sourceIndex), client = incoming.data.tm.clients[sourceIndex];
          if (newIndex == null || restored.clientId && client.id !== restored.clientId) {
            const archived = Object.assign(restored, { path: 'archive:' + restored.path, imported: true, noUndo: true });
            const key = auditKey(archived, destination); if (!seen.has(key)) { next.audit.push(archived); seen.add(key); }
            return;
          }
          restored.path = restored.path.replace(/^tm\.clients\.\d+/, 'tm.clients.' + newIndex);
          restored.clientId = client.id; restored.clientName = client.info.name; restored.recordYear = client.info.year;
        } else if (!restored.clientId && !restored.unresolvedClient && !String(restored.path || '').startsWith('archive:tm.clients.')) return; // shared workbook examples are not replaced in merge mode
        const key = auditKey(restored, destination);
        if (!seen.has(key)) { next.audit.push(Object.assign(restored, { noUndo: true, imported: true })); seen.add(key); }
      });
    }
    return next;
  }
  function checkCalculations(candidate) {
    candidate.data.tm.clients.forEach((client) => {
      const walk = root.TM.walkClient(client);
      walk.cols.forEach((column) => {
        if (![column.r.agi, column.r.f.l9, column.r.f.l15, column.r.f.l24, column.r.f.l33].every(Number.isFinite)) throw new Error('The imported return contains an invalid calculated amount.');
      });
    });
    const data = candidate.data;
    root.Engine.w1040Findings(data.w1040, { taxSource: candidate.settings.taxSource, niitSource: candidate.settings.niitSource });
    root.Engine.calcRental(data.rental, candidate.settings.mode, { threshold: candidate.settings.rentalThreshold, phaseRange: candidate.settings.rentalPhaseRange, marginalRate: candidate.settings.rentalMarginal });
    root.Engine.calcHnwi(data.hnwi);
    return candidate;
  }
  function factory(api) {
    const { state, esc, money, head, render, toast, save, invalidate, go } = api;
    let pending = null, error = '', busy = false, mode = 'merge';
    const exported = () => ({ data: state.data, settings: state.settings, audit: state.audit });
    const clean = (candidate) => root.TMExcel.validateState(candidate);
    const download = (content, name, type) => {
      const url = URL.createObjectURL(new Blob([content], { type }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    function prepare(candidate, source) {
      const incoming = clean(candidate);
      const merged = checkCalculations(mergeState(exported(), incoming, mode));
      pending = { incoming, merged, source, before: signature(exported()) };
      error = ''; render();
    }
    function applyImportedState(imported, options) {
      const incoming = clean(imported && imported.state || imported);
      const next = checkCalculations(mergeState(exported(), incoming, options && options.mode || 'replace'));
      const previous = exported();
      try {
        state.data = next.data; state.settings = Object.assign({}, state.settings, next.settings); state.audit = next.audit;
        state.audit.push({ ts: new Date().toISOString(), by: 'you', path: 'tm', from: previous.data.tm.clients.length, to: next.data.tm.clients.length,
          note: (options && options.source || 'Workbook') + ' import applied after preview', noUndo: true });
        state.ui.walkCol = 0; state.ui.walkPanel = null; state.ui.sel = {}; invalidate();
        api.compute();
        if (save() === false) throw new Error('Import was not applied because this browser could not save the workspace. Existing client records have been preserved. Export a backup and free browser storage before retrying.');
      } catch (exception) {
        state.data = previous.data; state.settings = previous.settings; state.audit = previous.audit; invalidate(); throw exception;
      }
      pending = null; error = ''; render(); toast('Import applied. All modules and return columns have been recalculated.');
      return { ok: true, clients: state.data.tm.clients.length };
    }
    async function receiveFile(file) {
      if (!file || busy) return;
      busy = true; error = ''; render();
      try {
        if (file.size > 32 * 1024 * 1024) throw new Error('Choose a workbook or JSON backup smaller than 32 MB.');
        const incoming = /\.json$/i.test(file.name) ? JSON.parse(await file.text()) : (await root.TMExcel.decode(file)).state;
        busy = false; prepare(incoming, file.name); go('data');
      } catch (exception) { busy = false; pending = null; error = exception.message || 'Could not read the file.'; render(); }
    }
    function previewMarkup() {
      if (!pending) return '';
      const current = state.data.tm.clients;
      const rows = pending.incoming.data.tm.clients.map((client) => {
        const previous = current.find((record) => record.id === client.id);
        const result = root.TM.walkClient(client).cols[0].r;
        const oldResult = previous && root.TM.walkClient(previous).cols[0].r;
        return '<tr><td>' + esc(client.info.name) + '<div class="small muted">TY' + client.info.year + ' · ' + esc(client.id) + '</div></td><td>' + (previous ? 'Update matching client' : 'Add new client') + '</td><td class="n">' + (oldResult ? money(oldResult.f.l24) : '—') + '</td><td class="n">' + money(result.f.l24) + '</td></tr>';
      });
      return '<section class="panel pad tm-import-preview"><h2>Review import · ' + esc(pending.source) + '</h2><p>Nothing has been changed. Review the destination and calculated results before applying.</p>' +
        '<label class="field">Import destination<select id="dataImportMode" class="cell"><option value="merge"' + (mode === 'merge' ? ' selected' : '') + '>Update matching clients and add new clients</option><option value="replace"' + (mode === 'replace' ? ' selected' : '') + '>Replace the entire workspace from this backup</option></select></label>' +
        '<p class="small">' + (mode === 'merge' ? 'Client IDs identify matches. Each imported client replaces that client’s source ledgers, columns and notes. Other clients and shared workbook examples remain in place.' : 'All clients, shared workbook examples, settings and audit history are replaced by the validated backup. The current browser’s private provider key is retained.') + '</p>' +
        '<div class="tablewrap"><table class="t"><thead><tr><th>Client</th><th>Action</th><th class="n">Current base tax</th><th class="n">Imported base tax</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div><p class="small muted">Tax figures are recalculated from imported inputs. They are not copied from the workbook’s output sheets.</p>' +
        '<div class="tm-data-actions"><button class="btn primary" data-action="data-apply">Apply reviewed import</button><button class="btn" data-action="data-cancel">Cancel import</button></div></section>';
    }
    function view() {
      return head('Library', 'Import & export', 'Move editable client records between Tax Master, Excel and your backups. Imported changes are validated and previewed before they are applied.') +
        '<div class="grid2"><section class="panel pad"><h2>Excel workbook</h2><p>Export all clients, source ledgers, planning columns, elections, adjustments, notes, compliance entries and audit history. Summary and 1040 comparison tabs show the calculated results.</p><p class="small muted">Edit the typed input tables described on the workbook’s Workbook info tab. Output tabs are reports. Arbitrary tax-software spreadsheets need a column mapping before they can be imported.</p><div class="tm-data-actions"><button class="btn primary" data-action="workbook-export">Export Excel (.xlsx)</button><button class="btn" data-action="workbook-import">Import Excel / JSON</button></div></section>' +
        '<section class="panel pad"><h2>Backups & connections</h2><p>A JSON backup stores the same application records. Private provider keys and Google authorization tokens are excluded from exports.</p><div class="tm-data-actions"><button class="btn" data-action="data-json">Download JSON backup</button><a class="btn" href="#connections">Google Sheets connection</a><a class="btn" href="#clients">New client / prior-year roll-forward</a></div><p class="small"><a href="#guide">Read the import and data-flow guide</a></p></section></div>' +
        '<input id="tmWorkbookFile" type="file" accept=".xlsx,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json" hidden>' +
        (busy ? '<p role="status">Reading and validating the workbook…</p>' : '') + (error ? '<div class="banner bad" role="alert">' + esc(error) + '</div>' : '') + previewMarkup();
    }
    function action(actionName) {
      if (actionName === 'workbook-import' || actionName === 'import-excel') { go('data'); setTimeout(() => document.getElementById('tmWorkbookFile')?.click(), 0); return true; }
      if (actionName === 'workbook-export' || actionName === 'export-excel') {
        try { const bytes = root.TMExcel.encode(exported(), { walkClient: root.TM.walkClient }); root.TMExcel.download(bytes, 'Tax-Master-' + safeName(api.active().info.name) + '.xlsx'); toast('Excel workbook exported, including every client and planning column.'); }
        catch (exception) { toast('Export failed: ' + exception.message); }
        return true;
      }
      if (actionName === 'data-json') { download(JSON.stringify(clean(exported()), null, 2), 'tax-master-backup.json', 'application/json'); return true; }
      if (actionName === 'data-cancel') { pending = null; error = ''; render(); return true; }
      if (actionName === 'data-apply') {
        try {
          if (!pending) return true;
          if (pending.before !== signature(exported())) throw new Error('Inputs changed while the preview was open. Select the import destination again to refresh this preview before applying.');
          applyImportedState(pending.incoming, { mode, source: pending.source });
        } catch (exception) { error = exception.message; render(); }
        return true;
      }
      return false;
    }
    function onChange(element) {
      if (element.id === 'tmWorkbookFile') { receiveFile(element.files && element.files[0]); return true; }
      if (element.id === 'dataImportMode') { mode = element.value === 'replace' ? 'replace' : 'merge'; if (pending) { try { prepare(pending.incoming, pending.source); } catch (exception) { error = exception.message; render(); } } return true; }
      return false;
    }
    return { VIEWS: { data: view }, action, onChange, receiveFile, prepare, applyImportedState };
  }
  factory.mergeState = mergeState; factory.checkCalculations = checkCalculations;
  root.TMDataUI = factory;
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
})(typeof window !== 'undefined' ? window : globalThis);
