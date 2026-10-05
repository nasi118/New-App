/* ==== 03b-validate ==== */
/* ============================================================================
   SCENARIO VALIDATION
   Three levels:
     error — blocking: the scenario cannot carry a recommended designation
     warn  — material: the result is computable but a fact needs confirmation
     info  — informational review point
   Validation never mutates inputs; it only reports.
   ========================================================================== */
function validateScenario(s, r, status, year) {
  const C = TY[year];
  const out = [];
  const push = (level, code, msg) => out.push({
    level,
    code,
    msg
  });

  /* Dividends: qualified is a subset of ordinary */
  if (num(s.qualifiedDividends) > num(s.ordinaryDividends) + 0.5) {
    push("error", "qual-div", "Qualified dividends (" + usd$(num(s.qualifiedDividends)) + ") exceed ordinary dividends (" + usd$(num(s.ordinaryDividends)) + "). Qualified dividends are a subset of ordinary dividends and cannot be larger.");
  }

  /* Social Security: taxable portion cannot exceed benefits, or 85% of them */
  const ssTot = num(s.socialSecurityTotal),
    ssTax = num(s.socialSecurityTaxable);
  if (ssTot > 0 && ssTax > ssTot + 0.5) {
    push("error", "ss-taxable", "Taxable Social Security (" + usd$(ssTax) + ") exceeds total benefits received (" + usd$(ssTot) + ").");
  } else if (ssTot > 0 && ssTax > 0.85 * ssTot + 0.5) {
    push("warn", "ss-85", "Taxable Social Security exceeds 85% of benefits — the statutory maximum inclusion is 85%.");
  }

  /* Senior / blind counts limited by filing status */
  const maxPersons = status === "mfj" ? 2 : 1;
  if (num((s.sched1A || {}).seniorCount) > maxPersons) {
    push("error", "senior-count", "Eligible senior count (" + num(s.sched1A.seniorCount) + ") exceeds the " + maxPersons + " taxpayer(s) permitted by this filing status. The engine caps the count at " + maxPersons + ".");
  }
  if (num((s.sched1A || {}).blindCount) > maxPersons) {
    push("error", "blind-count", "Blind-taxpayer count exceeds the " + maxPersons + " taxpayer(s) permitted by this filing status.");
  }

  /* HSA consistency */
  const P = s.planning || {};
  if (P.hsaMode === "manual" && num(P.hsaManual) > r.hsaLimit + 0.5) {
    push("warn", "hsa-limit", "HSA entry of " + usd$(num(P.hsaManual)) + " exceeds the applicable limit of " + usd$(r.hsaLimit) + " — the engine deducts only the limit.");
  }
  if (P.hsaMode && P.hsaMode !== "off" && num(P.age) > 0 && num(P.age) < 55 && P.hsaCatchup) {
    push("error", "hsa-catchup", "HSA catch-up contributions require age 55 or older.");
  }

  /* Roth conversions vs. retirement distributions */
  if (num(s.rothConversion) > 0 && num(s.iraDistributions) === 0 && num(s.rothConversionSource) !== 1) {
    push("info", "roth-src", "A Roth conversion is modeled with no IRA distribution entered. Conversions are reported separately here, but confirm the converted amount is not double-counted in distributions.");
  }

  /* S corporation: compensation cannot exceed available business economics */
  (s.sCorps && s.sCorps.entities || []).forEach(e => {
    const profit = num(e.profitBeforeComp);
    const comp = num(e.ownerComp);
    if (comp > 0 && profit > 0 && comp + Math.min(comp, C.ssWageBase) * 0.062 + comp * 0.0145 + num(e.otherExpenses) > profit + 0.5) {
      push("error", "scorp-comp", (e.name || "S corporation") + ": owner compensation plus employer payroll tax and other expenses (" + usd$(comp + Math.min(comp, C.ssWageBase) * 0.062 + comp * 0.0145 + num(e.otherExpenses)) + ") exceeds profit before compensation (" + usd$(profit) + "), driving the K-1 negative. Confirm the business economics support this wage.");
    }
  });

  /* Legacy manual K-1 entries cannot be reconciled to entity economics */
  if (num(s.sCorpComp) > 0 || num(s.sCorpK1) > 0) {
    push("warn", "scorp-legacy", "Legacy manual S-corporation compensation/K-1 entries are in use. They cannot be reconciled to entity-level economics (profit, employer payroll tax, expenses) — move them into an S-corporation entity for a derived, auditable K-1.");
  }

  /* QBI entities */
  (s.qbi && s.qbi.entities || []).forEach(e => {
    if (num(e.ubia) < 0) {
      push("error", "ubia-neg", (e.name || "QBI entity") + ": UBIA cannot be negative.");
    }
    if (!e.link && num(e.w2) > 0) {
      push("info", "qbi-w2-link", (e.name || "QBI entity") + ": W-2 wages are entered by hand. Confirm the wages belong to this same qualified trade or business — only that business's wages count for its §199A limitation.");
    }
  });

  /* Itemized entries must not be negative */
  const a = s.scheduleA || {};
  ["stateIncomeTax", "salesTax", "realEstateTax", "personalPropertyTax", "mortgageInterest", "points", "investmentInterest", "charityCash", "charityNonCash", "charityCarryover"].forEach(k => {
    if (num(a[k]) < 0) push("error", "schedA-neg", "Schedule A entry \"" + k + "\" is negative. Itemized deduction entries must not be negative.");
  });

  /* Capital losses: engine enforces the Sec. 1211(b) limit; surface it */
  const capNet = num(s.shortTermGains) + num(s.longTermGains);
  const capLimit = status === "mfs" ? 1500 : 3000;
  if (capNet < -capLimit) {
    push("info", "cap-loss", "Net capital loss of " + usd$(Math.abs(capNet)) + " exceeds the " + usd$(capLimit) + " annual deduction limit — " + usd$(Math.abs(capNet) - capLimit) + " carries forward. The engine already applies the limit.");
  }

  /* Tax-exempt interest reaches the ACA and IRMAA MAGIs */
  if (num(s.taxExemptInterest) > 0) {
    push("info", "texempt-magi", "Tax-exempt interest of " + usd$(num(s.taxExemptInterest)) + " is included in the ACA and IRMAAs MAGI measures, as required — it does not affect taxable income.");
  }

  /* Credits floor at zero */
  if (r.creditsApplied > r.fedIncomeTax + 0.5) {
    push("error", "credit-floor", "Credits applied exceed the income tax — nonrefundable credits cannot reduce tax below zero.");
  }

  /* NIIT classifications needing human review */
  (r.niitReview || []).forEach(w => push("warn", "niit-review", w));

  /* Schedule 1-A blocked for MFS */
  if (status === "mfs" && r.S1A && r.S1A.ineligibleReason) {
    const entered = num((s.sched1A || {}).seniorCount) > 0 || num((s.sched1A || {}).tips) > 0 || num((s.sched1A || {}).overtime) > 0 || num((s.sched1A || {}).autoLoanInterest) > 0;
    if (entered) push("warn", "mfs-1a", "Schedule 1-A amounts are entered but the deductions are not available when married filing separately. The allowed amount is $0.");
  }

  /* Student loan interest */
  if (r.studentLoan && r.studentLoan.entered > 0) {
    if (r.studentLoan.reason) push("warn", "sl-limited", "Student loan interest: " + r.studentLoan.reason + " Allowed deduction " + usd$(r.studentLoan.allowed) + ".");
    else if (r.studentLoan.entered > r.studentLoan.max) push("info", "sl-cap", "Student loan interest entered (" + usd$(r.studentLoan.entered) + ") exceeds the statutory maximum — the deduction is capped at " + usd$(r.studentLoan.max) + " before the MAGI phase-out.");
  }

  return {
    all: out,
    errors: out.filter(v => v.level === "error"),
    warnings: out.filter(v => v.level === "warn"),
    infos: out.filter(v => v.level === "info"),
    blocking: out.some(v => v.level === "error")
  };
}

