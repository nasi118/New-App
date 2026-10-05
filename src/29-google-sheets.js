/* ==== 29-google-sheets ==== */
/* ============================================================================
   GOOGLE SHEETS INTEGRATION (API v4)
   Provides direct synchronization and export of multi-scenario tax ledgers,
   Form 1040 line walks, S-Corp/QBI schedules, and client profile data into
   live, beautifully formatted Google Spreadsheets.
   Also provides reading, live previewing, and two-way sync for client tax models.
   Uses Firebase Auth OAuth tokens and complies with all Workspace safety rules.
   ========================================================================== */

async function sheetsFetch(url, options = {}) {
  const token = typeof getDriveAccessToken === "function" ? await getDriveAccessToken() : null;
  if (!token) {
    throw new Error("Authentication required: Sign in with Google to access Google Sheets.");
  }
  const headers = {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    let msg = "Google Sheets API request failed with status " + res.status;
    try {
      const errData = await res.json();
      if (errData && errData.error && errData.error.message) {
        msg = errData.error.message;
      }
    } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

async function sheetsCreateSpreadsheet({ title, sheetTitles = ["Scenario Ledger Walk", "Client & Due Diligence"] }) {
  const sheets = sheetTitles.map((st, idx) => ({
    properties: {
      sheetId: idx,
      title: st,
      gridProperties: {
        frozenRowCount: 1,
        frozenColumnCount: 1
      }
    }
  }));

  const res = await sheetsFetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title },
      sheets
    })
  });
  return res;
}

async function sheetsGetSpreadsheet(spreadsheetId) {
  return sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
}

async function sheetsGetValues(spreadsheetId, range) {
  const encRange = encodeURIComponent(range);
  return sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encRange}`);
}

async function sheetsBatchUpdateValues({ spreadsheetId, data }) {
  return sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data
    })
  });
}

async function sheetsBatchUpdateFormatting({ spreadsheetId, requests }) {
  return sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests })
  });
}

async function sheetsAppendValues({ spreadsheetId, range, values }) {
  const encRange = encodeURIComponent(range);
  return sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encRange}:append?valueInputOption=USER_ENTERED`, {
    method: "POST",
    body: JSON.stringify({ values })
  });
}

