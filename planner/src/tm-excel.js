/* Tax Master workbook interchange. No network or third-party runtime dependency.
   Editable typed tables are authoritative; computed sheets are review copies.
   The same plain workbook model is used by Excel files and Google Sheets. */
(function (root) {
  'use strict';
  const SCHEMA = 'tax-master-workspace', VERSION = 1;
  const EDITABLE = ['Workspace', 'Clients', 'Sources', 'Plans', 'Notes', 'Audit'];
  const HEADERS = ['Path', 'Type', 'Value', 'Part', 'Parts', 'Description'];
  const LIMIT = { file: 20 * 1024 * 1024, expanded: 64 * 1024 * 1024, entries: 120, rows: 120000, cells: 800000, depth: 48, text: 4000000, chunk: 30000 };
  const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
  const secret = /^(apiKey|accessToken|refreshToken|idToken|authorization|clientSecret|password|googleToken|googleAccessToken|googleRefreshToken)$/i;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fail = (s) => { throw new Error('Workbook: ' + s); };
  const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  // Excel keeps only 15 significant numeric digits. Preserve more precise JSON
  // inputs as text in Value; their explicit number Type restores them exactly.
  const excelNumber = (v) => Object.is(v, -0) ? '-0' : (Number(v.toPrecision(15)) !== v || Math.abs(v) > 9.99999999999999e307 || (v !== 0 && Math.abs(v) < 2.22507385850721e-308)) ? String(v) : v;
  const pathKey = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');
  function pathParts(path) {
    if (typeof path !== 'string' || path.length > 12000 || (path && !path.startsWith('/'))) fail('invalid field path.');
    if (!path) return [];
    const p = path.slice(1).split('/').map((k) => { if (/~(?![01])/g.test(k)) fail('invalid path escape.'); return k.replace(/~1/g, '/').replace(/~0/g, '~'); });
    if (p.length > LIMIT.depth || p.some((k) => unsafe.has(k) || k.length > 1000 || /[\x00-\x1f]/.test(k))) fail('unsafe or excessively deep field path.');
    return p;
  }
  // Persisted state only. Browser sessions, tokens, API keys and transient UI are
  // deliberately excluded, including credentials embedded in old audit values.
  function cleanState(state) {
    if (!object(state) || !object(state.data)) fail('workspace data is missing.');
    const copy = (v, depth) => {
      if (depth > LIMIT.depth) fail('workspace is too deeply nested.');
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
      if (typeof v === 'number') { if (!Number.isFinite(v)) fail('non-finite number.'); return v; }
      if (Array.isArray(v)) return v.map((x) => x === undefined ? null : copy(x, depth + 1));
      if (!object(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) fail('only plain workspace data can be exported.');
      const out = {};
      for (const k of Object.keys(v)) {
        if (unsafe.has(k)) fail('unsafe property name.');
        if (secret.test(k) || (depth === 1 && k === 'googleSheets') || v[k] === undefined) continue;
        out[k] = copy(v[k], depth + 1);
      }
      return out;
    };
    const audit = (state.audit || []).filter((a) => !a || !/(apiKey|accessToken|refreshToken|password|clientSecret|googleSheets)/i.test(a.path || ''));
    return copy({ data: state.data, settings: state.settings || {}, audit }, 0);
  }
  function tableFor(parts) {
    if (parts[0] === 'audit') return 'Audit';
    if (parts[0] === 'data' && parts[1] === 'tm' && parts[2] === 'clients' && /^\d+$/.test(parts[3] || '')) {
      if (parts[4] === 'info' || parts[4] === 'id') return 'Clients';
      if (parts[4] === 'notes') return 'Notes';
      if (['cols', 'scen', 'direct', 'elections', 'adjustments'].includes(parts[4])) return 'Plans';
      if (['mod', 'w2', 'deps', 'other'].includes(parts[4])) return 'Sources';
    }
    return 'Workspace';
  }
  function toWorkbook(state, options) {
    const opts = options || {}, saved = cleanState(state);
    const tables = Object.fromEntries(EDITABLE.map((name) => [name, { name, rows: [HEADERS.slice()] }]));
    const clients = saved.data.tm && saved.data.tm.clients || [];
    let count = 0;
    const visit = (v, path, parts) => {
      if (++count > LIMIT.rows) fail('too many workspace fields.');
      const type = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
      const label = parts[2] === 'clients' && clients[+parts[3]] ? ((clients[+parts[3]].info || {}).name || clients[+parts[3]].id || 'Client') + ' · ' + parts.slice(4).join(' › ') : parts.join(' › ') || 'Workspace root';
      const rows = tables[tableFor(parts)].rows;
      if (type === 'string') {
        if (v.length > LIMIT.text) fail('text field exceeds 4 million characters.');
        const chunks = []; let pos = 0;
        do { let end = Math.min(pos + LIMIT.chunk, v.length); if (end < v.length && /[\uD800-\uDBFF]/.test(v[end - 1])) end--; chunks.push(v.slice(pos, end)); pos = end; } while (pos < v.length);
        count += chunks.length - 1; if (count >= LIMIT.rows) fail('too many workspace rows.');
        chunks.forEach((part, i) => rows.push([path, type, part, i + 1, chunks.length, label]));
      } else rows.push([path, type, type === 'number' ? excelNumber(v) : type === 'boolean' ? v : '', 1, 1, label]);
      if (type === 'object' || type === 'array') Object.keys(v).forEach((k) => visit(v[k], path + '/' + pathKey(k), parts.concat(k)));
    };
    visit(saved, '', []);
    const sheets = [{ name: 'Workbook info', rows: [
      ['Property', 'Value'], ['Schema', SCHEMA], ['Version', VERSION], ['Exported UTC', opts.created || ''],
      ['Editing', 'Edit Value cells in Workspace, Clients, Sources, Plans, Notes and Audit. Type distinguishes number, string, boolean, null, object and array.'],
      ['Adding rows', 'Copy the complete subtree for a client or source, including object/array container rows; give paths distinct client/array indices and client ids.'],
      ['Removing rows', 'Delete an entire array entry subtree (its container and children); remaining array indices compact on import. Delete a leaf row to remove that property.'],
      ['Long text', 'Text over 30,000 characters uses consecutive Part/Parts rows. Keep all parts, in any row order.'],
      ['Computed sheets', 'Summary, 1040 comparison and Module totals are review copies. Edit source tables; the app recalculates results after Apply.'],
      ['Import', 'Only this versioned template is supported. Import first validates and previews the entire workbook; nothing changes until Apply. Excel formulas are never evaluated and are rejected in editable tables.'],
      ['Credentials', 'API keys, passwords, OAuth tokens and session credentials are excluded. Workbook contains private financial data.'],
    ] }].concat(EDITABLE.map((name) => tables[name]));
    const summary = { name: 'Summary', rows: [['Client id', 'Client', 'Column', 'Tax year', 'Filing status', 'Total income', 'AGI', 'Taxable income', 'Federal tax', 'Payments', 'Refund', 'Amount due']] };
    const form = { name: '1040 comparison', rows: [['Client id', 'Client', 'Column', 'Tax year', 'Filing status', 'Form 1040 line', 'Computed amount']] };
    const modules = { name: 'Module totals', rows: [['Client id', 'Client', 'Column', 'Tax year', 'Input leaf', 'Computed amount']] };
    const walkClient = opts.walkClient || (root.TM && root.TM.walkClient);
    if (walkClient) clients.forEach((c) => {
      const w = walkClient(c), name = (c.info || {}).name || c.id;
      w.cols.forEach((column) => {
        const f = column.r.f, col = column.col, prefix = [c.id, name, col.name || 'Base', column.ctx.year, column.ctx.status];
        summary.rows.push(prefix.concat([f.l9, column.r.agi, f.l15, f.l24, f.l33, f.l34, f.l37].map((v) => Number.isFinite(v) ? v : 0)));
        Object.keys(f).forEach((key) => { if (Number.isFinite(f[key])) form.rows.push(prefix.concat([key.replace(/^l/, ''), f[key]])); });
        Object.keys(column.x).forEach((key) => { if (Number.isFinite(column.x[key])) modules.rows.push([c.id, name, col.name || 'Base', column.ctx.year, key, column.x[key]]); });
      });
    });
    sheets.push(summary, form, modules);
    return { schema: SCHEMA, version: VERSION, sheets };
  }
  function fromWorkbook(model) {
    if (!model || !Array.isArray(model.sheets) || model.sheets.length > 30) fail('invalid workbook model.');
    const byName = new Map();
    for (const sh of model.sheets) { if (!sh || typeof sh.name !== 'string' || !Array.isArray(sh.rows) || byName.has(sh.name)) fail('duplicate or invalid sheet.'); byName.set(sh.name, sh); }
    const info = byName.get('Workbook info');
    if (!info) fail('missing Workbook info. Use an exported Tax Master template.');
    const meta = new Map(info.rows.slice(1).map((row) => [row[0], row[1]]));
    if (meta.get('Schema') !== SCHEMA || String(meta.get('Version')) !== String(VERSION)) fail('unsupported template schema/version.');
    const nodes = new Map(); let rowCount = 0;
    for (const name of EDITABLE) {
      const sh = byName.get(name); if (!sh) fail('missing editable sheet ' + name + '.');
      if (!sh.rows[0] || HEADERS.some((h, i) => sh.rows[0][i] !== h)) fail(name + ' headers changed.');
      for (let i = 1; i < sh.rows.length; i++) {
        const row = sh.rows[i]; if (!Array.isArray(row)) fail(name + ' has an invalid row.');
        if (row.every((v) => v === '' || v == null)) continue;
        if (++rowCount > LIMIT.rows) fail('too many data rows.');
        if (row.some((v) => typeof v === 'object' && v !== null)) fail('formulas and complex cells are not allowed in editable tables. Replace formulas with values.');
        const path = row[0], type = row[1], parts = pathParts(path), part = Number(row[3]), total = Number(row[4]);
        if (!['object', 'array', 'null', 'string', 'number', 'boolean'].includes(type)) fail('unknown type at ' + path + '.');
        if (!Number.isInteger(part) || !Number.isInteger(total) || part < 1 || total < 1 || part > total || total > 150 || (type !== 'string' && (part !== 1 || total !== 1))) fail('invalid text parts at ' + path + '.');
        if (parts.some(secret.test.bind(secret))) fail('credentials are not importable.');
        let node = nodes.get(path);
        if (!node) { node = { path, parts, type, total, pieces: new Map() }; nodes.set(path, node); }
        if (node.type !== type || node.total !== total || node.pieces.has(part)) fail('duplicate/conflicting field ' + path + '.');
        let value = row[2];
        if (type === 'string') { value = value == null ? '' : String(value); if (value.length > 32767) fail('cell exceeds Excel text limit.'); }
        if (type === 'number') { if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isFinite(Number(value))) fail('invalid number at ' + path + '.'); value = Number(value); }
        if (type === 'boolean') { if (typeof value === 'string') { if (/^true$/i.test(value)) value = true; else if (/^false$/i.test(value)) value = false; } if (value !== true && value !== false) fail('invalid boolean at ' + path + '.'); }
        if (['null', 'object', 'array'].includes(type) && value !== '' && value != null) fail('container/null Value must be blank at ' + path + '.');
        node.pieces.set(part, value);
      }
    }
    if (!nodes.has('') || nodes.get('').type !== 'object') fail('workspace root is missing.');
    const values = new Map();
    const sorted = Array.from(nodes.values()).sort((a, b) => a.parts.length - b.parts.length || a.path.localeCompare(b.path));
    for (const node of sorted) {
      if (node.pieces.size !== node.total) fail('missing text part at ' + node.path + '.');
      let value;
      if (node.type === 'object') value = {};
      else if (node.type === 'array') value = [];
      else if (node.type === 'null') value = null;
      else if (node.type === 'string') { value = Array.from({ length: node.total }, (_, i) => node.pieces.get(i + 1)).join(''); if (value.length > LIMIT.text) fail('text field too large.'); }
      else value = node.pieces.get(1);
      values.set(node.path, value);
      if (!node.parts.length) continue;
      const parentPath = '/' + node.parts.slice(0, -1).map(pathKey).join('/');
      const parent = values.get(node.parts.length === 1 ? '' : parentPath), key = node.parts[node.parts.length - 1];
      if (parent == null || typeof parent !== 'object') fail('missing object/array parent at ' + node.path + '.');
      if (Array.isArray(parent) && (!/^(0|[1-9]\d*)$/.test(key) || +key > LIMIT.rows)) fail('invalid array index at ' + node.path + '.');
      if (own(parent, key)) fail('conflicting parent at ' + node.path + '.');
      Object.defineProperty(parent, key, { value, writable: true, enumerable: true, configurable: true });
    }
    // Array subtrees may be deleted in Excel. Resolve historical client indices
    // before compaction, while they still refer to their original records.
    const sparse = values.get(''), sparseClients = sparse.data && sparse.data.tm && sparse.data.tm.clients;
    if (Array.isArray(sparseClients) && Array.isArray(sparse.audit)) {
      const oldIndices = Object.keys(sparseClients).sort((a, b) => +a - +b), newIndices = new Map(oldIndices.map((old, index) => [+old, index]));
      const byId = new Map(oldIndices.map((old) => [sparseClients[old] && sparseClients[old].id, +old]));
      for (const entry of sparse.audit) {
        if (!object(entry)) continue;
        const match = /^tm\.clients\.(\d+)(?=\.|$)/.exec(String(entry.path || '')); if (!match) continue;
        const oldIndex = entry.clientId ? byId.get(entry.clientId) : +match[1], client = oldIndex == null ? null : sparseClients[oldIndex];
        if (!client) {
          entry.originalPath = entry.originalPath || entry.path;
          entry.path = 'archive:' + entry.path;
          entry.unresolvedClient = true;
          entry.noUndo = true;
          continue;
        }
        const newIndex = newIndices.get(oldIndex);
        if (newIndex !== +match[1]) {
          entry.path = entry.path.replace(/^tm\.clients\.\d+/, 'tm.clients.' + newIndex);
          entry.clientId = client.id;
          entry.clientName = client.info && client.info.name || client.id;
          entry.recordYear = client.info && client.info.year;
        }
      }
    }
    const compact = (v) => { if (Array.isArray(v)) { const out = []; Object.keys(v).sort((a, b) => +a - +b).forEach((k) => out.push(compact(v[k]))); return out; } if (object(v)) Object.keys(v).forEach((k) => { v[k] = compact(v[k]); }); return v; };
    const state = compact(values.get(''));
    if (!object(state.data) || !object(state.settings) || !Array.isArray(state.audit) || Object.keys(state).some((k) => !['data', 'settings', 'audit'].includes(k))) fail('expected data, settings and audit workspace roots.');
    const result = validateState(state), clients = result.data.tm && result.data.tm.clients;
    return { state: result, preview: { clients: (clients || []).map((c) => ({ id: c.id, name: c.info.name || c.id, year: c.info.year, planningColumns: (c.cols || []).length })), fields: nodes.size, auditEntries: result.audit.length, sheets: EDITABLE.slice(), warnings: ['Computed review sheets are ignored; results recalculate from the editable source tables.', 'Applying replaces the workspace. Export a backup first; credentials are never imported.'] }, workbook: model };
  }
  function validateState(candidate) {
    if (!object(candidate) || !object(candidate.data) || !object(candidate.settings) || !Array.isArray(candidate.audit) || Object.keys(candidate).some((k) => !['data', 'settings', 'audit'].includes(k))) fail('expected data, settings and audit workspace roots.');
    const state = cleanState(candidate), clients = state.data.tm && state.data.tm.clients;
    for (const entry of state.audit) {
      if (!object(entry) || (entry.path != null && typeof entry.path !== 'string')) fail('invalid audit record.');
      if (entry.path && entry.path.split(/[./:]/).some((key) => unsafe.has(key) || (/^\d+$/.test(key) && +key > LIMIT.rows))) fail('unsafe audit path.');
    }
    if (clients != null) {
      if (!Array.isArray(clients) || !clients.length || clients.length > 2000) fail('invalid clients list.');
      const ids = new Set();
      for (const c of clients) {
        if (!object(c) || typeof c.id !== 'string' || !c.id || c.id.length > 200 || ids.has(c.id) || !object(c.info)) fail('each client needs a unique id and info object.');
        ids.add(c.id);
        if (c.info.year != null && ![2025, 2026].includes(+c.info.year)) fail('only supported tax years 2025 and 2026 can be calculated.');
        if (c.info.status != null && !['single', 'mfj', 'mfs', 'hoh', 'qss'].includes(c.info.status)) fail('unsupported filing status.');
        for (const k of ['cols', 'w2', 'deps']) if (c[k] != null && !Array.isArray(c[k])) fail('client ' + k + ' must be an array.');
        for (const k of ['mod', 'other', 'direct', 'adjustments', 'elections', 'scen', 'notes']) if (c[k] != null && !object(c[k])) fail('client ' + k + ' must be an object.');
        const numeric = (v, label) => { if (v != null && v !== '' && (typeof v !== 'number' || !Number.isFinite(v))) fail(label + ' must be a number (or blank).'); };
        const numericMap = (o, label) => Object.entries(o || {}).forEach(([key, v]) => numeric(v, label + '.' + key));
        numeric(c.info.priorTax, 'prior-year tax'); numeric(c.info.priorAgi, 'prior-year AGI');
        numericMap(c.other, 'Other income/payment'); numericMap(c.direct, '1040 override'); numericMap(c.adjustments, '1040 adjustment');
        for (const row of c.w2 || []) {
          if (!object(row)) fail('each W-2 must be a record.');
          for (const key of ['wages', 'ssWages', 'fedWh', 'stateWh']) numeric(row[key], 'W-2 ' + key);
        }
        if (c.cols && c.cols.length > 5) fail('a client can have at most five planning columns.');
        for (const col of c.cols || []) {
          if (!object(col) || (col.year != null && ![2025, 2026].includes(+col.year)) || (col.status != null && !['single', 'mfj', 'mfs', 'hoh', 'qss'].includes(col.status))) fail('invalid planning column/year/status.');
          for (const key of ['ov', 'lv', 'adjustments']) { if (col[key] != null && !object(col[key])) fail('planning ' + key + ' must be an object.'); numericMap(col[key], 'Planning ' + key); }
          numeric(col.growth, 'Planning growth');
        }
      }
      if (!ids.has(state.data.tm.active)) state.data.tm.active = clients[0].id;
    }
    return state;
  }

  const te = new TextEncoder(), td = new TextDecoder('utf-8', { fatal: true });
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
  function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; }
  function zipStore(files) {
    const chunks = [], central = []; let offset = 0;
    const header = (size) => new Uint8Array(size), set16 = (b, p, n) => new DataView(b.buffer).setUint16(p, n, true), set32 = (b, p, n) => new DataView(b.buffer).setUint32(p, n, true);
    for (const f of files) {
      const name = te.encode(f.name), data = te.encode(f.text), crc = crc32(data), h = header(30);
      set32(h, 0, 0x04034b50); set16(h, 4, 20); set32(h, 14, crc); set32(h, 18, data.length); set32(h, 22, data.length); set16(h, 26, name.length);
      chunks.push(h, name, data); central.push({ name, data, crc, offset }); offset += 30 + name.length + data.length;
    }
    const centralStart = offset;
    for (const c of central) {
      const h = header(46); set32(h, 0, 0x02014b50); set16(h, 4, 20); set16(h, 6, 20); set32(h, 16, c.crc); set32(h, 20, c.data.length); set32(h, 24, c.data.length); set16(h, 28, c.name.length); set32(h, 42, c.offset);
      chunks.push(h, c.name); offset += 46 + c.name.length;
    }
    const end = header(22); set32(end, 0, 0x06054b50); set16(end, 8, central.length); set16(end, 10, central.length); set32(end, 12, offset - centralStart); set32(end, 16, centralStart); chunks.push(end);
    const out = new Uint8Array(offset + 22); let pos = 0; for (const chunk of chunks) { out.set(chunk, pos); pos += chunk.length; } return out;
  }
  function xml(s) {
    return String(s).replace(/_x[0-9a-f]{4}_/gi, (x) => '_x005F_' + x.slice(1)).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\uD800-\uDFFF\uFFFE\uFFFF]/g, (c, i, full) => {
      const code = c.charCodeAt(0);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < full.length && full.charCodeAt(i + 1) >= 0xdc00 && full.charCodeAt(i + 1) <= 0xdfff) return c;
      if (code >= 0xdc00 && code <= 0xdfff && i > 0 && full.charCodeAt(i - 1) >= 0xd800 && full.charCodeAt(i - 1) <= 0xdbff) return c;
      return '_x' + code.toString(16).padStart(4, '0') + '_';
    }).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }
  function unxml(s) { return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => { if (entity[0] === '#') { const cp = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : +entity.slice(1); if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp < 32 && ![9, 10, 13].includes(cp)) || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff) fail('invalid XML character.'); return String.fromCodePoint(cp); } return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity.toLowerCase()]; }).replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16))); }
  function colName(i) { let name = ''; for (i++; i; i = Math.floor((i - 1) / 26)) name = String.fromCharCode(65 + (i - 1) % 26) + name; return name; }
  function colIndex(s) { let n = 0; for (const c of s) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; }
  function encodeWorkbook(model) {
    if (!model || !Array.isArray(model.sheets) || model.sheets.length > 30) fail('invalid workbook model.');
    const files = [], add = (name, body) => files.push({ name, text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body });
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    model.sheets.forEach((sh, i) => {
      if (!sh.name || sh.name.length > 31 || /[\[\]:*?\/\\]/.test(sh.name)) fail('invalid worksheet name.');
      const rows = sh.rows.map((row, j) => '<row r="' + (j + 1) + '">' + row.map((v, k) => {
        if (v == null) return '';
        const addr = colName(k) + (j + 1), style = j === 0 ? ' s="1"' : '';
        if (typeof v === 'number') { if (!Number.isFinite(v)) fail('non-finite cell value.'); return '<c r="' + addr + '"' + style + '><v>' + v + '</v></c>'; }
        if (typeof v === 'boolean') return '<c r="' + addr + '" t="b"' + style + '><v>' + (+v) + '</v></c>';
        if (typeof v !== 'string' || v.length > 32767) fail('unsupported cell value/length.');
        return '<c r="' + addr + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
      }).join('') + '</row>').join('');
      add('xl/worksheets/sheet' + (i + 1) + '.xml', '<worksheet xmlns="' + ns + '"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="52" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="35" customWidth="1"/><col min="4" max="12" width="18" customWidth="1"/></cols><sheetData>' + rows + '</sheetData></worksheet>');
    });
    add('xl/styles.xml', '<styleSheet xmlns="' + ns + '"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243B53"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    add('xl/workbook.xml', '<workbook xmlns="' + ns + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + model.sheets.map((s, i) => '<sheet name="' + xml(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
    const relns = 'http://schemas.openxmlformats.org/package/2006/relationships', reltype = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    add('xl/_rels/workbook.xml.rels', '<Relationships xmlns="' + relns + '">' + model.sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + reltype + 'worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rIdStyles" Type="' + reltype + 'styles" Target="styles.xml"/></Relationships>');
    add('_rels/.rels', '<Relationships xmlns="' + relns + '"><Relationship Id="rId1" Type="' + reltype + 'officeDocument" Target="xl/workbook.xml"/></Relationships>');
    add('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + model.sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
    const bytes = zipStore(files); if (bytes.length > LIMIT.file) fail('export exceeds the 20 MB workbook limit.'); return bytes;
  }
  async function unzip(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.length < 22 || bytes.length > LIMIT.file) fail('file is empty or larger than 20 MB.');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), need = (p, n) => { if (!Number.isSafeInteger(p) || p < 0 || p + n > bytes.length) fail('truncated ZIP archive.'); };
    let end = -1;
    for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) if (dv.getUint32(p, true) === 0x06054b50 && p + 22 + dv.getUint16(p + 20, true) === bytes.length) { end = p; break; }
    if (end < 0) fail('not a valid XLSX ZIP archive.');
    if (dv.getUint16(end + 4, true) || dv.getUint16(end + 6, true) || dv.getUint16(end + 8, true) !== dv.getUint16(end + 10, true)) fail('multipart ZIP is unsupported.');
    const count = dv.getUint16(end + 10, true), centralSize = dv.getUint32(end + 12, true); let p = dv.getUint32(end + 16, true), expanded = 0;
    if (!count || count > LIMIT.entries || p + centralSize !== end) fail('invalid or oversized ZIP directory.');
    const files = new Map();
    for (let i = 0; i < count; i++) {
      need(p, 46); if (dv.getUint32(p, true) !== 0x02014b50) fail('invalid ZIP directory.');
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), compressed = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      need(p + 46, nl + el + cl); const name = td.decode(bytes.subarray(p + 46, p + 46 + nl));
      if ((flags & 1) || ![0, 8].includes(method) || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || files.has(name)) fail('unsafe/unsupported ZIP entry.');
      expanded += size; if (expanded > LIMIT.expanded || size > LIMIT.expanded) fail('expanded workbook exceeds 64 MB.');
      need(off, 30); if (dv.getUint32(off, true) !== 0x04034b50 || dv.getUint16(off + 8, true) !== method) fail('invalid ZIP local entry.');
      const localName = dv.getUint16(off + 26, true), localExtra = dv.getUint16(off + 28, true), start = off + 30 + localName + localExtra;
      need(start, compressed); if (start + compressed > dv.getUint32(end + 16, true)) fail('ZIP entry overlaps directory.');
      const raw = bytes.subarray(start, start + compressed); let content;
      if (method === 0) content = raw;
      else {
        if (typeof DecompressionStream === 'undefined') fail('this browser cannot read compressed XLSX files.');
        const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), chunks = []; let length = 0;
        try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > size || length > LIMIT.expanded) { await reader.cancel(); fail('invalid expanded ZIP size.'); } chunks.push(next.value); } } finally { reader.releaseLock(); }
        content = new Uint8Array(length); let at = 0; chunks.forEach((chunk) => { content.set(chunk, at); at += chunk.length; });
      }
      if (content.length !== size || crc32(content) !== crc) fail('ZIP integrity check failed.');
      files.set(name, content); p += 46 + nl + el + cl;
    }
    if (p !== end) fail('invalid ZIP directory length.');
    return files;
  }
  const attrs = (s) => { const out = {}; let m; const re = /([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; while ((m = re.exec(s))) out[m[1]] = unxml(m[2] == null ? m[3] : m[2]); return out; };
  const texts = (body) => { let out = '', m; const re = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g; while ((m = re.exec(body))) out += unxml(m[1]); return out; };
  function validateXml(source) {
    if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(source)) fail('XML entities/DTDs/CDATA are unsupported.');
    const s = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(s)) fail('malformed XML entity.');
    const tags = /<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g, stack = []; let m, previous = 0, roots = 0;
    while ((m = tags.exec(s))) {
      const gap = s.slice(previous, m.index); if (gap.includes('<') || (!stack.length && gap.trim())) fail('malformed XML text.');
      previous = tags.lastIndex;
      const closing = /^<\/([A-Za-z_][\w:.-]*)\s*>$/.exec(m[0]);
      if (closing) { if (stack.pop() !== closing[1]) fail('mismatched XML tags.'); continue; }
      const opening = /^<([A-Za-z_][\w:.-]*)([\s\S]*?)\/?\s*>$/.exec(m[0]); if (!opening) fail('malformed XML tag.');
      let rest = opening[2]; const names = new Set();
      while (rest.trim()) {
        const a = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(rest);
        if (!a || names.has(a[1])) fail('malformed XML attribute.'); names.add(a[1]); rest = rest.slice(a[0].length);
      }
      if (!stack.length && ++roots > 1) fail('multiple XML roots.');
      if (!/\/\s*>$/.test(m[0])) { stack.push(opening[1]); if (stack.length > 100) fail('XML nesting too deep.'); }
    }
    if (stack.length || roots !== 1 || s.slice(previous).trim()) fail('truncated/malformed XML document.');
  }
  async function readWorkbook(input) {
    const bytes = input && typeof input.arrayBuffer === 'function' ? new Uint8Array(await input.arrayBuffer()) : input instanceof Uint8Array ? input : new Uint8Array(input);
    const files = await unzip(bytes), xmlPart = (name, required) => { const b = files.get(name); if (!b) { if (required) fail('missing XLSX part ' + name + '.'); return ''; } const s = td.decode(b); validateXml(s); return s; };
    const workbook = xmlPart('xl/workbook.xml', true), rels = xmlPart('xl/_rels/workbook.xml.rels', true), sharedXml = xmlPart('xl/sharedStrings.xml');
    const shared = []; let m; const si = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g; while ((m = si.exec(sharedXml))) { shared.push(texts(m[1])); if (shared.length > LIMIT.cells) fail('too many shared strings.'); }
    const relationships = new Map(), relRe = /<(?:\w+:)?Relationship\b([^>]*?)\/?\s*>/g;
    while ((m = relRe.exec(rels))) { const a = attrs(m[1]); if (a.TargetMode === 'External') continue; if (a.Id && a.Target) relationships.set(a.Id, a.Target); }
    const model = { schema: SCHEMA, version: VERSION, sheets: [] }, sheetRe = /<(?:\w+:)?sheet\b([^>]*?)\/?\s*>/g; let cells = 0;
    while ((m = sheetRe.exec(workbook))) {
      const a = attrs(m[1]), target = relationships.get(a['r:id']); if (!a.name || !target || model.sheets.length >= 30) fail('invalid worksheet relationship.');
      const path = target[0] === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, ''); if (path.includes('..') || !/^xl\/worksheets\/[^/]+\.xml$/.test(path)) fail('unsafe worksheet part.');
      const source = xmlPart(path, true), rows = [], cellRe = /<(?:\w+:)?c\b([^>]*?)\/>|<(?:\w+:)?c\b([^>]*?)>([\s\S]*?)<\/(?:\w+:)?c>/g; let cell;
      while ((cell = cellRe.exec(source))) {
        if (++cells > LIMIT.cells) fail('too many cells.');
        const ca = attrs(cell[1] == null ? cell[2] : cell[1]), body = cell[3] || '', match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(ca.r || '');
        if (!match || +match[2] > LIMIT.rows || colIndex(match[1]) > 100) fail('worksheet cell outside supported range.');
        const ri = +match[2] - 1, ci = colIndex(match[1]); if (!rows[ri]) rows[ri] = []; if (own(rows[ri], ci)) fail('duplicate worksheet cell.');
        const vm = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body); let value = '';
        if (ca.t === 'inlineStr') value = texts(body);
        else if (ca.t === 's') { const index = vm && Number(vm[1]); if (!Number.isInteger(index) || index < 0 || index >= shared.length) fail('invalid shared string index.'); value = shared[index]; }
        else if (ca.t === 'b') { if (!vm || !/^[01]$/.test(vm[1])) fail('invalid boolean cell.'); value = vm[1] === '1'; }
        else if (ca.t === 'str' || ca.t === 'e' || ca.t === 'd') value = vm ? unxml(vm[1]) : '';
        else if (vm) { value = Number(vm[1]); if (!Number.isFinite(value) || !vm[1].trim()) fail('invalid number cell.'); }
        if (/<(?:\w+:)?f\b/.test(body)) value = { formula: true, value };
        rows[ri][ci] = value;
      }
      model.sheets.push({ name: a.name, rows: Array.from({ length: rows.length }, (_, i) => rows[i] || []) });
    }
    return model;
  }
  function download(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), a = document.createElement('a'); a.href = url; a.download = filename || 'Tax-Master-workspace.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  const API = { schema: SCHEMA, version: VERSION, editableSheets: EDITABLE.slice(), cleanState, validateState, toWorkbook, fromWorkbook, encodeWorkbook, readWorkbook, encode: (state, opts) => encodeWorkbook(toWorkbook(state, opts)), decode: async (input) => fromWorkbook(await readWorkbook(input)), download };
  root.TMExcel = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
