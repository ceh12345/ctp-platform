# Tenant: Stafford Engineering

**What it does:** Creates a job shop / contract manufacturing tenant modeled on Stafford Engineering in Hamilton, New Zealand. 51-200 employees, three departments (Machining, Fabrication, Assembly), producing custom processing and packaging equipment for food, dairy, and pharma clients globally. ASME U-Stamp certified pressure vessel manufacturer.

**Tenant key:** `stafford-engineering`  
**Tenant name:** Stafford Engineering  
**Timezone:** Pacific/Auckland (NZST, UTC+12)

---

## Overview

Stafford Engineering is a contract manufacturer / job shop. Every project is different — custom pressure vessels, processing equipment, packaging machines. Work flows across three departments: Machining cuts the parts, Fabrication welds and forms them, Assembly puts the final product together and tests it.

The scheduling challenge: shared CNC machines across multiple projects, skilled operators with specific certifications (ASME welding, CNC programming), multi-department routings where jobs bounce between machining and fabrication before reaching assembly, and global customers expecting firm delivery dates.

This is NOT batch manufacturing (same product repeated). This is project-based job shop scheduling — each work order has a unique routing, unique resource requirements, and a customer-committed delivery date.

---

## Part 1: Horizon

Create `config/tenants/stafford-engineering/data/horizon.json`

```json
{
  "startDate": "2026-03-16T06:00:00+12:00",
  "endDate": "2026-03-28T18:00:00+12:00"
}
```

Two weeks: Monday March 16 through Friday March 27. Standard NZ business hours.

---

## Part 2: Resources (28)

Create `config/tenants/stafford-engineering/data/resources.json`

### Machining Department (9 resources)

| Key | Name | Type | Class | Calendar | Notes |
|-----|------|------|-------|----------|-------|
| CNC-LATHE-01 | Okuma LB3000 CNC Lathe | CNCLathe | REUSABLE | Day+Swing | Large turning, up to 500mm diameter |
| CNC-LATHE-02 | Mazak QT-250 CNC Lathe | CNCLathe | REUSABLE | Day+Swing | Medium turning, bar feed capable |
| CNC-MILL-01 | DMG Mori DMU 50 5-Axis Mill | CNCMill | REUSABLE | Day+Swing | 5-axis, complex geometry |
| CNC-MILL-02 | Haas VF-3 Vertical Mill | CNCMill | REUSABLE | Day+Swing | 3-axis, general purpose |
| CNC-MILL-03 | Haas VF-2 Vertical Mill | CNCMill | REUSABLE | Day only | 3-axis, smaller parts |
| MANUAL-LATHE-01 | Manual Lathe | ManualLathe | REUSABLE | Day only | One-offs, prototypes, repairs |
| MANUAL-MILL-01 | Manual Mill (Bridgeport) | ManualMill | REUSABLE | Day only | Simple ops, deburring |
| LASER-01 | Trumpf TruLaser 3030 | Laser | REUSABLE | Day+Swing | Flat sheet cutting, stainless + mild |
| SAW-01 | Behringer Band Saw | Saw | REUSABLE | Day+Swing | Raw material cutting |

### Fabrication Department (7 resources)

| Key | Name | Type | Class | Calendar | Notes |
|-----|------|------|-------|----------|-------|
| WELD-BAY-01 | Welding Bay 1 (TIG) | WeldBay | REUSABLE | Day+Swing | TIG welding, stainless specialty |
| WELD-BAY-02 | Welding Bay 2 (TIG/MIG) | WeldBay | REUSABLE | Day+Swing | TIG and MIG, general |
| WELD-BAY-03 | Welding Bay 3 (MIG) | WeldBay | REUSABLE | Day only | MIG, structural/mild steel |
| PRESS-BRAKE-01 | Trumpf Press Brake | PressBrake | REUSABLE | Day+Swing | Sheet forming, bending |
| ROLL-01 | Plate Roller | Roller | REUSABLE | Day only | Pressure vessel shells, cones |
| POLISH-BAY-01 | Polishing Bay 1 | PolishBay | REUSABLE | Day+Swing | Sanitary finish, food/dairy grade |
| POLISH-BAY-02 | Polishing Bay 2 | PolishBay | REUSABLE | Day only | General finish, deburring |

### Assembly & Test Department (4 resources)

