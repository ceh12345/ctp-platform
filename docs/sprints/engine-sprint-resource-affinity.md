# Engine Sprint: Resource Affinity Scoring

**What it does:** Adds a soft scoring rule that prefers resource continuity across chain phases. When the same nurse, anesthesiologist, or equipment is assigned across SETUP → PROC → RECOVERY, the combo scores better. Switching resources between phases incurs a scoring penalty — but it's not a hard constraint. The solver can still pick a different nurse for recovery if that's the only way to fit the chain.

**Why:** In healthcare, patient continuity matters — the same nurse seeing a patient through prep, procedure, and recovery improves care quality and handoff safety. In manufacturing, keeping the same operator across setup and run reduces changeover learning time. Today the solver treats each task's resource selection independently — it might pick Nurse Alpha for SETUP, Nurse Bravo for PROC, and Nurse Charlie for RECOVERY even when Nurse Alpha was available for all three.

**Size:** ~1-1.5 hours  
**Depends on:** Phase 3 Chain Context Engine (done), chain combo scoring in `scoreChainCombos()` (done)  
**Not a hard constraint** — affinity is a preference, not a requirement. A chain with mixed nurses that fits Monday beats a chain with the same nurse that can only fit Wednesday.

---

## Design

### Where It Lives

Resource affinity is scored at the **chain combo level**, not the individual task level. The existing `scoreChainCombos()` in `chaincontextengine.ts` already sums per-task blended scores and adds a gap penalty. Affinity is another penalty term at this level.

This is intentionally NOT a standard scoring rule in `scoring.json` — standard scoring rules operate per-context (one task at a time) and can't see across chain phases. Affinity requires comparing resources across multiple contexts in a combo.

### How It Works

For each chain combo, compare the assigned resources across phases. For each resource type (nurse, anesthesiologist, equipment), check whether the same resource is used across all phases that need it.

```
Combo A: SETUP(NURSE-01) → PROC(NURSE-01) → RECOVERY(NURSE-01)
  Affinity: 100% — same nurse throughout. Penalty: 0

Combo B: SETUP(NURSE-01) → PROC(NURSE-02) → RECOVERY(NURSE-01)
  Affinity: 67% — nurse switched for PROC. Penalty: 0.1

Combo C: SETUP(NURSE-01) → PROC(NURSE-02) → RECOVERY(NURSE-03)
  Affinity: 0% — different nurse every phase. Penalty: 0.2
```

The penalty is proportional to the number of resource switches.

### What Counts as an Affinity Resource

Not every resource type benefits from continuity. ORs don't care — any OR works. But people-type resources (nurses, anesthesiologists, technicians, operators) and some equipment benefit from continuity.

**Option 1: Configure per resource type in tenant config**

Add an `affinity` flag to the resource type configuration:

```json
{
  "resourceTypes": [
    { "type": "Operating Room", "affinity": false },
    { "type": "Surgeon", "affinity": false },
    { "type": "Anesthesiologist", "affinity": true },
    { "type": "Nurse", "affinity": true },
    { "type": "Equipment", "affinity": false },
    { "type": "Recovery Bay", "affinity": false }
  ]
}
```

**Option 2: Configure per resource slot on the task**

Add `affinity: true` to `CTPTaskResource`:

```json
{
  "key": "C003-PROC",
  "capacityResources": [
    { "resource": "OR-*", "isPrimary": true, "affinity": false },
    { "resource": "DR-PATEL", "isPrimary": false, "affinity": false },
    { "resource": "AN-*", "isPrimary": false, "affinity": true },
    { "resource": "RN-*", "isPrimary": false, "affinity": true }
  ]
}
```

**Recommendation: Option 1 (resource type level).** Simpler to configure — you set it once per type, not per task per resource. Most tenants want nurse affinity across ALL chains, not selectively. Task-level override (Option 2) can be added later if needed.

### Affinity Penalty Calculation

