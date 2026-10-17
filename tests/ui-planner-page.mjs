/* Acceptance test for the Tax Master page inside the Workbench:
   the nav item opens a page that embeds planner/ and the planner runs there.
   Run:  node tests/ui-planner-page.mjs [baseURL]                            */
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
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await p.goto(BASE + "/workbench.html", { waitUntil: "domcontentloaded" });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(1500);

const clientsBefore = await p.evaluate(() => localStorage.getItem("tp_clients_v1"));
ok(await p.locator(".tp-navitem:has-text('Tax Master')").count() === 1, "Tax Master appears in the navigation");
await p.click(".tp-navitem:has-text('Tax Master')");
await p.waitForSelector(".tp-planner-frame iframe");
const src = await p.getAttribute(".tp-planner-frame iframe", "src");
ok(/\/planner\/$/.test(src), "the page embeds planner/ (" + src + ")");
ok(await p.locator(".tp-planner-head a:has-text('Open in new tab')").getAttribute("href") === src, "Open in new tab points at the same planner");

const frame = p.frameLocator(".tp-planner-frame iframe");
await frame.locator("h1").first().waitFor({ timeout: 10000 });
ok((await frame.locator("h1").first().textContent()).length > 0, "the planner renders inside the page");
await frame.locator('#nav a[href="#walk"]').click();
await frame.locator("h1:has-text('Form 1040 walk')").waitFor({ timeout: 5000 });
ok(true, "Tax Master navigation works inside the page (Form 1040 walk)");

await p.click(".tp-navitem:has-text('Dashboard')");
await p.waitForTimeout(300);
ok(await p.evaluate(() => localStorage.getItem("tp_clients_v1")) === clientsBefore, "opening the planner leaves Workbench client data untouched");
await p.click(".tp-navitem:has-text('Tax Master')");
await p.waitForSelector(".tp-planner-frame iframe");
ok(true, "the planner page reopens");

ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join("; ") : ""));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
