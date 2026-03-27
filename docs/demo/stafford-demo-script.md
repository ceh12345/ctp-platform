# Stafford Engineering Demo Script + Dataset Tuning

**What it does:** Tunes the Stafford Engineering dataset to create a compelling demo-ready conflict (Jack Perkinson bottleneck), and provides a scripted 10-minute demo walkthrough that exercises the full feature set: KPIs, AI investigation, resource redirect, CTP Query, and customer status reporting.

**Size:** ~1 hour CC work (dataset tuning + verification)
**Depends on:** Stafford Job Shop Rework (done), Scoring Rules (done), CTP Query (done), AI Sprint 2 (done), Settings Panel (done)

---

## Part 1: Dataset Adjustments

### Understanding the Current Data

**Jack's current load:** 22 tasks, 100 hours total. But only 2 tasks (PV-001-WELD-SEAM and PV-002-WELD-SEAM, 8 hours) are Jack-only. All other 20 tasks list Luke and Aroha as alternatives, so the Greedy solver spreads work across all three fabricators and Jack is never a bottleneck.

**Available fabricators:**
- **FAB-JACK** (Jack P.): ASME-TIG, TIG, MIG, PressBrake, Roller, Polish — the only ASME-certified welder
- **FAB-LUKE** (Luke M.): TIG, MIG, Polish — standard welding, no ASME
- **FAB-AROHA** (Aroha T.): TIG, MIG, PressBrake, Roller — standard welding + forming, no ASME

**The bottleneck story:** Jack is the senior fabricator and foreman. By default, the shop routes everything to Jack because he's the most experienced. The EQ (equipment frame) weld tasks are standard TIG — Luke and Aroha could handle them — but nobody has updated the routing to reflect that. The scheduling tool identifies this and recommends redirecting to Luke or Aroha.

### 1a. Remove alternatives from EQ-003 and EQ-004 weld tasks

Change these tasks so **FAB-JACK is the only welder preference** (remove FAB-LUKE and FAB-AROHA from the preferences array):

| Task Key | Task Name | Current Preferences | Change To |
|----------|-----------|-------------------|-----------|
| EQ-003-WELD | Dairy Co-op Milk Vat - Weld Assembly | FAB-JACK, FAB-LUKE, FAB-AROHA | FAB-JACK only |
| EQ-004-WELD | Stafford Clutch Bracket - Weld Assembly | FAB-JACK, FAB-LUKE, FAB-AROHA | FAB-JACK only |

For each task, change the welder capacity resource entry to:
```json
{
  "resource": "FAB-JACK",
  "isPrimary": false,
  "qty": 1,
  "mode": "ON"
}
```
Remove the `preferences` array entirely — Jack is the only option, just like the ASME seam welds.

**Do NOT change EQ-001-WELD** — leave it with alternatives. The solver will route EQ-001 to Luke or Aroha naturally, which makes the bottleneck story cleaner: "EQ-001 found an alternative, but EQ-003 and EQ-004 couldn't because their routing only allows Jack."

### 1b. ASME weld tasks stay locked to Jack

Verify these tasks have NO preferences (Jack is the only option). They should already be this way:

| Task Key | Task Name | Routing |
|----------|-----------|---------|
| PV-001-WELD-SEAM | Fonterra Tank - Weld Longitudinal Seam | FAB-JACK only (no preferences) ✓ |
| PV-002-WELD-SEAM | F&P Sterilizer - Weld Longitudinal Seam | FAB-JACK only (no preferences) ✓ |

No changes needed — already correct.

### 1c. Tighten EQ-003 due date

Current: `"dueDate": "2026-03-26T12:00:00Z"` with `"lateDueDate": "2026-03-28T06:00:00Z"`

Change to: `"dueDate": "2026-03-24T12:00:00Z"` with `"lateDueDate": "2026-03-26T12:00:00Z"`

This makes the window tight enough that when Jack's earlier slots are consumed by PV-001, PV-002, and RP-001 (all higher priority), the EQ-003 weld step can't fit before the due date.

### 1d. Tighten EQ-004 due date

Current: `"dueDate": "2026-03-24T12:00:00Z"` with `"lateDueDate": "2026-03-26T12:00:00Z"`