/* ============================================================================
   LEDGER VALIDATION AUDIT
   Aggregates statutory tax rule warnings, blocking errors, review notices,
   and unconfirmed or missing data points across every scenario and client fact
   in the current scenario workspace ledger.
   ========================================================================== */
function getValidationMetadata(code) {
  switch (code) {
    case "qual-div":
      return { category: "Dividends", citation: "IRC §1(h)(11)", title: "Qualified dividends exceed ordinary dividends", actionLabel: "Open Int/Div Drilldown", actionType: "drill-intdiv" };
    case "ss-taxable":
      return { category: "Social Security", citation: "IRC §86", title: "Taxable Social Security exceeds total benefits", actionLabel: "Review Income Group", actionType: "group-income" };
    case "ss-85":
      return { category: "Social Security", citation: "IRC §86(a)(2)", title: "Taxable Social Security exceeds 85% statutory cap", actionLabel: "Review Income Group", actionType: "group-income" };
    case "senior-count":
      return { category: "Filing Status", citation: "IRC §63(f)", title: "Senior count exceeds allowable taxpayers", actionLabel: "Review Deductions Group", actionType: "group-ded" };
    case "blind-count":
      return { category: "Filing Status", citation: "IRC §63(f)", title: "Blind count exceeds allowable taxpayers", actionLabel: "Review Deductions Group", actionType: "group-ded" };
    case "hsa-limit":
      return { category: "HSA", citation: "IRC §223(b)", title: "HSA contribution exceeds annual limit", actionLabel: "Review Deductions Group", actionType: "group-ded" };
    case "hsa-catchup":
      return { category: "HSA", citation: "IRC §223(b)(3)", title: "HSA catch-up requires age 55 or older", actionLabel: "Review Deductions Group", actionType: "group-ded" };
    case "roth-src":
      return { category: "Roth IRA", citation: "IRC §408A", title: "Roth conversion without IRA distribution entered", actionLabel: "Review Income Group", actionType: "group-income" };
    case "scorp-comp":
      return { category: "S Corporation", citation: "IRC §1366", title: "Owner compensation and expenses exceed profit", actionLabel: "Open S-Corp Drilldown", actionType: "drill-scorp" };
    case "scorp-legacy":
      return { category: "S Corporation", citation: "IRC §1366", title: "Legacy manual S-Corp entries in use", actionLabel: "Open S-Corp Drilldown", actionType: "drill-scorp" };
    case "ubia-neg":
      return { category: "QBI / §199A", citation: "IRC §199A(b)(6)", title: "UBIA cannot be negative", actionLabel: "Open S-Corp Drilldown", actionType: "drill-scorp" };
    case "qbi-w2-link":
      return { category: "QBI / §199A", citation: "IRC §199A(b)(2)", title: "Unlinked manual W-2 wages in QBI entity", actionLabel: "Open S-Corp Drilldown", actionType: "drill-scorp" };
    case "schedA-neg":
      return { category: "Itemized Deductions", citation: "IRC §67, §164", title: "Negative Schedule A deduction entry", actionLabel: "Review Deductions Group", actionType: "group-ded" };
    case "cap-loss":
      return { category: "Capital Losses", citation: "IRC §1211(b)", title: "Net capital loss exceeds statutory deduction cap", actionLabel: "Review Income Group", actionType: "group-income" };
    case "texempt-magi":
      return { category: "MAGI Calculation", citation: "IRC §36B, §1411", title: "Tax-exempt interest reaches ACA/IRMAA MAGI", actionLabel: "Review Income Group", actionType: "group-income" };
    case "credit-floor":
      return { category: "Tax Credits", citation: "IRC §21-§27", title: "Nonrefundable credits exceed income tax liability", actionLabel: "Review Other Group", actionType: "group-other" };
    case "niit-review":
      return { category: "NIIT §1411", citation: "IRC §1411(c)", title: "NIIT classification requires human review", actionLabel: "Review Passthrough Drilldown", actionType: "drill-passthrough" };
    case "mfs-1a":
      return { category: "Schedule 1-A", citation: "P.L. 119-21 (OBBBA)", title: "Schedule 1-A deductions disallowed under MFS", actionLabel: "Review Deductions Group", actionType: "group-ded" };
    case "sl-limited":
      return { category: "Student Loan", citation: "IRC §221", title: "Student loan interest deduction phased out / disallowed", actionLabel: "Review Deductions Group", actionType: "group-ded" };
    case "sl-cap":
      return { category: "Student Loan", citation: "IRC §221(b)(1)", title: "Student loan interest capped at statutory maximum", actionLabel: "Review Deductions Group", actionType: "group-ded" };
    default:
      return { category: "Tax Rules", citation: "IRC Statutory Rules", title: "Tax rule review notification", actionLabel: "Review Details", actionType: "ask-ai" };
  }
}

