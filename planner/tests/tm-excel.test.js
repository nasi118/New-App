const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');
const Excel = require('../src/tm-excel.js');
const TM = require('../src/tm-modules.js');
const clone = (v) => JSON.parse(JSON.stringify(v));
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(require.resolve('../src/seed.js'), 'utf8'), ctx); vm.runInNewContext(fs.readFileSync(require.resolve('../src/tm-seed.js'), 'utf8'), ctx);
function fixture() {
  const data = clone(ctx.window.SEED), clients = clone(ctx.window.TM_DEMO_CLIENTS(ctx.window.SEED));
  data.tm = { clients, active: clients[0].id };
  clients[0].adjustments = { wages: 1500 }; clients[0].elections = { hsa: { mode: 'max', coverage: 'family', age: 55 } };
  clients[0].cols[0].elections = { retirement: { plan: 'solo401k', deferral: 0 } };
  clients[0].notes = { blank: '', zero: 0, false: false, null: null, precise: 0.30000000000000004, unicode: 'Renée 李 🧮\n§199A & < > " _x0041_\u0001', isolatedSurrogate: '\ud800', long: '🧮 tax '.repeat(15000) };
  return { data, settings: { theme: 'dark', fontSize: 16, apiKey: 'secret-key', googleSheets: { spreadsheetId: 'private-id', clientId: 'client-id' } }, audit: [{ ts: '2026-01-01', path: 'tm.clients.0.adjustments.wages', from: 0, to: 1500, note: 'Imported correction' }, { path: 'settings.apiKey', from: 'old-secret', to: 'secret-key' }], ui: { temporary: true } };
}
const rows = (model) => model.sheets.flatMap((s) => Excel.editableSheets.includes(s.name) ? s.rows.slice(1) : []);
const field = (model, path) => rows(model).find((r) => r[0] === path);

test('full financial workspace, all clients and elections round-trip without credentials', async () => {
  const state = fixture(), expected = Excel.cleanState(state), before = clone(state);
  const model = Excel.toWorkbook(state, { walkClient: TM.walkClient });
  assert.deepEqual(Excel.fromWorkbook(model).state, expected);
  const bytes = Excel.encodeWorkbook(model), imported = await Excel.decode(bytes);
  assert.deepEqual(imported.state, expected);
  assert.deepEqual(state, before, 'export and preview never mutate the current workspace');
  assert.equal(imported.preview.clients.length, 2);
  assert.equal(imported.preview.auditEntries, 1);
  assert.equal(JSON.stringify(model).includes('secret-key'), false);
  assert.equal(JSON.stringify(model).includes('private-id'), false);
  for (const client of imported.state.data.tm.clients) assert.deepEqual(TM.walkClient(client), TM.walkClient(expected.data.tm.clients.find((c) => c.id === client.id)));
  assert.ok(model.sheets.find((s) => s.name === '1040 comparison').rows.length > 100);
});

test('editable cells change real source values, prior-year inputs, scenario and election settings', async () => {
  const state = fixture(), model = Excel.toWorkbook(state);
  field(model, '/data/tm/clients/1/w2/0/wages')[2] = 190000;
  field(model, '/data/tm/clients/1/info/year')[2] = 2025;
  field(model, '/data/tm/clients/0/adjustments/wages')[2] = -2000;
  field(model, '/data/tm/clients/0/elections/hsa/coverage')[2] = 'self';
  field(model, '/data/tm/clients/0/cols/0/elections/retirement/deferral')[2] = 7000;
  // A computed review sheet cannot silently override an edited input.
  model.sheets.find((s) => s.name === 'Summary').rows.push(['fake', 'Ignored', '', 2025, '', 999999999]);
  const { state: imported } = await Excel.decode(Excel.encodeWorkbook(model));
  assert.equal(imported.data.tm.clients[1].w2[0].wages, 190000);
  assert.equal(imported.data.tm.clients[1].info.year, 2025);
  assert.equal(imported.data.tm.clients[0].adjustments.wages, -2000);
  assert.equal(imported.data.tm.clients[0].elections.hsa.coverage, 'self');
  assert.equal(imported.data.tm.clients[0].cols[0].elections.retirement.deferral, 7000);
  assert.notEqual(TM.walkClient(imported.data.tm.clients[1]).cols[0].r.f.l24, TM.walkClient(state.data.tm.clients[1]).cols[0].r.f.l24);
});

