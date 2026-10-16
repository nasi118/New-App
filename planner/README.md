# Tax Master Planner

A planning **and** compliance tool for two demo households, served at `/planner/`.
A Planning / Compliance switch runs both workspaces over the same client data and
the same calculation engine.

> Demo data only. Both households are fictional (the Rivera return is a training
> workpaper; the Doe figures are illustrative). Do not enter real taxpayer data.

| Workspace | Rivera household (MFJ) | Doe household |
|---|---|---|
| **Planning** | Tax scenarios (2025 what-if or 2026 projection), 2026 safe-harbor estimates | Rental properties, §469(c)(7)(A) election value and ownership scenario, 50-strategy wealth plan, cost-benefit package, implementation checklist |
| **Compliance** | TY2025 Form 1040 tie-out, source documents, schedules, review and sign-off | Rental return positions (REP and §199A aggregation tests), election statements |
| **Both** | Review findings, filing calendar (includes filings created by selected strategies), sources, change log, AI tax advisor | |

## Where the numbers come from

Three client workbooks were rebuilt as live models:

| Model | Workbook |
|---|---|
| Form 1040 reconciliation, Rivera, TY2025 | `form_1040_reconciliation_workpaper_1.xlsx` |
| Rental HoldCo §469 / §199A, Doe, TY2026 | `rental_holdco_469_199A_example_1.xlsx` |
| HNWI 50-strategy comparison, John Doe, 2026 | `john_doe_hnwi_tax_strategy_comparison_1.xlsx` |

`extract_seed.py` pulls only raw inputs, labels and citations into `src/seed.js`;
`src/engine.js` recomputes every formula. Each model runs in two modes:
**as built** (the workbook's formulas exactly) and **corrected** (review fixes
applied). The difference between the two is reported as review findings with
dollar impacts. The HNWI engine matches the workbook's cached results to the cent.

Tax parameters for 2026 (brackets, standard deduction, wage base, SALT cap, §199A
threshold) are from Rev. Proc. 2025-32 and are flagged in the UI for confirmation.

## Files

```
planner/
  index.html        page shell; loads the scripts below in order
  src/seed.js       generated from the workbooks (do not edit by hand)
  src/engine.js     pure calculation engine (browser + node), no DOM
  src/app.js        UI: workspaces, views, bindings, change log
  src/advisor.js    AI tax advisor (claude.ai `sample` capability, or an Anthropic API key)
  src/styles.css
  build.mjs         single-file build -> dist/tax-master-planner.html (git-ignored)
  extract_seed.py   regenerates src/seed.js from the workbooks in planner/data/
  tests/engine.test.js   engine tests (node --test)
  tests/ui-smoke.mjs     Playwright smoke test of every view and the advisor loop
```

## Run and test

```sh
python3 -m http.server 8321          # from the repo root, then open /planner/
node --test planner/tests/engine.test.js
node planner/tests/ui-smoke.mjs      # with the server above running
node planner/build.mjs               # dist/tax-master-planner.html, runs offline
```

## AI tax advisor

Published as a claude.ai Artifact, the advisor uses the viewer's own Claude account
through the `sample` capability. Elsewhere (GitHub Pages, a local file) it calls the
Anthropic Messages API from the browser with a key entered in Settings, streams the
answer, and runs page tools (read schedules, scenarios, strategies, findings and the
calendar; run what-ifs; change an input only when asked, logged and undoable).
The engine, not the model, is the calculation authority.
