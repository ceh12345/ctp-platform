# Sprint 22: UI — Configuration Manager

**What it does:** Standalone page for managing schedule configurations (CRUD), config selector in Solve Preview, and a comparison/diff view. Settings Panel edits flow back as tracked changes.

**Size:** ~4-5 hours CC work (3 sub-tasks, each independently useful)  
**Depends on:** ENGINE-22 backend (CRUD endpoints, solve integration)

---

## Architecture — Three Surfaces, One State

| Surface | Purpose | Edits configs? |
|---------|---------|----------------|
| **Configuration Manager** (new tab) | Collection management: create, duplicate, rename, delete, set default. Diff view. Compare view. | Yes — CRUD via API |
| **Solve Preview** (existing modal) | Quick-switch config before solving. Read-only summary. | No — just selects |
| **Settings Panel** (existing) | Edit scoring weights, strategy, tier on the active config. | Yes — writes back on Save |

State flow:
1. Planner selects a config in Solve Preview or Config Manager → becomes the **active config**
2. Settings Panel always operates on the active config
3. Changes in Settings are tracked as **unsaved modifications** (session state)
4. Config Manager shows a "modified" badge and before/after diff for the active config
5. Save writes modifications back to the active config via `PUT /v1/configurations/:key`
6. Save As creates a new config via `POST /v1/configurations`
7. Reset discards session modifications, reverts to the saved config

---

## Sub-task 1: Configuration Manager Page (~2 hours)

### New Tab

Add a "Configurations" tab to the main navigation (after Analytics, before any future tabs). Icon: ⚙️ or 🔧.

### Page Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Configurations                                    [+ New Config] │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ ★ Standard (default)              Greedy · ⚡ Quick         │ │
│  │   On-time delivery focus           Last modified: Mar 19    │ │
│  │   DueDate 35% · Util 20% · Chgover 20% · EStart 15%       │ │
│  │                          [Activate] [Duplicate] [⋯]        │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │   Cost Optimized                   Chain · 🎯 Balanced      │ │
│  │   Minimize resource and changeover costs                    │ │
│  │   DueDate 25% · ResCost 20% · ChgCost 15% · Late 15%      │ │
│  │                          [Activate] [Duplicate] [⋯]        │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │   Rush Mode                        Chain · 🔬 Thorough      │ │
│  │   Maximum priority compliance                               │ │
│  │   DueDate 50% · EStart 30% · Util 20%                      │ │
│  │                          [Activate] [Duplicate] [⋯]        │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  [Compare Two Configs]                                            │
└──────────────────────────────────────────────────────────────────┘
```

### Config Card — Each Row Shows

- **Name** with ★ default badge and "● Active" indicator if active
- **Description** (one line, truncated)
- **Strategy + Tier** as pills (e.g., `Chain · 🎯 Balanced`)
- **Scoring summary** — top rules with weights, condensed (e.g., "DueDate 35% · Util 20% · Chgover 20%")
- **Last modified** date
- **Actions:** Activate, Duplicate, overflow menu (⋯) with Rename, Set as Default, Delete

### Modified Indicator

If the active config has unsaved changes from the Settings Panel, its card shows:

```
┌─────────────────────────────────────────────────────────────────┐
│ ★ Standard (default) ● Active  ⚠ Modified                      │
│   On-time delivery focus                                        │
│   DueDate 35%→40% · Util 20% · Chgover 20%→15% · EStart 15%   │
│                                                                  │
│   Unsaved changes:                                               │
│     DueDateScoringRule     0.35 → 0.40                          │
│     ChangeoverScoringRule  0.20 → 0.15                          │
│     Strategy               Greedy → Chain                        │
│                                                                  │
│                    [Save] [Save As...] [Reset] [Activate] [⋯]   │
└─────────────────────────────────────────────────────────────────┘
```

The before/after diff shows only fields that changed. Weights show the delta. Strategy/tier changes highlighted.

### Actions

**+ New Config** — Opens a dialog:
- Name (required)
- Description (optional)
- Initialize from: dropdown of existing configs (copies scoring/strategy/tier), or "Blank" (defaults)
- On confirm → `POST /v1/configurations` → new card appears

**Activate** — `POST /v1/configurations/:key/activate` → active indicator moves, Solve Preview and Settings now use this config

**Duplicate** — Opens name dialog pre-filled with "{name} (Copy)" → creates via POST with the same scoring/strategy/tier

**Rename** — Inline edit or small dialog. `PUT /v1/configurations/:key` with new name. Key doesn't change.

**Set as Default** — `POST /v1/configurations/:key/set-default` → ★ badge moves

**Delete** — Confirm dialog. `DELETE /v1/configurations/:key`. Disabled/hidden for the default config. If deleting the active config, active falls back to default.

**Save** — `PUT /v1/configurations/:key` with the session modifications. Clears modified state.

**Save As** — Name dialog → `POST /v1/configurations` with current modified values as the new config's settings.

**Reset** — Discards session modifications, reloads the saved config from API.

### API Calls

```typescript
// On page load
const configs = await api('/v1/configurations');  // { configurations, activeKey }

