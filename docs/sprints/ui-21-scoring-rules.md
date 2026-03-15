# UI Sprint: Settings Panel + Scoring Rules Editor

**What it does:** Converts the Settings modal from a single-page layout into a left-nav panel with multiple sections. Adds a Scoring Rules editor where planners can view, adjust, add, and remove scoring rules. Consolidates solver statistics and timing diagnostics into a dedicated section. Changes to scoring rules are sent as `scoringOverrides` in the solve request body — not persisted to disk.

**Size:** ~2-3 hours CC work
**Depends on:** Engine Sprint — Scoring Rules + Due Date Hydration (3 new rules in ScoringFactory, `scoringOverrides` on solve request DTO, `scoring` in solve response)
**Scenarios:** What-If (8) — "What if I weight changeover higher and re-solve?"

---

## Current State

The Settings modal (`SettingsContent` component, ~line 5727 in App.tsx) is a single-page layout:
1. **Experience Level** — Planner / Analyst / Engineer picker cards
2. **Solver Statistics** — basic key/value table of `solveResult.stats` (Engineer only)

Separately, the **Solve Results dialog** (`SolveResultsDialog`, ~line 1821) shows richer solver timing after each solve:
- Strategy name, total time, contexts evaluated, total score (~line 1922)
- Solver Diagnostics grid: propagation time, windows tightened, bumps, iterations, contexts/task (~line 2074)
- Score breakdown by rule (~line 2095)

These two views overlap. The Settings panel should be the canonical place to review solver diagnostics and scoring configuration.

---

## Part 1: Left-Nav Settings Panel Layout

### 1a. Convert to two-column layout

Replace the current single-column `SettingsContent` with a left-nav + content-area layout:

```
┌──────────────────────────────────────────────────────┐
│ Settings                                        [×]  │
├──────────────┬───────────────────────────────────────┤
│              │                                       │
│  ⚙ General   │  (content for selected section)       │
│              │                                       │
│  ⚖ Scoring   │                                       │
│    Rules     │                                       │
│              │                                       │
│  🔧 Solver   │                                       │
│              │                                       │
└──────────────┴───────────────────────────────────────┘
```

### 1b. Nav sections with experience gating

```typescript
interface SettingsSection {
  key: string;
  label: string;
  icon: string;
  minLevel: ExperienceLevel;
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  { key: 'general',  label: 'General',       icon: '⚙', minLevel: 'novice' },
  { key: 'scoring',  label: 'Scoring Rules', icon: '⚖', minLevel: 'intermediate' },
  { key: 'solver',   label: 'Solver',        icon: '🔧', minLevel: 'expert' },
];
```

Visibility by experience level:
- **Planner** sees: General
- **Analyst** sees: General, Scoring Rules
- **Engineer** sees: General, Scoring Rules, Solver

### 1c. Updated SettingsContent props

```typescript
function SettingsContent({
  experienceLevel, onExperienceChange,
  stats, solveResult,
  scoringRules, onScoringRulesChange, scoringSource,
}: {
  experienceLevel: ExperienceLevel;
  onExperienceChange: (level: ExperienceLevel) => void;
  stats?: any;
  solveResult?: any;
  scoringRules: ScoringRuleOverride[];
  onScoringRulesChange: (rules: ScoringRuleOverride[]) => void;
  scoringSource: 'config' | 'override' | null;
}) {
  const [activeSection, setActiveSection] = useState('general');
  // ... left-nav + content area render
}
```

### 1d. Widen the modal

Current Settings modal is ~400px wide. With the left nav, widen to ~680px:

```typescript
<Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings" width={680}>
```

If `Modal` doesn't support a `width` prop, add one or use an inline style override.

### 1e. Left-nav styling

