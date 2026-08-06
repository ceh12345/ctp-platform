# CTP / Stafford — Progress Update

**For:** Kaleb James, Allan Evans
**Date:** 6 August 2026
**Data basis:** WORK7 snapshot taken 16 July 2026 (plus the operations master pulled 28 July)
**Attachments:** `late-risk-2026-07-16.html` · `resource-utilization-2026-07-16.html`

---

## The short version

Since we loaded your operation codes, CTP now reads your **entire live book of
work** — all 472 open work orders, 1,722 tasks, 229 jobs, 68 resources — and
produces a complete, capacity-respecting schedule for it in **under two
minutes**.

The headline finding: working from 16 July, CTP projects **231 of your 328 open
customer orders (70%) will meet their promised delivery date, and 97 will not**.
Two-thirds of those at-risk orders are within a month of their promise — the
range where a dispatch or expediting decision can still change the outcome.

That is the product doing the job you described: telling you which orders are
heading for a late-delivery penalty **while there is still time to act**, rather
than after the fact.

Everything below is beta work against WORK7 — it's how we're learning your
operation, not a system being readied for cutover.

---

## 1. What we loaded

| | Count |
|---|---|
| Work orders | 472 |
| Tasks (operations) | 1,722 |
| Jobs | 229 |
| Resources | 68 |
| Operation codes | 49 |

Work orders by type: **353 customer** · 87 internal/stock · 28 rework · 4 quote.
Task status at capture: 223 complete · 82 in progress · 1,417 not started.

**The operation-code mapping works.** Every one of the 1,722 tasks resolves
through its operation code to a machine group — no exceptions, no manual
patching. That includes the many-to-one cases (your laser thickness codes
`L005`–`L060` all resolving to `L`, the nine polish variants to `P`, `QC`/`QH`/`QM`
to `Q`). 23 distinct machine groups are in play.

**How the work is currently allocated**, which turned out to be one of the more
interesting things in the data:

- **496 tasks (29%)** are assigned to a specific machine or person
- **1,019 tasks (59%)** sit on a group code with no individual assigned — CTP
  distributes these across the group's members
- **207 tasks (12%)** are in groups with no finite members at all (`OUT`, `PR`,
  `DR`, `LP`, `LE`, `PM`…), so they stay on the group as load

So roughly **six out of ten tasks in your book are currently undispatched** —
that's the population CTP is choosing placements for.

---

## 2. Delivery risk — the main report

