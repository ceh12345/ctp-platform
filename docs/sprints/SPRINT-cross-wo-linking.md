# SPRINT: Cross-WO Linking — Hydrator-Derived Group Precedence

**Status:** Groundwork landed; enforcement BLOCKED on chain-grouping redesign (Option A)
**Branch:** main (additive — mapping config, hydrator derivation)
**Author:** Chris
**Purpose:** Hydrator wires task-level `prevLink` relationships across Work Order boundaries when the tenant configures it. The platform's data model carries cross-WO precedence as first-class data; the engine respects it without knowing it crosses a WO boundary.

---

## Status & findings (2026-06-23)

**Landed (correct groundwork, all tests green — 1240 tests):**
- Schema `crossWOLinking: 'none' | 'bomParentChild'` on `IMappingProfile`.
- Hydrator `deriveCrossWOLinks` / `wireCrossWOLinks` (after `rebuildGroups`): wires each child WO's chain tail → parent WO's chain head `prevLink`, stamps `groupKey`, validates (enum + group capability), v1 single-edge, summary logging.
- Engine adjacency `realPrevKey` honours same-WorkOrderGroup cross-chain edges; both `assertSequenceMatchesLinkId` variants scoped to same-chain; `deriveSequencesFromLinkId` untouched.
- Stafford engineering-test config set to `bomParentChild`. Tests: 8 cross-WO + 3 adjacency (incl. AC-4 topoOrder).

**Live test on slim-100 (10 links wired) — enforcement FAILS:** all 9 wired parent/child pairs schedule the parent *before* the child. The edge is wired and present (`predKey` carries it), but the schedule ignores it.

**Root cause:** the Chain strategy evaluates each WO-chain in isolation. `ChainContextEngine.evaluateChain` (`chaincontextengine.ts:152-159`) sets `const tasks = chain.tasks` (exactly one `linkId.name`) then `buildAdjacency(tasks)` on that subset. The cross-WO predecessor lives in a *different* chain, so it's absent from the subset → `realPrevKey` drops it → the parent head evaluates with no predecessor → scheduled at its own window start. (Unit tests passed because they ran `buildAdjacency` on the full task set; the live scheduler rebuilds it per-chain.)