Change to: `"dueDate": "2026-03-22T12:00:00Z"` with `"lateDueDate": "2026-03-24T12:00:00Z"`

EQ-004 is lower priority (50) than PV-001 (30) and PV-002 (40). With a tight due date, Jack's PV work pushes EQ-004 past its window.

**Also update the task window ends** for all EQ-003 and EQ-004 tasks to match the new lateDueDate:
- EQ-003 tasks: change `"windowEnd"` from `"2026-03-28T06:00:00Z"` to `"2026-03-26T12:00:00Z"`
- EQ-004 tasks: change `"windowEnd"` from `"2026-03-26T12:00:00Z"` to `"2026-03-24T12:00:00Z"`

### 1e. Ensure Luke and Aroha have capacity

After the solve, verify:
- **FAB-LUKE** at 40-55% utilization — room for redirected work
- **FAB-AROHA** at 40-55% utilization — room for redirected work

If either is too heavily loaded, remove one lower-priority task from their schedule. The demo needs visible headroom.

### 1f. PV-001 tight but feasible

PV-001 (Fonterra Pressure Vessel) should complete **1-2 days before its due date** (March 23). If it currently has too much buffer, tighten by changing:

`"dueDate": "2026-03-23T12:00:00Z"` → `"dueDate": "2026-03-22T12:00:00Z"` (pull in by 1 day)

Only adjust if PV-001 currently has 3+ days of buffer. The goal: tight enough to show as "at-risk" in the AI's morning review, but feasible.

### 1g. Feasibility targets after solve

Run `Greedy` strategy solve. Verify:

- **85-90% feasibility** — ~7-10 PROCESS tasks infeasible
- **Infeasible tasks all in EQ-003 and EQ-004 chains** — the weld step is infeasible (Jack bottleneck), which cascades to downstream tasks (machine, polish, assembly, test)
- **FAB-JACK at 85-95% utilization** — visibly the tightest person
- **FAB-LUKE at 40-55% utilization** — visibly has room
- **FAB-AROHA at 40-55% utilization** — visibly has room
- **PV-001 and PV-002 fully scheduled** — tight but feasible
- **All other orders fully scheduled** — EQ-001, MC-001-005, RP-001, RP-002, CX-001, CX-002

### 1h. Verification queries

```bash
# Overall feasibility
curl localhost:3000/api/v1/ctp/state?detailLevel=expert | jq '.summary'

# Jack's utilization
curl localhost:3000/api/v1/ctp/state | jq '.resourceUtilization[] | select(.resourceKey == "FAB-JACK")'

# Luke's utilization
curl localhost:3000/api/v1/ctp/state | jq '.resourceUtilization[] | select(.resourceKey == "FAB-LUKE")'

# Aroha's utilization
curl localhost:3000/api/v1/ctp/state | jq '.resourceUtilization[] | select(.resourceKey == "FAB-AROHA")'

# Infeasible tasks
curl localhost:3000/api/v1/ctp/state | jq '[.tasks[] | select(.included and .feasible == false and .type == "PROCESS") | {key, name, orderRef}]'

# PV-001 last task completion
curl localhost:3000/api/v1/ctp/state | jq '[.tasks[] | select(.orderRef == "PV-001" and .feasible) | {key, scheduledEnd}] | sort_by(.scheduledEnd) | last'
```

### 1i. If feasibility is too high (>95%) after changes

The solver might still route some Jack work to Luke/Aroha through other tasks where they're listed as alternatives (PV nozzle welds, polish tasks, bend tasks). If feasibility is still too high:

- Also remove alternatives from **EQ-003-BEND** and **EQ-004-BEND** (make Jack the only option for forming as well)
- Or add another EQ-003 task that requires Jack (e.g., a supervision step)

The key: we need EQ-003 and EQ-004 to be infeasible specifically because of Jack's availability.

---

## Part 2: Demo Script — "A Day at Stafford Engineering"

**Duration:** 8-10 minutes
**Audience:** Prospective customer, operations manager, production planner
**Tenant:** Stafford Engineering (`?tenant=stafford-engineering`)
**Setup:** Solve before the demo so the schedule is populated. Settings at Analyst experience level.