| Key | Name | Type | Class | Calendar | Notes |
|-----|------|------|-------|----------|-------|
| ASSEMBLY-01 | Assembly Bay 1 (Large) | AssemblyBay | REUSABLE | Day+Swing | Full machine assembly, overhead crane |
| ASSEMBLY-02 | Assembly Bay 2 (Medium) | AssemblyBay | REUSABLE | Day only | Sub-assemblies, smaller equipment |
| TEST-BAY-01 | Hydrostatic Test Bay | TestBay | REUSABLE | Day only | Pressure vessel testing, ASME compliance |
| PAINT-01 | Paint / Coating Booth | PaintBooth | REUSABLE | Day only | Primer, paint, powder coat |

### People (8)

| Key | Name | Type | Class | Calendar | Qualifications |
|-----|------|------|-------|----------|---------------|
| MACH-JAMES | James T. (Machining Foreman) | Machinist | REUSABLE | Day 6:00-14:30 Mon-Fri | All CNC + manual, programming, 5-axis qualified |
| MACH-RYAN | Ryan K. (CNC Machinist) | Machinist | REUSABLE | Day 6:00-14:30 Mon-Fri | CNC lathe + mill, not 5-axis |
| MACH-SAM | Sam W. (CNC Machinist) | Machinist | REUSABLE | Swing 14:30-23:00 Mon-Thu | CNC lathe + mill, 5-axis qualified |
| FAB-JACK | Jack P. (Fabrication Foreman) | Welder | REUSABLE | Day 6:00-14:30 Mon-Fri | ASME certified TIG, all materials, press brake |
| FAB-LUKE | Luke M. (Welder/Fabricator) | Welder | REUSABLE | Day 6:00-14:30 Mon-Fri | TIG + MIG, stainless + mild, polishing |
| FAB-AROHA | Aroha T. (Welder/Fabricator) | Welder | REUSABLE | Swing 14:30-23:00 Mon-Thu | TIG + MIG, press brake, roller |
| ASSY-HAYDEN | Hayden S. (Assembly Foreman) | Fitter | REUSABLE | Day 6:00-14:30 Mon-Fri | Full assembly, testing, commissioning |
| ASSY-MATT | Matt R. (Fitter) | Fitter | REUSABLE | Day 6:00-14:30 Mon-Fri | Assembly, painting, basic machining |

---

## Part 3: Calendars

Create `config/tenants/stafford-engineering/data/calendars.json`

### Shift Patterns

**Day Shift: 6:00-14:30 Monday-Friday** (30 min unpaid lunch 10:00-10:30)
Applies to: MACH-JAMES, MACH-RYAN, FAB-JACK, FAB-LUKE, ASSY-HAYDEN, ASSY-MATT, CNC-MILL-03, MANUAL-LATHE-01, MANUAL-MILL-01, WELD-BAY-03, ROLL-01, POLISH-BAY-02, ASSEMBLY-02, TEST-BAY-01, PAINT-01

**Swing Shift: 14:30-23:00 Monday-Thursday** (no swing on Friday)
Applies to: MACH-SAM, FAB-AROHA

**Day + Swing (both shifts): 6:00-23:00 Mon-Thu, 6:00-14:30 Fri**
Applies to: CNC-LATHE-01, CNC-LATHE-02, CNC-MILL-01, CNC-MILL-02, LASER-01, SAW-01, WELD-BAY-01, WELD-BAY-02, PRESS-BRAKE-01, POLISH-BAY-01, ASSEMBLY-01

### Maintenance Windows

- CNC-MILL-01 (5-axis): Friday 6:00-8:00 (weekly spindle warm-up and calibration)
- LASER-01: Wednesday 6:00-7:00 (optics cleaning)
- TEST-BAY-01: Monday 6:00-7:00 (gauge calibration)

### Public Holidays (NZ)

None in the March 16-27 window. Nearest is Good Friday April 3.

---

## Part 4: Products / Project Types & Routings

Create `config/tenants/stafford-engineering/data/processes.json`

### Project Type 1: Pressure Vessel (ASME)

Complex, multi-department, longest lead time. Stafford's specialty.

```
Raw Cut → Machine Flanges → Roll Shell → Weld Shell → Weld Nozzles → Hydro Test → Polish → Paint → Final Assembly
```