*(Detail: `late-risk-2026-07-16.html` — every order, sortable and filterable,
with customer promise, Genius plan date, and CTP's projected completion.)*

Of **328 open customer orders carrying a real promise date**:

| | Orders |
|---|---|
| Projected **on time** | **231 (70.4%)** |
| Projected **late** | **97 (29.6%)** |
| — by 1–7 days | 37 |
| — by 8–30 days | 41 |
| — by 31–90 days | 17 |
| — by more than 90 days | 2 |

A further 85 open orders are internal/stock/rework with no customer promise, and
59 orders have no remaining work.

**37 of the open orders already had a promise date in the past on 16 July.**
Those are largely long-running or rework jobs; they're history to explain rather
than risk to manage. The other ~60 at-risk orders are the actionable list.

The six furthest behind:

| Order | Description | Promised | CTP projects | Days |
|---|---|---|---|---|
| 28482 | DF3000 Evaporator Vessel | 30 Jul | 18 Feb 27 | +203 |
| 28468 | DF1500 Evaporator Vessel | 30 Jul | 22 Nov | +115 |
| 26756 | Mobile Butt Muscle Puller | 29 Jun | 23 Sep | +86 |
| 25760 | 24 × Column Container Skid | 29 Jun | 15 Sep | +78 |
| 28450 | CL20 Bag Loader — Dale Farms | 18 May | 28 Jul | +71 |
| 25898 | Chine & Square Cube Cut | 29 Jun | 4 Sep | +67 |

The two evaporator vessels are worth a conversation on their own — they are long
sequential builds, and their lateness comes from the sheer length of the
operation chain rather than from any queue or machine being full.

**An important caveat on all of the above.** Because the calendar endpoint is
parked for now, we generate every resource's working calendar ourselves from the
Standard default you pointed us at: **Monday–Friday, 07:00–15:00** (8 hours a
day, 5 days a week, matching the `HourCapacityPerDay` and `OperatingDayPerWeek`
on your resource records). There is no allowance for absences, breakdowns,
overtime, or differing shift patterns per area.

That assumption sets every projected date in this report, so if the working
window is wrong — see question 3 below — the shape of the risk still holds, but
individual dates will shift.

---

## 3. Resource utilisation

*(Detail: `resource-utilization-2026-07-16.html` — every resource and group.)*

Across the planning window (16 Jul 2026 → 13 Mar 2027):

**Subcontract is your biggest single work stream.** OUTWORK carries **9,864
hours** of the book against **6,296 hours** across all internal resources
combined — about 61% of the total. Subcontract turnaround is therefore a
first-order lever on delivery dates, not just a cost line.

**Internal load is light, and unevenly spread.** 50 of 68 resources carry work
(the remainder are group headers and genuinely idle stations). The busiest:

| Resource | Group | Utilisation | Hours | Tasks (assigned / free to move) |
|---|---|---|---|---|
| GRANT | Fabrication | 53.5% | 734 | 11 / 9 |
| COOPER | General Eng. | 24.3% | 333 | 7 / 7 |
| KALEB M | Assembly | 24.0% | 330 | 14 / 4 |
| FELAYNE | Cutting | 23.6% | 324 | 8 / 16 |
| DYLAN | Fabrication | 20.1% | 276 | 6 / 14 |
| HAYDEN | Assembly | 18.9% | 259 | 6 / 11 |

Nobody else exceeds 20%. GRANT runs at more than double the next busiest person,
and **11 of his 20 tasks are hard-assigned to him in Genius** while other
fabrication welders sit well under 20%.

This is the single clearest improvement opportunity we've seen in the data, and
it leads directly to a question for you (below): **which of those assignments are
genuine constraints — only that person can do that work — and which are simply
how the job happened to get allocated?** Where they're the latter, CTP can level
the load automatically.

The corollary matters too: **your late orders are not caused by a lack of
capacity.** We tested this directly — reordering the entire book by different
priority rules produced no change in delivery dates at all, because at this load
nothing is queuing behind anything else. Lateness is coming from the *length* of
operation chains against the time remaining, plus subcontract turnaround. That
points at chain compression and expediting rather than at buying capacity or
working overtime broadly.

---

## 4. Things we found in your data

These came out of the load and are worth knowing regardless of CTP:

1. **Customer promise dates and Genius plan dates are the same on 337 of 343
   customer orders** — as expected, since the plan date is seeded from the
   promise. On **6 orders they differ, and every one has been moved later**, in
   all cases after the promise had already passed. Five of those six were moved
   to the *same* date (22 July), which looks like a single bulk replan. Nothing
   is wrong here, but it means a plan date can quietly diverge from what the
   customer was told — so we now report against the promise on the sales order,
   never the work-order plan date.

2. **One machine (`P-05`) has open tasks but is no longer in the active resource
   list** — presumably retired with work still attached.

3. **In-flight work has progress hours but no actual start/finish times.** We can
   see that a task is 67% done with 13.5 hours booked, but not when it actually
   started. If you'd like CTP's plan-versus-actual reporting to be accurate, the
   time-entry data would be the source — worth a short conversation with Allan.

4. **68 overhead work orders** enter without a parent job (the `SYST` filter
   asymmetry Allan confirmed in July) — handled, noted here for completeness.

---

## 5. Performance

Not interesting in itself, but it determines whether a daily replan is
practical: scheduling your complete book went from around **30 minutes** to
**under two minutes**, with the schedule verified identical to the original
engine at every step. Loading the plan in the browser is now effectively
instant, because the app reads a stored schedule rather than re-planning on
open.

That makes the operating rhythm you and Allan described — deploy today's plan,
capture what actually happened, replan tomorrow morning — comfortably viable.

---

## 6. What we'd like from you

1. **Your late-delivery penalty terms.** This is the big one. With the fee
   structure per customer or contract, the report above stops being "97 orders
   at risk" and becomes a dollar figure, ranked — which is the number that
   should drive the priorities.

2. **Which machine/person assignments are constraints vs. convenience?** A
   group-level answer is plenty ("polishing is interchangeable, NC milling is
   operator-bound"). This decides how much load-levelling CTP is allowed to do.

3. **Is 07:00–15:00, Monday–Friday the right working window?** We picked it as
   the NZ early-shift convention, but it's an assumption on our side and it
   drives every date in this report. If different areas run different hours —
   or if there's a second shift anywhere — that's worth correcting early.

4. **The two evaporator vessels (28482, 28468)** — is a 200-day overrun on 28482
   a real position, or is something in that job's data not reflecting reality?

5. **The 22 July bulk replan** — what typically prompts that, and who does it?
   Understanding it helps us model how your plan actually evolves.

6. Lower priority: `P-05`'s open tasks, and whether machine efficiency (we see
   75% / 90% / 100%) should stretch job durations or is informational.

---

## 7. What's next at our end

- Feeding your penalty terms into the risk report so it ranks by money at risk
- Bottleneck attribution — for each late order, *which* group or step is driving
  the delay
- A daily dispatch list per machine group, showing what's fixed and what CTP
  chose
- Plan-versus-actual tracking, so each day's schedule can be compared to what
  really happened
- Continued optimisation aimed specifically at pulling late orders forward

Happy to walk through any of this live — the two attached reports are
interactive, and the order-level table is the one most worth exploring.
