/* Tax Master — module calculators. Each module turns its detail rows into
   leaf inputs for the 1040 engine (tm-engine.js) plus the schedules it shows.
   Pure functions; loads after tm-engine.js. */
(function (root) {
  'use strict';
  const TM = root.TM || (typeof require !== 'undefined' ? require('./tm-engine.js') : null);
  const n = TM.n, sum = TM.sum;
  const pos = (v) => Math.max(0, v);
  const DAY = 86400000;
  const date = (s) => (s ? new Date(String(s) + 'T12:00:00Z') : null);
  // Held more than one year (§1222): the day after acquisition starts the holding period
  TM.isLongTerm = function (acq, sold) {
    const a = date(acq), b = date(sold); if (!a || !b) return null;
    const anniv = new Date(a); anniv.setUTCFullYear(a.getUTCFullYear() + 1);
    return b.getTime() > anniv.getTime();
  };
  const yearOf = (s) => (s ? +String(s).slice(0, 4) : null);

  /* ---------------- Portfolio income (Schedule B) ---------------- */
  TM.calcPortfolio = function (m) {
    m = m || {}; const I = m.interest || [], Dv = m.dividends || [];
    const out = {
      taxableInt: sum(I, (r) => r.taxable), taxExemptInt: sum(I, (r) => r.exempt), treasury: sum(I.filter((r) => r.treasury), (r) => r.taxable),
      pabInt: sum(I, (r) => r.pab), earlyPenalty: sum(I, (r) => r.penalty), whI: sum(I, (r) => r.wh), ftcI: sum(I, (r) => r.foreignTax),
      ordDiv: sum(Dv, (r) => r.ordinary), qualDiv: sum(Dv, (r) => r.qualified), cgd: sum(Dv, (r) => r.capGainDist), sec199a: sum(Dv, (r) => r.sec199a),
      exemptDiv: sum(Dv, (r) => r.exemptInt), unrecapDiv: sum(Dv, (r) => r.unrecap1250), collectDiv: sum(Dv, (r) => r.collect28), whD: sum(Dv, (r) => r.wh), ftcD: sum(Dv, (r) => r.foreignTax),
      pabDiv: sum(Dv, (r) => r.pab),
    };
    out.ftc = out.ftcI + out.ftcD; out.wh = out.whI + out.whD;
    out.schB = { part1: I.map((r) => ({ payer: r.payer, amount: n(r.taxable) })), part2: Dv.map((r) => ({ payer: r.payer, amount: n(r.ordinary) })) };
    out.checks = [];
    Dv.forEach((r) => { if (n(r.qualified) > n(r.ordinary) + 0.5) out.checks.push({ sev: 'err', text: r.payer + ': qualified dividends are more than ordinary dividends (1099-DIV 1b > 1a).' }); });
    if (out.taxableInt > 1500 || out.ordDiv > 1500) out.checks.push({ sev: 'info', text: 'Schedule B is required (interest or dividends over $1,500). Answer Part III: foreign accounts (FBAR, FinCEN 114) and Form 8938.' });
    if (out.ftc > (m.married ? 600 : 300)) out.checks.push({ sev: 'info', text: 'Foreign tax of ' + TM.fmt(out.ftc) + ' is above the de minimis election, so Form 1116 is needed.' });
    if (out.treasury > 0) out.checks.push({ sev: 'info', text: TM.fmt(out.treasury) + ' of U.S. Treasury interest is exempt from state income tax.' });
    return out;
  };

  /* ---------------- Schedule C ---------------- */
  TM.SCHC_EXPENSES = [['advertising', '8', 'Advertising'], ['car', '9', 'Car and truck'], ['commissions', '10', 'Commissions and fees'], ['contract', '11', 'Contract labor'],
    ['depreciation', '13', 'Depreciation and §179'], ['insurance', '15', 'Insurance (not health)'], ['interest', '16', 'Interest'], ['legal', '17', 'Legal and professional'],
    ['office', '18', 'Office expense'], ['rent', '20', 'Rent or lease'], ['repairs', '21', 'Repairs and maintenance'], ['supplies', '22', 'Supplies'], ['taxes', '23', 'Taxes and licenses'],
    ['travel', '24a', 'Travel'], ['meals', '24b', 'Meals (50% deductible)'], ['utilities', '25', 'Utilities'], ['wages', '26', 'Wages'], ['other', '27a', 'Other expenses']];
  TM.calcSchC = function (m) {
    m = m || {}; const B = m.businesses || [];
    const rows = B.map((b) => {
      const e = b.exp || {};
      const l3 = n(b.gross) - n(b.returns); const l5 = l3 - n(b.cogs); const l7 = l5 + n(b.otherIncome);
      const l28 = sum(TM.SCHC_EXPENSES, ([k]) => (k === 'meals' ? n(e[k]) * 0.5 : n(e[k])));
      const l29 = l7 - l28; const l31 = l29 - n(b.homeOffice);
      return { name: b.name, owner: b.owner || 'tp', sstb: !!b.sstb, l1: n(b.gross), l3, l5, l7, l28, l29, l30: n(b.homeOffice), l31, w2: n(b.w2Paid != null ? b.w2Paid : e.wages), ubia: n(b.ubia) };
    });
    const out = { rows, net: sum(rows, (r) => r.l31), sepIra: n(m.sepIra), seHealth: n(m.seHealth), checks: [] };
    out.qbiItems = rows.map((r) => ({ name: r.name, src: 'schC', gross: r.l31, w2: r.w2, ubia: r.ubia, sstb: r.sstb }));
    rows.forEach((r) => { if (r.l1 > 0 && r.l28 === 0) out.checks.push({ sev: 'warn', text: r.name + ': gross receipts but no expenses entered.' }); });
    if (out.seHealth > pos(out.net)) out.checks.push({ sev: 'warn', text: 'Self-employed health insurance is limited to net profit from the business (§162(l)(2)(A)).' });
    return out;
  };

  /* ---------------- Capital transactions ----------------
     invest:   Form 8949 lots (stock, funds, collectibles, investment land, partnership interests)
     business: Form 4797 assets (§1245, §1250, land used in a trade), optionally on the installment method
     Order follows Form 4797: recapture first, then §1231 netting with the five-year lookback (§1231(c)). */
  TM.calcCapital = function (m, year, extra) {
    m = m || {}; extra = extra || {};
    const lots = (m.invest || []).map((r) => {
      const realized = n(r.proceeds) - n(r.sellingExp);
      const gain = realized - n(r.basis) + n(r.adj);
      const lt = r.term ? r.term === 'LT' : TM.isLongTerm(r.acquired, r.sold);
      const s751 = r.kind === 'partnership' ? n(r.sec751) : 0;
      const capital = gain - s751;
      return { ...r, realized, gain, capital, s751, lt: lt !== false, collectible: !!r.collectible || r.kind === 'collectible', unrecap: r.kind === 'partnership' ? n(r.unrecap) : 0, box: r.box || (lt === false ? 'C' : 'F') };
    });
    const assets = (m.business || []).map((r) => {
      const realized = n(r.proceeds) - n(r.sellingExp);
      const adjBasis = n(r.cost) - n(r.depreciation);
      const gain = realized - adjBasis;
      const long = TM.isLongTerm(r.acquired, r.sold) !== false;
      let recapture = 0, unrecap = 0;
      if (gain > 0 && long) {
        if (r.recapture != null && r.recapture !== '') recapture = Math.min(gain, n(r.recapture));
        else if (r.type === '1245') recapture = Math.min(gain, n(r.depreciation));
        else if (r.type === '1250') recapture = Math.min(gain, n(r.addlDepr));
        if (r.type === '1250') unrecap = Math.max(0, Math.min(gain - recapture, n(r.depreciation) - recapture));
      }
      let s1231 = long ? gain - recapture : 0;
      let ordinary = long ? recapture : gain; // held a year or less: ordinary on Form 4797 Part II
      // Installment method (§453): recapture is recognized in the year of sale (§453(i)); the rest as principal is collected
      let deferred = 0, gpRatio = null;
      if (r.installment && gain > 0) {
        const gp = gain - recapture; const contract = n(r.contractPrice) || realized;
        gpRatio = contract > 0 ? gp / contract : 0;
        const recognized = gpRatio * n(r.principalThisYear);
        deferred = pos(gp - recognized - gpRatio * n(r.principalPrior));
        ordinary = yearOf(r.sold) === +year ? recapture : 0; // recapture is recognized in the year of sale (§453(i))
        if (long) s1231 = recognized; else ordinary += recognized;
        unrecap = long ? Math.min(unrecap, recognized) : 0;
      }
      return { ...r, realized, adjBasis, gain, long, recapture, unrecap, s1231, ordinary, deferred, gpRatio, active: r.active !== false };
    });
    const k1_1231 = n(extra.k1Sec1231);
    const ordinaryPre = sum(assets, (a) => a.ordinary) + sum(lots, (l) => l.s751);
    const net1231 = sum(assets, (a) => a.s1231) + k1_1231;
    const prior = n(m.priorNonrecap1231);
    const lookback = Math.min(pos(net1231), prior);
    const finalOrdinary = ordinaryPre + lookback + Math.min(net1231, 0);
    const remaining1231 = pos(net1231 - lookback);
    const st = sum(lots.filter((l) => !l.lt), (l) => l.capital);
    const lt8949 = sum(lots.filter((l) => l.lt), (l) => l.capital);
    const unrecap1231 = net1231 > 0 ? pos(Math.min(sum(assets, (a) => a.unrecap) + n(extra.k1Unrecap) - lookback, remaining1231)) : 0;
    const out = {
      lots, assets, ordinaryPre, net1231, priorNonrecap: prior, lookback, priorLeft: prior - lookback, finalOrdinary, remaining1231,
      st, lt8949, lt: lt8949 + remaining1231,
      unrecap: unrecap1231 + sum(lots, (l) => l.unrecap),
      collect28: sum(lots.filter((l) => l.collectible && l.lt), (l) => l.capital),
      deferred: sum(assets, (a) => a.deferred),
      activeGain: sum(assets.filter((a) => a.active), (a) => a.s1231) > 0 && net1231 > 0 ? Math.min(remaining1231, pos(sum(assets.filter((a) => a.active), (a) => a.s1231))) : 0,
      stCarry: n(m.stCarry), ltCarry: n(m.ltCarry), checks: [],
    };
    out.f8949 = { A: [], B: [], C: [], D: [], E: [], F: [] };
    lots.forEach((l) => { (out.f8949[l.box] || out.f8949[l.lt ? 'F' : 'C']).push(l); });
    lots.forEach((l) => {
      if (l.lt && ['A', 'B', 'C'].includes(l.box)) out.checks.push({ sev: 'err', text: (l.desc || 'Lot') + ': long-term lot in a short-term 8949 box (' + l.box + ').' });
      if (date(l.sold) && date(l.acquired) && date(l.sold) < date(l.acquired)) out.checks.push({ sev: 'err', text: (l.desc || 'Lot') + ': sold before it was acquired.' });
      if (n(l.adj) && !l.code) out.checks.push({ sev: 'warn', text: (l.desc || 'Lot') + ': adjustment in column (g) without a code in column (f).' });
      if (l.washSale) out.checks.push({ sev: 'info', text: (l.desc || 'Lot') + ': wash sale (code W) — disallowed loss is added to the basis of the replacement shares (§1091(d)).' });
    });
    assets.forEach((a) => { if (a.installment && !n(a.contractPrice)) out.checks.push({ sev: 'warn', text: (a.desc || 'Asset') + ': installment sale with no contract price; using amount realized.' }); });
    if (out.priorLeft > 0) out.checks.push({ sev: 'info', text: TM.fmt(out.priorLeft) + ' of nonrecaptured §1231 losses remain for the five-year lookback.' });
    return out;
  };

  /* ---------------- Equity compensation (ISO / NSO / RSU / §83(b)) ----------------
     Corrected logic from the stock-options workbook: an ISO lot without a sale date is unsold. */
  TM.calcEquity = function (m, year) {
    m = m || {}; year = +year;
    const iso = (m.iso || []).map((l) => {
      const sh = n(l.shares), sold = l.saleDate ? n(l.sharesSold != null && l.sharesSold !== '' ? l.sharesSold : sh) : 0;
      const spread = (n(l.fmvExercise) - n(l.strike)) * sh;
      const exThisYear = yearOf(l.exerciseDate) === year;
      const soldThisYear = l.saleDate && yearOf(l.saleDate) === year;
      const g = date(l.grantDate), x = date(l.exerciseDate), s = date(l.saleDate);
      const qualifying = !!(s && g && x && s - g > 2 * 365 * DAY && TM.isLongTerm(l.exerciseDate, l.saleDate));
      let ordinary = 0, capital = 0, lt = false, amtAdj = 0, status = 'Unsold';
      if (soldThisYear) {
        const perSale = n(l.salePrice) - n(l.strike);
        if (qualifying) { capital = perSale * sold; lt = true; status = 'Qualifying'; }
        else { const ordPer = Math.max(0, Math.min(n(l.fmvExercise) - n(l.strike), perSale)); ordinary = ordPer * sold; capital = (perSale - ordPer) * sold; lt = TM.isLongTerm(l.exerciseDate, l.saleDate); status = 'Disqualifying'; }
        // Shares exercised in an earlier year carry a higher AMT basis: negative adjustment on Form 6251 line 2k
        if (!exThisYear) amtAdj = -(n(l.fmvExercise) - n(l.strike)) * sold;
      }
      // Exercised this year and still held at year end: the spread is an AMT adjustment (§56(b)(3), line 2i)
      const iso2i = exThisYear && !(soldThisYear) ? spread : exThisYear && soldThisYear ? (n(l.fmvExercise) - n(l.strike)) * (sh - sold) : 0;
      const regBasis = n(l.strike) * (sh - sold), amtBasis = n(l.fmvExercise) * (sh - sold);
      return { ...l, sh, sold, spread, exThisYear, soldThisYear, qualifying, status, ordinary, capital, lt, amtAdj, iso2i, regBasis, amtBasis };
    });
    const nso = (m.nso || []).filter((l) => yearOf(l.exerciseDate) === year).map((l) => ({ ...l, income: (n(l.fmvExercise) - n(l.strike)) * n(l.shares) }));
    const rsu = (m.rsu || []).filter((l) => yearOf(l.vestDate) === year).map((l) => ({ ...l, income: n(l.fmvVest) * n(l.shares), retained: n(l.shares) - n(l.withheld) }));
    const rs = (m.restricted || []).map((r) => {
      const inc83b = r.election83b && yearOf(r.transferDate) === year ? (n(r.fmvTransfer) - n(r.pricePaid)) * n(r.shares) : 0;
      const vestInc = !r.election83b ? sum(r.vests || [], (v) => (yearOf(v.date) === year ? (n(v.fmv) - n(r.pricePaid)) * n(v.shares) : 0)) : 0;
      return { ...r, income: inc83b + vestInc, inc83b, vestInc };
    });
    const sales = (m.sales || []).map((s) => { const gain = n(s.proceeds) - n(s.basis); return { ...s, gain, lt: TM.isLongTerm(s.acquired, s.sold) }; });
    const compIncome = sum(iso, (l) => l.ordinary) + sum(nso, (l) => l.income) + sum(rsu, (l) => l.income) + sum(rs, (l) => l.income);
    const notInW2 = sum(iso.filter((l) => l.notInW2), (l) => l.ordinary) + sum(nso.filter((l) => l.notInW2), (l) => l.income) + sum(rsu.filter((l) => l.notInW2), (l) => l.income) + sum(rs.filter((l) => l.notInW2), (l) => l.income);
    const out = {
      iso, nso, rsu, rs, sales, compIncome, inW2: compIncome - notInW2, notInW2,
      st: sum(iso.filter((l) => l.soldThisYear && !l.lt), (l) => l.capital) + sum(sales.filter((s) => s.lt === false), (s) => s.gain),
      lt: sum(iso.filter((l) => l.soldThisYear && l.lt), (l) => l.capital) + sum(sales.filter((s) => s.lt !== false), (s) => s.gain),
      line2i: sum(iso, (l) => l.iso2i), line2k: sum(iso, (l) => l.amtAdj), amtCredit: n(m.amtCreditPrior), checks: [],
    };
    out.amtAdj = out.line2i + out.line2k;
    iso.forEach((l) => {
      if (date(l.exerciseDate) && date(l.grantDate) && date(l.exerciseDate) < date(l.grantDate)) out.checks.push({ sev: 'err', text: l.lotId + ': exercised before grant.' });
      if (l.saleDate && date(l.saleDate) < date(l.exerciseDate)) out.checks.push({ sev: 'err', text: l.lotId + ': sold before exercise.' });
      if (l.sold > l.sh) out.checks.push({ sev: 'err', text: l.lotId + ': more shares sold than exercised.' });
      if (l.status === 'Disqualifying') out.checks.push({ sev: 'info', text: l.lotId + ': disqualifying disposition — ' + TM.fmt(l.ordinary) + ' is compensation; confirm it is in W-2 box 1 (§421(b)).' });
    });
    rsu.forEach((l) => { if (n(l.retained) < 0) out.checks.push({ sev: 'err', text: 'RSU vest ' + (l.vestDate || '') + ': more shares withheld than vested.' }); });
    rs.forEach((r) => { if (r.election83b && date(r.electionFiled) && date(r.transferDate) && (date(r.electionFiled) - date(r.transferDate)) / DAY > 30) out.checks.push({ sev: 'err', text: (r.desc || 'Restricted stock') + ': §83(b) election filed more than 30 days after transfer.' }); });
    if (out.line2i > 0) out.checks.push({ sev: 'info', text: 'ISO spread of ' + TM.fmt(out.line2i) + ' on shares held at year end goes on Form 6251 line 2i.' });
    return out;
  };

  /* ---------------- Passthrough income (Schedule K-1) ----------------
     Loss limits in order: basis (§704(d) / §1366(d)), at-risk (§465), then the
     passive rules (§469) applied together with rentals in TM.calcPassive. */
  TM.K1_FIELDS = [['box1', '1', 'Ordinary business income (loss)'], ['box2', '2', 'Net rental real estate income (loss)'], ['box3', '3', 'Other net rental income (loss)'], ['gp', '4', 'Guaranteed payments (1065)'],
    ['interest', '5', 'Interest income'], ['ordDiv', '6a', 'Ordinary dividends'], ['qualDiv', '6b', 'Qualified dividends'], ['royalties', '7', 'Royalties'], ['stcg', '8', 'Net short-term capital gain (loss)'],
    ['ltcg', '9a', 'Net long-term capital gain (loss)'], ['collect', '9b', 'Collectibles (28%) gain'], ['unrecap', '9c', 'Unrecaptured §1250 gain'], ['sec1231', '10', 'Net §1231 gain (loss)'], ['other', '11', 'Other income (loss)'],
    ['s179', '12', '§179 deduction'], ['charity', '13', 'Charitable contributions'], ['invInt', '13H', 'Investment interest expense'], ['se', '14A', 'Self-employment earnings'], ['taxExempt', '16/18', 'Tax-exempt income'], ['ftc', '16/21', 'Foreign taxes paid'], ['amt', '17', 'AMT items'],
    ['distributions', '19', 'Distributions'], ['qbi', '20Z', 'QBI / §199A income'], ['w2', '20Z', '§199A W-2 wages'], ['ubia', '20Z', '§199A UBIA']];
  TM.calcK1 = function (m) {
    m = m || {}; const list = m.entities || [];
    const rows = list.map((k) => {
      const ord = n(k.box1) + n(k.box2) + n(k.box3) + n(k.gp) + n(k.royalties) + n(k.other) - Math.abs(n(k.s179));
      const portfolioInc = pos(n(k.interest)) + pos(n(k.ordDiv)) + pos(n(k.stcg)) + pos(n(k.ltcg)) + pos(n(k.sec1231)) + pos(n(k.taxExempt));
      // Basis: beginning + contributions + income items − distributions, then losses (Reg. §1.1367-1(f))
      const basisBefore = n(k.basisBegin) + n(k.contributions) + pos(ord) + portfolioInc - n(k.distributions);
      const lossItems = pos(-ord) + pos(-n(k.stcg)) + pos(-n(k.ltcg)) + pos(-n(k.sec1231));
      const hasBasis = k.basisBegin != null && k.basisBegin !== '';
      const basisLimit = hasBasis ? pos(basisBefore) : Infinity;
      const lossAfterBasis = Math.min(pos(-ord), basisLimit * (lossItems ? pos(-ord) / lossItems : 1));
      const atRisk = k.atRisk != null && k.atRisk !== '' ? pos(n(k.atRisk)) : Infinity;
      const lossAfterRisk = Math.min(lossAfterBasis, atRisk);
      const basisSusp = pos(-ord) - lossAfterBasis, riskSusp = lossAfterBasis - lossAfterRisk;
      const ordAllowed = ord >= 0 ? ord : -lossAfterRisk;
      const excessDist = hasBasis && basisBefore < 0 ? -basisBefore : 0;
      return { ...k, ord, ordAllowed, basisBefore, basisSusp, riskSusp, excessDist, passive: !!k.passive, ptp: !!k.ptp, endBasis: hasBasis ? pos(basisBefore - lossAfterBasis) : null };
    });
    const out = { rows, checks: [] };
    const t = (f) => sum(rows, (r) => r[f]);
    Object.assign(out, {
      interest: t('interest'), ordDiv: t('ordDiv'), qualDiv: t('qualDiv'), stcg: t('stcg'), ltcg: t('ltcg'), collect: t('collect'), unrecap: t('unrecap'), sec1231: t('sec1231'),
      charity: t('charity'), invInt: t('invInt'), se: t('se'), taxExempt: t('taxExempt'), ftc: t('ftc'), amt: t('amt'), royalties: t('royalties'),
      nonpassive: sum(rows.filter((r) => !r.passive), (r) => r.ordAllowed),
    });
    out.qbiItems = rows.filter((r) => n(r.qbi) || n(r.w2) || n(r.ubia)).map((r) => ({ name: r.name, src: 'k1', qbi: n(r.qbi), w2: n(r.w2), ubia: n(r.ubia), sstb: !!r.sstb, passive: r.passive, se: n(r.se) }));
    rows.forEach((r) => {
      if (r.basisSusp > 0) out.checks.push({ sev: 'warn', text: r.name + ': ' + TM.fmt(r.basisSusp) + ' of loss suspended for lack of basis (' + (r.form === '1120-S' ? '§1366(d), Form 7203' : '§704(d)') + ').' });
      if (r.riskSusp > 0) out.checks.push({ sev: 'warn', text: r.name + ': ' + TM.fmt(r.riskSusp) + ' of loss suspended by the at-risk rules (§465, Form 6198).' });
      if (r.excessDist > 0) out.checks.push({ sev: 'err', text: r.name + ': distributions exceed basis by ' + TM.fmt(r.excessDist) + ' — gain under §731(a) / §1368(b).' });
      if (n(r.qualDiv) > n(r.ordDiv) + 0.5) out.checks.push({ sev: 'err', text: r.name + ': qualified dividends (6b) are more than ordinary dividends (6a).' });
      if (r.form === '1065' && n(r.gp) && !n(r.se)) out.checks.push({ sev: 'warn', text: r.name + ': guaranteed payments with no box 14A self-employment earnings.' });
    });
    return out;
  };

  /* ---------------- Rents & royalties (Schedule E part I) + Form 8582 ---------------- */
  TM.RENT_EXPENSES = [['advertising', '5', 'Advertising'], ['auto', '6', 'Auto and travel'], ['cleaning', '7', 'Cleaning and maintenance'], ['commissions', '8', 'Commissions'], ['insurance', '9', 'Insurance'],
    ['legal', '10', 'Legal and professional'], ['management', '11', 'Management fees'], ['mortgage', '12', 'Mortgage interest'], ['otherInterest', '13', 'Other interest'], ['repairs', '14', 'Repairs'],
    ['supplies', '15', 'Supplies'], ['taxes', '16', 'Taxes'], ['utilities', '17', 'Utilities'], ['depreciation', '18', 'Depreciation'], ['other', '19', 'Other']];
  TM.calcRents = function (m) {
    m = m || {}; const P = m.properties || [];
    const rows = P.map((r) => {
      const e = r.exp || {};
      const exp = sum(TM.RENT_EXPENSES, ([k]) => e[k]);
      const net = n(r.gross) - exp;
      const royalty = r.type === 'royalty';
      const passive = !royalty && !(m.rep && r.material);
      return { ...r, exp, net, royalty, passive, active: r.participation !== 'none' };
    });
    return { rows, rep: !!m.rep, net: sum(rows, (r) => r.net), qbiItems: rows.filter((r) => r.qbiTrade).map((r) => ({ name: r.name, src: 'rent', qbi: r.net, w2: n(r.w2), ubia: n(r.ubia), sstb: false })), checks: [] };
  };
  // Form 8582: rental and passive K-1 activities together; the $25,000 allowance for active participation (§469(i))
  TM.calcPassive = function (rents, k1, magi, status) {
    const p = TM.params(2025, status);
    const acts = [];
    rents.rows.filter((r) => r.passive).forEach((r) => acts.push({ name: r.name, kind: 'rental', net: r.net, prior: n(r.priorSuspended), active: r.active, ptp: false }));
    k1.rows.filter((r) => r.passive).forEach((r) => acts.push({ name: r.name, kind: 'k1', net: r.ordAllowed, prior: n(r.priorSuspended), active: false, rentalRE: n(r.box2) !== 0 && n(r.box1) === 0 && r.activeRental, ptp: r.ptp }));
    // PTPs are separate: losses only offset income from the same PTP (§469(k))
    const ptps = acts.filter((a) => a.ptp); const reg = acts.filter((a) => !a.ptp);
    ptps.forEach((a) => { const tot = a.net - a.prior; a.allowedNet = pos(tot); a.suspended = pos(-tot); });
    const income = sum(reg.filter((a) => a.net > 0), (a) => a.net);
    const losses = sum(reg, (a) => pos(-a.net) + a.prior);
    const activeLoss = sum(reg.filter((a) => a.active || a.rentalRE), (a) => pos(-a.net) + a.prior);
    let allowance = 0;
    if (p.palPhase && magi !== Infinity) allowance = Math.max(0, Math.min(25000, 25000 - 0.5 * Math.max(0, n(magi) - p.palPhase[0])));
    const specialUsed = Math.min(allowance, pos(activeLoss - income));
    const totalAllowedLoss = Math.min(losses, income + specialUsed);
    const suspended = losses - totalAllowedLoss;
    // Allocate the allowed loss pro rata to the activities with losses (Form 8582 worksheets)
    reg.forEach((a) => {
      const l = pos(-a.net) + a.prior; const allowedLoss = losses > 0 ? totalAllowedLoss * l / losses : 0;
      a.allowedNet = pos(a.net) - allowedLoss; a.suspended = l - allowedLoss;
    });
    const net = sum(reg, (a) => a.allowedNet) + sum(ptps, (a) => a.allowedNet);
    return { acts, income, losses, activeLoss, allowance, specialUsed, totalAllowedLoss, suspended: suspended + sum(ptps, (a) => a.suspended), net, magi };
  };

  /* ---------------- Itemized deductions (Schedule A inputs) ---------------- */
  TM.calcItemized = function (m, k1) {
    m = m || {};
    // Home mortgage interest on acquisition debt over $750,000 is limited pro rata (§163(h)(3)(F))
    const debt = n(m.avgDebt), cap = m.debtPre2018 ? 1000000 : 750000;
    const mortgage = debt > cap ? n(m.mortgageInt) * cap / debt : n(m.mortgageInt);
    return {
      medical: n(m.medical), stateTax: n(m.useSalesTax ? m.salesTax : m.stateTax), realEstateTax: n(m.realEstateTax), persPropTax: n(m.persPropTax),
      mortgageInt: mortgage + n(m.points), mortgageLimited: n(m.mortgageInt) - mortgage, invInt: n(m.invInt) + n(k1 && k1.invInt),
      charityCash: n(m.charityCash) + n(m.charityCarry) + n(k1 && k1.charity), charityNoncash: n(m.charityNoncash),
      casualty: n(m.casualty), otherItemized: n(m.other), forceItemize: m.forceItemize ? 1 : 0,
    };
  };

  /* ------------------------------------------------------------------ *
   * Client → leaves. Two passes so the §469 allowance uses MAGI.
   * ------------------------------------------------------------------ */
  TM.ageAtYearEnd = (dob, year) => { const d = date(dob); return d ? year - d.getUTCFullYear() : null; };
  TM.clientCtx = function (c, year, status) {
    const info = c.info || {}; year = +(year || info.year || 2025); status = status || info.status || 'mfj';
    const married = status === 'mfj' || status === 'qss';
    const tpAge = TM.ageAtYearEnd(info.tpDob, year), spAge = married ? TM.ageAtYearEnd(info.spDob, year) : null;
    const seniors = (tpAge >= 65 ? 1 : 0) + (spAge >= 65 ? 1 : 0);
    const blind = (info.tpBlind ? 1 : 0) + (married && info.spBlind ? 1 : 0);
    const deps = c.deps || [];
    const ctcKids = deps.filter((d) => n(d.age) < 17 && d.ssn !== false && d.rel !== 'other').length;
    const odcDeps = deps.length - ctcKids;
    return { year, status, seniors, blind, ctcKids, odcDeps, tpAge, spAge };
  };
  TM.feeds = function (c, opt) {
    opt = opt || {};
    const info = c.info || {}; const ctx = TM.clientCtx(c, opt.year, opt.status); const M = c.mod || {};
    const x = TM.blankLeaves();
    const W2 = c.w2 || [];
    x.wages = sum(W2, (w) => w.wages); x.wh = sum(W2, (w) => w.fedWh);
    // Schedule SE uses the social security wages of the self-employed spouse only (Sch. SE line 8a)
    const seOwner = (((M.schC || {}).businesses || [])[0] || {}).owner || 'tp';
    const ownerName = String(seOwner === 'sp' ? info.spFirst : info.tpFirst || '').toLowerCase();
    x.ssWages = sum(W2.filter((w) => w.who === seOwner || String(w.who || '').toLowerCase() === ownerName), (w) => (w.ssWages != null && w.ssWages !== '' ? w.ssWages : w.wages));
    const o = c.other || {};
    ['otherEarned', 'iraDist', 'pensions', 'ssBenefits', 'stateRefund', 'alimonyRec', 'farm', 'unemployment', 'otherIncome', 'educator', 'hsa', 'alimonyPaid', 'iraDed', 'studentLoan', 'otherAdj',
      'tips', 'overtime', 'carLoanInt', 'childCare', 'education', 'otherNonref', 'otherTax', 'estimates', 'extension', 'otherPayments', 'whOther'].forEach((k) => { if (o[k] != null) x[k] = n(o[k]); });
    x.ctcKids = ctx.ctcKids; x.odcDeps = ctx.odcDeps;
    const pf = TM.calcPortfolio(Object.assign({}, M.portfolio, { married: ctx.status === 'mfj' }));
    const sc = TM.calcSchC(M.schC);
    const k1 = TM.calcK1(M.k1);
    const eq = TM.calcEquity(M.equity, ctx.year);
    const cap = TM.calcCapital(M.capital, ctx.year, { k1Sec1231: k1.sec1231, k1Unrecap: 0 });
    const rents = TM.calcRents(M.rents);
    const it = TM.calcItemized(M.itemized, k1);
    // Portfolio
    x.taxableInt = pf.taxableInt + k1.interest; x.taxExemptInt = pf.taxExemptInt + pf.exemptDiv + k1.taxExempt;
    x.ordDiv = pf.ordDiv + k1.ordDiv; x.qualDiv = pf.qualDiv + k1.qualDiv; x.reitPtp = pf.sec199a;
    x.pabInt = pf.pabInt + pf.pabDiv; x.earlyPenalty = pf.earlyPenalty; x.ftc = pf.ftc + k1.ftc; x.whOther = n(x.whOther) + pf.wh;
    // Equity compensation: compensation not already in W-2 box 1 goes on line 1h
    x.otherEarned = n(x.otherEarned) + eq.notInW2;
    x.isoSpread = eq.line2i; x.otherAmtAdj = eq.line2k + k1.amt; x.amtGainAdj = eq.line2k; x.amtCredit = eq.amtCredit;
    // Capital
    x.stGain = cap.st + k1.stcg + eq.st;
    x.ltGain = cap.lt + pf.cgd + k1.ltcg + eq.lt;
    x.stCarry = cap.stCarry; x.ltCarry = cap.ltCarry;
    x.unrecap1250 = cap.unrecap + pf.unrecapDiv + k1.unrecap; x.collect28 = cap.collect28 + pf.collectDiv + k1.collect;
    x.f4797ord = cap.finalOrdinary; x.gainNotNii = cap.activeGain;
    // Schedule C
    x.schC = sc.net; x.sepIra = sc.sepIra; x.seHealth = sc.seHealth; x.seK1 = k1.se;
    // Itemized
    Object.assign(x, it);
    x.qbiCarry = n((M.qbi || {}).carry);
    // Schedule E with the passive rules. Pass 1: MAGI without passive losses (§469(i)(3)(F))
    const base = (allowMagi) => {
      const pas = TM.calcPassive(rents, k1, allowMagi, ctx.status);
      const nonpassiveRent = sum(rents.rows.filter((r) => !r.passive), (r) => r.net);
      return { pas, schE: pas.net + nonpassiveRent + k1.nonpassive };
    };
    const items = [...sc.qbiItems, ...k1.qbiItems, ...rents.qbiItems];
    // Pass 1 allows no special allowance, which gives AGI without net passive losses: the MAGI of §469(i)(3)(F)
    let b = base(Infinity);
    const pass1 = TM.computeReturn(Object.assign({}, x, { schE: b.schE }), Object.assign({}, ctx, { qbiItems: items }));
    const magi = pass1.agi;
    b = base(magi);
    x.schE = b.schE;
    // A passive loss that is suspended is not QBI until it is allowed (Reg. §1.199A-3(b)(1)(iv))
    b.pas.acts.filter((a) => a.kind === 'k1' && a.net < 0).forEach((a) => {
      const it = items.find((q) => q.src === 'k1' && q.name === a.name); if (!it) return;
      it.qbi = n(it.qbi) * Math.min(1, Math.max(0, -a.allowedNet) / -a.net);
    });
    // Net investment income other than interest and dividends: passive income, royalties, passive K-1
    x.niiOther = sum(b.pas.acts, (a) => a.allowedNet) + sum(rents.rows.filter((r) => r.royalty), (r) => r.net) + (rents.rep ? 0 : sum(rents.rows.filter((r) => !r.passive && !r.royalty), (r) => r.net));
    if (opt.leafOverrides) Object.assign(x, opt.leafOverrides);
    return { x, ctx, items, detail: { pf, sc, k1, eq, cap, rents, it, pas: b.pas, magi } };
  };

  // All columns of a client's 1040 walk
  TM.walkClient = function (c) {
    const info = c.info || {};
    const F = TM.feeds(c);
    const defined = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null && v !== ''));
    const baseX = Object.assign({}, F.x, defined(c.direct));
    const cols = [{ id: 'base', name: info.baseName || 'Base', year: +(info.year || 2025), status: info.status || 'mfj', ov: {}, base: true }].concat(c.cols || []);
    const res = cols.map((col) => {
      const ctx = Object.assign({}, TM.clientCtx(c, col.year, col.status), { qbiItems: F.items });
      let x = Object.assign({}, baseX);
      if (col.growth) x = TM.project(x, col.growth);
      if (col.lv) x = TM.applyLevers(x, col.lv);
      Object.assign(x, defined(col.ov));
      const r = TM.computeReturn(x, ctx);
      r.marginal = TM.marginal(x, ctx, r);
      return { col, ctx, x, r };
    });
    return { feeds: F, baseX, cols: res };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TM;
})(typeof window !== 'undefined' ? window : this);
