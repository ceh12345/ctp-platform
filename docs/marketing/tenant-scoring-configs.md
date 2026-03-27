# Tenant Scoring Configurations

All 5 tenant scoring configs. Each goes into the tenant's `config/tenants/{tenant}/scoring.json`. Weights sum to 1.0 in every config.

---

## Stafford Engineering (Job Shop)

**File:** `config/tenants/stafford-engineering/scoring.json`

```json
{
  "name": "Job Shop - On Time Delivery",
  "key": "stafford-jobshop",
  "rules": [
    { "ruleName": "DueDateScoringRule", "weight": 0.35, "objective": 0, "includeInSolve": true, "penaltyFactor": 2.0 },
    { "ruleName": "ResourceUtilizationScoringRule", "weight": 0.20, "objective": 1, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ChangeoverScoringRule", "weight": 0.20, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.15, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ResourcePreferenceScoringRule", "weight": 0.10, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 }
  ]
}
```

**Rationale:** Due date heaviest — the #1 job shop question is "will we ship on time?" Utilization spreads work across machines. Changeover matters for Stafford's stainless contamination changeovers (45 min decontamination). EarliestStart builds buffer. Preference is a tiebreaker for operator/machine affinity. DueDate penaltyFactor 2.0 means lateness is penalized 3× more than early buffer is rewarded.

---

## Acme Outpatient Healthcare

**File:** `config/tenants/acme-outpatient/scoring.json`

```json
{
  "name": "Surgery Scheduling",
  "key": "surgery-default",
  "rules": [
    { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.50, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "WhiteSpaceScoringRule", "weight": 0.30, "objective": 1, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ChangeoverScoringRule", "weight": 0.20, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 }
  ]
}
```

**Rationale:** EarliestStart dominant — get patients through the OR as early as possible, no idle ORs. WhiteSpace preserves flexibility for emergency add-ons. Changeover handles room turnover between cases. No DueDate rule — surgery cases don't have ship dates, they have scheduled slots. No ResourcePreference — surgeon assignment is handled by the chain context engine's combo logic, not scoring.

---

## Demo Manufacturing (Willoughby)

**File:** `config/tenants/demo-manufacturing/scoring.json`

```json
{
  "name": "Manufacturing Demo",
  "key": "demo-mfg",
  "rules": [
    { "ruleName": "DueDateScoringRule", "weight": 0.30, "objective": 0, "includeInSolve": true, "penaltyFactor": 1.5 },
    { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.25, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ChangeoverScoringRule", "weight": 0.20, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "WhiteSpaceScoringRule", "weight": 0.15, "objective": 1, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ResourcePreferenceScoringRule", "weight": 0.10, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 }
  ]
}
```

**Rationale:** Balanced manufacturing profile. DueDate important but not as extreme as a pure job shop (penaltyFactor 1.5 vs Stafford's 2.0). EarliestStart keeps work moving. Changeover and WhiteSpace balance throughput vs flexibility. ResourcePreference as tiebreaker.

---

## HRMD Sports (Highland Ranch)

**File:** `config/tenants/hrmd-sports/scoring.json`

```json
{
  "name": "Community Sports Scheduling",
  "key": "hrmd-sports",
  "rules": [
    { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.50, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "WhiteSpaceScoringRule", "weight": 0.30, "objective": 1, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ChangeoverScoringRule", "weight": 0.20, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 }
  ]
}
```

**Rationale:** Same profile as healthcare — tight chain scheduling (Prep → Game → Reset on same field). EarliestStart fills fields from morning forward. WhiteSpace preserves flexibility for rainouts and rescheduling. Changeover handles field transition time between games. No DueDate — games don't have due dates, they have scheduled time slots. No Utilization — field balancing is handled by the chain engine's combo logic distributing across available fields.

---

## Summit Pharma

**File:** `config/tenants/summit-pharma/scoring.json`

```json
{
  "name": "Pharmaceutical Batch Scheduling",
  "key": "summit-pharma",
  "rules": [
    { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.30, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ChangeoverScoringRule", "weight": 0.25, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "WhiteSpaceScoringRule", "weight": 0.25, "objective": 1, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ResourceUtilizationScoringRule", "weight": 0.20, "objective": 1, "includeInSolve": true, "penaltyFactor": 0 }
  ]
}
```

**Rationale:** Changeover is critical in pharma — product-dependent cleanroom changeovers (30 min same product, 2 hrs different, 4 hrs after antibiotics) directly impact throughput. EarliestStart keeps batches moving through the pipeline. WhiteSpace preserves flexibility for QC hold times and regulatory inspections. ResourceUtilization balances cleanroom loading (CLEAN-MFG is the bottleneck). No DueDate — pharma batches are campaign-scheduled, not customer-order-driven.

---

## Objective Reference

- `0` = MINIMIZE (lower raw score is better)
- `1` = MAXIMIZE (higher raw score is better)

The ScoringEngine normalizes all raw scores to 0-1 range, applies weights, and handles objective direction automatically.

## Available Rules Reference

| Rule | Objective | penaltyFactor | Notes |
|------|-----------|---------------|-------|
| EarliestStartTimeScoringRule | 0 (MIN) | n/a | Prefer earlier placement |
| LatestStartTimeScoringRule | 0 (MIN) | n/a | Prefer later placement (JIT) |
| WhiteSpaceScoringRule | 1 (MAX) | n/a | Prefer flexible slots |
| ChangeoverScoringRule | 0 (MIN) | n/a | Minimize setup/changeover time |
| DueDateScoringRule | 0 (MIN) | 0-10 | Penalize lateness on chain-terminal tasks |
| ResourceUtilizationScoringRule | 1 (MAX) | n/a | Prefer less-loaded resources |
| ResourcePreferenceScoringRule | 0 (MIN) | n/a | Honor operator/machine preferences |
