# Scoring Rules Guide

How the scheduling engine decides where to place each task. Each rule scores every candidate placement, the scores are normalized to 0-1, weighted, and blended into a single number. The lowest blended score wins.

---

## How Scoring Works

When the engine evaluates a task, it generates multiple candidate placements — different resources, different time slots, different combinations. Each scoring rule assigns a raw numeric score to every candidate. The engine then:

1. **Normalizes** each rule's raw scores across all candidates to a 0-1 range (min-max normalization)
2. **Applies the objective** — MINIMIZE means 0.0 is best, MAXIMIZE means the score is flipped so higher raw values map to lower (better) normalized scores
3. **Multiplies by the weight** — a rule with weight 0.35 has 3.5× more influence than one with weight 0.10
4. **Sums** all weighted scores into a single blended score per candidate
5. **Picks the lowest** blended score as the winner

Weights must sum to 1.0 (100%). The engine validates this and throws an error if they don't.

---

## The Seven Rules

### 1. EarliestStartTimeScoringRule

**Objective:** MINIMIZE
**What it measures:** How early in the feasible window the task would start.
**How it scores:** Raw score = the proposed start time (epoch seconds). Earlier start = lower score = better.

**What it does to the schedule:** Pushes all tasks as far left on the Gantt as possible. Work starts as soon as resources are available. This naturally front-loads the schedule and builds buffer time before due dates.

**When to use it:**
- Healthcare — get patients through the OR first thing in the morning, don't let ORs sit idle
- Sports scheduling — fill fields starting from the earliest time slots
- Any environment where "start sooner" is generally better than "start later"
- As a secondary rule in job shops — mild preference for starting work early to build safety margin

**When NOT to use it:**
- JIT/lean environments where you deliberately want to delay work to minimize WIP — use LatestStartTime instead
- When it dominates too heavily, it can pack everything into Monday morning and leave Friday empty

**Typical weight:** 0.15–0.50 depending on how strongly you want forward-loading

---

### 2. LatestStartTimeScoringRule

**Objective:** MINIMIZE
**What it measures:** How late in the feasible window the task could start.
**How it scores:** Raw score = the proposed start time. But since MINIMIZE prefers lower values, and this rule is designed to prefer *later* starts, the engine effectively rewards pushing tasks to the right edge of their windows.

**What it does to the schedule:** Delays work as long as possible while still finishing on time. This is the JIT (Just-In-Time) strategy — don't start until you need to. Reduces work-in-process inventory and keeps the schedule flexible for last-minute changes.

**When to use it:**
- Lean manufacturing where WIP reduction is a priority
- Environments where holding finished goods is expensive (perishables, high-value items)
- When combined with DueDate rule — "finish on time but not a minute sooner"

**When NOT to use it:**
- Job shops where you want buffer time before due dates
- Healthcare where idle resources = wasted capacity
- Environments with unreliable equipment — late start + machine breakdown = missed deadline

**Typical weight:** 0.15–0.30. Rarely used as the dominant rule.

**Note:** EarliestStart and LatestStart are mutually exclusive in practice — using both creates conflicting signals. Pick one based on the scheduling philosophy. The `CTPScoring.scheduleEarliest()` method checks which one has weight > 0 to determine the scheduling direction.

---

### 3. WhiteSpaceScoringRule

**Objective:** MAXIMIZE
**What it measures:** How much flexibility remains in the time window after placing the task. Computed as the total span of `lStartW - eStartW` across all feasible start time intervals — the gap between the earliest and latest possible start times.
**How it scores:** More white space = higher raw score. MAXIMIZE objective means higher is better, so the engine prefers placements that preserve the most scheduling flexibility.

**What it does to the schedule:** Makes the solver cautious. Instead of grabbing the "best" slot right now, it prefers slots that leave room for future tasks. It's the "don't paint yourself into a corner" heuristic. If two placements are otherwise equal but one leaves a 4-hour flexible window and the other leaves a 30-minute window, WhiteSpace picks the 4-hour option.

**When to use it:**
- Healthcare — emergency add-on cases need open slots, so preserving white space is critical
- Sports scheduling — rainouts and reschedules need flexibility
- Any chain-heavy environment where future tasks in the chain need room to fit
- As a secondary rule to balance aggressive EarliestStart (which consumes flexibility)

**When NOT to use it:**
- Job shops using Greedy strategy (per-task scheduling) — each task is placed independently, so preserving flexibility for "future chain tasks" is less relevant
- When the horizon is heavily loaded and flexibility is already minimal — the rule adds computation but all candidates score similarly

**Typical weight:** 0.15–0.30. Works best as a balancing rule alongside EarliestStart.

**Demo story:** "See how the solver left a gap on Thursday afternoon? That's WhiteSpace preserving room for emergency cases. If a trauma comes in, we have an OR available without bumping existing surgeries."

---

### 4. ChangeoverScoringRule