```typescript
{/* Left nav */}
<div style={{
  width: 160, borderRight: `1px solid ${C.border}`,
  flexShrink: 0, paddingTop: 4,
}}>
  {visibleSections.map(section => (
    <div
      key={section.key}
      onClick={() => setActiveSection(section.key)}
      style={{
        padding: '10px 14px', cursor: 'pointer', fontSize: 13,
        display: 'flex', alignItems: 'center', gap: 8,
        background: activeSection === section.key ? C.accentGlow : 'transparent',
        borderLeft: activeSection === section.key
          ? `2px solid ${C.accent}` : '2px solid transparent',
        color: activeSection === section.key ? C.accent : C.textMuted,
        fontWeight: activeSection === section.key ? 600 : 400,
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 14 }}>{section.icon}</span>
      {section.label}
    </div>
  ))}
</div>

{/* Content area */}
<div style={{ flex: 1, padding: '0 20px', overflowY: 'auto', maxHeight: 500 }}>
  {activeSection === 'general' && <GeneralSection ... />}
  {activeSection === 'scoring' && <ScoringRulesEditor ... />}
  {activeSection === 'solver'  && <SolverSection ... />}
</div>
```

---

## Part 2: GeneralSection

Extract the existing experience level picker into its own component. This is a pure refactor — same UI, same behavior, just moved.

```typescript
function GeneralSection({ experienceLevel, onExperienceChange }: {
  experienceLevel: ExperienceLevel;
  onExperienceChange: (level: ExperienceLevel) => void;
}) {
  return (
    <div>
      <SectionLabel label="Experience Level" />
      {/* Move the existing EXPERIENCE_LEVELS.map() picker cards here as-is */}
    </div>
  );
}
```

---

## Part 3: SolverSection

Consolidate solver stats from the current Settings modal AND the Solve Results dialog diagnostics into one comprehensive view. This becomes the single place to review solver performance.