**Decision: Option A** — group cross-WO-linked WOs into a single schedulable chain (by connected pred-component / WorkOrderGroup) so `ChainContextEngine` evaluates them together, instead of grouping chains by `linkId.name`. **Design doc forthcoming (Chris).** Enforcement deferred to that work; the groundwork above stands and feeds it (the wired `prevLink` edges are what A's grouping will consume).

---

## Why this sprint exists

Stafford's data has WorkOrderGroups with BOM-tree relationships (parent WO + child WOs via `parentOrderKey`). The platform knows the structure but doesn't currently wire it into task-level precedence — the engine sees each WO as an independent chain.

The result: cross-WO scheduling order isn't enforced. The engine can place a parent WO's tasks before its children's because there's no `prevLink` saying "wait."

This sprint wires the relationship into the data model at sync time, then makes the precedence machinery honour it. Cross-WO links use the existing `prevLink` field, but precedence is currently scoped to **within a single chain** (`linkId.name`) in two places — both drop a `prevLink` that points into another WO. So wiring alone isn't enough; the two same-chain guards must be relaxed to "same chain **or** same WorkOrderGroup" (see [Precedence guard relaxation](#precedence-guard-relaxation-the-one-code-change)). That is the only code change, and it is small. Once it's in, scheduling a subset of WOs works the same way: predecessors are predecessors, regardless of which WO they belong to.

Tenant configuration controls whether wiring happens — the BOM tree means scheduling precedence for some tenants (Stafford) and not for others (reporting-only groupings).

---

## Design principles

1. **Data is the truth.** Cross-WO precedence lives in `prevLink` on tasks. The engine reads, doesn't infer.
2. **Hydrator owns the derivation.** Same pattern as state coherence, sequence derivation, attribute mirroring. Sync-time work; engine consumes clean data.
3. **Tenant config gates the behaviour.** The BOM tree's meaning is tenant-specific. Default off; tenants opt in.
4. **Minimal engine surface.** Cross-WO links are just longer chains *once the precedence machinery accepts same-Group edges*. The code change is the engine adjacency guard (`realPrevKey`) honouring same-WorkOrderGroup cross-chain edges, plus scoping the sequence assertions to same-chain. No new scheduling concepts; the edge-list engine already handles non-linear precedence (`preds[]`/`succs[]` + topological order).
5. **Partial scheduling works automatically.** Because predecessors are predecessors, scheduling a subset of WOs respects the full precedence graph from the data.

---

## Backend / Model

### Schema additions

Tenant mapping config gains a `crossWOLinking` field:

```json
{
  "tenant": "stafford-engineering-test",
  "crossWOLinking": "bomParentChild"
}
```

**Supported values:**

| Value | Behaviour |
|---|---|
| `none` | Hydrator does not wire cross-WO precedence. WOs remain independent chains. **Default if not specified.** |
| `bomParentChild` | Hydrator derives cross-WO `prevLink` from `parentOrderKey`. Child WO's chain tails link to parent WO's chain heads. |

Future extension (out of scope for v1): `explicit` mode reading a tenant-supplied cross-WO link field from source.

### Hydrator behaviour

When `crossWOLinking === "bomParentChild"`, after per-WO task chains are built:

1. For each WorkOrderGroup in the tenant:
   - For each WO in the Group, identify its task **chain heads** (tasks with no within-WO `prevLink`) and **chain tails** (tasks with no within-WO successor).
   - For each WO whose `parentOrderKey` points at another WO in the Group:
     - Wire each of the child WO's chain tails as a `prevLink` predecessor of each of the parent WO's chain heads.
2. Run existing post-derivation passes (sequence derivation, state coherence) against the now-linked data.

The wiring is in-place on the existing `prevLink` field — no new field, no parallel structure. Once wired, a task with a cross-WO predecessor looks identical to a task with a within-WO predecessor.

### What "last task" and "first task" mean

For a WO with a single linear task chain (one head, one tail), the wiring is unambiguous.

For a WO with multiple tails or multiple heads (parallel chains within one WO), the hydrator wires all tails of the child to all heads of the parent — a many-to-many edge expansion. Conservative: ensures all child work completes before any parent work starts.

**Known limit:** For WOs with genuinely DAG-shaped task topology (one task feeding multiple successors within the same WO), the underlying engine `successorOf` map drops edges. That's a separate engine concern, not addressed here. Document as a known limit; defer.

### Precedence guard relaxation (as built)

Engine precedence lives in `preds[]`/`succs[]`, built from `linkId.prevLink` by `buildAdjacency` (`adjacency.ts`). Two changes let a cross-WO `prevLink` flow through cleanly:

1. **Engine adjacency — `Models/Entities/adjacency.ts` `realPrevKey()`** (the one that carries precedence). Previously returned null when `pred.linkId.name !== task.linkId.name`. Now a cross-chain predecessor is honoured when **both tasks share the same non-null `groupKey`** (same WorkOrderGroup). The `!task.groupKey` check is load-bearing — without it two ungrouped tasks (null === null) would wrongly match. Unrelated cross-chain prevLinks (different group, or no group) are still ignored.
2. **Sequence assertions scoped to same-chain — `assertSequenceMatchesLinkId`** in both the hydrator (`state-hydrator.service.ts`) and the engine (`basescheduler.ts`, opt-in `CTP_VALIDATE_SEQUENCE`). These assert that `prevLink` implies a strictly-increasing `sequence`. That invariant is **within-chain only**; cross-WO endpoints have independent per-chain numbering, so the assertion now **skips cross-chain edges** — otherwise a legitimate cross-WO link false-throws "deriveSequencesFromLinkId has a bug."

**`deriveSequencesFromLinkId` is deliberately NOT changed** (the original "relax `realPrev` here too" plan was wrong). It numbers each chain by finding the head (no in-chain pred) and walking forward; relaxing its `realPrev` to accept cross-WO preds would leave the parent chain with no head → cycle fallback → broken within-chain numbering. It already (correctly) ignores the cross-WO prevLink. Sequence is a within-chain concept; cross-WO order is carried entirely by `preds`/`succs` + topological order.

The guard is **scoped to same-Group** (not "any chain") because source data carries stray cross-chain `prevLink`s the platform intentionally ignores; widening fully would wrongly promote those to precedence. The hydrator stamps `groupKey` on both wired endpoints so `realPrevKey` matches. The rest of the engine is untouched — the edge-list refactor already schedules non-linear precedence from `preds`/`succs`.

**v1 is single-edge.** `linkId.prevLink` holds one key, and the derivation populates a single predecessor, so v1 wires **one child tail → one parent head** cleanly. True many-to-many (multi-tail / multi-head) would populate `preds[]` directly — the edge-list engine supports multi-parent precedence, but the single-`prevLink` derivation does not. Treat many-to-many as a known limit (see OI-2); defer.

### Validation

At tenant config load:

- `crossWOLinking` value must be a recognised enum value (`none` or `bomParentChild`).
- If `crossWOLinking: "bomParentChild"` is set but the tenant has no WorkOrderGroups defined, reject with a clear error message: *"crossWOLinking 'bomParentChild' requires WorkOrderGroups to be configured."*

At sync time:

- Log when a child WO's `parentOrderKey` points at a WO not in any Group it belongs to (data integrity warning).
- Log per-Group: number of cross-WO links wired, number of chain tails/heads identified.

---

## Sprint scope

### In scope

- Tenant config schema: `crossWOLinking` field with `none | bomParentChild` enum. Default `none`.
- Hydrator derivation: traverse WO tree per Group; identify chain heads and tails; wire `prevLink` across WO boundaries when mode is `bomParentChild`.
- **Precedence guard relaxation (the engine touch):** `realPrevKey` (engine `adjacency.ts`) honours same-WorkOrderGroup cross-chain edges; `assertSequenceMatchesLinkId` (hydrator + engine, opt-in `CTP_VALIDATE_SEQUENCE`) scoped to same-chain so the cross-WO link doesn't false-throw. `deriveSequencesFromLinkId` unchanged. Wired edges land in `preds[]`/`succs[]`.
- v1 supports one child-tail → one parent-head per parent (single-valued `prevLink`); many-to-many deferred.
- Stafford's tenant config updated to `crossWOLinking: "bomParentChild"`.
- Validation at config load: misconfiguration rejected with clear errors.
- Sync-time logging: cross-WO link counts per Group; data integrity warnings.
- Tests: linked output validation; engine respects the cross-WO predecessors when scheduling.

### Explicitly out of scope

- `explicit` linking mode (read cross-WO links from a source field). Future extension when a tenant needs it.
- DAG-shaped within-WO task topology (one task feeding multiple parallel successors in the same WO). Separate engine concern; the `successorOf` one-successor limit applies here.
- Cross-WO precedence outside the BOM tree (e.g. "this WO must precede that one even though they're not parent/child"). Future need; defer.
- Engine changes. None needed.
- UI surface for cross-WO links. Wired in data; UI rendering is a separate concern if/when it's needed.

### Branch & merge plan

- Branch: `main` directly. Low-risk: schema field with safe default; hydrator derivation step + two guard relaxations. The guard widening is gated by config in effect — cross-WO edges only exist when a tenant sets `bomParentChild` and has Groups, so other tenants' behaviour is unchanged.
- No conflicts with the processing-sequences sprint or current Stafford work.

### Acceptance criteria

1. Stafford tenant config has `crossWOLinking: "bomParentChild"` and loads without error.
2. After sync, child WO chain tails have `prevLink` references into their parent WO's chain heads.
3. A WO's first task that previously had `prevLink: null` (chain head) now has `prevLink` to its child WO's last task (when in `bomParentChild` mode and the child WO exists). **And that cross-WO `prevLink` survives the precedence machinery** — present in `preds[]`/`succs[]` (carried by `realPrevKey`'s same-Group rule), not dropped by the same-chain guard. (Cross-WO order is *not* reflected in `sequence`, which stays per-chain by design.)
4. Engine schedules Stafford's data with cross-WO precedence respected — parent WO's tasks scheduled after all child WOs complete.
5. Scheduling a subset of WOs in a Group respects cross-WO predecessors automatically. (Verified by scheduling just the parent WO and confirming children get pulled in via topological closure, or that the parent waits for child predecessor times if children are already scheduled.)
6. Tenants without `crossWOLinking` defined behave as today (no cross-WO wiring).
7. Validation rejects `crossWOLinking: "bomParentChild"` when the tenant has no Groups.

### Sequencing inside the sprint

1. Schema: add `crossWOLinking` field to tenant mapping config.
2. Validation: enum value check; Groups-present check for `bomParentChild`.
3. Hydrator: chain head/tail identification per WO; cross-WO `prevLink` wiring per Group.
4. Guard relaxation: `realPrevKey` (`adjacency.ts`) accepts same-Group cross-chain edges; scope `assertSequenceMatchesLinkId` (hydrator + engine) to same-chain. `deriveSequencesFromLinkId` left unchanged. Verify the wired edge lands in `preds[]`/`succs[]`.
5. Stafford tenant config update.
6. Tests: linked structure validation; guard accepts same-Group / still rejects unrelated cross-chain; engine integration; partial scheduling.

---

## Open issues

### OI-1: Unscheduled predecessors during partial scheduling

When scheduling a subset of WOs, predecessors outside the scope may have no scheduled time (never scheduled before). Engine behaviour for this case needs confirmation:

- Option A: topological closure — automatically include unscheduled ancestors in the solve.
- Option B: fall back to source's planned start time as the predecessor's effective time.
- Option C: refuse to schedule successors with unscheduled predecessors; surface clear error.

Not strictly in this sprint's scope but adjacent. Worth confirming behaviour for the partial-scheduling case before this sprint claims to enable it.

### OI-2: Multi-tail / multi-head WOs

The hydrator wires every tail of the child to every head of the parent. For WOs with multiple parallel chains, that's many-to-many edges, conservative but correct.

For DAG-shaped within-WO topology (one task → multiple successors in the same WO), the engine's `successorOf` map drops edges. That's a known engine limit, not addressed here. Document; defer.

### OI-3: Cross-Group precedence

The current scope is precedence *within* a Group (parent/child via `parentOrderKey`). Precedence *across* Groups — e.g. Group A's deliverable must complete before Group B's can start — isn't part of the BOM-derived model.

If such a relationship exists in a tenant's data, the `explicit` mode (future extension) would handle it. Not in scope here.

### OI-4: Logging verbosity

Sync-time logging of cross-WO link counts is useful for verification on Stafford's first run. At scale (thousands of Groups), the per-Group log entries get noisy.

Recommend: log summary statistics by default (total Groups processed, total links wired, total warnings); per-Group details only at debug log level.

---

## Notes for Chris (not for CC)

- **IMPLEMENTED.** The sprint is genuinely small. Hydrator gets a new derivation step (`deriveCrossWOLinks`); config gets one field; Stafford engineering-test config gets one value; engine work is `realPrevKey` honouring same-Group cross-chain edges + scoping the two `assertSequenceMatchesLinkId` variants to same-chain. `deriveSequencesFromLinkId` was *not* touched (the earlier "relax `realPrev` there" idea breaks per-chain head detection — verified). The "no engine changes" framing was wrong: cross-WO `prevLink`s are dropped by the same-chain guard in the adjacency build, verified in code. 1239 tests pass (8 new cross-WO + 3 new adjacency).
- The "partial scheduling works for free" claim — OI-1 is the load-bearing case (predecessor never scheduled). Empirically with the edge-list engine: in a subset solve where the child chain isn't in the task set, `topoOrder`/indeg only counts in-set preds, so the parent proceeds; if the child IS in the landscape but unscheduled, the basescheduler retry-skip defers the parent. Not fixed/changed by this sprint; documented as the OI-1 behaviour.
- Default of `none` is conservative. Stafford explicitly opts in. Future tenants either explicitly opt in (if they want BOM-derived precedence) or stay with `none` (each WO independent).
- The `explicit` mode is named in the sprint doc as a future extension point so it's clear the v1 enum isn't the final shape. Don't build it; just don't paint into a corner that prevents it.
