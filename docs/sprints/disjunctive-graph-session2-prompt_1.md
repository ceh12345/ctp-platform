# Disjunctive Graph — Session 2: Analytics KPIs + AI Diagnose

**What it does:** Wire the critical path data from Session 1 into two consumers: (1) a new "Critical Path" KPI group in the Analytics tab with a detail view, and (2) critical path context in the AI system prompt + a new `get_critical_path` investigation tool.

**Size:** ~2 hours CC work
**Depends on:** Session 1 complete (`GET /ctp/critical-path` endpoint working, per-task `slack` and `isOnCriticalPath` in solve response)

---

## Part 1: Analytics — Backend Endpoint

### 1a. New endpoint: `GET /analytics/critical-path`

Add to the analytics controller (same pattern as `/analytics/utilization`, `/analytics/scheduling`, `/analytics/chains`):

```typescript
@Get('critical-path')
@ApiOperation({ summary: 'Critical path analysis for Analytics tab' })
getCriticalPathAnalytics() {
  return this.analyticsService.getCriticalPathAnalytics();
}
```

### 1b. Service implementation

This wraps the `DisjunctiveGraph` with analytics-specific formatting:

```typescript
getCriticalPathAnalytics(): any {
  const landscape = this.stateService.getLandscape();
  if (!landscape) return { status: 'no_data' };

  const graph = DisjunctiveGraph.buildFromLandscape(landscape);
  if (!graph.criticalPath) return { status: 'no_critical_path', message: 'No scheduled tasks' };

  const cp = graph.criticalPath;

  // Build per-resource breakdown
  const resourceBreakdown: any[] = [];
  const resourceCritTime = new Map<string, { name: string; time: number; taskCount: number }>();
  for (const node of graph.nodes) {
    if (!node.isOnCriticalPath) continue;
    const prev = resourceCritTime.get(node.resourceKey);
    resourceCritTime.set(node.resourceKey, {
      name: node.resourceName,
      time: (prev?.time ?? 0) + node.duration,
      taskCount: (prev?.taskCount ?? 0) + 1,
    });
  }
  for (const [key, val] of resourceCritTime) {
    resourceBreakdown.push({
      resourceKey: key,
      resourceName: val.name,
      criticalTime: val.time,
      criticalTimeFormatted: formatDuration(val.time),
      taskCount: val.taskCount,
      percentOfCriticalPath: cp.makespan > 0 ? Math.round((val.time / cp.makespan) * 100) : 0,
    });
  }
  resourceBreakdown.sort((a, b) => b.criticalTime - a.criticalTime);

  // Slack distribution buckets
  const slackBuckets = [
    { label: 'Critical (0)', count: 0, color: '#ef4444' },
    { label: '< 30min', count: 0, color: '#f97316' },
    { label: '30min – 2h', count: 0, color: '#eab308' },
    { label: '2h – 8h', count: 0, color: '#22c55e' },
    { label: '> 8h', count: 0, color: '#3b82f6' },
  ];
  for (const node of graph.nodes) {
    if (node.isOnCriticalPath) slackBuckets[0].count++;
    else if (node.totalSlack < 1800) slackBuckets[1].count++;
    else if (node.totalSlack < 7200) slackBuckets[2].count++;
    else if (node.totalSlack < 28800) slackBuckets[3].count++;
    else slackBuckets[4].count++;
  }

  // Critical path as ordered task list (for the strip visualization)
  const pathTasks = cp.path.map(p => ({
    key: p.key,
    name: p.name,
    resourceKey: p.resourceKey,
    resourceName: p.resourceName,
    duration: p.duration,
    durationFormatted: formatDuration(p.duration),
    start: p.start,
    end: p.end,
  }));

  return {
    status: 'ok',
    makespan: cp.makespan,
    makespanFormatted: cp.makespanFormatted,
    criticalTasks: cp.criticalTasks,
    totalTasks: cp.totalTasks,
    criticalPercent: cp.totalTasks > 0 ? Math.round((cp.criticalTasks / cp.totalTasks) * 100) : 0,
    bottleneckResource: cp.bottleneckResource,
    avgSlack: cp.avgSlack,
    avgSlackFormatted: formatDuration(cp.avgSlack),
    nearCriticalTasks: cp.nearCriticalTasks,
    resourceBreakdown,
    slackBuckets,
    segments: cp.segments,
    pathTasks,
  };
}

// Helper — reuse or add to a shared util
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}
```