**Objective:** MINIMIZE
**What it measures:** The total changeover/setup time required for this placement. Looks at what was previously running on the proposed resource and calculates the process change duration from the state change lookup table.
**How it scores:** More changeover time = higher score = worse. Zero changeover (same process back-to-back) = 0 = best.

**What it does to the schedule:** Batches similar work together on the same resource. If CNC-01 just ran a stainless steel job, the solver prefers placing the next stainless job on CNC-01 (zero changeover) over placing it on CNC-02 which just ran mild steel (45-minute decontamination changeover). This directly increases throughput by reducing non-productive time.

**When to use it:**
- Manufacturing with material-dependent changeovers — stainless/mild steel contamination, color changes in painting, die changes in stamping
- Pharma with product-dependent cleanroom changeovers — same product 30 min, different product 2 hrs, after antibiotics 4 hrs
- Any environment where what ran previously affects setup time for what runs next

**When NOT to use it:**
- Healthcare — OR turnover time is generally fixed regardless of case type (standard clean between cases)
- Environments without process-dependent setups

**Typical weight:** 0.20–0.30. Often the second or third most important rule in manufacturing.

**Demo story:** "Look at the Gantt — all three stainless jobs are batched together on CNC-01. That saved two 45-minute decontamination changeovers. That's 90 minutes of capacity the solver recovered by sequencing intelligently."

---

### 5. DueDateScoringRule

**Objective:** MINIMIZE
**What it measures:** The slack between the task's completion time and its due date. Only fires on chain-terminal tasks (the last task in an order chain — the one that determines if the order ships on time). Intermediate tasks get a neutral score of 0.
**How it scores:**
- Finishes 5 days early → score = -5 days (negative = good)
- Finishes 1 day early → score = -1 day (less good)
- Finishes 2 days late → score = +2 days × (1 + penaltyFactor) (bad)

With penaltyFactor = 2.0, being 1 day late scores 3× worse than being 1 day early scores good. This creates a strong asymmetric pull — the solver will sacrifice other objectives (slightly worse resource utilization, slightly more changeover time) to avoid missing a due date.

**What it does to the schedule:** Ensures orders ship on time. The solver actively avoids placements that would push the final task past its due date, even if those placements are better on other metrics. The penaltyFactor controls how aggressively — a higher factor means the solver cares more about on-time delivery relative to everything else.

**When to use it:**
- Job shops where customer delivery dates drive the business (Stafford — global shipping commitments)
- Contract manufacturing with penalty clauses for late delivery
- Any make-to-order environment where "when does the customer get it?" is the primary question

**When NOT to use it:**
- Healthcare — surgery cases don't have ship dates
- Sports scheduling — games have scheduled slots, not due dates
- Make-to-stock environments where production targets are batch campaigns, not customer orders

**Typical weight:** 0.30–0.40 in job shops. The heaviest rule when on-time delivery is the primary KPI.

**penaltyFactor guidance:**
- 0.0 = symmetric (early and late weighted equally — unusual)
- 1.0 = 2× penalty for lateness (moderate)
- 2.0 = 3× penalty for lateness (recommended default for job shops)
- 5.0+ = extreme — nearly everything else is sacrificed to avoid lateness (contractual penalty environments)

**Demo story:** "Stafford has a Fonterra order due March 25th. The solver placed the final assembly on March 22nd — three days of buffer. Now watch what happens when I add a rush repair job. The solver re-sequences the CNC work but it does NOT push the Fonterra final assembly past the 25th. It found room by moving lower-priority work instead. That's the DueDate rule protecting your delivery promise."

---

### 6. ResourceUtilizationScoringRule

**Objective:** MAXIMIZE
**What it measures:** How much headroom (unused capacity) exists on the proposed resources. For each resource in the candidate combination, it computes `utilization = totalAssigned / totalAvailable`, then takes the minimum headroom (`1.0 - utilization`) across all resources.
**How it scores:** More headroom = higher score. MAXIMIZE means the engine prefers placements on less-loaded resources. Using minimum headroom (not average) means the tightest resource in the combo drives the score — a combo with one resource at 95% and another at 10% scores worse than two resources both at 50%.

**What it does to the schedule:** Spreads work across resources instead of piling everything onto one machine. Prevents the situation where CNC-01 is at 95% utilization while CNC-02 sits at 30%. The solver actively routes new work toward underutilized resources, which increases overall throughput and reduces single-point-of-failure risk.

**When to use it:**
- Job shops with multiple interchangeable machines — balance load across the CNC bank
- Pharma with parallel reactors or cleanrooms — balance cleanroom CLEAN-MFG loading
- Any environment where the planner's instinct is "why is everything on one machine?"

**When NOT to use it:**
- Healthcare where the chain engine handles resource assignment through combo logic — surgeon/OR pairing is a combo constraint, not a utilization preference
- Environments where resource specialization means work can't move between resources anyway
- When you deliberately want to load one resource heavily (dedicated production lines)

