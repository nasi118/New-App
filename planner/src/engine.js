/* Tax Master Planner — calculation engine.
 * Pure functions, no DOM. Runs in the browser and in node (tests).
 * Each workbook model is computed in two modes:
 *   'workbook'  — the formulas exactly as built in the source .xlsx
 *   'corrected' — the same model with the review fixes applied
 * Findings are produced by comparing the two and by running diagnostics.
 */
(function (root) {
  'use strict';
  const E = {};
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : (v === '' || v == null ? 0 : (isFinite(+v) ? +v : 0)));
  const sum = (arr, f) => arr.reduce((s, x) => s + n(f ? f(x) : x), 0);
  const round2 = (v) => Math.round(v * 100) / 100;
  E.n = n; E.sum = sum;

  /* ------------------------------------------------------------------ *
   * Excel-style expression evaluator (no eval / new Function: CSP-safe)
   * Supports + - * / ^, parentheses, numbers, percentages, identifiers,
   * ranges of row columns (K:L), MAX MIN AVERAGE SUM ABS ROUND IF.
   * ------------------------------------------------------------------ */
  function tokenize(src) {
    const t = []; let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      const num = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?%?/.exec(src.slice(i));
      if (num) {
        let v = parseFloat(num[0]); if (num[0].endsWith('%')) v /= 100;
        t.push({ k: 'num', v }); i += num[0].length; continue;
      }
      const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      if (id) { t.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
      const op2 = src.slice(i, i + 2);
      if (op2 === '<=' || op2 === '>=' || op2 === '<>') { t.push({ k: 'op', v: op2 }); i += 2; continue; }
      if ('+-*/^(),:<>='.includes(c)) { t.push({ k: 'op', v: c }); i++; continue; }
      throw new Error('Unexpected character "' + c + '"');
    }
    return t;
  }
  function parse(src) {
    const t = tokenize(src); let p = 0;
    const peek = () => t[p]; const eat = (v) => { if (t[p] && t[p].v === v) { p++; return true; } return false; };
    const need = (v) => { if (!eat(v)) throw new Error('Expected "' + v + '"'); };
    function cmp() {
      let a = add();
      while (peek() && ['<', '>', '<=', '>=', '=', '<>'].includes(peek().v)) {
        const op = t[p++].v; const b = add(); a = { op, a, b };
      }
      return a;
    }
    function add() { let a = mul(); while (peek() && (peek().v === '+' || peek().v === '-')) { const op = t[p++].v; a = { op, a, b: mul() }; } return a; }
    function mul() { let a = pow(); while (peek() && (peek().v === '*' || peek().v === '/')) { const op = t[p++].v; a = { op, a, b: pow() }; } return a; }
    function pow() { let a = unary(); while (peek() && peek().v === '^') { p++; a = { op: '^', a, b: unary() }; } return a; }
    function unary() { if (eat('-')) return { op: 'neg', a: unary() }; if (eat('+')) return unary(); return primary(); }
    function primary() {
      const tok = t[p++];
      if (!tok) throw new Error('Formula ends early');
      if (tok.k === 'num') return { num: tok.v };
      if (tok.v === '(') { const e = cmp(); need(')'); return e; }
      if (tok.k === 'id') {
        if (eat('(')) {
          const args = [];
          if (!eat(')')) {
            do {
              if (t[p] && t[p].k === 'id' && t[p + 1] && t[p + 1].v === ':') {
                const from = t[p].v; p += 2; const to = t[p++].v; args.push({ range: [from, to] });
              } else args.push(cmp());
            } while (eat(','));
            need(')');
          }
          return { fn: tok.v.toUpperCase(), args };
        }
        return { id: tok.v };
      }
      throw new Error('Unexpected "' + tok.v + '"');
    }
    const ast = cmp();
    if (p < t.length) throw new Error('Unexpected "' + t[p].v + '"');
    return ast;
  }
  function evalAst(ast, look) {
    if ('num' in ast) return ast.num;
    if ('id' in ast) { const v = look(ast.id); if (v === undefined) throw new Error('Unknown name ' + ast.id); return n(v); }
    if (ast.fn) {
      const vals = [];
      for (const a of ast.args) {
        if (a.range) {
          const [f, to] = a.range; for (let c = f.charCodeAt(0); c <= to.charCodeAt(0); c++) vals.push(n(look(String.fromCharCode(c))));
        } else vals.push(evalAst(a, look));
      }
      switch (ast.fn) {
        case 'MAX': return Math.max(...vals);
        case 'MIN': return Math.min(...vals);
        case 'SUM': return vals.reduce((s, v) => s + v, 0);
        case 'AVERAGE': return vals.reduce((s, v) => s + v, 0) / vals.length;
        case 'ABS': return Math.abs(vals[0]);
        case 'ROUND': { const f = Math.pow(10, vals[1] || 0); return Math.round(vals[0] * f) / f; }
        case 'IF': return vals[0] ? vals[1] : (vals.length > 2 ? vals[2] : 0);
        default: throw new Error('Unsupported function ' + ast.fn);
      }
    }
    const a = evalAst(ast.a, look);
    if (ast.op === 'neg') return -a;
    const b = evalAst(ast.b, look);
    switch (ast.op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b;
      case '^': return Math.pow(a, b);
      case '<': return +(a < b); case '>': return +(a > b); case '<=': return +(a <= b); case '>=': return +(a >= b);
      case '=': return +(a === b); case '<>': return +(a !== b);
    }
    throw new Error('Bad operator');
  }
  const astCache = new Map();
  E.evalFormula = function (src, look) {
    let ast = astCache.get(src);
    if (!ast) { ast = parse(String(src).replace(/^=/, '')); astCache.set(src, ast); }
    return evalAst(ast, look);
  };

  /* ================================================================== *
   * HNWI strategy comparison (john_doe_hnwi_tax_strategy_comparison)
   * ================================================================== */
  E.calcHnwi = function (h) {
    const names = {}; h.assumptions.forEach((a) => { names[a.name] = n(a.value); });
    const phases1 = ['Planning / Diligence', 'Implementation / Funding', 'Tax Filing / Reporting'];
    const rows = h.strategies.map((s) => {
      const r = { no: s.no, error: null };
      const look = (id) => (id in names ? names[id] : (/^[G-L]$/.test(id) ? n(s[id]) : (id === 'N' ? r.benefit : undefined)));
      try {
        r.benefit = E.evalFormula(s.formula, look);
        r.low = E.evalFormula(s.low, look);
        r.high = E.evalFormula(s.high, look);
        if (!isFinite(r.benefit)) throw new Error('Result is not a number');
      } catch (e) { r.error = e.message; r.benefit = 0; r.low = 0; r.high = 0; }
      const items = h.checklist.filter((c) => c.no === s.no);
      r.oneTime = sum(items.filter((c) => phases1.includes(c.phase)), (c) => c.cost);
      r.recurring = sum(items.filter((c) => c.phase === 'Ongoing Monitoring'), (c) => c.cost);
      r.horizonCost = r.oneTime + r.recurring * n(h.horizon);
      r.net = r.benefit - r.horizonCost;
      r.ratio = r.horizonCost === 0 ? 0 : r.benefit / r.horizonCost;
      r.flag = r.net < 0 ? 'Negative net benefit' : (r.ratio < 1 ? 'Ratio below 1.0x' : (s.risk === 'High' ? 'High risk' : 'Review'));
      r.done = items.filter((c) => c.status === 'Complete').length; r.items = items.length;
      return r;
    });
    // RANK(J, J$, 0) + COUNTIF($J$15:J15, J15) - 1  → dense order by net, ties broken by position
    const order = rows.map((r, i) => ({ i, net: r.net })).sort((a, b) => b.net - a.net || a.i - b.i);
    order.forEach((o, k) => { rows[o.i].rank = k + 1; });
    const byNo = {}; rows.forEach((r) => { byNo[r.no] = r; });
    const benefits = rows.map((r) => r.benefit);
    const sorted = [...rows].sort((a, b) => b.benefit - a.benefit);
    const cats = {}; h.strategies.forEach((s) => { cats[s.category] = (cats[s.category] || 0) + 1; });
    const risk = { High: 0, Medium: 0, Low: 0 }; h.strategies.forEach((s) => { risk[s.risk] = (risk[s.risk] || 0) + 1; });
    const sel = h.strategies.filter((s) => s.selected).map((s) => byNo[s.no]);
    const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b);
    const med = ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2;
    const status = {}; h.checklist.forEach((c) => { status[c.status] = (status[c.status] || 0) + 1; });
    return {
      rows, byNo,
      dashboard: {
        count: rows.length, total: sum(benefits), avg: sum(benefits) / rows.length,
        max: Math.max(...benefits), min: Math.min(...benefits), risk,
        top: sorted.slice(0, 15).map((r) => r.no), categories: cats,
      },
      all: {
        benefit: sum(rows, (r) => r.benefit), cost: sum(rows, (r) => r.horizonCost), net: sum(rows, (r) => r.net),
        medianRatio: med, below1: rows.filter((r) => r.ratio < 1).length, negative: rows.filter((r) => r.net < 0).length,
      },
      selected: {
        count: sel.length, benefit: sum(sel, (r) => r.benefit), oneTime: sum(sel, (r) => r.oneTime),
        recurring: sum(sel, (r) => r.recurring) * n(h.horizon), cost: sum(sel, (r) => r.horizonCost), net: sum(sel, (r) => r.net),
      },
      checklist: {
        total: h.checklist.length, status, cost: sum(h.checklist, (c) => c.cost),
        avg: sum(h.checklist, (c) => c.cost) / Math.max(1, h.checklist.length),
        max: Math.max(...h.checklist.map((c) => n(c.cost))), min: Math.min(...h.checklist.map((c) => n(c.cost))),
      },
    };
  };

  E.hnwiFindings = function (h, res) {
    const f = [];
    f.push({ id: 'H1', module: 'hnwi', severity: 'info', title: 'The 50 benefits are not additive',
      detail: 'The dashboard total of ' + fmt(res.dashboard.total) + ' adds every strategy together. Many are alternatives that draw on the same lifetime exemption, GST exemption or the same appreciated asset. Use the selected-package view to size a coherent plan.',
      impact: null });
    const exemptNos = [1, 2, 9];
    const selExempt = h.strategies.filter((s) => s.selected && exemptNos.includes(s.no));
    const exemption = n((h.assumptions.find((a) => a.name === 'FederalEstateGSTExemption2026') || {}).value);
    const used = sum(selExempt, (s) => s.G);
    if (selExempt.length > 1 || used > exemption) {
      f.push({ id: 'H2', module: 'hnwi', severity: used > exemption ? 'high' : 'medium', title: 'Selected gifts draw on one exemption',
        detail: 'Strategies ' + selExempt.map((s) => '#' + s.no).join(', ') + ' together transfer ' + fmt(used) + ' against a ' + fmt(exemption) + ' basic exclusion. Coordinate the gifts before counting each benefit in full.',
        impact: null });
    }
    res.rows.filter((r) => r.net < 0).forEach((r) => {
      const s = h.strategies.find((x) => x.no === r.no);
      f.push({ id: 'H-neg-' + r.no, module: 'hnwi', severity: 'medium', title: '#' + r.no + ' ' + s.title + ' costs more than it saves',
        detail: 'Estimated benefit ' + fmt(r.benefit) + ' against ' + fmt(r.horizonCost) + ' of implementation and ' + h.horizon + '-year monitoring cost.', impact: r.net });
    });
    res.rows.filter((r) => r.error).forEach((r) => {
      f.push({ id: 'H-err-' + r.no, module: 'hnwi', severity: 'high', title: 'Formula error in strategy #' + r.no, detail: r.error, impact: null });
    });
    return f;
  };

  /* ================================================================== *
   * Rental HoldCo §469 / §199A (rental_holdco_469_199A_example)
   * ================================================================== */
  E.calcRental = function (d, mode, opt) {
    opt = opt || {};
    const C = mode === 'corrected';
    const props = d.properties.map((p) => {
      const income = n(p.rents) + n(p.otherIncome);
      const deductions = n(p.opex) + n(p.repairs) + n(p.taxIns) + n(p.interest) + n(p.depreciation) + n(p.wages);
      return { name: p.name, entity: p.entity, income, deductions, qbi: income - deductions, wages: n(p.wages), ubia: n(p.ubia), hours: n(p.hours), type: p.type };
    });
    const tot = { income: sum(props, (p) => p.income), deductions: sum(props, (p) => p.deductions), qbi: sum(props, (p) => p.qbi),
      wages: sum(props, (p) => p.wages), ubia: sum(props, (p) => p.ubia), hours: sum(props, (p) => p.hours) };
    const hr = d.hours;
    const rep = {
      rpHours: n(hr.johnRP), rpPass: n(hr.johnRP) > 750,
      share: n(hr.johnTotal) ? n(hr.johnRP) / n(hr.johnTotal) : 0,
      mp: n(hr.combinedRental), mpPass: n(hr.combinedRental) > 500,
    };
    rep.sharePass = rep.share > 0.5;
    rep.pass = rep.rpPass && rep.sharePass && rep.mpPass;
    const own = sum(d.owners, (o) => o.pct);
    const a = d.aggregation;
    const factors = ['factorA', 'factorB', 'factorC'].filter((k) => a[k] === 'Yes').length;
    const agg = { common: own, commonPass: own >= 0.5, majorityPass: a.majorityYear === 'Yes', sameYearPass: a.sameYear === 'Yes',
      sstbPass: a.noSSTB === 'Yes', factors, factorsPass: factors >= 2 };
    agg.pass = agg.commonPass && agg.majorityPass && agg.sameYearPass && agg.sstbPass && agg.factorsPass;

    const TI = n(d.taxableIncome), NCG = n(d.netCapitalGain);
    const threshold = n(opt.threshold != null ? opt.threshold : 403500);
    const range = n(opt.phaseRange != null ? opt.phaseRange : 150000);
    function limitCalc(qbi, w, u, ti, ncg, corrected) {
      const q20 = qbi * 0.2, w50 = w * 0.5, alt = w * 0.25 + u * 0.025, wageLimit = Math.max(w50, alt);
      let comp = Math.min(q20, wageLimit), carry = 0, phase = 'full';
      if (corrected) {
        if (qbi <= 0) { comp = 0; carry = qbi; phase = 'loss'; }
        else if (ti <= threshold) { comp = q20; phase = 'below'; }
        else if (ti < threshold + range && wageLimit < q20) {
          comp = q20 - (q20 - wageLimit) * ((ti - threshold) / range); phase = 'phase-in';
        }
      }
      const tiLimit = corrected ? Math.max(0, (ti - ncg) * 0.2) : (ti - ncg) * 0.2;
      const ded = Math.min(comp, tiLimit);
      return { q20, w50, alt, wageLimit, comp, tiLimit, ded, carry, phase, binding: Math.abs(comp - tiLimit) < 0.005 ? 'Both/Same' : (comp < tiLimit ? 'Wage/UBIA' : 'Taxable-income') };
    }
    const summary = limitCalc(tot.qbi, tot.wages, tot.ubia, TI, NCG, C);
    const ownerRows = (pcts) => d.owners.map((o, i) => {
      const pct = n(pcts[i]);
      const q = tot.qbi * pct, w = tot.wages * pct, u = tot.ubia * pct;
      const l = limitCalc(q, w, u, TI * pct, NCG * pct, C);
      // Workbook M column floors the owner-level TI limit at zero even in as-built mode
      if (!C) { l.tiLimit = Math.max(0, l.tiLimit); l.ded = Math.min(l.comp, l.tiLimit); }
      return Object.assign({ name: o.name, pct, qbi: q, wages: w, ubia: u }, l);
    });
    const owners = ownerRows(d.owners.map((o) => o.pct));
    const scenPcts = (d.scenarioPcts && d.scenarioPcts.length === d.owners.length) ? d.scenarioPcts : d.owners.map((o) => o.pct);
    const scenario = ownerRows(scenPcts).map((r, i) => Object.assign(r, { current: owners[i].ded, change: r.ded - owners[i].ded }));
    const scenTotal = sum(scenPcts);
    // §469 election value
    const loss = Math.min(0, tot.qbi);
    const rate = n(opt.marginalRate != null ? opt.marginalRate : 0.35);
    const separateNonpassive = sum(props.filter((p) => p.hours > 500), (p) => p.qbi);
    const election = {
      net: tot.qbi,
      withElection: rep.pass ? tot.qbi : 0,
      repNoElection: rep.rpPass && rep.sharePass ? separateNonpassive : 0,
      noRep: 0,
    };
    election.value = loss < 0 ? -(election.withElection - election.repNoElection) * rate : 0;
    election.valueVsNone = loss < 0 ? -election.withElection * rate : 0;
    // Rev. Proc. 2019-38 enterprise hours (residential and commercial may not share an enterprise)
    const isComm = (p) => /retail|commercial|office|industrial/i.test(p.type);
    const isMixed = (p) => /mixed/i.test(p.type);
    const enterprises = [
      { name: 'Residential', props: props.filter((p) => !isComm(p) && !isMixed(p)) },
      { name: 'Commercial', props: props.filter(isComm) },
      { name: 'Mixed-use', props: props.filter(isMixed) },
    ].filter((e) => e.props.length).map((e) => ({ name: e.name, hours: sum(e.props, (p) => p.hours), names: e.props.map((p) => p.name) }));
    return { mode, props, tot, rep, agg, TI, NCG, summary, owners, ownerTotal: sum(owners, (o) => o.ded), scenario, scenTotal,
      scenOk: Math.abs(scenTotal - 1) < 0.00001, election, rate, enterprises, threshold, range };
  };

  E.rentalFindings = function (d, opt) {
    const wb = E.calcRental(d, 'workbook', opt), c = E.calcRental(d, 'corrected', opt);
    const f = [];
    if (wb.tot.qbi < 0) {
      f.push({ id: 'R1', module: 'rental', severity: 'high', title: 'Negative QBI produces a negative §199A deduction',
        detail: 'The four properties net to ' + fmt(wb.tot.qbi) + ' of QBI. The workbook takes 20% of that and reports a deduction of ' + fmt(wb.summary.ded) + '. A net qualified business loss gives a zero deduction and carries forward as negative QBI into 2027 (Reg. §1.199A-1(d)(2)(iii)).',
        impact: c.summary.ded - wb.summary.ded });
    }
    if (wb.TI > c.threshold && wb.TI < c.threshold + c.range && wb.tot.qbi > 0) {
      f.push({ id: 'R2', module: 'rental', severity: 'medium', title: 'Taxable income is inside the phase-in range',
        detail: 'The workbook applies the full wage/UBIA limit. Between ' + fmt(c.threshold) + ' and ' + fmt(c.threshold + c.range) + ' the limit phases in.', impact: c.summary.ded - wb.summary.ded });
    }
    f.push({ id: 'R3', module: 'rental', severity: 'medium', title: 'Owner-level split does not apply on a joint return',
      detail: 'The election statement treats John and Jane as one joint return. On a joint return the §199A deduction and the taxable-income limit are figured once for the couple, so the 60/40 owner schedule and the ownership scenario are informational only.', impact: null });
    if (d.hours && n(d.hours.outsideMgmt) > 0) {
      f.push({ id: 'R4', module: 'rental', severity: 'info', title: 'Safe-harbor enterprises must separate residential and commercial',
        detail: 'Rev. Proc. 2019-38 does not let residential and commercial property share one enterprise. Hours by enterprise: ' + c.enterprises.map((e) => e.name + ' ' + fmtN(e.hours)).join(', ') + ', plus ' + fmtN(d.hours.outsideMgmt) + ' outside-manager hours to allocate. Each enterprise needs 250 hours of rental services.', impact: null });
    }
    if (c.election.net < 0) {
      f.push({ id: 'R5', module: 'rental', severity: 'info', title: 'The §469(c)(7)(A) election is worth about ' + fmt(c.election.value),
        detail: 'With the election the ' + fmt(-c.election.net) + ' net rental loss is nonpassive. Without it only properties with more than 500 hours on their own (' + c.props.filter((p) => p.hours > 500).map((p) => p.name).join(', ') + ') would be nonpassive, and the rest would be suspended. Figured at a ' + Math.round(c.rate * 100) + '% marginal rate.', impact: c.election.value });
    }
    return f;
  };

  /* ================================================================== *
   * Form 1040 reconciliation workpaper (Rivera demo, TY2025)
   * ================================================================== */
  // MFJ parameters. 2025: Rev. Proc. 2024-40 as amended by Pub. L. 119-21. 2026: Rev. Proc. 2025-32 (confirm).
  const TAXP = {
    2025: { br: [[23850, 0.10], [96950, 0.12], [206700, 0.22], [394600, 0.24], [501050, 0.32], [751600, 0.35], [Infinity, 0.37]], cg: [96700, 600050],
      standard: 31500, wageBase: 176100, saltCap: 40000, ctc: 2200, actc: 1700, qbiThreshold: 394600, hsaFamily: 8550 },
    2026: { br: [[24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [Infinity, 0.37]], cg: [98900, 613700],
      standard: 32200, wageBase: 184500, saltCap: 40400, ctc: 2200, actc: 1700, qbiThreshold: 403500, hsaFamily: 8750 },
  };
  E.TAXP = TAXP;
  function ordinaryTax(ti, br) { let tax = 0, prev = 0; for (const [top, r] of br) { if (ti > prev) tax += (Math.min(ti, top) - prev) * r; prev = top; } return tax; }
  E.taxMfj = function (year, ti, qd, ncg) {
    const P = TAXP[year] || TAXP[2025];
    ti = Math.max(0, ti);
    const pref = Math.min(ti, Math.max(0, qd) + Math.max(0, ncg));
    const ord = ti - pref;
    const at0 = Math.max(0, Math.min(ti, P.cg[0]) - ord);
    const at15 = Math.max(0, Math.min(ti, P.cg[1]) - ord - at0);
    const at20 = pref - at0 - at15;
    const withPref = ordinaryTax(ord, P.br) + at15 * 0.15 + at20 * 0.20;
    return Math.min(withPref, ordinaryTax(ti, P.br));
  };
  E.tax2025Mfj = (ti, qd, ncg) => E.taxMfj(2025, ti, qd, ncg);

  E.calc1040 = function (d, mode, opt) {
    opt = opt || {};
    const C = mode === 'corrected';
    const v = {};
    const w2 = { wages: sum(d.w2, (x) => x.wages), wh: sum(d.w2, (x) => x.fedwh), ss: sum(d.w2, (x) => x.ssWages) };
    const int = { taxable: sum(d.interest, (x) => x.taxable), exempt: sum(d.interest, (x) => x.exempt), wh: sum(d.interest, (x) => x.wh) };
    const div = { ord: sum(d.dividends, (x) => x.ordinary), qual: sum(d.dividends, (x) => x.qualified), cgd: sum(d.dividends, (x) => x.capGainDist), wh: sum(d.dividends, (x) => x.wh) };
    const sales = d.sales.map((s) => ({ ...s, gain: n(s.proceeds) - n(s.basis) + n(s.adj) }));
    // K-1s
    const k1 = d.k1.map((k) => {
      const ord = n(k.box1) + n(k.box2);
      const allowed = k.passive ? (C ? (ord >= 0 ? ord : 0) : (k.ptp ? 0 : Math.max(0, ord))) : ord;
      return { ...k, ord, allowed, portfolio: n(k.interest) + n(k.ordDiv), schD: n(k.stcg) + n(k.ltcg), suspended: k.passive && ord < 0 };
    });
    const kt = (f) => sum(k1, (k) => k[f]);
    // Schedule E rows
    const expKeys = ['advertising', 'auto', 'cleaning', 'commissions', 'insurance', 'mortgage', 'taxes', 'repairs', 'depreciation', 'other'];
    const eRows = d.schE.map((r) => ({ name: r.name, type: r.type, gross: n(r.gross), exp: sum(expKeys, (k) => r[k]), net: n(r.gross) - sum(expKeys, (k) => r[k]) }));
    const rentalLoss = sum(eRows.filter((r) => r.type === 'Rental'), (r) => Math.abs(Math.min(0, r.net)));
    const k1PassiveLoss = sum(k1.filter((k) => k.passive && (!C || !k.ptp)), (k) => Math.abs(Math.min(0, n(k.box2))));
    // Form 8582
    const pal = {};
    pal.l1a = n(d.pal.rreIncome); pal.l1b = rentalLoss + k1PassiveLoss; pal.l1c = n(d.pal.priorUnallowed);
    pal.l1d = pal.l1b + pal.l1c; pal.l3 = pal.l1d - pal.l1a; pal.l4 = Math.min(pal.l1d, pal.l3);
    pal.l5 = n(d.pal.threshold); pal.l6 = n(d.pal.magi); pal.l7 = Math.max(0, pal.l5 - pal.l6);
    pal.l8 = Math.min(pal.l7 * 0.5, 25000); pal.l9 = Math.min(pal.l4, pal.l8); pal.l10 = n(d.pal.passiveIncome);
    pal.l11 = pal.l9 + pal.l10; pal.suspended = Math.max(0, pal.l1d - pal.l11);
    pal.ptpSuspended = C ? sum(k1.filter((k) => k.ptp && k.passive), (k) => Math.abs(Math.min(0, k.ord))) : 0;
    // Schedule E allowed amounts
    eRows.forEach((r) => {
      if (r.type === 'Rental') {
        if (C) {
          const lossR = Math.abs(Math.min(0, r.net));
          const allowedShare = pal.l1d > 0 ? pal.l11 * (lossR / pal.l1d) : 0;
          r.palAdj = lossR - Math.min(lossR, allowedShare);
        } else r.palAdj = pal.l8; // workbook links the special allowance itself (Form_8582_PAL!C13)
      } else r.palAdj = 0;
      r.allowed = r.net + r.palAdj;
    });
    const k1SchE = C ? kt('allowed') : 0; // workbook links K1_Input!T8, a text column that sums to zero
    const schE = { rows: eRows, k1: k1SchE, total: sum(eRows, (r) => r.allowed) + k1SchE };
    // Schedule C
    const c = {};
    c.l1 = n(d.schC.gross); c.l2 = n(d.schC.returns); c.l3 = c.l1 - c.l2; c.l4 = n(d.schC.cogs); c.l5 = c.l3 - c.l4;
    c.l6 = n(d.schC.otherIncome); c.l7 = c.l5 + c.l6; c.l28 = sum(d.schC.expenses, (x) => x.amount);
    c.l29 = c.l7 - c.l28; c.l30 = n(d.schC.homeOffice); c.l31 = c.l29 - c.l30;
    // Schedule SE
    const se = {};
    se.a = c.l31; se.b = kt('se'); se.c = se.a + se.b; se.d = n(d.se.factor); se.e = se.c * se.d; se.f = n(d.se.wageBase);
    if (C) {
      const ownerW2 = d.w2.filter((x) => String(x.who).toLowerCase() === String(d.se.owner).toLowerCase());
      se.g = sum(ownerW2, (x) => x.ssWages);
    } else se.g = w2.ss;
    se.h = Math.max(0, se.f - se.g);
    se.i = (C && se.e < 400) ? 0 : Math.min(se.e, se.h) * 0.124 + se.e * 0.029;
    se.j = Math.round(se.i); se.k = se.j / 2;
    // Schedule B
    const b = {};
    b.interestRows = d.interest.filter((x) => n(x.taxable) !== 0 || n(x.exempt) === 0).map((x) => ({ payer: x.payer, amount: n(x.taxable) }));
    if (C) k1.filter((k) => n(k.interest)).forEach((k) => b.interestRows.push({ payer: k.entity + ' (K-1)', amount: n(k.interest) }));
    b.l2 = sum(b.interestRows, (x) => x.amount); b.l3 = 0; b.l4 = b.l2 - b.l3;
    b.divRows = d.dividends.map((x) => ({ payer: x.payer, amount: n(x.ordinary) }));
    if (C) k1.filter((k) => n(k.ordDiv)).forEach((k) => b.divRows.push({ payer: k.entity + ' (K-1)', amount: n(k.ordDiv) }));
    b.l6 = sum(b.divRows, (x) => x.amount);
    const qualDiv = div.qual + (C ? kt('qualDiv') : 0);
    // Schedule D
    const dd = {};
    dd.stSales = sum(sales.filter((s) => /short/i.test(s.term)), (s) => s.gain);
    dd.stK1 = C ? kt('stcg') : n((k1[0] || {}).stcg); // workbook links K1_Input!L4, the first K-1 only
    dd.st = dd.stSales + dd.stK1;
    dd.ltSales = sum(sales.filter((s) => /long/i.test(s.term)), (s) => s.gain);
    dd.cgd = div.cgd; dd.ltK1 = kt('ltcg'); dd.lt = dd.ltSales + dd.cgd + dd.ltK1; dd.l16 = dd.st + dd.lt;
    dd.ncg = Math.max(0, Math.min(dd.lt, dd.l16));
    // Schedule 1
    const s1 = {};
    s1.l1 = n(d.other.stateRefund); s1.l2a = n(d.sch1.alimony); s1.l3 = c.l31; s1.l4 = n(d.sch1.otherGains); s1.l5 = schE.total;
    s1.l6 = n(d.sch1.farm); s1.l7 = n(d.other.unemployment); s1.l8b = n(d.other.gambling); s1.l9 = s1.l8b;
    s1.l10 = s1.l1 + s1.l2a + s1.l3 + s1.l4 + s1.l5 + s1.l6 + s1.l7 + s1.l9;
    s1.l15 = se.k; s1.l13 = n(d.sch1.hsa); s1.l16 = n(d.sch1.sepIra); s1.l21 = n(d.sch1.studentLoan); s1.l25 = n(d.sch1.otherAdj);
    s1.l26 = s1.l15 + s1.l13 + s1.l16 + s1.l21 + s1.l25;
    // Form 1040 income
    const f = {};
    const m = d.misc;
    f.l1a = w2.wages; ['1b', '1c', '1d', '1e', '1f', '1g', '1h'].forEach((k) => { f['l' + k] = n(m['l' + k]); });
    f.l1z = f.l1a + f.l1b + f.l1c + f.l1d + f.l1e + f.l1f + f.l1g + f.l1h;
    f.l2a = int.exempt; f.l2b = b.l4; f.l3a = qualDiv; f.l3b = b.l6; f.l4b = n(m.l4b); f.l5b = n(m.l5b); f.l6b = n(m.l6b);
    f.l7a = C ? Math.max(dd.l16, -3000) : dd.l16; dd.carryover = C ? Math.min(0, dd.l16 + 3000) : 0; f.l8 = s1.l10;
    f.l9 = f.l1z + f.l2b + f.l3b + f.l4b + f.l5b + f.l6b + f.l7a + f.l8;
    f.l10 = s1.l26; f.l11a = f.l9 - f.l10; f.l11b = f.l11a;
    // Schedule A
    const a = {};
    a.l1 = n(d.schA.medical); a.l2 = f.l11b; a.l3 = a.l2 * 0.075; a.l4 = Math.max(0, a.l1 - a.l3);
    a.l5a = n(d.other.stateIncomeTax); a.l5b = n(d.other.realEstateTax); a.l5c = n(d.other.personalPropTax);
    a.l5d = a.l5a + a.l5b + a.l5c;
    a.saltCap = n(d.schA.saltCap);
    if (C && f.l11b > 500000) a.saltCap = Math.max(10000, a.saltCap - 0.3 * (f.l11b - 500000));
    a.l5e = Math.min(a.l5d, a.saltCap); a.l8a = n(d.other.mortgage);
    a.l11 = n(d.other.cashCharity) + (C ? kt('charity') : 0);
    a.l15 = n(d.schA.casualty); a.l16 = n(d.schA.otherItemized);
    a.l17 = a.l4 + a.l5e + a.l8a + a.l11 + a.l15 + a.l16; a.std = n(d.schA.standard); a.l12e = Math.max(a.l17, a.std);
    a.method = a.l17 >= a.std ? 'Itemized' : 'Standard';
    // Form 8995
    const q = {};
    const seShareC = se.c ? se.a / se.c : 0;
    q.l1 = C ? c.l31 - se.k * seShareC - n(d.sch1.sepIra) : c.l31;
    q.l2 = C ? sum(k1.filter((k) => !k.suspended), (k) => k.qbi) - se.k * (1 - seShareC) : kt('qbi');
    q.l3 = q.l1 + q.l2; q.l4 = n(d.qbi.reitPtp);
    q.l5 = Math.max(0, q.l3) * 0.2 + (C ? Math.max(0, q.l4) * 0.2 : 0);
    q.carry = C && q.l3 < 0 ? q.l3 : 0;
    q.l11 = f.l11b - a.l12e - n(m.l13b);
    q.l12 = C ? qualDiv + dd.ncg : f.l1d + Math.max(0, dd.l16); // workbook links Form_1040_Tie_Out!C7 (line 1d)
    q.l13 = Math.max(0, q.l11 - q.l12); q.l14 = q.l13 * 0.2; q.l15 = Math.min(q.l5, q.l14);
    q.threshold = (TAXP[opt.year || 2025] || TAXP[2025]).qbiThreshold;
    // Deductions, taxable income
    f.l12e = a.l12e; f.l13a = q.l15; f.l13b = n(m.l13b); f.l14 = f.l12e + f.l13a + f.l13b; f.l15 = Math.max(0, f.l11b - f.l14);
    const engineTax = E.taxMfj(opt.year || 2025, f.l15, f.l3a, dd.ncg);
    const tax = {
      software: n(d.taxCalc.softwareTax), engine: engineTax, penalty: n(d.taxCalc.penalty), method: d.taxCalc.method,
      source: opt.taxSource === 'engine' ? 'engine' : 'software',
    };
    f.l16 = tax.source === 'engine' ? Math.round(engineTax) : tax.software;
    // Schedule 2
    const s2 = {};
    s2.l1z = n(d.sch2.otherAdditions); s2.l2 = n(d.sch2.amt); s2.l3 = s2.l1z + s2.l2; s2.l4 = se.j; s2.l11 = n(d.sch2.addlMedicare);
    const royalty = sum(eRows.filter((r) => r.type === 'Royalty'), (r) => r.allowed);
    const rentalNII = sum(eRows.filter((r) => r.type === 'Rental'), (r) => r.allowed);
    const passiveK1 = sum(k1.filter((k) => !k.material), (k) => Math.max(0, k.allowed));
    const nii = f.l2b + f.l3b + Math.max(0, f.l7a) + royalty + rentalNII + (C ? passiveK1 : 0);
    const niitEngine = 0.038 * Math.max(0, Math.min(nii, f.l11b - 250000));
    s2.niitEngine = niitEngine; s2.nii = nii;
    s2.l12 = opt.niitSource === 'engine' ? round2(niitEngine) : n(d.sch2.niit);
    s2.l17z = n(d.sch2.otherTaxes); s2.l21 = s2.l4 + s2.l11 + s2.l12 + s2.l17z;
    // Schedule 3
    const s3 = {};
    s3.l1 = kt('ftc'); s3.l2 = n(d.sch3.childCare); s3.l3 = n(d.other.educationCredit); s3.l4 = n(d.sch3.retirementSavers);
    s3.l5 = n(d.sch3.energy); s3.l7 = n(d.sch3.otherNonref); s3.l8 = s3.l1 + s3.l2 + s3.l3 + s3.l4 + s3.l5 + s3.l7;
    s3.l9 = n(d.sch3.ptc); s3.l10 = n(d.other.extensionPayment); s3.l11 = n(d.sch3.excessSS); s3.l12 = n(d.sch3.fuel);
    s3.l14 = n(d.sch3.otherRefundable); s3.l15 = s3.l9 + s3.l10 + s3.l11 + s3.l12 + s3.l14;
    // Tax and credits
    f.l17 = s2.l3; f.l18 = f.l16 + f.l17;
    // Schedule 8812
    const k = {};
    const ctcKids = d.deps.filter((x) => x.ctc && x.ssn).length;
    k.l5 = ctcKids * n(d.ctcAmount); k.l7 = d.deps.filter((x) => x.odc).length * n(d.odcAmount);
    if (C) {
      k.l8 = k.l5 + k.l7;
      const over = Math.max(0, f.l11b - 400000);
      k.phaseout = Math.ceil(over / 1000) * 50;
      k.l12 = Math.max(0, k.l8 - k.phaseout);
      k.l13 = Math.max(0, f.l18 - (s3.l1 + s3.l2 + s3.l3 + s3.l4 + s3.l5));
      k.l14 = Math.min(k.l12, k.l13);
      const unusedCtc = Math.max(0, Math.min(k.l5, k.l12 - k.l14));
      k.earned = f.l1z + se.a - se.k * seShareC;
      k.l20 = Math.max(0, k.earned - 2500) * 0.15;
      k.actc = Math.min(unusedCtc, ctcKids * n(d.actcMax), k.l20);
      k.nonref = k.l14;
    } else {
      k.l12 = f.l18; k.l13 = f.l15; // workbook labels 1040 line 15 as "tax available"
      k.nonref = Math.min(k.l7, k.l12); // workbook: MIN(ODC total, line 18)
      k.l16b = f.l1z + c.l31; k.earned = f.l1h + c.l31; k.l20 = Math.max(0, k.l16b - 2500) * 0.15;
      k.actc = Math.min(k.nonref, k.earned);
    }
    f.l19 = k.nonref; f.l20 = s3.l8; f.l21 = f.l19 + f.l20; f.l22 = Math.max(0, f.l18 - f.l21); f.l23 = s2.l21; f.l24 = f.l22 + f.l23;
    f.l25a = w2.wh; f.l25b = int.wh + div.wh; f.l25c = n(m.l25c); f.l25d = f.l25a + f.l25b + f.l25c;
    f.l26 = n(d.other.estPayments); f.l27a = n(m.l27a); f.l28 = k.actc; f.l29 = n(m.l29); f.l30 = n(m.l30); f.l31 = s3.l15;
    f.l32 = f.l27a + f.l28 + f.l29 + f.l30 + f.l31; f.l33 = f.l25d + f.l26 + f.l32;
    f.l34 = Math.max(0, f.l33 - f.l24); f.l36 = n(m.l36); f.l35a = Math.max(0, f.l34 - f.l36);
    f.l37 = Math.max(0, f.l24 - f.l33); f.l38 = tax.penalty;
    Object.assign(v, { mode, w2, int, div, sales, k1, kt: { box1: kt('box1'), box2: kt('box2'), interest: kt('interest'), ordDiv: kt('ordDiv'), qualDiv: kt('qualDiv'), stcg: kt('stcg'), ltcg: kt('ltcg'), charity: kt('charity'), ftc: kt('ftc'), qbi: kt('qbi'), se: kt('se'), allowed: kt('allowed'), portfolio: kt('portfolio'), schD: kt('schD'), distributions: kt('distributions') },
      schE, pal, c, se, b, dd, s1, f, a, q, tax, s2, s3, k });
    v.net = f.l35a - f.l37; // + refund, - balance due
    v.schedules = E.schedules1040(d, v);
    return v;
  };

  // Row tables for each schedule: [{key, line, desc, value, note, src, input}]
  E.schedules1040 = function (d, v) {
    const { f, a, b, c, dd, schE, pal, se, q, k, s1, s2, s3, tax } = v;
    const row = (key, line, desc, value, extra) => Object.assign({ key, line, desc, value }, extra || {});
    const S = {};
    S.schA = [
      row('A.1', '1', 'Medical and dental expenses', a.l1, { input: 'schA.medical' }),
      row('A.2', '2', 'AGI from Form 1040 line 11b', a.l2),
      row('A.3', '3', '7.5% of AGI', a.l3),
      row('A.4', '4', 'Deductible medical expense', a.l4),
      row('A.5a', '5a', 'State and local income taxes', a.l5a, { input: 'other.stateIncomeTax' }),
      row('A.5b', '5b', 'State and local real estate taxes', a.l5b, { input: 'other.realEstateTax' }),
      row('A.5c', '5c', 'Personal property taxes', a.l5c, { input: 'other.personalPropTax' }),
      row('A.5d', '5d', 'Total state and local taxes', a.l5d),
      row('A.5e', '5e', 'Allowable SALT deduction (cap ' + fmt(a.saltCap) + ')', a.l5e),
      row('A.8a', '8a', 'Home mortgage interest (Form 1098)', a.l8a, { input: 'other.mortgage' }),
      row('A.11', '11', 'Gifts by cash or check', a.l11, { input: 'other.cashCharity', note: v.mode === 'corrected' && v.kt.charity ? 'Includes ' + fmt(v.kt.charity) + ' K-1 charitable' : '' }),
      row('A.15', '15', 'Casualty and theft losses', a.l15, { input: 'schA.casualty' }),
      row('A.16', '16', 'Other itemized deductions', a.l16, { input: 'schA.otherItemized' }),
      row('A.17', '17', 'Total itemized deductions', a.l17, { total: true }),
      row('A.std', 'Std', 'Standard deduction', a.std, { input: 'schA.standard' }),
      row('A.12e', '12e', 'Larger of itemized or standard (' + a.method + ')', a.l12e, { total: true }),
    ];
    S.schB = [
      ...b.interestRows.map((x, i) => row('B.1.' + i, '1', x.payer, x.amount)),
      row('B.2', '2', 'Total interest', b.l2),
      row('B.3', '3', 'Excludable savings bond interest', b.l3),
      row('B.4', '4', 'Taxable interest to Form 1040 line 2b', b.l4, { total: true }),
      ...b.divRows.map((x, i) => row('B.5.' + i, '5', x.payer, x.amount)),
      row('B.6', '6', 'Ordinary dividends to Form 1040 line 3b', b.l6, { total: true }),
    ];
    S.schC = [
      row('C.1', '1', 'Gross receipts or sales', c.l1, { input: 'schC.gross' }),
      row('C.2', '2', 'Returns and allowances', c.l2, { input: 'schC.returns' }),
      row('C.3', '3', 'Line 1 less line 2', c.l3),
      row('C.4', '4', 'Cost of goods sold', c.l4, { input: 'schC.cogs' }),
      row('C.5', '5', 'Gross profit', c.l5),
      row('C.6', '6', 'Other income', c.l6, { input: 'schC.otherIncome' }),
      row('C.7', '7', 'Gross income', c.l7),
      ...d.schC.expenses.map((x, i) => row('C.e' + i, x.line, x.desc, n(x.amount), { input: 'schC.expenses.' + i + '.amount', note: x.note || '' })),
      row('C.28', '28', 'Total expenses', c.l28),
      row('C.29', '29', 'Tentative profit', c.l29),
      row('C.30', '30', 'Business use of home', c.l30, { input: 'schC.homeOffice' }),
      row('C.31', '31', 'Net profit to Schedule 1 line 3 and Schedule SE', c.l31, { total: true }),
    ];
    S.schD = [
      ...v.sales.map((s, i) => row('D.s' + i, s.term, s.desc + ' (1099-B)', s.gain)),
      row('D.k1st', 'ST', 'K-1 short-term capital gain', dd.stK1),
      row('D.st', '7', 'Short-term subtotal', dd.st, { total: true }),
      row('D.cgd', '13', 'Capital gain distributions (1099-DIV)', dd.cgd),
      row('D.k1lt', 'LT', 'K-1 long-term capital gain', dd.ltK1),
      row('D.lt', '15', 'Long-term subtotal', dd.lt, { total: true }),
      row('D.16', '16', 'Schedule D line 16 to Form 1040 line 7a', dd.l16, { total: true }),
    ];
    S.schE = [
      ...schE.rows.map((r, i) => row('E.r' + i, r.type, r.name + ': net ' + fmt(r.net) + (r.palAdj ? ', PAL adj. ' + fmt(r.palAdj) : ''), r.allowed)),
      row('E.k1', 'K-1', 'Partnership / S corp / trust K-1 allowed total', schE.k1),
      row('E.tot', '26/41', 'Schedule E total to Schedule 1 line 5', schE.total, { total: true }),
    ];
    S.f8582 = [
      row('P.1a', '1a', 'Passive rental real estate income', pal.l1a, { input: 'pal.rreIncome' }),
      row('P.1b', '1b', 'Passive rental real estate current loss', pal.l1b),
      row('P.1c', '1c', 'Prior-year unallowed loss', pal.l1c, { input: 'pal.priorUnallowed' }),
      row('P.1d', '1d', 'Total passive rental real estate loss', pal.l1d),
      row('P.3', '3', 'Overall passive loss', pal.l3),
      row('P.4', '4', 'Smaller of line 1d or line 3', pal.l4),
      row('P.5', '5', 'Phase-out threshold', pal.l5, { input: 'pal.threshold' }),
      row('P.6', '6', 'Modified AGI for PAL', pal.l6, { input: 'pal.magi' }),
      row('P.7', '7', 'Line 5 less line 6', pal.l7),
      row('P.8', '8', '50% of line 7, max $25,000', pal.l8),
      row('P.9', '9', 'Special allowance', pal.l9),
      row('P.10', '10', 'Passive activity income', pal.l10, { input: 'pal.passiveIncome' }),
      row('P.11', '11', 'Total losses allowed', pal.l11, { total: true }),
      row('P.susp', '—', 'Suspended rental loss carryforward', pal.suspended),
      ...(v.mode === 'corrected' ? [row('P.ptp', '—', 'PTP loss suspended separately (not on 8582)', pal.ptpSuspended)] : []),
    ];
    S.schSE = [
      row('SE.a', 'A', 'Schedule C net profit', se.a),
      row('SE.b', 'B', 'K-1 self-employment earnings', se.b),
      row('SE.c', 'C', 'Total SE income', se.c),
      row('SE.d', 'D', 'Net earnings factor', se.d, { input: 'se.factor', rate: true }),
      row('SE.e', 'E', 'Net earnings from self-employment', se.e),
      row('SE.f', 'F', 'Social Security wage base', se.f, { input: 'se.wageBase' }),
      row('SE.g', 'G', v.mode === 'corrected' ? 'Owner\'s W-2 Social Security wages (' + d.se.owner + ')' : 'W-2 Social Security wages (both spouses)', se.g),
      row('SE.h', 'H', 'Remaining wage base', se.h),
      row('SE.i', 'I', 'SE tax', se.i),
      row('SE.j', 'J', 'SE tax (rounded) to Schedule 2 line 4', se.j, { total: true }),
      row('SE.k', 'K', 'Deductible half to Schedule 1 line 15', se.k),
    ];
    S.f8995 = [
      row('Q.1', '1', v.mode === 'corrected' ? 'Schedule C QBI (less attributable half SE tax)' : 'Schedule C QBI', q.l1),
      row('Q.2', '2', v.mode === 'corrected' ? 'K-1 QBI (allowed activities, less half SE tax)' : 'K-1 QBI (all rows)', q.l2),
      row('Q.3', '3', 'Qualified business net income', q.l3),
      row('Q.4', '4', 'REIT dividends / PTP income', q.l4, { input: 'qbi.reitPtp' }),
      row('Q.5', '5', 'Tentative 20% QBI component', q.l5),
      row('Q.11', '11', 'Taxable income before QBI deduction', q.l11),
      row('Q.12', '12', 'Qualified dividends plus net capital gain', q.l12),
      row('Q.13', '13', 'Income limitation base', q.l13),
      row('Q.14', '14', '20% of line 13', q.l14),
      row('Q.15', '15', 'QBI deduction to Form 1040 line 13a', q.l15, { total: true }),
    ];
    S.s8812 = [
      row('K.5', '5', 'Child tax credit before limit', k.l5, { input: 'ctcAmount', note: 'per qualifying child' }),
      row('K.7', '7', 'Credit for other dependents', k.l7, { input: 'odcAmount', note: 'per dependent' }),
      ...(v.mode === 'corrected' ? [row('K.ph', '11', 'Phase-out reduction', k.phaseout), row('K.12', '12', 'Credit after phase-out', k.l12), row('K.13', '13', 'Credit limit (tax less Schedule 3 credits)', k.l13)] :
        [row('K.12', '12', 'Total before tax limit (links Form 1040 line 18)', k.l12), row('K.13', '14', 'Tax available (links Form 1040 line 15)', k.l13)]),
      row('K.14', '15', 'Nonrefundable CTC/ODC to Form 1040 line 19', k.nonref, { total: true }),
      row('K.earn', '18a', 'Earned income', k.earned),
      row('K.20', '20', '15% of earned income over $2,500', k.l20),
      row('K.27', '27', 'Additional child tax credit to Form 1040 line 28', k.actc, { total: true }),
    ];
    S.sch1 = [
      row('1.1', '1', 'Taxable state refund', s1.l1, { input: 'other.stateRefund' }),
      row('1.2a', '2a', 'Alimony received', s1.l2a, { input: 'sch1.alimony' }),
      row('1.3', '3', 'Business income (Schedule C)', s1.l3),
      row('1.4', '4', 'Other gains or losses', s1.l4, { input: 'sch1.otherGains' }),
      row('1.5', '5', 'Rental real estate, royalties, K-1s (Schedule E)', s1.l5),
      row('1.6', '6', 'Farm income', s1.l6, { input: 'sch1.farm' }),
      row('1.7', '7', 'Unemployment compensation', s1.l7, { input: 'other.unemployment' }),
      row('1.8b', '8b', 'Gambling winnings', s1.l8b, { input: 'other.gambling' }),
      row('1.9', '9', 'Total other income', s1.l9),
      row('1.10', '10', 'Additional income to Form 1040 line 8', s1.l10, { total: true }),
      row('1.13', '13', 'HSA deduction', s1.l13, { input: 'sch1.hsa' }),
      row('1.15', '15', 'Deductible part of SE tax', s1.l15),
      row('1.16', '16', 'SEP, SIMPLE and qualified plans', s1.l16, { input: 'sch1.sepIra' }),
      row('1.21', '21', 'Student loan interest', s1.l21, { input: 'sch1.studentLoan' }),
      row('1.25', '25', 'Other adjustments', s1.l25, { input: 'sch1.otherAdj' }),
      row('1.26', '26', 'Adjustments to Form 1040 line 10', s1.l26, { total: true }),
    ];
    S.sch2 = [
      row('2.1z', '1z', 'Other additions to tax', s2.l1z, { input: 'sch2.otherAdditions' }),
      row('2.2', '2', 'Alternative minimum tax', s2.l2, { input: 'sch2.amt' }),
      row('2.3', '3', 'Part I total to Form 1040 line 17', s2.l3, { total: true }),
      row('2.4', '4', 'Self-employment tax', s2.l4),
      row('2.11', '11', 'Additional Medicare tax', s2.l11, { input: 'sch2.addlMedicare' }),
      row('2.12', '12', 'Net investment income tax', s2.l12, { input: 'sch2.niit', note: 'Engine estimate ' + fmt(s2.niitEngine) }),
      row('2.17z', '17z', 'Other additional taxes', s2.l17z, { input: 'sch2.otherTaxes' }),
      row('2.21', '21', 'Total other taxes to Form 1040 line 23', s2.l21, { total: true }),
    ];
    S.sch3 = [
      row('3.1', '1', 'Foreign tax credit (K-1)', s3.l1),
      row('3.2', '2', 'Child and dependent care credit', s3.l2, { input: 'sch3.childCare' }),
      row('3.3', '3', 'Education credits', s3.l3, { input: 'other.educationCredit' }),
      row('3.4', '4', 'Retirement savings credit', s3.l4, { input: 'sch3.retirementSavers' }),
      row('3.5', '5a/5b', 'Residential energy credits', s3.l5, { input: 'sch3.energy' }),
      row('3.7', '7', 'Other nonrefundable credits', s3.l7, { input: 'sch3.otherNonref' }),
      row('3.8', '8', 'Nonrefundable credits to Form 1040 line 20', s3.l8, { total: true }),
      row('3.9', '9', 'Net premium tax credit', s3.l9, { input: 'sch3.ptc' }),
      row('3.10', '10', 'Paid with extension', s3.l10, { input: 'other.extensionPayment' }),
      row('3.11', '11', 'Excess Social Security withheld', s3.l11, { input: 'sch3.excessSS' }),
      row('3.12', '12', 'Federal fuel tax credit', s3.l12, { input: 'sch3.fuel' }),
      row('3.14', '14', 'Other refundable credits', s3.l14, { input: 'sch3.otherRefundable' }),
      row('3.15', '15', 'Other payments to Form 1040 line 31', s3.l15, { total: true }),
    ];
    S.taxCalc = [
      row('T.ti', '15', 'Taxable income', f.l15),
      row('T.qd', '3a', 'Qualified dividends', f.l3a),
      row('T.ncg', 'D', 'Net capital gain', dd.ncg),
      row('T.sw', '16', 'Tax per software / QD&CG worksheet', tax.software, { input: 'taxCalc.softwareTax' }),
      row('T.eng', '—', 'Engine check: 2025 MFJ brackets with QD&CG worksheet', tax.engine, { note: 'Difference ' + fmt(tax.software - tax.engine) }),
      row('T.pen', '38', 'Estimated tax penalty', tax.penalty, { input: 'taxCalc.penalty' }),
    ];
    const L = (key, line, desc, value, src, input) => row('F.' + line, line, desc, value, { src, input });
    S.f1040 = [
      L('', '1a', 'Total W-2 wages', f.l1a, 'W-2s'),
      L('', '1b', 'Household employee wages', f.l1b, 'Input', 'misc.l1b'),
      L('', '1c', 'Tip income not on line 1a', f.l1c, 'Input', 'misc.l1c'),
      L('', '1d', 'Medicaid waiver payments', f.l1d, 'Input', 'misc.l1d'),
      L('', '1e', 'Taxable dependent care benefits', f.l1e, 'Input', 'misc.l1e'),
      L('', '1f', 'Employer adoption benefits', f.l1f, 'Input', 'misc.l1f'),
      L('', '1g', 'Wages from Form 8919', f.l1g, 'Input', 'misc.l1g'),
      L('', '1h', 'Other earned income', f.l1h, 'Input', 'misc.l1h'),
      L('', '1z', 'Add lines 1a through 1h', f.l1z, 'Formula'),
      L('', '2a', 'Tax-exempt interest', f.l2a, '1099-INT'),
      L('', '2b', 'Taxable interest', f.l2b, 'Schedule B'),
      L('', '3a', 'Qualified dividends', f.l3a, '1099-DIV / K-1'),
      L('', '3b', 'Ordinary dividends', f.l3b, 'Schedule B'),
      L('', '4b', 'Taxable IRA distributions', f.l4b, 'Input', 'misc.l4b'),
      L('', '5b', 'Taxable pensions and annuities', f.l5b, 'Input', 'misc.l5b'),
      L('', '6b', 'Taxable Social Security', f.l6b, 'Input', 'misc.l6b'),
      L('', '7a', 'Capital gain or loss', f.l7a, 'Schedule D'),
      L('', '8', 'Additional income (Schedule 1 line 10)', f.l8, 'Schedule 1'),
      L('', '9', 'Total income', f.l9, 'Formula'),
      L('', '10', 'Adjustments (Schedule 1 line 26)', f.l10, 'Schedule 1'),
      L('', '11a', 'Adjusted gross income', f.l11a, 'Formula'),
      L('', '12e', 'Standard or itemized deduction', f.l12e, 'Schedule A'),
      L('', '13a', 'QBI deduction', f.l13a, 'Form 8995'),
      L('', '13b', 'Schedule 1-A deductions', f.l13b, 'Input', 'misc.l13b'),
      L('', '14', 'Total deductions', f.l14, 'Formula'),
      L('', '15', 'Taxable income', f.l15, 'Formula'),
      L('', '16', 'Tax', f.l16, tax.source === 'engine' ? 'Engine' : 'Tax calc'),
      L('', '17', 'Schedule 2 line 3', f.l17, 'Schedule 2'),
      L('', '18', 'Add lines 16 and 17', f.l18, 'Formula'),
      L('', '19', 'Child tax credit / ODC', f.l19, 'Schedule 8812'),
      L('', '20', 'Schedule 3 line 8', f.l20, 'Schedule 3'),
      L('', '21', 'Total credits', f.l21, 'Formula'),
      L('', '22', 'Tax less credits', f.l22, 'Formula'),
      L('', '23', 'Other taxes (Schedule 2 line 21)', f.l23, 'Schedule 2'),
      L('', '24', 'Total tax', f.l24, 'Formula'),
      L('', '25a', 'Withholding from W-2', f.l25a, 'W-2s'),
      L('', '25b', 'Withholding from 1099', f.l25b, '1099s'),
      L('', '25c', 'Other withholding', f.l25c, 'Input', 'misc.l25c'),
      L('', '25d', 'Total withholding', f.l25d, 'Formula'),
      L('', '26', 'Estimated tax payments', f.l26, 'Source docs', 'other.estPayments'),
      L('', '27a', 'Earned income credit', f.l27a, 'Input', 'misc.l27a'),
      L('', '28', 'Additional child tax credit', f.l28, 'Schedule 8812'),
      L('', '29', 'American opportunity credit', f.l29, 'Input', 'misc.l29'),
      L('', '30', 'Refundable adoption credit', f.l30, 'Input', 'misc.l30'),
      L('', '31', 'Schedule 3 line 15', f.l31, 'Schedule 3'),
      L('', '32', 'Other payments and refundable credits', f.l32, 'Formula'),
      L('', '33', 'Total payments', f.l33, 'Formula'),
      L('', '34', 'Overpayment', f.l34, 'Formula'),
      L('', '35a', 'Refund', f.l35a, 'Formula'),
      L('', '36', 'Applied to 2026 estimated tax', f.l36, 'Input', 'misc.l36'),
      L('', '37', 'Amount owed', f.l37, 'Formula'),
      L('', '38', 'Estimated tax penalty', f.l38, 'Tax calc'),
    ];
    S.control = [
      row('X.w2', 'W-2', 'W-2 wages', f.l1a, { ref: 'F.1a' }),
      row('X.int', 'B', 'Taxable interest', f.l2b, { ref: 'F.2b' }),
      row('X.div', 'B', 'Ordinary dividends', f.l3b, { ref: 'F.3b' }),
      row('X.cg', 'D', 'Capital gains', f.l7a, { ref: 'F.7a' }),
      row('X.c', 'C', 'Schedule C net profit', c.l31, { ref: 'C.31' }),
      row('X.e', 'E', 'Schedule E / K-1', schE.total, { ref: 'E.tot' }),
      row('X.a', 'A', 'Deduction taken', a.l12e, { ref: 'A.12e' }),
      row('X.q', '8995', 'QBI deduction', q.l15, { ref: 'Q.15' }),
      row('X.tax', '24', 'Total tax', f.l24, { ref: 'F.24' }),
      row('X.pay', '33', 'Total payments', f.l33, { ref: 'F.33' }),
      row('X.net', '35a/37', 'Refund (+) or amount owed (−)', f.l35a - f.l37, { ref: null }),
    ];
    return S;
  };

  // Compare workpaper against return/software: default software figure = workbook as-built amount
  E.tieOut = function (d, res, asBuilt, tolerance) {
    const tol = n(tolerance);
    const out = {};
    let variances = 0;
    const flat = {};
    Object.values(asBuilt.schedules).forEach((rows) => rows.forEach((r) => { flat[r.key] = r.value; }));
    Object.entries(res.schedules).forEach(([sched, rows]) => {
      out[sched] = rows.map((r) => {
        const override = d.returnAmounts && d.returnAmounts[r.key];
        const has = override !== undefined && override !== null && override !== '';
        let ret;
        if (has) ret = n(override);
        else if (r.key === 'X.net') ret = asBuilt.f.l35a - asBuilt.f.l37;
        else if (r.ref) ret = flat[r.ref];
        else ret = r.key in flat ? flat[r.key] : r.value;
        const variance = r.value - ret;
        const ok = Math.abs(variance) <= tol;
        if (!ok) variances++;
        return Object.assign({}, r, { ret, retOverride: has, variance, ok });
      });
    });
    return { rows: out, variances };
  };

  E.w1040Findings = function (d, opt) {
    const wb = E.calc1040(d, 'workbook', opt), c = E.calc1040(d, 'corrected', opt);
    const f = [];
    const add = (o) => f.push(Object.assign({ module: 'w1040' }, o));
    const condo = (x) => x.schE.rows.find((r) => r.type === 'Rental') || { allowed: 0, palAdj: 0, net: 0 };
    add({ id: 'W1', severity: 'high', title: 'Schedule E drops all K-1 income',
      detail: 'Sch_E_Rental_Royalty!C6 links K1_Input!T8, the "Basis available?" text column, which sums to zero. The allowed K-1 amount is ' + fmt(c.kt.allowed) + ' (K1_Input!U8).',
      impact: c.schE.k1 - wb.schE.k1, line: 'Schedule E / Schedule 1 line 5' });
    add({ id: 'W2', severity: 'high', title: 'Passive loss adjustment adds the special allowance instead of the disallowed loss',
      detail: 'Sch_E!O4 links Form_8582_PAL!C13 (line 8). It should add back the loss that 8582 disallows. With MAGI above $150,000 the allowance is zero, so the ' + fmt(-condo(wb).net) + ' condo loss is suspended, not deducted.',
      impact: condo(c).allowed - condo(wb).allowed, line: 'Schedule E rental' });
    add({ id: 'W3', severity: 'medium', title: 'PTP loss is pooled with rental real estate on Form 8582',
      detail: 'Green Solar Fund LP is a publicly traded partnership. PTP losses are tracked per partnership and only offset income from that PTP, so its ' + fmt(6000) + ' loss belongs outside the 8582 rental-real-estate lines.',
      impact: null, line: 'Form 8582 line 1b' });
    const agi = c.f.l11b;
    if (Math.abs(n(d.pal.magi) - agi) > 5000) {
      add({ id: 'W4', severity: 'medium', title: 'Form 8582 MAGI is a typed input that does not tie to AGI',
        detail: 'MAGI is entered as ' + fmt(d.pal.magi) + '. Computed AGI is ' + fmt(agi) + ' (corrected) and ' + fmt(wb.f.l11b) + ' (as built). Recompute MAGI from AGI before relying on the special allowance.', impact: null, line: 'Form 8582 line 6' });
    }
    add({ id: 'W5', severity: 'high', title: 'SE tax uses both spouses\' W-2 wages against one wage base',
      detail: 'Schedule_SE!C10 links total W-2 Social Security wages of ' + fmt(wb.se.g) + '. Schedule SE is figured separately for the spouse who has the self-employment income; ' + d.se.owner + ' has ' + fmt(c.se.g) + ' of W-2 wages, which leaves ' + fmt(c.se.h) + ' of wage base for the 12.4% tax. Change the owner on the Schedule SE tab if Jordan runs the business.',
      impact: c.se.j - wb.se.j, line: 'Schedule 2 line 4' });
    add({ id: 'W6', severity: 'high', title: 'Schedule 8812 drops the child tax credit',
      detail: 'Schedule_8812_CTC!C11 is MIN(ODC total, line 18), so only the ' + fmt(wb.k.l7) + ' ODC reaches Form 1040 line 19 and the ' + fmt(wb.k.l5) + ' CTC is lost. The same cell then feeds a refundable ACTC of ' + fmt(wb.k.actc) + ', which is not allowed when the credit is fully used against tax.',
      impact: (c.f.l19 + c.f.l28) - (wb.f.l19 + wb.f.l28), line: 'Form 1040 lines 19 and 28' });
    add({ id: 'W7', severity: 'medium', title: 'Form 8995 line 12 links the wrong 1040 line',
      detail: 'Form_8995_QBI!C10 uses Form_1040_Tie_Out!C7 (line 1d, Medicaid waiver payments) instead of line 3a qualified dividends. Qualified dividends are left out of the income limitation.',
      impact: null, line: 'Form 8995 line 12' });
    add({ id: 'W8', severity: 'medium', title: 'QBI is not reduced for the deductible part of SE tax',
      detail: 'Reg. §1.199A-3(b)(1)(vi) reduces QBI by the SE tax deduction attributable to the business. The workbook also counts the suspended ' + fmt(6000) + ' PTP loss in QBI.',
      impact: c.q.l15 - wb.q.l15, line: 'Form 1040 line 13a' });
    add({ id: 'W9', severity: 'medium', title: 'K-1 portfolio income never reaches Schedule B, line 3a or Schedule A',
      detail: 'K-1 interest ' + fmt(c.kt.interest) + ', ordinary dividends ' + fmt(c.kt.ordDiv) + ' (qualified ' + fmt(c.kt.qualDiv) + ') and charitable contributions ' + fmt(c.kt.charity) + ' are computed on K1_Input but not linked forward.',
      impact: (c.f.l2b + c.f.l3b) - (wb.f.l2b + wb.f.l3b), line: 'Form 1040 lines 2b and 3b' });
    add({ id: 'W10', severity: wb.s2.niitEngine < 1 && n(d.sch2.niit) > 0 ? 'medium' : 'info', title: 'NIIT is a typed input',
      detail: 'Schedule 2 line 12 is entered as ' + fmt(d.sch2.niit) + '. The engine estimates ' + fmt(wb.s2.niitEngine) + ' on the as-built figures (AGI ' + fmt(wb.f.l11b) + ' against the $250,000 threshold) and ' + fmt(c.s2.niitEngine) + ' after corrections. Tie it to Form 8960.',
      impact: null, line: 'Schedule 2 line 12' });
    add({ id: 'W11', severity: Math.abs(c.tax.software - c.tax.engine) > 100 ? 'medium' : 'info', title: 'Line 16 tax is a typed input',
      detail: 'Tax is entered as ' + fmt(d.taxCalc.softwareTax) + '. On the corrected taxable income of ' + fmt(c.f.l15) + ' the 2025 MFJ rates with the QD&CG worksheet give ' + fmt(c.tax.engine) + ' (as built: ' + fmt(wb.tax.engine) + ' on ' + fmt(wb.f.l15) + '). Update it from the software once the corrections are posted, or switch line 16 to the engine in Settings.',
      impact: null, line: 'Form 1040 line 16' });
    add({ id: 'W12', severity: 'low', title: 'Control dashboard rows point at the wrong lines',
      detail: 'In the workbook, "Total tax" shows the QBI deduction, "Total payments" shows total tax, and "Refund / amount owed net" shows total payments. The app\'s control panel uses the correct lines.', impact: null, line: 'Control_Dashboard' });
    add({ id: 'W13', severity: 'low', title: 'Open-item counter counts blank rows',
      detail: 'COUNTIF(Open_Items!J4:J33,"<>Closed") counts the 27 empty rows as open, so the review sign-off can never show "Ready". The app counts only logged items.', impact: null, line: 'Review_Signoff' });
    add({ id: 'W14', severity: 'low', title: 'Schedule D reads only the first K-1\'s short-term gain',
      detail: 'Sch_D_8949!G5 links K1_Input!L4 rather than the L8 total. It matches today because only one K-1 has short-term gain.', impact: c.dd.stK1 - wb.dd.stK1, line: 'Schedule D' });
    const netDelta = c.net - wb.net;
    return { findings: f, asBuilt: wb, corrected: c, netDelta };
  };

  /* ================================================================== *
   * Planning: scenarios on the 1040 and a next-year projection
   * ================================================================== */
  const cloneD = (o) => JSON.parse(JSON.stringify(o));
  E.LEVERS = [
    { key: 'sepIra', label: 'SEP-IRA contribution', hint: 'Deductible on Schedule 1 line 16; limit about 20% of net self-employment earnings' },
    { key: 'hsa', label: 'HSA contribution (total)', hint: 'Family limit $8,550 for 2025, $8,750 for 2026', absolute: true },
    { key: 'charity', label: 'Additional cash gifts to charity', hint: 'Added to Schedule A line 11' },
    { key: 'harvest', label: 'Capital losses harvested', hint: 'Net capital loss above $3,000 carries forward' },
    { key: 'roth', label: 'Roth conversion', hint: 'Taxable IRA distribution on line 4b' },
    { key: 'schCExpense', label: 'Additional business expense', hint: 'For example §179 equipment on Schedule C' },
    { key: 'extraEst', label: 'Additional estimated payments', hint: 'Changes the balance due, not the tax' },
  ];
  // Roll a return forward one year: grow income, apply that year's parameters
  E.project1040 = function (d, year, growth) {
    const x = cloneD(d); const g = 1 + n(growth); const P = TAXP[year] || TAXP[2025];
    const grow = (o, keys) => keys.forEach((k) => { if (o[k] != null) o[k] = Math.round(n(o[k]) * g); });
    x.w2.forEach((w) => grow(w, ['wages', 'fedwh', 'ssWages', 'ssTax', 'medWages', 'medTax', 'stateWages', 'stateWh']));
    x.interest.forEach((i) => grow(i, ['taxable', 'exempt']));
    x.dividends.forEach((i) => grow(i, ['ordinary', 'qualified', 'capGainDist']));
    x.sales.forEach((i) => grow(i, ['proceeds', 'basis']));
    grow(x.schC, ['gross']); x.schC.expenses.forEach((e) => grow(e, ['amount']));
    x.schE.forEach((e) => grow(e, ['gross']));
    x.k1.forEach((k) => grow(k, ['box1', 'interest', 'ordDiv', 'qualDiv', 'stcg', 'ltcg', 'qbi', 'se']));
    x.schA.standard = P.standard; x.schA.saltCap = P.saltCap; x.se.wageBase = P.wageBase; x.ctcAmount = P.ctc; x.actcMax = P.actc;
    x.deps.forEach((dp) => { dp.age = n(dp.age) + 1; if (dp.age >= 17) { dp.ctc = false; dp.odc = true; } });
    x.other.stateRefund = 0; x.other.extensionPayment = 0; x.pal.magi = 0;
    return x;
  };
  E.applyLevers = function (d, lv) {
    const x = cloneD(d); lv = lv || {};
    x.sch1.sepIra = n(x.sch1.sepIra) + n(lv.sepIra);
    if (lv.hsa !== undefined && lv.hsa !== null && lv.hsa !== '') x.sch1.hsa = n(lv.hsa);
    x.other.cashCharity = n(x.other.cashCharity) + n(lv.charity);
    x.misc.l4b = n(x.misc.l4b) + n(lv.roth);
    if (n(lv.harvest)) x.sales.push({ desc: 'Scenario: harvested losses', term: 'Long-term', proceeds: 0, basis: n(lv.harvest), adj: 0 });
    if (n(lv.schCExpense)) x.schC.expenses.push({ line: '27a', desc: 'Scenario: additional expense', amount: n(lv.schCExpense) });
    x.other.estPayments = n(x.other.estPayments) + n(lv.extraEst);
    return x;
  };
  E.scenario1040 = function (d, lv, year) {
    const opt = { taxSource: 'engine', niitSource: 'engine', year: year || 2025 };
    const x = E.applyLevers(d, lv);
    const v = E.calc1040(x, 'corrected', opt);
    const bump = cloneD(x); bump.sch1.otherGains = n(bump.sch1.otherGains) + 1000;
    const vb = E.calc1040(bump, 'corrected', opt);
    const cash = n(lv && lv.sepIra) + n(lv && lv.charity) + n(lv && lv.schCExpense) + Math.max(0, n(lv && lv.hsa) - n(d.sch1.hsa)) * (lv && lv.hsa != null && lv.hsa !== '' ? 1 : 0);
    const sepMax = Math.max(0, 0.2 * (v.se.a * n(x.se.factor) - v.se.k * (v.se.c ? v.se.a / v.se.c : 0)));
    return { v, marginal: (vb.f.l24 - v.f.l24) / 1000, cash, sepMax, year: year || 2025 };
  };
  // Safe-harbor estimates for the next year (IRC §6654(d)(1)(B), (C))
  E.safeHarbor = function (priorTax, priorAgi, projTax, withholding, paid) {
    const pct = n(priorAgi) > 150000 ? 1.10 : 1.00;
    const prior = n(priorTax) * pct, current = 0.9 * n(projTax);
    const required = Math.min(prior, current);
    const fromEst = Math.max(0, required - n(withholding));
    return { pct, prior, current, required, basis: prior <= current ? 'prior' : 'current', fromEst, quarter: fromEst / 4, remaining: Math.max(0, fromEst - n(paid)) };
  };

  /* ================================================================== *
   * Compliance: filing calendar
   * ================================================================== */
  const FORM_RULES = [
    { re: /Form 709/, form: 'Form 709', title: 'Gift and GST tax return for 2026 gifts', due: '2027-04-15', ext: '2027-10-15' },
    { re: /Form 8283/, form: 'Form 8283', title: 'Noncash charitable contributions, attached to the 2026 Form 1040', due: '2027-04-15', ext: '2027-10-15' },
    { re: /Form 990-PF/, form: 'Form 990-PF', title: 'Private foundation return', due: '2027-05-17', ext: '2027-11-15' },
    { re: /Form 4720/, form: 'Form 4720', title: 'Private foundation excise taxes', due: '2027-05-17', ext: '2027-11-15' },
    { re: /Form 5227/, form: 'Form 5227', title: 'Split-interest trust information return', due: '2027-04-15', ext: '2027-10-15' },
    { re: /Form 1099-R/, form: 'Form 1099-R', title: 'Report QCD on Form 1040 lines 4a/4b', due: '2027-04-15', ext: '2027-10-15' },
    { re: /Form 6251/, form: 'Form 6251', title: 'Alternative minimum tax, with the 2026 Form 1040', due: '2027-04-15', ext: '2027-10-15' },
    { re: /Form 6252/, form: 'Form 6252', title: 'Installment sale income, with the 2026 Form 1040', due: '2027-04-15', ext: '2027-10-15' },
    { re: /Form 8824/, form: 'Form 8824', title: 'Like-kind exchange, with the 2026 Form 1040', due: '2027-04-15', ext: '2027-10-15' },
    { re: /Form 8997/, form: 'Form 8997', title: 'Qualified Opportunity Fund investments', due: '2027-04-15', ext: '2027-10-15' },
    { re: /Form 8949/, form: 'Form 8949', title: 'Sales and deferral elections, with Schedule D', due: '2027-04-15', ext: '2027-10-15' },
    { re: /Form 8854/, form: 'Form 8854', title: 'Expatriation statement', due: '2027-04-15', ext: '2027-10-15' },
    { re: /3520-A/, form: 'Form 3520-A', title: 'Foreign trust with U.S. owner', due: '2027-03-15', ext: '2027-09-15' },
    { re: /3520/, form: 'Form 3520', title: 'Foreign trust transactions and gifts', due: '2027-04-15', ext: '2027-10-15' },
    { re: /5471/, form: 'Form 5471', title: 'Controlled foreign corporation information', due: '2027-04-15', ext: '2027-10-15' },
    { re: /8621/, form: 'Form 8621', title: 'PFIC annual information', due: '2027-04-15', ext: '2027-10-15' },
    { re: /8938/, form: 'Form 8938', title: 'Specified foreign financial assets', due: '2027-04-15', ext: '2027-10-15' },
    { re: /FBAR/, form: 'FinCEN 114', title: 'Report of foreign bank accounts (FBAR)', due: '2027-04-15', ext: '2027-10-15' },
    { re: /Form 706/, form: 'Form 706', title: 'Estate tax return, nine months after death', due: null, event: 'At death' },
    { re: /Forms? 8288/, form: 'Form 8288', title: 'FIRPTA withholding, within 20 days of the transfer', due: null, event: 'At closing' },
  ];
  E.calendar = function (data, res, today) {
    const t0 = today ? new Date(today) : new Date();
    const items = [];
    const add = (o) => items.push(Object.assign({ status: (data.calendar && data.calendar[o.id]) || 'Not started' }, o));
    const w = data.w1040; const cor = res.w1040;
    const extended = n(w.other.extensionPayment) > 0;
    add({ id: 'riv-1040', client: 'Rivera', form: 'Form 1040', title: 'TY2025 individual return' + (extended ? ' (on extension)' : ''), due: extended ? '2026-10-15' : '2026-04-15',
      source: 'Compliance workpaper', note: cor.openHigh ? cor.openHigh + ' high findings open on the workpaper' : 'Workpaper clear of high findings', view: 'w-tie' });
    if (res.safeHarbor) add({ id: 'riv-es4', client: 'Rivera', form: 'Form 1040-ES', title: '2026 estimated tax, fourth installment', due: '2027-01-15', amount: res.safeHarbor.quarter, source: 'Planning: safe harbor', view: 'p-rivera' });
    add({ id: 'doe-1065', client: 'Doe', form: 'Form 1065', title: 'JD Rental Holdings LLC partnership return with §199A aggregation statement on each K-1', due: '2027-03-15', ext: '2027-09-15', source: 'Rental HoldCo', view: 'r-statements' });
    if (res.rental.rep.pass) add({ id: 'doe-469', client: 'Doe', form: '§469(c)(7)(A) statement', title: 'Election to aggregate rental real estate, attached to the timely filed original 2026 return', due: '2027-04-15', ext: '2027-10-15', source: 'Rental HoldCo', view: 'r-statements' });
    add({ id: 'doe-1040', client: 'Doe', form: 'Form 1040', title: 'TY2026 individual return', due: '2027-04-15', ext: '2027-10-15', source: 'Doe household', view: 'r-199a' });
    add({ id: 'doe-es4', client: 'Doe', form: 'Form 1040-ES', title: '2026 estimated tax, fourth installment', due: '2027-01-15', source: 'Doe household', view: 'r-199a' });
    const sel = data.hnwi.strategies.filter((s) => s.selected);
    FORM_RULES.forEach((r) => {
      const hits = sel.filter((s) => data.hnwi.checklist.some((c) => c.no === s.no && r.re.test(String(c.docs))));
      if (!hits.length) return;
      add({ id: 'doe-' + r.form.replace(/\W+/g, ''), client: 'Doe', form: r.form, title: r.title, due: r.due, ext: r.ext, event: r.event, source: 'Strategies ' + hits.map((s) => '#' + s.no).join(', '), strategies: hits.map((s) => s.no), view: 'h-check' });
    });
    items.forEach((it) => {
      it.days = it.due ? Math.round((new Date(it.due + 'T12:00:00') - t0) / 86400000) : null;
      it.state = it.status === 'Filed' || it.status === 'N/A' ? 'done' : it.days == null ? 'event' : it.days < 0 ? 'overdue' : it.days <= 30 ? 'soon' : 'later';
    });
    items.sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0);
    return items;
  };

  function fmt(v) {
    v = n(v); const s = Math.abs(Math.round(v)).toLocaleString('en-US');
    return (v < -0.5 ? '−$' : '$') + s;
  }
  function fmtN(v) { return Math.round(n(v)).toLocaleString('en-US'); }
  E.fmt = fmt; E.fmtN = fmtN;

  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  else root.Engine = E;
})(typeof window !== 'undefined' ? window : globalThis);