---

### Act 1: Morning Review (2 minutes)

**Narration:** "You're Ben Fleetwood, Operations Manager at Stafford Engineering. It's Monday morning. You open the scheduling dashboard to see where things stand."

**Actions:**
1. Open the app → Overview tab
2. Point out the KPI cards: "86% feasibility — 10 tasks didn't get placed across 3 orders. And look — the critical path bottleneck is the DMG Mori 5-Axis Mill at 42%. Let's find out what's going on."
3. Scan the Gantt: "Here's our 2-week horizon. 15 work orders across Machining, Fabrication, and Assembly."
4. Click the **🔗 Critical Path** toggle in the Gantt toolbar

**Narration:** "Watch what happens when I turn on the critical path view."

5. The Gantt transforms — a chain of tasks lights up with orange borders while everything else dims. "These highlighted tasks are the ones driving the schedule length. See how the critical path flows through the 5-Axis Mill — 7 tasks, 28 and a half hours of machining. That one machine owns 42% of why this schedule is as long as it is. Then it flows into Assembly Bay 2 and Polishing."
6. Point to a dimmed task: "This fabrication task has hours of slack — it could shift and the schedule wouldn't get any longer. But those orange tasks on the 5-Axis Mill? Zero slack. If any of them slip, the whole schedule slips."
7. Click the Conflicts tab: "But here's the thing — the 5-Axis Mill isn't causing any infeasibility. It's fully loaded but everything fits. The 10 blocked tasks are a different problem. Let's investigate."

**AI question — type in chat panel:**

> What's at risk today and what's driving the makespan?

**Expected AI response (approximate):**
"Two different issues. First, 10 tasks are infeasible across 3 orders — two fabrication bottlenecks: EQ-003 (Dairy Co-op Milk Vat) and EQ-004 (Stafford Clutch Bracket), both blocked because their weld tasks are routed exclusively to Jack P. The third is MC-003 (Local - Bearing Housings) — lower priority machining work squeezed out by higher-priority CNC jobs.

Separately, the makespan is driven by the DMG Mori 5-Axis Mill — it accounts for 42% of the critical path with 28.5 hours across 7 tasks, all zero slack. Assembly Bay 2 contributes 23% and Polishing Bay 14%. Jack P.'s fabrication queue is NOT on the critical path — his work has slack, but the routing constraint means EQ tasks can't find any slot at all.

12 of 15 orders are fully scheduled. PV-001 (Fonterra Pressure Vessel) is on track but tight — only about 1 day of buffer."

**Key demo point:** The AI distinguished two completely different kinds of bottleneck — the 5-Axis Mill drives the schedule *length* (critical path), while Jack's routing drives *infeasibility* (tasks that can't place at all). These need different fixes. The critical path view on the Gantt makes it visual. Without this tool, Ben would spend 15 minutes scanning the Gantt and cross-referencing the whiteboard, and he'd probably conflate the two problems.

---

### Act 2: Investigate the Bottleneck (2 minutes)

**Narration:** "Two different problems — fabrication and machining. Let's tackle the fabrication issue first. Those are customer orders."

**AI question:**

> Why can't EQ-003 schedule?

**Expected AI response:**
"EQ-003 (Dairy Co-op Milk Vat) weld step is routed exclusively to Jack P. — no alternative welders are configured. Jack's available slots within EQ-003's due date window are consumed by higher-priority work: PV-001 and PV-002 ASME seam welds (which only Jack can do), plus RP-001 and other fabrication tasks.

However, the EQ-003 weld is standard TIG — not ASME. Luke M. (26% utilized) and Aroha T. (34% utilized) are both qualified for TIG welding and have significant capacity available."

**Actions:**
1. Click the AI's action button to view Jack's resource agenda → shows his committed work
2. Click back, then view Luke's agenda → visibly lighter schedule with open slots

**AI question:**

> Which of Jack's tasks could Luke or Aroha handle?

**Expected AI response:**
"EQ-003-WELD and EQ-004-WELD are standard TIG welds routed exclusively to Jack — no alternatives configured. Both could be handled by Luke M. or Aroha T. The PV-001 and PV-002 seam welds are ASME certified and must stay with Jack. Redirecting the 2 EQ weld tasks to Luke would allow EQ-003 and EQ-004 to schedule within their due date windows."