// CRUD
await api('/v1/configurations', { method: 'POST', body: JSON.stringify(newConfig) });
await api('/v1/configurations/rush-mode', { method: 'PUT', body: JSON.stringify(updates) });
await api('/v1/configurations/rush-mode', { method: 'DELETE' });

// Actions
await api('/v1/configurations/rush-mode/activate', { method: 'POST' });
await api('/v1/configurations/rush-mode/set-default', { method: 'POST' });
```

---

## Sub-task 2: Compare View (~1.5 hours)

### Compare Two Configs

Button at bottom of config list: **[Compare Two Configs]**

Opens a side-by-side view. Two dropdowns at the top to pick Config A and Config B. Can also compare "Active (modified)" vs its saved version.

```
┌──────────────────────────────────────────────────────────────────┐
│  Compare Configurations                                          │
│                                                                   │
│  Config A: [Standard          ▼]    Config B: [Rush Mode      ▼] │
│                                                                   │
│  ┌─────────────────────────┬─────────────────────────┐           │
│  │  STRATEGY               │                         │           │
│  │  Greedy                 │  Chain                   │  ← diff  │
│  ├─────────────────────────┼─────────────────────────┤           │
│  │  TIER                   │                         │           │
│  │  ⚡ Quick               │  🔬 Thorough            │  ← diff  │
│  ├─────────────────────────┼─────────────────────────┤           │
│  │  SCORING RULES          │                         │           │
│  │  DueDate        0.35    │  DueDate        0.50   │  ← diff  │
│  │  Util           0.20    │  Util           0.20   │           │
│  │  Changeover     0.20    │  —                      │  ← only A│
│  │  EarliestStart  0.15    │  EarliestStart  0.30   │  ← diff  │
│  │  ResPref        0.10    │  —                      │  ← only A│
│  │  penaltyFactor  2.0     │  penaltyFactor  3.0    │  ← diff  │
│  ├─────────────────────────┼─────────────────────────┤           │
│  │  EXPERIENCE LEVEL       │                         │           │
│  │  intermediate           │  novice                 │  ← diff  │
│  └─────────────────────────┴─────────────────────────┘           │
│                                                                   │
│  Summary: 6 differences                              [Close]      │
└──────────────────────────────────────────────────────────────────┘
```

### Diff Rules

- **Same value** — no highlight, dimmed text
- **Different value** — both highlighted, delta shown (e.g., weight difference: "+0.15")
- **Only in A** — shown in A column, B column shows "—" with muted text
- **Only in B** — A column shows "—", shown in B column
- **Phase 2 fields** — only show if at least one config has them set. Don't show empty sections.

### Diff Component

Build this as a reusable `ConfigDiff` component that takes two `IScheduleConfiguration` objects and renders the comparison. Used in two places:
1. **Compare view** — two saved configs side by side
2. **Modified indicator** — saved config vs session-modified state (same component, one input is the saved config, other is the current working copy)

```typescript
interface ConfigDiffProps {
  configA: IScheduleConfiguration;
  configB: IScheduleConfiguration;
  labelA: string;  // "Standard" or "Saved"
  labelB: string;  // "Rush Mode" or "Modified"
}
```

---

## Sub-task 3: Toolbar Config Switcher (~0.5 hours)

### Config Picker in the Main Toolbar

Add a compact config switcher next to the Solve button in the main toolbar — always visible, one-click switch. The Configurations tab is for CRUD and comparison, but the daily "I need Rush Mode right now" action lives in the toolbar.

```
┌──────────────────────────────────────────────────────────────────────┐
│  [Overview] [Schedule] [Orders] ...          ⚙ Standard ▼  [▶ Solve]│
│                                              ├ ★ Standard (default) │
│                                              ├ Cost Optimized       │
│                                              ├ Rush Mode            │
│                                              └ ⚙ Manage...         │
└──────────────────────────────────────────────────────────────────────┘
```

### Appearance

- Small gear icon, active config name, dropdown chevron
- Yellow dot on the gear icon if there are unsaved modifications
- Compact — doesn't crowd the toolbar

### Behavior

- **Clicking the pill:** Opens dropdown with all configs for the tenant
- **Selecting a config:** Calls `POST /v1/configurations/:key/activate`. Scoring, strategy, tier update in session state. Solve becomes stale.
- **"Manage..."** link at bottom of dropdown navigates to the Configurations tab
- **Strategy/tier dropdowns in Solve Preview remain:** The planner can still override inline for a single solve — ephemeral overrides that don't write back to the config.
- **Solve Preview** also shows the active config name for context, and sends `configurationKey` in the solve request. If strategy/tier were overridden inline, those explicit values also go in the request (and beat the config per the resolution order).

### Scoring Summary in Solve Preview

Below strategy/tier in the Solve Preview modal, show a one-line scoring summary of the active config:

```
DueDate 35% · Util 20% · Chgover 20% · EStart 15% · ResPref 10%
```

Only rules with `includeInSolve: true`. Truncate if more than ~5 rules. Weights shown as percentages.

---

## Settings Panel Integration

The Settings Panel's scoring rules editor already exists. The integration is:

1. **On load:** Settings reads from the active config (via `GET /v1/configurations/:activeKey`)
2. **On edit:** Changes are tracked in session state as modifications against the saved config
3. **Modified indicator:** If any field differs from the saved config, show "Modified" badge in both Settings and Config Manager
4. **Save button:** `PUT /v1/configurations/:key` with the modified fields
5. **Config picker in Settings header:** Same dropdown as Solve Preview — switch which config you're editing

The session state for modifications:

```typescript
interface ConfigModifications {
  scoring?: ScoringRuleDto[];      // full replacement if any rule changed
  strategy?: string;
  tier?: string;
  // Track what changed for the diff display
  changes: ConfigChange[];
}

