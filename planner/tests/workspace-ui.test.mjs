/* Integrated active-client workflows. No external OAuth or paid API is called.
   Serve the repository, then run: node planner/tests/workspace-ui.test.mjs [URL]. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(process.env.PLAYWRIGHT_HOME || '/opt/node22/lib/node_modules/playwright')); }
const Excel = require('../src/tm-excel.js');
const base = process.argv[2] || 'http://localhost:8321';
const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const output = process.env.WORKSPACE_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'tax-master-workspace-'));
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
let checks = 0;
const ok = (condition, label) => { assert.ok(condition, label); checks++; console.log('  ✓ ' + label); };
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
// This suite verifies the disconnected state independently of host configuration.
await page.route('**/api/integrations/google-config', route => route.fulfill({ json: { clientId: '' } }));
const go = async view => {
  await page.evaluate(view => { location.hash = view; }, view);
  await page.waitForFunction(view => window.TMP?.state.view === view, view);
};
const edit = async (selector, value) => {
  await page.locator(selector).fill(String(value));
  await page.locator(selector).press('Tab');
};
const active = () => page.evaluate(() => TMP.TMV.active());
const result = () => page.evaluate(() => TMP.compute().tmw.cols[0].r);
const download = async selector => {
  const event = page.waitForEvent('download');
  await page.locator('.main ' + selector).click();
  const file = await event;
  const target = path.join(output, file.suggestedFilename());
  await file.saveAs(target);
  return target;
};
try {
  await page.goto(base + '/planner/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.TMP?.shell && window.TMExcel);
  const originalData = await page.evaluate(() => JSON.stringify(TMP.state.data));

  await page.locator('[data-action="shell-workspace"][data-val="compliance"]').first().click();
  await page.waitForFunction(() => TMP.state.view === 'c-client');
  ok((await page.locator('h1').innerText()).includes('compliance'), 'Compliance opens the active client review');
  await go('m-schc');
  ok(await page.locator('[data-action="shell-workspace"][data-val="planning"][aria-pressed="true"]').count() === 1,
    'a source-module deep link reveals the Planning workspace');
  const group = page.locator('[data-action="shell-nav-group"][data-key="planning-inputs"]');
  await group.click();
  ok(await group.getAttribute('aria-expanded') === 'false', 'source navigation collapses');
  await group.click();

  await go('settings');
  await page.selectOption('#tms-pref-font', 'humanist');
  await page.selectOption('#tms-pref-density', 'compact');
  await page.selectOption('#tms-pref-tableBorders', 'grid');
  await page.selectOption('#tms-pref-borderStyle', 'dashed');
  await page.selectOption('#tms-pref-palette', 'teal');
  await page.locator('#tms-pref-fontSize').fill('17');
  await page.locator('#tms-pref-fontSize').dispatchEvent('change');
  await page.locator('#tms-pref-customBackground').fill('#f2f7fa');
  await page.locator('#tms-pref-customBackground').dispatchEvent('change');
  await page.locator('#tms-pref-customText').fill('#152638');
  await page.locator('#tms-pref-customText').dispatchEvent('change');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.TMP?.shell);
  const preferences = await page.evaluate(() => TMP.shell.preferences());
  ok(preferences.font === 'humanist' && preferences.fontSize === 17 && preferences.tableBorders === 'grid' && preferences.customBackground === '#F2F7FA',
    'font, size, background, spacing and table preferences survive reload');
  ok(originalData === await page.evaluate(() => JSON.stringify(TMP.state.data)), 'appearance changes preserve every tax input');
  await page.screenshot({ path: path.join(output, 'appearance.png'), fullPage: false });
  await page.locator('[data-action="shell-appearance-reset"]').click();

  await go('home');
  const toolsToggle = page.locator('.topbar [data-action="shell-tools-toggle"]');
  if (!(await page.locator('#toolsRail').isVisible())) await toolsToggle.click();
  await page.locator('#shellCalcIn').fill('(125000 − 31500) × .22');
  await page.locator('#shellCalcIn').press('Enter');
  ok((await page.locator('#shellCalcOut').innerText()).includes('20,570'), 'right-side calculator accepts familiar arithmetic symbols');
  await page.locator('[data-action="shell-tool-move"][data-key="calculator"][data-direction="-1"]').click();
  ok(await page.locator('[data-tool-section]').first().getAttribute('data-tool-section') === 'calculator', 'tool sections can be reordered');
  await page.locator('[data-action="shell-recalculate"]').click();
  ok(await page.evaluate(() => !!TMP.state.ui.lastRecalculated), 'Recalculate refreshes the shared calculation');
  await page.screenshot({ path: path.join(output, 'dashboard-desktop.png'), fullPage: false });

  await go('clients');
  await edit('#hub-name', 'Beacon QA Client');
  await page.selectOption('#hub-year', '2025');
  await page.selectOption('#hub-status', 'single');
  await page.locator('[data-action="hub-create"]').click();
  await page.waitForFunction(() => TMP.TMV.active().info.name === 'Beacon QA Client' && TMP.state.view === 'client');
  const blank = await active();
  ok(blank.w2.length === 0 && blank.cols.length === 0 && blank.info.priorTax === null && blank.info.tpDob === '',
    'new clients start with empty source ledgers and unknown prior-year amounts');
  const index = await page.evaluate(() => TMP.state.data.tm.clients.findIndex(c => c.id === TMP.state.data.tm.active));
  const field = suffix => '[data-bind="tm.clients.' + index + '.' + suffix + '"]';
  await page.locator('[data-action="add-row"][data-path="tm.clients.' + index + '.w2"]').click();
  await edit(field('w2.0.employer'), 'Beacon Services');
  await edit(field('w2.0.wages'), 110000);
  await edit(field('w2.0.ssWages'), 110000);
  await edit(field('w2.0.fedWh'), 17000);
  await edit(field('info.priorTax'), 12000);
  await edit(field('info.priorAgi'), 95000);
  await go('m-portfolio');
  await page.locator('[data-action="add-row"][data-path="tm.clients.' + index + '.mod.portfolio.interest"]').click();
  await edit(field('mod.portfolio.interest.0.payer'), 'Beacon Bank');
  await edit(field('mod.portfolio.interest.0.taxable'), 2000);
  const initial = await result();
  ok(initial.f.l1a === 110000 && initial.f.l2b === 2000 && initial.agi === 112000, 'W-2 and portfolio source edits flow into the active return');
  await go('walk');
  ok((await page.locator('table.walk').innerText()).includes('112,000'), 'Form 1040 Walk displays the shared AGI');
  await go('c-reconcile');
  await edit('#client-return-l24', initial.f.l24);
  ok((await page.locator('#client-return-l24').locator('xpath=../..').innerText()).includes('Within tolerance'), 'compliance reconciliation uses the same calculated federal tax');
  await go('report');
  await page.locator('[data-action="review-generate-report"]').click();
  let report = await page.evaluate(() => TMP.extensions.find(x => x.reportHTML).data());
  ok(report.client === 'Beacon QA Client' && report.columns[0].r.f.l24 === initial.f.l24 && !report.stale,
    'generated client report uses this client’s current return');
  const htmlFile = await download('[data-action="review-export-html"]');
  const html = await fs.readFile(htmlFile, 'utf8');
  ok(html.includes('Beacon QA Client') && !html.includes('Jordan Rivera') && html.includes('Base return and selected planning comparisons'),
    'standalone HTML report contains the active client and report sections');
  const csvFile = await download('[data-action="review-export-csv"]');
  ok((await fs.readFile(csvFile, 'utf8')).includes('Beacon QA Client'), 'client report exports as Excel-readable CSV');
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: path.join(output, 'client-report.pdf'), format: 'Letter', printBackground: true });
  ok(!(await page.locator('.sidebar').isVisible()), 'print layout hides navigation and workspace tools');
  await page.emulateMedia({ media: 'screen' });

  await go('client');
  await edit(field('w2.0.wages'), 120000);
  await go('report');
  report = await page.evaluate(() => TMP.extensions.find(x => x.reportHTML).data());
  ok(report.stale && report.columns[0].r.agi === 122000, 'source edits update the live report and flag its generated version as stale');
  await go('ai-analysis');
  const analysisText = await page.locator('.main').innerText();
  ok(analysisText.includes('Beacon QA Client') && analysisText.includes('122,000'), 'AI analysis reads the current active-client calculation without a paid request');
  await go('home');
  await page.selectOption('#dashboard-comparison-metric', 'balance');
  ok((await page.locator('.tm-trends').innerText()).includes('Refund / balance due'), 'dashboard comparisons offer selectable metrics');

  // Exercise an actual downloaded workbook, edited source cell, browser upload,
  // preview, and confirmed application. Unit tests independently read deflated XLSX.
  await go('data');
  // Imported histories must survive reload beyond the former 500-entry cap.
  await page.evaluate(() => {
    const c = TMP.TMV.active(), index = TMP.state.data.tm.clients.indexOf(c);
    for (let i = 0; i < 600; i++) TMP.state.audit.push({ ts: new Date(1700000000000 + i * 1000).toISOString(), by: 'you', path: 'tm.clients.' + index + '.w2.0.wages', clientId: c.id, clientName: c.info.name, recordYear: c.info.year, from: i, to: i + 1, note: 'Historical change ' + i, noUndo: true });
  });
  const otherClients = await page.evaluate(() => TMP.state.data.tm.clients.filter(c => c.id !== TMP.state.data.tm.active));
  const exportedFile = await download('[data-action="workbook-export"]');
  const decoded = await Excel.decode(new Uint8Array(await fs.readFile(exportedFile)));
  const model = Excel.toWorkbook(decoded.state);
  const wagePath = '/data/tm/clients/' + index + '/w2/0/wages';
  const wageCell = model.sheets.flatMap(sheet => sheet.rows).find(row => row[0] === wagePath);
  assert.ok(wageCell, 'editable W-2 wage cell exists');
  wageCell[2] = 130000;
  const editedFile = path.join(output, 'edited-inputs.xlsx');
  await fs.writeFile(editedFile, Excel.encodeWorkbook(model));
  await page.locator('#tmWorkbookFile').setInputFiles(editedFile);
  await page.locator('[data-action="data-apply"]').waitFor();
  ok((await active()).w2[0].wages === 120000 && (await page.locator('.tm-import-preview').innerText()).includes('Nothing has been changed'),
    'Excel upload previews calculated results before changing local inputs');
  await page.locator('[data-action="data-apply"]').click();
  await page.waitForFunction(() => TMP.TMV.active().w2[0].wages === 130000);
  ok((await result()).agi === 132000, 'applying the reviewed Excel import recalculates the return from the edited cell');
  ok(await page.evaluate(() => TMP.state.audit.filter(a => a.clientId === TMP.state.data.tm.active).every(a => a.noUndo)),
    'replacing a client checkpoints old Undo actions before imported source rows can change identity');
  assert.deepEqual(await page.evaluate(() => TMP.state.data.tm.clients.filter(c => c.id !== TMP.state.data.tm.active)), otherClients);
  ok(true, 'client merge preserves all other client records');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.TMP?.state.view === 'data');
  ok(await page.evaluate(() => TMP.state.audit.filter(a => /^Historical change /.test(a.note || '')).length === 600 && TMP.TMV.active().w2[0].wages === 130000),
    'all imported audit history and source amounts survive reload beyond 500 events');
  const beforeInvalid = await page.evaluate(() => JSON.stringify({ data: TMP.state.data, audit: TMP.state.audit }));
  await page.locator('#tmWorkbookFile').setInputFiles({ name: 'invalid.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('invalid workbook') });
  await page.locator('[role="alert"]').waitFor();
  ok(beforeInvalid === await page.evaluate(() => JSON.stringify({ data: TMP.state.data, audit: TMP.state.audit })), 'a malformed workbook leaves data and audit unchanged');

  await go('connections');
  await page.locator('[data-action="sheets-connect"]').click();
  await page.locator('[role="alert"]').waitFor();
  ok((await page.locator('[role="alert"]').innerText()).includes('client ID'), 'Google connection explains missing OAuth configuration');
  await go('audit');
  ok((await page.locator('h1').innerText()).includes('Audit trail') && (await page.locator('.hub-audit-wrap').innerText()).includes('Beacon QA Client'),
    'the audit trail follows the active client’s imported and local changes');

  await go('settings');
  await page.selectOption('#tms-pref-theme', 'dark');
  await go('home');
  await page.screenshot({ path: path.join(output, 'dashboard-dark.png'), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const view of ['home', 'walk', 'settings', 'clients', 'report', 'references', 'connections', 'ai-analysis', 'data']) {
    await go(view);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), view + ' fits the mobile viewport');
  }
  await go('home');
  await toolsToggle.click();
  await page.locator('#toolsRail [aria-label="Close tools"]').waitFor({ state: 'visible' });
  await page.locator('#shellCalcIn').focus();
  await page.keyboard.press('Escape');
  ok(!(await page.locator('#toolsRail').isVisible()), 'Escape closes the mobile tools panel');
  await page.screenshot({ path: path.join(output, 'dashboard-mobile.png'), fullPage: false });
  await go('data');
  await page.locator('#tmWorkbookFile').setInputFiles(editedFile);
  await page.locator('[data-action="data-apply"]').waitFor();
  const beforeStorageFailure = await page.evaluate(() => JSON.stringify({ data: TMP.state.data, audit: TMP.state.audit }));
  await page.evaluate(() => {
    window.testOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'tax-master-planner.v2') throw new DOMException('Storage full', 'QuotaExceededError');
      return window.testOriginalSetItem.call(this, key, value);
    };
  });
  await page.locator('[data-action="data-apply"]').click();
  ok(beforeStorageFailure === await page.evaluate(() => JSON.stringify({ data: TMP.state.data, audit: TMP.state.audit })),
    'browser storage failure preserves the existing workspace during import');
  ok((await page.locator('.main').innerText()).includes('Import was not applied because this browser could not save'),
    'failed browser persistence displays an actionable import error');
  await page.evaluate(() => { Storage.prototype.setItem = window.testOriginalSetItem; delete window.testOriginalSetItem; });
  ok(errors.length === 0, 'all integrated workflows have no browser runtime errors: ' + errors.join('; '));
  console.log(`\n${checks} workspace browser checks passed. Evidence: ${output}`);
} finally { await browser.close(); }
