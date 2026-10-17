# Known limits

Self-employment income, self-employment tax, and the section 199A QBI deduction are **calculated**. They are not unsupported.

The Tax Master planner computes:

- Schedule SE (Social Security wage-base offset and the Medicare portion)
- the deductible half of self-employment tax (section 164(f))
- Additional Medicare tax where the planner engine includes it
- the section 199A deduction, including the taxable-income limit and a wage / UBIA limit

Do not describe those as out of scope, and do not treat a diagnostic that says they are unsupported as the product boundary. If an older Python build (`engine-0.1.0`) still emits `UNSUP-SE-001`, that diagnostic is stale. It is not a reason to omit the calculation.

## Still not a filed return

These items are outside the current engines. Where an input would make a silent guess dangerous, say so on the line. Do not approximate them.

- State and local income tax returns (SALT is an itemized-deduction input only)
- Refundable additional child tax credit, where the engine computes only the nonrefundable credit
- A full multi-year capital-loss or charitable carryover ledger (the annual limit is applied; the carry is disclosed, not stored as a closed ledger)
- Mortgage acquisition-debt limits
- Education credits, energy credits, the foreign tax credit limitation (Form 1116), and dependent care, except where a specific engine already computes them
- Estimated-tax penalties
- Form 1041 fiduciary income tax, GST tax, and multi-state allocation
- The IRS tax table for taxable income under $100,000 (the formula is used)

A specialist workflow has to use the same engine. If a strategy needs new tax math, the engine grows. The prompt does not.
