# Tax Master

Individual Form 1040 planning for TY2025 and TY2026, served at `/planner/` (the site
root forwards here). The calculation interface works as static files; connected OpenAI chat uses the included server or Vercel API route. No frontend build step is required.

> Demo data only. Both households are fictional. Do not enter real taxpayer data in a
> public deployment.

## Layout

The **Planning / Compliance** switch changes the navigation, not the client. Both
workspaces use the selected client's source records and the same `TM.walkClient`
calculation. Sidebar groups collapse; the client badge identifies the active
record and tax year.

| Navigation | Views |
|---|---|
| **Planning → Client workspace** | Summary dashboard, Client information, Form 1040 walk |
| **Planning → Income & deductions** | Portfolio income, Schedule C, Capital transactions (investment assets, business assets, equity compensation), Rents & royalty, K-1s, QBI, Itemized deductions |
| **Planning → Planning & analysis** | Tax scenarios & estimates, Planning guide, AI analysis, Client report |
| **Compliance → Active client** | Compliance overview, Source & return reconciliation, Client report |
| **Library & settings** | Client list, User guide, Planning guide, Reference library, Audit trail, Import & export, Google Sheets connection, Settings |
| **Workbook examples** | Separate 1040 reconciliation, rental HoldCo and wealth-strategy training models; collapsed and labeled as examples |

**Settings** controls light/dark/system themes, color palettes, font family and
size, custom text/background/accent colors, row density, table borders and layout
widths. Appearance preferences stay in this browser. The right **Tools** rail can
be resized; its sections can be reordered with the move buttons and collapsed.
It contains Recalculate, the calculator, transfers, reports and reference links.
Committed input edits normally recalculate automatically; **Recalculate** refreshes
the source modules and every return column explicitly.

### Start a client and review the result

1. Open **Client list** to select a record or create a blank client. Check tax year,
   filing status and identity facts under **Client information**. Prior-year
   roll-forward creates a separate record; copying identity or source values is
   optional and requires reviewing the copied amounts for the new year.
2. Enter supporting rows in the income/deduction modules, or use **Import & export**
   to preview a supported Excel workbook. The **User guide** explains which modules
   feed each Form 1040 line and downstream view.
3. Review the base **Form 1040 walk**, then create planning columns or use **Tax
   scenarios & estimates → Send to 1040 walk**. Sending a scenario adds a column;
   it does not replace the base return.
4. Switch to **Compliance** for this same client's document checklist, diagnostics
   and reconciliation to manually entered return-software amounts. Example
   workbooks are separate records and do not populate this client's review.
5. Open **Client report**, select planning columns, add recommendations and generate
   the report. Print / Save PDF, HTML download and report CSV are available. A
   changed-input indicator identifies when the recorded generation is out of date.

The **Reference library** reads the selected year/status parameters from the same
engine used by the return, including tax brackets, deductions, retirement/IRA/HSA
limits, SALT, QBI and AMT. Its year selector does not alter the client. The **Audit
trail** shows timestamp, client, actor, input, before/after values and reason;
client filters and available Undo actions help review local changes. It is local
application history, not independent audit verification.

### Excel, backups and Google Sheets

**Import & export** downloads a real `.xlsx` workbook using schema
`tax-master-workspace`, version `1`. It includes all saved clients and prior-year
records, source modules, planning columns/elections/adjustments, notes, compliance
entries, report settings and audit history. It also carries shared training
workbooks and nonsecret workspace settings. Credentials, OAuth sessions, transient
UI state and the separate browser appearance preferences are not transferred.

1. Export the workbook and keep an unchanged backup. Read its **Workbook info** tab.
2. Edit **Value** cells in the typed **Workspace, Clients, Sources, Plans, Notes**
   and **Audit** tables. Preserve required headers, JSON Pointer paths, types and
   long-text part metadata. Adding/deleting an array item requires its complete
   subtree, as described in the workbook.
3. **Summary, 1040 comparison** and **Module totals** are calculated review copies.
   Their edits do not change inputs. Import recomputes these results from source
   data; actual Excel formulas in editable tables are rejected.
4. Choose **Import Excel / JSON** and review the client names, tax years, destination
   and recalculated base-tax comparisons. Nothing is applied while previewing.
5. The default **Update matching clients and add new clients** matches by client ID.
   It replaces each matching client's complete record, including ledgers, columns
   and notes, while retaining other local clients and the shared training models.
   This is not a cell-by-cell merge. **Replace the entire workspace from this
   backup** restores all imported clients, training models, settings and audit
   history instead. Export the current workspace before using restore.
6. Select **Apply reviewed import**, then review the recalculated return. If local
   inputs changed after the preview, refresh the preview before applying.

JSON backups use the same validated workspace records and preview workflow.
Arbitrary third-party or tax-software spreadsheets are **not** automatically
mapped into this schema; their columns must first be mapped to the supported
source tables. An exported report CSV is a deliverable, not a full workspace
backup.

