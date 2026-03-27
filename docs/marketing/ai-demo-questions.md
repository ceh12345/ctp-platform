# AI Assistant Demo Questions — All Three Tenants

Questions designed to showcase the full capability of AI Sprint 2 tools. Each question
is labeled with which tools fire, the complexity level, and what makes it impressive.

---

## Tenant 1: Acme Outpatient Surgery Center

**Resources:** OR-01/02/03, DR-SMITH/PATEL/CHEN, AN-JONES/GARCIA, RN-01/02/03,
EQ-VENT/FLUORO/LASER, REC-01/02/03/04

**Task attributes:** procedureType, phase, priority
**Resource attributes:** resourceType, specialty, roomSize, shiftPattern

---

### Tier 1 — Single Tool, Immediate Answer

| # | Question | Tool | What's impressive |
|---|----------|------|-------------------|
| H1 | "Which surgeons specialize in orthopedics?" | `query_resources` | Attribute query, no context needed |
| H2 | "Which ORs are large enough for ortho cases?" | `query_resources` | roomSize filter |
| H3 | "Show me all the phases for CASE-004" | `get_chain_detail` | Chain drill-down |
| H4 | "What's AN-JONES doing today?" | `get_resource_agenda` | Full day timeline |
| H5 | "Which cases are infeasible right now?" | answered from context | Task attributes already in context |
| H6 | "Which recovery bays are free this afternoon?" | `query_resources` + time window | Attribute + availability combined |

---

### Tier 2 — Multi-Tool, Investigative

**H7 — The Bumped Case**
> "CASE-007 is infeasible. Why, and where can it go?"

Tools: `get_chain_detail` → `where_can_task_go`

AI investigates the chain to find which phase is blocked, identifies the bottleneck
resource, then queries placement options. Returns: "The procedure phase is blocked —
AN-GARCIA is unavailable Wednesday morning. 3 options exist, best is Thursday 8 AM
with AN-JONES in OR-02."

---

**H8 — The Surgeon Swap**
> "Dr. Patel is out Wednesday. What cases are affected and can they be moved?"

Tools: `get_resource_agenda` (Patel) → `analyze_impact` → `where_can_task_go`
(per affected case)

AI finds all cases with Patel on Wednesday, analyzes impact of removing him,
then checks where each displaced case could be rescheduled. Returns a ranked
list of cases with their best alternative slots.

---

**H9 — The Bottleneck Diagnosis**
> "Why is Tuesday so backed up?"

Tools: `get_resource_agenda` (OR-01, OR-02, OR-03) + `get_resource_agenda`
(AN-JONES, AN-GARCIA)

AI compares OR availability vs anesthesiologist availability on Tuesday.
Returns: "ORs have 4 hours of open capacity Tuesday afternoon, but both
anesthesiologists are fully booked until 3 PM — that's the bottleneck."

---

**H10 — The Add-On Case**
> "We have an urgent add-on knee replacement coming in — is there any capacity
> left this week, and who would do it?"

Tools: `query_resources` (surgeons with ortho specialty) →
`get_resource_agenda` (each ortho surgeon) →
`find_available_resources` (OR + anesthesiologist overlap)

AI finds ortho-capable surgeons, checks their remaining availability,
cross-references OR and anesthesiologist windows, and returns: "Dr. Smith
has a 3-hour window Friday morning. OR-01 and AN-GARCIA are both free
then — that's your best slot."

---

**H11 — The What-If**
> "What happens if I unschedule CASE-001? Who benefits?"

Tools: `analyze_impact`

Returns freed resources (OR-01 150 min, DR-SMITH 150 min, AN-JONES 150 min,
RN-01 150 min) and lists infeasible cases that could fill the slot —
specifically ones blocked on anesthesiologist availability.

---

**H12 — The Domino**
> "CASE-004 and CASE-011 are both infeasible. If I could only fix one,
> which should I prioritize?"

Tools: `get_chain_detail` (CASE-004) → `get_chain_detail` (CASE-011) →
`where_can_task_go` (both) → `compare_tasks`

AI compares priority, procedure type, how many options each has, and
which has an earlier feasible slot. Returns a recommendation with reasoning.

---

### Tier 3 — Complex Cross-Resource Analysis

**H13 — The Full Morning Audit**
> "Walk me through Monday morning. What's scheduled, what's tight,
> and what could go wrong?"

Tools: `get_resource_agenda` (all ORs) + `get_resource_agenda`
(both anesthesiologists) + answered from task context (infeasible cases)

AI builds a narrative of Monday morning — which ORs are running, when
anesthesiologist coverage gaps are, which cases are at risk if any
single resource is delayed. Surfaces 2-3 specific risks proactively.

---

**H14 — Equipment Bottleneck**
> "Which cases need the fluoroscopy unit and are any of them fighting
> over it?"