test('computed summary and every Form 1040 comparison cell match the current engine', () => {
  const state = fixture(), due = { id: 'balance-due', info: { name: 'Balance due', year: 2025, status: 'single' }, w2: [{ wages: 80000, fedWh: 0 }], cols: [] };
  const refund = clone(due); refund.id = 'refund'; refund.info.name = 'Refund'; refund.w2[0].fedWh = 50000;
  state.data.tm.clients.push(due, refund);
  const model = Excel.toWorkbook(state, { walkClient: TM.walkClient });
  const summary = model.sheets.find((s) => s.name === 'Summary').rows.slice(1), form = model.sheets.find((s) => s.name === '1040 comparison').rows.slice(1);
  for (const client of state.data.tm.clients) for (const column of TM.walkClient(client).cols) {
    const row = summary.find((r) => r[0] === client.id && r[2] === (column.col.name || 'Base'));
    assert.ok(row, 'summary includes ' + client.id + ' / ' + column.col.name);
    assert.deepEqual(row.slice(5), [column.r.f.l9, column.r.agi, column.r.f.l15, column.r.f.l24, column.r.f.l33, column.r.f.l34, column.r.f.l37]);
    const actual = form.filter((r) => r[0] === client.id && r[2] === (column.col.name || 'Base'));
    const expected = Object.entries(column.r.f).filter(([, value]) => Number.isFinite(value));
    assert.equal(actual.length, expected.length, 'all calculated Form 1040 lines are exported');
    for (const [key, value] of expected) assert.equal(actual.find((r) => r[5] === key.replace(/^l/, ''))[6], value, client.id + ' / ' + column.col.name + ' / ' + key);
  }
  const dueRow = summary.find((r) => r[0] === due.id), refundRow = summary.find((r) => r[0] === refund.id);
  assert.ok(dueRow[6] > 0 && dueRow[11] > 0 && dueRow[10] === 0, 'tax due with positive AGI');
  assert.ok(refundRow[6] > 0 && refundRow[10] > 0 && refundRow[11] === 0, 'overpayment with positive AGI');
});

test('deleting complete array subtrees removes entries and compacts remaining indices', () => {
  const state = fixture(), model = Excel.toWorkbook(state), path = '/data/tm/clients/1/w2/0';
  const original = clone(state.data.tm.clients[1].w2[1]);
  model.sheets.forEach((s) => { if (Excel.editableSheets.includes(s.name)) s.rows = s.rows.filter((r) => r[0] !== path && !String(r[0]).startsWith(path + '/')); });
  const result = Excel.fromWorkbook(model).state;
  assert.equal(result.data.tm.clients[1].w2.length, 1); assert.deepEqual(result.data.tm.clients[1].w2[0], original);
});

test('client compaction remaps surviving history and archives unresolved deleted-client history', () => {
  const state = fixture(); state.audit = [
    { path: 'tm.clients.0.w2.0.wages', from: 1, to: 2, note: 'Deleted legacy client' },
    { path: 'tm.clients.1.w2.0.wages', clientId: 'rivera', clientName: 'Rivera household', recordYear: 2025, from: 10, to: 20, note: 'Surviving modern client' },
    { path: 'tm.clients.1.info.priorTax', from: 10, to: 20, note: 'Surviving legacy client' },
    { path: 'tm.clients.0.info.priorTax', clientId: 'doe', clientName: 'Doe household', from: 10, to: 20, note: 'Deleted modern client' },
    // Stable identity wins even when an existing recorded path index is stale.
    { path: 'tm.clients.0.info.priorAgi', clientId: 'rivera', from: 10, to: 20, note: 'Surviving stable identity' },
  ];
  const model = Excel.toWorkbook(state), removed = '/data/tm/clients/0';
  model.sheets.forEach((sheet) => { if (Excel.editableSheets.includes(sheet.name)) sheet.rows = sheet.rows.filter((row) => row[0] !== removed && !String(row[0]).startsWith(removed + '/')); });
  const imported = Excel.fromWorkbook(model).state;
  assert.equal(imported.data.tm.clients.length, 1); assert.equal(imported.data.tm.clients[0].id, 'rivera');
  const modern = imported.audit.find((entry) => entry.note === 'Surviving modern client');
  assert.equal(modern.path, 'tm.clients.0.w2.0.wages'); assert.equal(modern.clientId, 'rivera');
  const legacy = imported.audit.find((entry) => entry.note === 'Surviving legacy client');
  assert.equal(legacy.path, 'tm.clients.0.info.priorTax'); assert.equal(legacy.clientId, 'rivera'); assert.equal(legacy.clientName, 'Rivera household'); assert.equal(legacy.recordYear, 2025);
  assert.equal(imported.audit.find((entry) => entry.note === 'Surviving stable identity').clientId, 'rivera');
  for (const note of ['Deleted legacy client', 'Deleted modern client']) {
    const archived = imported.audit.find((entry) => entry.note === note);
    assert.ok(archived.path.startsWith('archive:tm.clients.0.')); assert.ok(archived.originalPath.startsWith('tm.clients.0.'));
    assert.equal(archived.noUndo, true); assert.equal(archived.unresolvedClient, true);
  }
  assert.equal(imported.audit.length, state.audit.length, 'all history is retained');
});

