# Operation → Group → Machine Preference Mapping — Spec

**Date:** 2026-07-28
**Status:** DRAFT — for review before implementation
**Branch context:** `feature/dispatch-strategy`
**Related:** `docs/Stafford/integration-semantics-reference.md`, Allan's dispatch-model email (2026-07), `scripts/capture-genius.py`, commit `47179d4` (operationEntity capture + mock-genius support)

## Purpose

Materialize Stafford's dispatch model into CTP task resource preferences at
mapping (promote) time, and validate the mapping before anything reaches the
solver. This implements the rule agreed with Stafford:

> Build resource preferences on a task by first finding any finite resources
> that match the group-code lookup. If none are found, default to the infinite
> resource for the group. This is a validation of the mapping before we start
> scheduling.

Per the architecture rule (ETL transforms upstream of the engine), all
resolution happens in the mapping pipeline. The engine consumes materialized
`preferences[]` and never sees Genius vocabulary.

---

## 1. Source data model (WORK7, verified 2026-07-28)

### 1.1 operationEntity — the routing vocabulary

New entity, discovered by live probe 2026-07-28. 50 records (49 active + one
junk `-` record filtered by `Active=true`). Now captured by
`scripts/capture-genius.py` and served by mock-genius.

| Field | Use |
| --- | --- |
| `Code` | Operation code — joins from `task.OperationCode` |
| `GroupCode` | Machine group the operation belongs to |
| `Description1` | Human label (e.g. `PDA` = "POLISH TO 180G DA FINISH") |
| `Active` | Master-data lifecycle; capture filter |
| `HourCapacityPerDay`, `NumOfAvgResource`, `OperatingDayPerWeek` | **All zero at Stafford — ignore.** Capacity truth lives on resources. |

Many-to-one is the norm: `L005`–`L060` (laser thickness variants) → `L`;
nine polish variants (`PDA`, `PBB`, `PDE`, `PDS`, `PEX`, `PIN`, `PLL`, `POA`,
`PRB`) → `P`; `QC`/`QH`/`QM` → `Q`; `GBB` → `G`.

### 1.2 machineAndRessourceEntity — groups are implicit

There is **no group entity** in the data (`MachineGroupCode` is null on all 68
resources). The group structure is:

- **Infinite header** (`IsFinite=false`, `RessourceType=W`, `GroupId=1802`):
  one per group. Carries the aggregate capacity formula inputs
  (`NumOfAvgResource × HourCapacityPerDay × OperatingDayPerWeek × Efficiency`).
- **Finite members** (`IsFinite=true`, `RessourceType=R`, `GroupId=1801`):
  the schedulable machines/people. Some groups' members are named individuals
  (e.g. all 12 fabrication members are welders: GRANT, ADRIAN, …).

**Join rule (empirically verified):** `GroupCode` matches the header's `Code`
for most groups; for a minority (`QC`→`Q` style) it matches the header's
`OperationsCode`. Resolution order: **header `Code` first, then
`OperationsCode`.** Across the 2026-07-16 task capture: 1,648 tasks resolve
via `Code`, 83 via `OperationsCode`, 0 unresolvable.

A finite member belongs to group G iff
`lookup[member.OperationsCode].GroupCode === G`.

### 1.3 productionTaskWithAdvancedInfoViewEntity — the task side

- `OperationCode` — always present; 100% resolve through operationEntity.
- `MachineCode` — where Genius currently places the task:
  - **Infinite header code** (1,223 of 1,731 open tasks, ~3,250 remaining
    machine-hrs): unallocated — contributes to group load, awaiting dispatch.
  - **Finite member code** (504 tasks, ~4,060 hrs): an explicit assignment.
  - **Cross-group finite** (77 tasks): machine's group ≠ op's group (e.g.
    `NT` tasks on `T-01`/`V-01`, `DR` on `D-0x`, `PR` on `K-02`). These are
    deliberate scheduler overrides, mostly from header-only groups (see 2.3).
  - **Dangling** (4 tasks): `P-05`, absent from the Active=true resource
    master (retired machine still holding open tasks).