Tools: answered from task context (procedureType on tasks) +
`get_resource_agenda` (EQ-FLUORO)

AI identifies cases requiring fluoroscopy from task attributes (no tool
call needed), then checks the equipment agenda to see if any overlap.
Returns: "3 cases need fluoroscopy this week. CASE-009 and CASE-012
both want it Wednesday — one will need to move."

---

---

## Tenant 2: HRMD Rec Sports

**Resources:** 12 diamonds (RS-*, FP-*, CP-*), 9 pickleball courts (PB-*),
6 multi-use fields, umpires (UMP-01 through UMP-08),
referees (REF-01 through REF-07), staff (STAFF-*)

**Task attributes:** sport, division, homeTeam, awayTeam, gameWeek, phase
**Resource attributes:** lightingAvailable, surface, park, sport, fenced,
certificationLevel

---

### Tier 1 — Single Tool, Immediate Answer

| # | Question | Tool | What's impressive |
|---|----------|------|-------------------|
| S1 | "Which fields have lights?" | `query_resources` | lightingAvailable boolean |
| S2 | "Which umpires are CHSAA certified?" | `query_resources` | certificationLevel filter |
| S3 | "How many baseball games are scheduled this week?" | context | sport attribute on tasks |
| S4 | "Show me all the pickleball games on Saturday" | context | sport + date from task attributes |
| S5 | "Which lighted fields are free Saturday evening?" | `query_resources` + time window | Attribute + availability combined |
| S6 | "What's UMP-01's schedule this weekend?" | `get_resource_agenda` | Umpire day view |

---

### Tier 2 — Multi-Tool, Investigative

**S7 — The Evening Game Problem**
> "We need to schedule 3 makeup games Saturday evening. Which lighted
> fields are available and do we have umpires to cover them?"

Tools: `query_resources` (lightingAvailable=true, Saturday evening window) →
`query_resources` (certificationLevel, Saturday evening window)

AI returns available lighted fields and available umpires simultaneously,
tells the coordinator: "4 lighted fields are free Saturday 6-9 PM.
Of those, 2 are at Redstone. We have 3 certified umpires available —
enough to cover all 3 games."

---

**S8 — The Rainout Reschedule**
> "Field 3 at Redstone is unavailable Sunday due to maintenance.
> What games are affected and where can they go?"

Tools: `get_resource_agenda` (RS-03) → `analyze_impact` →
`where_can_task_go` (per affected game)

AI finds all games scheduled at RS-03 on Sunday, analyzes impact,
then finds alternative fields with the right surface type for each game.

---

**S9 — The Umpire Shortage**
> "We only have 2 certified umpires available next Saturday.
> Which games are at risk?"

Tools: `query_resources` (certificationLevel, Saturday window) →
answered from task context (baseball games on Saturday)

AI identifies how many baseball games need umpires Saturday, compares
to available certified umpires, and flags which games will be short.
"8 baseball games are scheduled Saturday. You have 2 CHSAA-certified
and 3 volunteer umpires — enough for all games but Majors division
requires certified only, and you have 4 Majors games."

---

**S10 — The Division Conflict**
> "The Majors division has 3 infeasible games this week. What's blocking them?"

Tools: `get_chain_detail` (each infeasible game) + `get_resource_agenda`
(umpires)

AI traces each infeasible game's chain, identifies whether the field,
umpire, or staff is the bottleneck across all 3. Surfaces the common
thread: "All 3 Majors games need a CHSAA-certified umpire — UMP-01
through UMP-03 are all double-booked Saturday morning."

---

**S11 — The Field Audit**
> "Give me a utilization picture for all Redstone Park fields this weekend"

Tools: `query_resources` (park=Redstone, include_availability=true)

AI returns all Redstone fields with their utilization %, available gaps,
and which games are scheduled when. Surfaces any fields that are
over/underutilized.

---

### Tier 3 — Complex Cross-Resource Analysis

**S12 — The Full Saturday Plan**
> "It's Friday afternoon. Walk me through Saturday's schedule —
> what's confirmed, what's at risk, and do we have enough coverage?"

Tools: `query_resources` (all fields, Saturday window) +
`query_resources` (all umpires/refs, Saturday window) +
answered from task context (all Saturday games)

AI builds a full Saturday coverage picture — fields booked, staff assigned,
games without umpires flagged, fields with back-to-back games noted.
Proactively surfaces 2-3 risks.

---

---

## Tenant 3: Demo Manufacturing

**Resources:** CNC-01/02, ASM-01, QC-01, plus materials

**Task attributes:** productType, batchSize, priority, qualityHold
**Resource attributes:** capability, workCenter, shiftPattern (if configured)

---

### Tier 1 — Single Tool, Immediate Answer