---

## Part 2: Analytics — Frontend KPI Group

### 2a. Add "Critical Path" to the KPI catalog

In the analytics summary endpoint (`GET /analytics/summary`), add critical path KPIs to the returned `kpis` array. This is where the left-panel catalog entries come from:

```typescript
// In the analytics summary builder, add a new group:

// Compute critical path summary
const graph = DisjunctiveGraph.buildFromLandscape(landscape);
const cp = graph?.criticalPath;

if (cp) {
  kpis.push({
    key: 'critical-path-length',
    name: 'Critical Path',
    group: 'Critical Path',
    value: cp.makespanFormatted,
    numericValue: cp.makespan,
    status: 'info',  // neutral — not good/bad, just informational
    unit: '',
  });
  kpis.push({
    key: 'critical-path-bottleneck',
    name: 'Bottleneck Resource',
    group: 'Critical Path',
    value: `${cp.bottleneckResource.resourceName} (${cp.bottleneckResource.percentOfCriticalPath}%)`,
    numericValue: cp.bottleneckResource.percentOfCriticalPath,
    status: cp.bottleneckResource.percentOfCriticalPath > 50 ? 'warning' : 'good',
    unit: '%',
  });
  kpis.push({
    key: 'critical-path-tasks',
    name: 'Critical Tasks',
    group: 'Critical Path',
    value: `${cp.criticalTasks} of ${cp.totalTasks}`,
    numericValue: cp.criticalTasks,
    status: 'info',
    unit: '',
  });
  kpis.push({
    key: 'near-critical-tasks',
    name: 'Near-Critical (<30m slack)',
    group: 'Critical Path',
    value: cp.nearCriticalTasks,
    numericValue: cp.nearCriticalTasks,
    status: cp.nearCriticalTasks > 5 ? 'warning' : 'good',
    unit: '',
  });
  kpis.push({
    key: 'avg-slack',
    name: 'Average Slack',
    group: 'Critical Path',
    value: formatDuration(cp.avgSlack),
    numericValue: cp.avgSlack,
    status: cp.avgSlack < 1800 ? 'warning' : 'good',
    unit: '',
  });
}
```

### 2b. Critical Path detail view

In `App.tsx`, add a new detail component and wire it into the analytics panel's group routing:

```typescript
// In the detail content routing (where it checks selectedGroup):
} else if (selectedGroup === 'Critical Path' && detail) {
  detailContent = <CriticalPathDetail data={detail} experienceLevel={experienceLevel} onTaskClick={onTaskClick} />;
}

// Wire the endpoint:
} else if (kpi.group === 'Critical Path') {
  const data = await api('/analytics/critical-path');
  setAnalyticsDetail(data);
}
```

### 2c. CriticalPathDetail component

