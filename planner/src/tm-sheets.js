/* Tax Master Planner: explicit, per-account Google Sheets transfers.
   OAuth access tokens live only in this closure, never in app state or exports. */
(function (root) {
  'use strict';
  const PREFIX = 'TM_';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const META = 'TM_Sync';
  const MANAGED = new Set(['Workbook info', 'Workspace', 'Clients', 'Sources', 'Plans', 'Notes', 'Audit', 'Summary', '1040 comparison', 'Module totals'].map((n) => PREFIX + n).concat(META));
  const REVIEW = new Set(['TM_Summary', 'TM_1040 comparison', 'TM_Module totals', META]);
  const MAX_CELLS = 300000;
  const normalize = (rows) => {
    const out = (rows || []).map((r) => {
      const row = r.map((v) => v == null ? '' : v);
      while (row.length && row[row.length - 1] === '') row.pop();
      return row;
    });
    while (out.length && !out[out.length - 1].length) out.pop();
    return out;
  };
  function ordered(model) {
    return (model.sheets || []).map((s) => ({ name: s.name, rows: normalize(s.rows) })).sort((a, b) => a.name.localeCompare(b.name));
  }
  function fingerprint(model) {
    // Deterministic content checksum for conflict detection, not authentication.
    const str = JSON.stringify(ordered(model)); let a = 2166136261, b = 2246822519;
    for (let i = 0; i < str.length; i++) { a = Math.imul(a ^ str.charCodeAt(i), 16777619); b = Math.imul(b ^ str.charCodeAt(i), 3266489917); }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0') + ':' + str.length;
  }
  function diff(local, remote) {
    const names = new Set([...(local.sheets || []).map((s) => s.name), ...(remote.sheets || []).map((s) => s.name)]);
    return [...names].sort().map((name) => {
      const a = normalize((local.sheets.find((s) => s.name === name) || {}).rows), b = normalize((remote.sheets.find((s) => s.name === name) || {}).rows);
      let cells = 0;
      for (let r = 0; r < Math.max(a.length, b.length); r++) for (let c = 0; c < Math.max((a[r] || []).length, (b[r] || []).length); c++) if (JSON.stringify((a[r] || [])[c] ?? '') !== JSON.stringify((b[r] || [])[c] ?? '')) cells++;
      return { name, localRows: a.length, remoteRows: b.length, changedCells: cells };
    });
  }
  function spreadsheetId(value) {
    const raw = String(value || '').trim(), match = /\/spreadsheets\/d\/([\w-]+)/.exec(raw), id = match ? match[1] : raw;
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new Error('Enter a valid Google spreadsheet URL or ID.');
    return id;
  }
  function cell(value) {
    if (value === '' || value == null) return {};
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('A workbook cell is not a finite number.'); return { userEnteredValue: { numberValue: value } }; }
    if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
    // stringValue deliberately prevents formula injection and locale conversions.
    return { userEnteredValue: { stringValue: String(value) } };
  }
  function updateRequests(model, existing) {
    let nextId = Math.max(0, ...existing.map((s) => s.properties.sheetId)) + 1, count = 0;
    const requests = [];
    model.sheets.forEach((s) => {
      if (!MANAGED.has(s.name)) throw new Error('Only known Tax Master managed tabs may be written.');
      const rows = normalize(s.rows), cols = Math.max(1, ...rows.map((r) => r.length));
      count += rows.length * cols;
      if (count > MAX_CELLS) throw new Error('This workbook exceeds the Google Sheets transfer limit of 300,000 cells. Use Excel export instead.');
      let found = existing.find((x) => x.properties.title === s.name), id;
      if (found) {
        id = found.properties.sheetId;
        const grid = found.properties.gridProperties || {};
        requests.push({ updateSheetProperties: { properties: { sheetId: id, gridProperties: { rowCount: Math.max(rows.length, grid.rowCount || 0, 100), columnCount: Math.max(cols, grid.columnCount || 0, 10) } }, fields: 'gridProperties.rowCount,gridProperties.columnCount' } });
      } else { id = nextId++; requests.push({ addSheet: { properties: { sheetId: id, title: s.name, gridProperties: { rowCount: Math.max(rows.length, 100), columnCount: Math.max(cols, 10) } } } }); }
      // A complete sheet range plus fields=userEnteredValue also clears stale rows.
      // Formatting is preserved on existing managed tabs; unrelated tabs are untouched.
      requests.push({ updateCells: { range: { sheetId: id }, rows: rows.map((r) => ({ values: r.map(cell) })), fields: 'userEnteredValue' } });
    });
    return requests;
  }
  const Core = { PREFIX, SCOPE, META, normalize, fingerprint, diff, spreadsheetId, updateRequests };
  root.TMGoogleSheetsCore = Core;

  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let script = document.querySelector('script[data-tm-google="' + src + '"]');
      if (!script) { script = document.createElement('script'); script.src = src; script.async = true; script.dataset.tmGoogle = src; document.head.appendChild(script); }
      const timer = setTimeout(() => { script.remove(); reject(new Error('Google did not load. Check your connection and browser content blockers, then reconnect.')); }, 15000);
      const done = () => { clearTimeout(timer); ready() ? resolve() : reject(new Error('Google sign-in is unavailable in this browser.')); };
      script.addEventListener('load', done, { once: true });
      script.addEventListener('error', () => { clearTimeout(timer); script.remove(); reject(new Error('Google could not be reached. Check your internet connection.')); }, { once: true });
    });
  }

  root.TMSheets = function (api, deps) {
    deps = deps || {};
    const state = api.state, esc = api.esc || ((v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const fetcher = deps.fetch || root.fetch.bind(root), now = deps.now || Date.now;
    let access = '', expires = 0, busy = false, disposed = false, pending = null, message = '', error = '', account = '', serverClientId = '';
    function prefs() { return state.settings.googleSheets || (state.settings.googleSheets = {}); }
    function paint() { if (!disposed && api.render) api.render(); }
    function persist() { if (api.save) api.save(); }
    function connected() { return !!access && now() < expires; }
    function clearAccess() { access = ''; expires = 0; account = ''; pending = null; }
    async function run(fn) {
      if (busy) return;
      busy = true; error = ''; message = ''; paint();
      try { return await fn(); } catch (e) { error = e && e.message || 'Google Sheets operation failed.'; pending = null; return null; }
      finally { busy = false; paint(); }
    }
    function excel() { const x = deps.workbook || root.TMExcel; if (!x || !x.toWorkbook || !x.fromWorkbook) throw new Error('The Excel workbook module must be loaded before Google Sheets transfers.'); return x; }
    function localModel() {
      const m = excel().toWorkbook(state, api.workbookOptions ? api.workbookOptions() : {});
      return { sheets: m.sheets.map((s) => ({ name: PREFIX + s.name, rows: s.rows })) };
    }
    function requireAccess() {
      if (!connected()) { clearAccess(); throw new Error('Your Google connection has expired or is disconnected. Connect Google again; your local work is saved.'); }
    }
    async function request(url, options) {
      requireAccess();
      let res;
      try { res = await fetcher(url, Object.assign({}, options, { headers: Object.assign({ Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' }, options && options.headers) })); }
      catch (_) { throw new Error('Google could not be reached. Check your internet connection; no local data was changed.'); }
      let body; try { body = await res.json(); } catch (_) { throw new Error('Google returned an unreadable response. Try again.'); }
      if (!res.ok) {
        if (res.status === 401) { clearAccess(); throw new Error('Google authorization expired or was revoked. Connect Google again.'); }
        if (res.status === 403 || res.status === 404) throw new Error('This Google account cannot access that spreadsheet. Choose it with Google Picker, use a sheet created by this app, or check sharing permissions and the enabled Google APIs.');
        if (res.status === 429) throw new Error('Google has temporarily limited requests. Wait a moment and retry.');
        throw new Error('Google Sheets request failed (' + res.status + '). No local changes were applied.');
      }
      return body;
    }
    async function read(id) {
      const metadata = await request('https://sheets.googleapis.com/v4/spreadsheets/' + id + '?fields=spreadsheetId,spreadsheetUrl,properties(title),sheets(properties(sheetId,title,gridProperties))');
      const managed = (metadata.sheets || []).filter((s) => MANAGED.has(s.properties.title));
      let grids = [];
      if (managed.length) {
        const query = managed.map((s) => 'ranges=' + encodeURIComponent("'" + s.properties.title.replace(/'/g, "''") + "'" )).join('&');
        // Read actual entered cell types. Values-only reads would flatten formulas
        // and fail to notice formula edits that happen to produce the same value.
        const fields = 'sheets(properties(title),data(startRow,startColumn,rowData(values(userEnteredValue))))';
        const result = await request('https://sheets.googleapis.com/v4/spreadsheets/' + id + '?includeGridData=true&fields=' + encodeURIComponent(fields) + '&' + query);
        grids = result.sheets || [];
      }
      const formulas = [];
      const model = { sheets: managed.filter((s) => s.properties.title !== META).map((s) => {
        const name = s.properties.title, grid = grids.find((g) => g.properties.title === name), rows = [];
        for (const block of grid && grid.data || []) for (const [i, row] of (block.rowData || []).entries()) {
          const r = (block.startRow || 0) + i; rows[r] = rows[r] || [];
          for (const [j, entry] of (row.values || []).entries()) {
            const value = entry.userEnteredValue || {}, c = (block.startColumn || 0) + j;
            if (Object.prototype.hasOwnProperty.call(value, 'formulaValue')) {
              rows[r][c] = { __tmFormula: value.formulaValue };
              if (!REVIEW.has(name)) formulas.push({ sheet: name, row: r + 1, column: c + 1 });
            } else rows[r][c] = value.stringValue ?? value.numberValue ?? value.boolValue ?? '';
          }
        }
        for (let i = 0; i < rows.length; i++) rows[i] = rows[i] || [];
        return { name, rows };
      }) };
      return { metadata, model, formulas, fingerprint: fingerprint(model) };
    }
    async function clientId() {
      if (String(prefs().clientId || '').trim()) return String(prefs().clientId).trim();
      if (serverClientId) return serverClientId;
      try {
        const r = await fetcher('/api/integrations/google-config', { credentials: 'same-origin' });
        if (r.ok && String(r.headers.get('content-type') || '').includes('application/json')) serverClientId = String((await r.json()).clientId || '').trim();
      } catch (_) { /* local configuration remains available */ }
      if (!serverClientId) throw new Error('Google sign-in is not configured. Add the public Google OAuth client ID below, or set GOOGLE_CLIENT_ID on the server.');
      return serverClientId;
    }
    async function authorize(id) {
      if (deps.authorize) return deps.authorize({ clientId: id, scope: SCOPE, prompt: 'consent select_account' });
      await loadScript('https://accounts.google.com/gsi/client', () => root.google && root.google.accounts && root.google.accounts.oauth2);
      return new Promise((resolve, reject) => {
        const oauth = root.google.accounts.oauth2.initTokenClient({ client_id: id, scope: SCOPE, include_granted_scopes: false,
          callback: (r) => r.error ? reject(new Error(r.error === 'access_denied' ? 'Google connection was canceled. Your local data is unchanged.' : 'Google authorization failed. Check the OAuth client configuration and try again.')) : resolve(r),
          error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Google sign-in was canceled.' : 'Google sign-in could not open. Allow popups for this app and retry.')) });
        oauth.requestAccessToken({ prompt: 'consent select_account' });
      });
    }
    async function connect() {
      return run(async () => {
        const id = await clientId(), result = await authorize(id);
        if (!result.access_token || (result.scope && !result.scope.split(' ').includes(SCOPE))) throw new Error('Google did not grant the file access this app needs. Connect again and approve file access.');
        access = result.access_token; expires = now() + Math.max(1, Number(result.expires_in) || 3600) * 1000 - 15000;
        try { const info = await request('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)'); account = info.user && (info.user.emailAddress || info.user.displayName) || 'Connected Google account'; }
        catch (_) { if (!connected()) throw new Error('Google authorization could not be verified. Connect again.'); account = 'Connected Google account'; }
        prefs().accountDisplay = account; persist(); pending = null;
        message = 'Connected as ' + account + '. Transfers run only when you choose Push or Pull.';
      });
    }
    async function disconnect() {
      const token = access; clearAccess(); pending = null;
      delete prefs().accountDisplay; persist(); error = ''; message = 'Disconnected on this device. Local tax data is unchanged.'; paint();
      if (!token) return;
      try {
        if (deps.revoke) await deps.revoke(token);
        else if (root.google && root.google.accounts) await new Promise((resolve) => { const t = setTimeout(resolve, 8000); root.google.accounts.oauth2.revoke(token, () => { clearTimeout(t); resolve(); }); });
      } catch (_) { message += ' To remove any remaining grant, open your Google Account third-party connections.'; paint(); }
    }
    async function create() {
      return run(async () => {
        requireAccess();
        const made = await request('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', body: JSON.stringify({ properties: { title: 'Tax Master Planner — ' + new Date(now()).toISOString().slice(0, 10) }, sheets: [{ properties: { title: META } }] }) });
        prefs().spreadsheetId = made.spreadsheetId; prefs().title = made.properties && made.properties.title || 'Tax Master Planner'; delete prefs().remoteFingerprint; persist();
        message = 'Created an empty spreadsheet. Choose Preview push, then confirm to send your workspace.'; pending = null;
      });
    }
    async function choose() {
      return run(async () => {
        requireAccess(); const id = await clientId(), pickerKey = String(prefs().pickerKey || '').trim();
        if (!pickerKey) throw new Error('Google Picker needs a public browser API key. Add the restricted Picker API key below, or create a new sheet in this app.');
        if (!deps.pick) {
          await loadScript('https://apis.google.com/js/api.js', () => root.gapi);
          await new Promise((resolve, reject) => root.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker failed to load.')), timeout: 15000, ontimeout: () => reject(new Error('Google Picker timed out.')) }));
        }
        const picked = deps.pick ? await deps.pick({ accessToken: access, clientId: id, pickerKey }) : await new Promise((resolve) => {
          const p = root.google.picker;
          const picker = new p.PickerBuilder().addView(new p.DocsView(p.ViewId.SPREADSHEETS).setIncludeFolders(false)).setOAuthToken(access).setDeveloperKey(pickerKey).setAppId(id.split('-')[0]).setOrigin(location.origin).setTitle('Choose a Tax Master Planner spreadsheet').setCallback((data) => {
            if (data.action === p.Action.PICKED) resolve(data.docs[0]);
            else if (data.action === p.Action.CANCEL) resolve(null);
          }).build(); picker.setVisible(true);
        });
        if (!picked) { message = 'No spreadsheet selected.'; return; }
        prefs().spreadsheetId = spreadsheetId(picked.id); prefs().title = picked.name || 'Selected spreadsheet'; delete prefs().remoteFingerprint; persist(); pending = null;
        message = 'Spreadsheet selected. Preview a push or pull before any data changes.';
      });
    }
    async function preparePush() {
      return run(async () => {
        const id = spreadsheetId(prefs().spreadsheetId), local = localModel(), remote = await read(id);
        if (prefs().remoteFingerprint && prefs().remoteFingerprint !== remote.fingerprint) throw new Error('Conflict: the managed Google tabs changed since the last transfer. Preview a pull to review those edits before pushing. Nothing was overwritten.');
        pending = { type: 'push', id, local, localFingerprint: fingerprint(local), remoteFingerprint: remote.fingerprint, diff: diff(local, remote.model), metadata: remote.metadata };
        message = 'Review this push. Confirm replaces only the listed TM_ tabs with this device’s workspace.';
      });
    }
    async function confirmPush() {
      return run(async () => {
        if (!pending || pending.type !== 'push') throw new Error('Preview the push before confirming.');
        const p = pending;
        if (fingerprint(localModel()) !== p.localFingerprint) throw new Error('Your local workspace changed after the preview. Preview the push again.');
        const current = await read(p.id);
        if (current.fingerprint !== p.remoteFingerprint) throw new Error('Conflict: Google changed after your preview. Nothing was overwritten. Preview a pull to review the changes.');
        if (fingerprint(localModel()) !== p.localFingerprint) throw new Error('Your local workspace changed while Google was being checked. Preview the push again; nothing was overwritten.');
        const stamp = { name: META, rows: [['Tax Master managed sync', '1'], ['Updated UTC', new Date(now()).toISOString()], ['Content checksum', p.localFingerprint]] };
        await request('https://sheets.googleapis.com/v4/spreadsheets/' + p.id + ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: updateRequests({ sheets: [...p.local.sheets, stamp] }, current.metadata.sheets || []) }) });
        // Verify the written values; concurrent edits after the write are reported.
        const checked = await read(p.id);
        if (checked.fingerprint !== p.localFingerprint) throw new Error('Google did not match the sent workspace after writing. Another editor may have changed it. Preview a pull before retrying.');
        prefs().remoteFingerprint = checked.fingerprint; prefs().lastTransfer = new Date(now()).toISOString(); prefs().title = checked.metadata.properties.title; persist(); pending = null;
        message = 'Push verified. Managed tabs match this workspace; unrelated Google tabs were preserved.';
      });
    }
    async function preparePull() {
      return run(async () => {
        const id = spreadsheetId(prefs().spreadsheetId), remote = await read(id);
        if (!remote.model.sheets.length) throw new Error('This sheet has no Tax Master workbook tabs. Push a workspace first, or choose a sheet previously exported by this app.');
        if (remote.formulas.length) throw new Error('The Google workbook contains formulas in editable tables (' + remote.formulas[0].sheet + ', row ' + remote.formulas[0].row + '). Replace formulas with literal values before importing. Text cells beginning with = remain supported.');
        const model = { sheets: remote.model.sheets.map((s) => ({ name: s.name.slice(PREFIX.length), rows: s.rows })) };
        const imported = excel().fromWorkbook(model);
        if (!imported || !imported.state) throw new Error('The Google workbook did not contain a valid Tax Master workspace.');
        const local = localModel();
        pending = { type: 'pull', id, imported, remoteFingerprint: remote.fingerprint, localFingerprint: fingerprint(local), diff: diff(local, remote.model), metadata: remote.metadata };
        message = 'Validated Google workbook. Review the replacement below; local data changes only after Apply pull.';
      });
    }
    async function applyPull() {
      return run(async () => {
        if (!pending || pending.type !== 'pull') throw new Error('Preview and validate the pull before applying it.');
        if (typeof api.applyImportedState !== 'function') throw new Error('Workspace import is not connected to this app.');
        const p = pending;
        if (fingerprint(localModel()) !== p.localFingerprint) throw new Error('Your local workspace changed after the pull preview. Preview again before replacing it.');
        const remote = await read(p.id);
        if (remote.fingerprint !== p.remoteFingerprint) throw new Error('Google changed after the pull preview. Preview the pull again to review the latest data.');
        if (fingerprint(localModel()) !== p.localFingerprint) throw new Error('Your local workspace changed while Google was being checked. Preview the pull again; local edits were preserved.');
        const connection = Object.assign({}, prefs());
        await api.applyImportedState(p.imported.state, { source: 'Google Sheets', preview: p.imported.preview });
        // Connection belongs to this browser/account, not the imported workbook.
        state.settings.googleSheets = Object.assign(connection, { remoteFingerprint: p.remoteFingerprint, lastTransfer: new Date(now()).toISOString(), title: p.metadata.properties.title });
        persist(); pending = null; message = 'Pull applied. Imported inputs now flow through the local calculation engine.';
      });
    }
    function settingsMarkup() {
      const p = prefs();
      return '<div class="tm-sheets-settings"><h3>Google Sheets connection</h3><p class="muted">Connect your own Google account for explicit workbook transfers. Access tokens stay in memory and expire; reconnect after reloading.</p>' +
        '<label>Public Google OAuth client ID<input data-sheets-field="clientId" value="' + esc(p.clientId || '') + '" placeholder="Configured by server, or paste a web client ID"></label>' +
        '<label>Public Picker API key (optional, for existing sheets)<input data-sheets-field="pickerKey" value="' + esc(p.pickerKey || '') + '" autocomplete="off" placeholder="Browser-restricted key with Google Picker API enabled"></label><p class="muted">These are public application identifiers. Never enter a Google client secret or OAuth access token.</p><a href="#connections">Open Google Sheets transfers →</a></div>';
    }
    function render() {
      const p = prefs(), disabled = busy ? ' disabled' : '', authDisabled = busy || !connected() ? ' disabled' : '';
      const review = pending && pending.type === 'pull' && pending.imported.preview;
      const reviewClients = review && '<p><strong>Incoming clients:</strong> ' + (review.clients || []).map((c) => esc(c.name || c.id) + ' (TY' + esc(c.year || '') + ', ' + esc(c.planningColumns || 0) + ' plans)').join('; ') + '.</p><p class="muted">' + esc(review.fields || 0) + ' fields; ' + esc(review.auditEntries || 0) + ' audit entries. Calculated review sheets are ignored when applying inputs.</p>';
      const preview = pending && '<section class="card"><h2>' + (pending.type === 'push' ? 'Confirm push to Google' : 'Preview pull into this device') + '</h2><p>' + (pending.type === 'push' ? 'Only the TM_ tabs below will be replaced. All other sheets remain untouched.' : 'Apply replaces this device’s entire saved tax workspace: clients, prior years, scenarios, notes, audit, nonsecret preferences, and legacy training workbooks. Export an Excel backup first if you need to keep the current version.') + '</p>' + (reviewClients || '') + '<div class="tablewrap"><table><thead><tr><th>Managed tab</th><th>Local rows</th><th>Google rows</th><th>Changed cells</th></tr></thead><tbody>' + pending.diff.map((d) => '<tr><td>' + esc(d.name) + '</td><td class="n">' + d.localRows + '</td><td class="n">' + d.remoteRows + '</td><td class="n">' + d.changedCells + '</td></tr>').join('') + '</tbody></table></div><p><button class="btn primary" data-action="sheets-' + (pending.type === 'push' ? 'confirm-push' : 'apply-pull') + '"' + disabled + '>' + (pending.type === 'push' ? 'Confirm push — replace managed tabs' : 'Apply pull — replace local workspace') + '</button> <button class="btn" data-action="sheets-cancel"' + disabled + '>Cancel</button></p></section>';
      return '<div class="page-head"><div><h1>Google Sheets</h1><p class="muted">A shared workbook for your tax inputs, plans, notes, and audit trail.</p></div></div>' +
        '<section class="card"><h2>Your Google account</h2><p>' + (connected() ? 'Connected: <strong>' + esc(account || p.accountDisplay || 'Google account') + '</strong>' : 'Disconnected. Local calculations and Excel import/export remain available.') + '</p><p>Permission is limited to files created by this app or explicitly selected with Google Picker (<code>drive.file</code>). This does not sign you into an app account.</p><p><button class="btn primary" data-action="sheets-connect"' + disabled + '>' + (connected() ? 'Switch Google account' : 'Connect Google') + '</button> <button class="btn" data-action="sheets-disconnect"' + (busy || !access ? ' disabled' : '') + '>Disconnect and revoke</button></p>' + settingsMarkup() + '</section>' +
        '<section class="card"><h2>Workbook destination</h2><p>Transfers include the whole saved workspace: all clients, prior-year records, plans, notes, audit, nonsecret preferences, and legacy training workbooks. Credentials and connection settings are excluded.</p><label>Google spreadsheet URL or ID<input data-sheets-field="spreadsheetId" value="' + esc(p.spreadsheetId || '') + '" placeholder="https://docs.google.com/spreadsheets/d/…/edit"></label><p class="muted">A pasted URL works only for a file already granted to this app. Choose an existing sheet with Google Picker to grant access.</p><p><button class="btn" data-action="sheets-create"' + authDisabled + '>Create new spreadsheet</button> <button class="btn" data-action="sheets-choose"' + authDisabled + '>Choose existing spreadsheet</button>' + (p.spreadsheetId && /^[\w-]+$/.test(p.spreadsheetId) ? ' <a class="btn" href="https://docs.google.com/spreadsheets/d/' + esc(p.spreadsheetId) + '/edit" target="_blank" rel="noopener noreferrer">Open spreadsheet ↗</a>' : '') + '</p><p><button class="btn primary" data-action="sheets-preview-push"' + authDisabled + '>Preview push → Google</button> <button class="btn" data-action="sheets-preview-pull"' + authDisabled + '>Preview pull ← Google</button></p><p class="muted">Transfers are manual. The app checks for edits before writing and verifies the result. Google Sheets has no atomic cell lock; avoid simultaneous editing during a transfer. Changes since the last transfer require a pull review before another push.</p>' + (p.lastTransfer ? '<p class="muted">Last verified transfer: ' + esc(p.lastTransfer) + '</p>' : '') + '</section>' +
        (busy ? '<p role="status">Working with Google…</p>' : '') + (error ? '<div class="banner bad" role="alert">' + esc(error) + '</div>' : '') + (message ? '<div class="banner" role="status">' + esc(message) + '</div>' : '') + (preview || '');
    }
    function onChange(el) {
      const field = el.dataset && el.dataset.sheetsField;
      if (!['clientId', 'pickerKey', 'spreadsheetId'].includes(field)) return false;
      if (busy) return true;
      const value = String(el.value || '').trim();
      if (field === 'clientId' && value && !/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)) { error = 'Enter a public Google web OAuth client ID ending in .apps.googleusercontent.com. Do not enter a client secret or token.'; paint(); return true; }
      if (field === 'pickerKey' && value && !/^AIza[A-Za-z0-9_-]{35}$/.test(value)) { error = 'Enter a public Google API key beginning with AIza, restricted to this app and the Picker API. Do not enter an OAuth token or client secret.'; paint(); return true; }
      if (field === 'spreadsheetId' && value) { try { prefs()[field] = spreadsheetId(value); } catch (e) { error = e.message; paint(); return true; } }
      else prefs()[field] = value;
      if (field === 'clientId') clearAccess();
      if (field === 'spreadsheetId') { delete prefs().remoteFingerprint; delete prefs().lastTransfer; }
      pending = null; persist(); paint(); return true;
    }
    function action(name) {
      const map = { 'sheets-connect': connect, 'sheets-disconnect': disconnect, 'sheets-create': create, 'sheets-choose': choose, 'sheets-preview-push': preparePush, 'sheets-confirm-push': confirmPush, 'sheets-preview-pull': preparePull, 'sheets-apply-pull': applyPull };
      if (map[name]) { void map[name](); return true; }
      if (name === 'sheets-cancel') { pending = null; error = ''; message = 'Transfer canceled. No data changed.'; paint(); return true; }
      return false;
    }
    return { VIEWS: { connections: render }, settingsMarkup, render, action, onChange, connect, disconnect, create, choose, preparePush, confirmPush, preparePull, applyPull,
      snapshot: () => ({ connected: connected(), busy, error, message, account, pending: pending && { type: pending.type, diff: pending.diff }, destination: prefs().spreadsheetId || '' }),
      teardown: () => { disposed = true; clearAccess(); } };
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = { Core, TMSheets: root.TMSheets };
})(typeof window !== 'undefined' ? window : globalThis);