async function sheetsListSpreadsheets({ q = "", pageSize = 30 } = {}) {
  let query = "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false";
  if (q && q.trim()) {
    const cleanQ = q.replace(/'/g, "\\'");
    query += " and (name contains '" + cleanQ + "')";
  }
  if (typeof driveListFiles === "function") {
    return driveListFiles({ q: query, pageSize, fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,parents)" });
  }
  return { files: [] };
}

/* ============================================================================
   SINGLE SCENARIO LEDGER BUILDER FOR GOOGLE SHEETS
   Compiles the complete Form 1040 line-item walk, schedule adjustments,
   tax breakdown, and economic liquidity metrics for the active scenario.
   ========================================================================== */
function buildCurrentScenarioSheetData({
  client,
  scenario,
  result,
  status,
  year
}) {
  const s = scenario;
  const r = result ? result.r : computeScenario(s, status, year);

  const ledgerRows = [
    ["Form 1040 Line Item / Calculation Component", "Modeled Amount ($)", "Statutory Code / Formula Reference"],
    ["=== GROSS INCOME & EARNINGS ===", "", ""],
    ["W-2 Wages & Salaries", num(s.w2Wages), "Form 1040 line 1a"],
    ["S-Corp Officer Compensation (W-2)", r.scorpComp, "Rev. Rul. 74-44 · reasonable compensation"],
    ["S-Corp Net Derived K-1 Distribution", r.scorpK1, "Schedule E page 2 (net profit minus comp & employer FICA)"],
    ["Schedule C Net Business Profit", r.schedC, "Schedule 1 line 3 · Schedule C net profit"],
    ["Passthrough / Schedule E Income", r.passthrough, "Schedule 1 line 5 · Partnership / S-Corp / Rental"],
    ["Taxable Interest", num(s.taxableInterest), "Form 1040 line 2b · Schedule B"],
    ["Tax-Exempt Interest (reaches MAGI)", num(s.taxExemptInterest), "Form 1040 line 2a · included in IRMAA & MAGI"],
    ["Ordinary Dividends", num(s.ordinaryDividends), "Form 1040 line 3b"],
    ["Qualified Dividends", num(s.qualifiedDividends), "Form 1040 line 3a · preferential capital gain rates"],
    ["Short-Term Capital Gains / (Losses)", num(s.shortTermGains), "Schedule D · taxed at ordinary rates"],
    ["Long-Term Capital Gains", num(s.longTermGains), "Schedule D · preferential capital gain rates"],
    ["IRA / Pension Distributions", num(s.iraDistributions), "Form 1040 line 4b / 5b"],
    ["Roth Conversions Modeled", num(s.rothConversion), "Form 1040 line 4b · taxable conversion"],
    ["Total Social Security Benefits", num(s.socialSecurityTotal), "Form 1040 line 6a"],
    ["Taxable Social Security Portion", num(s.socialSecurityTaxable), "Form 1040 line 6b · IRC §86 (up to 85%)"],
    ["Schedule 1 Other Income Total", s1IncomeTotal(s.schedule1 || {}), "Schedule 1 line 10"],
    ["TOTAL INCOME (GROSS)", r.grossIncome, "Form 1040 line 9"],
    ["", "", ""],
    ["=== ADJUSTMENTS TO INCOME (SCHEDULE 1) ===", "", ""],
    ["Deductible Half of Self-Employment Tax", r.halfSETax, "Schedule 1 line 15 · IRC §164(f) (50% of SECA)"],
    ["Self-Employed Health Insurance (SEHI)", r.sehiDeduction, "Schedule 1 line 17 · IRC §162(l)"],
    ["Retirement Plan Contribution Deduction", r.retDeduction, `Schedule 1 line 16/20 · ${(s.planning && s.planning.planType) || "Retirement Plan"}`],
    ["Health Savings Account (HSA) Deduction", r.hsaDeduction, "Schedule 1 line 13 · IRC §223"],
    ["Student Loan Interest Deduction", (r.studentLoan && r.studentLoan.allowed) || 0, "Schedule 1 line 21 · IRC §221 (capped at $2,500)"],
    ["Other Schedule 1 Adjustments", s1OtherAdjTotal(s.schedule1 || {}), "Schedule 1 Part II other adjustments"],
    ["TOTAL ADJUSTMENTS", r.adjustments, "Schedule 1 line 26 · subtracted from Total Income"],
    ["ADJUSTED GROSS INCOME (AGI)", r.agi, "Form 1040 line 11"],
    ["", "", ""],
    ["=== DEDUCTIONS FROM AGI & TAXABLE INCOME ===", "", ""],
    ["Deduction Type Claimed", r.deductionKind === "itemized" ? "Itemized Deductions" : "Standard Deduction", "Form 1040 line 12"],
    ["Standard / Itemized Deduction Base", r.deductionUsed, `Base claimed (Std base: ${r.stdDeduction})`],
    ["Schedule 1-A Below-The-Line Deductions", (r.S1A && r.S1A.total) || 0, "Form 1040 line 13b (OBBBA: Senior/Tips/OT/Auto)"],
    ["Section 199A QBI Deduction", r.qbi.deduction, `Form 1040 line 13a · ${r.qbi.bindingLimitation ? "Limited by " + r.qbi.bindingLimitation : "20% deduction"}`],
    ["TAXABLE INCOME", r.taxableIncome, "Form 1040 line 15 · computation base"],
    ["", "", ""],
    ["=== TAX LIABILITY & CREDITS BREAKDOWN ===", "", ""],
    ["Tentative Form 1040 Income Tax", r.fedIncomeTax, "Form 1040 line 16 · statutory tax brackets & LTCG rates"],
    ["Nonrefundable Tax Credits Applied", r.creditsApplied, "Form 1040 line 20 · Child Tax Credit & others"],
    ["Net Federal Income Tax", clamp0(r.fedIncomeTax - r.creditsApplied), "Form 1040 line 22"],
    ["Self-Employment Tax (SECA)", r.seTax, "Schedule 2 line 4 · Schedule SE"],
    ["S-Corp Employer FICA (Matching 7.65%)", r.sCorpFICA, "IRC §3111 · 6.2% Social Security + 1.45% Medicare"],
    ["Net Investment Income Tax (NIIT §1411)", r.niit, "Schedule 2 line 12 · 3.8% on net investment income"],
    ["Additional Medicare Tax (0.9%)", r.addlMedicare, "Schedule 2 line 11 · IRC §3101(b)(2)"],
    ["TOTAL MODELED FEDERAL TAX", r.totalTax, "Form 1040 line 24 + Employer FICA burden"],
    ["", "", ""],
    ["=== ECONOMIC METRICS & SPENDABLE CASH ===", "", ""],
    ["Effective Economic Tax Rate", r.effectiveRate / 100, "Total modeled tax / Economic income"],
    ["Marginal Federal Tax Bracket", r.marginal / 100, "Tax on next dollar of ordinary income"],
    ["Economic Income", r.economicIncome, "Gross revenue / salary before deferrals"],
    ["After-Tax Economic Income", r.afterTaxCash, "Economic income minus total tax"],
    ["Spendable After-Tax Cash", r.spendableAfterTaxCash, "After-tax cash minus retirement, HSA, charitable cash"]
  ];

  const clientName = (client && client.name) || "Client";
  const clientRows = [
    ["Client & Planning File Specification", "Value"],
    ["Client Name", clientName],
    ["Client ID", (client && client.clientId) || "CLIENT-001"],
    ["Scenario Name", s.name],
    ["Tax Planning Year", "TY" + year],
    ["Filing Status", STATUSES.find(st => st.v === status)?.l || status],
    ["Engine Version", ENGINE_VERSION],
    ["Statutory Rules Vintage", RULES_VERSION],
    ["Export Date / Timestamp", new Date().toLocaleString()],
    ["", ""],
    ["=== UNRESOLVED DUE DILIGENCE & MISSING FACTS ===", "Action / Status"],
    ...((client && client.missingFacts && client.missingFacts.length > 0)
      ? client.missingFacts.map(f => [f, "Action Required — Confirm with client before return"])
      : [["All client file facts confirmed.", "Verified"]]),
    ["", ""],
    ["=== PLANNING GOALS & CONSTRAINTS ===", "Specification"],
    ["Minimum Spendable Cash Constraint", usd$((client && client.constraints && client.constraints.minSpendableCash) || 0)],
    ["Minimum Cash Reserve", usd$((client && client.constraints && client.constraints.minCashReserve) || 0)],
    ["Max Voluntary Current Tax Payment", usd$((client && client.constraints && client.constraints.maxCurrentTaxPayment) || 0)],
    ["Other Constraints", (client && client.constraints && client.constraints.other) || "None stated"]
  ];

  return { ledgerRows, clientRows };
}

/* ============================================================================
   EXPORT CURRENT SCENARIO DIRECTLY TO GOOGLE SHEETS
   ========================================================================== */
async function exportCurrentScenarioToGoogleSheets({
  client,
  scenario,
  result,
  status,
  year,
  baseline,
  notes,
  auditLog
}) {
  const clientName = (client && client.name) || "Client";
  const scenName = scenario.name || "Active Scenario";
  const title = `${clientName} — ${scenName} (TY${year}) Tax Ledger (${new Date().toISOString().slice(0, 10)})`;

  // 1. Create spreadsheet with 2 dedicated tabs: "Scenario Ledger Walk" and "Client & Due Diligence"
  const created = await sheetsCreateSpreadsheet({
    title,
    sheetTitles: ["Scenario Ledger Walk", "Client & Due Diligence"]
  });
  const spreadsheetId = created.spreadsheetId;
  const spreadsheetUrl = created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  const { ledgerRows, clientRows } = buildCurrentScenarioSheetData({
    client,
    scenario,
    result,
    status,
    year
  });

  // 2. Batch update values
  await sheetsBatchUpdateValues({
    spreadsheetId,
    data: [
      { range: "'Scenario Ledger Walk'!A1", values: ledgerRows },
      { range: "'Client & Due Diligence'!A1", values: clientRows }
    ]
  });

  // 3. Format sheets
  const formatRequests = [
    // Header for Sheet 0 (Scenario Ledger Walk)
    {
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.12, green: 0.23, blue: 0.54 }, // Navy Blue
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 11 },
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
      }
    },
    // Leftmost column bold on Sheet 0
    {
      repeatCell: {
        range: { sheetId: 0, startColumnIndex: 0, endColumnIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            horizontalAlignment: "LEFT"
          }
        },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)"
      }
    },
    // Currency format for Column B numeric cells
    {
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 1, endRowIndex: ledgerRows.length, startColumnIndex: 1, endColumnIndex: 2 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "CURRENCY", pattern: "$#,##0" },
            horizontalAlignment: "RIGHT"
          }
        },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)"
      }
    },
    // Percentage format for rate rows (Effective Rate and Marginal Bracket)
    {
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 45, endRowIndex: 47, startColumnIndex: 1, endColumnIndex: 2 },
        cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" }, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)"
      }
    },
    // Column C notes font
    {
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 1, endRowIndex: ledgerRows.length, startColumnIndex: 2, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            textFormat: { italic: true, fontSize: 10, foregroundColor: { red: 0.4, green: 0.45, blue: 0.55 } }
          }
        },
        fields: "userEnteredFormat.textFormat"
      }
    },
    // Sheet 1 (Client & Due Diligence) Header
    {
      repeatCell: {
        range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.04, green: 0.47, blue: 0.34 }, // Emerald Green
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 11 }
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)"
      }
    },
    // Auto resize
    { autoResizeDimensions: { dimensions: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: 3 } } },
    { autoResizeDimensions: { dimensions: { sheetId: 1, dimension: "COLUMNS", startIndex: 0, endIndex: 2 } } }
  ];

  try {
    await sheetsBatchUpdateFormatting({ spreadsheetId, requests: formatRequests });
  } catch (err) {
    console.warn("Formatting partially skipped:", err);
  }

  return {
    spreadsheetId,
    spreadsheetUrl,
    title,
    scenarioName: scenName
  };
}