interface ConfigChange {
  field: string;          // "scoring.DueDateScoringRule.weight" or "strategy"
  label: string;          // "DueDate Weight" or "Strategy"
  savedValue: string;     // "0.35" or "Greedy"
  currentValue: string;   // "0.40" or "Chain"
}
```

---

## State Management

### App-level state additions

```typescript
// Active configuration
const [activeConfigKey, setActiveConfigKey] = useState<string>('default');
const [activeConfig, setActiveConfig] = useState<IScheduleConfiguration | null>(null);
const [configModifications, setConfigModifications] = useState<ConfigModifications | null>(null);
const [configurations, setConfigurations] = useState<ConfigurationSummary[]>([]);

// Derived
const isConfigModified = configModifications !== null && configModifications.changes.length > 0;
const effectiveScoring = configModifications?.scoring ?? activeConfig?.scoring ?? [];
const effectiveStrategy = configModifications?.strategy ?? activeConfig?.strategy ?? 'Chain';
const effectiveTier = configModifications?.tier ?? activeConfig?.tier ?? 'quick';
```

### Load on app init

```typescript
// In loadData or useEffect
const configList = await api('/v1/configurations');
setConfigurations(configList.configurations);
setActiveConfigKey(configList.activeKey);
const fullConfig = await api(`/v1/configurations/${configList.activeKey}`);
setActiveConfig(fullConfig);
```

### When switching configs

```typescript
async function handleConfigChange(key: string) {
  if (isConfigModified) {
    // Prompt: "You have unsaved changes. Discard?"
    if (!confirm('Discard unsaved changes to the current configuration?')) return;
  }
  await api(`/v1/configurations/${key}/activate`, { method: 'POST' });
  const fullConfig = await api(`/v1/configurations/${key}`);
  setActiveConfigKey(key);
  setActiveConfig(fullConfig);
  setConfigModifications(null);  // clear modifications
}
```

---

## Styling

Follow the existing dark theme from `App.tsx`:
- Card backgrounds: `C.surface` (#111827)
- Card borders: `C.border` (#1e293b)
- Active config: left border accent `C.accent` (#3b82f6)
- Modified badge: `C.yellow` (#eab308) with `C.yellowDim` background
- Default badge (★): `C.green` (#22c55e)
- Diff highlights: changed values in `C.accent`, removed in `C.red`, added in `C.green`
- Same values: `C.textDim` (#475569)
- Font: `FONT` constant from App.tsx (`'DM Sans','Segoe UI',system-ui,sans-serif'`)