**Key demo point:** The AI didn't just identify the bottleneck — it identified that the routing is the problem, not capacity. Jack isn't overloaded overall (46% utilization), but the tasks that need him have no fallback. The fix is a routing change, not adding overtime.

**Beta discovery note:** The AI suggested moving ASME seam welds to Luke/Aroha — but those require ASME certification that only Jack has. In the current version, this constraint is modeled through resource preferences (Jack is the only listed option). A better model would be attribute-based matching: the task requires `ASME-TIG` qualification, and only resources with that attribute qualify. This is on the roadmap. **For the Stafford demo, if this comes up, say:** "Good catch — that's exactly the kind of real-world requirement we're building for. The platform currently handles this through resource routing, but we're adding attribute-based matching so the engine automatically knows only ASME-certified welders can do pressure vessel seams. That's why beta partners matter — you help us find these requirements."

---

### Act 3: Fix It (2 minutes)

**Narration:** "The AI told us exactly what to do. Let's redirect those weld tasks to Luke."

**Actions:**
1. Go to Schedule tab → filter task table by Resource → Jack P.
2. See Jack's tasks listed
3. Select the 2 EQ weld tasks: EQ-003-WELD, EQ-004-WELD (checkboxes)
4. Click "Set Resource Preference" in the selection toolbar
5. In the dialog:
   - Jack P. → EXCLUDED
   - Luke M. → PREFERRED
6. Click "Apply"
7. Stale banner appears: "2 resource preference changes"
8. Click "Review & Solve"
9. Solve preview shows the changes → click "Solve Now"
10. Results dialog shows improved feasibility

**Narration:** "EQ-003 and EQ-004 are now scheduled — the standard TIG work moved to Luke. The ASME welds stayed on Jack. And notice MC-003 may have resolved too — freeing up fabrication capacity sometimes has a ripple effect on machining schedules."

*If MC-003 is still infeasible:* "MC-003 is still blocked — that's a separate machining capacity issue. It's a local job, lower priority. We can defer it to next week or investigate the machining bottleneck separately. The important thing is the customer orders are on track."

11. Toggle the **🔗 Critical Path** view back on

**Narration:** "Now look at the critical path after the fix. The 5-Axis Mill is still the makespan bottleneck — that hasn't changed, it's structural. But notice what DID change: Jack's fabrication queue lost the EQ tasks that were competing for his time. Those are on Luke now, scheduled with slack. The fix didn't shorten the critical path — it resolved the infeasibility without disturbing the critical-path work. That's surgical scheduling."

*Point to the task table:* "Sort by Slack — see how the EQ tasks now have 2-3 hours of slack? Before the fix they were infeasible. Now they're scheduled AND they have breathing room. And the 5-Axis Mill tasks still show zero slack — they're the real constraint."

**AI question:**

> How does the schedule look now?

**Expected AI response:**
"Schedule improved — EQ-003 and EQ-004 are now scheduled with Luke M. on Weld Bay 2. ASME seam welds remain on Jack. The critical path is still driven by the 5-Axis Mill at 42% — that's a capacity constraint, not something a routing change fixes. But the infeasibility is resolved: all customer orders are on track. PV-001 still on track with buffer before due date."

**Key demo point:** The planner fixed the customer-facing problem in 30 seconds. The critical path view confirms nothing was disrupted — the 5-Axis Mill chain is untouched. Two different bottlenecks, two different fixes: routing redirect for infeasibility, capacity planning for makespan. The tool shows both clearly. And they made a conscious triage decision — fix the urgent customer work first, deal with the lower-priority local job later. That's how real planners work.

---

### Act 4: Customer Emergency — CTP Query (2 minutes)

**Narration:** "Now the phone rings. Fonterra's dairy plant just had a pump failure. They need an emergency replacement pump. Can we fit it?"

**Actions:**
1. Click "CTP Query" button in the toolbar
2. Fill in the form:
   - Based on: RP-001 (Fonterra Emergency Pump Repair)
   - Name: "Fonterra Pump Repair #2"
   - Need by: March 28
   - Priority: HIGH