**Google Sheets connection** uses the same typed source-table format. Each person
connects their own Google account and explicitly previews and confirms a push or
pull. Transfers are manual; a pull replaces the local workspace after review.
Google Cloud OAuth/Picker configuration and account consent are required. See
[Google Sheets setup and transfer boundaries](../docs/planner-google-sheets.md).
The implementation and mocked transport tests do not mean a live Google account
is connected, and the connection does not add an app login or hosted client store.

### Form 1040 walk

Every line of Form 1040 with its IRC authority, a status (OK, EST for projected / planned /
typed, INC when a module check needs attention, ERR for inconsistent input), and
expandable schedule lines (Schedules 1, 1-A, 2, 3, A, D, SE, Forms 6251, 8801, 8812, 8960).
The base column is fed by the modules. Entering a source-backed total saves its difference from the source subtotal, preserving the source ledger and allowing later source edits to flow through. Clear the cell to remove the adjustment. Existing saved manual overrides remain supported until cleared. Computed QBI has an explicit fixed manual override that can be cleared to restore automatic calculation. Add up to **five planning columns**: each mirrors the 1040,
has its own tax year and filing status, optional income growth, planning moves (retirement,
HSA, charity, loss harvesting, Roth conversion, business expense, deferral, estimates), and
its own typed lines. A sidebar shows the live projection, line status counts, diagnostics
and an AMT estimate for the selected column. Toolbar: tax year, filing status, Undo,
Calculator, Notes (per line), Ask AI.

Each line has **Explain**, **Details**, and **Ask AI** actions. Explain shows the selected column's amount, status, source detail, calculation components, authority and editable drivers without an API connection. Details opens the existing editable source schedule. The side toolbox includes an arithmetic calculator, return-value insertion, a calculation tape, and save-to-notes.

Schedule 1 lines 16, 13 and 20 offer the original retirement-plan, HSA and IRA controls inline. Elections recalculate separately for each column and year; entered, deductible, nondeductible and excess amounts are kept distinct. HSA limits assume full-year eligibility and one account owner's catch-up. The summary dashboard reconciles income sources to Form 1040 line 9 and labels percentage denominators; deductions are not presented as cash.

### Modules

| Module | Built from | Feeds |
|---|---|---|
| Portfolio income | 1099-INT / 1099-DIV rows | 2a, 2b, 3a, 3b; Sch D 13; PAB interest to AMT; foreign tax; §199A dividends |
| Schedule C | Businesses with line-by-line expenses | Sch 1 line 3, Sch SE, QBI; SEP and SE health to Sch 1 part II |
| Capital transactions | `Gain_on_Sale_of_Capital_assets_Investment_and_Business.xlsx` | Form 8949 / Sch D, Form 4797 (recapture, §1231 netting and lookback, installment sales), 25% and 28% gain |
| Equity compensation | `Stock_Options_Executive_Comp.xlsx` | ISO / NSO / RSU / §83(b) income, Form 6251 lines 2i and 2k, AMT capital gain, Form 8801 credit |
| Rents & royalty | Property rows | Sch E part I through Form 8582 ($25,000 allowance, REP) |
| Passthrough (K-1) | `Scehdule_K1_reconciliation.xlsx` box mapping | Sch E part II after basis and at-risk limits; boxes routed to their 1040 lines |
| QBI workbench | Sch C, K-1 20Z, qualifying rentals, REIT/PTP | Line 13a with W-2 / UBIA limits, SSTB phase-out, loss netting, 2026 $400 minimum |
| Itemized deductions | Schedule A inputs | Line 12 with the SALT cap phase-down, charitable limits, mortgage debt limit, 2026 floor and 2/37 limit |

Workbook errors found while rebuilding the three new workbooks are fixed in the module logic:
the unsold ISO lot treated as sold (AMT was $0 instead of $112,382.75), selling expenses left
out of investment real estate, collectibles never reaching the 28% bucket, and the K-1
workbook's limitations being typed rather than computed.

## Engine

- `src/tm-engine.js` — the return: all filing statuses, TY2025 (Rev. Proc. 2024-40 as amended
  by Pub. L. 119-21) and TY2026 (Rev. Proc. 2025-32, flagged to confirm). Schedule D tax
  worksheet (0/15/20%, 25%, 28%), AMT with the 2026 phase-out reset, SE tax, Additional
  Medicare Tax, NIIT, taxable social security, QBI, SALT cap phase-down, Schedule 1-A,
  child tax credit, minimum tax credit, safe harbor.
- `src/tm-modules.js` — module calculators, `TM.feeds(client)` (modules → leaf inputs)
  and `TM.walkClient(client)` (every column, including elections and per-column
  passive-loss recomputation).
- The workbook models (`src/engine.js`) still drive the wealth strategy and review views. The
  new engine reproduces the reviewed Rivera return from that workpaper to the dollar.

## Files