/* ============================================================================
   MULTI-SCENARIO TAX LEDGER BUILDER FOR GOOGLE SHEETS
   ========================================================================== */
function buildLedgerSheetData({
  client,
  scenarios,
  results,
  status,
  year,
  bestId,
  baseline
}) {
  const scenNames = scenarios.map(s => s.name);
  const baseRes = baseline || results[0];

  // Tab 1: Scenario Comparison
  const compHeader = ["Key Tax & Financial Metric", ...scenNames];
  const compRows = [
    compHeader,
    ["Total Modeled Federal Tax", ...results.map(r => r.r.totalTax)],
    ["Effective Economic Rate", ...results.map(r => r.r.effectiveRate / 100)],
    ["Spendable After-Tax Cash", ...results.map(r => r.r.spendableAfterTaxCash)],
    ["After-Tax Economic Income", ...results.map(r => r.r.afterTaxCash)],
    ["Variance vs Baseline ($)", ...results.map(r => r.r.totalTax - baseRes.r.totalTax)],
    ["", ...scenarios.map(() => "")],
    ["--- INCOME & BRACKET METRICS ---", ...scenarios.map(() => "")],
    ["Economic Income", ...results.map(r => r.r.economicIncome)],
    ["Adjusted Gross Income (AGI)", ...results.map(r => r.r.agi)],
    ["Total Income", ...results.map(r => r.r.grossIncome)],
    ["Taxable Income", ...results.map(r => r.r.taxableIncome)],
    ["Deduction Claimed (Std / Itemized)", ...results.map(r => r.r.deductionUsed)],
    ["Section 199A QBI Deduction", ...results.map(r => r.r.qbi.deduction)],
    ["Marginal Federal Bracket", ...results.map(r => r.r.marginal / 100)],
    ["", ...scenarios.map(() => "")],
    ["--- TAX BREAKDOWN BY TYPE ---", ...scenarios.map(() => "")],
    ["Form 1040 Income Tax", ...results.map(r => clamp0(r.r.fedIncomeTax - r.r.creditsApplied))],
    ["Self-Employment Tax (SECA)", ...results.map(r => r.r.seTax)],
    ["S-Corp Employer FICA", ...results.map(r => r.r.sCorpFICA)],
    ["Net Investment Income Tax (NIIT §1411)", ...results.map(r => r.r.niit)],
    ["Additional Medicare Tax (0.9%)", ...results.map(r => r.r.addlMedicare)],
    ["Nonrefundable Credits Applied", ...results.map(r => r.r.creditsApplied)]
  ];

  // Tab 2: Input Ledger
  const ledgerHeader = ["Form 1040 Line Item / Input", ...scenNames];
  const ledgerRows = [
    ledgerHeader,
    ["=== GROSS INCOME INPUTS ===", ...scenarios.map(() => "")],
    ["W-2 Wages", ...scenarios.map(s => num(s.w2Wages))],
    ["S-Corp Officer Compensation", ...results.map(r => r.r.scorpComp)],
    ["S-Corp Net Derived K-1", ...results.map(r => r.r.scorpK1)],
    ["Schedule C Net Business Profit", ...results.map(r => r.r.schedC)],
    ["Passthrough / Schedule E Income", ...results.map(r => r.r.passthrough)],
    ["Taxable Interest", ...scenarios.map(s => num(s.taxableInterest))],
    ["Tax-Exempt Interest (reaches MAGI)", ...scenarios.map(s => num(s.taxExemptInterest))],
    ["Ordinary Dividends", ...scenarios.map(s => num(s.ordinaryDividends))],
    ["Qualified Dividends", ...scenarios.map(s => num(s.qualifiedDividends))],
    ["Short-Term Capital Gains / (Losses)", ...scenarios.map(s => num(s.shortTermGains))],
    ["Long-Term Capital Gains", ...scenarios.map(s => num(s.longTermGains))],
    ["IRA Distributions", ...scenarios.map(s => num(s.iraDistributions))],
    ["Roth Conversions Modeled", ...scenarios.map(s => num(s.rothConversion))],
    ["Total Social Security Benefits", ...scenarios.map(s => num(s.socialSecurityTotal))],
    ["Taxable Social Security Portion", ...scenarios.map(s => num(s.socialSecurityTaxable))],
    ["Schedule 1 Other Income", ...scenarios.map(s => s1IncomeTotal(s.schedule1 || {}))],
    ["", ...scenarios.map(() => "")],
    ["=== ABOVE-THE-LINE ADJUSTMENTS (SCHEDULE 1) ===", ...scenarios.map(() => "")],
    ["Deductible Half of SE Tax", ...results.map(r => r.r.halfSETax)],
    ["Self-Employed Health Insurance (SEHI)", ...results.map(r => r.r.sehiDeduction)],
    ["Retirement Contribution Plan", ...scenarios.map(s => (s.planning && s.planning.planType) || "None")],
    ["Retirement Contributions Deducted", ...results.map(r => r.r.retDeduction)],
    ["Health Savings Account (HSA) Deducted", ...results.map(r => r.r.hsaDeduction)],
    ["Student Loan Interest Deduction", ...results.map(r => (r.r.studentLoan && r.r.studentLoan.allowed) || 0)],
    ["Other Adjustments", ...scenarios.map(s => s1OtherAdjTotal(s.schedule1 || {}))],
    ["", ...scenarios.map(() => "")],
    ["=== DEDUCTIONS FROM AGI & CREDITS ===", ...scenarios.map(() => "")],
    ["Deduction Type Used", ...results.map(r => r.r.deductionKind)],
    ["Standard Deduction Base", ...results.map(r => r.r.stdDeduction)],
    ["Schedule 1-A Deductions Total", ...results.map(r => (r.r.S1A && r.r.S1A.total) || 0)],
    ["Section 199A QBI Deduction", ...results.map(r => r.r.qbi.deduction)],
    ["Child / Other Tax Credits Claimed", ...results.map(r => r.r.creditsApplied)]
  ];

  // Tab 3: Client & Due Diligence
  const clientName = (client && client.name) || "Client";
  const clientRows = [
    ["Client & Planning File Specification", "Value"],
    ["Client Name", clientName],
    ["Client ID", (client && client.clientId) || "CLIENT-001"],
    ["Tax Planning Year", "TY" + year],
    ["Filing Status", STATUSES.find(s => s.v === status)?.l || status],
    ["Engine Version", ENGINE_VERSION],
    ["Statutory Rules Vintage", RULES_VERSION],
    ["Export Date / Timestamp", new Date().toLocaleString()],
    ["", ""],
    ["=== UNRESOLVED MISSING FACTS & DUE DILIGENCE ===", "Status / Action"],
    ...((client && client.missingFacts && client.missingFacts.length > 0)
      ? client.missingFacts.map(f => [f, "Action Required — Confirm with client before return"])
      : [["All client file facts confirmed.", "Verified"]]),
    ["", ""],
    ["=== PLANNING GOALS & CONSTRAINTS ===", "Specification"],
    ["Minimum Spendable Cash Constraint", usd$((client && client.constraints && client.constraints.minSpendableCash) || 0)],
    ["Minimum Cash Reserve", usd$((client && client.constraints && client.constraints.minCashReserve) || 0)],
    ["Max Voluntary Current Tax Payment", usd$((client && client.constraints && client.constraints.maxCurrentTaxPayment) || 0)],
    ["Other Constraints", (client && client.constraints && client.constraints.other) || "None stated"]
  ];

  return { compRows, ledgerRows, clientRows };
}

