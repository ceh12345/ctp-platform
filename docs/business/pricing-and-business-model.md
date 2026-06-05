# Decision Record: CTP Pricing & Business Model

Generated from a working session on 2026-06-05
Branch: main
Repo: ceh12345/ctp-platform
Status: DECIDED (first pass)
Mode: Startup
Related: target-market-and-gtm.md (target-market / GTM session — read that first)

## Why this doc exists
Companion to the target-market design doc. That doc decided *who* to sell to
(HMLV make-to-order shops, Stafford as proof, clone-hunt motion). This doc records
*how to package and price* it, and the artifact built to support pricing
conversations. Kept as a record of the discussion, not just the conclusion.

## The two questions on the table
1. How do we set the subscription rate / value of the software per client?
2. Subscription vs. "lease the code and let clients make their own modifications"?
   Wrapped in a thesis: "SaaS may be a thing of the past with AI."

## Decision 1 — Pricing method: value-based, anchored to the pain number
- **Do not price on cost.** Price on the dollar value CTP removes. For this niche the
  pain is already in dollars: late-delivery penalties, expediting/air-freight,
  schedule-driven overtime, planner hours, lost margin from missed capacity.
- **Capture ~1/4 to 1/3 of the value created.** If CTP saves a shop $150k/yr and you
  charge $40k, that is a ~3-4x customer ROI: easy yes for them, real margin for you.
- **Anchor to a countable unit that correlates with value: per site / plant**, tiered
  by size (work centers / resources or throughput). Avoid per-seat pricing — value is
  per-plant, not per-user; one planner using CTP saves the whole site.
- **Annual contracts, not monthly.** Manufacturers budget yearly; lowers churn; gives a
  solo founder predictable cash.
- **Indicative band (solo, SMB/mid-market vertical tool):** ~$18k–$60k ACV per site.
  Not $99/mo SaaS, not $2M enterprise.
- **Stafford = founding-customer rate.** Discount in exchange for written case study,
  reference call, and logo rights. Stafford's real job is the proof number.
- **Hard dependency:** the exact price can't be set until Stafford's penalty number
  exists. That number sets the value V; V sets the price. (Ties to the value-driver:
  late-fee avoidance.)

## Decision 2 — Business model: frozen central code + subscription
**Rejected: leasing modifiable code to clients.** For a solo founder this is fatal:
- The moat is the **engine** (constraint propagation, scheduling solvers), not the app.
  A job-shop owner will not (and does not want to) vibe-code an HMLV solver. AI does not
  commoditize that.
- Shipping modifiable code forks the product into N versions one person cannot maintain,
  destroys the compounding of a single codebase, and leaks the IP two ERP vendors valued
  at ~$2M.
- One-time license = a treadmill: paid once, owe support/updates forever, no recurring
  income.

**Accepted: the half-truth in the AI thesis.** AI makes *customization* cheap and
therefore *expected*. Capture that WITHOUT surrendering code:
- Use AI in **your own delivery pipeline** — fast tenant onboarding, ETL/MappingEngine
  config, custom rules/constraints as **data, not forks**. Client feels it's "theirs";
  you keep one codebase. (Architecture already leans this way: ETL transforms upstream,
  engine reads uniform CTP-shape data across tenants.)
- For data-paranoid manufacturers, offer **single-tenant / on-prem / VPC-isolated
  deployment** as a **paid upgrade** — "subscription with isolation," not source access.

**"Is SaaS dead with AI?" — reframed.** What AI kills is thin, undifferentiated,
easily-cloned horizontal SaaS. What survives (and matters more for a solo founder) is
**differentiated vertical IP on recurring revenue.** CTP is that. The *delivery
mechanic* (multi-tenant cloud) may flex to on-prem; the *business model* (recurring
payment for ongoing value) is the only thing that makes a one-person software company
viable. Don't confuse cloud delivery with the subscription model — AI pressures the
first, not the second.

**One legitimate exception (kept separate):** licensing the **engine** to an **ERP
vendor** to embed (the SysPro/QAD/$2M motion) is real code-licensing — but to a
*partner under commercial contract*, with you controlling releases, NOT end-clients with
mod rights. This is a phase-2 motion; do not blend it into the end-client subscription.

## Bottom line (decided)
- Price: value-based, ~1/4–1/3 of quantified pain, per-site annual tiers, ~$18k–$60k ACV,
  founding rate for Stafford.
- Model: frozen central codebase, subscription. "Feels custom" via config + AI-assisted
  onboarding, not forks. On-prem isolation as a paid upgrade.
- Engine-licensing to ERP vendors kept as a separate phase-2 motion.

## Artifact built — ROI & Pricing Calculator
- File: `tools/roi-calculator.html` (single self-contained file, no dependencies, opens
  in any browser, prints clean to PDF).
- Committed to main: **49e41ae** (`feat(tools): add ROI & pricing calculator for HMLV
  sales`). Not yet pushed.
- Inputs: a shop's annual pain costs + conservative editable improvement assumptions.
- Outputs: total annual value created, a price band (20/25/33% capture), a
  founding-customer discount line, and a customer-facing "today vs. with CTP" summary
  (net annual benefit + ROI) tuned for a PDF handout.
- Presets: small / mid / large shop tiers (one click).
- Worked example (mid/Stafford-like): ~$86k value → ~$21.6k recommended price → 4.0x
  ROI, ~3-month payback. Founding rate ~$13k.

## Open items
- Get Stafford's real penalty number → set the actual price.
- Confirm whether these buyers demand on-prem (affects packaging + a price upcharge).
- Decide founding-customer terms (discount %, what proof rights you get in return).

## Next steps when ready
- Build a sensitivity view (best/likely/worst) into the calculator.
- Draft founding-customer agreement terms for Stafford.
- Pricing only becomes real after the Stafford number lands.