| Step | Name | Type | Duration | Resources | maxGap | Notes |
|------|------|------|----------|-----------|--------|-------|
| 1 | Raw Material Cut | SETUP | 1.5 hrs | SAW-01 + 1 Machinist | — | Cut plate and bar stock |
| 2 | Machine Flanges | PROCESS | 4 hrs | CNC-LATHE-01 or CNC-LATHE-02 + 1 Machinist | 24 hrs | Turn flanges to spec |
| 3 | Laser Cut Shell Blanks | PROCESS | 2 hrs | LASER-01 | 24 hrs | Flat sheet to pattern |
| 4 | Roll Shell | PROCESS | 3 hrs | ROLL-01 + 1 Welder | 8 hrs | Form cylinder from flat |
| 5 | Weld Longitudinal Seam | PROCESS | 4 hrs | WELD-BAY-01 + FAB-JACK | 4 hrs | **ASME — requires certified welder (Jack only)** |
| 6 | Weld Nozzles & Fittings | PROCESS | 6 hrs | WELD-BAY-01 or WELD-BAY-02 + 1 Welder | 8 hrs | Multiple weld-ons |
| 7 | Hydrostatic Test | PROCESS | 3 hrs | TEST-BAY-01 + ASSY-HAYDEN | 24 hrs | **ASME compliance test** |
| 8 | Polish (Sanitary) | PROCESS | 5 hrs | POLISH-BAY-01 + 1 Welder | 48 hrs | Food/dairy grade finish |
| 9 | Paint / Coat | PROCESS | 3 hrs | PAINT-01 + ASSY-MATT | 48 hrs | Exterior coating |
| 10 | Final Inspection & Tag | TEARDOWN | 2 hrs | ASSEMBLY-01 + ASSY-HAYDEN | 24 hrs | ASME stamp, documentation |

### Project Type 2: Processing Equipment Frame

Fabrication-heavy, moderate machining. Common for food processing clients.

```
Laser Cut → Bend/Form → Weld Frame → Machine Mounting Points → Polish → Assembly → Test
```

| Step | Name | Type | Duration | Resources | maxGap | Notes |
|------|------|------|----------|-----------|--------|-------|
| 1 | Laser Cut Components | SETUP | 2.5 hrs | LASER-01 | — | Multiple sheet parts |
| 2 | Bend & Form | PROCESS | 3 hrs | PRESS-BRAKE-01 + 1 Welder | 24 hrs | |
| 3 | Weld Frame | PROCESS | 8 hrs | WELD-BAY-01 or WELD-BAY-02 + 1 Welder | 8 hrs | Major fabrication step |
| 4 | Machine Mounting Points | PROCESS | 3 hrs | CNC-MILL-02 or CNC-MILL-03 + 1 Machinist | 24 hrs | Precision bolt patterns |
| 5 | Polish (Sanitary) | PROCESS | 4 hrs | POLISH-BAY-01 or POLISH-BAY-02 + 1 Welder | 48 hrs | |
| 6 | Sub-Assembly | PROCESS | 6 hrs | ASSEMBLY-02 + 1 Fitter | 48 hrs | |
| 7 | Test & Sign-Off | TEARDOWN | 2 hrs | ASSEMBLY-01 + ASSY-HAYDEN | 24 hrs | |

### Project Type 3: Machined Component Set

Machining-heavy, minimal fabrication. Precision parts for packaging machines.

```
Raw Cut → CNC Turn → CNC Mill → Deburr/Finish → QC Check → Pack
```

| Step | Name | Type | Duration | Resources | maxGap | Notes |
|------|------|------|----------|-----------|--------|-------|
| 1 | Raw Cut | SETUP | 45 min | SAW-01 + 1 Machinist | — | |
| 2 | CNC Turn | PROCESS | 3 hrs | CNC-LATHE-01 or CNC-LATHE-02 + 1 Machinist | 24 hrs | |
| 3 | CNC Mill | PROCESS | 4 hrs | CNC-MILL-01 or CNC-MILL-02 or CNC-MILL-03 + 1 Machinist | 24 hrs | |
| 4 | Deburr & Finish | PROCESS | 1.5 hrs | MANUAL-MILL-01 or POLISH-BAY-02 + 1 Machinist | 48 hrs | Hand finish |
| 5 | QC Dimensional Check | PROCESS | 1 hr | ASSEMBLY-02 + ASSY-HAYDEN | 48 hrs | CMM / manual gauging |
| 6 | Clean & Pack | TEARDOWN | 1 hr | ASSEMBLY-02 + 1 Fitter | 24 hrs | |

