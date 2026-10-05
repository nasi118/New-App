/* ==== 27-presentation-demo ==== */
/* ============================================================================
   PRESENTATION DEMO PAGE — Interactive Slide Deck & Feature Showcase
   Designed for live stakeholder presentations, client advisory reviews,
   partner demonstrations, and guided platform walkthroughs.
   Includes:
   - Interactive 6-slide executive presentation with keyboard & click controls
   - Real-time live strategy sandbox comparing Sole Prop vs. S-Corp vs. Pension
   - Speaker notes drawer for advisor talking points and legal disclosures
   - Interactive feature catalog & module deep-dive tour
   - Direct scenario staging and jump to full workbench
   ========================================================================== */

const DEMO_SLIDES = [
  {
    id: "exec-overview",
    number: "01",
    eyebrow: "Executive Overview & Problem",
    title: "Tax Planning Built for Decisions That Happen Before the Return",
    subtitle: "Why conventional compliance and static spreadsheets fail high-net-worth clients.",
    notes: "Speaker talking point: Emphasize that traditional CPA work is reactive compliance (filing post-year-end). By then, retirement plan establishment deadlines, S-Corp election windows, and entity restructure options are closed. This workbench turns tax strategy into a proactive, auditable planning discussion."
  },
  {
    id: "trust-engine",
    number: "02",
    eyebrow: "Platform Architecture",
    title: "The Trust Engine: Engine Computes, AI Explains, Advisor Decides",
    subtitle: "A deterministic calculation core backed by primary-source legal authorities.",
    notes: "Speaker talking point: Highlight our anti-hallucination architectural rule. Large language models do NOT calculate taxes here. The deterministic engine executes enacted IRC code with 41 golden regression tests. AI is restricted to drafting explanations, identifying strategy candidates, and formatting reports."
  },
  {
    id: "live-sandbox",
    number: "03",
    eyebrow: "Interactive Demonstration",
    title: "Live Strategy Modeling: Sole Prop vs. S-Corp vs. Pension",
    subtitle: "Test real-world income, compensation, and retirement variables in real time.",
    notes: "Speaker talking point: Demonstrate the live sliders. Show how adjusting officer compensation reduces FICA payroll taxes, but watch the interaction with Section 199A QBI wage limitation. This multi-variable trade-off is where clients gain $20k-$50k in annual after-tax savings."
  },
  {
    id: "trusts-estates",
    number: "04",
    eyebrow: "Fiduciary Specialization",
    title: "Trusts & Estates: Form 1041, DNI & Compressed Brackets",
    subtitle: "Navigate the highest 37% federal rate at only $15,650 of retained trust income.",
    notes: "Speaker talking point: Trust tax planning is notoriously high-stakes because trust brackets compress rapidly (reaching 37% at just ~$15.6k vs $751k for married couples). Show how our DNI / Schedule B distribution modeling prevents unnecessary tax leakage and flags abusive trust schemes."
  },
  {
    id: "ai-optimizer",
    number: "05",
    eyebrow: "Intelligence & Governance",
    title: "AI Advisory Workspace & Mathematical Optimization",
    subtitle: "Algorithmically sweep variables for optimal compensation and preserve full auditability.",
    notes: "Speaker talking point: Point out the optimization solver. Instead of guessing a reasonable salary, the solver iterates through wage levels to find the exact mathematical apex where FICA savings exceed any lost QBI deduction. Every change is logged with an immutable audit timestamp."
  },
  {
    id: "client-deliverables",
    number: "06",
    eyebrow: "Practice Management & Delivery",
    title: "Executive Deliverables & Multi-Client Suite",
    subtitle: "Turn technical calculations into client-facing Form 1040 walks, PDF reports, and live Excel workbooks.",
    notes: "Speaker talking point: Close with the advisor deliverables. Show how this elevates the client experience from a confusing tax return to an executive decision briefing, complete with safe harbor quarterly payment calendars and formulas-intact Excel exports."
  }
];

