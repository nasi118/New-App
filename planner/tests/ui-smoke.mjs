/* Browser smoke test for the Tax Master Planner (planner/).
   Loads every view in both workspaces, edits an input, switches logic and
   workspace, and runs the advisor's API tool loop against a mocked stream.
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
const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

let calls = 0; const bodies = [];
await p.route("https://api.anthropic.com/v1/messages", async (route) => {
  calls++; bodies.push(JSON.parse(route.request().postData()));
  const ev = (o) => "event: " + o.type + "\ndata: " + JSON.stringify(o) + "\n\n";
  let s = ev({ type: "message_start", message: { id: "m" + calls, content: [] } });
  if (calls === 1) {
    s += ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "get_filing_calendar", input: {} } });
    s += ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } });
    s += ev({ type: "content_block_stop", index: 0 });
    s += ev({ type: "message_delta", delta: { stop_reason: "tool_use" } });
  } else {
    s += ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    s += ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The Rivera return is due **October 15, 2026**." } });
    s += ev({ type: "content_block_stop", index: 0 });
    s += ev({ type: "message_delta", delta: { stop_reason: "end_turn" } });
  }
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: s });
});

await p.goto(BASE + "/planner/", { waitUntil: "domcontentloaded" });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(300);

const views = ["p-home", "p-rivera", "r-props", "r-469", "h-dash", "h-matrix", "h-cost", "h-check",
  "c-home", "calendar", "findings", "w-tie", "w-sources", "w-sched", "w-review", "r-199a", "r-statements", "sources", "audit", "settings"];
for (const v of views) {
  await p.evaluate((v) => { location.hash = v; }, v);
  await p.waitForTimeout(60);
  const h1 = (await p.textContent("h1")) || "";
  ok(h1.length > 0 && (await p.evaluate((v) => window.TMP.state.view === v, v)), "view " + v + " renders (" + h1 + ")");
}
ok(await p.evaluate(() => window.TMP.state.settings.workspace === "compliance"), "a compliance deep link switches the workspace");

// Edit a workpaper input and confirm it recalculates and is logged
await p.evaluate(() => { location.hash = "w-sched"; });
await p.waitForTimeout(60);
await p.fill('[data-bind="w1040.other.cashCharity"]', "16500");
await p.press('[data-bind="w1040.other.cashCharity"]', "Enter");
ok(await p.evaluate(() => window.TMP.compute().cur.a.l11 > 16500 && window.TMP.state.audit.length === 1), "editing an input recalculates Schedule A and logs the change");

// Logic switch
await p.click('#modeSeg [data-val="workbook"]');
ok(await p.evaluate(() => window.TMP.compute().rent.cur.summary.ded < 0), "as-built logic reproduces the workbook's negative §199A deduction");
await p.click('#modeSeg [data-val="corrected"]');

// Planning scenario edit flows into the results
await p.click('#wsSeg [data-val="planning"]');
await p.evaluate(() => { location.hash = "p-rivera"; });
await p.waitForTimeout(60);
const before = await p.evaluate(() => window.TMP.compute().scen[1].v.f.l24);
await p.fill('[data-bind="w1040.planning.scenarios.1.levers.sepIra"]', "2000");
await p.press('[data-bind="w1040.planning.scenarios.1.levers.sepIra"]', "Enter");
ok(await p.evaluate((b) => window.TMP.compute().scen[1].v.f.l24 > b, before), "a smaller SEP-IRA raises the scenario's tax");

// Selected strategies add filings to the compliance calendar
await p.evaluate(() => { location.hash = "h-cost"; });
await p.waitForTimeout(60);
await p.click('[data-action="sel-top"]');
ok(await p.evaluate(() => window.TMP.compute().calendar.some((c) => c.strategies)), "selecting strategies adds their filings to the calendar");

// Advisor through the mocked API
await p.evaluate(() => { const s = window.TMP.state.settings; s.apiKey = "sk-ant-test"; s.advisorBackend = "api"; });
await p.click('[data-action="advisor"]');
await p.fill("#advInput", "When is the Rivera return due?");
await p.click("#advSend");
await p.waitForFunction(() => document.querySelector("#advLog").innerText.includes("October 15"), null, { timeout: 5000 });
ok(calls === 2 && bodies[1].messages[2].content[0].type === "tool_result", "advisor runs a tool round and answers");

ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join("; ") : ""));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