### Project Type 4: Repair / Service Job

Quick turnaround, uses manual machines, fits in gaps. Often urgent.

```
Inspect → Machine Repair → Weld Repair → Test → Return
```

| Step | Name | Type | Duration | Resources | maxGap | Notes |
|------|------|------|----------|-----------|--------|-------|
| 1 | Strip & Inspect | SETUP | 2 hrs | ASSEMBLY-02 + 1 Fitter | — | |
| 2 | Machine Repair | PROCESS | 3 hrs | MANUAL-LATHE-01 or CNC-LATHE-02 + 1 Machinist | 24 hrs | |
| 3 | Weld Repair | PROCESS | 2 hrs | WELD-BAY-02 or WELD-BAY-03 + 1 Welder | 8 hrs | |
| 4 | Reassemble & Test | PROCESS | 2 hrs | ASSEMBLY-02 + 1 Fitter | 24 hrs | |
| 5 | Sign-Off & Ship | TEARDOWN | 1 hr | ASSEMBLY-02 + ASSY-HAYDEN | 24 hrs | |

### Project Type 5: 5-Axis Complex Component

High-value, requires the DMG 5-axis mill. Only James or Sam are qualified.

```
Program → Raw Cut → 5-Axis Mill Op 1 → 5-Axis Mill Op 2 → Finish → QC
```

| Step | Name | Type | Duration | Resources | maxGap | Notes |
|------|------|------|----------|-----------|--------|-------|
| 1 | CAM Programming | SETUP | 3 hrs | MACH-JAMES | — | **James only — offline programming** |
| 2 | Raw Cut | PROCESS | 1 hr | SAW-01 + 1 Machinist | 48 hrs | |
| 3 | 5-Axis Op 1 (Roughing) | PROCESS | 6 hrs | CNC-MILL-01 + MACH-JAMES or MACH-SAM | 8 hrs | **5-axis qualified only** |
| 4 | 5-Axis Op 2 (Finishing) | PROCESS | 4 hrs | CNC-MILL-01 + MACH-JAMES or MACH-SAM | 4 hrs | Same machine, re-fixture |
| 5 | Hand Finish | PROCESS | 2 hrs | MANUAL-MILL-01 + 1 Machinist | 48 hrs | |
| 6 | QC Final | TEARDOWN | 1.5 hrs | ASSEMBLY-02 + ASSY-HAYDEN | 48 hrs | |

---

## Part 5: Work Orders (15 projects)

Create `config/tenants/stafford-engineering/data/orders.json`

| Order Key | Project Type | Customer | Description | Priority | Due Date | Notes |
|-----------|-------------|----------|-------------|----------|----------|-------|
| PV-001 | Pressure Vessel | Fonterra | 2000L Stainless Mix Tank (ASME) | 30 | Mar 24 | **High priority — major dairy client** |
| PV-002 | Pressure Vessel | Fisher & Paykel Healthcare | Sterilizer Pressure Chamber | 40 | Mar 27 | Medical grade, extra QC |
| EQ-001 | Processing Equipment Frame | Sealed Air NZ | Conveyor Frame Assembly | 50 | Mar 25 | Food packaging line |
| EQ-002 | Processing Equipment Frame | Esko Australia | Cooling Tower Support Platform | 50 | Mar 26 | Export to Australia |
| EQ-003 | Processing Equipment Frame | Local Dairy Co-op | Milk Vat Frame | 60 | Mar 27 | Standard job |
| MC-001 | Machined Component Set | Tetra Pak | Rotary Valve Components (×8) | 40 | Mar 20 | **Short lead — needs fast turnaround** |
| MC-002 | Machined Component Set | Krones AG | Filler Head Assemblies (×12) | 50 | Mar 24 | Export to Germany |
| MC-003 | Machined Component Set | Local Customer | Bearing Housings (×6) | 60 | Mar 26 | Simple job |
| MC-004 | Machined Component Set | Tilt Industrial Design | Custom Lighting Bar Parts | 50 | Mar 25 | Precision aesthetic parts |
| RP-001 | Repair / Service | Fonterra Hautapu | Emergency Pump Shaft Repair | **10** | Mar 18 | **🔥 RUSH — dairy plant down** |
| RP-002 | Repair / Service | Local Winery | Destoner Blade Replacement | 50 | Mar 21 | Routine service |
| CX-001 | 5-Axis Complex Component | US Pharma OEM | Impeller for Mixing Head | 30 | Mar 25 | **5-axis only, James/Sam qualified** |
| CX-002 | 5-Axis Complex Component | Collins Aerospace (via agent) | Aerospace Bracket Prototype | **20** | Mar 21 | **High priority — aerospace client** |
| EQ-004 | Processing Equipment Frame | Stafford Australia | Clutch Mounting Bracket | 50 | Mar 25 | Internal transfer to Aus subsidiary |
| MC-005 | Machined Component Set | Rimtec (via Stafford Aus) | Smooth Torque Clutch Parts (×20) | 40 | Mar 24 | Higher volume, export |