| # | Question | Tool | What's impressive |
|---|----------|------|-------------------|
| M1 | "Which machines can do finish milling?" | `query_resources` | capability filter |
| M2 | "What's CNC-02's schedule today?" | `get_resource_agenda` | Machine day view |
| M3 | "Which work orders are infeasible?" | context | Task attributes in context |
| M4 | "Show me all the tasks for WO-1004" | `get_chain_detail` | Chain drill-down |
| M5 | "Which tasks have a quality hold?" | context | qualityHold boolean on tasks |
| M6 | "How utilized is CNC-01 vs CNC-02?" | context | utilization in resourceUtilization |

---

### Tier 2 — Multi-Tool, Investigative

**M7 — The Machine Breakdown**
> "CNC-01 is going down for maintenance Wednesday afternoon.
> What tasks are affected and can they move to CNC-02?"

Tools: `get_resource_agenda` (CNC-01) → `analyze_impact` →
`where_can_task_go` (each affected task, filtered to CNC-02)

AI finds all CNC-01 tasks Wednesday afternoon, analyzes freed capacity,
then checks which can move to CNC-02 vs which are CNC-01-only.
Returns a clear list: "3 tasks can move to CNC-02 with no issue.
OP-007 is CNC-01 only — it needs to be rescheduled to Thursday."

---

**M8 — The Rush Order**
> "WO-1004 just became critical — customer needs it by Friday.
> Can we make it?"

Tools: `get_chain_detail` (WO-1004) → `where_can_task_go`
(each task in the chain)

AI traces the full chain, finds the earliest each task can start
given current schedule, and calculates if Friday is achievable.
Returns: "WO-1004 has 4 tasks. If we start OP-012 Tuesday morning,
the chain completes Thursday EOD — Friday is achievable."

---

**M9 — The Rebalancing Question**
> "CNC-02 is at 35% utilization while CNC-01 is at 96%.
> Which tasks could shift to balance the load?"

Tools: answered from context (utilization) →
`find_available_resources` (CNC-02, full week) →
answered from context (tasks with multi-machine capability)

AI identifies tasks that list both CNC-01 and CNC-02 as options
(the FLEX- and FLOAT- tasks), checks CNC-02 availability, and
recommends which specific tasks to redirect.

---

**M10 — The Bottleneck Chain**
> "WO-1003 is late. Walk me through why and what would need to
> change to fix it."

Tools: `get_chain_detail` (WO-1003) → `where_can_task_go`
(the blocking task) → `analyze_impact` (the task in its slot)

AI traces the chain, finds which task is the delay driver, explains
what's holding it (resource contention, window constraint, or
predecessor not done), and shows what would need to move to pull
the order in.

---

### Tier 3 — Complex Cross-Resource Analysis

**M11 — The End-of-Week Audit**
> "It's Wednesday afternoon. Which orders will make their due dates
> and which are at risk?"

Tools: answered from context (orders, fill rates, due dates) +
`get_chain_detail` (any low fill-rate orders)

AI calculates remaining work vs remaining capacity for each order,
flags any that can't complete on time, and identifies which
specific tasks are the blockers.

---

**M12 — The What-If Strategy**
> "If I unschedule WO-1006, which currently infeasible tasks
> would benefit most?"

Tools: `analyze_impact` (WO-1006 chain) →
answered from context (infeasible tasks and their bottleneck resources)

AI shows exactly which resources WO-1006 is holding, then matches
those against the bottleneck resources of infeasible tasks to
identify the biggest beneficiaries.

---

---

## Cross-Tenant Showstopper Questions

These demonstrate the engine is truly generic — same tools, same AI, different domain:

| Question | Tenant | Why it's a showstopper |
|----------|--------|------------------------|
| "Which [ORs / fields / machines] are free Thursday afternoon?" | All 3 | Same tool, different resource types |
| "What happens if I remove [CASE-001 / WO-1006 / this Saturday's Majors game]?" | All 3 | analyze_impact works across domains |
| "Walk me through tomorrow — what's confirmed and what's at risk?" | All 3 | AI builds narrative from multiple tool calls |
| "What's the bottleneck right now?" | All 3 | Pattern recognition across infeasible tasks |

---

## Demo Sequence Recommendation

For a live demo, run these in order — they build on each other:

1. **Start simple:** H5 / S3 / M3 — "Which cases are infeasible?" (no tool, instant)
2. **Single tool:** H1 / S1 / M1 — attribute query (shows query_resources)
3. **Investigation:** H7 / S7 / M7 — multi-tool chain (shows tool chaining)
4. **What-if:** H11 / S8 / M12 — impact analysis (shows analyze_impact)
5. **Full audit:** H13 / S12 / M11 — narrative response (shows AI synthesizing multiple tools)

Total demo time per tenant: ~8-10 minutes.
