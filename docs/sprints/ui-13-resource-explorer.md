# Sprint 13: Resource Explorer

**What it does:** New top-level tab — a Resource Explorer page with a hierarchy tree on the left and two view modes on the right. Click a group node (hierarchy level) → multi-resource **Calendar** view showing all resources in that group as rows with time blocks. Click a leaf resource → single-resource **Agenda** view showing a chronological list of assignments, gaps, and availability. Provides the "where do I have capacity?" view planners use every morning.

**Size:** ~2-3 hours CC work  
**Depends on:** Nothing (uses existing solve response data)  
**Scenarios:** Morning Review (1), Rebalancing (4), Machine Breakdown (2)

---

## Why

The current UI shows resources on the Gantt (horizontal bars) and in the resource detail slide-over panel. But there's no way to:

- Browse resources by hierarchy (Park → Field Type → Field)
- See multiple resources side-by-side in a calendar layout
- Get a clean agenda for a single resource showing assignments AND gaps
- Answer "where's my open capacity this afternoon?" without scanning every Gantt row

The Resource Explorer gives planners a dedicated workspace for resource-centric questions.

---

## Data Already Available

The solve response `resourceUtilization[]` already contains everything needed per resource:

```typescript
{
  resourceKey: "SP-COURT11",
  resourceName: "Southpark Court 11",
  workCenter: "Southpark Courts",       // hierarchy level 1
  line: "Pickleball",                   // hierarchy level 2
  resourceClass: "REUSABLE",
  totalAvailable: 50400,
  totalAssigned: 28800,
  utilization: 57.14,
  availability: [                       // original shift/calendar intervals
    { start: "2026-06-06T13:00:00Z", end: "2026-06-07T04:00:00Z", durationSec: 54000 }
  ],
  assignments: [                        // what's booked
    { start: "2026-06-06T14:00:00Z", end: "2026-06-06T15:00:00Z", durationSec: 3600 },
    { start: "2026-06-06T16:00:00Z", end: "2026-06-06T17:30:00Z", durationSec: 5400 }
  ],
  netAvailable: [                       // gaps = availability minus assignments
    { start: "2026-06-06T13:00:00Z", end: "2026-06-06T14:00:00Z", durationSec: 3600 },
    { start: "2026-06-06T15:00:00Z", end: "2026-06-06T16:00:00Z", durationSec: 3600 },
    ...
  ]
}
```

**No engine or API changes needed.** This is pure frontend.

---

## Part 1: View Switcher Under Schedule Tab

Instead of a new top-level tab, add a **view switcher** within the existing Schedule tab. Three views share the same data, filters, and selection state.

### 1a. View Switcher Control

Add a segmented control or dropdown near the top-left of the Schedule tab, next to existing controls:

```
Schedule    Tasks    Orders    Materials    Analytics
┌──────────────────────────────────────────────────────────────────┐
│  [Gantt] [Calendar] [Agenda]  │  Filters...  │  Solve  │        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  (view content here)                                             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

- **Gantt** — existing view, default. No changes.
- **Calendar** — new Outlook-style vertical calendar with hierarchy tree
- **Agenda** — new single-resource chronological list

Use a segmented button group (like `[Gantt | Calendar | Agenda]`) styled consistently with existing UI controls. Active view is highlighted. Keyboard shortcut: `G` / `C` / `A` to switch.

### 1b. Shared State Across Views

All three views share:
- Same solve response data
- Same filter bar state (resource filters, time filters, category filters)
- Same task selection state
- Same detail panel (clicking a task in any view opens the same slide-over)

When switching views:
- Filters persist
- If a resource was selected/filtered in Gantt, Calendar opens with that resource pre-selected in the tree
- If switching from Calendar with a resource selected back to Gantt, that resource row is highlighted

### 1c. Gantt View (Existing — No Changes)

The current Gantt is View 1. No modifications needed. It becomes the default view.

### 1d. Calendar View Layout

When Calendar is selected, the Schedule tab content becomes:

```
┌──────────────┬───────────────────────────────────────────────────┐
│              │  Summary bar: 9 resources │ 71% avg │ Sat Jun 6   │
│  Hierarchy   ├───────────────────────────────────────────────────┤
│  Tree        │                                                   │
│              │   Outlook-style vertical calendar                 │
│  ▾ Southpark │   (hours down, columns across)                    │
│    ▾ Pickle  │                                                   │
│      Ct 11   │   [Day] [Week] [Month]  ◀ ▶                      │
│      Ct 12   │                                                   │
│    ▸ Basebal │                                                   │
│  ▸ Redstone  │                                                   │
│  ▸ Tanks Pk  │                                                   │
│              │                                                   │
└──────────────┴───────────────────────────────────────────────────┘
```

Left panel (hierarchy tree): ~220px, collapsible. Right panel (calendar grid): fills remaining space.

### 1e. Agenda View Layout

When Agenda is selected, the Schedule tab content becomes:

```
┌──────────────┬───────────────────────────────────────────────────┐
│              │  Court 11 │ 57% │ 15h avail │ 8h assigned        │
│  Hierarchy   ├───────────────────────────────────────────────────┤
│  Tree        │                                                   │
│              │  7:00 AM   🟢 Available (1h)                      │
│  ▾ Southpark │  8:00 AM   🔵 Drop-In PB-DI-08 (60 min)         │
│    ▾ Pickle  │             Pickleball │ Priority 6               │
│      Ct 11 ← │  9:00 AM   🟢 Available (30 min)                │
│      Ct 12   │  9:30 AM   🟠 League Match (90 min)              │
│    ▸ Basebal │             Pickleball │ Priority 5               │
│  ▸ Redstone  │  11:00 AM  🟢 Available (60 min)                 │
│  ▸ Tanks Pk  │  ...                                              │
│              │  9:00 PM   ⚫ Closed                               │
└──────────────┴───────────────────────────────────────────────────┘
```

Same hierarchy tree on the left. Right panel shows the agenda for the selected resource. If a group node is selected, show a combined agenda or prompt the user to select a specific resource.

The Agenda view always shows a **single resource for a single day**, with ◀ ▶ day navigation. It's the most detailed, scannable view — Coleen opens this to see "what's on Flatirons Field today?"

---

## Part 2: Hierarchy Tree (Left Panel)

### 2a. Build the tree from solve response

Parse `resourceUtilization[]` to build a tree structure. Group by `workCenter` (level 1), then by `line` (level 2), then leaf = individual resource.

```typescript
interface ResourceTreeNode {
  key: string;           // group key or resourceKey
  label: string;         // display name
  type: 'group' | 'resource';
  level: number;         // 0 = root, 1 = workCenter, 2 = line, 3 = resource
  children: ResourceTreeNode[];
  utilization?: number;  // avg for groups, actual for resources
  resourceCount?: number;
  // For leaf nodes only:
  resourceData?: ResourceUtilization;
}
```

Build logic:

```typescript
function buildResourceTree(resources: ResourceUtilization[]): ResourceTreeNode[] {
  const tree: ResourceTreeNode[] = [];
  
  // Group by workCenter (level 1)
  const byWorkCenter = groupBy(resources, r => r.workCenter || 'Ungrouped');
  
  for (const [wcName, wcResources] of Object.entries(byWorkCenter)) {
    const wcNode: ResourceTreeNode = {
      key: `wc-${wcName}`,
      label: wcName,
      type: 'group',
      level: 1,
      children: [],
      utilization: avgUtilization(wcResources),
      resourceCount: wcResources.length,
    };
    
    // Group by line (level 2) within this workCenter
    const byLine = groupBy(wcResources, r => r.line || '');
    
    if (Object.keys(byLine).length === 1 && Object.keys(byLine)[0] === '') {
      // No level 2 — resources are direct children of workCenter
      for (const res of wcResources) {
        wcNode.children.push({
          key: res.resourceKey,
          label: res.resourceName,
          type: 'resource',
          level: 2,
          children: [],
          utilization: res.utilization,
          resourceData: res,
        });
      }
    } else {
      // Has level 2 grouping
      for (const [lineName, lineResources] of Object.entries(byLine)) {
        const lineNode: ResourceTreeNode = {
          key: `ln-${wcName}-${lineName}`,
          label: lineName || 'Other',
          type: 'group',
          level: 2,
          children: [],
          utilization: avgUtilization(lineResources),
          resourceCount: lineResources.length,
        };
        
        for (const res of lineResources) {
          lineNode.children.push({
            key: res.resourceKey,
            label: res.resourceName,
            type: 'resource',
            level: 3,
            children: [],
            utilization: res.utilization,
            resourceData: res,
          });
        }
        
        wcNode.children.push(lineNode);
      }
    }
    
    tree.push(wcNode);
  }
  
  return tree;
}
```

### 2b. Tree rendering

Each tree node shows:

```
▾ Southpark Courts (23 resources, 62%)
  ▾ Pickleball (9 resources, 71%)
    ● Court 11                    57%
    ● Court 12                    83%
    ● Court 13                    45%
  ▸ Baseball (8 resources, 54%)
  ▸ Multi-Use (6 resources, 58%)