test('new clients can be added by copying an entire editable subtree with a new id', () => {
  const model = Excel.toWorkbook(fixture());
  for (const sh of model.sheets) if (Excel.editableSheets.includes(sh.name)) {
    const additions = sh.rows.filter((r) => r[0] === '/data/tm/clients/1' || String(r[0]).startsWith('/data/tm/clients/1/')).map((r) => { const copy = r.slice(); copy[0] = copy[0].replace('/clients/1', '/clients/2'); if (copy[0].endsWith('/id')) copy[2] = 'new-client'; if (copy[0].endsWith('/info/name')) copy[2] = 'New prior-year client'; return copy; });
    sh.rows.push(...additions);
  }
  const result = Excel.fromWorkbook(model);
  assert.equal(result.preview.clients.length, 3); assert.equal(result.state.data.tm.clients[2].id, 'new-client'); assert.equal(result.state.data.tm.clients[2].info.name, 'New prior-year client');
});

test('long text, empty/falsy values, Unicode and literal Excel escape sequences survive XLSX', async () => {
  const state = fixture(), model = Excel.toWorkbook(state), parts = rows(model).filter((r) => r[0] === '/data/tm/clients/0/notes/long');
  assert.ok(parts.length > 2); assert.ok(parts.every((r) => r[2].length <= 30000));
  const imported = await Excel.decode(Excel.encodeWorkbook(model)); assert.deepEqual(imported.state.data.tm.clients[0].notes, state.data.tm.clients[0].notes);
  // Text starting with = is written as an OOXML text cell, never a formula.
  field(model, '/data/tm/clients/0/notes/blank')[2] = '=HYPERLINK("https://example.test", "text")';
  const next = await Excel.decode(Excel.encodeWorkbook(model)); assert.equal(next.state.data.tm.clients[0].notes.blank, '=HYPERLINK("https://example.test", "text")');
});

test('model is deterministic for Sheets concurrency checking', () => {
  const state = fixture(); assert.deepEqual(Excel.toWorkbook(state), Excel.toWorkbook(state)); assert.deepEqual(Excel.encode(state), Excel.encode(state));
});

test('bad workbook rejects atomically: schema, missing sheet, duplicate, orphan, types and text parts', () => {
  const state = fixture(), before = clone(state), model = Excel.toWorkbook(state);
  const cases = [
    (m) => { m.sheets.find((s) => s.name === 'Workbook info').rows.find((r) => r[0] === 'Version')[1] = 999; },
    (m) => { m.sheets = m.sheets.filter((s) => s.name !== 'Sources'); },
    (m) => { const sh = m.sheets.find((s) => s.name === 'Sources'); sh.rows.push(sh.rows[1].slice()); },
    (m) => { field(m, '/data/tm/clients/1/w2/0')[0] = '/data/tm/clients/1/w2/99'; },
    (m) => { field(m, '/data/tm/clients/1/w2/0/wages')[2] = 'not a number'; },
    (m) => { const row = field(m, '/data/tm/clients/1/w2/0/wages'); row[1] = 'string'; row[2] = 'not a number'; },
    (m) => { field(m, '/data/tm/clients/0/notes/false')[2] = ''; },
    (m) => { const sh = m.sheets.find((s) => s.name === 'Notes'); sh.rows.splice(sh.rows.findIndex((r) => r[0] === '/data/tm/clients/0/notes/long'), 1); },
    (m) => { field(m, '/data/tm/clients/1/info/year')[2] = 2030; },
    (m) => { field(m, '/data/tm/clients/1/id')[2] = 'doe'; },
    (m) => { field(m, '/data/tm/clients/1/w2/0/wages')[2] = { formula: true, value: 10 }; },
  ];
  for (const change of cases) { const candidate = clone(model); change(candidate); assert.throws(() => Excel.fromWorkbook(candidate), /^Error: Workbook:/); }
  assert.deepEqual(state, before);
});