**Typical weight:** 0.15–0.25. A balancing rule, not usually the primary driver.

**Demo story:** "Before this rule, the solver was packing 90% of machining work onto CNC-01 because it scored best on EarliestStart — CNC-01 had the earliest available slot. Now with ResourceUtilization at 20%, watch the Gantt: work is spread across CNC-01, CNC-02, and CNC-03. CNC-01 dropped from 95% to 72%, and CNC-02 went from 30% to 65%. Same total throughput, but now if CNC-01 goes down, you only need to reschedule 72% of its load instead of 95%."

---

### 7. ResourcePreferenceScoringRule

**Objective:** MINIMIZE
**What it measures:** How well the proposed resource assignment matches the planner's stated preferences. Each task's capacity resources can have a `preferences` array with `{ resourceKey, rank }` entries where rank 1 = most preferred.
**How it scores:**
- Assigned resource is rank 1 → penalty 0 (best)
- Assigned resource is rank 2 → penalty 1
- Assigned resource is rank 3 → penalty 2
- Assigned resource not in preference list → penalty = maxRank + 1
- Assigned resource is excluded → penalty = maxRank × 2 (heavy)

Penalties are summed across all resource requirements in the combo. MINIMIZE means lower penalty = better.

**What it does to the schedule:** Honors the planner's knowledge about which operator works best on which machine, which machine produces the best quality for a specific part, or which room a patient prefers. It's a "soft" preference — the solver will respect it when possible but will override it if the preferred resource is full and other objectives (DueDate, Changeover) require it.

**When to use it:**
- Job shops where operators have machine affinities — "Sam is fastest on CNC-01, Ryan is the backup"
- Manufacturing where part quality varies by machine — "5-axis parts run best on the Haas, the Okuma can do it but slower"
- Any environment where the planner has tribal knowledge about "who should do what"

**When NOT to use it:**
- Healthcare where surgeon/patient assignment is a hard constraint, not a soft preference
- Environments where all resources are truly interchangeable
- Early in a scheduling implementation before the planner has established preferences

**Typical weight:** 0.05–0.10. Always a tiebreaker, never a primary driver. If preferences dominate, the solver ignores better options just to honor a preference.

**Demo story:** "Jack is the only ASME-certified welder. The solver put both pressure vessel weld jobs on Jack — that's a hard constraint, not a preference. But for general fabrication, the solver used Ryan's preference for Weld Bay 2 over Weld Bay 1. Same quality, but Ryan is faster on Bay 2 because the fixture setup matches his technique. That's the Preference rule honoring what the foreman knows."

---

## Tenant Configuration Patterns

### Job Shop (Stafford Engineering)
Primary goal: Ship on time. Secondary: balance machines, minimize changeovers.
```
DueDate 35% | Utilization 20% | Changeover 20% | EarliestStart 15% | Preference 10%
```

### Healthcare (Acme Outpatient)
Primary goal: Fill ORs early, keep flexibility for emergencies.
```
EarliestStart 50% | WhiteSpace 30% | Changeover 20%
```

### Pharma (Summit)
Primary goal: Balance changeovers and cleanroom loading.
```
EarliestStart 30% | Changeover 25% | WhiteSpace 25% | Utilization 20%
```

### Sports (HRMD)
Primary goal: Fill fields from morning, keep flexibility for weather delays.
```
EarliestStart 50% | WhiteSpace 30% | Changeover 20%
```

### General Manufacturing (Demo)
Balanced profile for demonstrations.
```
DueDate 30% | EarliestStart 25% | Changeover 20% | WhiteSpace 15% | Preference 10%
```

---

## Key Concepts for Demos

**"The weights are the planner's priorities expressed as numbers."** Every shop has different priorities. A job shop lives and dies by delivery dates. A hospital cares about OR utilization. A pharma plant cares about changeover efficiency. The scoring rules let each tenant configure the solver to think like their planner.

**"You can change these without writing code."** The scoring config is a JSON file per tenant. Adjust a weight, re-solve, see the difference. The What-If workflow: "What if I care more about changeover than due dates?" — change the weights, solve, compare.

**"The penalty factor is for asymmetric consequences."** Being a day early costs you a day of warehouse space. Being a day late costs you a customer. They're not equal. The penalty factor lets you express that asymmetry.

**"The rules don't fight each other — they negotiate."** The blended score is a weighted compromise. DueDate might want a task on CNC-01 (earlier completion), but Utilization wants it on CNC-02 (less loaded). The weights determine who wins. If DueDate is at 35% and Utilization is at 20%, DueDate has more pull — but not absolute veto. If CNC-02 is much less loaded, Utilization can still win.

**"This is the PTR architecture from the Willoughby paper."** The Possibilities list is generated by the constraint engine. The scoring rules are the T and R decisions — they evaluate each possibility using metrics that can be configured without changing code. This is exactly what NASA needed: a scheduling engine that adapts to new environments through data configuration, not software rewrites.