```

- Expand/collapse triangles (▸/▾) for group nodes
- Small utilization percentage on the right, color-coded:
  - Green: 0-70%
  - Yellow: 70-85%
  - Red: 85%+
- Leaf nodes show a small colored dot (●) matching utilization color
- Selected node highlighted with background color
- Click group → Calendar view on right
- Click leaf resource → Agenda view on right
- Default state: first group node expanded and selected

### 2c. Tree interactions

- Single click selects node and updates right panel
- Double-click group node toggles expand/collapse
- Small search/filter input at top of tree: type to filter resources by name
- "Expand All" / "Collapse All" toggle button at top

---

## Part 3: Calendar View (Outlook/Google Calendar Style)

The calendar uses a vertical layout like Outlook or Google Calendar: **hours on the Y-axis, columns across the top, event cards placed in cells spanning their duration.** Day/Week/Month toggle controls the time range.

The column content depends on what's selected in the tree:

- **Group node selected** → columns = resources in that group (e.g. Court 11, Court 12, Court 13...)
- **Leaf resource selected** → columns = days (Mon, Tue, Wed, Thu, Fri...)

### 3a. Group Selected — Multi-Resource Day View

When a group node is selected, default to **Day view** showing one day with resources as columns:

```
  Pickleball Courts — Sat Jun 6                    ◀ ▶   Day | Week
  ┌──────────┬────────────┬────────────┬────────────┬────────────┐
  │          │ Court 11   │ Court 12   │ Court 13   │ Court 14   │
  │          │   57%      │   83%      │   45%      │   68%      │
  ├──────────┼────────────┼────────────┼────────────┼────────────┤
  │  7:00    │            │ ▓▓▓▓▓▓▓▓▓▓│            │            │
  │          │            │  League    │            │            │
  │  7:30    │            │  Match     │            │ ▓▓▓▓▓▓▓▓▓▓│
  │          │            │  90 min    │            │  Drop-In   │
  │  8:00    │ ▓▓▓▓▓▓▓▓▓▓│            │            │  60 min    │
  │          │  Drop-In   │            │            │            │
  │  8:30    │  60 min    │            │            │            │
  │          │            │            │            │            │
  │  9:00    │            │ ▓▓▓▓▓▓▓▓▓▓│            │            │
  │          │            │  Drop-In   │ ▓▓▓▓▓▓▓▓▓▓│            │
  │  9:30    │ ▓▓▓▓▓▓▓▓▓▓│  30 min    │  Drop-In   │            │
  │          │  League    │            │  90 min    │            │
  │ 10:00    │  Match     │            │            │ ▓▓▓▓▓▓▓▓▓▓│
  │          │  90 min    │            │            │  League    │
  │ 10:30    │            │            │            │  Match     │
  │          │            │            │            │  90 min    │
  │ 11:00    │            │            │            │            │
  └──────────┴────────────┴────────────┴────────────┴────────────┘
```

- Hours on the left (Y-axis), 30-minute grid lines
- Resource columns across the top with name and utilization %
- Event cards span vertically based on duration
- Off-shift hours (before/after resource availability) shown as grayed-out rows
- ◀ ▶ arrows navigate between days
- Scrollable vertically for long days, scrollable horizontally if many resources

### 3b. Leaf Resource Selected — Week View

When a single resource is selected, default to **Week view** showing days as columns:

```
  Court 11 — Week of Jun 6                         ◀ ▶   Day | Week
  ┌──────────┬────────────┬────────────┬────────────┬────────────┐
  │          │ Sat 6/6    │ Sun 6/7    │ Mon 6/8    │ Tue 6/9    │
  ├──────────┼────────────┼────────────┼────────────┼────────────┤
  │  7:00    │            │            │            │            │
  │          │            │            │            │            │
  │  7:30    │            │            │            │            │
  │          │            │            │            │            │
  │  8:00    │ ▓▓▓▓▓▓▓▓▓▓│            │            │ ▓▓▓▓▓▓▓▓▓▓│
  │          │  Drop-In   │ ████████████│            │  Drop-In   │
  │  8:30    │  60 min    │  Courts    │            │  90 min    │
  │          │            │  Closed    │            │            │
  │  9:00    │            │  (Sunday   │            │            │
  │          │            │  opens at  │            │            │
  │  9:30    │ ▓▓▓▓▓▓▓▓▓▓│  noon)     │ ▓▓▓▓▓▓▓▓▓▓│            │
  │          │  League    │            │  Drop-In   │            │
  │ 10:00    │  Match     │            │  60 min    │            │
  │          │  90 min    │            │            │            │
  │ 10:30    │            │            │            │            │
  └──────────┴────────────┴────────────┴────────────┴────────────┘