---

## Build Order

Each sub-task is independently useful:

1. **Configuration Manager page** — CRUD, card list, activate, duplicate, delete. Requires backend endpoints.
2. **Compare view** — ConfigDiff component, side-by-side comparison. Can be used standalone even without Settings integration.
3. **Solve Preview config selector** — dropdown in the existing modal. Quick win, small change.

Settings Panel integration (modified tracking, Save/Save As/Reset) can be done as part of sub-task 1 or as a follow-up.

---

## Verification

### Configuration Manager
- [ ] Tab appears in navigation
- [ ] Page loads all configs from `GET /v1/configurations`
- [ ] Default config shows ★ badge
- [ ] Active config shows ● indicator with accent border
- [ ] Config cards show name, description, strategy, tier, scoring summary
- [ ] "+ New Config" creates via API, card appears
- [ ] Duplicate pre-fills name, creates copy
- [ ] Rename updates name via PUT
- [ ] Delete shows confirm, removes card, 400 blocked for default
- [ ] Set as Default moves ★ badge
- [ ] Activate moves ● indicator

### Modified State
- [ ] Changing scoring weights in Settings shows "⚠ Modified" on active config card
- [ ] Modified card shows before/after diff of changed fields
- [ ] Save writes changes back via PUT, clears modified state
- [ ] Save As opens name dialog, creates new config with modified values
- [ ] Reset discards modifications, card reverts to saved state
- [ ] Switching configs with unsaved changes prompts confirmation

### Compare View
- [ ] Two-dropdown selector for Config A and Config B
- [ ] Can compare "Active (modified)" vs saved version
- [ ] Same values dimmed, different values highlighted
- [ ] Rules only in one config show "—" in the other column
- [ ] Phase 2 fields shown only if populated
- [ ] Summary count of differences

### Solve Preview
### Toolbar Config Switcher
- [ ] Gear icon + config name pill visible next to Solve button
- [ ] Yellow dot appears when unsaved modifications exist
- [ ] Clicking pill opens dropdown with all configs
- [ ] Selecting a config activates it — scoring, strategy, tier update in session
- [ ] "Manage..." navigates to Configurations tab
- [ ] Solve Preview shows active config name for context
- [ ] Solve sends `configurationKey` in the request
- [ ] Inline strategy/tier overrides in Solve Preview still work (ephemeral)

### Header Bar
- [ ] Active config name shown next to horizon dates
- [ ] Clicking navigates to Configurations tab
- [ ] Yellow dot when modified

### Settings Panel
- [ ] Scoring Rules header shows "— {config name}"
- [ ] Editing weights marks the config as modified
- [ ] Modified state visible on Configurations tab with diff + Save/Save As/Reset

### Cross-tenant
- [ ] Stafford shows 3 configs
- [ ] Demo manufacturing shows virtual default (from scoring.json)
- [ ] Tenants without configurations.json work unchanged
- [ ] Config Manager works for all tenants

---

*Build order: Config Manager page first (CRUD + compare), then Settings integration (modified tracking + save), then toolbar config switcher. Each step is independently useful.*
