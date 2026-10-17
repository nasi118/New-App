/* Browser smoke test for Tax Master (planner/).
   Loads every view, edits the 1040 walk and a module, adds and removes planning
   columns, sends a scenario to the walk, switches clients and the compliance
   logic, and runs the advisor's API tool loop against a mocked stream.
   Run:  node planner/tests/ui-smoke.mjs [baseURL]   (serve the repo root first) */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  ({ chromium } = require(process.env.PLAYWRIGHT_HOME || "/opt/node22/lib/node_modules/playwright"));
}
const EXEC = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const BASE = process.argv[2] || "http://localhost:8321";

const b = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ FAIL ") + n); };
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

let calls = 0; const bodies = [];
await p.route("https://api.anthropic.com/v1/messages", async (route) => {
  calls++; bodies.push(JSON.parse(route.request().postData()));
  const ev = (o) => "event: " + o.type + "\ndata: " + JSON.stringify(o) + "\n\n";
  let s = ev({ type: "message_start", message: { id: "m" + calls, content: [] } });
  if (calls === 1) {
    s += ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "get_client_return", input: {} } });
    s += ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } });
    s += ev({ type: "content_block_stop", index: 0 });
    s += ev({ type: "message_delta", delta: { stop_reason: "tool_use" } });
  } else {
    s += ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    s += ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Charitable bunching saves the most this year." } });
    s += ev({ type: "content_block_stop", index: 0 });
    s += ev({ type: "message_delta", delta: { stop_reason: "end_turn" } });
  }
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: s });
});