function auditLedgerValidation(ledgerScenarios, ledgerResults, client, status, year) {
  const items = [];
  const add = item => items.push(item);
  const seenKeys = new Set();
  const pushUnique = item => {
    const key = (item.scenarioId || "") + ":" + item.kind + ":" + (item.code || "") + ":" + item.msg;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      add(item);
    }
  };

  const scenList = Array.isArray(ledgerScenarios) ? ledgerScenarios : [];
  const resList = Array.isArray(ledgerResults) ? ledgerResults : [];

  scenList.forEach((s, idx) => {
    const resEntry = resList.find(x => (x.s && (x.s.viewId || x.s.id)) === (s.viewId || s.id)) || resList[idx];
    const r = resEntry ? resEntry.r : null;
    const effYear = s.calcYear || year;
    const v = resEntry && resEntry.v ? resEntry.v : (r ? validateScenario(s, r, status, effYear) : null);

    if (resEntry && resEntry.calcError) {
      pushUnique({
        id: (s.viewId || s.id) + "-calc-error",
        scenarioId: s.id,
        scenarioViewId: s.viewId || s.id,
        scenarioName: s.name + (s.calcYear ? " (TY" + s.calcYear + ")" : ""),
        kind: "error",
        code: "calc-error",
        category: "Calculation Engine",
        citation: "Deterministic Engine",
        title: "Scenario computation failure",
        msg: resEntry.calcError,
        actionLabel: "Review Scenario Inputs",
        actionType: "group-income"
      });
    }

    if (v) {
      (v.errors || []).forEach((err, i) => {
        const meta = getValidationMetadata(err.code);
        pushUnique({
          id: (s.viewId || s.id) + "-err-" + i + "-" + err.code,
          scenarioId: s.id,
          scenarioViewId: s.viewId || s.id,
          scenarioName: s.name + (s.calcYear ? " (TY" + s.calcYear + ")" : ""),
          kind: "error",
          code: err.code,
          category: meta.category,
          citation: meta.citation,
          title: meta.title,
          msg: err.msg,
          actionLabel: meta.actionLabel,
          actionType: meta.actionType
        });
      });

      (v.warnings || []).forEach((w, i) => {
        const meta = getValidationMetadata(w.code);
        pushUnique({
          id: (s.viewId || s.id) + "-warn-" + i + "-" + w.code,
          scenarioId: s.id,
          scenarioViewId: s.viewId || s.id,
          scenarioName: s.name + (s.calcYear ? " (TY" + s.calcYear + ")" : ""),
          kind: "warn",
          code: w.code,
          category: meta.category,
          citation: meta.citation,
          title: meta.title,
          msg: w.msg,
          actionLabel: meta.actionLabel,
          actionType: meta.actionType
        });
      });

      (v.infos || []).forEach((inf, i) => {
        const meta = getValidationMetadata(inf.code);
        pushUnique({
          id: (s.viewId || s.id) + "-info-" + i + "-" + inf.code,
          scenarioId: s.id,
          scenarioViewId: s.viewId || s.id,
          scenarioName: s.name + (s.calcYear ? " (TY" + s.calcYear + ")" : ""),
          kind: "info",
          code: inf.code,
          category: meta.category,
          citation: meta.citation,
          title: meta.title,
          msg: inf.msg,
          actionLabel: meta.actionLabel,
          actionType: meta.actionType
        });
      });
    }

    // Ledger missing data points checks:
    // 1. S-Corp profit with zero/missing owner compensation
    (s.sCorps && s.sCorps.entities || []).forEach(e => {
      const profit = num(e.profitBeforeComp);
      const comp = num(e.ownerComp);
      if (profit > 0 && comp <= 0) {
        pushUnique({
          id: (s.viewId || s.id) + "-missing-scorp-comp-" + (e.id || e.name),
          scenarioId: s.id,
          scenarioViewId: s.viewId || s.id,
          scenarioName: s.name + (s.calcYear ? " (TY" + s.calcYear + ")" : ""),
          kind: "missing",
          code: "missing-scorp-comp",
          category: "S Corporation",
          citation: "Rev. Rul. 74-44 · IRS Reasonable Comp",
          title: "Missing owner compensation in " + (e.name || "S corporation"),
          msg: (e.name || "S corporation") + " reports " + usd$(profit) + " profit before compensation, but $0 owner W-2 compensation. Shareholder-employees providing substantial services must receive reasonable W-2 wages before distributions.",
          actionLabel: "Open S-Corp Drilldown",
          actionType: "drill-scorp",
          entityId: e.id
        });
      }
    });

    // 2. Incomplete Social Security reporting
    const ssTot = num(s.socialSecurityTotal);
    const ssTax = num(s.socialSecurityTaxable);
    if (ssTot > 0 && ssTax === 0) {
      pushUnique({
        id: (s.viewId || s.id) + "-missing-ss-taxable",
        scenarioId: s.id,
        scenarioViewId: s.viewId || s.id,
        scenarioName: s.name + (s.calcYear ? " (TY" + s.calcYear + ")" : ""),
        kind: "missing",
        code: "missing-ss-taxable",
        category: "Social Security",
        citation: "Form 1040 Line 6b · IRS Pub 915",
        title: "Missing taxable Social Security calculation",
        msg: "Total Social Security benefits of " + usd$(ssTot) + " entered, but taxable portion is $0. Verify Form SSA-1099 Box 5 or calculate provisional income.",
        actionLabel: "Review Income Group",
        actionType: "group-income"
      });
    } else if (ssTax > 0 && ssTot === 0) {
      pushUnique({
        id: (s.viewId || s.id) + "-missing-ss-total",
        scenarioId: s.id,
        scenarioViewId: s.viewId || s.id,
        scenarioName: s.name + (s.calcYear ? " (TY" + s.calcYear + ")" : ""),
        kind: "missing",
        code: "missing-ss-total",
        category: "Social Security",
        citation: "Form 1040 Line 6a · Form SSA-1099",
        title: "Missing gross Social Security total benefits",
        msg: "Taxable Social Security of " + usd$(ssTax) + " entered, but total gross benefits is $0. Enter total benefits to verify the statutory 85% inclusion limit.",
        actionLabel: "Review Income Group",
        actionType: "group-income"
      });
    }

    // 3. Significant Schedule C profit with no retirement plan modeled
    if (r && r.schedC > 25000 && (!s.planning || !s.planning.planType || s.planning.planType === "none")) {
      const C = TY[effYear] || TY[2026];
      pushUnique({
        id: (s.viewId || s.id) + "-missing-retire",
        scenarioId: s.id,
        scenarioViewId: s.viewId || s.id,
        scenarioName: s.name + (s.calcYear ? " (TY" + s.calcYear + ")" : ""),
        kind: "missing",
        code: "missing-retire",
        category: "Retirement",
        citation: "IRC §401(k), §404(h)",
        title: "No retirement plan elected for Schedule C business",
        msg: "Schedule C net profit is " + usd$(r.schedC) + ", but no qualified retirement plan is modeled. A SEP-IRA or Solo 401(k) election can shelter up to " + usd$(Math.min(C ? C.limit415c : 70000, r.schedC * 0.2)) + " in taxable income.",
        actionLabel: "Review Deductions Group",
        actionType: "group-ded"
      });
    }

    // 4. Significant Schedule C profit with no health insurance deduction modeled
    if (r && r.schedC > 15000 && r.sehiDeduction === 0 && num((s.sehi || {}).medicalPremiums) === 0) {
      pushUnique({
        id: (s.viewId || s.id) + "-missing-sehi",
        scenarioId: s.id,
        scenarioViewId: s.viewId || s.id,
        scenarioName: s.name + (s.calcYear ? " (TY" + s.calcYear + ")" : ""),
        kind: "missing",
        code: "missing-sehi",
        category: "Health Insurance",
        citation: "IRC §162(l)",
        title: "No self-employed health insurance deduction entered",
        msg: "Schedule C net profit is " + usd$(r.schedC) + " with $0 health insurance deduction. Confirm if taxpayer or family paid medical or dental premiums eligible for above-the-line deduction.",
        actionLabel: "Review Deductions Group",
        actionType: "group-ded"
      });
    }

    // 5. QBI wage/UBIA limitation missing when taxable income is high
    const qbiThresh = TY[effYear] && TY[effYear].qbi ? (status === "mfj" ? TY[effYear].qbi.mfj : TY[effYear].qbi.single) : 201750;
    if (r && r.taxableIncome > qbiThresh) {
      (s.qbi && s.qbi.entities || []).forEach(e => {
        if (num(e.w2) === 0 && num(e.ubia) === 0 && num(e.qbi) > 0) {
          pushUnique({
            id: (s.viewId || s.id) + "-missing-qbi-" + (e.id || e.name),
            scenarioId: s.id,
            scenarioViewId: s.viewId || s.id,
            scenarioName: s.name + (s.calcYear ? " (TY" + s.calcYear + ")" : ""),
            kind: "missing",
            code: "missing-qbi-data",
            category: "QBI / §199A",
            citation: "IRC §199A(b)(2)",
            title: "Missing W-2 wages and UBIA for '" + (e.name || "QBI entity") + "'",
            msg: "Taxable income (" + usd$(r.taxableIncome) + ") exceeds the §199A threshold (" + usd$(qbiThresh) + "). Entity '" + (e.name || "QBI entity") + "' has $0 W-2 wages and $0 UBIA entered, which will restrict the deduction to $0 under the statutory wage/UBIA limitation.",
            actionLabel: "Open S-Corp Drilldown",
            actionType: "drill-scorp"
          });
        }
      });
    }

    // 6. Schedule A partial taxes entered with zero mortgage/charity and below standard deduction
    if (s.scheduleA) {
      const taxes = num(s.scheduleA.stateIncomeTax) + num(s.scheduleA.realEstateTax) + num(s.scheduleA.salesTax);
      const itemizedTotal = taxes + num(s.scheduleA.mortgageInterest) + num(s.scheduleA.charityCash) + num(s.scheduleA.charityNonCash);
      const stdDed = r ? r.stdDeduction : (TY[effYear] && TY[effYear].stdDeduction ? TY[effYear].stdDeduction[status] : 15750);
      if (taxes > 0 && num(s.scheduleA.mortgageInterest) === 0 && num(s.scheduleA.charityCash) === 0 && itemizedTotal < stdDed) {
        pushUnique({
          id: (s.viewId || s.id) + "-missing-schedA-records",
          scenarioId: s.id,
          scenarioViewId: s.viewId || s.id,
          scenarioName: s.name + (s.calcYear ? " (TY" + s.calcYear + ")" : ""),
          kind: "missing",
          code: "missing-schedA-records",
          category: "Itemized Deductions",
          citation: "Schedule A · Form 1098",
          title: "Potential missing mortgage interest or charitable receipts",
          msg: "State & local taxes of " + usd$(taxes) + " are entered on Schedule A, but mortgage interest and charitable gifts are $0. Total itemized deductions (" + usd$(itemizedTotal) + ") remain below the standard deduction (" + usd$(stdDed) + "). Confirm if Form 1098 or gift records are missing.",
          actionLabel: "Review Deductions Group",
          actionType: "group-ded"
        });
      }
    }
  });

  // Client-level missing facts
  if (client && Array.isArray(client.missingFacts) && client.missingFacts.length > 0) {
    client.missingFacts.forEach((fact, idx) => {
      if (fact && fact.trim()) {
        pushUnique({
          id: "client-missing-fact-" + idx,
          scenarioId: "client",
          scenarioViewId: "client",
          scenarioName: "Client Profile (" + (client.name || "Active Client") + ")",
          kind: "missing",
          code: "client-fact",
          category: "Client Fact Sheet",
          citation: "Due Diligence · Circular 230",
          title: "Unconfirmed client fact: " + (fact.length > 44 ? fact.slice(0, 44) + "…" : fact),
          msg: fact + " — Required for complete scenario validation. Confirm fact before finalizing planning memorandum.",
          actionLabel: "Review Client Record",
          actionType: "missing-facts"
        });
      }
    });
  }

  const errors = items.filter(x => x.kind === "error");
  const warnings = items.filter(x => x.kind === "warn");
  const missing = items.filter(x => x.kind === "missing");
  const infos = items.filter(x => x.kind === "info");

  return {
    items,
    errors,
    warnings,
    missing,
    infos,
    errorsCount: errors.length,
    warningsCount: warnings.length,
    missingCount: missing.length,
    infosCount: infos.length,
    totalIssues: items.length,
    isClean: errors.length === 0 && warnings.length === 0 && missing.length === 0,
    hasBlocking: errors.length > 0
  };
}
