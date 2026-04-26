# CC Prompt — Mapping Remediation Pass (revised 2026-04-26)

Paste this into Claude Code as a prompt. It builds on `scripts/mapping-gap-analysis.py` (already shipped) and produces a remediation report classifying each broken mapping rule. **Does not modify `mapping.json`** — the report is for human review and decisioning.

---

## Context

The mapping audit ran against `tools/mock-genius/recorded/stafford-work7-2026-04-23/` and found that most rules in `config/tenants/stafford-engineering-test/integration/mapping.json` reference fields that don't exist in real Genius data:

- `orders`: 5 of 7 rules broken
- `resources`: 5 of 5 rules broken (entire mapping miscalibrated)
- `tasks`: 3 of 13 rules broken

The audit answered *what's broken*. This pass classifies *what to do about each broken rule* and produces a structured report.

## What to build

A Python script `scripts/mapping-remediation.py` (NOT TypeScript — keeps tooling consistent with the existing analysis script). Reuses the data-loading and analysis primitives from `scripts/mapping-gap-analysis.py` directly via import.

**Inputs:**
1. Captured fixtures at `tools/mock-genius/recorded/stafford-work7-2026-04-23/` — re-analyzed fresh (do NOT parse the existing markdown audit; that's fragile)
2. Current `config/tenants/stafford-engineering-test/integration/mapping.json`

**Outputs (both):**
1. `docs/Stafford/mapping-remediation-{date}.md` — human-readable report
2. `docs/Stafford/mapping-remediation-{date}.json` — structured sidecar for downstream tooling

**Prereq checks at script start (fail loudly if any miss):**
- Capture directory exists and contains the four expected entity files
- `mapping.json` parses
- `scripts/mapping-gap-analysis.py` is importable

## The five classifications

For each rule referencing a missing-or-problematic source field:

### 1. DIRECT RENAME
Source field exists in same entity under a different name; same semantics.
**Example:** `MachineCode` → `Code` (resources)
**Action signaled:** clear rename, low risk if confidence is high.

### 2. PARTIAL POPULATION (new — see review)
Source field exists with the right name but isn't 100% populated. Mapping rules that assume populated data (key fields, `factor` sources, required FKs) need null handling.
**Example:** `salesOrderDetailEntity.JobCode` populated 90.7%, used as `key` — null keys would corrupt the landscape.
**Action signaled:** add null tolerance, change to a fully-populated alternative, or accept and handle downstream.

### 3. DERIVE
No direct rename match found, but conceptually-related fields exist in the entity that *could* feed a computed transform.
**Example:** `WipState` not present, but `IsCompleted` (bool) + `IsScheduled` (bool) + `TaskStartDate`/`TaskEndDate` (dates) exist — a transform could synthesize a state value.
**Action signaled:** rule needs to become a transform/computed field, not pass-through. **The script flags candidates but does NOT suggest the derivation formula** — that's a human decision.

### 4. AMBIGUOUS
Multiple plausible candidate sources exist with different types or semantics. Closest-match would be a coin flip.
**Example:** `Strategy` could come from `Strategy` (work order, string) or `JobPlanningStrategyId` (sales order, int FK). Different data types, different entities, possibly different semantics.
**Action signaled:** human decision needed; possibly an escalation to Stafford.

### 5. UNMAPPABLE
No candidate field has reasonable similarity, no conceptually-related fields in entity, no cross-entity matches.
**Example:** A field with no shared name fragment, no matching type pattern, and no obvious computational source.
**Action signaled:** design decision — default value, omit field, or escalate to Stafford for schema clarification.

## Similarity heuristics (priority order — apply in sequence)

For each missing field, find candidate replacements in the same entity:

1. **Prefix-strip exact match** (highest confidence, 0.95)
   Strip common prefixes from the missing field name (`Machine`, `Wo`, `Job`, `Task`, `Item`, `Worker`, `Sales`, `Production`) and check for exact match in the entity's fields.
   `MachineCode` → strip `Machine` → match `Code` exact ✓

2. **Suffix match** (confidence 0.85)
   Missing field ends with the candidate. `MachineCode` ends with `Code` ✓ if the candidate isn't a more-specific term elsewhere.

3. **Substring containment** (confidence 0.70)
   Missing field contains the candidate as a substring. `MachineCode` contains `Code` ✓ — but lower confidence than suffix match because partial overlaps are noisier.

4. **Levenshtein distance** (confidence 0.50-0.80 based on edit distance)
   Last-resort tiebreaker among multiple candidates. Only counts if edit distance < 0.5 × length and candidate is populated > 50%.

**Type-and-population gate:** even with a strong name match, if the candidate's type wildly disagrees with what the rule expects (e.g., `lookup` rule pointing at a numeric field), drop confidence by 0.2 and flag the type mismatch in the report.

## Cross-entity candidates

After exhausting same-entity matches, scan the other three entities for fields with the missing name (or close matches). Surface as candidates **but tag every cross-entity candidate with "different entity — semantics may differ; verify before adopting."**

Cross-entity candidates do NOT count toward DIRECT RENAME confidence — they only inform AMBIGUOUS classification.

## Confidence scoring

Each suggested replacement carries a numeric confidence score (0.0-1.0):

- **0.90-1.00** — High: prefix-strip exact match, 100% populated, same type as rule expects
- **0.70-0.89** — Medium: suffix or substring match, well-populated, type matches
- **0.50-0.69** — Low: Levenshtein-only match, or type mismatch
- **< 0.50** — Don't suggest; classify as UNMAPPABLE or AMBIGUOUS

Confidence appears in both the markdown and JSON outputs.

## Report format — markdown

For each broken rule:

### High-confidence rename (short form)

```markdown
### resources.key

**Currently:** `{ "from": "MachineCode" }`
**Status:** ❌ MISSING — `MachineCode` not found in `machineAndRessourceEntity` (n=77)
**Classification:** DIRECT RENAME (confidence: 0.95)

**Suggested replacement:** `Code`
- Type: string
- Populated: 77/77 (100%)
- Distinct values: 77 (unique — looks like primary key)
- Heuristic: prefix-strip exact match (`Machine` removed from `MachineCode` matches `Code`)

**Recommended action:** Rename `from: "MachineCode"` to `from: "Code"`. Low risk.
```

### Ambiguous (long form)

```markdown
### orders.priority

**Currently:** `{ "from": "Strategy", "lookup": { ... } }`
**Status:** ❌ MISSING — `Strategy` not found in `salesOrderDetailEntity` (n=474)
**Classification:** AMBIGUOUS (confidence: 0.55)

**Same-entity candidates:**

◇ `JobPlanningStrategyId` (this entity)
  - Type: integer FK
  - Populated: 474/474 (100%)
  - Distinct values: 3 — `[1606, 1701, 1605]`
  - Confidence: 0.65 (substring match, but type mismatch with lookup rule)

**Cross-entity candidates** (different entity — semantics may differ):

◇ `Strategy` (workOrderWithAdvancedInformationViewEntity)
  - Type: string
  - Populated: 956/956 (100%)
  - Distinct values: 4 — `[JIT, MTO, STANDARD, ASAP]`
  - Existing lookup table covers: 3 of 4 (MISSING: `MTO`)

**Possible resolutions:**
1. Source from work order side post-join. Lookup mostly works — add `MTO: <value>` to the table.
2. Source from `JobPlanningStrategyId` directly. Build ID-to-name lookup (`1606: ?`, `1701: ?`, `1605: ?`).
3. Escalate: which is authoritative when sales-order strategy and work-order strategy disagree?

**Recommended action:** Human decision before applying.
```

### Partial population

```markdown
### orders.key

**Currently:** `{ "from": "JobCode" }`
**Status:** ⚠️ PARTIAL — `JobCode` found but only 430/474 records populated (90.7%)
**Classification:** PARTIAL POPULATION

**Concern:** key fields with null values produce broken landscape entities (no addressable identity).

**Same-entity alternatives (100% populated):**
◇ `WorkOrderCode` — string, 474/474, 350 distinct values

**Recommended action:** Either change `from: "JobCode"` to a 100%-populated alternative, OR add a null-tolerance step (e.g., synthesize a key when JobCode is null).
```

## Report structure

1. **Summary table** — for each entity, count of rules in each category (OK / DIRECT RENAME / PARTIAL POPULATION / DERIVE / AMBIGUOUS / UNMAPPABLE)
2. **Per-entity sections** — `orders`, `resources`, `tasks`. Within each, one subsection per problem rule (skip OK rules).
3. **Cross-entity observations** — patterns worth noting (e.g., "all four entities have a status field but each uses a different name: `Wostatus`, `WoStatusCode`, `ItemStatus`")
4. **Prioritized action plan** — at the bottom:
   - Direct renames with confidence ≥ 0.85 (apply immediately, low risk)
   - Direct renames with confidence 0.70-0.84 (review before applying)
   - Partial populations (decide null-handling strategy)
   - Derives (need transform code)
   - Ambiguous (need human decision)
   - Unmappable (need Stafford input)

## JSON sidecar schema

```json
{
  "generatedAt": "2026-04-26T...",
  "captureDir": "tools/mock-genius/recorded/stafford-work7-2026-04-23",
  "mappingProfile": "config/tenants/stafford-engineering-test/integration/mapping.json",
  "summary": {
    "orders":    { "ok": 2, "direct_rename": 0, "partial_population": 0, "derive": 0, "ambiguous": 0, "unmappable": 0 },
    "resources": { "ok": 0, "direct_rename": 5, "partial_population": 0, "derive": 0, "ambiguous": 0, "unmappable": 0 },
    "tasks":     { "ok": 10, "direct_rename": 0, "partial_population": 0, "derive": 1, "ambiguous": 1, "unmappable": 1 }
  },
  "findings": [
    {
      "entity": "resources",
      "ruleTarget": "key",
      "currentRule": { "from": "MachineCode" },
      "currentSourceField": "MachineCode",
      "status": "MISSING",
      "classification": "DIRECT_RENAME",
      "confidence": 0.95,
      "suggestedField": "Code",
      "suggestedFieldStats": {
        "type": "str",
        "populated": 77,
        "total": 77,
        "populationPct": 100.0,
        "distinctValues": 77
      },
      "heuristic": "prefix-strip-exact",
      "candidates": [
        { "field": "Code", "entity": "machineAndRessourceEntity", "confidence": 0.95, "...": "..." }
      ],
      "recommendedAction": "Rename from:'MachineCode' to from:'Code'. Low risk."
    }
  ]
}
```

## Implementation notes

- Don't modify `mapping.json`. Output is a report only.
- Reuse `load_records()` and `analyze()` from `scripts/mapping-gap-analysis.py` via Python import. Don't reimplement.
- Levenshtein implementation: simple two-row dynamic programming, ~15 lines. No external library.
- Prefix list: `["Machine", "Wo", "Job", "Task", "Item", "Worker", "Sales", "Production"]` (extend if patterns emerge during run).
- For DERIVE classification: report identifies "candidate fields that could feed a derivation" by listing fields in the entity whose names overlap or whose types complement the missing one. **Does not propose the formula** — humans decide that.
- All cross-entity candidates carry the warning tag: "different entity — semantics may differ."
- The script reads today's date and writes to `mapping-remediation-{YYYY-MM-DD}.md`/`.json`.

## Acceptance criteria

- [ ] Script imports cleanly from `scripts/mapping-gap-analysis.py` (no duplicated logic)
- [ ] Prereq check fails loudly if capture or mapping.json missing
- [ ] Every broken rule from the audit appears in the remediation report
- [ ] Each problem rule has one of five classifications: DIRECT RENAME / PARTIAL POPULATION / DERIVE / AMBIGUOUS / UNMAPPABLE
- [ ] Every DIRECT RENAME suggestion includes confidence score, populated count, distinct count, type, and matching heuristic
- [ ] AMBIGUOUS cases list all candidates (same-entity and cross-entity) with type, population, distinct values
- [ ] Cross-entity candidates explicitly warn "semantics may differ"
- [ ] DERIVE cases identify conceptually-related fields but do NOT claim to suggest formulas
- [ ] PARTIAL POPULATION cases note null-handling concern explicitly
- [ ] Summary table per entity at top of markdown
- [ ] Prioritized action plan section at bottom
- [ ] JSON sidecar present and matches schema above
- [ ] No changes to `mapping.json`

## What happens after the report runs

1. Read the report
2. Apply confidence-≥-0.85 DIRECT RENAME fixes immediately to `mapping.json`
3. Review confidence 0.70-0.84 renames, apply if reasonable
4. For PARTIAL POPULATION cases: decide null-handling strategy
5. For DERIVE cases: design the transform logic (separate sprint)
6. For AMBIGUOUS cases: pick or escalate to Stafford
7. For UNMAPPABLE cases: add to questions-for-Stafford list
8. Re-run the audit to confirm fixes worked. Anything still broken after this is genuine design work.

## Time estimate (revised)

- Script implementation: 2-3 hours of careful Python (Levenshtein + multi-tier heuristics + cross-entity search + categorization + markdown formatting + JSON sidecar + prereq checks)
- Decisioning on report output: 1-2 hours of human review
- Mapping.json edits: ~1 hour
- Re-audit: ~10 min

Half day to full day end-to-end.

---

*Revised 2026-04-26 from review feedback. Key changes: Python not TypeScript; reuse existing analysis module; fifth PARTIAL POPULATION category; reordered similarity heuristics with prefix-strip first; removed hardcoded "known derived concepts" list; added confidence scoring; specified JSON sidecar schema; bumped time estimate.*
