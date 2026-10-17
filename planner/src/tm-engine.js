/* Tax Master — Form 1040 engine for planning columns. Pure functions, no DOM.
   Works in the browser (window.TM) and in node (module.exports).

   A return is figured from a flat map of leaf inputs (wages, taxable interest,
   Schedule C profit, …). Modules turn their detail rows into those leaves
   (TM.feeds), the 1040 walk lets a preparer type over any leaf directly, and
   every planning column is the base leaves plus that column's own overrides.

   Parameters: TY2025 from Rev. Proc. 2024-40 as amended by Pub. L. 119-21
   (OBBBA); TY2026 from Rev. Proc. 2025-32. Figures flagged `confirm` in the UI
   should be checked against the final forms before advising. */
(function (root) {
  'use strict';
  const TM = {};
  const n = (v) => { const x = typeof v === 'string' ? +v.replace(/[$,\s]/g, '') : +v; return isFinite(x) ? x : 0; };
  const sum = (a, f) => (a || []).reduce((s, x) => s + n(f ? f(x) : x), 0);
  const r2 = (v) => Math.round(v * 100) / 100;
  TM.n = n; TM.sum = sum;

  /* ------------------------------------------------------------------ *
   * Parameters
   * ------------------------------------------------------------------ */
  const STATUSES = [['single', 'Single'], ['mfj', 'Married filing jointly'], ['mfs', 'Married filing separately'], ['hoh', 'Head of household'], ['qss', 'Qualifying surviving spouse']];
  TM.STATUSES = STATUSES;
  TM.statusLabel = (s) => (STATUSES.find((x) => x[0] === s) || STATUSES[1])[1];
  const T = (single, mfj, mfs, hoh) => ({ single, mfj, mfs, hoh, qss: mfj });
  const YEARS = {
    2025: {
      br: T([11925, 48475, 103350, 197300, 250525, 626350], [23850, 96950, 206700, 394600, 501050, 751600], [11925, 48475, 103350, 197300, 250525, 375800], [17000, 64850, 103350, 197300, 250500, 626350]),
      cg0: T(48350, 96700, 48350, 64750), cg15: T(533400, 600050, 300000, 566700),
      std: T(15750, 31500, 15750, 23625), addlStdMarried: 1600, addlStdSingle: 2000,
      saltCap: 40000, saltThr: 500000, wageBase: 176100, ctc: 2200, actc: 1700, odc: 500,
      qbiThr: T(197300, 394600, 197300, 197300), qbiRange: T(50000, 100000, 50000, 50000), qbiMin: false,
      amtEx: T(88100, 137000, 68500, 88100), amtPhase: T(626350, 1252700, 626350, 626350), amtPhaseRate: 0.25, amtBp: T(239100, 239100, 119550, 239100),
      hsaSelf: 4300, hsaFamily: 8550, charityNonItem: 0, charityFloor: 0, itemizedCap: false,
    },
    2026: {
      br: T([12400, 50400, 105700, 201775, 256225, 640600], [24800, 100800, 211400, 403550, 512450, 768700], [12400, 50400, 105700, 201775, 256225, 384350], [17700, 67450, 105700, 201750, 256200, 640600]),
      cg0: T(49450, 98900, 49450, 66200), cg15: T(545500, 613700, 306850, 579600),
      std: T(16100, 32200, 16100, 24150), addlStdMarried: 1650, addlStdSingle: 2050,
      saltCap: 40400, saltThr: 505000, wageBase: 184500, ctc: 2200, actc: 1700, odc: 500,
      qbiThr: T(201750, 403500, 201750, 201750), qbiRange: T(75000, 150000, 75000, 75000), qbiMin: true,
      amtEx: T(90100, 140200, 70100, 90100), amtPhase: T(500000, 1000000, 500000, 500000), amtPhaseRate: 0.5, amtBp: T(244500, 244500, 122250, 244500),
      hsaSelf: 4400, hsaFamily: 8750, charityNonItem: T(1000, 2000, 1000, 1000), charityFloor: 0.005, itemizedCap: true,
    },
  };
  const RATES = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
  TM.YEARS = YEARS;
  TM.params = function (year, status) {
    const Y = YEARS[year] || YEARS[2025]; const s = status in Y.std ? status : 'mfj';
    const pick = {}; Object.keys(Y).forEach((k) => { pick[k] = Y[k] && typeof Y[k] === 'object' && !Array.isArray(Y[k]) && 'mfj' in Y[k] ? Y[k][s] : Y[k]; });
    const married = s === 'mfj' || s === 'qss';
    return Object.assign(pick, {
      year: YEARS[year] ? +year : 2025, status: s, married,
      brackets: pick.br.map((top, i) => [top, RATES[i]]).concat([[Infinity, 0.37]]),
      saltCap: s === 'mfs' ? Y.saltCap / 2 : Y.saltCap, saltThr: s === 'mfs' ? Y.saltThr / 2 : Y.saltThr, saltFloor: s === 'mfs' ? 5000 : 10000,
      capLossLimit: s === 'mfs' ? 1500 : 3000,
      ssBase: s === 'mfs' ? [0, 0] : married ? [32000, 44000] : [25000, 34000],
      ctcPhase: married ? 400000 : 200000,
      niitThr: married ? 250000 : s === 'mfs' ? 125000 : 200000,
      addlMedThr: married ? 250000 : s === 'mfs' ? 125000 : 200000,
      palPhase: s === 'mfs' ? null : [100000, 150000],
      seniorPhase: married ? 150000 : 75000, tipsPhase: married ? 300000 : 150000, carPhase: married ? 200000 : 100000,
      overtimeCap: married ? 25000 : 12500,
    });
  };
  // Start of the 37% bracket, used by the 2026 itemized-deduction limit (§68 as amended)
  const top37 = (p) => p.br[5];

  function ordinaryTax(ti, br) { let tax = 0, prev = 0; for (const [top, r] of br) { if (ti > prev) tax += (Math.min(ti, top) - prev) * r; prev = top; } return tax; }
  TM.ordinaryTax = ordinaryTax;
  function bracketRate(ti, br) { for (const [top, r] of br) if (ti <= top) return r; return 0.37; }

  /* Schedule D tax worksheet, simplified: ordinary income, then unrecaptured
     §1250 gain (max 25%) and collectibles gain (max 28%), then qualified
     dividends and the rest of net capital gain at 0/15/20%. */
  TM.taxWithPref = function (ti, qd, ncg, unrecap, c28, p) {
    ti = Math.max(0, ti);
    const pref = Math.min(ti, Math.max(0, qd) + Math.max(0, ncg));
    const u = Math.min(Math.max(0, unrecap), pref); const c = Math.min(Math.max(0, c28), pref - u);
    const adj = pref - u - c; const ord = ti - pref;
    let tax = ordinaryTax(ord, p.brackets);
    const slice = (from, amt, cap) => Math.min(ordinaryTax(from + amt, p.brackets) - ordinaryTax(from, p.brackets), amt * cap);
    tax += slice(ord, u, 0.25); tax += slice(ord + u, c, 0.28);
    const start = ord + u + c;
    const at0 = Math.max(0, Math.min(ti, p.cg0) - start);
    const in0 = Math.min(adj, at0);
    const at15 = Math.max(0, Math.min(ti, p.cg15) - Math.max(start, p.cg0));
    const in15 = Math.min(adj - in0, at15);
    tax += in15 * 0.15 + (adj - in0 - in15) * 0.20;
    return Math.min(tax, ordinaryTax(ti, p.brackets));
  };

  /* ------------------------------------------------------------------ *
   * Leaf inputs. Each has a label, its 1040 home and the module that feeds it.
   * ------------------------------------------------------------------ */
  const LEAVES = [
    // [key, label, module]
    ['wages', 'W-2 wages (box 1)', 'client'], ['ssWages', 'Social security wages of the self-employed spouse (W-2 box 3)', 'client'], ['otherEarned', 'Other earned income (lines 1b–1h)', 'client'],
    ['taxExemptInt', 'Tax-exempt interest', 'portfolio'], ['taxableInt', 'Taxable interest', 'portfolio'], ['ordDiv', 'Ordinary dividends', 'portfolio'], ['qualDiv', 'Qualified dividends', 'portfolio'],
    ['iraDist', 'IRA distributions, taxable', 'client'], ['pensions', 'Pensions and annuities, taxable', 'client'], ['ssBenefits', 'Social security benefits', 'client'],
    ['stGain', 'Net short-term gain (loss) before carryover', 'capital'], ['stCarry', 'Short-term capital loss carryover', 'capital'],
    ['ltGain', 'Net long-term gain (loss) before carryover', 'capital'], ['ltCarry', 'Long-term capital loss carryover', 'capital'],
    ['unrecap1250', 'Unrecaptured §1250 gain', 'capital'], ['collect28', 'Collectibles (28%) gain', 'capital'], ['f4797ord', 'Ordinary gain (loss), Form 4797', 'capital'], ['gainNotNii', 'Capital gain from an active trade (not investment income)', 'capital'],
    ['stateRefund', 'Taxable state refund', 'client'], ['alimonyRec', 'Alimony received (pre-2019 decree)', 'client'],
    ['schC', 'Business income (loss), Schedule C', 'schC'], ['schE', 'Rents, royalties, partnerships, S corps, trusts (Schedule E)', 'rents'],
    ['farm', 'Farm income (loss)', 'client'], ['unemployment', 'Unemployment compensation', 'client'], ['otherIncome', 'Other income (Schedule 1 line 8)', 'client'],
    ['seK1', 'Self-employment earnings from K-1s', 'k1'], ['niiOther', 'Other net investment income (passive, royalties, investment gains)', 'k1'],
    ['educator', 'Educator expenses', 'client'], ['hsa', 'HSA deduction', 'client'], ['sepIra', 'SEP, SIMPLE and qualified plans', 'schC'], ['seHealth', 'Self-employed health insurance', 'schC'],
    ['earlyPenalty', 'Penalty on early withdrawal of savings', 'portfolio'], ['alimonyPaid', 'Alimony paid', 'client'], ['iraDed', 'IRA deduction', 'client'], ['studentLoan', 'Student loan interest', 'client'], ['otherAdj', 'Other adjustments', 'client'],
    ['medical', 'Medical and dental expenses', 'itemized'], ['stateTax', 'State and local income (or sales) taxes', 'itemized'], ['realEstateTax', 'Real estate taxes', 'itemized'], ['persPropTax', 'Personal property taxes', 'itemized'],
    ['mortgageInt', 'Home mortgage interest and points', 'itemized'], ['invInt', 'Investment interest', 'itemized'], ['charityCash', 'Gifts to charity, cash', 'itemized'], ['charityNoncash', 'Gifts to charity, other than cash', 'itemized'],
    ['casualty', 'Casualty and theft losses', 'itemized'], ['otherItemized', 'Other itemized deductions', 'itemized'], ['forceItemize', 'Itemize even if less than standard (1 = yes)', 'itemized'],
    ['tips', 'Qualified tips (Schedule 1-A)', 'client'], ['overtime', 'Qualified overtime premium (Schedule 1-A)', 'client'], ['carLoanInt', 'Qualified car loan interest (Schedule 1-A)', 'client'],
    ['qbiDed', 'QBI deduction, typed (leave blank to compute)', 'qbi'], ['qbiCarry', 'Prior-year qualified business loss carryforward', 'qbi'], ['reitPtp', 'REIT dividends and PTP income', 'portfolio'],
    ['ctcKids', 'Children for the child tax credit', 'client'], ['odcDeps', 'Other dependents', 'client'],
    ['ftc', 'Foreign tax credit', 'portfolio'], ['childCare', 'Child and dependent care credit', 'client'], ['education', 'Education credits', 'client'], ['otherNonref', 'Other nonrefundable credits', 'client'], ['amtCredit', 'Prior-year minimum tax credit available (Form 8801)', 'equity'],
    ['otherTax', 'Other taxes (Schedule 2)', 'client'], ['pabInt', 'Private activity bond interest (AMT)', 'portfolio'], ['isoSpread', 'ISO exercise spread (AMT)', 'equity'], ['otherAmtAdj', 'Other AMT adjustments', 'k1'], ['amtGainAdj', 'AMT capital gain difference (Form 6251 Part III)', 'equity'],
    ['wh', 'Federal withholding, W-2', 'client'], ['whOther', 'Federal withholding, 1099 and other', 'portfolio'], ['estimates', 'Estimated tax payments', 'client'], ['extension', 'Payment with extension', 'client'], ['otherPayments', 'Other payments and refundable credits', 'client'],
  ];
  TM.LEAVES = LEAVES;
  TM.LEAF = Object.fromEntries(LEAVES.map(([k, label, mod]) => [k, { key: k, label, mod }]));
  TM.blankLeaves = () => Object.fromEntries(LEAVES.map(([k]) => [k, k === 'qbiDed' ? null : 0]));

  /* ------------------------------------------------------------------ *
   * QBI (§199A, Form 8995 / 8995-A)
   * items: [{name, src, gross, qbi, w2, ubia, sstb}]  (qbi already net of
   * attributable deductions; gross only matters for Schedule C items)
   * ------------------------------------------------------------------ */
  TM.qbi = function (items, tiBefore, netCapGain, reitPtp, carry, p) {
    const thr = p.qbiThr, range = p.qbiRange;
    const over = Math.max(0, tiBefore - thr); const pct = Math.min(1, over / range);
    let list = items.map((it) => ({ ...it, qbi: n(it.qbi), w2: n(it.w2), ubia: n(it.ubia) }));
    // Net losses (and a prior-year loss carryforward) reduce positive QBI pro rata (Reg. §1.199A-1(d)(2)(iii))
    const neg = sum(list.filter((x) => x.qbi < 0), (x) => x.qbi) - Math.abs(n(carry));
    const posTot = sum(list.filter((x) => x.qbi > 0), (x) => x.qbi);
    const netQbi = posTot + neg;
    const rows = list.map((x) => {
      const share = x.qbi > 0 && posTot > 0 ? x.qbi / posTot : 0;
      let q = x.qbi > 0 ? Math.max(0, x.qbi + neg * share) : 0;
      let w2 = x.w2, ubia = x.ubia;
      // Specified service businesses phase out above the threshold
      const app = x.sstb ? 1 - pct : 1;
      q *= app; w2 *= app; ubia *= app;
      const twenty = 0.2 * q;
      const lim = Math.max(0.5 * w2, 0.25 * w2 + 0.025 * ubia);
      let comp;
      if (over <= 0) comp = twenty;
      else if (pct >= 1) comp = Math.min(twenty, lim);
      else comp = twenty > lim ? twenty - pct * (twenty - lim) : twenty;
      return { name: x.name, src: x.src, qbi: x.qbi, adjQbi: q, w2: x.w2, ubia: x.ubia, sstb: !!x.sstb, twenty, lim, comp };
    });
    let combined = netQbi > 0 ? sum(rows, (x) => x.comp) : 0;
    const reit = Math.max(0, n(reitPtp)) * 0.2;
    // OBBBA minimum deduction from 2026: $400 when QBI from active trades is at least $1,000 (§199A(i))
    let minApplied = false;
    const activeQbi = sum(rows.filter((x, i) => !list[i].passive), (x) => x.adjQbi); // after netting and the SSTB reduction
    if (p.qbiMin && activeQbi >= 1000 && combined + reit < 400) { combined = 400 - reit; minApplied = true; }
    const limit = 0.2 * Math.max(0, tiBefore - Math.max(0, netCapGain));
    const ded = Math.max(0, Math.min(combined + reit, limit));
    return { rows, thr, range, over, pct, netQbi, carryforward: netQbi < 0 ? netQbi : 0, combined, reit, limit, ded, minApplied, overThreshold: over > 0 };
  };

  /* ------------------------------------------------------------------ *
   * The return
   *   x    leaf inputs (TM.blankLeaves shape)
   *   ctx  { year, status, seniors, blind, qbiItems, schCBase }
   * ------------------------------------------------------------------ */
  TM.computeReturn = function (x, ctx) {
    ctx = ctx || {};
    const p = TM.params(ctx.year || 2025, ctx.status || 'mfj');
    const L = (k) => n(x[k]);
    const f = {}, s1 = {}, s2 = {}, s3 = {}, a = {}, d = {}, se = {}, amt = {}, nii = {}, k8812 = {}, s1a = {};
    const diag = [];

    // ---------- Income ----------
    f.l1a = L('wages'); f.l1z = f.l1a + L('otherEarned');
    f.l2a = L('taxExemptInt'); f.l2b = L('taxableInt'); f.l3a = L('qualDiv'); f.l3b = L('ordDiv');
    f.l4b = L('iraDist'); f.l5b = L('pensions'); f.l6a = L('ssBenefits');
    // Schedule D
    d.l7 = L('stGain'); d.l6 = -Math.abs(L('stCarry')); d.st = d.l7 + d.l6;
    d.l15 = L('ltGain'); d.l14 = -Math.abs(L('ltCarry')); d.lt = d.l15 + d.l14;
    d.l16 = d.st + d.lt;
    d.allowed = d.l16 >= 0 ? d.l16 : Math.max(d.l16, -p.capLossLimit);
    d.carryforward = d.l16 < 0 ? d.l16 - d.allowed : 0;
    d.ncg = Math.max(0, Math.min(d.lt, d.l16));
    d.unrecap = Math.min(Math.max(0, L('unrecap1250')), d.ncg);
    d.c28 = Math.min(Math.max(0, L('collect28')), d.ncg - d.unrecap);
    f.l7 = d.allowed;
    // Schedule 1 part I
    s1.l1 = L('stateRefund'); s1.l2a = L('alimonyRec'); s1.l3 = L('schC'); s1.l4 = L('f4797ord'); s1.l5 = L('schE');
    s1.l6 = L('farm'); s1.l7 = L('unemployment'); s1.l8z = L('otherIncome');
    s1.l10 = s1.l1 + s1.l2a + s1.l3 + s1.l4 + s1.l5 + s1.l6 + s1.l7 + s1.l8z;
    f.l8 = s1.l10;

    // ---------- Schedule SE ----------
    se.base = s1.l3 + L('seK1');
    se.ne = se.base * 0.9235;
    if (se.ne < 400) se.ne = 0;
    se.ssRoom = Math.max(0, p.wageBase - L('ssWages'));
    se.ss = Math.min(se.ne, se.ssRoom) * 0.124; se.med = se.ne * 0.029;
    se.tax = r2(se.ss + se.med); se.ded = r2(se.tax / 2);

    // ---------- Adjustments (Schedule 1 part II) ----------
    s1.l11 = L('educator'); s1.l13 = L('hsa'); s1.l15 = se.ded; s1.l16 = L('sepIra'); s1.l17 = L('seHealth'); s1.l18 = L('earlyPenalty');
    s1.l19a = L('alimonyPaid'); s1.l20 = L('iraDed'); s1.l21 = L('studentLoan'); s1.l24z = L('otherAdj');
    s1.l26 = s1.l11 + s1.l13 + s1.l15 + s1.l16 + s1.l17 + s1.l18 + s1.l19a + s1.l20 + s1.l21 + s1.l24z;
    // Taxable social security (Pub. 915 worksheet)
    const otherInc = f.l1z + f.l2b + f.l3b + f.l4b + f.l5b + f.l7 + f.l8;
    const prov = otherInc - s1.l26 + f.l2a + 0.5 * f.l6a;
    const [b1, b2] = p.ssBase;
    let ssTax = 0;
    if (f.l6a > 0) {
      if (p.status === 'mfs') ssTax = Math.min(0.85 * f.l6a, 0.85 * Math.max(0, prov));
      else if (prov > b2) ssTax = Math.min(0.85 * f.l6a, 0.85 * (prov - b2) + Math.min(0.5 * f.l6a, 0.5 * (b2 - b1)));
      else if (prov > b1) ssTax = Math.min(0.5 * f.l6a, 0.5 * (prov - b1));
    }
    f.l6b = r2(ssTax);
    f.l9 = otherInc + f.l6b; f.l10 = s1.l26; f.l11 = f.l9 - f.l10;
    const agi = f.l11; const magi = agi;

    // ---------- Schedule A ----------
    a.l1 = L('medical'); a.l3 = Math.max(0, agi) * 0.075; a.l4 = Math.max(0, a.l1 - a.l3);
    a.l5a = L('stateTax'); a.l5b = L('realEstateTax'); a.l5c = L('persPropTax'); a.l5d = a.l5a + a.l5b + a.l5c;
    a.cap = p.saltCap;
    if (magi > p.saltThr) a.cap = Math.max(p.saltFloor, p.saltCap - 0.3 * (magi - p.saltThr));
    a.l5e = Math.min(a.l5d, a.cap); a.saltLost = a.l5d - a.l5e;
    a.l8a = L('mortgageInt');
    a.invIncome = f.l2b + Math.max(0, f.l3b - f.l3a);
    a.l9 = Math.min(L('invInt'), Math.max(0, a.invIncome)); a.invIntCarry = L('invInt') - a.l9;
    const cash = L('charityCash'), nonc = L('charityNoncash');
    a.charityFloor = p.charityFloor ? p.charityFloor * Math.max(0, agi) : 0;
    const nonAllowed = Math.min(nonc, 0.3 * Math.max(0, agi));
    const cashAllowed = Math.min(cash, Math.max(0, 0.6 * Math.max(0, agi) - nonAllowed));
    a.l11 = cashAllowed; a.l12 = nonAllowed; a.charityGross = cashAllowed + nonAllowed;
    a.charityCarry = cash + nonc - a.charityGross;
    a.charity = Math.max(0, a.charityGross - a.charityFloor);
    a.l15 = L('casualty'); a.l16 = L('otherItemized');
    a.l17pre = a.l4 + a.l5e + a.l8a + a.l9 + a.charity + a.l15 + a.l16;
    // 2026 onward: itemized deductions reduced by 2/37 of the lesser of the deductions or income in the 37% bracket (§68)
    a.limit = 0;
    if (p.itemizedCap) a.limit = (2 / 37) * Math.min(a.l17pre, Math.max(0, agi - top37(p)));
    a.l17 = a.l17pre - a.limit;
    const seniors = Math.max(0, Math.min(p.married ? 2 : 1, n(ctx.seniors))); const blind = Math.max(0, n(ctx.blind));
    a.std = p.std + (seniors + blind) * (p.married || p.status === 'mfs' ? p.addlStdMarried : p.addlStdSingle);
    a.itemize = a.l17 > a.std || L('forceItemize') > 0;
    a.method = a.itemize ? 'Itemized' : 'Standard';
    a.nonItemCharity = !a.itemize && p.charityNonItem ? Math.min(cash, p.charityNonItem) : 0;
    f.l12 = (a.itemize ? a.l17 : a.std) + a.nonItemCharity;

    // ---------- Schedule 1-A (2025–2028) ----------
    const phase = (amt, thr, per) => Math.max(0, amt - Math.ceil(Math.max(0, magi - thr) / 1000) * per);
    s1a.tips = p.status === 'mfs' ? 0 : phase(Math.min(L('tips'), 25000), p.tipsPhase, 100);
    s1a.overtime = p.status === 'mfs' ? 0 : phase(Math.min(L('overtime'), p.overtimeCap), p.tipsPhase, 100);
    s1a.car = phase(Math.min(L('carLoanInt'), 10000), p.carPhase, 200);
    s1a.senior = p.status === 'mfs' ? 0 : Math.max(0, seniors * 6000 - 0.06 * Math.max(0, magi - p.seniorPhase));
    s1a.total = s1a.tips + s1a.overtime + s1a.car + s1a.senior;
    f.l13b = s1a.total;

    // ---------- QBI (line 13a) ----------
    const tiBefore = Math.max(0, agi - f.l12 - f.l13b);
    const items = (ctx.qbiItems || []).map((it) => ({ ...it }));
    // Schedule C items are reduced by deductions attributable to the trade.
    const cItems = items.filter((it) => it.src === 'schC');
    const cBase = sum(cItems, (it) => it.gross);
    const cDelta = s1.l3 - cBase; // the walk or a planning column changed Schedule C
    if (cItems.length) cItems[0].gross = n(cItems[0].gross) + cDelta;
    else if (s1.l3) items.push({ name: 'Schedule C', src: 'schC', gross: s1.l3, w2: 0, ubia: 0, sstb: false }), cItems.push(items[items.length - 1]);
    const cTot = sum(cItems, (it) => Math.max(0, it.gross));
    const kSe = items.filter((it) => it.src === 'k1' && n(it.se) > 0); const kSeTot = sum(kSe, (it) => it.se);
    // Reg. 1.199A-3(b)(1)(vi): retirement deductions reduce the QBI of the
    // businesses whose earnings fund them, proportionately. The planning
    // contribution uses both Schedule C and K-1 SE earnings. Keep any K-1 SE
    // earnings absent from QBI records outside the qualifying allocation.
    // Primary source: irs.gov/irb/2019-09_IRB.
    const retirementBase = cTot + Math.max(kSeTot, Math.max(0, L('seK1')));
    const retirementPart = (earnings) => retirementBase > 0 ? L('sepIra') * Math.max(0, earnings) / retirementBase : 0;
    const attributable = se.ded * (se.base ? s1.l3 / se.base : 0) + L('seHealth');
    cItems.forEach((it) => { const share = cTot > 0 ? Math.max(0, it.gross) / cTot : 1 / cItems.length; it.qbi = n(it.gross) - attributable * share - retirementPart(n(it.gross)); });
    // Preserve the existing half-SE-tax allocation to each partner's earnings.
    kSe.forEach((it) => { it.qbi = n(it.qbi) - se.ded * (se.base ? L('seK1') / se.base : 0) * (n(it.se) / kSeTot) - retirementPart(n(it.se)); });
    const q = TM.qbi(items, tiBefore, f.l3a + d.ncg, L('reitPtp'), L('qbiCarry'), p);
    q.typed = x.qbiDed != null && x.qbiDed !== '';
    f.l13a = q.typed ? L('qbiDed') : r2(q.ded);
    f.l14 = f.l12 + f.l13a + f.l13b; f.l15 = Math.max(0, agi - f.l14);

    // ---------- Tax (line 16) ----------
    f.l16 = r2(TM.taxWithPref(f.l15, f.l3a, d.ncg, d.unrecap, d.c28, p));
    const marginalOrd = bracketRate(f.l15, p.brackets);

    // ---------- AMT (Form 6251) ----------
    amt.l1 = agi - f.l12 - f.l13a - f.l13b; // taxable income before the zero floor
    amt.l2a = a.itemize ? a.l5e : f.l12;
    amt.pab = L('pabInt'); amt.iso = L('isoSpread'); amt.other = L('otherAmtAdj');
    amt.amti = amt.l1 + amt.l2a + amt.pab + amt.iso + amt.other;
    amt.exemption = Math.max(0, p.amtEx - p.amtPhaseRate * Math.max(0, amt.amti - p.amtPhase));
    amt.base = Math.max(0, amt.amti - amt.exemption);
    const amtOrd = (y) => (y <= p.amtBp ? 0.26 * y : 0.28 * y - 0.02 * p.amtBp);
    // Part III uses the AMT capital gain: ISO shares carry a higher AMT basis (amtGainAdj is negative)
    const prefAmt = Math.min(amt.base, Math.max(0, f.l3a + d.ncg + L('amtGainAdj')));
    let tmt = amtOrd(amt.base);
    if (prefAmt > 0) {
      const ordPart = amt.base - prefAmt;
      const at0 = Math.max(0, Math.min(amt.base, p.cg0) - ordPart); const in0 = Math.min(prefAmt, at0);
      const at15 = Math.max(0, Math.min(amt.base, p.cg15) - Math.max(ordPart, p.cg0)); const in15 = Math.min(prefAmt - in0, at15);
      tmt = Math.min(tmt, amtOrd(ordPart) + in15 * 0.15 + (prefAmt - in0 - in15) * 0.20);
    }
    amt.tmt = r2(tmt);
    s3.l1 = L('ftc');
    amt.regular = Math.max(0, f.l16 - s3.l1);
    amt.amt = r2(Math.max(0, amt.tmt - amt.regular));
    s2.l1z = 0; s2.l2 = amt.amt; s2.l3 = s2.l1z + s2.l2;
    f.l17 = s2.l3; f.l18 = f.l16 + f.l17;

    // ---------- Credits ----------
    s3.l2 = L('childCare'); s3.l3 = L('education'); s3.l6z = L('otherNonref');
    // Minimum tax credit (Form 8801): limited to regular tax less tentative minimum tax
    amt.creditAvail = L('amtCredit');
    amt.creditUsed = r2(Math.min(amt.creditAvail, Math.max(0, amt.regular - amt.tmt)));
    amt.creditCarry = r2(amt.creditAvail - amt.creditUsed);
    s3.l6b = amt.creditUsed;
    const otherNonref = s3.l1 + s3.l2 + s3.l3 + s3.l6z + s3.l6b;
    // Schedule 8812
    k8812.kids = Math.max(0, Math.round(L('ctcKids'))); k8812.odc = Math.max(0, Math.round(L('odcDeps')));
    k8812.gross = k8812.kids * p.ctc + k8812.odc * p.odc;
    k8812.phaseout = Math.ceil(Math.max(0, magi - p.ctcPhase) / 1000) * 50;
    k8812.afterPhase = Math.max(0, k8812.gross - k8812.phaseout);
    k8812.room = Math.max(0, f.l18 - otherNonref);
    k8812.nonref = Math.min(k8812.afterPhase, k8812.room);
    const unusedCtc = Math.max(0, Math.min(k8812.kids * p.ctc, k8812.afterPhase) - k8812.nonref);
    k8812.earned = f.l1z + Math.max(0, se.ne) - se.ded;
    k8812.actc = r2(Math.min(unusedCtc, k8812.kids * p.actc, Math.max(0, k8812.earned - 2500) * 0.15));
    f.l19 = k8812.nonref;
    s3.l8 = Math.min(otherNonref, Math.max(0, f.l18 - f.l19));
    f.l20 = s3.l8; f.l21 = f.l19 + f.l20; f.l22 = Math.max(0, f.l18 - f.l21);

    // ---------- Other taxes (Schedule 2) ----------
    s2.l4 = se.tax;
    // Form 8959 Additional Medicare Tax
    const medWages = L('wages');
    s2.addlMedWages = Math.max(0, medWages - p.addlMedThr) * 0.009;
    s2.addlMedSe = Math.max(0, se.ne - Math.max(0, p.addlMedThr - medWages)) * 0.009;
    s2.l11 = r2(s2.addlMedWages + s2.addlMedSe);
    // Form 8960 Net investment income tax
    nii.interest = f.l2b; nii.dividends = f.l3b; nii.other = L('niiOther');
    nii.gains = Math.max(0, f.l7 - Math.max(0, L('gainNotNii'))); // business §1231 gains of an active trade are not investment income
    nii.deductions = a.itemize ? a.l9 : 0;
    nii.total = Math.max(0, nii.interest + nii.dividends + nii.gains + nii.other - nii.deductions);
    nii.excess = Math.max(0, magi - p.niitThr);
    s2.l12 = r2(0.038 * Math.min(nii.total, nii.excess));
    s2.l17z = L('otherTax');
    s2.l21 = s2.l4 + s2.l11 + s2.l12 + s2.l17z;
    f.l23 = s2.l21; f.l24 = r2(f.l22 + f.l23);

    // ---------- Payments ----------
    f.l25a = L('wh'); f.l25b = L('whOther'); f.l25d = f.l25a + f.l25b;
    f.l26 = L('estimates'); f.l28 = k8812.actc; s3.l10 = L('extension'); s3.l15 = s3.l10 + L('otherPayments'); f.l31 = s3.l15;
    f.l32 = f.l28 + f.l31; f.l33 = f.l25d + f.l26 + f.l32;
    f.l34 = Math.max(0, f.l33 - f.l24); f.l37 = Math.max(0, f.l24 - f.l33);
    const net = r2(f.l33 - f.l24);

    // ---------- Diagnostics ----------
    const D = (sev, line, text, cite) => diag.push({ sev, line, text, cite });
    if (f.l3a > f.l3b + 0.5) D('err', '3a', 'Qualified dividends are more than ordinary dividends.', 'Form 1040 instructions, line 3a');
    if (magi > p.saltThr && a.l5d > p.saltFloor) D('warn', 'A-5e', 'SALT cap phases down above ' + fmt(p.saltThr) + ' of MAGI: cap is ' + fmt(a.cap) + ' and ' + fmt(a.saltLost) + ' of state and local taxes is not deductible.', '§164(b)(7)');
    if (amt.pab > 0) D('info', '6251-2g', 'Private activity bond interest of ' + fmt(amt.pab) + ' is an AMT preference.', '§57(a)(5)');
    if (amt.iso > 0) D('warn', '6251-2i', 'ISO spread of ' + fmt(amt.iso) + ' is an AMT adjustment; AMT ' + (amt.amt > 0 ? 'of ' + fmt(amt.amt) + ' applies' : 'does not apply this year') + '.', '§56(b)(3)');
    if (amt.amt > 0) D('warn', '6251', 'Alternative minimum tax of ' + fmt(amt.amt) + ' applies (tentative minimum tax ' + fmt(amt.tmt) + ').', '§55');
    if (amt.creditCarry > 0) D('info', '8801', fmt(amt.creditCarry) + ' of minimum tax credit carries forward.', '§53');
    if (d.carryforward < 0) D('info', 'D-21', 'Capital loss of ' + fmt(-d.carryforward) + ' carries forward to next year.', '§1212(b)');
    if (s2.l12 > 0) D('info', 'S2-12', 'Net investment income tax of ' + fmt(s2.l12) + ' on ' + fmt(Math.min(nii.total, nii.excess)) + '.', '§1411');
    if (s2.l11 > 0) D('info', 'S2-11', 'Additional Medicare Tax of ' + fmt(s2.l11) + '.', '§3101(b)(2), §1401(b)(2)');
    if (k8812.phaseout > 0 && k8812.gross > 0) D('info', '19', 'Child and other dependent credits reduced by ' + fmt(Math.min(k8812.gross, k8812.phaseout)) + ' (MAGI phase-out).', '§24(b)');
    if (q.overThreshold && items.length) D('info', '13a', 'Taxable income is above the §199A threshold (' + fmt(q.thr) + '), so W-2 wage and UBIA limits ' + (q.pct >= 1 ? 'apply in full' : 'phase in at ' + Math.round(q.pct * 100) + '%') + '.', '§199A(b)(2), (b)(3)');
    if (q.carryforward < 0) D('info', '13a', 'Qualified business loss of ' + fmt(-q.carryforward) + ' carries forward.', '§199A(c)(2)');
    if (a.charityCarry > 0.5) D('info', 'A-11', fmt(a.charityCarry) + ' of charitable gifts exceeds the AGI limits and carries forward five years.', '§170(b), (d)');
    if (a.limit > 0) D('info', 'A-17', 'Itemized deductions reduced by ' + fmt(a.limit) + ' (2/37 limit for the 37% bracket).', '§68 (as amended by Pub. L. 119-21)');
    if (a.invIntCarry > 0.5) D('info', 'A-9', fmt(a.invIntCarry) + ' of investment interest is above net investment income and carries forward.', '§163(d)');
    if (f.l2a > 0 && f.l6a > 0) D('info', '2a', 'Tax-exempt interest counts toward taxable social security.', '§86(b)(2)');
    if (L('hsa') > (p.married ? p.hsaFamily : p.hsaSelf) + 1000) D('warn', 'S1-13', 'HSA deduction is above the ' + p.year + ' contribution limit (' + fmt(p.married ? p.hsaFamily : p.hsaSelf) + ' family, plus $1,000 catch-up at 55).', '§223(b)');
    if (d.l16 < -p.capLossLimit) D('info', '7', 'Net capital loss limited to ' + fmt(p.capLossLimit) + ' this year.', '§1211(b)');

    const effective = agi > 0 ? f.l24 / agi : 0;
    return { year: p.year, status: p.status, p, f, s1, s1a, s2, s3, a, d, se, q, amt, nii, k8812, net, agi, effective, marginalOrd, diag, x };
  };

  // Marginal rate on the next $1,000 of ordinary income, measured by recomputing
  TM.marginal = function (x, ctx, base) {
    base = base || TM.computeReturn(x, ctx);
    const y = Object.assign({}, x, { otherIncome: n(x.otherIncome) + 1000 });
    return (TM.computeReturn(y, ctx).f.l24 - base.f.l24) / 1000;
  };

  // Safe-harbor estimated payments for the following year (§6654(d))
  TM.safeHarbor = function (priorTax, priorAgi, projTax, withholding, paid, status) {
    const hi = n(priorAgi) > (status === 'mfs' ? 75000 : 150000);
    const prior = n(priorTax) * (hi ? 1.1 : 1); const cur = n(projTax) * 0.9;
    const required = Math.min(prior > 0 ? prior : Infinity, cur);
    const fromEst = Math.max(0, required - n(withholding));
    return { required, prior, cur, basis: prior > 0 && prior <= cur ? 'prior' : 'current', pct: hi ? 1.1 : 1, fromEst, quarter: fromEst / 4, remaining: Math.max(0, fromEst - n(paid)) };
  };

  /* ------------------------------------------------------------------ *
   * Planning levers (Tax scenarios & estimates)
   * ------------------------------------------------------------------ */
  TM.LEVERS = [
    { key: 'sepIra', label: 'Retirement contribution (SEP / solo 401(k))', hint: 'Adds to Schedule 1 line 16', leaf: 'sepIra', op: 'add' },
    { key: 'hsa', label: 'HSA contribution (total)', hint: 'Replaces Schedule 1 line 13', leaf: 'hsa', op: 'set' },
    { key: 'charity', label: 'Additional cash gifts to charity', hint: 'Adds to Schedule A line 11', leaf: 'charityCash', op: 'add' },
    { key: 'harvest', label: 'Capital losses harvested', hint: 'Short-term losses; net loss above the limit carries forward', leaf: 'stGain', op: 'sub' },
    { key: 'roth', label: 'Roth conversion', hint: 'Taxable IRA distribution on line 4b', leaf: 'iraDist', op: 'add' },
    { key: 'schCExpense', label: 'Additional business expense', hint: 'For example §179 equipment; reduces Schedule C', leaf: 'schC', op: 'sub' },
    { key: 'deferIncome', label: 'Income deferred to next year', hint: 'Reduces Schedule C or wages this year', leaf: 'schC', op: 'sub' },
    { key: 'extraEst', label: 'Additional estimated payments', hint: 'Changes the balance due, not the tax', leaf: 'estimates', op: 'add' },
  ];
  TM.applyLevers = function (x, lv) {
    const y = Object.assign({}, x);
    TM.LEVERS.forEach((L) => {
      const v = lv && lv[L.key]; if (v == null || v === '') return;
      if (L.op === 'set') y[L.leaf] = n(v); else if (L.op === 'add') y[L.leaf] = n(y[L.leaf]) + n(v); else y[L.leaf] = n(y[L.leaf]) - n(v);
    });
    return y;
  };
  // Grow income leaves for a projection
  const GROW = ['wages', 'ssWages', 'otherEarned', 'taxableInt', 'taxExemptInt', 'ordDiv', 'qualDiv', 'schC', 'schE', 'seK1', 'niiOther', 'wh', 'whOther', 'pensions', 'ssBenefits'];
  TM.project = function (x, growth) { const g = 1 + n(growth); const y = Object.assign({}, x); GROW.forEach((k) => { if (y[k]) y[k] = Math.round(n(y[k]) * g); }); return y; };

  function fmt(v) { v = Math.round(n(v)); return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US'); }
  TM.fmt = fmt;

  if (typeof module !== 'undefined' && module.exports) module.exports = TM;
  else root.TM = TM;
})(typeof window !== 'undefined' ? window : this);
