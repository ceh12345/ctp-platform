# Spec: Schedule Configurations

**What it does:** Named, saveable bundles of solver settings. The backend schema is complete — every field a configuration could contain. The UI only exposes controls for features already built. As new features ship, the UI progressively reveals them. The backend never changes.

**Size:** ~3 hours (backend endpoints + config storage + UI config picker + Settings integration)
**Depends on:** Scoring rules editor (done), strategy/tier picker (done), experience levels (done)

---

## Data Model

```typescript
interface ScheduleConfiguration {
  /** Unique identifier */
  key: string;

  /** Display name — "Morning Review", "Cost Optimized", "Rush Mode" */
  name: string;

  /** Optional description */
  description?: string;

  /** Who created this — "tenant" (shared) or a user identifier */
  owner: 'tenant' | string;

  /** Is this the default config for the tenant? Only one can be default. */
  isDefault: boolean;

  /** When was this last modified */
  updatedAt: string;

  // ═══════════════════════════════════════════════════
  // PHASE 1 — Available now, UI exposes these
  // ═══════════════════════════════════════════════════

  /** Scoring rules with weights, objectives, groups */
  scoring: {
    ruleName: string;
    weight: number;
    objective: number;        // 0 = MINIMIZE, 1 = MAXIMIZE
    includeInSolve: boolean;
    penaltyFactor: number;
    group?: string;           // "Schedule Quality", "Resource Efficiency", "Cost"
  }[];

  /** Solver strategy key */
  strategy: string;           // "Chain", "Greedy", "DueDate", "ChainFirstFit", etc.

  /** Solver tier key */
  tier: string;               // "quick", "balanced", "thorough", "best"

  /** Experience level */
  experienceLevel: string;    // "novice", "intermediate", "expert"

  // ═══════════════════════════════════════════════════
  // PHASE 2 — Backend stores, UI ignores until built
  // ═══════════════════════════════════════════════════

  /** Solver depth overrides (when tier supports them) */
  solverDepth?: {
    bumpLimit?: number;
    tabuTenure?: number;
    iterationCount?: number;
  };

  /** Constraint toggles — enable/disable specific behaviors */
  constraints?: {
    enforceMaxGap?: boolean;      // default true
    enforceMaterials?: boolean;   // default true
    enforceCadence?: boolean;     // default true
    enforceAttributes?: boolean;  // default true (attribute-based matching)
  };

  /** Horizon override — custom solve window */
  horizon?: {
    start?: string;               // ISO datetime, null = use tenant default
    end?: string;                 // ISO datetime, null = use tenant default
  };

  /** Default filters — pre-filter when this config is active */
  defaultFilters?: {
    resourceGroups?: string[];    // only show/solve these resource groups
    orderKeys?: string[];         // only include these orders
    timeRangeDays?: number;       // default zoom level in days
  };

  /** Cost display settings — which cost types to show in UI */
  costVisibility?: {
    resource?: boolean;           // default: true if any resource has hourlyRate
    changeover?: boolean;         // default: true if any state change has cost
    overtime?: boolean;           // default: true if any resource has premiumWindows
    lateness?: boolean;           // default: true if any order has latenessPenaltyPerDay
    material?: boolean;           // default: true if any material has unitCost
  };
}
```

---

## Storage

### File-based (current architecture)

Each tenant gets a `configurations.json` in their config directory:

```
config/tenants/stafford-engineering/configurations.json
config/tenants/acme-outpatient/configurations.json
```