### 1.4 Header-only groups

Groups with an infinite header but **zero finite members** (as of 2026-07-16):
`DR`, `LE`, `LP`, `NA`, `OUT`, `PM`, `PR`, `R`, `S`, `ZIND`.
Work in these groups cannot be dispatched to a real machine; it stays on the
header as load (Allan: "unallocated but contribute to total load").

---

## 2. Preference-building rule

Runs in the mapping pipeline at promote time, after entity mapping, before the
atomic snapshot. For each task:

```
group   = lookup[task.OperationCode].GroupCode      // step 0 — hard error if missing
members = finite resources of group                  // via 1.2 join rule
machine = resource named by task.MachineCode         // may be header, member, or missing
```

| # | Condition | capacityResources[0] emitted |
| --- | --- | --- |
| R1 | `machine` is a **finite** resource (any group) | `machine` with `mode: REQUIRED`, rank 1; group `members` (minus machine) appended as `mode: AVAILABLE` |
| R2 | `machine` is the **infinite header** and `members` non-empty | all `members` as `mode: PREFERRED`, ranked (see 2.2) |
| R3 | `machine` is the **infinite header** and `members` empty (header-only group) | the header itself, single preference |
| R4 | `machine` missing from resource master | fall back to R2/R3 by group; **flag in validation report** |

### 2.1 Pin semantics (R1)

A finite `MachineCode` is treated as a **hard pin** (`REQUIRED`) by default:
we respect Genius's current assignments until Stafford tells us which
assignments are *constraints* (only this machine/person can do it) versus
*decisions* (a scheduler happened to pick it). The engine's preference-mode
enum makes the float knob a data change, not a code change: flipping a task's
pin from `REQUIRED` → `PREFERRED` re-admits the rest of the group as
alternates. This is the seam for the pinned-vs-float control and its UI later.

Cross-group pins (the 77 tasks) need no special handling — the pin wins, and
the group members ride along as `AVAILABLE` for future unpinning.

Note: engine semantics (`getEffectivePreferences`) — if any `REQUIRED`
preference exists, ONLY required ones are kept. So R1 emits a hard bind while
still recording the alternates for the day the pin is relaxed.

### 2.2 Ranking within a group (R2)

Initial rule: rank by `Efficiency` descending, then by resource `Code` for
stability. All members in current data share one efficiency per group, so this
starts as effectively stable-order; the solver's comparison across candidates
is what actually chooses placement. Revisit if Stafford supplies real
per-member skill/preference data.

### 2.3 Distribution flag (per-tenant)

`mapping.dispatch.distributeUnassigned: boolean` (default **true**).

- `true` — R2 as specified: unassigned tasks get the full member list and the
  solver distributes. This is Stafford's stated intent ("distribute the tasks
  … using your solvers to allow us to choose best plan").
- `false` — R2 degrades to R3 (stay on the header): pure load-bucket mode,
  useful for a capacity-only view or a conservative first deploy.

---

## 3. Storage — what lands where

| Relationship | Where it lives | Consumer |
| --- | --- | --- |
| op → group (operationEntity) | Mapping-time lookup table only; **not** a CTP entity | MappingEngine |
| group → members | Derived at mapping time from resources; group code already stamped on `resource.hierarchy.level2` | MappingEngine, UI grouping |
| task → op, group (traceability) | Task `attributes`: `{name:"OperationCode"}`, `{name:"GroupCode"}` | UI, inspector, debugging |
| task → candidate machines | `capacityResources[0].preferences[]` (grouped format: `{resource, rank, mode}`) | Engine (already supported end-to-end: hydrator `state-hydrator.service.ts` "GROUPED (healthcare)" path; `classifyPreferences`/combination engine) |