// The site root forwards to Tax Master
await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await p.waitForURL(/\/planner\//, { timeout: 5000 });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(300);
ok(/\/planner\//.test(p.url()), "the site root opens Tax Master");
ok((await p.textContent(".brand")).includes("Tax Master"), "brand reads Tax Master");
ok(await p.evaluate(() => window.TMP.state.view === "home"), "the landing page is the summary dashboard");
ok(await p.locator(".cmd .kpi").count() >= 6 && await p.locator(".cmd svg.sankey").count() === 1, "dashboard shows KPIs and the money-flow chart");

const navOrder = await p.$$eval("#nav .nav-group h4", (h) => h.map((x) => x.textContent));
ok(JSON.stringify(navOrder) === JSON.stringify(["Overview", "Modules", "Wealth strategy", "Review & compliance", "Library"]), "side navigation groups in order: " + navOrder.join(", "));
const modules = await p.$$eval("#nav .nav-group:nth-child(2) a span:first-child", (a) => a.map((x) => x.textContent));
ok(modules[0] === "Portfolio income" && modules[2] === "Capital transactions" && modules[5] === "Tax scenarios & estimates" && modules[7] === "Rental election & ownership", "module order follows the brief");

const views = ["home", "client", "walk", "m-portfolio", "m-schc", "m-capital", "m-rents", "m-k1", "scen", "m-qbi", "r-469", "m-itemized", "h-dash", "h-matrix", "h-cost", "h-check",
  "c-home", "w-tie", "findings", "calendar", "w-sources", "w-sched", "w-review", "r-props", "r-199a", "r-statements", "sources", "audit", "settings"];
let allRender = true;
for (const v of views) {
  await p.evaluate((v) => { location.hash = v; }, v);
  await p.waitForTimeout(40);
  const h1 = (await p.textContent("h1")) || "";
  if (!(h1.length > 0 && (await p.evaluate((v) => window.TMP.state.view === v, v)))) { allRender = false; console.log("    view failed: " + v); }
}
ok(allRender, "all " + views.length + " views render");
await p.evaluate(() => { location.hash = "p-rivera"; }); await p.waitForTimeout(40);
ok(await p.evaluate(() => window.TMP.state.view === "scen"), "old planning deep links redirect");

// 1040 walk: columns, typed override, recalculation, change log
await p.evaluate(() => { location.hash = "walk"; }); await p.waitForTimeout(80);
const cols0 = await p.locator("table.walk th.colh").count();
ok(cols0 === 3, "the Doe walk opens with the base and two planning columns (" + cols0 + ")");
const tax0 = await p.evaluate(() => window.TMP.compute().tmw.cols[0].r.f.l24);
const wages = 'input[data-bind="tm.clients.0.direct.wages"]';
await p.fill(wages, "1,958,000"); await p.press(wages, "Enter"); await p.waitForTimeout(80);
ok(await p.evaluate((t) => window.TMP.compute().tmw.cols[0].r.f.l1a === 1958000 && window.TMP.compute().tmw.cols[0].r.f.l24 > t, tax0), "typing over line 1a recalculates the base column");
ok(await p.evaluate(() => window.TMP.state.audit.some((a) => a.path === "tm.clients.0.direct.wages")), "the typed line is in the change log");
ok(await p.locator(wages + ".ovr").count() === 1, "the typed cell is marked as typed over the module");
await p.fill(wages, ""); await p.press(wages, "Enter"); await p.waitForTimeout(80);
ok(await p.evaluate(() => window.TMP.compute().tmw.cols[0].r.f.l1a === 1758000), "clearing the cell returns to the module amount");

await p.click('[data-action="add-col"][data-val="base"]'); await p.waitForTimeout(80);
ok(await p.locator("table.walk th.colh").count() === 4, "adding a planning column adds a column that mirrors the 1040");
const col3 = 'input[data-bind="tm.clients.0.cols.2.ov.charityCash"]';
await p.click('tr[data-toggle="w:l12"]'); await p.waitForTimeout(60);
await p.fill(col3, "900000"); await p.press(col3, "Enter"); await p.waitForTimeout(80);
ok(await p.evaluate(() => { const w = window.TMP.compute().tmw; return w.cols[3].r.f.l24 < w.cols[0].r.f.l24; }), "a typed amount in the new column changes only that column");
for (let i = 0; i < 2; i++) { if (await p.locator('[data-action="add-col"][data-val="base"]').count()) { await p.click('[data-action="add-col"][data-val="base"]'); await p.waitForTimeout(60); } }
ok(await p.locator("table.walk th.colh").count() === 6 && await p.locator('[data-action="add-col"]').count() === 0, "the walk allows up to five planning columns");
await p.click('[data-action="del-col"][data-val="4"]'); await p.waitForTimeout(60);
ok(await p.locator("table.walk th.colh").count() === 5, "a planning column can be removed");
await p.click('[data-action="walk-col"][data-val="1"]'); await p.waitForTimeout(60);
ok((await p.textContent(".walk-side")).includes("Planning: max retirement"), "selecting a column drives the live projection");
await p.click('[data-action="calc"]'); await p.fill("#calcIn", "(145000+52000)*0.062"); await p.waitForTimeout(40);
ok((await p.textContent("#calcOut")).includes("12,214"), "the calculator evaluates arithmetic");

// Module edit feeds the walk
await p.evaluate(() => { location.hash = "m-itemized"; }); await p.waitForTimeout(60);
const before = await p.evaluate(() => window.TMP.compute().tmw.cols[0].r.a.charity);
await p.fill('[data-bind="tm.clients.0.mod.itemized.charityCash"]', "250000"); await p.press('[data-bind="tm.clients.0.mod.itemized.charityCash"]', "Enter"); await p.waitForTimeout(60);
ok(await p.evaluate((x) => window.TMP.compute().tmw.cols[0].r.a.charity > x, before), "editing a module amount flows into the 1040 walk");
await p.evaluate(() => { location.hash = "m-capital"; }); await p.waitForTimeout(60);
await p.click('[data-tab="cap"][data-val="business"]'); await p.waitForTimeout(40);
const nAssets = await p.locator('table.grid tbody tr').count();
await p.click('[data-action="add-row"]'); await p.waitForTimeout(60);
ok(await p.locator('table.grid tbody tr').count() === nAssets + 1, "a business asset row can be added");
await p.click('[data-tab="cap"][data-val="equity"]'); await p.waitForTimeout(40);
ok((await p.textContent("#content")).includes("Disqualifying") && (await p.textContent("#content")).includes("Unsold"), "equity tab classifies ISO lots (unsold lot is not treated as sold)");

// Scenario sent to the walk
await p.evaluate(() => { location.hash = "scen"; }); await p.waitForTimeout(60);
const ncol = await p.evaluate(() => window.TMP.TMV.active().cols.length);
await p.click('[data-action="scen-to-walk"][data-val="2"]'); await p.waitForTimeout(80);
ok(await p.evaluate((n) => window.TMP.state.view === "walk" && window.TMP.TMV.active().cols.length === n + 1, ncol), "a scenario can be sent to the walk as a planning column");

// Client switch
await p.evaluate(() => { location.hash = "home"; }); await p.waitForTimeout(60);
await p.selectOption("#clientPick", "rivera"); await p.waitForTimeout(80);
ok((await p.textContent(".cmd-head h1")).includes("Rivera") && (await p.textContent("#clientBadge")).includes("TY2025"), "switching clients updates the dashboard and badge");

// Compliance: workpaper edit and logic switch still work
await p.evaluate(() => { location.hash = "w-sched"; }); await p.waitForTimeout(60);
await p.fill('[data-bind="w1040.other.cashCharity"]', "16500");
await p.press('[data-bind="w1040.other.cashCharity"]', "Enter");
ok(await p.evaluate(() => window.TMP.compute().cur.a.l11 > 16500), "editing a workpaper input recalculates Schedule A");
await p.click('#modeSeg [data-val="workbook"]');
ok(await p.evaluate(() => window.TMP.compute().rent.cur.summary.ded < 0), "as-built logic reproduces the workbook's negative §199A deduction");
await p.click('#modeSeg [data-val="corrected"]');
await p.evaluate(() => { location.hash = "h-cost"; }); await p.waitForTimeout(60);
await p.click('[data-action="sel-top"]');
ok(await p.evaluate(() => window.TMP.compute().calendar.some((c) => c.strategies)), "selecting strategies adds their filings to the calendar");

// Undo from the walk toolbar
await p.evaluate(() => { location.hash = "walk"; }); await p.waitForTimeout(60);
const n0 = await p.evaluate(() => window.TMP.state.audit.filter((a) => a.undone).length);
await p.click('[data-action="undo-last"]'); await p.waitForTimeout(60);
ok(await p.evaluate((n) => window.TMP.state.audit.filter((a) => a.undone).length === n + 1, n0), "Undo reverses the last change");

// Advisor through the mocked API
await p.evaluate(() => { const s = window.TMP.state.settings; s.apiKey = "sk-ant-test"; s.advisorBackend = "api"; });
await p.click('[data-action="advisor"]');
await p.fill("#advInput", "Which column should we recommend?");
await p.click("#advSend");
await p.waitForFunction(() => document.querySelector("#advLog").innerText.includes("Charitable bunching"), null, { timeout: 5000 });
const toolResult = bodies[1] && bodies[1].messages[2].content[0];
ok(calls === 2 && toolResult.type === "tool_result" && /columns/.test(JSON.stringify(toolResult.content)) && !/"is_error":true/.test(JSON.stringify(toolResult)), "advisor reads the 1040 walk with a tool and answers");

ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join("; ") : ""));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