```typescript
function SolverSection({ stats, solveResult }: { stats?: any; solveResult?: any }) {
  if (!stats) {
    return (
      <div style={{ color: C.textMuted, fontSize: 13, padding: '20px 0' }}>
        No solve data yet. Run a solve to see statistics.
      </div>
    );
  }

  const sr = solveResult?.solveResult;  // engine-level solve result

  return (
    <div>
      {/* Summary bar — strategy + total time */}
      <SectionLabel label="Last Solve" />
      <div style={{
        padding: '10px 14px', borderRadius: 8, marginBottom: 16,
        background: C.bg, border: `1px solid ${C.border}`,
        fontSize: 13, color: C.textMuted, display: 'flex', gap: 16, alignItems: 'center',
      }}>
        <span>Strategy: <strong style={{ color: C.text }}>{stats.strategy || '—'}</strong></span>
        <span>Time: <strong style={{ color: C.text }}>{(stats.totalTimeMs / 1000).toFixed(2)}s</strong></span>
        {sr?.contextsEvaluated != null && (
          <span>Contexts: <strong style={{ color: C.text }}>{sr.contextsEvaluated}</strong></span>
        )}
        {stats.totalScore != null && (
          <span>Score: <strong style={{ color: C.text }}>{Math.round(stats.totalScore)}</strong></span>
        )}
      </div>

      {/* Timing breakdown — grid of metric cards */}
      <SectionLabel label="Timing Breakdown" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[
          stats.propagationTimeMs != null && {
            label: 'Propagation', value: `${stats.propagationTimeMs}ms`,
          },
          stats.windowsTightened != null && {
            label: 'Windows tightened', value: String(stats.windowsTightened),
          },
          stats.bumpsPerformed != null && {
            label: 'Bumps', value: `${stats.backtrackSuccesses || 0}/${stats.bumpsPerformed}`,
          },
          stats.iterations != null && {
            label: 'Iterations', value: String(stats.iterations),
          },
          sr?.contextsEvaluated != null && {
            label: 'Contexts evaluated', value: String(sr.contextsEvaluated),
          },
          stats.contextsPerTask != null && {
            label: 'Contexts / task', value: String(stats.contextsPerTask),
          },
        ].filter(Boolean).map((item: any) => (
          <div key={item.label} style={{
            padding: '8px 12px', borderRadius: 6, background: C.bg,
            border: `1px solid ${C.border}`, fontSize: 12,
          }}>
            <div style={{ color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {item.value}
            </div>
            <div style={{ color: C.textDim, fontSize: 10, marginTop: 2 }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Score breakdown by rule — if available */}
      {stats.scoreBreakdown && (
        <>
          <SectionLabel label="Score Breakdown" />
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
          }}>
            {Object.entries(stats.scoreBreakdown).map(([key, val]) => (
              <div key={key} style={{
                display: 'flex', justifyContent: 'space-between', padding: '6px 12px',
                borderRadius: 6, background: C.bg, border: `1px solid ${C.border}`,
                fontSize: 12,
              }}>
                <span style={{ color: C.textMuted }}>{key.replace('ScoringRule', '')}</span>
                <span style={{ color: C.text, fontWeight: 600 }}>{Math.round(val as number)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Raw stats table — everything else */}
      <SectionLabel label="All Statistics" />
      <div style={{ fontSize: 12 }}>
        {Object.entries(stats).map(([k, v]) => (
          <div key={k} style={{
            display: 'flex', justifyContent: 'space-between', padding: '4px 0',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <span style={{ color: C.textMuted }}>{k}</span>
            <span style={{ color: C.text, fontWeight: 500 }}>{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Part 4: ScoringRulesEditor Component

### 4a. Rule catalog

Hardcoded list of all 7 available scoring rules with descriptions. This is the reference for what rules can be added.

```typescript
const RULE_CATALOG: Record<string, {
  desc: string;
  objective: number;
  defaultWeight: number;
  defaultPenalty: number;
}> = {
  EarliestStartTimeScoringRule: {
    desc: "Prefer earlier placement — builds buffer before due dates",
    objective: 0, defaultWeight: 0.15, defaultPenalty: 0,
  },
  LatestStartTimeScoringRule: {
    desc: "Prefer later placement — JIT strategy, delays work to reduce WIP",
    objective: 0, defaultWeight: 0.15, defaultPenalty: 0,
  },
  WhiteSpaceScoringRule: {
    desc: "Prefer slots with more flexibility — preserves options for later tasks",
    objective: 1, defaultWeight: 0.15, defaultPenalty: 0,
  },
  ChangeoverScoringRule: {
    desc: "Minimize changeover/setup time — batch similar work together",
    objective: 0, defaultWeight: 0.20, defaultPenalty: 0,
  },
  DueDateScoringRule: {
    desc: "Penalize lateness — only fires on the last task in each order chain",
    objective: 0, defaultWeight: 0.35, defaultPenalty: 2.0,
  },
  ResourceUtilizationScoringRule: {
    desc: "Spread work across resources — avoids overloading bottlenecks",
    objective: 1, defaultWeight: 0.20, defaultPenalty: 0,
  },
  ResourcePreferenceScoringRule: {
    desc: "Honor operator/machine preferences — tiebreaker for resource assignment",
    objective: 0, defaultWeight: 0.10, defaultPenalty: 0,
  },
};
```

### 4b. Component props and state

```typescript
interface ScoringRuleOverride {
  ruleName: string;
  weight: number;
  objective: number;       // 0 = MINIMIZE, 1 = MAXIMIZE
  includeInSolve: boolean;
  penaltyFactor: number;
}