**No engine change. No hydrator change. No new CTP entity.** The whole build
is mapping logic + the validation report.

---

## 4. Validation report (pre-scheduling gate)

Emitted by the preference build at promote time as a sidecar artifact
(`_dispatch-validation-report.json` + console summary). Checks, with current
WORK7 baseline:

| Check | Severity | Baseline (2026-07-16 tasks × 2026-07-28 ops) |
| --- | --- | --- |
| Task `OperationCode` missing from operationEntity | ERROR (blocks promote) | 0 |
| Op `GroupCode` resolving to no header resource | ERROR | 0 |
| Task `MachineCode` absent from resource master | WARN → R4 fallback | 4 tasks (`P-05`) |
| Tasks on header-only groups (R3 fallback) | INFO — counts per group | `DR`, `PR`, `LP`, `LE`, `PM`, `R`, `S`, `ZIND`, `NA`, `OUT` |
| Cross-group pins (machine group ≠ op group) | INFO — list | 77 tasks |
| Pinned vs float split | INFO — hrs + counts | 504 pinned / 1,223 float-eligible |
| Header formula capacity vs Σ(member capacity) | WARN if drift > tolerance | e.g. `F`: header 11×8×5×0.75 = 330 hrs/wk vs members 12×8×5×0.90 = 432 hrs/wk |

The report doubles as the artifact to review with Allan/Kaleb: "here is what
your data says the pools are — confirm before we schedule against them."
ERROR-level findings block promote; WARN/INFO do not.

---

## 5. Implementation touchpoints

Done (commit `47179d4`):
- `scripts/capture-genius.py` — `operationEntity` (`Active=true`) in `ENDPOINTS`
- `tools/mock-genius/src/server.ts` — `operationEntity` in `GENIUS_ENTITIES`

To build:
1. **Adapter config** (`config/tenants/stafford-*/integration/adapter.json`) —
   add `operationEntity` source (keep filter in sync with capture script per
   the comment convention).
2. **MappingEngine** — preference-build pass (§2) + traceability attributes
   (§3). Runs after entity mapping, before snapshot promote.
3. **Validation report** (§4) — same pass; sidecar + console summary;
   ERROR blocks promote.
4. **`scripts/dump-ctp-shape.js`** — pick up the new pass so file tenants
   (`stafford-engineering-test` → slim slices) regenerate with preferences.
5. **Fixture refresh** — next full capture includes operationEntity; re-run
   playbook Phases 2–7; slim tenants re-slice with preferences populated.
6. **Tests** — mapping-unit tests for R1–R4 + join rule (Code-then-
   OperationsCode), report-shape test, and one e2e through dump against the
   mock fixture.

Out of scope (later sprints): pinned/float UI control + Gantt visualization;
availability/calendar exceptions (Allan agreed to defer); writeback of chosen
plan to Genius (beta is read-only).

---

## 6. Open questions for Stafford

1. **Pin intent.** Of the 504 finite assignments, which are constraints vs
   decisions? Bulk answer per group is fine (e.g. "polishing is
   interchangeable; NC mills are operator-bound"). Drives default
   `REQUIRED` vs `PREFERRED` per group.
2. **Header-only groups.** `DR`/`PR`/`LP`/`LE`/`PM` etc. have no finite
   members — is that intended (planning-only buckets), or should members
   exist? Related: their work is today hand-placed onto other groups'
   machines (the 77 cross-group pins).
3. **Capacity truth.** Header formula vs member sum disagree (F: 330 vs 432
   hrs/wk — headcount 11 vs 12 and efficiency 75% vs 90%). Which is the
   number Stafford plans against? Is the header's 75% a deliberate derate?
4. **`P-05`.** Retired machine with 4 open tasks — reassign in Genius, or
   should we map it to the P group automatically (R4)?
5. **Member ranking.** Any real preference order within a group (skill,
   tooling), or is solver-chosen placement acceptable everywhere?