```typescript
private computeAffinityPenalty(
  combo: ChainContextCombo,
  affinityTypes: Set<string>,
): number {
  if (affinityTypes.size === 0) return 0;

  // Collect assigned resources per task, grouped by resource type
  const resourcesByType = new Map<string, string[]>();

  for (const ctx of combo.contexts) {
    if (!ctx.slot.resources) continue;

    ctx.slot.resources.forEach(slot => {
      if (!slot.resource) return;
      const resType = slot.resource.type;
      if (!affinityTypes.has(resType)) return;

      if (!resourcesByType.has(resType)) {
        resourcesByType.set(resType, []);
      }
      resourcesByType.get(resType)!.push(slot.resource.key);
    });
  }

  // Count switches per resource type
  let totalSwitches = 0;
  let totalPairs = 0;

  for (const [type, keys] of resourcesByType) {
    for (let i = 1; i < keys.length; i++) {
      totalPairs++;
      if (keys[i] !== keys[i - 1]) {
        totalSwitches++;
      }
    }
  }

  if (totalPairs === 0) return 0;

  // Penalty: switches / total pairs * weight
  const switchRate = totalSwitches / totalPairs;
  return switchRate * affinityPenaltyWeight;
}
```

### Affinity Penalty Weight

The weight needs to be small enough that affinity doesn't override more important objectives (earliness, resource preference rank) but large enough to break ties.

Add to tenant scoring config or app settings:

```json
{
  "affinityPenaltyWeight": 0.05
}
```

At 0.05, a combo with 100% switches gets a 0.05 penalty. Typical blended scores range from 0.3-2.0, so this is a tiebreaker — it won't push a Monday placement to Wednesday just to keep the same nurse, but between two Monday combos it picks the one with better continuity.

### Where to Plug It In

In `scoreChainCombos()`:

```typescript
private scoreChainCombos(
  combos: ChainContextCombo[],
  landscape: SchedulingLandscape,
  scoring: CTPScoring,
): void {
  const scoringEngine = new ScoringEngine();
  const affinityTypes = this.getAffinityTypes(landscape);  // NEW
  const affinityWeight = landscape.appSettings?.affinityPenaltyWeight ?? 0.05;  // NEW

  for (const combo of combos) {
    const savedScores = combo.contexts.map(ctx => ctx.blendedScore.score);

    scoringEngine.computeScores(landscape, combo.contexts, scoring);

    let chainScore = 0;
    for (const ctx of combo.contexts) {
      chainScore += ctx.blendedScore.score;
    }

    // Existing: gap penalty
    const gapPenalty = (combo.totalGap / 60) * 0.1;
    chainScore += gapPenalty;

    // NEW: affinity penalty
    const affinityPenalty = this.computeAffinityPenalty(combo, affinityTypes, affinityWeight);
    chainScore += affinityPenalty;

    combo.chainScore = chainScore;

    combo.contexts.forEach((ctx, i) => { ctx.blendedScore.score = savedScores[i]; });
  }
}
```

---

## Configuration

### Tenant config: `appSettings.json`

Add affinity settings:

```json
{
  "affinityPenaltyWeight": 0.05,
  "affinityResourceTypes": ["Nurse", "Anesthesiologist"]
}
```

If `affinityResourceTypes` is not set or empty, affinity scoring is disabled — zero overhead.

### Per-tenant examples

**Healthcare:**
```json
{
  "affinityPenaltyWeight": 0.05,
  "affinityResourceTypes": ["Nurse", "Anesthesiologist"]
}
```
Same nurse and anesthesiologist across prep/procedure/recovery preferred.

**Manufacturing:**
```json
{
  "affinityPenaltyWeight": 0.03,
  "affinityResourceTypes": ["Operator"]
}
```
Same operator across setup and run preferred (knows the job, less ramp-up).

**HRMD Sports:**
```json
{
  "affinityResourceTypes": []
}
```
No affinity — different umpires per game is fine.