```
planner/
  index.html          page shell; loads the scripts below in order
  src/seed.js         generated from the original workbooks (do not edit by hand)
  src/engine.js       workbook models: 1040 tie-out, rental HoldCo, HNWI strategies
  src/tm-engine.js    Form 1040 engine
  src/tm-modules.js   module calculators and client → walk
  src/tm-seed.js      demo clients (Doe TY2026, Rivera TY2025)
  src/tm-sources.js   citations for the engine and the three module workbooks
  src/tm-dashboard.js    reconciled income composition and tax comparison
  src/tm-walk-details.js line explanations, source drawers, inline controls, toolbox
  src/tm-views.js     dashboard, client info, 1040 walk, modules, scenarios
  src/tm-shell.js     grouped navigation, appearance settings, right tools rail
  src/tm-client-hub.js blank/prior-year clients and client-scoped audit history
  src/tm-library.js   user/planning guides, engine-backed references, AI analysis
  src/tm-review.js    active-client compliance, reconciliation and reports
  src/tm-excel.js     versioned XLSX reader/writer and shared interchange model
  src/tm-data.js      validated import preview, client update and workspace restore
  src/tm-sheets.js    per-user Google OAuth, Sheets preview and manual transfers
  src/app.js          shell: navigation, bindings, change log, compliance and strategy views
  src/advisor.js      OpenAI server connection, optional legacy providers, browser tools
  src/styles.css
  build.mjs           single-file build -> dist/tax-master.html (git-ignored)
  extract_seed.py     regenerates src/seed.js from the workbooks in planner/data/
  tests/engine.test.js     workbook model tests
  tests/tm-engine.test.js  1040 engine and module tests (workbook fixtures included)
  tests/ui-smoke.mjs       Playwright smoke test
```

## Run and test

```sh
npm run dev                       # http://localhost:3000; includes /api/ai/chat
node --test planner/tests/*.test.js planner/tests/*.test.cjs
CHROMIUM_PATH=/usr/bin/chromium node planner/tests/ui-smoke.mjs http://localhost:3000
CHROMIUM_PATH=/usr/bin/chromium node planner/tests/advisor-ui.test.mjs
node planner/build.mjs             # dist/tax-master.html; calculations/explanations work offline
```

## AI tax advisor

**AI analysis** is a separate page for the active client's current return and
planning comparisons. Its calculation drivers, review checks and revision are
local deterministic results. **Run analysis** sends a fresh client snapshot to
the configured advisor; disconnected users receive a clearly labeled local
calculation explanation. AI replies remain snapshots and should be rerun after
changes. Current-client tools and report context do not substitute the example
households; training tools are labeled and require an explicit example page.
Switching clients clears the previous client's advisor conversation.

Automatic connection first checks the same-origin `GET /api/ai/chat` endpoint. Set `OPENAI_API_KEY` in the server/deployment environment; the credential is never sent to or stored by the browser. `OPENAI_MODEL` optionally selects the deployment's model (default `gpt-5.6-sol`). Static-only hosting cannot run this route, so local line explanations and calculations remain available there.

For hosted or network access, also set `ADVISOR_ACCESS_TOKEN` to a long random app token in the server environment. Generate a value with a password manager or `openssl rand -hex 32`, save it as that server variable, and give it only to authorized app users. Each user enters it under **Settings → Advisor → Private AI app access token**. This token is separate from the OpenAI API key; it remains in browser memory until reload and is sent only as the same-origin advisor route's authorization header. It is excluded from client state, local storage, exports and provider requests. Missing or wrong tokens cannot trigger paid calls. An unset hosted access token leaves chat unavailable and explains the required setup.

Direct Node development requests from a loopback address with a `localhost`/loopback Host can use the advisor without the app token. Forwarded requests, Vercel/AWS deployments, and `NODE_ENV=production` require it. Keep production mode enabled behind another reverse proxy. Run the Node server with `npm run dev`; `PORT` optionally changes the default 3000 port. Configure secrets in the hosting environment rather than committing them to files.

The advisor receives the selected line and planning-column context, refreshes that context after edits, and invokes typed browser tools to read the return, compare scenarios or run what-ifs. Each column exposes its source subtotals, direct adjustments, effective elections, retirement/HSA/IRA calculations and passive-activity detail. Tools validate optional adjustment/election fields; `null` clears them to restore inherited or calculated behavior. The Responses loop preserves tool identifiers and encrypted reasoning between tool results. Calculations stay in the deterministic engine. Changes made through existing advisor input tools are logged and undoable.

The optional existing Anthropic and claude.ai connections remain available in Settings. Server tests and browser tests use simulated provider responses; they do not verify live model access or credits. The app token controls access to the paid advisor endpoint; it does not add user accounts or client-record access controls.

## Tax-year scope

The current planner supports federal individual planning for **TY2025 and TY2026**.
Its annual parameters come from the cited engine rules and IRS sources, including
Rev. Proc. 2025-32 for 2026 inflation adjustments and the enacted Pub. L. 119-21
changes. They are versioned in the application code, not automatically refreshed
from an online tax-law feed. Check eligibility facts, source documents, carryovers
and diagnostics; the app does not file returns or calculate a complete state
return. The separate legacy workbench and Python engine have their own documented
scope and ruleset status.