test('unsafe prototype paths, credential imports and malformed paths reject', () => {
  for (const path of ['/data/__proto__/polluted', '/data/constructor/prototype/x', '/settings/apiKey', '/data/~2broken', '/data/tm/clients/00/info/name']) {
    const model = Excel.toWorkbook(fixture()); model.sheets.find((s) => s.name === 'Workspace').rows.push([path, 'string', 'bad', 1, 1, '']); assert.throws(() => Excel.fromWorkbook(model), /^Error: Workbook:/);
  }
  assert.equal({}.polluted, undefined);
  assert.throws(() => Excel.validateState(JSON.parse('{"data":{"__proto__":{"polluted":true}},"settings":{},"audit":[]}')), /unsafe/);
  const state = Excel.cleanState(fixture()); state.audit.push({ path: 'settings.__proto__.polluted', to: true }); assert.throws(() => Excel.validateState(state), /unsafe audit path/);
});

test('XLSX ZIP integrity/truncation/size checks reject before any import', async () => {
  const bytes = Excel.encode(fixture()), corrupt = bytes.slice(); corrupt[100] ^= 1;
  for (const bad of [new Uint8Array(), bytes.slice(0, -5), corrupt, new Uint8Array(21 * 1024 * 1024)]) await assert.rejects(Excel.decode(bad));
});

// Produces independently compressed ZIP entries, approximating a file resaved by
// desktop Excel instead of relying only on our own stored-entry writer.
function unpackStored(bytes) {
  const files = []; let p = 0;
  while (bytes.readUInt32LE(p) === 0x04034b50) { const size = bytes.readUInt32LE(p + 18), nl = bytes.readUInt16LE(p + 26), el = bytes.readUInt16LE(p + 28), name = bytes.subarray(p + 30, p + 30 + nl).toString(), start = p + 30 + nl + el; files.push({ name, data: bytes.subarray(start, start + size) }); p = start + size; }
  return files;
}
function compressedZip(files) {
  const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
  const crc = (data) => { let n = 0xffffffff; for (const b of data) n = table[(n ^ b) & 255] ^ n >>> 8; return (n ^ 0xffffffff) >>> 0; };
  const local = [], central = []; let offset = 0;
  for (const f of files) { const name = Buffer.from(f.name), raw = Buffer.from(f.data), data = zlib.deflateRawSync(raw), sum = crc(raw), h = Buffer.alloc(30), c = Buffer.alloc(46); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(sum, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26); local.push(h, name, data); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(sum, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42); central.push(c, name); offset += h.length + name.length + data.length; }
  const dir = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...local, dir, end]);
}
test('reads independently deflated workbook, shared strings, reordered single-quoted attributes', async () => {
  const model = Excel.toWorkbook(fixture()), files = unpackStored(Buffer.from(Excel.encodeWorkbook(model)));
  const clientSheet = files.find((f) => f.name === 'xl/worksheets/sheet3.xml');
  const row = model.sheets.find((s) => s.name === 'Clients').rows.findIndex((r) => r[0] === '/data/tm/clients/0/info/name') + 1;
  const before = clientSheet.data.toString(), after = before.replace('<c r="C' + row + '" t="inlineStr"><is><t xml:space="preserve">Doe household</t></is></c>', "<c t='s' r='C" + row + "'><v>0</v></c>");
  assert.notEqual(before, after, 'exercise a real shared-string cell'); clientSheet.data = Buffer.from(after);
  files.push({ name: 'xl/sharedStrings.xml', data: Buffer.from('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>Doe </t></r><r><t>household</t></r></si></sst>') });
  const result = await Excel.decode(compressedZip(files)); assert.deepEqual(result.state, Excel.cleanState(fixture()));
});

test('formula cells and DTDs in an actual XLSX are rejected', async () => {
  const model = Excel.toWorkbook(fixture()), files = unpackStored(Buffer.from(Excel.encodeWorkbook(model)));
  const source = files.find((f) => f.name === 'xl/worksheets/sheet4.xml');
  source.data = Buffer.from(source.data.toString().replace(/(<c r="C\d+"[^>]*>)<v>[^<]*<\/v>/, '$1<f>1+1</f><v>2</v>'));
  await assert.rejects(Excel.decode(compressedZip(files)), /formulas/);
  const wb = files.find((f) => f.name === 'xl/workbook.xml'); wb.data = Buffer.from('<!DOCTYPE workbook [<!ENTITY x "bad">]>' + wb.data.toString());
  await assert.rejects(Excel.decode(compressedZip(files)), /entities\/DTDs/);
});

test('malformed XML is rejected even when its ZIP CRC is valid', async () => {
  const files = unpackStored(Buffer.from(Excel.encode(fixture()))), source = files.find((f) => f.name === 'xl/worksheets/sheet4.xml');
  source.data = Buffer.from(source.data.toString().replace('</worksheet>', ''));
  await assert.rejects(Excel.decode(compressedZip(files)), /XML/);
});