---

## API Response

Include affinity data in the solve response so the UI and AI can report it:

### Per-chain in solve response

```json
{
  "chainKey": "C003",
  "affinityScore": 0.85,
  "affinitySwitches": [
    {
      "resourceType": "Nurse",
      "phases": ["C003-SETUP", "C003-PROC", "C003-RECOVERY"],
      "assigned": ["RN-01", "RN-01", "RN-02"],
      "switched": true,
      "switchAt": "C003-RECOVERY"
    }
  ]
}
```

### In task detail (frontend)

Show affinity status in the task detail panel for chain tasks:

```
Chain Continuity:
  🟢 Anesthesiologist: AN-JONES (all phases)
  🟡 Nurse: RN-01 → RN-01 → RN-02 (switched at Recovery)
```

---

## What NOT to Change

- **Standard scoring rules** — affinity is chain-level, not per-task. Don't add it to `scoring.json` rules.
- **Context explosion** — still generates all resource combos per task. Affinity doesn't filter combos, just scores them.
- **Lane detection** — lanes are hard constraints (same OR). Affinity is soft (prefer same nurse).
- **Combo generation** — unchanged. Affinity operates on already-built combos.

---

## Verification

### Unit Tests

1. **Perfect affinity — zero penalty**
   - 3-task chain, all tasks use RN-01
   - `computeAffinityPenalty` returns 0

2. **Full switch — maximum penalty**
   - 3-task chain: RN-01, RN-02, RN-03
   - 2 switches out of 2 pairs → switchRate = 1.0
   - Penalty = 1.0 × 0.05 = 0.05

3. **Partial switch — proportional penalty**
   - 3-task chain: RN-01, RN-01, RN-02
   - 1 switch out of 2 pairs → switchRate = 0.5
   - Penalty = 0.5 × 0.05 = 0.025

4. **Multiple affinity types**
   - Chain: Nurse switches (RN-01 → RN-02), Anesthesiologist stays (AN-JONES → AN-JONES)
   - 1 switch out of 4 pairs (2 nurse + 2 anesthesiologist) → switchRate = 0.25
   - Penalty = 0.25 × 0.05 = 0.0125

5. **Non-affinity resources ignored**
   - OR switches from OR-01 to OR-02 (non-lane, non-affinity)
   - No penalty — OR type not in `affinityResourceTypes`

6. **Affinity disabled — zero overhead**
   - `affinityResourceTypes` is empty
   - `computeAffinityPenalty` returns 0 immediately
   - No iteration over resources

7. **Affinity doesn't override earliness**
   - Combo A: Monday, all nurses switch (penalty 0.05)
   - Combo B: Wednesday, same nurse throughout (penalty 0.0)
   - Combo A still wins — Monday placement is worth far more than 0.05 affinity penalty

8. **Affinity breaks ties**
   - Combo A: Monday 10:00, same nurse (penalty 0.0)
   - Combo B: Monday 10:00, nurses switch (penalty 0.025)
   - Same time, same resources except nurse → Combo A wins on affinity

### Integration Tests

9. **Healthcare — nurse continuity**
   - Solve with affinity enabled (Nurse + Anesthesiologist)
   - Check C003: same anesthesiologist across PROC and (if applicable) other phases
   - Verify solve result includes `affinitySwitches` data

10. **Healthcare — affinity doesn't degrade feasibility**
    - Same number of chains scheduled with and without affinity
    - Affinity only changes WHICH combo is selected, not WHETHER a chain fits

11. **Manufacturing — operator continuity**
    - Enable affinity for Operator type
    - Same operator preferred across Setup and Run phases

12. **HRMD — affinity disabled**
    - Empty `affinityResourceTypes`
    - No affinity data in solve response
    - Solve time unchanged

Commit: "feat(engine): resource affinity scoring — prefer same nurse/anesthesiologist/operator across chain phases"