**Total tasks:** ~120 (10+10+7+7+7+6+6+6+6+5+5+6+6+7+6 = 108, plus some with extra steps ≈ 115-120)

---

## Part 6: Tasks

Create `config/tenants/stafford-engineering/data/tasks.json`

Generate tasks for each order following the project type's routing. Each task needs:

- `key`: `{ORDER-KEY}-{STEP-SHORT}` (e.g., `PV-001-CUT`, `PV-001-MACH-FLANGE`, `PV-001-ROLL`)
- `name`: `{Customer} - {Step Name}` (e.g., `Fonterra Tank - Machine Flanges`)
- `type`: SETUP, PROCESS, or TEARDOWN
- `duration`: in seconds
- `process`: project type key
- `priority`: from the order
- `window`: horizon start to due date
- `linkId.name`: order key
- `linkId.prevLink`: previous task key
- `linkId.maxGap`: as specified (in seconds), null if unconstrained
- `capacityResources`: as specified, with `isPrimary: true` on the main equipment

**Operator assignment by qualification:**

| Operator | CNC Lathe | CNC Mill | 5-Axis Mill | Manual Lathe | Manual Mill | Saw | Weld TIG | Weld MIG | Press Brake | Roller | Polish | Assembly | Test | Paint |
|----------|-----------|----------|-------------|-------------|-------------|-----|----------|----------|-------------|--------|--------|----------|------|-------|
| MACH-JAMES | ✓ | ✓ | **✓** | ✓ | ✓ | ✓ | | | | | | | | |
| MACH-RYAN | ✓ | ✓ | | | ✓ | ✓ | | | | | | | | |
| MACH-SAM | ✓ | ✓ | **✓** | | ✓ | ✓ | | | | | | | | |
| FAB-JACK | | | | | | | **✓ ASME** | ✓ | ✓ | ✓ | ✓ | | | |
| FAB-LUKE | | | | | | | ✓ | ✓ | | | ✓ | | | |
| FAB-AROHA | | | | | | | ✓ | ✓ | ✓ | ✓ | | | | |
| ASSY-HAYDEN | | | | | | | | | | | | ✓ | **✓** | |
| ASSY-MATT | | | | ✓ | | | | | | | | ✓ | | ✓ |