function PresentationDemoPage({
  goto,
  client,
  scenarios,
  results,
  bestId,
  baseline,
  status,
  year,
  setActiveId,
  setFocusId,
  onAddModelScenario
}) {
  const [slideIdx, setSlideIdx] = useState(0);
  const [viewMode, setViewMode] = useState("slides"); // 'slides' | 'features'
  const [showNotes, setShowNotes] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Live Sandbox state on Slide 3
  const [sbRevenue, setSbRevenue] = useState(480000);
  const [sbSalary, setSbSalary] = useState(130000);
  const [sbRetPlan, setSbRetPlan] = useState("solo401k"); // 'none' | 'solo401k' | 'pension'
  const [sbStatus, setSbStatus] = useState(status || "married_filing_jointly");
  const [sbYear, setSbYear] = useState(year || 2026);
  const [sbAppliedMessage, setSbAppliedMessage] = useState(null);

  // Keyboard navigation for presentation
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept when user is typing in an input
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        setSlideIdx(i => Math.min(DEMO_SLIDES.length - 1, i + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setSlideIdx(i => Math.max(0, i - 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setSlideIdx(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setSlideIdx(DEMO_SLIDES.length - 1);
      } else if (e.key === "n" || e.key === "N") {
        setShowNotes(v => !v);
      } else if (e.key === "f" || e.key === "F") {
        setIsFullscreen(v => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const currentSlide = DEMO_SLIDES[slideIdx];

  // Deterministic Sandbox Computation using the app's real engine
  const sandboxResults = useMemo(() => {
    // 1. Sole Proprietor Baseline
    const solePropScenario = {
      id: "demo-soleprop",
      name: "Sole Proprietorship (Sched C)",
      w2Wages: 0,
      schedCNet: sbRevenue,
      sCorpComp: 0,
      sCorpK1: 0,
      scorps: [],
      planning: { planType: "none" }
    };
    const rSoleProp = computeScenario(solePropScenario, sbStatus, sbYear);

    // 2. S-Corp Election (W-2 Salary + Distribution K-1)
    const sCorpScenario = {
      id: "demo-scorp",
      name: "S-Corp Election (" + usd$(sbSalary) + " W-2)",
      w2Wages: 0,
      schedCNet: 0,
      scorps: [{
        id: "demo-scorp-entity",
        name: "Operating S-Corp",
        profitBeforeComp: sbRevenue,
        ownerComp: sbSalary,
        otherExpenses: 0,
        nonOwnerW2: 0,
        ubia: 0,
        ownershipPct: 100,
        sstb: false,
        active: true
      }],
      planning: { planType: "none" }
    };
    const rSCorp = computeScenario(sCorpScenario, sbStatus, sbYear);

    // 3. S-Corp + Retirement Plan (Solo 401k or Pension)
    const retContribution = sbRetPlan === "pension" ? 115000 : (sbRetPlan === "solo401k" ? 69000 : 0);
    const sCorpRetScenario = {
      id: "demo-scorp-ret",
      name: "S-Corp + " + (sbRetPlan === "pension" ? "Cash Balance DB Plan" : "Solo 401(k)"),
      w2Wages: 0,
      schedCNet: 0,
      scorps: [{
        id: "demo-scorp-ret-entity",
        name: "Operating S-Corp",
        profitBeforeComp: sbRevenue,
        ownerComp: sbSalary,
        otherExpenses: 0,
        nonOwnerW2: 0,
        ubia: 0,
        ownershipPct: 100,
        sstb: false,
        active: true
      }],
      planning: {
        planType: sbRetPlan === "none" ? "none" : "solo401k",
        employeeDeferral: sbRetPlan === "none" ? 0 : 23000,
        employerMode: "auto",
        employerManual: sbRetPlan === "pension" ? 92000 : 0
      }
    };
    const rSCorpRet = computeScenario(sCorpRetScenario, sbStatus, sbYear);

    const taxSoleProp = Math.round(rSoleProp.totalTax);
    const taxSCorp = Math.round(rSCorp.totalTax);
    const taxSCorpRet = Math.round(rSCorpRet.totalTax);

    const savingsSCorp = taxSoleProp - taxSCorp;
    const savingsRet = taxSoleProp - taxSCorpRet;

    return {
      rSoleProp,
      rSCorp,
      rSCorpRet,
      taxSoleProp,
      taxSCorp,
      taxSCorpRet,
      savingsSCorp,
      savingsRet,
      scorpSEFICA: Math.round(rSCorp.sCorpFICA),
      solePropSE: Math.round(rSoleProp.seTax),
      ficaSavings: Math.round(rSoleProp.seTax - rSCorp.sCorpFICA),
      qbiSoleProp: Math.round(rSoleProp.qbiDeduction),
      qbiSCorp: Math.round(rSCorp.qbiDeduction),
      retContribution
    };
  }, [sbRevenue, sbSalary, sbRetPlan, sbStatus, sbYear]);

  const handleStageStrategy = () => {
    const s = {
      id: uid(),
      name: "Modeled S-Corp (" + usd$(sbSalary) + " W-2)",
      schedCNet: 0,
      scorps: [{
        id: uid(),
        name: (client ? client.name : "Operating") + " Advisory Corp",
        profitBeforeComp: sbRevenue,
        ownerComp: sbSalary,
        otherExpenses: 0,
        nonOwnerW2: 0,
        ubia: 0,
        ownershipPct: 100,
        sstb: false,
        active: true
      }],
      planning: {
        age: 46,
        planType: sbRetPlan === "none" ? "none" : "solo401k",
        employeeDeferral: sbRetPlan === "none" ? 0 : 23000,
        employerMode: "auto"
      }
    };
    if (onAddModelScenario) {
      onAddModelScenario(s);
    } else if (goto) {
      goto("scenarios");
    }
    setSbAppliedMessage("Staged scenario loaded into Workbench!");
    setTimeout(() => setSbAppliedMessage(null), 3500);
  };

  const handleCopyLink = () => {
    const url = window.location.origin + "/presentation-demo.html";
    navigator.clipboard?.writeText(url).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    });
  };

  return EL("div", {
    className: "tp-demo-root" + (isFullscreen ? " is-fullscreen" : "")
  },

    /* ================= Top Bar ================= */
    EL("div", { className: "tp-demo-topbar" },
      EL("div", { className: "tp-demo-top-left" },
        EL("span", { className: "tp-demo-badge" }, "PRESENTATION DEMO"),
        EL("div", { className: "tp-demo-titles" },
          EL("h2", null, "AI Tax Strategy Advisors"),
          EL("span", null, "Interactive Platform & Strategy Showcase")
        )
      ),

      EL("div", { className: "tp-demo-mode-toggles" },
        EL(Seg, {
          small: true,
          value: viewMode,
          onChange: setViewMode,
          options: [
            { v: "slides", l: "Slide Deck" },
            { v: "features", l: "Feature Tour" }
          ]
        })
      ),

      EL("div", { className: "tp-demo-top-actions" },
        EL("button", {
          type: "button",
          className: "tp-btn ghost sm" + (showNotes ? " active" : ""),
          onClick: () => setShowNotes(!showNotes),
          title: "Toggle Speaker Notes (N)"
        }, showNotes ? "Hide Notes" : "Speaker Notes"),

        EL("button", {
          type: "button",
          className: "tp-btn ghost sm",
          onClick: () => setIsFullscreen(!isFullscreen),
          title: "Toggle Expanded View (F)"
        }, isFullscreen ? "Collapse" : "Fullscreen"),

        EL("a", {
          className: "tp-btn ghost sm",
          href: "/presentation-demo.html",
          target: "_blank",
          rel: "noopener",
          title: "Open Standalone Presentation Demo in new tab"
        }, "Standalone Page ↗"),

        EL("button", {
          type: "button",
          className: "tp-btn solid sm tp-demo-launch-cta",
          onClick: () => goto ? goto("dashboard") : window.location.href = "/",
          title: "Return to full live Tax Planning Workbench"
        }, "Launch Workbench →")
      )
    ),

    /* ================= Slide Deck Mode ================= */
    viewMode === "slides" && EL("div", { className: "tp-demo-stage-container" },

      /* Slide Navigation Strip */
      EL("div", { className: "tp-demo-slide-nav" },
        EL("div", { className: "tp-demo-slide-dots" },
          DEMO_SLIDES.map((s, idx) => EL("button", {
            key: s.id,
            type: "button",
            className: "tp-demo-dot" + (idx === slideIdx ? " active" : ""),
            onClick: () => setSlideIdx(idx),
            title: "Slide " + s.number + ": " + s.eyebrow
          },
            EL("span", { className: "dot-num" }, s.number),
            EL("span", { className: "dot-label" }, s.eyebrow)
          ))
        ),

        EL("div", { className: "tp-demo-nav-arrows" },
          EL("button", {
            type: "button",
            className: "tp-demo-arrow-btn",
            disabled: slideIdx === 0,
            onClick: () => setSlideIdx(i => Math.max(0, i - 1)),
            title: "Previous Slide (Left Arrow)"
          }, "‹ Prev"),
          EL("span", { className: "tp-demo-slide-counter" },
            (slideIdx + 1) + " / " + DEMO_SLIDES.length
          ),
          EL("button", {
            type: "button",
            className: "tp-demo-arrow-btn",
            disabled: slideIdx === DEMO_SLIDES.length - 1,
            onClick: () => setSlideIdx(i => Math.min(DEMO_SLIDES.length - 1, i + 1)),
            title: "Next Slide (Right Arrow or Space)"
          }, "Next ›")
        )
      ),

      /* Slide Display Area */
      EL("div", { className: "tp-demo-slide-canvas" },

        /* Slide Header */
        EL("div", { className: "tp-demo-slide-header" },
          EL("div", { className: "tp-demo-kicker" },
            EL("span", { className: "tp-demo-slide-pill" }, "SLIDE " + currentSlide.number),
            EL("span", { className: "tp-demo-eyebrow" }, currentSlide.eyebrow)
          ),
          EL("h1", { className: "tp-demo-slide-title" }, currentSlide.title),
          EL("p", { className: "tp-demo-slide-sub" }, currentSlide.subtitle)
        ),

        /* Slide Body Content */
        EL("div", { className: "tp-demo-slide-body" },

          /* ---------------- SLIDE 1: Executive Overview ---------------- */
          slideIdx === 0 && EL("div", { className: "tp-demo-slide-layout" },
            EL("div", { className: "tp-demo-cols-2" },
              EL("div", { className: "tp-demo-card pain-card" },
                EL("div", { className: "tp-demo-card-tag bad" }, "THE STATUS QUO PROBLEM"),
                EL("h3", null, "Reactive Compliance & Spreadsheet Fragility"),
                EL("ul", { className: "tp-demo-bullet-list" },
                  EL("li", null, EL("strong", null, "Post-Mortem Advice:"), " Traditional CPAs deliver tax bills 4 months after year-end, when 100% of planning opportunities have expired."),
                  EL("li", null, EL("strong", null, "Spreadsheet Collapse:"), " Custom Excel sheets break when tax brackets index, fail to model SSTB phase-outs, and cannot handle W-2 wage limitations."),
                  EL("li", null, EL("strong", null, "Black-Box Hallucinations:"), " Generic AI models guess brackets and fabricate non-existent deductions, risking severe client audit penalties.")
                ),
                EL("div", { className: "tp-demo-stat-box bad" },
                  EL("span", null, "Typical annual tax leakage per HNW business owner:"),
                  EL("strong", null, "$18,000 – $65,000+")
                )
              ),

              EL("div", { className: "tp-demo-card solution-card" },
                EL("div", { className: "tp-demo-card-tag ok" }, "THE WORKBENCH SOLUTION"),
                EL("h3", null, "Proactive, Deterministic Engineering"),
                EL("ul", { className: "tp-demo-bullet-list" },
                  EL("li", null, EL("strong", null, "Pre-Filing Modeling:"), " Model entity conversions, pension design, and §199A QBI strategies while the calendar year is still active."),
                  EL("li", null, EL("strong", null, "Zero-Hallucination Math:"), " Deterministic engine with enacted Rev. Proc. 2024-40 and 2025-32 inflation indexing across TY2025 & TY2026."),
                  EL("li", null, EL("strong", null, "Instant Scenario Isolation:"), " Compare Baseline vs. S-Corp vs. Cash Balance Pension side-by-side with exact dollar deltas.")
                ),
                EL("div", { className: "tp-demo-stat-box ok" },
                  EL("span", null, "Mathematical tie-outs in regression test suite:"),
                  EL("strong", null, "41 Enacted Golden Benchmarks")
                )
              )
            ),

            EL("div", { className: "tp-demo-feature-strip" },
              EL("div", { className: "tp-demo-mini-kpi" },
                EL("span", null, "Supported Years"),
                EL("b", null, "TY2025 & TY2026"),
                EL("small", null, "Enacted statutory indexing")
              ),
              EL("div", { className: "tp-demo-mini-kpi" },
                EL("span", null, "2026 SS Wage Base"),
                EL("b", null, "$184,500"),
                EL("small", null, "Notice 2025-67 enacted cap")
              ),
              EL("div", { className: "tp-demo-mini-kpi" },
                EL("span", null, "Calculation Engine"),
                EL("b", null, "100% Deterministic"),
                EL("small", null, "Form 1040 line walk tie-out")
              ),
              EL("div", { className: "tp-demo-mini-kpi" },
                EL("span", null, "Client Management"),
                EL("b", null, "Isolated Profiles"),
                EL("small", null, "Multi-client localStorage")
              )
            )
          ),

          /* ---------------- SLIDE 2: Trust Engine Architecture ---------------- */
          slideIdx === 1 && EL("div", { className: "tp-demo-slide-layout" },
            EL("div", { className: "tp-demo-arch-grid" },
              EL("div", { className: "tp-demo-arch-box" },
                EL("div", { className: "tp-demo-arch-num" }, "01"),
                EL("h4", null, "Fact Input Layer"),
                EL("p", null, "Client financial profile, business entities (Sched C, S-Corp, 1065), W-2 wages, depreciation, and asset balances.")
              ),
              EL("div", { className: "tp-demo-arch-arrow" }, "→"),
              EL("div", { className: "tp-demo-arch-box highlight" },
                EL("div", { className: "tp-demo-arch-num" }, "02"),
                EL("h4", null, "Deterministic Core"),
                EL("p", null, "Formula-driven engine executes brackets, capital gains stacking, FICA wage-cap coordination, and §199A phase-outs.")
              ),
              EL("div", { className: "tp-demo-arch-arrow" }, "→"),
              EL("div", { className: "tp-demo-arch-box" },
                EL("div", { className: "tp-demo-arch-num" }, "03"),
                EL("h4", null, "Authority Citations"),
                EL("p", null, "Every line item links directly to IRC statutes, Treasury Regulations, Revenue Procedures, and tax court precedent.")
              ),
              EL("div", { className: "tp-demo-arch-arrow" }, "→"),
              EL("div", { className: "tp-demo-arch-box ai" },
                EL("div", { className: "tp-demo-arch-num" }, "04"),
                EL("h4", null, "AI Advisory Layer"),
                EL("p", null, "AI synthesizes scenarios, checks edge cases, identifies optimization candidates, and drafts executive client memos.")
              )
            ),

            EL("div", { className: "tp-demo-pillars-grid" },
              EL("div", { className: "tp-demo-pillar" },
                EL("strong", null, "1. Strict Bounded Scope"),
                EL("p", null, "When facts touch unsupported territory (e.g. AMT, complex international PFICs), the app fires a diagnostic alert rather than fabricating a guess.")
              ),
              EL("div", { className: "tp-demo-pillar" },
                EL("strong", null, "2. Primary Source Law"),
                EL("p", null, "Grounding in IRC §§ 199A, 1402, 162(l), 401(k), 404(h), 1411 and Rev. Proc. 2024-40 / 2025-32.")
              ),
              EL("div", { className: "tp-demo-pillar" },
                EL("strong", null, "3. Immutable Audit Trail"),
                EL("p", null, "Every keystroke and assumption adjustment records a timestamped audit entry showing previous value, new value, and tax movement.")
              )
            )
          ),

          /* ---------------- SLIDE 3: Live Interactive Sandbox ---------------- */
          slideIdx === 2 && EL("div", { className: "tp-demo-sandbox-wrapper" },
            EL("div", { className: "tp-demo-sandbox-controls" },
              EL("div", { className: "tp-demo-sb-group" },
                EL("label", null,
                  EL("span", null, "Annual Business Net Profit: ", EL("strong", null, usd$(sbRevenue))),
                  EL("input", {
                    type: "range",
                    min: 150000,
                    max: 1200000,
                    step: 25000,
                    value: sbRevenue,
                    onChange: e => setSbRevenue(Number(e.target.value))
                  })
                )
              ),

              EL("div", { className: "tp-demo-sb-group" },
                EL("label", null,
                  EL("span", null, "Officer W-2 Compensation: ", EL("strong", null, usd$(sbSalary))),
                  EL("input", {
                    type: "range",
                    min: 50000,
                    max: Math.min(sbRevenue, 280000),
                    step: 5000,
                    value: sbSalary,
                    onChange: e => setSbSalary(Number(e.target.value))
                  })
                )
              ),

              EL("div", { className: "tp-demo-sb-row" },
                EL("label", { className: "tp-demo-sb-sel" },
                  EL("span", null, "Retirement Architecture"),
                  EL("select", {
                    value: sbRetPlan,
                    onChange: e => setSbRetPlan(e.target.value)
                  },
                    EL("option", { value: "none" }, "No Plan (Base)"),
                    EL("option", { value: "solo401k" }, "Solo 401(k) ($23k deferral + 25% profit sharing)"),
                    EL("option", { value: "pension" }, "Defined Benefit / Cash Balance Pension ($115k capacity)")
                  )
                ),

                EL("label", { className: "tp-demo-sb-sel" },
                  EL("span", null, "Filing Status"),
                  EL("select", {
                    value: sbStatus,
                    onChange: e => setSbStatus(e.target.value)
                  },
                    EL("option", { value: "married_filing_jointly" }, "Married Filing Jointly"),
                    EL("option", { value: "single" }, "Single"),
                    EL("option", { value: "head_of_household" }, "Head of Household")
                  )
                )
              )
            ),

            /* Results Comparison Grid */
            EL("div", { className: "tp-demo-sb-cards" },
              // Card 1: Sole Prop
              EL("div", { className: "tp-demo-sb-card" },
                EL("div", { className: "sb-card-head" }, "1. Sole Proprietorship", EL("span", { className: "tp-pill" }, "Baseline")),
                EL("div", { className: "sb-tax-total" }, usd$(sandboxResults.taxSoleProp)),
                EL("div", { className: "sb-breakdown" },
                  EL("div", { className: "sb-row" }, EL("span", null, "Self-Employment Tax:"), EL("strong", null, usd$(sandboxResults.solePropSE))),
                  EL("div", { className: "sb-row" }, EL("span", null, "Income Tax:"), EL("span", null, usd$(Math.round(sandboxResults.rSoleProp.fedIncomeTax)))),
                  EL("div", { className: "sb-row" }, EL("span", null, "QBI Deduction:"), EL("span", null, usd$(sandboxResults.qbiSoleProp))),
                  EL("div", { className: "sb-row" }, EL("span", null, "Effective Rate:"), EL("span", null, pct(sandboxResults.rSoleProp.effectiveRate)))
                )
              ),

              // Card 2: S-Corp
              EL("div", { className: "tp-demo-sb-card highlight" },
                EL("div", { className: "sb-card-head" }, "2. S-Corp Restructure", EL("span", { className: "tp-pill ok" }, "Saves " + usd$(sandboxResults.savingsSCorp))),
                EL("div", { className: "sb-tax-total ok" }, usd$(sandboxResults.taxSCorp)),
                EL("div", { className: "sb-breakdown" },
                  EL("div", { className: "sb-row" }, EL("span", null, "Officer FICA (W-2):"), EL("strong", null, usd$(sandboxResults.scorpSEFICA))),
                  EL("div", { className: "sb-row" }, EL("span", null, "FICA Savings:"), EL("strong", { className: "green" }, "+" + usd$(sandboxResults.ficaSavings))),
                  EL("div", { className: "sb-row" }, EL("span", null, "QBI Deduction:"), EL("span", null, usd$(sandboxResults.qbiSCorp))),
                  EL("div", { className: "sb-row" }, EL("span", null, "Effective Rate:"), EL("span", null, pct(sandboxResults.rSCorp.effectiveRate)))
                )
              ),

              // Card 3: S-Corp + Retirement
              EL("div", { className: "tp-demo-sb-card best" },
                EL("div", { className: "sb-card-head" }, "3. S-Corp + Pension", EL("span", { className: "tp-pill best" }, "★ Saves " + usd$(sandboxResults.savingsRet))),
                EL("div", { className: "sb-tax-total best" }, usd$(sandboxResults.taxSCorpRet)),
                EL("div", { className: "sb-breakdown" },
                  EL("div", { className: "sb-row" }, EL("span", null, "Pre-Tax Retirement:"), EL("strong", { className: "green" }, usd$(sandboxResults.retContribution))),
                  EL("div", { className: "sb-row" }, EL("span", null, "Officer FICA:"), EL("span", null, usd$(Math.round(sandboxResults.rSCorpRet.sCorpFICA)))),
                  EL("div", { className: "sb-row" }, EL("span", null, "Total Tax Savings:"), EL("strong", { className: "green" }, usd$(sandboxResults.savingsRet))),
                  EL("div", { className: "sb-row" }, EL("span", null, "Effective Rate:"), EL("span", null, pct(sandboxResults.rSCorpRet.effectiveRate)))
                )
              )
            ),

            /* Action row */
            EL("div", { className: "tp-demo-sb-footer" },
              EL("div", { className: "sb-foot-summary" },
                EL("strong", null, "Modeled Annual Tax Advantage: "),
                EL("span", { className: "green" }, usd$(sandboxResults.savingsRet) + " total reduction in federal tax liability")
              ),
              EL("div", { style: { display: "flex", gap: "10px", alignItems: "center" } },
                sbAppliedMessage && EL("span", { className: "tp-pill ok" }, sbAppliedMessage),
                EL("button", {
                  type: "button",
                  className: "tp-btn solid",
                  onClick: handleStageStrategy
                }, "Stage This Scenario in Workbench →")
              )
            )
          ),

          /* ---------------- SLIDE 4: Trusts & Estates ---------------- */
          slideIdx === 3 && EL("div", { className: "tp-demo-slide-layout" },
            EL("div", { className: "tp-demo-cols-2" },
              EL("div", { className: "tp-demo-card" },
                EL("div", { className: "tp-demo-card-tag alert" }, "THE COMPRESSED BRACKET TRAP"),
                EL("h3", null, "Form 1041 Compressed Brackets"),
                EL("p", { className: "tp-demo-card-desc" }, "Non-grantor trusts hit the maximum 37% federal tax rate at just $15,650 of taxable income in TY2025/TY2026, compared to $751,600 for married joint filers."),
                EL("div", { className: "tp-demo-rate-comparison" },
                  EL("div", { className: "rate-col" },
                    EL("span", null, "Individual (MFJ) 37% Bracket"),
                    EL("strong", null, "$751,600+ AGI")
                  ),
                  EL("div", { className: "rate-col alert" },
                    EL("span", null, "Fiduciary (1041) 37% Bracket"),
                    EL("strong", null, "$15,650+ Retained")
                  )
                ),
                EL("p", { style: { fontSize: "12px", color: "var(--muted)", marginTop: "12px" } },
                  "Failing to plan trust distributions can trigger a 37% income tax rate plus the 3.8% Net Investment Income Tax (total 40.8%) on modest portfolio gains."
                )
              ),

              EL("div", { className: "tp-demo-card" },
                EL("div", { className: "tp-demo-card-tag ok" }, "BUILT-IN FIDUCIARY TOOLS"),
                EL("h3", null, "Distributable Net Income & GST Optimization"),
                EL("ul", { className: "tp-demo-bullet-list" },
                  EL("li", null, EL("strong", null, "Schedule B Distribution Deduction:"), " Accurately allocate DNI to shift income out of the 37% compressed bracket to beneficiaries in lower personal brackets."),
                  EL("li", null, EL("strong", null, "GST Exemption Tracker:"), " Model allocation of the lifetime Generation-Skipping Transfer tax exemption ($15M capacity)."),
                  EL("li", null, EL("strong", null, "24-Step Fiduciary Review Checklist:"), " Complete checklist covering accounting income vs taxable income, 65-day rule (IRC § 663(b)), and state situs."),
                  EL("li", null, EL("strong", null, "Promoter Scam Red-Flag Detection:"), " Flags abusive 'spendthrift/constitutional' non-grantor trust marketing claims with statutory warnings.")
                )
              )
            ),

            EL("div", { className: "tp-demo-trust-alert" },
              EL("strong", null, "Statutory Grounding: "),
              "IRC Subchapter J (§§ 641–692), Distributable Net Income rules under IRC § 643(a), and 65-day distribution elections under IRC § 663(b)."
            )
          ),

          /* ---------------- SLIDE 5: AI Advisory & Optimizer ---------------- */
          slideIdx === 4 && EL("div", { className: "tp-demo-slide-layout" },
            EL("div", { className: "tp-demo-cols-2" },
              EL("div", { className: "tp-demo-card" },
                EL("div", { className: "tp-demo-card-tag ai" }, "AI STRATEGY WORKSPACE"),
                EL("h3", null, "Advisory Inquiries Grounded in Facts"),
                EL("div", { className: "tp-demo-chat-mock" },
                  EL("div", { className: "chat-msg user" },
                    "What is the optimal officer compensation for Elena's $480k consulting business to maximize after-tax cash?"
                  ),
                  EL("div", { className: "chat-msg ai" },
                    EL("strong", null, "Deterministic Analysis:"),
                    EL("p", null, "At $480k profit, an S-Corp W-2 of $130,000 saves $14,840 in FICA taxes while preserving $70,000 in §199A QBI deduction. Combining this with a Solo 401(k) profit-sharing contribution ($55,500) reduces total federal liability from $148,600 to $112,450 — a net annual advantage of $36,150.")
                  )
                )
              ),

              EL("div", { className: "tp-demo-card" },
                EL("div", { className: "tp-demo-card-tag ok" }, "MATHEMATICAL OPTIMIZER"),
                EL("h3", null, "Algorithmic Variable Sweep"),
                EL("p", { className: "tp-demo-card-desc" }, "The Multi-Scenario Optimizer iterates through compensation increments to find the exact point where FICA payroll tax reductions balance against §199A wage ceiling thresholds."),
                EL("div", { className: "tp-demo-solver-box" },
                  EL("div", { className: "solver-step" },
                    EL("span", { className: "step-badge" }, "✓"),
                    EL("div", null, EL("b", null, "Wage Reasonableness Check:"), " RCReports & BLS industry wage cross-reference.")
                  ),
                  EL("div", { className: "solver-step" },
                    EL("span", { className: "step-badge" }, "✓"),
                    EL("div", null, EL("b", null, "QBI Limit Coordination:"), " Avoids dropping below 50% W-2 / 25% + 2.5% UBIA caps.")
                  ),
                  EL("div", { className: "solver-step" },
                    EL("span", { className: "step-badge" }, "✓"),
                    EL("div", null, EL("b", null, "Audit Trail Logging:"), " Every optimization stages an isolated test scenario.")
                  )
                )
              )
            ),

            EL("div", { className: "tp-demo-quote-box" },
              "“The AI does not decide the law or invent the numbers. It operates within strict boundaries: evaluating alternatives against the deterministic engine, providing primary citations, and presenting clear choices for professional sign-off.”"
            )
          ),

          /* ---------------- SLIDE 6: Client Deliverables ---------------- */
          slideIdx === 5 && EL("div", { className: "tp-demo-slide-layout" },
            EL("div", { className: "tp-demo-cols-3" },
              EL("div", { className: "tp-demo-card" },
                EL("div", { className: "tp-demo-card-tag" }, "DELIVERABLE 01"),
                EL("h3", null, "Form 1040 Line Walk"),
                EL("p", { className: "tp-demo-card-desc" }, "Clear side-by-side comparison of Schedule 1, Form 1040 Lines 1–24, and Schedule 2/3 credits for client review meetings.")
              ),

              EL("div", { className: "tp-demo-card" },
                EL("div", { className: "tp-demo-card-tag" }, "DELIVERABLE 02"),
                EL("h3", null, "Quarterly Payment Tracker"),
                EL("p", { className: "tp-demo-card-desc" }, "Calculates Q1–Q4 estimated tax voucher amounts, safe-harbor evaluation (90% current vs 110% prior year), and underpayment penalty avoidance.")
              ),

              EL("div", { className: "tp-demo-card" },
                EL("div", { className: "tp-demo-card-tag" }, "DELIVERABLE 03"),
                EL("h3", null, "Live-Formula Excel Export"),
                EL("p", { className: "tp-demo-card-desc" }, "Download full .xlsx workbooks with active Excel formulas throughout so associates and reviewers can independently audit every calculation.")
              )
            ),

            EL("div", { className: "tp-demo-cta-banner" },
              EL("div", { className: "cta-content" },
                EL("h2", null, "Ready to Explore the Live Workbench?"),
                EL("p", null, "Switch into the full working environment to model client profiles, test scenario variations, and generate client-ready advisory workpapers.")
              ),
              EL("div", { className: "cta-buttons" },
                EL("button", {
                  type: "button",
                  className: "tp-btn solid lg",
                  onClick: () => goto ? goto("dashboard") : window.location.href = "/"
                }, "Enter Tax Planning Workbench →"),
                EL("button", {
                  type: "button",
                  className: "tp-btn ghost lg",
                  onClick: () => goto ? goto("scenarios") : window.location.href = "/#scenarios"
                }, "Open Scenario Manager")
              )
            )
          )
        ),

        /* Slide Footer & Keyboard Tips */
        EL("div", { className: "tp-demo-slide-foot" },
          EL("div", { className: "tp-demo-keys-hint" },
            EL("span", null, "Keyboard: "),
            EL("kbd", null, "←"), " / ", EL("kbd", null, "→"), " Navigate slides · ",
            EL("kbd", null, "Space"), " Next · ",
            EL("kbd", null, "N"), " Speaker Notes · ",
            EL("kbd", null, "F"), " Fullscreen"
          ),
          EL("div", { className: "tp-demo-share-links" },
            EL("button", {
              type: "button",
              className: "tp-demo-link-btn",
              onClick: handleCopyLink
            }, copiedLink ? "✓ Link Copied" : "Copy Presentation Link"),
            EL("span", { className: "tp-demo-foot-copy" }, "© 2026 AI Tax Strategy Advisors")
          )
        )
      ),

      /* Speaker Notes Drawer */
      showNotes && EL("div", { className: "tp-demo-notes-drawer" },
        EL("div", { className: "tp-demo-notes-head" },
          EL("strong", null, "Advisor Speaker Notes — Slide " + currentSlide.number),
          EL("button", {
            type: "button",
            className: "tp-btn ghost sm",
            onClick: () => setShowNotes(false)
          }, "✕")
        ),
        EL("div", { className: "tp-demo-notes-body" },
          EL("p", null, currentSlide.notes),
          EL("div", { className: "tp-demo-notes-tips" },
            EL("strong", null, "Key Presentation Pointers:"),
            EL("ul", null,
              EL("li", null, "Highlight the transition from 'backward-looking tax filing' to 'forward-looking strategic wealth advisory'."),
              EL("li", null, "Emphasize that AI Tax Strategy Advisors is built by and for licensed CPAs and wealth managers."),
              EL("li", null, "Point out the live deterministic engine: zero estimations, zero hallucinated rules.")
            )
          )
        )
      )
    ),

    /* ================= Feature Catalog / Tour Mode ================= */
    viewMode === "features" && EL("div", { className: "tp-demo-features-container" },
      EL("div", { className: "tp-demo-tour-head" },
        EL("h2", null, "Workbench Feature Catalog & Interactive Tour"),
        EL("p", null, "Explore the modular capabilities of the Tax Planning Workbench. Click any module to jump directly to its active workbench in the app.")
      ),

      EL("div", { className: "tp-demo-bento-grid" },

        /* Feature 1 */
        EL("div", { className: "tp-demo-bento-card" },
          EL("div", { className: "bento-tag" }, "CORE PLANNING"),
          EL("h3", null, "Scenario Modeling & Form 1040 Walk"),
          EL("p", null, "Model unlimited parallel planning scenarios against a client's baseline tax facts. Features a live D3 tax liability comparison bar chart, effective tax rate tracking, and full Form 1040 line walk tie-outs."),
          EL("div", { className: "bento-authorities" }, "Authorities: IRC §§ 1, 61, 62, 63, Rev. Proc. 2024-40"),
          EL("button", {
            type: "button",
            className: "tp-btn ghost sm bento-cta",
            onClick: () => goto ? goto("dashboard") : window.location.href = "/"
          }, "Open Dashboard & Chart →")
        ),

        /* Feature 2 */
        EL("div", { className: "tp-demo-bento-card" },
          EL("div", { className: "bento-tag" }, "BUSINESS TAX"),
          EL("h3", null, "Self-Employment & S-Corp Compensation"),
          EL("p", null, "Evaluate Schedule C sole proprietors against S-Corporation elections. Coordinates the $184,500 Social Security wage base with W-2 wages and computes precise employer and employee FICA obligations."),
          EL("div", { className: "bento-authorities" }, "Authorities: IRC §§ 1401, 1402, 3101, 3111, Rev. Rul. 74-44"),
          EL("button", {
            type: "button",
            className: "tp-btn ghost sm bento-cta",
            onClick: () => goto ? goto("se") : window.location.href = "/"
          }, "Open SE & S-Corp Module →")
        ),

        /* Feature 3 */
        EL("div", { className: "tp-demo-bento-card" },
          EL("div", { className: "bento-tag" }, "SECTION 199A"),
          EL("h3", null, "Qualified Business Income (QBI) Engine"),
          EL("p", null, "Full multi-entity §199A deduction modeling. Handles SSTB phase-out thresholds, the 50% W-2 wage limit, the 25% W-2 + 2.5% UBIA limit, aggregation rules, and prior negative QBI carryforwards."),
          EL("div", { className: "bento-authorities" }, "Authorities: IRC § 199A, Treas. Reg. §§ 1.199A-1 through -6"),
          EL("button", {
            type: "button",
            className: "tp-btn ghost sm bento-cta",
            onClick: () => goto ? goto("qbi") : window.location.href = "/"
          }, "Open QBI Workbench →")
        ),

        /* Feature 4 */
        EL("div", { className: "tp-demo-bento-card" },
          EL("div", { className: "bento-tag" }, "RETIREMENT & HEALTH"),
          EL("h3", null, "Retirement Architecture & SEHI"),
          EL("p", null, "Design optimal pension architectures including Solo 401(k) employee deferral + employer profit-sharing, SEP-IRA, and Cash Balance Defined Benefit plans with statutory earned-income limitations."),
          EL("div", { className: "bento-authorities" }, "Authorities: IRC §§ 401(k), 404(a), 408(p), 162(l), 223"),
          EL("button", {
            type: "button",
            className: "tp-btn ghost sm bento-cta",
            onClick: () => goto ? goto("health") : window.location.href = "/"
          }, "Open Retirement & SEHI →")
        ),

        /* Feature 5 */
        EL("div", { className: "tp-demo-bento-card" },
          EL("div", { className: "bento-tag" }, "TRUSTS & ESTATES"),
          EL("h3", null, "Form 1041 Fiduciary Tax & GST Planner"),
          EL("p", null, "Model compressed fiduciary brackets (reaching 37% at $15,650), Distributable Net Income (DNI), Schedule B distribution deductions, and lifetime GST $15M exemption allocation tracking."),
          EL("div", { className: "bento-authorities" }, "Authorities: IRC Subchapter J (§§ 641-692), IRC §§ 2601-2664"),
          EL("button", {
            type: "button",
            className: "tp-btn ghost sm bento-cta",
            onClick: () => goto ? goto("guide") : window.location.href = "/"
          }, "Open Planning Guide & Fiduciary →")
        ),

        /* Feature 6 */
        EL("div", { className: "tp-demo-bento-card" },
          EL("div", { className: "bento-tag" }, "AI ADVISORY"),
          EL("h3", null, "AI Strategy Workspace & Optimizer"),
          EL("p", null, "Natural language planning workspace. Ask strategic tax questions, execute algorithmic multi-variable sweeps to find optimal salary levels, and maintain an immutable client audit trail."),
          EL("div", { className: "bento-authorities" }, "Engine-backed · Zero Hallucinations · Full Audit Trail"),
          EL("button", {
            type: "button",
            className: "tp-btn ghost sm bento-cta",
            onClick: () => goto ? goto("ai") : window.location.href = "/"
          }, "Open AI Workspace →")
        )
      ),

      EL("div", { className: "tp-demo-tour-footer" },
        EL("button", {
          type: "button",
          className: "tp-btn solid lg",
          onClick: () => setViewMode("slides")
        }, "← Return to Slide Presentation"),
        EL("button", {
          type: "button",
          className: "tp-btn ghost lg",
          onClick: () => goto ? goto("dashboard") : window.location.href = "/"
        }, "Launch Live Applet Workbench →")
      )
    )
  );
}