```

- Same vertical hour grid
- Days as columns — shows the full week for this one resource
- Off-shift / closed times shown as dark blocked-out regions
- ◀ ▶ arrows navigate weeks

### 3c. Day / Week / Month Toggle

| View | Group Selected (columns = resources) | Leaf Selected (columns = days) |
|------|--------------------------------------|-------------------------------|
| **Day** | All resources for one day | One resource for one day (tall single column — most detail) |
| **Week** | All resources for one day, ◀ ▶ by day within the week (same as Day but with week context in nav) | One resource for 7 days — the default Outlook weekly view |
| **Month** | Not applicable for groups (too dense) — hide or disable | One resource for 4 weeks, compact blocks showing just color + count. Like Outlook month view with small event chips. |

Default selection:
- Group node → **Day** view
- Leaf resource → **Week** view

### 3d. Event Card Design

Each event card in the calendar should look like a Google Calendar event:

```
┌─────────────────────┐
│ 🔵 Drop-In          │  ← colored left border or background by processCategory
│ 8:00 – 9:00 AM      │  ← time range
│ Pickleball           │  ← process category (if room)
└─────────────────────┘
```

- **Color**: by processCategory (Baseball = blue, Pickleball = green, etc.) or use the tenant's color config
- **Height**: proportional to duration (30 min = 1 row, 60 min = 2 rows, 90 min = 3 rows)
- **Content**: task name (line 1), time range (line 2), processCategory (line 3 if card is tall enough)
- **Hover tooltip**: full task details — task key, order ref, priority, all assigned resources, duration
- **Click**: opens task detail panel (existing slide-over)
- **Short events (30 min)**: show only task name, truncated. Details on hover.

### 3e. Available Gap Rendering

Empty white space within availability hours = available. No special card needed — the absence of an event card IS the available indicator. This matches how Outlook/Google Calendar works.

Optionally: on hover over empty space, show a subtle tooltip: "Available: 9:00 – 9:30 AM (30 min)"

### 3f. Off-Shift / Closed Rendering

Time outside the resource's availability windows should be:
- Grayed-out background (like Outlook's non-working hours)
- Not interactive
- Visually distinct from available-but-unbooked time

### 3g. Summary Bar

Above the calendar, show a summary for the current selection:

```
Pickleball Courts: 9 resources │ Avg Util: 71% │ Sat Jun 6 │ 30 assignments │ 12h available
```

For leaf resource:
```
Court 11 │ 57% utilized │ Week of Jun 6 │ 12 assignments │ 26h available
```

---

## Part 4: Agenda View (Sidebar List)

The Agenda is a **companion panel** below or beside the calendar — a simple chronological text list for the currently selected day. Like Outlook's agenda pane. It shows the same data as the calendar but in a scannable list format.

### 4a. Layout

The agenda appears below the calendar (or as a toggleable right sidebar) for the currently visible day:

```
  Agenda — Sat Jun 6
  ────────────────────────────────────────
  7:00 AM   🟢 Available (1h)
  8:00 AM   🔵 Drop-In PB-DI-08 (60 min)
            Pickleball │ Court 11 │ Priority 6
  9:00 AM   🟢 Available (30 min)
  9:30 AM   🟠 League Match PB-OD-W1-01 (90 min)
            Pickleball │ Court 11 │ Priority 5
  11:00 AM  🟢 Available (60 min)
  12:00 PM  🔵 Drop-In PB-DI-12 (60 min)
            Pickleball │ Court 11 │ Priority 6
  1:00 PM   🟢 Available (2h)
  3:00 PM   🔵 Drop-In PB-DI-15 (120 min)
            Pickleball │ Court 11 │ Priority 6
  5:00 PM   🟢 Available (4h)
  9:00 PM   ⚫ Closed
```

### 4b. When to show the agenda

- **Leaf resource selected**: agenda shows for the selected day (syncs with calendar day navigation)
- **Group selected + Day view**: agenda shows for the resource whose column is clicked/hovered
- **Week/Month view**: agenda shows for the day column that's clicked

### 4c. Agenda item data

Build by merging availability, assignments, and off-shift intervals (same logic as before):

```typescript
interface AgendaItem {
  type: 'assignment' | 'available' | 'off-shift';
  start: string;
  end: string;
  durationSec: number;
  taskKey?: string;
  taskName?: string;
  orderRef?: string;
  processCategory?: string;
  priority?: number;
}
```

Cross-reference assignments with `tasks[]` from solve response to get task name, order, category, priority.

### 4d. Agenda interactions

- Click an assignment row → opens task detail panel
- Click available gap → no action (future: "schedule something here")
- Agenda scrolls in sync with calendar — clicking a calendar event highlights the agenda row and vice versa

---

## Part 5: Navigation Integration

### 5a. No New Tab

The Calendar and Agenda views live under the existing Schedule tab. No changes to top-level navigation.

### 5b. Cross-navigation from Gantt

The existing Gantt resource labels get an updated right-click context menu:

```
Right-click resource label on Gantt:
  ├─ Filter Tasks by Resource (existing)
  ├─ Open Resource Detail (existing panel)
  ├─ View in Calendar ← NEW — switches to Calendar view with this resource's group selected
  └─ View Agenda ← NEW — switches to Agenda view with this resource selected