3. Click "Evaluate"
4. Summary banner appears: **"✓ Can deliver: March 24 — 4 days before need-by date"**
5. 3 options shown, sorted by completion date:
   - Option 1: Completes Mar 24 — 5-Axis Mill → Jack P. → Assembly Bay 1
   - Option 2: Completes Mar 25 — 5-Axis Mill → Jack P. → Assembly Bay 2
   - Option 3: Completes Mar 27 — Manual Mill → Luke M. → Assembly Bay 1
6. Ghost bars appear on the Gantt for Option 1
7. Click Option 2 to compare → ghost bars switch
8. Click back to Option 1 → "Book"
9. Confirmation dialog → "Add & Solve"
10. New order appears on the Gantt

**Narration:** "In under 30 seconds, we answered Fonterra's question: yes, we can deliver by March 24, four days ahead of their deadline. And we can tell them exactly which resources will handle it."

**Key demo point:** This is the CTP promise. The planner can answer the customer on the phone in real time instead of saying "let me check and call you back."

---

### Act 5: Verify Nothing Broke (1 minute)

**AI question:**

> Did booking the Fonterra repair affect any other orders?

**Expected AI response:**
"Minor shifts on a few tasks to accommodate the new repair order, but all existing orders remain within their due date windows. No orders moved from on-track to at-risk."

**AI question:**

> Give me a status update for all Fonterra orders.

**Expected AI response:**
"Two Fonterra orders active:
- PV-001 (2000L Mix Tank): On track, tight buffer before March 23 due date.
- RP-001 (Emergency Pump Shaft): Scheduled, priority 10 RUSH.
- Fonterra Pump Repair #2: Just booked, on track for delivery before March 28 need-by date.

All Fonterra commitments on track."

**Key demo point:** The planner has full confidence that the new order fits without disrupting existing promises. No spreadsheet cross-checking needed.

---

### Act 6: Show the Scoring Configuration (optional, 1 minute)

**Narration:** "One more thing — the engine's decision-making is completely transparent and configurable."

**Actions:**
1. Click the Settings gear icon
2. Left nav → Scoring Rules
3. Show the Stafford config: DueDate 35%, Utilization 20%, Changeover 20%, EarliestStart 15%, Preference 10%
4. "DueDate is the heaviest rule — because for a job shop like Stafford, the #1 question is 'will we ship on time?' The engine prioritizes delivery dates over everything else."
5. "These weights are configurable per tenant. A hospital would weight EarliestStart highest. A pharma plant would weight Changeover highest. Same engine, different priorities."

**Key demo point:** The engine adapts to any scheduling environment through configuration, not code changes. This is the multi-vertical story.

---

## Part 3: Demo Preparation Checklist

Before the demo, verify:

- [ ] Stafford tenant loads without errors (`?tenant=stafford-engineering`)
- [ ] Initial solve shows ~86% feasibility (60/70 tasks, 10 infeasible)
- [ ] Infeasible tasks are in EQ-003, EQ-004, and MC-003 chains
- [ ] EQ-003/EQ-004 infeasibility traces to Jack P. (fabrication routing)
- [ ] MC-003 infeasibility traces to machining capacity (separate issue)
- [ ] Jack P. (FAB-JACK) at ~46% utilization — bottleneck is routing, not overall load
- [ ] Luke M. (FAB-LUKE) at ~26% utilization — visible headroom
- [ ] Aroha T. (FAB-AROHA) at ~34% utilization — visible headroom
- [ ] PV-001 scheduled and tight (close to due date)
- [ ] AI chat panel opens and responds
- [ ] "What's at risk today?" identifies both bottlenecks (fabrication + machining)
- [ ] "Why can't EQ-003 schedule?" identifies Jack routing and suggests Luke/Aroha
- [ ] Resource redirect flow works: select EQ-003-WELD + EQ-004-WELD → Set Preference → Exclude Jack, Prefer Luke → Solve
- [ ] Post-redirect: EQ-003 and EQ-004 now scheduled
- [ ] CTP Query dialog opens with chain template dropdown populated
- [ ] CTP Query for repair order returns options sorted by completion date
- [ ] Summary banner shows correct promise status (green/yellow/red)
- [ ] "Book" on CTP option adds the order to the schedule
- [ ] Post-book AI can report on impact and Fonterra status
- [ ] Scoring Rules section in Settings shows the 5 Stafford rules with correct weights
- [ ] Experience level set to Analyst (shows scoring and resource modes but not diagnostic data)
- [ ] Critical path toggle works on Gantt — highlights a chain of tasks through the 5-Axis Mill and downstream
- [ ] Critical Path KPI card on Overview shows makespan + bottleneck resource (DMG Mori 5-Axis Mill)
- [ ] 5-Axis Mill accounts for ~42% of the critical path
- [ ] After redirect fix, critical path is unchanged (5-Axis Mill still the driver) but infeasibility is resolved
- [ ] Task table Slack column shows "⚡ Critical" on 5-Axis Mill tasks and positive slack on EQ/fabrication tasks
- [ ] AI can answer "what's driving the makespan?" distinguishing critical path (5-Axis) from infeasibility (Jack)

