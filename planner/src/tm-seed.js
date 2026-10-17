/* Tax Master — demo clients. Both households are fictional.
   Rivera is mapped from the Form 1040 reconciliation workpaper (window.SEED.w1040).
   Doe pulls the rental HoldCo (SEED.rental) plus the example rows of the capital
   transactions, Schedule K-1 and stock-option workbooks. */
(function (root) {
  'use strict';
  function rivera(S) {
    const w = S.w1040;
    const exp = {};
    const map = { 8: 'advertising', 9: 'car', 11: 'contract', 17: 'legal', 18: 'office', 22: 'supplies', '24a': 'travel', '27b': 'other' };
    w.schC.expenses.forEach((e) => { if (e.line === '24b') exp.meals = e.amount * 2; else if (map[e.line]) exp[map[e.line]] = (exp[map[e.line]] || 0) + e.amount; });
    const rentExp = (r) => ({ advertising: r.advertising, auto: r.auto, cleaning: r.cleaning, commissions: r.commissions, insurance: r.insurance, mortgage: r.mortgage, taxes: r.taxes, repairs: r.repairs, depreciation: r.depreciation, other: r.other });
    return {
      id: 'rivera',
      info: { name: 'Rivera household', tpFirst: 'Jordan', tpLast: 'Rivera', tpDob: '1985-04-12', spFirst: 'Casey', spLast: 'Rivera', spDob: '1987-09-30', status: 'mfj', year: 2025, state: 'CO',
        address: '123 Training Lane, Denver, CO 80202', occupation: 'Software engineer / designer', priorTax: 30500, priorAgi: 238000, preparer: 'Training Staff', reviewer: 'Training Manager',
        notes: 'Training household from the Form 1040 reconciliation workpaper. Demo only, not for filing.', baseName: 'TY2025 return' },
      deps: w.deps.map((d) => ({ name: d.name, age: d.age, rel: d.ctc ? 'child' : 'other', ssn: d.ssn })),
      w2: w.w2.map((x) => ({ who: x.who, employer: x.employer, wages: x.wages, ssWages: x.ssWages, fedWh: x.fedwh, stateWh: x.stateWh })),
      other: { stateRefund: w.other.stateRefund, otherIncome: w.other.gambling, hsa: w.sch1.hsa, studentLoan: w.sch1.studentLoan, estimates: w.other.estPayments, extension: w.other.extensionPayment },
      mod: {
        portfolio: { interest: w.interest.map((i) => ({ payer: i.payer, taxable: i.taxable, exempt: i.exempt, treasury: /treasury/i.test(i.payer + i.note), wh: i.wh })),
          dividends: w.dividends.map((d) => ({ payer: d.payer, ordinary: d.ordinary, qualified: d.qualified, capGainDist: d.capGainDist, wh: d.wh })) },
        schC: { businesses: [{ name: 'Casey Rivera Design (sole proprietor)', owner: 'sp', sstb: false, gross: w.schC.gross, returns: w.schC.returns, cogs: w.schC.cogs, otherIncome: w.schC.otherIncome, exp, homeOffice: w.schC.homeOffice, w2Paid: 0, ubia: 0 }], sepIra: 0, seHealth: 0 },
        capital: { invest: w.sales.map((s) => ({ desc: s.desc, kind: 'stock', term: /long/i.test(s.term) ? 'LT' : 'ST', proceeds: s.proceeds, basis: s.basis, adj: s.adj, box: /long/i.test(s.term) ? 'D' : 'A' })), business: [], stCarry: 0, ltCarry: 0, priorNonrecap1231: 0 },
        equity: { iso: [], nso: [], rsu: [], restricted: [], sales: [], amtCreditPrior: 0 },
        rents: { rep: false, properties: w.schE.map((r) => ({ name: r.name, type: r.type === 'Royalty' ? 'royalty' : 'rental', participation: 'active', gross: r.gross, exp: rentExp(r), priorSuspended: 0 })) },
        k1: { entities: w.k1.map((k) => ({ name: k.entity, form: k.form.replace(' PTP', ''), ein: k.ein, ptp: k.ptp, passive: k.passive, sstb: false, box1: k.box1, box2: k.box2, interest: k.interest, ordDiv: k.ordDiv, qualDiv: k.qualDiv, stcg: k.stcg, ltcg: k.ltcg, s179: k.s179, charity: k.charity, ftc: k.ftc, se: k.se, qbi: k.qbi, w2: 0, ubia: 0, distributions: k.distributions })) },
        itemized: { medical: w.schA.medical, stateTax: w.other.stateIncomeTax, realEstateTax: w.other.realEstateTax, persPropTax: w.other.personalPropTax, mortgageInt: w.other.mortgage, charityCash: w.other.cashCharity },
        qbi: { carry: 0 },
      },
      direct: {},
      cols: [
        { id: 'c1', name: 'Fund SEP-IRA', year: 2025, status: 'mfj', ov: {}, lv: { sepIra: 6000 } },
        { id: 'c2', name: 'TY2026 projection', year: 2026, status: 'mfj', ov: {}, lv: {}, growth: 0.03 },
      ],
      scen: { growth: 0.03, scenarios: [{ name: 'Baseline', levers: {} }, { name: 'Fund SEP-IRA', levers: { sepIra: 6000 } }, { name: 'SEP + extra giving', levers: { sepIra: 6000, charity: 6500 } }, { name: 'Harvest losses', levers: { harvest: 20000 } }] },
      notes: {},
    };
  }

  function doe(S) {
    const R = S.rental;
    return {
      id: 'doe',
      info: { name: 'Doe household', tpFirst: 'John', tpLast: 'Doe', tpDob: '1968-02-20', spFirst: 'Jane', spLast: 'Doe', spDob: '1970-07-08', status: 'mfj', year: 2026, state: 'CO',
        address: 'Denver, CO', occupation: 'Technology executive / real estate investor', priorTax: 1050000, priorAgi: 2900000, preparer: '', reviewer: '',
        notes: 'High-net-worth investor: executive equity, rental HoldCo (John qualifies as a real estate professional), private-fund K-1s and 2026 asset sales. Illustrative figures.', baseName: 'HNW investor baseline' },
      deps: [{ name: 'Lily Doe', age: 15, rel: 'child', ssn: true }],
      w2: [{ who: 'John', employer: 'Northpeak Software Inc.', wages: 1758000, ssWages: 184500, fedWh: 420000, stateWh: 77000, note: 'Includes $858,000 of RSU, §83(b) and disqualifying ISO income' }],
      other: { estimates: 380000, extension: 0 },
      mod: {
        portfolio: {
          interest: [{ payer: 'First Western Trust', taxable: 48000 }, { payer: 'U.S. Treasury bills', taxable: 27000, treasury: true }, { payer: 'Colorado municipal bond fund', taxable: 0, exempt: 62000, pab: 9500 }],
          dividends: [{ payer: 'Schwab brokerage', ordinary: 96000, qualified: 84000, capGainDist: 18000, sec199a: 6500, foreignTax: 2100 }, { payer: 'Vanguard Total International', ordinary: 44000, qualified: 36000, foreignTax: 3900 }],
        },
        schC: { businesses: [{ name: 'Board advisory fees (John)', owner: 'tp', sstb: true, gross: 145000, exp: { travel: 9200, legal: 3500, office: 1800 }, homeOffice: 0, w2Paid: 0, ubia: 0 }], sepIra: 0, seHealth: 0 },
        capital: {
          invest: [
            { desc: 'Raw land (investment)', kind: 'realestate', acquired: '2018-03-01', sold: '2026-06-15', proceeds: 150000, sellingExp: 5000, basis: 100000, box: 'F' },
            { desc: 'Artwork (collectible)', kind: 'collectible', acquired: '2020-02-01', sold: '2026-02-15', proceeds: 35000, sellingExp: 1000, basis: 20000, box: 'F', collectible: true, code: 'C' },
            { desc: 'ACME Corp. 1,000 sh', kind: 'stock', acquired: '2021-09-01', sold: '2026-09-15', proceeds: 100000, sellingExp: 1000, basis: 60000, box: 'D' },
            { desc: 'Example Partners LP interest', kind: 'partnership', acquired: '2019-01-01', sold: '2026-07-01', proceeds: 350000, sellingExp: 10000, basis: 200000, sec751: 40000, box: 'F' },
            { desc: 'Tech ETF lot (loss harvest candidate)', kind: 'stock', acquired: '2026-01-10', sold: '2026-11-02', proceeds: 82000, sellingExp: 0, basis: 118000, box: 'A' },
          ],
          business: [
            { desc: 'Machinery (§1245)', type: '1245', acquired: '2022-01-15', sold: '2026-04-30', cost: 80000, depreciation: 60000, proceeds: 50000, sellingExp: 2000 },
            { desc: 'Office building (§1250)', type: '1250', acquired: '2017-05-01', sold: '2026-08-01', cost: 520000, depreciation: 100000, addlDepr: 0, proceeds: 700000, sellingExp: 30000 },
            { desc: '§1231 building sold on a note', type: '1250', acquired: '2015-01-01', sold: '2026-05-01', cost: 250000, depreciation: 50000, proceeds: 500000, sellingExp: 20000, recapture: 50000, installment: true, contractPrice: 400000, principalThisYear: 80000, principalPrior: 0 },
          ],
          stCarry: 0, ltCarry: 0, priorNonrecap1231: 0,
        },
        equity: {
          iso: [
            { lotId: 'Grant 1', grantDate: '2024-01-15', strike: 10, exerciseDate: '2026-03-01', fmvExercise: 55, shares: 20000, saleDate: '', salePrice: '' },
            { lotId: 'Grant 2', grantDate: '2023-07-01', strike: 8, exerciseDate: '2026-01-20', fmvExercise: 40, shares: 10000, saleDate: '2026-09-15', salePrice: 52 },
            { lotId: 'Grant 3', grantDate: '2022-02-01', strike: 6, exerciseDate: '2024-05-01', fmvExercise: 18, shares: 8000, saleDate: '2026-06-10', salePrice: 70 },
          ],
          nso: [], rsu: [{ vestDate: '2026-04-15', shares: 6000, fmvVest: 48, withheld: 2000 }],
          restricted: [{ desc: 'Founder restricted stock', transferDate: '2026-02-01', shares: 25000, pricePaid: 2, fmvTransfer: 12, election83b: true, electionFiled: '2026-02-20' }],
          sales: [], amtCreditPrior: 0,
        },
        rents: {
          rep: true,
          properties: R.properties.map((p) => ({ name: p.name, entity: p.entity, type: 'rental', participation: 'material', material: true, qbiTrade: true, gross: p.rents + p.otherIncome,
            exp: { cleaning: 0, management: p.opex, repairs: p.repairs, taxes: p.taxIns, mortgage: p.interest, depreciation: p.depreciation }, w2: p.wages, ubia: p.ubia, priorSuspended: 0, note: p.notes })),
        },
        k1: { entities: [
          { name: 'Summit Ridge Hospitality, Inc.', form: '1120-S', ein: '84-1234567', passive: false, ptp: false, sstb: false, box1: 210000, interest: 1200, distributions: 150000, qbi: 210000, w2: 160000, ubia: 900000, basisBegin: 400000 },
          { name: 'Doe Capital Partners LP', form: '1065', ein: '84-7654321', passive: true, ptp: false, sstb: false, box1: 85000, interest: 4000, ordDiv: 6000, qualDiv: 5000, ltcg: 22000, sec1231: 0, charity: 2500, ftc: 600, qbi: 85000, w2: 40000, ubia: 300000, distributions: 60000, basisBegin: 250000 },
          { name: 'Midstream Energy Partners (PTP)', form: '1065', ein: '73-1112223', passive: true, ptp: true, sstb: false, box1: -6500, qbi: -6500, distributions: 3200, basisBegin: 18000, priorSuspended: 1800 },
        ] },
        itemized: { stateTax: 99000, realEstateTax: 28000, mortgageInt: 41000, avgDebt: 1100000, charityCash: 150000, charityNoncash: 30000 },
        qbi: { carry: 0 },
      },
      direct: {},
      cols: [
        { id: 'c1', name: 'Planning: max retirement + HSA + harvest', year: 2026, status: 'mfj', ov: {}, lv: { sepIra: 26000, hsa: 9750, harvest: 40000 } },
        { id: 'c2', name: 'Charitable bunching (DAF)', year: 2026, status: 'mfj', ov: {}, lv: { charity: 500000 } },
      ],
      scen: { growth: 0.04, scenarios: [{ name: 'Baseline', levers: {} }, { name: 'Max retirement + HSA', levers: { sepIra: 26000, hsa: 9750 } }, { name: 'Harvest losses', levers: { harvest: 40000 } }, { name: 'DAF bunching', levers: { charity: 500000 } }] },
      notes: {},
    };
  }
  root.TM_DEMO_CLIENTS = (S) => [doe(S), rivera(S)];
})(typeof window !== 'undefined' ? window : globalThis);
