# Tax Master

Individual Form 1040 planning for TY2025 and TY2026, served at `/planner/` (the site
root forwards here). Static, no build step, no dependencies.

> Demo data only. Both households are fictional. Do not enter real taxpayer data in a
> public deployment.

## Layout

| Navigation | Views |
|---|---|
| **Overview** | Summary dashboard (landing page), Client info, Form 1040 walk |
| **Modules** | Portfolio income · Schedule C — Business income · Capital transactions (a: investment assets, b: business assets, c: equity compensation) · Rents & royalty · Passthrough income (K-1) · Tax scenarios & estimates · QBI workbench · Rental election & ownership · Itemized deductions |
| **Wealth strategy** | Wealth strategy dashboard · Strategy matrix · Cost-benefit & package · Implementation checklist |
| **Review & compliance** | Compliance dashboard · Form 1040 tie-out · Review findings · Filing calendar · Source documents · Schedules · Review & sign-off · Rental properties · Rental return positions · Election statements |
| **Library** | Sources · Change log · Settings |

### Form 1040 walk

Every line of Form 1040 with its IRC authority, a status (OK, EST for projected / planned /
typed, INC when a module check needs attention, ERR for inconsistent input), and
expandable schedule lines (Schedules 1, 1-A, 2, 3, A, D, SE, Forms 6251, 8801, 8812, 8960).
The base column is fed by the modules; typing in a cell overrides the module for that line
(clear the cell to go back). Add up to **five planning columns**: each mirrors the 1040,
has its own tax year and filing status, optional income growth, planning moves (retirement,
HSA, charity, loss harvesting, Roth conversion, business expense, deferral, estimates), and
its own typed lines. A sidebar shows the live projection, line status counts, diagnostics
and an AMT estimate for the selected column. Toolbar: tax year, filing status, Undo,
Calculator, Notes (per line), Ask AI.

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
- `src/tm-modules.js` — module calculators, `TM.feeds(client)` (modules → leaf inputs, with a
  two-pass §469 MAGI) and `TM.walkClient(client)` (every column).
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
  src/tm-views.js     dashboard, client info, 1040 walk, modules, scenarios
  src/app.js          shell: navigation, bindings, change log, compliance and strategy views
  src/advisor.js      AI tax advisor (claude.ai `sample` capability, or an Anthropic API key)
  src/styles.css
  build.mjs           single-file build -> dist/tax-master.html (git-ignored)
  extract_seed.py     regenerates src/seed.js from the workbooks in planner/data/
  tests/engine.test.js     workbook model tests
  tests/tm-engine.test.js  1040 engine and module tests (workbook fixtures included)
  tests/ui-smoke.mjs       Playwright smoke test
```

## Run and test

```sh
python3 -m http.server 8321          # from the repo root, then open / (or /planner/)
node --test planner/tests/engine.test.js planner/tests/tm-engine.test.js
node planner/tests/ui-smoke.mjs      # with the server above running
node planner/build.mjs               # dist/tax-master.html, runs offline
```

## AI tax advisor

Published as a claude.ai Artifact, the advisor uses the viewer's own Claude account through
the `sample` capability. Elsewhere it calls the Anthropic Messages API from the browser with a
key entered in Settings (kept only when "Remember" is ticked). Tools read the 1040 walk
(`get_client_return`), scenarios, schedules, strategies, findings and the calendar, run
what-ifs on any path (including planning columns), and change an input only when asked —
logged and undoable. The engine, not the model, is the calculation authority.