/* ============================================================================
   EXPORT TAX LEDGER TO GOOGLE SHEETS
   ========================================================================== */
async function exportTaxLedgerToGoogleSheets({
  client,
  scenarios,
  results,
  status,
  year,
  bestId,
  baseline,
  auditLog,
  notes
}) {
  const clientName = (client && client.name) || "Client";
  const title = `${clientName} — TY${year} Tax Advisory Ledger (${new Date().toISOString().slice(0, 10)})`;

  // 1. Create spreadsheet with 3 dedicated tabs
  const created = await sheetsCreateSpreadsheet({
    title,
    sheetTitles: ["Scenario Comparison", "Input Ledger", "Client & Due Diligence"]
  });
  const spreadsheetId = created.spreadsheetId;
  const spreadsheetUrl = created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  const { compRows, ledgerRows, clientRows } = buildLedgerSheetData({
    client,
    scenarios,
    results,
    status,
    year,
    bestId,
    baseline
  });

  // 2. Batch update values across all 3 sheets
  await sheetsBatchUpdateValues({
    spreadsheetId,
    data: [
      { range: "'Scenario Comparison'!A1", values: compRows },
      { range: "'Input Ledger'!A1", values: ledgerRows },
      { range: "'Client & Due Diligence'!A1", values: clientRows }
    ]
  });

  // 3. Format sheets: bold header rows, navy blue fill (#1e3a8a), white text, currency & percent formats
  const formatRequests = [
    // Header formatting for Sheet 0 (Scenario Comparison)
    {
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.12, green: 0.23, blue: 0.54 }, // Navy Blue
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 11 },
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
      }
    },
    // Leftmost column bold on Sheet 0
    {
      repeatCell: {
        range: { sheetId: 0, startColumnIndex: 0, endColumnIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            horizontalAlignment: "LEFT"
          }
        },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)"
      }
    },
    // Currency format for numeric cells on Sheet 0
    {
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 1, endRowIndex: 22, startColumnIndex: 1, endColumnIndex: scenarios.length + 1 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "CURRENCY", pattern: "$#,##0" }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    },
    // Percentage format for rate rows (rows 2 and 14)
    {
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: scenarios.length + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" } } },
        fields: "userEnteredFormat.numberFormat"
      }
    },
    {
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 14, endRowIndex: 15, startColumnIndex: 1, endColumnIndex: scenarios.length + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" } } },
        fields: "userEnteredFormat.numberFormat"
      }
    },
    // Header formatting for Sheet 1 (Input Ledger)
    {
      repeatCell: {
        range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.04, green: 0.47, blue: 0.34 }, // Emerald Green
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 11 },
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
      }
    },
    // Leftmost column bold on Sheet 1
    {
      repeatCell: {
        range: { sheetId: 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            horizontalAlignment: "LEFT"
          }
        },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)"
      }
    },
    // Header formatting for Sheet 2 (Client & Due Diligence)
    {
      repeatCell: {
        range: { sheetId: 2, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.28, green: 0.33, blue: 0.41 }, // Slate
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 11 }
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)"
      }
    },
    // Auto-resize dimensions across all sheets
    { autoResizeDimensions: { dimensions: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: scenarios.length + 1 } } },
    { autoResizeDimensions: { dimensions: { sheetId: 1, dimension: "COLUMNS", startIndex: 0, endIndex: scenarios.length + 1 } } },
    { autoResizeDimensions: { dimensions: { sheetId: 2, dimension: "COLUMNS", startIndex: 0, endIndex: 2 } } }
  ];

  try {
    await sheetsBatchUpdateFormatting({ spreadsheetId, requests: formatRequests });
  } catch (err) {
    console.warn("Formatting request partially skipped:", err);
  }

  return {
    spreadsheetId,
    spreadsheetUrl,
    title
  };
}

/* ============================================================================
   SYNC SCENARIOS TO EXISTING GOOGLE SHEET
   ========================================================================== */
async function syncScenariosToExistingGoogleSheet({
  spreadsheetId,
  client,
  scenarios,
  results,
  status,
  year,
  bestId,
  baseline
}) {
  // Fetch existing spreadsheet metadata to verify sheets
  const meta = await sheetsGetSpreadsheet(spreadsheetId);
  const existingSheetTitles = (meta.sheets || []).map(s => s.properties.title);

  const { compRows, ledgerRows } = buildLedgerSheetData({
    client,
    scenarios,
    results,
    status,
    year,
    bestId,
    baseline
  });

  const updateData = [];
  if (existingSheetTitles.includes("Scenario Comparison")) {
    updateData.push({ range: "'Scenario Comparison'!A1", values: compRows });
  } else if (existingSheetTitles.length > 0) {
    updateData.push({ range: `'${existingSheetTitles[0]}'!A1`, values: compRows });
  }

  if (existingSheetTitles.includes("Input Ledger")) {
    updateData.push({ range: "'Input Ledger'!A1", values: ledgerRows });
  }

  if (updateData.length === 0) {
    throw new Error("No compatible sheet tabs found to write scenario data.");
  }

  await sheetsBatchUpdateValues({
    spreadsheetId,
    data: updateData
  });

  return {
    spreadsheetId,
    title: meta.properties.title,
    updatedSheets: updateData.map(d => d.range.split("!")[0].replace(/'/g, ""))
  };
}

/* ============================================================================
   MANDATORY USER CONFIRMATION DIALOG FOR MUTATING GOOGLE SHEETS
   ========================================================================== */
function GoogleSheetsConfirmModal({
  open,
  title,
  message,
  itemDetails,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm & Overwrite",
  loading = false
}) {
  if (!open) return null;

  return EL("div", {
    className: "tp-ai-overlay",
    style: { zIndex: 120 },
    onClick: e => { if (e.target === e.currentTarget && !loading) onCancel(); }
  },
    EL("div", {
      className: "tp-card",
      role: "dialog",
      "aria-modal": "true",
      style: {
        maxWidth: "500px",
        width: "100%",
        padding: "24px",
        borderRadius: "14px",
        boxShadow: "0 20px 50px rgba(15,23,42,0.3)"
      }
    },
      EL("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" } },
        EL("span", { style: { fontSize: "24px" } }, "⚠️"),
        EL("h3", { style: { margin: 0, fontSize: "16px", fontWeight: "700", color: "var(--ink)" } }, title || "Confirm Google Sheets Update")
      ),
      EL("p", { style: { fontSize: "13px", lineHeight: "1.6", color: "var(--ink2)", margin: "0 0 12px" } },
        message || "This operation will update or overwrite cell values in your Google Spreadsheet. Are you sure you want to proceed?"
      ),
      itemDetails && EL("div", {
        style: {
          background: "var(--amber-bg)",
          border: "1px solid var(--amber-line)",
          borderRadius: "8px",
          padding: "10px 14px",
          fontSize: "12px",
          color: "#92600a",
          marginBottom: "16px",
          fontFamily: "monospace"
        }
      }, itemDetails),
      EL("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" } },
        EL("button", {
          className: "tp-btn ghost sm",
          type: "button",
          disabled: loading,
          onClick: onCancel
        }, "Cancel"),
        EL("button", {
          className: "tp-btn solid sm",
          style: { background: "#d97706", borderColor: "#b45309", color: "#fff" },
          type: "button",
          disabled: loading,
          onClick: onConfirm
        }, loading ? "Updating…" : confirmLabel)
      )
    )
  );
}