Key constraints:
- **5-Axis Mill**: Only MACH-JAMES or MACH-SAM
- **ASME TIG Welding**: Only FAB-JACK (certified welder for pressure vessel seams)
- **Hydrostatic Test**: Only ASSY-HAYDEN (authorized test operator)
- **CAM Programming**: Only MACH-JAMES (offline, doesn't need machine)

**Lane resources:**

- Pressure Vessel: WELD-BAY is the lane across "Weld Seam" and "Weld Nozzles" (same fixture)
- 5-Axis Complex: CNC-MILL-01 is the lane across "Op 1" and "Op 2" (same setup)
- Amoxicillin-style reactor lane doesn't apply here

---

## Part 7: State Changes (Setup/Changeover)

Create `config/tenants/stafford-engineering/data/statechanges.json`

Setup times between different job types on the same machine:

### CNC Machines (Lathe and Mill)

| From | To | Duration | Notes |
|------|----|----------|-------|
| same order | same order | 15 min | Re-fixture within same job |
| machined-components | machined-components | 30 min | Different part, same type |
| machined-components | pressure-vessel | 45 min | Different fixture, different material |
| pressure-vessel | machined-components | 45 min | Full tool change |
| 5-axis-complex | * | 60 min | 5-axis needs full recalibration after |
| * | 5-axis-complex | 60 min | Full setup for 5-axis work |
| * | * | 30 min | Default changeover |

### Weld Bays

| From | To | Duration | Notes |
|------|----|----------|-------|
| same order | same order | 10 min | Same fixture |
| stainless | stainless | 20 min | Same material family |
| mild-steel | stainless | 45 min | **Must clean to prevent contamination** |
| stainless | mild-steel | 15 min | Less critical direction |
| * | * | 20 min | Default |

### Polish Bays

| From | To | Duration | Notes |
|------|----|----------|-------|
| sanitary-finish | sanitary-finish | 15 min | Same grade |
| general | sanitary-finish | 30 min | Must clean abrasives |
| * | * | 15 min | Default |

---

## Part 8: Scoring

Create `config/tenants/stafford-engineering/data/scoring.json`

```json
{
  "name": "Stafford Scoring",
  "key": "stafford-scoring",
  "rules": [
    { "ruleName": "EarliestStartTime", "weight": 0.25, "objective": "MINIMIZE", "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "DueDate", "weight": 0.30, "objective": "MINIMIZE", "includeInSolve": true, "penaltyFactor": 0.5 },
    { "ruleName": "ResourcePreference", "weight": 0.15, "objective": "MINIMIZE", "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "SetupTime", "weight": 0.20, "objective": "MINIMIZE", "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ResourceUtilization", "weight": 0.10, "objective": "MAXIMIZE", "includeInSolve": true, "penaltyFactor": 0 }
  ]
}
```

Due date weight is highest (0.30) — Stafford is a job shop, on-time delivery is their reputation. Setup time weight (0.20) rewards grouping similar jobs on the same machine.

---

## Part 9: Terminology

Create `config/tenants/stafford-engineering/data/terminology.json`

```json
{
  "task": "Operation",
  "order": "Work Order",
  "resource": "Resource",
  "schedule": "Production Schedule",
  "solve": "Schedule",
  "unschedule": "Unschedule",
  "pin": "Lock",
  "rush": "Expedite",
  "infeasible": "Cannot Schedule",
  "conflict": "Scheduling Conflict",
  "chain": "Job Routing",
  "setup": "Setup",
  "process": "Operation",
  "teardown": "Final",
  "gantt": "Shop Floor Plan",
  "analytics": "Production Analytics",
  "utilization": "Machine Utilization",
  "feasibilityRate": "Schedule Completion Rate"
}
```

---

## Part 10: Locale

Create `config/tenants/stafford-engineering/data/locale.json`

```json
{
  "locale": "en-NZ",
  "timezone": "Pacific/Auckland",
  "dateFormat": "d MMM yyyy",
  "timeFormat": "h:mm a",
  "actions": {
    "solve": "Schedule",
    "sync": "Reload",
    "solveAndSync": "Reload & Schedule",
    "retry": "Retry"
  }
}
```

Note: NZ date format is `d MMM yyyy` (16 Mar 2026), not US `MMM d, yyyy`.

---

## Part 11: App Settings

Create `config/tenants/stafford-engineering/data/appSettings.json`

```json
{
  "solverStrategy": "Chain",
  "requiresPreds": false,
  "maxChainCombos": 500,
  "resetUageAfterProcessChange": true,
  "detailLevel": "intermediate"
}
```

---

## Part 12: Colors

Create `config/tenants/stafford-engineering/data/colors.json`

```json
{
  "pressure-vessel": "#EF4444",
  "processing-equipment": "#3B82F6",
  "machined-components": "#10B981",
  "repair-service": "#F59E0B",
  "5-axis-complex": "#8B5CF6",
  "SETUP": "#94A3B8",
  "PROCESS": "#3B82F6",
  "TEARDOWN": "#6B7280"
}
```

Pressure vessels in red (high value, high visibility). Machined components in green (bread and butter work). Repairs in amber (urgent). 5-axis in purple (specialty).

---

## Part 13: Designed Bottlenecks & Demo Scenarios

### 1. ASME Welder Bottleneck (Jack)
FAB-JACK is the only ASME-certified welder. Both pressure vessels (PV-001, PV-002) need him for the longitudinal seam weld. Plus he's the fabrication foreman doing general work. He's THE bottleneck for pressure vessel work.

**Demo:** "Why is PV-002's seam weld scheduled Thursday instead of Monday?" → "Jack is the only ASME-certified welder. He's doing PV-001's seam weld Monday-Tuesday and general fab work Wednesday."

### 2. 5-Axis Contention (James vs Sam, day vs swing)
CX-001 and CX-002 both need the 5-axis mill (CNC-MILL-01) with either James or Sam. CX-002 is high priority (aerospace client). James works day shift, Sam works swing. The 5-axis mill runs both shifts — but the CAM programming (Step 1) requires James specifically.

**Demo:** CX-002 (aerospace, priority 20) should schedule before CX-001. James programs both but can only do one at a time. Sam picks up the machining on swing shift.

### 3. Rush Repair (Fonterra Pump)
RP-001 is a dairy plant emergency — Fonterra's pump is down, they need the shaft repaired ASAP (due Mar 18, priority 10). This should jump to the front of the queue, displacing lower-priority work on the manual lathe and weld bays.

**Demo:** Show RP-001 at the front of the schedule. "What did it displace?" → AI shows which jobs slid.

### 4. Cross-Department Routing
PV-001 (pressure vessel) touches all three departments: Machining (flanges) → Fabrication (roll, weld, polish) → Assembly (test, paint, final). Each department handoff is a potential gap. The maxGap constraints keep the chain tight.

**Demo:** Filter by PV-001 on the Gantt → see it flow across machine, weld bay, test bay, paint booth. Chain integrity shows gaps between departments.

### 5. Material Contamination Changeover
If mild steel jobs run on a weld bay before a stainless sanitary job, there's a 45-minute decontamination changeover. Running stainless jobs back-to-back on WELD-BAY-01 saves time.

**Demo:** Analytics shows changeover time as a KPI. Compare: scattered stainless/mild = high changeover. Campaign stainless together = lower changeover.

### 6. CTP Query — New Customer Quote
"A new customer wants 15 custom valve bodies machined. Can we fit it in by March 25?"

**Demo via AI:** "Can I schedule a machined component job like MC-002 for a new customer, due March 25?" → AI returns options showing which CNC machines have capacity and when the job could ship.

### 7. Laser Cutter as Shared Resource
LASER-01 serves both fabrication (cutting sheet for frames and vessels) and machining (cutting raw stock). Multiple projects need it early in their routing. It's a shared bottleneck early in the pipeline.

---

## Part 14: Verification

After CC builds the dataset:

- [ ] `?tenant=stafford-engineering` loads correctly
- [ ] 28 resources visible on Gantt across three department groups
- [ ] Solve produces a schedule with ~105-115 of ~120 tasks scheduled
- [ ] RP-001 (Fonterra emergency) schedules first (priority 10, due Mar 18)
- [ ] CX-002 (aerospace) schedules before CX-001 (priority 20 vs 30)
- [ ] PV-001 and PV-002 seam welds both assigned to FAB-JACK (ASME requirement)
- [ ] PV-002 seam weld scheduled AFTER PV-001's (Jack can only do one at a time)
- [ ] 5-axis operations (CX-001, CX-002) only assigned to MACH-JAMES or MACH-SAM
- [ ] CAM programming only assigned to MACH-JAMES
- [ ] Day shift operators not scheduled during swing hours and vice versa
- [ ] Swing shift operators not scheduled on Fridays (no swing on Friday)
- [ ] maxGap constraints respected (4hr gap between roll and weld, etc.)
- [ ] Changeover gaps visible between different material types on weld bays
- [ ] Lane resource maintained: same weld bay for seam + nozzle welds on each vessel
- [ ] Lane resource maintained: same CNC-MILL-01 for 5-axis Op 1 and Op 2
- [ ] Terminology: "Work Order" for orders, "Operation" for tasks, "Resource" for resources
- [ ] NZ locale: dates show "16 Mar 2026" format, Pacific/Auckland timezone
- [ ] Colors: red for pressure vessels, blue for frames, green for machined, amber for repairs, purple for 5-axis
- [ ] AI chat: "What's the bottleneck?" → FAB-JACK (ASME welder)
- [ ] CTP query: "Can I fit a new machining job by March 25?" evaluates correctly

Commit: "feat(tenant): Stafford Engineering — NZ job shop demo with 28 resources, 15 projects, ~120 operations"