function ScoringRulesEditor({ rules, onChange, source }: {
  rules: ScoringRuleOverride[];
  onChange: (rules: ScoringRuleOverride[]) => void;
  source: 'config' | 'override' | null;
}) {
```

### 4c. Layout

```
┌───────────────────────────────────────────────────┐
│ Scoring Rules                    config ◉ / edit ◉│
│                                                   │
│ ┌─ DueDate ──────────────────── minimize ─── [×] ┐│
│ │ Penalize lateness — only fires on the last...  ││
│ │                                                ││
│ │ Weight  ═══════════○═══════  35%               ││
│ │ Penalty [2.0]  Late amplifier (0=sym, 2=3×)    ││
│ │ ☑ Include in solve                             ││
│ └────────────────────────────────────────────────┘│
│                                                   │
│ ┌─ ResourceUtilization ────────── maximize ─ [×] ┐│
│ │ Spread work across resources...                ││
│ │ Weight  ════════○══════════  20%               ││
│ │ ☑ Include in solve                             ││
│ └────────────────────────────────────────────────┘│
│                                                   │
│ ┌─ Changeover ─────────────────── minimize ─ [×] ┐│
│ │ ...                                            ││
│ └────────────────────────────────────────────────┘│
│                                                   │
│ [Add a scoring rule... ▼]  [Add]                  │
│                                                   │
│ ┌─────────────────────────────────────────────── ┐│
│ │ Total weight: 100%                    ✓ Valid  ││
│ └─────────────────────────────────────────────── ┘│
│                                                   │
│ [Show scoring.json]                               │
│                                                   │
│ ┌─────────────────────────────────────────────── ┐│
│ │ { "rules": [ ... ] }                           ││
│ └─────────────────────────────────────────────── ┘│
└───────────────────────────────────────────────────┘
```

### 4d. Per-rule card

Each rule renders as a card with:

- **Header row**: rule display name (strip `ScoringRule` suffix) + objective badge (`minimize` in blue, `maximize` in green) + remove button (×)
- **Description**: one line from `RULE_CATALOG`
- **Weight slider**: range input 0-100 step 5, value displayed as percentage
- **Penalty factor**: number input, only shown for `DueDateScoringRule` (the only rule that uses it currently). Label: "Late amplifier (0 = symmetric, 2 = 3× penalty)"
- **Include toggle**: checkbox + "Include in solve" label. Unchecked rules are dimmed (opacity 0.45) and their weight is excluded from the total

Styling: use existing app patterns — `C.bg` background, `C.border` border, 10px border-radius, 14px padding. Match the experience level picker card aesthetic.

### 4e. Add rule dropdown

Below the rule cards, a `<select>` dropdown populated with rules NOT currently in the active list. Selecting a rule and clicking "Add" inserts it with default weight and penalty from `RULE_CATALOG`.

### 4f. Summary bar

Below the cards, a summary bar showing:
- **Total weight**: sum of weights for included rules, displayed as percentage
- **Status badge**: "✓ Valid — sums to 100%" (green) or "✗ Invalid — must sum to 100%" (red)

The engine throws "Scoring Rules must sum to 100%" if weights don't sum to 1.0 (within ±0.01 tolerance). The UI should validate this before the planner solves.

### 4g. Source indicator

At the top right of the section, show whether the active config came from the tenant config file or a runtime override:
- `config` → small badge: "From config" in muted text
- `override` → small badge: "Modified" in accent/yellow

### 4h. JSON preview toggle

A "Show scoring.json" link at the bottom that toggles a collapsible `<pre>` block showing the exact JSON that will be sent as `scoringOverrides`. Useful for Engineer-level users who want to verify or copy the config.

### 4i. Reset to config

A "Reset to tenant config" button (only shown when source is `override`) that clears `scoringOverrides` back to null, which makes the next solve use `scoring.json` again.

---

## Part 5: State Management

### 5a. New state in App component

Add alongside existing override state (~line 6296):

```typescript
const [scoringOverrides, setScoringOverrides] = useState<ScoringRuleOverride[] | null>(null);
```

### 5b. Derive active rules for the editor

The editor needs to show the current active rules. These come from:
1. `scoringOverrides` if the planner has made changes (not null)
2. `solveResult.scoring.rules` if a solve has been run (the config used for that solve)
3. Empty array if neither (no solve yet, no overrides)

```typescript
const activeScoringRules: ScoringRuleOverride[] = useMemo(() => {
  if (scoringOverrides) return scoringOverrides;
  if (solveResult?.scoring?.rules) return solveResult.scoring.rules;
  return [];
}, [scoringOverrides, solveResult]);

const scoringSource: 'config' | 'override' | null = scoringOverrides
  ? 'override'
  : solveResult?.scoring?.source || null;
```

### 5c. Wire into solve request

In `handleSolve` (~line 6430), add scoring overrides to the request body:

```typescript
// After existing overrides (priorityOverrides, windowOverrides, etc.):
if (scoringOverrides && scoringOverrides.length > 0) {
  body.scoringOverrides = scoringOverrides;
}
```

### 5d. Persist across solves within session

Unlike `taskPins` and `orderModes` which reset after solve, scoring overrides should persist across solves within the session. The planner sets their preferred weights once, then solves multiple times.

Do NOT clear `scoringOverrides` in the post-solve cleanup block.

### 5e. Mark solve as stale on scoring change

When the planner changes scoring rules, set the solve as stale so the "Review & Solve" button appears:

```typescript
const handleScoringRulesChange = useCallback((rules: ScoringRuleOverride[]) => {
  setScoringOverrides(rules);
  setSolveStale(true);
}, []);
```

---

## Part 6: Updated SettingsContent Props

Wire the new props through to `SettingsContent` at ~line 7298:

```typescript
<Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings" width={680}>
  <SettingsContent
    experienceLevel={experienceLevel}
    onExperienceChange={handleExperienceChange}
    stats={solveResult?.stats}
    solveResult={solveResult}
    scoringRules={activeScoringRules}
    onScoringRulesChange={handleScoringRulesChange}
    scoringSource={scoringSource}
  />
</Modal>
```

---

## Part 7: Testing Checklist

1. **Left-nav renders correctly** — General visible at all levels, Scoring at Analyst+, Solver at Engineer only
2. **Section switching** — clicking nav items shows the correct content panel, active state highlights
3. **Experience level change hides sections** — switching from Engineer to Planner while on Solver section falls back to General
4. **Scoring rules load from solve response** — after first solve, the editor shows the tenant's scoring config
5. **Weight slider adjusts** — dragging updates the percentage display and the total in real-time
6. **Total validation** — shows green when weights sum to 100%, red otherwise
7. **Add rule** — dropdown only shows rules not already active, adding inserts with defaults
8. **Remove rule** — × button removes the rule, total recalculates
9. **Include toggle** — unchecking dims the card and excludes its weight from the total
10. **Penalty factor** — number input only appears on DueDateScoringRule
11. **Source badge** — shows "From config" initially, switches to "Modified" after any edit
12. **Reset to config** — clears overrides, reverts to tenant config
13. **Solve includes overrides** — after editing, the solve request body includes `scoringOverrides` array
14. **Solve without edits** — no `scoringOverrides` in request, falls back to `scoring.json`
15. **Scoring persists across solves** — edit weights, solve, solve again — weights stay
16. **Stale indicator** — changing scoring rules triggers the stale solve banner
17. **JSON preview** — toggle shows valid JSON matching the current editor state
18. **Solver section** — shows timing breakdown, score breakdown, and raw stats from last solve
19. **Modal width** — modal is wide enough for left-nav + content without horizontal scroll
20. **No regression** — existing experience level picker and solver stats work as before

---

## Data Flow Summary

```
Settings modal (Scoring Rules editor)
  │
  ├── reads from: solveResult.scoring.rules (baseline from last solve)
  │                OR scoringOverrides state (if planner has edited)
  │
  ├── writes to: scoringOverrides state (via onChange callback)
  │              setSolveStale(true)
  │
  └── flows to solve request:
        if (scoringOverrides) → body.scoringOverrides = scoringOverrides
        else → server reads scoring.json (no override in request)
              │
              └── solve response includes:
                    scoring: { source: 'override' | 'config', rules: [...] }
                    stats: { scoreBreakdown: { ... }, ... }
```