/* ============================================================================
   GOOGLE SHEETS EXPORT MODAL COMPONENT (WITH DIRECT 'SYNC TO GOOGLE SHEETS')
   ========================================================================== */
function GoogleSheetsExportModal({
  open,
  onClose,
  client,
  scenarios,
  results,
  status,
  year,
  bestId,
  baseline,
  auditLog,
  notes,
  targetScenarioId,
  initialMode = "current", // "current" | "all"
  logEvent
}) {
  if (!open) return null;

  const [exportMode, setExportMode] = useState(initialMode || "current");
  const [selectedScenId, setSelectedScenId] = useState(targetScenarioId || (scenarios[0] ? scenarios[0].id : null));
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState("ready"); // "ready" | "exporting" | "done" | "error"
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (targetScenarioId) setSelectedScenId(targetScenarioId);
    if (initialMode) setExportMode(initialMode);
  }, [targetScenarioId, initialMode]);

  const currentScenario = scenarios.find(s => s.id === selectedScenId) || scenarios[0];
  const currentResult = results.find(x => x.s.id === (currentScenario ? currentScenario.id : null)) || results[0];

  const handleStartExport = async () => {
    setLoading(true);
    setStep("exporting");
    setErrorMsg("");
    try {
      // Ensure Google Auth token is acquired
      let token = typeof getDriveAccessToken === "function" ? await getDriveAccessToken() : null;
      if (!token && typeof googleDriveSignIn === "function") {
        const signRes = await googleDriveSignIn();
        token = signRes ? signRes.accessToken : null;
      }
      if (!token) {
        throw new Error("Please connect your Google account with Google Sheets permissions.");
      }

      let res;
      if (exportMode === "current" && currentScenario) {
        res = await exportCurrentScenarioToGoogleSheets({
          client,
          scenario: currentScenario,
          result: currentResult,
          status,
          year,
          baseline,
          notes,
          auditLog
        });
        if (logEvent) {
          logEvent({
            label: "Synced scenario to Google Sheets: " + currentScenario.name,
            kind: "export",
            scenarioName: currentScenario.name,
            to: res.title
          });
        }
      } else {
        res = await exportTaxLedgerToGoogleSheets({
          client,
          scenarios,
          results,
          status,
          year,
          bestId,
          baseline,
          auditLog,
          notes
        });
        if (logEvent) {
          logEvent({
            label: "Exported multi-scenario tax ledger to Google Sheets",
            kind: "export",
            scenarioName: "Multi-Scenario",
            to: res.title
          });
        }
      }

      setResult(res);
      setStep("done");
    } catch (err) {
      console.error("Sheets export error:", err);
      setErrorMsg(err.message || "Failed to sync ledger data to Google Sheets.");
      setStep("error");
    } finally {
      setLoading(false);
    }
  };

  return EL("div", {
    className: "tp-ai-overlay",
    style: { zIndex: 110 },
    onClick: e => { if (e.target === e.currentTarget && !loading) onClose(); }
  },
    EL("div", {
      className: "tp-card",
      role: "dialog",
      "aria-modal": "true",
      style: {
        maxWidth: "560px",
        width: "100%",
        padding: "24px",
        borderRadius: "14px",
        boxShadow: "0 20px 50px rgba(15,23,42,0.25)"
      }
    },
      EL("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" } },
        EL("div", { style: { display: "flex", alignItems: "center", gap: "10px" } },
          EL("span", { style: { fontSize: "24px" } }, I.sheets),
          EL("div", null,
            EL("h3", { style: { fontSize: "16px", fontWeight: "700", margin: 0 } },
              exportMode === "current" ? "Sync to Google Sheets" : "Export Multi-Scenario Google Sheet"
            ),
            EL("span", { style: { fontSize: "11px", color: "var(--muted)" } },
              "Google Sheets API v4 · Direct cloud spreadsheet generation"
            )
          )
        ),
        !loading && EL("button", {
          className: "tp-mini",
          onClick: onClose
        }, I.x)
      ),

      step === "ready" && EL("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } },
        // Mode Selector: Current Scenario vs All Scenarios
        EL("div", { style: { display: "flex", alignItems: "center", gap: "8px", background: "var(--hdr)", padding: "4px", borderRadius: "8px" } },
          EL("button", {
            type: "button",
            className: "tp-btn sm " + (exportMode === "current" ? "solid" : "ghost"),
            style: { flex: 1, padding: "6px 10px", fontSize: "12px", ...(exportMode === "current" ? { background: "#047857", borderColor: "#047857", color: "#fff" } : {}) },
            onClick: () => setExportMode("current")
          }, I.sheets, " Current Scenario (" + (currentScenario ? currentScenario.name : "Active") + ")"),
          EL("button", {
            type: "button",
            className: "tp-btn sm " + (exportMode === "all" ? "solid" : "ghost"),
            style: { flex: 1, padding: "6px 10px", fontSize: "12px", ...(exportMode === "all" ? { background: "var(--indigo)", borderColor: "var(--indigo)", color: "#fff" } : {}) },
            onClick: () => setExportMode("all")
          }, "All Scenarios Comparison (" + scenarios.length + ")")
        ),

        exportMode === "current" && currentScenario && EL("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } },
          // Scenario selector dropdown if multiple scenarios
          scenarios.length > 1 && EL("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" } },
            EL("span", { style: { fontSize: "12px", fontWeight: "600", color: "var(--ink2)" } }, "Select Scenario to Sync:"),
            EL("select", {
              className: "tp-txt sm",
              style: { maxWidth: "260px" },
              value: selectedScenId,
              onChange: e => setSelectedScenId(e.target.value)
            },
              scenarios.map(sc => EL("option", { key: sc.id, value: sc.id }, sc.name))
            )
          ),

          // Scenario KPI Banner
          currentResult && EL("div", {
            style: {
              background: "var(--hdr)",
              border: "1px solid var(--line2)",
              borderRadius: "8px",
              padding: "10px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap"
            }
          },
            EL("div", null,
              EL("span", { style: { display: "block", fontSize: "10.5px", color: "var(--muted)", textTransform: "uppercase" } }, "Modeled Federal Tax"),
              EL("strong", { style: { fontSize: "14px", color: "var(--ink)" } }, usd$(currentResult.r.totalTax))
            ),
            EL("div", null,
              EL("span", { style: { display: "block", fontSize: "10.5px", color: "var(--muted)", textTransform: "uppercase" } }, "Effective Rate"),
              EL("strong", { style: { fontSize: "14px", color: "var(--indigo-deep)" } }, pct(currentResult.r.effectiveRate))
            ),
            EL("div", null,
              EL("span", { style: { display: "block", fontSize: "10.5px", color: "var(--muted)", textTransform: "uppercase" } }, "Spendable Cash"),
              EL("strong", { style: { fontSize: "14px", color: "var(--green)" } }, usd$(currentResult.r.spendableAfterTaxCash))
            )
          ),

          EL("p", { style: { fontSize: "13px", lineHeight: "1.6", color: "var(--ink2)", margin: 0 } },
            "Exports the complete Form 1040 line walk, Schedule 1 adjustments, deductions, §199A, and economic metrics for ",
            EL("strong", null, currentScenario.name), " (TY", year, " · ", status.toUpperCase(), ") directly to a new Google Sheet."
          ),

          EL("div", { style: { background: "var(--card)", border: "1px solid var(--line)", borderRadius: "8px", padding: "12px", fontSize: "12px" } },
            EL("strong", { style: { display: "block", marginBottom: "6px", color: "var(--ink)" } }, "Generated Google Sheet Tabs:"),
            EL("ul", { style: { paddingLeft: "18px", margin: 0, lineHeight: "1.7", color: "var(--ink2)" } },
              EL("li", null, EL("strong", null, "Tab 1: Scenario Ledger Walk"), " — Complete Form 1040 line walk with dollar amounts and statutory IRC references"),
              EL("li", null, "Tab 2: Client & Due Diligence — Client goals, liquidity constraints, rules vintage, and missing facts")
            )
          )
        ),

        exportMode === "all" && EL("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } },
          EL("p", { style: { fontSize: "13px", lineHeight: "1.6", color: "var(--ink2)", margin: 0 } },
            "Export ", EL("strong", null, scenarios.length, " scenarios"), " for ",
            EL("strong", null, client ? client.name : "Active Client"), " side-by-side with variances and Form 1040 line walks directly to a new Google Sheet."
          ),
          EL("div", { style: { background: "var(--card)", border: "1px solid var(--line)", borderRadius: "8px", padding: "12px", fontSize: "12px" } },
            EL("strong", { style: { display: "block", marginBottom: "6px", color: "var(--ink)" } }, "Generated Google Sheet Tabs:"),
            EL("ul", { style: { paddingLeft: "18px", margin: 0, lineHeight: "1.7", color: "var(--ink2)" } },
              EL("li", null, "Tab 1: Scenario Comparison (Total Tax, Effective Rates, Spendable Cash, Variances)"),
              EL("li", null, "Tab 2: Form 1040 Walk & Input Ledger (Wages, S-Corp K-1, Sched C, Passthrough, Deductions)"),
              EL("li", null, "Tab 3: Client Profile, Liquidity Constraints & Unresolved Due Diligence Facts")
            )
          )
        ),

        EL("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" } },
          EL("button", {
            className: "tp-btn ghost sm",
            type: "button",
            onClick: onClose
          }, "Cancel"),
          EL("button", {
            className: "tp-btn solid sm",
            style: { background: "#047857", borderColor: "#047857", color: "#fff" },
            type: "button",
            onClick: handleStartExport
          }, I.sheets, exportMode === "current" ? " Sync to Google Sheets" : " Create Live Google Sheet")
        )
      ),

      step === "exporting" && EL("div", { style: { padding: "30px 10px", textAlign: "center" } },
        EL("div", { style: { fontSize: "28px", marginBottom: "12px" } }, "⏳"),
        EL("strong", { style: { display: "block", fontSize: "14px", marginBottom: "6px" } }, "Syncing to Google Sheets…"),
        EL("p", { style: { fontSize: "12px", color: "var(--muted)", margin: 0 } },
          exportMode === "current"
            ? "Creating new Google Sheet and writing '" + (currentScenario ? currentScenario.name : "Scenario") + "' ledger via Google Sheets API v4…"
            : "Creating multi-scenario comparison sheet and applying professional cell styling via Google Sheets API…"
        )
      ),

      step === "done" && result && EL("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } },
        EL("div", {
          style: {
            background: "var(--green-bg)",
            border: "1px solid var(--green-line)",
            borderRadius: "8px",
            padding: "14px",
            display: "flex",
            alignItems: "center",
            gap: "10px"
          }
        },
          EL("span", { style: { fontSize: "24px" } }, "✅"),
          EL("div", null,
            EL("strong", { style: { color: "var(--green)", display: "block", fontSize: "13.5px" } }, "Synced to Google Sheets Successfully!"),
            EL("span", { style: { fontSize: "11.5px", color: "var(--ink2)" } }, result.title)
          )
        ),
        EL("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginTop: "6px" } },
          EL("button", {
            className: "tp-btn ghost sm",
            onClick: onClose
          }, "Close"),
          EL("a", {
            href: result.spreadsheetUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            className: "tp-btn solid sm",
            style: {
              background: "#047857",
              borderColor: "#047857",
              color: "#fff",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px"
            }
          }, I.sheets, " Open in Google Sheets ↗")
        )
      ),

      step === "error" && EL("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } },
        EL("div", {
          style: {
            background: "var(--red-bg)",
            border: "1px solid var(--red-line)",
            borderRadius: "8px",
            padding: "12px",
            color: "var(--red)",
            fontSize: "12.5px"
          }
        },
          EL("strong", { style: { display: "block", marginBottom: "4px" } }, "Sync Failed:"),
          errorMsg
        ),
        EL("p", { style: { fontSize: "12px", color: "var(--muted)", margin: 0 } },
          "Please verify that your Google account is connected with Google Sheets permissions."
        ),
        EL("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" } },
          EL("button", {
            className: "tp-btn ghost sm",
            onClick: onClose
          }, "Close"),
          EL("button", {
            className: "tp-btn solid sm",
            style: { background: "#047857", borderColor: "#047857", color: "#fff" },
            onClick: handleStartExport
          }, "Retry Sync")
        )
      )
    )
  );
}