```json
[
  {
    "key": "default",
    "name": "Standard",
    "description": "Default Stafford settings — on-time delivery focus",
    "owner": "tenant",
    "isDefault": true,
    "updatedAt": "2026-03-19T00:00:00Z",
    "scoring": [
      { "ruleName": "DueDateScoringRule", "weight": 0.35, "objective": 0, "includeInSolve": true, "penaltyFactor": 2.0, "group": "Schedule Quality" },
      { "ruleName": "ResourceUtilizationScoringRule", "weight": 0.20, "objective": 1, "includeInSolve": true, "penaltyFactor": 0, "group": "Resource Efficiency" },
      { "ruleName": "ChangeoverScoringRule", "weight": 0.20, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Resource Efficiency" },
      { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.15, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Schedule Quality" },
      { "ruleName": "ResourcePreferenceScoringRule", "weight": 0.10, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Schedule Quality" }
    ],
    "strategy": "Greedy",
    "tier": "quick",
    "experienceLevel": "intermediate"
  },
  {
    "key": "cost-optimized",
    "name": "Cost Optimized",
    "description": "Minimize resource and changeover costs while meeting due dates",
    "owner": "tenant",
    "isDefault": false,
    "updatedAt": "2026-03-19T00:00:00Z",
    "scoring": [
      { "ruleName": "DueDateScoringRule", "weight": 0.25, "objective": 0, "includeInSolve": true, "penaltyFactor": 2.0, "group": "Schedule Quality" },
      { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.10, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Schedule Quality" },
      { "ruleName": "ResourcePreferenceScoringRule", "weight": 0.05, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Schedule Quality" },
      { "ruleName": "ResourceUtilizationScoringRule", "weight": 0.10, "objective": 1, "includeInSolve": true, "penaltyFactor": 0, "group": "Resource Efficiency" },
      { "ruleName": "ChangeoverCostScoringRule", "weight": 0.15, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Resource Efficiency" },
      { "ruleName": "ResourceCostScoringRule", "weight": 0.20, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Cost" },
      { "ruleName": "LatenessCostScoringRule", "weight": 0.15, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Cost" }
    ],
    "strategy": "Chain",
    "tier": "balanced",
    "experienceLevel": "intermediate"
  },
  {
    "key": "rush-mode",
    "name": "Rush Mode",
    "description": "Maximum priority compliance — ignore cost, minimize lateness",
    "owner": "tenant",
    "isDefault": false,
    "updatedAt": "2026-03-19T00:00:00Z",
    "scoring": [
      { "ruleName": "DueDateScoringRule", "weight": 0.50, "objective": 0, "includeInSolve": true, "penaltyFactor": 3.0, "group": "Schedule Quality" },
      { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.30, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Schedule Quality" },
      { "ruleName": "ResourceUtilizationScoringRule", "weight": 0.20, "objective": 1, "includeInSolve": true, "penaltyFactor": 0, "group": "Resource Efficiency" }
    ],
    "strategy": "Chain",
    "tier": "thorough",
    "experienceLevel": "novice"
  }
]
```

### Future: PostgreSQL

When configs move to the database, the schema maps directly to a `schedule_configurations` table with a JSONB column for the scoring array and future-phase fields. The `key` is unique per tenant. No migration needed — the JSON structure is the same.

---

## API Endpoints

### List configurations

```
GET /v1/configurations
```

Returns all configurations for the tenant. Sorted by `isDefault` first, then alphabetically.

```json
{
  "configurations": [
    { "key": "default", "name": "Standard", "description": "...", "isDefault": true, "strategy": "Greedy", "tier": "quick" },
    { "key": "cost-optimized", "name": "Cost Optimized", "description": "...", "isDefault": false, "strategy": "Chain", "tier": "balanced" },
    { "key": "rush-mode", "name": "Rush Mode", "description": "...", "isDefault": false, "strategy": "Chain", "tier": "thorough" }
  ],
  "activeKey": "default"
}
```

### Get single configuration

```
GET /v1/configurations/:key
```

Returns the full configuration object including scoring rules and all phase 2 fields.

### Create configuration

```
POST /v1/configurations
Body: { name, description?, scoring, strategy, tier, experienceLevel, ...phase2Fields }
```

Auto-generates `key` from name (slugified). Returns the created configuration.

### Update configuration

```
PUT /v1/configurations/:key
Body: { name?, description?, scoring?, strategy?, tier?, experienceLevel?, ...phase2Fields }
```

Partial update — only provided fields are changed. Preserves any phase 2 fields the UI didn't send.

### Delete configuration

```
DELETE /v1/configurations/:key
```

Cannot delete the default configuration. Returns 400 if attempted.

### Set active configuration

```
POST /v1/configurations/:key/activate
```

Sets this config as the active one for the current session. Does NOT change `isDefault` — that's an admin action. The active config is used when solving without explicit overrides.

### Set default

```
POST /v1/configurations/:key/set-default
```

Makes this config the tenant default. Clears `isDefault` on the previous default.

---

## Solve Integration

The solve request can reference a configuration by key:

```typescript
interface SolveRequestDto {
  // Existing fields...
  strategy?: string;
  scoringOverrides?: any[];

  // NEW — use a named configuration
  configurationKey?: string;
}
```

**Resolution order:**
1. If `configurationKey` is provided → load that config, apply its scoring + strategy + tier
2. If `scoringOverrides` or `strategy` are provided → use those (explicit overrides beat the config)
3. If neither → use the active configuration (or tenant default if none is active)

This means existing API calls are unchanged. The configuration is additive — clients that don't use it get the same behavior as today.

---

## UI — Phase 1 (What to build now)

### Configuration picker in the Solve Preview

Replace the separate strategy and tier dropdowns with a configuration picker:

```
┌─────────────────────────────────────────────────┐
│  Review & Solve                                 │
│                                                 │
│  Configuration: [Standard          ▼]           │
│                  ├ Standard (default)            │
│                  ├ Cost Optimized                │
│                  ├ Rush Mode                     │
│                  └ + New Configuration...        │
│                                                 │
│  Strategy: Greedy    Tier: ⚡ Quick              │
│  Scoring: DueDate 35%, Util 20%, Chgover 20%... │
│                                                 │
│  [Cancel]                        [▶ Solve Now]  │
└─────────────────────────────────────────────────┘
```

When a configuration is selected, the strategy, tier, and scoring summary update to reflect it. The planner can still override individual settings inline — those overrides are ephemeral (not saved back to the config).

### Save button

If the planner has changed scoring weights, strategy, or tier from what the active config specifies, show a "Save" option:

```
Configuration: Standard (modified)  [Save] [Save As...] [Reset]
```

- **Save** — updates the existing config with the current settings
- **Save As** — creates a new config with a new name
- **Reset** — reverts to the config's saved settings

### Settings Panel integration

The Settings Panel scoring rules editor operates on the active configuration. When the planner edits weights, they're editing the active config's scoring array. The "Save" button persists it.

The configuration picker also appears in the Settings Panel header so the planner can switch configs while editing.

### Experience level tied to config

When switching configurations, the experience level changes to match. "Rush Mode" at novice level means the planner gets a clean view focused on just solving fast. "Cost Optimized" at intermediate shows the cost columns.

---

## UI — Phase 2 (Reveal when features ship)

As each feature is built, its controls appear in the Settings Panel under the active configuration:

| Feature ships | UI reveals |
|--------------|------------|
| Cost scoring rules | Cost group in scoring editor + cost visibility toggles |
| Attribute matching | "Enforce attribute matching" toggle in constraints section |
| Material constraints | "Enforce material constraints" toggle |
| Horizon override | Start/end date pickers in a "Solve Window" section |
| Phase B solvers | Depth params (bump limit, tabu tenure, iterations) under the tier picker |
| Default filters | Resource group and time range pickers |

Each section only appears if the active configuration has the relevant field, OR if the feature is available for the tenant. No empty sections, no placeholders.

---

## Migration from Current State

### What changes

Today the scoring config lives in `scoring.json` and the strategy/tier are ephemeral UI state. After this spec:

- `scoring.json` becomes the "default" configuration's scoring array
- Strategy and tier are read from the default configuration
- The separate `scoring.json` file is still read as a fallback if no `configurations.json` exists

### Backward compatible

If `configurations.json` doesn't exist for a tenant:
1. Read `scoring.json` as the scoring rules
2. Read `appSettings.json` for the default strategy
3. Construct a virtual "default" configuration from these
4. Everything works as today — no migration required

When the planner first saves a configuration, `configurations.json` is created. From then on it's the source of truth.

---

## Verification

### Backend
- [ ] `GET /configurations` returns all configs for tenant
- [ ] `GET /configurations/:key` returns full config with scoring + phase 2 fields
- [ ] `POST /configurations` creates a new config with auto-generated key
- [ ] `PUT /configurations/:key` partial update preserves unset fields (especially phase 2)
- [ ] `DELETE /configurations/:key` rejects deleting the default
- [ ] `POST /configurations/:key/activate` sets active config
- [ ] `POST /configurations/:key/set-default` changes the default
- [ ] Solve with `configurationKey` uses that config's scoring + strategy
- [ ] Solve with explicit `scoringOverrides` overrides the config
- [ ] Solve without config uses the active/default config
- [ ] Tenants without `configurations.json` fall back to `scoring.json` + `appSettings.json`

### UI
- [ ] Config picker in Solve Preview shows all configs with default marked
- [ ] Selecting a config updates strategy, tier, and scoring display
- [ ] Modified indicator appears when settings differ from the active config
- [ ] Save / Save As / Reset buttons work
- [ ] Settings Panel scoring editor operates on the active config
- [ ] Experience level changes when switching configs
- [ ] New Configuration opens a name dialog then creates via API

### Cross-tenant
- [ ] Stafford: 3 configs (Standard, Cost Optimized, Rush Mode)
- [ ] Acme: 2 configs (Surgery Default, Urgent Cases)
- [ ] Tenants without configurations.json work unchanged
- [ ] Phase 2 fields round-trip through API without loss

---

*Build order: Backend endpoints first (CRUD + activate + solve integration), then UI config picker in Solve Preview, then Settings Panel integration, then Save/Save As. Each step is independently useful.*