```typescript
function CriticalPathDetail({ data, experienceLevel, onTaskClick }: {
  data: any; experienceLevel: ExperienceLevel; onTaskClick?: (key: string) => void;
}) {
  if (!data || data.status !== 'ok') return null;

  return (
    <div>
      {/* Summary KPIs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPI icon="⏱" label="Critical Path" value={data.makespanFormatted} color={C.text}
          sub={`${data.criticalTasks} of ${data.totalTasks} tasks`} />
        <KPI icon="🔴" label="Bottleneck" value={data.bottleneckResource.resourceName}
          color={C.red} sub={`${data.bottleneckResource.percentOfCriticalPath}% of critical path`} />
        <KPI icon="⚠" label="Near-Critical" value={data.nearCriticalTasks}
          color={data.nearCriticalTasks > 5 ? C.yellow : C.green} sub="< 30min slack" />
        <KPI icon="📊" label="Avg Slack" value={data.avgSlackFormatted}
          color={data.avgSlack < 1800 ? C.yellow : C.green} sub="non-critical tasks" />
      </div>

      {/* Critical path strip — horizontal bar chart by resource segment */}
      <Card title="Critical path by resource">
        <div style={{ display: 'flex', gap: 2, height: 32, borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          {data.segments.map((seg: any, i: number) => {
            const pct = data.makespan > 0 ? (seg.totalDuration / data.makespan) * 100 : 0;
            // Color by resource — cycle through accent colors
            const colors = [C.accent, C.purple, C.green, C.orange, C.cyan, C.yellow, C.red];
            const color = colors[i % colors.length];
            return (
              <div key={i} style={{
                width: `${pct}%`, background: color + '40', borderLeft: i > 0 ? `1px solid ${C.border}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 600, color, overflow: 'hidden', whiteSpace: 'nowrap',
                minWidth: pct > 8 ? undefined : 0,
              }}>
                {pct > 8 && seg.resourceName}
              </div>
            );
          })}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: C.textMuted }}>
          {data.segments.map((seg: any, i: number) => {
            const colors = [C.accent, C.purple, C.green, C.orange, C.cyan, C.yellow, C.red];
            const color = colors[i % colors.length];
            const pct = data.makespan > 0 ? Math.round((seg.totalDuration / data.makespan) * 100) : 0;
            return (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                {seg.resourceName} ({pct}%)
              </span>
            );
          })}
        </div>
      </Card>

      {/* Resource breakdown table */}
      <Card title="Resource contribution to critical path" style={{ marginTop: 16 }}>
        {data.resourceBreakdown.map((rb: any) => (
          <div key={rb.resourceKey} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <span style={{ flex: 1, fontSize: 12, color: C.text }}>{rb.resourceName}</span>
            <span style={{ fontSize: 11, color: C.textMuted, minWidth: 50, textAlign: 'right' }}>
              {rb.taskCount} task{rb.taskCount !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.text, minWidth: 50, textAlign: 'right' }}>
              {rb.criticalTimeFormatted}
            </span>
            <div style={{ width: 100, height: 6, background: C.surface2, borderRadius: 3 }}>
              <div style={{
                width: `${rb.percentOfCriticalPath}%`, height: '100%', borderRadius: 3,
                background: rb.percentOfCriticalPath > 40 ? C.red : rb.percentOfCriticalPath > 20 ? C.yellow : C.accent,
              }} />
            </div>
            <span style={{ fontSize: 10, color: C.textDim, minWidth: 30, textAlign: 'right' }}>
              {rb.percentOfCriticalPath}%
            </span>
          </div>
        ))}
      </Card>

      {/* Slack distribution (intermediate+) */}
      {showAt(experienceLevel, 'intermediate') && (
        <Card title="Slack distribution" style={{ marginTop: 16 }}>
          {data.slackBuckets.map((bucket: any) => (
            <div key={bucket.label} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0',
            }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: bucket.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: C.text }}>{bucket.label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{bucket.count}</span>
            </div>
          ))}
        </Card>
      )}

      {/* Critical path task list (expert+) */}
      {showAt(experienceLevel, 'expert') && (
        <Card title="Critical path tasks" style={{ marginTop: 16 }}>
          {data.pathTasks.map((pt: any, i: number) => (
            <div key={pt.key} onClick={() => onTaskClick?.(pt.key)} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
              borderBottom: `1px solid ${C.border}`, cursor: onTaskClick ? 'pointer' : 'default',
              fontSize: 12,
            }}>
              <span style={{ color: C.textDim, minWidth: 20 }}>{i + 1}</span>
              <span style={{ flex: 1, color: C.text }}>{pt.name}</span>
              <span style={{ color: C.textMuted, minWidth: 80 }}>{pt.resourceName}</span>
              <span style={{ color: C.text, fontWeight: 600, minWidth: 50, textAlign: 'right' }}>{pt.durationFormatted}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
```

---

## Part 3: AI — System Prompt Enhancement

### 3a. Add critical path context to the schedule summary

The AI system prompt already includes schedule context (feasibility, utilization, task counts). Add critical path info from the solve response:

```typescript
// In the system prompt builder, after the existing schedule context:

if (solveResult.criticalPath) {
  const cp = solveResult.criticalPath;
  systemPrompt += `\n\nCritical Path Analysis:`;
  systemPrompt += `\n- Makespan: ${cp.makespanFormatted}`;
  systemPrompt += `\n- Bottleneck resource: ${cp.bottleneckResource.resourceName} (${cp.bottleneckResource.percentOfCriticalPath}% of critical path)`;
  systemPrompt += `\n- ${cp.criticalTasks} of ${cp.totalTasks} tasks are on the critical path`;
  systemPrompt += `\n- ${cp.nearCriticalTasks ?? 0} tasks are near-critical (< 30min slack)`;
  systemPrompt += `\n- Critical path passes through: ${cp.segments.map((s: any) => s.resourceName).join(' → ')}`;
}
```

### 3b. Add per-task slack to the task context

When the AI is given task details (e.g., in the `analyze_impact` tool or when responding about a specific task), include slack:

```typescript
// In task context formatting:
if (task.isOnCriticalPath) {
  taskContext += ` ⚡ ON CRITICAL PATH (zero slack — any slip extends makespan)`;
} else if (task.slack !== undefined) {
  taskContext += ` Slack: ${formatDuration(task.slack)}`;
  if (task.slack < 1800) taskContext += ` (near-critical)`;
}
```

### 3c. Routing guidance for the AI

Add to the system prompt's tool guidance section:

```
When the user asks about makespan, schedule length, bottlenecks, or "what's driving the schedule":
- Use the get_critical_path tool to get the current critical path analysis
- Explain which resource is the bottleneck and what percentage of the critical path it owns
- List the critical-path segments: "The critical path flows through CNC-01 (setup + machining, 4.5h) → Assembly-01 (assembly, 2h) → QC-01 (inspection, 1h)"
- For improvement suggestions, focus on the bottleneck resource — moving work off it is the highest-impact change
- Reference per-task slack when discussing whether a specific task matters: "TASK-007 is on the critical path with zero slack — if it slips, the whole schedule slips"
```

---

## Part 4: AI — New Investigation Tool

### 4a. Tool definition

Add `get_critical_path` as the 8th investigation tool:

```typescript
{
  name: 'get_critical_path',
  description: 'Get the critical path analysis showing which tasks and resources drive the makespan. Returns the bottleneck resource, critical path segments, per-resource contribution, and slack distribution. Use when the user asks about makespan, bottlenecks, schedule length, or what is driving the timeline.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
}
```

No parameters needed — it analyzes the current schedule state.

### 4b. Tool handler

In the tool-use loop handler:

```typescript
case 'get_critical_path': {
  const data = await fetch(`/api/v1/analytics/critical-path`, {
    headers: { 'X-Tenant-Id': tenantId },
  }).then(r => r.json());

  if (data.status !== 'ok') {
    toolResult = 'No critical path available — solve the schedule first.';
    break;
  }

  // Format for the AI — structured but readable
  let result = `Critical Path Analysis:\n`;
  result += `Makespan: ${data.makespanFormatted}\n`;
  result += `Bottleneck: ${data.bottleneckResource.resourceName} (${data.bottleneckResource.percentOfCriticalPath}% of critical path)\n`;
  result += `Critical tasks: ${data.criticalTasks} of ${data.totalTasks}\n`;
  result += `Near-critical tasks (< 30min slack): ${data.nearCriticalTasks}\n`;
  result += `Average slack (non-critical): ${data.avgSlackFormatted}\n\n`;

  result += `Critical path segments:\n`;
  for (const seg of data.segments) {
    const pct = data.makespan > 0 ? Math.round((seg.totalDuration / data.makespan) * 100) : 0;
    const taskNames = seg.tasks.map((t: any) => t.name).join(', ');
    result += `  ${seg.resourceName}: ${formatDuration(seg.totalDuration)} (${pct}%) — ${taskNames}\n`;
  }

  result += `\nResource breakdown:\n`;
  for (const rb of data.resourceBreakdown) {
    result += `  ${rb.resourceName}: ${rb.criticalTimeFormatted} (${rb.percentOfCriticalPath}%, ${rb.taskCount} tasks)\n`;
  }

  result += `\nSlack distribution:\n`;
  for (const bucket of data.slackBuckets) {
    result += `  ${bucket.label}: ${bucket.count} tasks\n`;
  }

  toolResult = result;
  break;
}
```

### 4c. Action button support

The AI can generate action buttons referencing critical-path tasks. Add routing guidance so the AI knows to offer:

```
After explaining the critical path, offer relevant actions:
- [openTask:TASK-KEY] — open the task detail panel for any critical-path task
- [whereTo:TASK-KEY] — suggest WhereTo for the most impactful critical-path task on the bottleneck
- [openTab:Analytics] — navigate to the Analytics tab for deeper analysis
```

---

## Part 5: Overview Tab — Add Critical Path KPI

Add a critical path KPI card to the Overview tab's KPI row (visible at intermediate+ level):

```typescript
// In OverviewTab, after the existing KPI cards:
{showAt(experienceLevel, 'intermediate') && solveResult?.criticalPath && (
  <KPI icon="🔗" label="Critical Path"
    value={solveResult.criticalPath.makespanFormatted}
    color={C.text}
    sub={`Bottleneck: ${solveResult.criticalPath.bottleneckResource.resourceName} (${solveResult.criticalPath.bottleneckResource.percentOfCriticalPath}%)`}
  />
)}
```

This gives planners at intermediate+ level a quick critical-path readout without navigating to the Analytics tab.

---

## Verification

### Analytics
- [ ] "Critical Path" group appears in KPI catalog left panel
- [ ] 5 KPIs: Critical Path length, Bottleneck Resource, Critical Tasks, Near-Critical, Avg Slack
- [ ] Clicking any Critical Path KPI loads the detail view via `/analytics/critical-path`
- [ ] Critical path strip visualization shows segments by resource with correct proportions
- [ ] Resource breakdown table sorted by contribution (highest first)
- [ ] Slack distribution buckets sum to total tasks
- [ ] Expert-level task list is clickable → opens task detail panel
- [ ] No critical path group when no tasks are scheduled

### AI
- [ ] System prompt includes critical path summary when available
- [ ] `get_critical_path` tool returns formatted analysis
- [ ] AI can answer "what's driving the makespan?" using the tool
- [ ] AI can answer "is TASK-007 on the critical path?" using per-task slack
- [ ] AI generates action buttons for critical-path tasks (openTask, whereTo)
- [ ] AI focuses improvement suggestions on the bottleneck resource

### Overview Tab
- [ ] Critical Path KPI card visible at intermediate+ level
- [ ] Shows makespan + bottleneck resource name + percentage
- [ ] Hidden at novice level

### Cross-tenant
- [ ] All 5 tenants show meaningful critical path data in Analytics
- [ ] Healthcare multi-resource: bottleneck correctly identifies scarcest resource type
- [ ] Sports: critical path reflects field + equipment chain

---

*After this session: Analytics tab has a full Critical Path section, AI can explain and investigate makespan drivers, Overview shows the critical path KPI. Ready for Session 3 (Gantt highlighting + WhereTo enhancement).*