---

## Part 4: Talking Points for Each Feature

| Feature | What to Say | What the Audience Thinks |
|---------|-------------|------------------------|
| KPI Overview | "86% scheduled — 10 tasks blocked across 3 orders. Two different root causes. The dashboard tells you in 2 seconds." | "I spend 20 minutes figuring this out every morning." |
| Critical Path | "Two different bottlenecks. The 5-Axis Mill drives the schedule LENGTH — 42% of the critical path, zero slack. Jack drives the INFEASIBILITY — routing problem, not capacity. Different problems, different fixes. The tool shows both." | "I've never been able to see WHAT makes the schedule long vs. what's actually blocked. Those are different things." |
| AI Investigation | "Ask the AI why — it traces both root causes AND explains what's driving the makespan. Fabrication routing problem, machining capacity, and the critical path through Jack's queue." | "That's what my foreman does, but he's not always here." |
| Bottleneck Analysis | "Jack isn't overloaded — he's at 46%. The problem is the routing only allows him for these welds. Luke and Aroha can do them but nobody updated the routing." | "We do this all the time — our best guy gets everything by default." |
| Resource Redirect | "Two clicks: exclude Jack, prefer Luke, solve. EQ-003 and EQ-004 are scheduled." | "That would take me an hour of replanning." |
| Triage Decision | "MC-003 is still blocked but it's a local job, priority 60. We fix the customer work first." | "That's exactly how I'd prioritize it." |
| CTP Query | "Customer calls — can we deliver? Answer in 30 seconds, on the phone." | "Right now I say 'let me check' and call back tomorrow." |
| Promise Status | "Green banner: yes, days before deadline. Tell the customer now." | "I need that confidence before I commit." |
| Impact Check | "AI confirms nothing else broke. Full confidence." | "Every time I move something, I worry about what I broke." |
| Scoring Rules | "These are your priorities as numbers. Change them, re-solve, see the difference." | "So this works for MY shop, not just a generic template." |

---

## Part 5: Fallback Scenarios

If something goes wrong during the demo:

**AI doesn't respond or gives a weak answer:**
Skip the AI question, navigate manually to the Conflicts tab and click on an infeasible task. The bottleneck panel shows the same information. Say: "The AI gives you this conversationally, but it's also available as structured data in the task detail."

**CTP Query returns zero options:**
The dataset is too tight. Say: "No options found — the shop is fully loaded. This is the answer too — now you know you need to defer lower-priority work or add overtime before you can promise a date." Then show the infeasibility report.

**Feasibility doesn't improve after redirect:**
Luke might be tighter than expected. Check Luke's utilization. If needed, manually unschedule a low-priority task on Luke first, then retry. Say: "Sometimes the fix requires a two-step — free up Luke's capacity first, then redirect Jack's overflow to Luke or Aroha."

**Solve takes longer than expected:**
The Greedy strategy on 100 tasks should be under 2 seconds. If it's slow, say: "The engine evaluates every resource combination for every task. For 100 tasks across 28 resources, that's thousands of possibilities scored in real time." Turn it into a feature, not a bug.