```

### 5c. Cross-navigation from Resource Detail Panel

The existing resource detail slide-over panel gets links:

```
"View Calendar →"  — switches to Calendar view, resource's group selected
"View Agenda →"    — switches to Agenda view, this resource selected
```

### 5d. Cross-navigation from Calendar/Agenda back to Gantt

Event cards in Calendar and assignment rows in Agenda get:
- **Click** → opens task detail panel (existing slide-over)
- **"View in Gantt →"** link in tooltip or detail panel → switches to Gantt view scrolled to that resource/time

### 5e. URL State (Optional)

Encode the active view in the URL for bookmarkability:

```
localhost:3001?tenant=hrmd-sports&view=calendar&resource=SP-COURT11
localhost:3001?tenant=hrmd-sports&view=agenda&resource=SP-COURT11&day=2026-06-06
localhost:3001?tenant=hrmd-sports&view=gantt  (default)
```

---

## Part 6: Terminology

The page should respect terminology throughout:

| Element | Source | Manufacturing | Healthcare | HRMD Sports |
|---------|--------|--------------|------------|-------------|
| Tab label | `terminology.resource` + "s" | "Resources" | "Resources" | "Resources" |
| Tree group headers | `workCenter`/`line` from response | "CNC Bay" / "Line A" | "Operating Rooms" / "Surgeons" | "Southpark Courts" / "Pickleball" |
| Assignment labels | `terminology.task` | "Task" | "Case" | "Activity" |
| Available gaps | hardcoded | "Available" | "Available" | "Available" |
| Off-shift | hardcoded | "Off Shift" | "Off Shift" | "Closed" |

---

## Part 7: Responsive Behavior

- **Tree panel**: collapsible — button to toggle tree visibility for more calendar/agenda space
- **Calendar rows**: scrollable vertically if more resources than viewport height
- **Calendar time axis**: scrollable horizontally, with pinned resource labels
- **Agenda**: scrollable vertically, standard page scroll
- **Minimum viable**: if viewport is narrow, tree collapses to icons or a dropdown

---

## Part 8: Verification

After implementing:

- [ ] View switcher appears in Schedule tab: [Gantt] [Calendar] [Agenda]
- [ ] Gantt view is default and unchanged
- [ ] Switching views preserves filter state
- [ ] Calendar: hierarchy tree builds correctly from solve response (workCenter → line → resource)
- [ ] Calendar: tree shows utilization percentages with color coding (green/yellow/red)
- [ ] Calendar: clicking group node shows vertical day calendar with resource columns
- [ ] Calendar: clicking leaf resource shows vertical week calendar with day columns
- [ ] Calendar: event cards span vertically proportional to duration
- [ ] Calendar: event cards colored by processCategory
- [ ] Calendar: off-shift hours grayed out like Outlook non-working hours
- [ ] Calendar: Day/Week/Month toggle works
- [ ] Calendar: ◀ ▶ day/week navigation works
- [ ] Calendar: clicking event card opens task detail panel
- [ ] Agenda: shows chronological list for selected resource and day
- [ ] Agenda: assignments, available gaps, and off-shift items rendered correctly
- [ ] Agenda: clicking assignment row opens task detail panel
- [ ] Agenda: ◀ ▶ day navigation works
- [ ] Cross-nav: Gantt right-click → "View in Calendar" / "View Agenda" works
- [ ] Cross-nav: Resource detail panel → "View Calendar" / "View Agenda" works
- [ ] Cross-nav: Calendar/Agenda → "View in Gantt" navigates back correctly
- [ ] Tree search/filter narrows visible resources
- [ ] Summary bar shows correct stats for selected group or resource
- [ ] Works for all three tenants: Manufacturing, Healthcare, HRMD Sports
- [ ] No new API endpoints needed — uses existing solve response data

---

## Size Estimate

- Engine/API: **None** — all data already available in solve response
- Frontend: New tab, tree component, calendar component, agenda component, cross-nav wiring
- Total: ~2-3 hours CC work