/* ============================================================================
   GOOGLE SHEETS WORKSPACE HUB & INSPECTOR PAGE
   ========================================================================== */
function GoogleSheetsPage({
  client,
  scenarios,
  results,
  bestId,
  baseline,
  status,
  year,
  auditLog,
  notes,
  goto,
  onOpenExport
}) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [sheetsList, setSheetsList] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState("info");

  // Selected spreadsheet inspection state
  const [selectedSheetId, setSelectedSheetId] = useState(null);
  const [selectedSheetMeta, setSelectedSheetMeta] = useState(null);
  const [selectedSheetTab, setSelectedSheetTab] = useState(null);
  const [tabValues, setTabValues] = useState([]);
  const [tabLoading, setTabLoading] = useState(false);

  // Sync confirmation modal state (MANDATORY destructive/overwriting action rule)
  const [confirmSyncSheet, setConfirmSyncSheet] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);

  const flash = (msg, type = "info") => {
    setNotice(msg);
    setNoticeType(type);
    setTimeout(() => setNotice(""), 5000);
  };

  useEffect(() => {
    const unsub = initDriveAuth(
      (u, tok) => {
        setUser(u);
        setToken(tok);
      },
      () => {
        setUser(null);
        setToken(null);
      }
    );
    return () => unsub();
  }, []);

  const handleSignIn = async () => {
    setAuthLoading(true);
    try {
      const res = await googleDriveSignIn();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        flash("Connected to Google Sheets as " + res.user.email, "success");
        loadSpreadsheets();
      }
    } catch (err) {
      console.error("Sign in failed:", err);
      flash("Sign in failed: " + err.message, "error");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await googleDriveSignOut();
      setUser(null);
      setToken(null);
      setSheetsList([]);
      setSelectedSheetId(null);
      setSelectedSheetMeta(null);
      setTabValues([]);
      flash("Disconnected from Google Sheets.", "info");
    } catch (err) {
      flash("Disconnect error: " + err.message, "error");
    }
  };

  const loadSpreadsheets = async () => {
    setListLoading(true);
    try {
      const res = await sheetsListSpreadsheets({ q: searchQuery, pageSize: 40 });
      setSheetsList(res.files || []);
    } catch (err) {
      console.error("Failed to list spreadsheets:", err);
      flash("Failed to list spreadsheets: " + err.message, "error");
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadSpreadsheets();
    }
  }, [token, searchQuery]);

  // Inspect selected spreadsheet
  const handleSelectSpreadsheet = async (sheetFile) => {
    setSelectedSheetId(sheetFile.id);
    setTabLoading(true);
    try {
      const meta = await sheetsGetSpreadsheet(sheetFile.id);
      setSelectedSheetMeta(meta);
      const firstTab = (meta.sheets && meta.sheets[0] && meta.sheets[0].properties.title) || null;
      setSelectedSheetTab(firstTab);
      if (firstTab) {
        await loadTabValues(sheetFile.id, firstTab);
      }
    } catch (err) {
      console.error("Failed to fetch spreadsheet details:", err);
      flash("Failed to load spreadsheet details: " + err.message, "error");
    } finally {
      setTabLoading(false);
    }
  };

  const loadTabValues = async (sheetId, tabTitle) => {
    setTabLoading(true);
    try {
      const valRes = await sheetsGetValues(sheetId, `'${tabTitle}'!A1:Z50`);
      setTabValues(valRes.values || []);
    } catch (err) {
      console.error("Failed to load tab values:", err);
      flash("Failed to read sheet cells: " + err.message, "error");
      setTabValues([]);
    } finally {
      setTabLoading(false);
    }
  };

  const handleTabChange = async (tabTitle) => {
    setSelectedSheetTab(tabTitle);
    if (selectedSheetId && tabTitle) {
      await loadTabValues(selectedSheetId, tabTitle);
    }
  };

  // Perform confirmed sync to existing spreadsheet
  const executeSyncToSheet = async () => {
    if (!confirmSyncSheet) return;
    setSyncLoading(true);
    try {
      const res = await syncScenariosToExistingGoogleSheet({
        spreadsheetId: confirmSyncSheet.id,
        client,
        scenarios,
        results,
        status,
        year,
        bestId,
        baseline
      });
      flash(`Successfully updated spreadsheet "${res.title}" with current scenarios!`, "success");
      setConfirmSyncSheet(null);
      // Reload tab values if currently previewed
      if (selectedSheetId === confirmSyncSheet.id && selectedSheetTab) {
        loadTabValues(selectedSheetId, selectedSheetTab);
      }
    } catch (err) {
      console.error("Sync failed:", err);
      flash("Sync failed: " + err.message, "error");
    } finally {
      setSyncLoading(false);
    }
  };

  return EL("div", { className: "tp-stack" },
    notice && EL("div", {
      className: "tp-validbar " + (noticeType === "error" ? "has-error" : (noticeType === "success" ? "is-clean" : "has-missing")),
      style: { marginBottom: "14px" }
    },
      EL("strong", null, noticeType === "error" ? "🛑 Error: " : (noticeType === "success" ? "✓ Success: " : "ℹ️ Note: ")),
      notice
    ),

    // Header Card
    EL(Card, { title: "Google Sheets Workspace Synchronization" },
      EL("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" } },
        EL("div", { style: { maxWidth: "620px" } },
          EL("p", { style: { fontSize: "13px", lineHeight: "1.6", color: "var(--ink2)" } },
            "Connect Google Sheets with permission to create live multi-scenario tax workbooks, inspect client financial spreadsheets, and synchronize Form 1040 line walks directly with your Google Workspace account under project ",
            EL("code", { style: { background: "var(--hdr)", padding: "1px 5px", borderRadius: "4px" } }, "gen-lang-client-0858870142"),
            "."
          ),
          EL("div", { style: { display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" } },
            EL("span", { className: "tp-tag" }, "Cloud Project: gen-lang-client-0858870142"),
            EL("span", { className: "tp-tag" }, "API: Sheets v4"),
            EL("span", { className: "tp-tag" }, "Scopes: spreadsheets, spreadsheets.readonly"),
            user ? EL("span", { className: "tp-tag green" }, "Connected: " + user.email) : EL("span", { className: "tp-tag gray" }, "Status: Not connected")
          )
        ),
        EL("div", { style: { display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end" } },
          !user ? EL(GoogleSignInButton, {
            onClick: handleSignIn,
            loading: authLoading,
            label: "Sign in with Google to Connect Sheets"
          }) : EL("div", { style: { display: "flex", alignItems: "center", gap: "10px" } },
            user.photoURL && EL("img", {
              src: user.photoURL,
              alt: user.displayName || "User",
              style: { width: "32px", height: "32px", borderRadius: "50%", border: "1px solid var(--line)" }
            }),
            EL("div", { style: { textAlign: "right" } },
              EL("strong", { style: { display: "block", fontSize: "12.5px" } }, user.displayName || "Google User"),
              EL("span", { style: { fontSize: "11px", color: "var(--muted)" } }, user.email)
            ),
            EL("button", {
              className: "tp-btn ghost sm",
              type: "button",
              onClick: handleSignOut
            }, "Disconnect")
          )
        )
      )
    ),

    // Quick Actions
    user && EL(Card, { title: "Quick Actions — " + client.name + " (TY" + year + ")" },
      EL("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
        EL("button", {
          className: "tp-btn solid sm",
          style: { background: "#047857", borderColor: "#047857", color: "#fff" },
          type: "button",
          onClick: () => onOpenExport && onOpenExport("current")
        }, I.sheets, " Sync to Google Sheets"),
        EL("button", {
          className: "tp-btn ghost sm",
          type: "button",
          onClick: () => onOpenExport && onOpenExport("all")
        }, I.table, " Create Multi-Scenario Google Sheet"),
        EL("button", {
          className: "tp-btn ghost sm",
          type: "button",
          onClick: loadSpreadsheets,
          disabled: listLoading
        }, "⟳ Refresh Spreadsheets"),
        EL("button", {
          className: "tp-btn ghost sm",
          type: "button",
          onClick: () => goto && goto("drive")
        }, I.drive, " Browse Google Drive Files →"),
        EL("button", {
          className: "tp-btn ghost sm",
          type: "button",
          onClick: () => goto && goto("scenarios")
        }, "Go to Scenario Workspace →")
      )
    ),

    // Main 2-column or stacked layout: Spreadsheet List + Live Spreadsheet Inspector
    user && EL("div", { style: { display: "grid", gridTemplateColumns: selectedSheetMeta ? "320px 1fr" : "1fr", gap: "16px", alignItems: "start" } },
      // Column 1: Spreadsheets List
      EL(Card, { title: "Google Spreadsheets in Your Drive" },
        EL("div", { style: { display: "flex", gap: "6px", marginBottom: "12px" } },
          EL("input", {
            className: "tp-txt sm",
            style: { width: "100%", fontSize: "12px" },
            placeholder: "Search spreadsheets…",
            value: searchQuery,
            onChange: e => setSearchQuery(e.target.value)
          }),
          searchQuery && EL("button", {
            className: "tp-mini",
            onClick: () => setSearchQuery("")
          }, "✕")
        ),
        listLoading ? EL("div", { style: { padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" } },
          "Loading spreadsheets from Google Drive…"
        ) : sheetsList.length === 0 ? EL("div", { style: { padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" } },
          "No Google Spreadsheets found. Click 'Sync to Google Sheets' above to create one!"
        ) : EL("div", { style: { display: "flex", flexDirection: "column", gap: "8px", maxHeight: "560px", overflowY: "auto" } },
          sheetsList.map(s => {
            const isSelected = selectedSheetId === s.id;
            const modDate = s.modifiedTime ? new Date(s.modifiedTime).toLocaleDateString() : "";
            return EL("div", {
              key: s.id,
              style: {
                padding: "10px 12px",
                border: "1px solid " + (isSelected ? "var(--indigo)" : "var(--line)"),
                borderRadius: "8px",
                background: isSelected ? "var(--indigo-bg)" : "var(--card)",
                cursor: "pointer",
                transition: "all 0.15s ease"
              },
              onClick: () => handleSelectSpreadsheet(s)
            },
              EL("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "6px" } },
                EL("div", { style: { minWidth: 0 } },
                  EL("strong", {
                    style: {
                      display: "block",
                      fontSize: "12.5px",
                      color: isSelected ? "var(--indigo-deep)" : "var(--ink)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    },
                    title: s.name
                  }, s.name),
                  EL("span", { style: { fontSize: "11px", color: "var(--muted)" } }, "Modified: " + modDate)
                ),
                s.webViewLink && EL("a", {
                  href: s.webViewLink,
                  target: "_blank",
                  rel: "noopener noreferrer",
                  className: "tp-mini",
                  style: { textDecoration: "none", flexShrink: 0, padding: "2px 6px" },
                  onClick: e => e.stopPropagation(),
                  title: "Open in Google Sheets (external tab)"
                }, "↗")
              )
            );
          })
        )
      ),

      // Column 2: Live Spreadsheet Inspector & Preview
      selectedSheetMeta && EL(Card, {
        title: "Live Spreadsheet Inspector: " + selectedSheetMeta.properties.title
      },
        EL("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginBottom: "12px", flexWrap: "wrap" } },
          // Tab Switcher
          EL("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" } },
            EL("span", { style: { fontSize: "12px", fontWeight: "600", color: "var(--muted)" } }, "Tabs:"),
            (selectedSheetMeta.sheets || []).map(sh => {
              const tabTitle = sh.properties.title;
              const isTabActive = selectedSheetTab === tabTitle;
              return EL("button", {
                key: tabTitle,
                type: "button",
                className: "tp-mini " + (isTabActive ? "primary" : ""),
                style: { padding: "4px 10px", fontSize: "11.5px" },
                onClick: () => handleTabChange(tabTitle)
              }, tabTitle);
            })
          ),
          // Actions on selected sheet
          EL("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
            EL("button", {
              className: "tp-btn solid sm",
              style: { background: "#d97706", borderColor: "#b45309", color: "#fff" },
              type: "button",
              title: "Update this spreadsheet with the active scenario calculation values (requires confirmation)",
              onClick: () => setConfirmSyncSheet({
                id: selectedSheetId,
                name: selectedSheetMeta.properties.title,
                tab: selectedSheetTab
              })
            }, "Sync Current Scenarios to Sheet"),
            selectedSheetMeta.spreadsheetUrl && EL("a", {
              href: selectedSheetMeta.spreadsheetUrl,
              target: "_blank",
              rel: "noopener noreferrer",
              className: "tp-btn ghost sm",
              style: { textDecoration: "none" }
            }, "Open in Google Sheets ↗")
          )
        ),

        // Live Grid Table
        tabLoading ? EL("div", { style: { padding: "40px", textAlign: "center", color: "var(--muted)", fontSize: "12.5px" } },
          "Reading cells from Google Sheets API v4…"
        ) : tabValues.length === 0 ? EL("div", { style: { padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: "12.5px" } },
          "No values found in sheet tab '" + selectedSheetTab + "'."
        ) : EL("div", {
          style: {
            overflowX: "auto",
            maxHeight: "500px",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            background: "var(--card)"
          }
        },
          EL("table", { className: "tp-table", style: { width: "100%", fontSize: "11.5px", borderCollapse: "collapse" } },
            EL("thead", null,
              EL("tr", null,
                EL("th", { style: { width: "40px", background: "var(--hdr)", textAlign: "center", color: "var(--muted)" } }, "#"),
                (tabValues[0] || []).map((_, colIdx) => {
                  const letter = String.fromCharCode(65 + (colIdx % 26));
                  return EL("th", {
                    key: colIdx,
                    style: { background: "var(--hdr)", textAlign: colIdx === 0 ? "left" : "right", fontWeight: "600", color: "var(--ink2)" }
                  }, letter);
                })
              )
            ),
            EL("tbody", null,
              tabValues.map((row, rowIdx) => EL("tr", { key: rowIdx, style: { background: rowIdx === 0 ? "var(--hdr)" : "transparent" } },
                EL("td", { style: { background: "var(--hdr)", textAlign: "center", color: "var(--muted)", fontWeight: "600", fontSize: "10px" } }, rowIdx + 1),
                row.map((cell, colIdx) => EL("td", {
                  key: colIdx,
                  style: {
                    textAlign: colIdx === 0 ? "left" : (isNaN(cell) || cell === "" ? "left" : "right"),
                    fontWeight: rowIdx === 0 || colIdx === 0 ? "600" : "400",
                    whiteSpace: "nowrap",
                    padding: "6px 10px"
                  }
                }, cell != null ? String(cell) : ""))
              ))
            )
          )
        )
      )
    ),

    // Mandatory Destructive Mutation Confirmation Dialog
    EL(GoogleSheetsConfirmModal, {
      open: !!confirmSyncSheet,
      title: "Update Google Spreadsheet: " + (confirmSyncSheet ? confirmSyncSheet.name : ""),
      message: confirmSyncSheet ? `Are you sure you want to write and update the scenario comparison and ledger data in Google Sheet "${confirmSyncSheet.name}"? This operation overwrites cell values in the sheet with the latest calculation results.` : "",
      itemDetails: confirmSyncSheet ? `Spreadsheet ID: ${confirmSyncSheet.id} · Active Year: TY${year} · Target Tabs: 'Scenario Comparison', 'Input Ledger'` : null,
      confirmLabel: "Confirm & Overwrite Sheet",
      loading: syncLoading,
      onConfirm: executeSyncToSheet,
      onCancel: () => setConfirmSyncSheet(null)
    })
  );
}
