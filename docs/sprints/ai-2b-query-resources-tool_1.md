# AI Sprint 2 Amendment: `query_resources` Tool

**What it does:** Adds a 7th investigation tool to the AI assistant that answers attribute-based questions about resources. "Which fields have lights?", "Which umpires are CHSAA certified?", "Which courts are hard-court surface?" — all answered by querying `typedAttributes` on resources server-side.

**Size:** ~40 min CC work  
**Depends on:** AI Sprint 2 (the other 6 tools already wired up)  
**Why not in the solve response:** `typedAttributes` can be any size — passing them on every resource in the solve response bloats the payload and burns AI context tokens for data that's only needed on demand. Tool pattern keeps it targeted.

---

## Why

### Resource attributes — not in solve response at all

The solve response only gives the AI these fields per resource:
- `resourceKey`, `resourceName`
- `workCenter` (hierarchy level1), `line` (hierarchy level2)
- `resourceClass`
- Time intervals (`availability`, `netAvailable`, `assignments`)

No `typedAttributes`. No hierarchy levels 3–5. So "which fields have lights?" or "which machines are in Building 3?" gets either a wrong answer or "I don't have that information."

### Task attributes — already in solve response ✅

Tasks already include `typedAttributes: task.typedAttributes.toArray()` in the solve response (line 835 of `ctp_service.ts`). Every task already carries `sport`, `division`, `homeTeam`, `phase`, `capability`, `procedureType`, etc. to the AI.

**The AI should answer task attribute questions directly from its context — no tool needed.**

The `query_resources` tool is resource-only. The system prompt must make this distinction explicit so the AI doesn't call the tool unnecessarily for task questions.

---

## Part 1: New Backend Endpoint

### Controller — `GET /ctp/resources/query`

Add to `ctp.controller.ts`:

```typescript
// ─── Endpoint 10: Query Resources by Attribute ───

@Get('resources/query')
@ApiOperation({ summary: 'Query resources by typed attributes' })
@ApiQuery({ name: 'attribute', required: true, description: 'Attribute name, e.g. "lightingAvailable"' })
@ApiQuery({ name: 'value', required: false, description: 'Value to match' })
@ApiQuery({ name: 'includeAvailability', required: false, type: Boolean })
@ApiResponse({ status: 200, description: 'Matching resources with optional availability' })
queryResources(
  @Query('attribute') attribute: string,
  @Query('value') value?: string,
  @Query('includeAvailability') includeAvailability?: string,
) {
  return this.ctpService.queryResources(
    attribute,
    value,
    includeAvailability === 'true',
  );
}
```

### Service — `queryResources()`

Add to `ctp.service.ts`:

```typescript
queryResources(
  attribute: string,
  value: string | undefined,
  includeAvailability: boolean,
): any {
  const landscape = this.ensureLandscape();
  const resourceConfigs = this.configService.getResources();

  const results: any[] = [];

  for (const resConfig of resourceConfigs) {
    // Find the typed attribute on this resource
    const attr = resConfig.typedAttributes?.find(
      (a: any) => a.name.toLowerCase() === attribute.toLowerCase()
    );

    if (!attr) continue;

    // If a value filter was given, check it matches
    if (value !== undefined) {
      const attrVal = attr.value?.value;
      const match =
        String(attrVal).toLowerCase() === value.toLowerCase() ||
        (attrVal === true && (value === 'true' || value === '1')) ||
        (attrVal === false && (value === 'false' || value === '0'));
      if (!match) continue;
    }

    // Build full hierarchy object — include all populated levels (1–5)
    const h = resConfig.hierarchy ?? {};
    const hierarchy: Record<string, string> = {};
    if (h.level1) hierarchy.level1 = h.level1;
    if (h.level2) hierarchy.level2 = h.level2;
    if (h.level3) hierarchy.level3 = h.level3;
    if (h.level4) hierarchy.level4 = h.level4;
    if (h.level5) hierarchy.level5 = h.level5;

    const entry: any = {
      resourceKey: resConfig.key,
      resourceName: resConfig.name,
      hierarchy,
      [attribute]: attr.value?.value,
    };

    // Optionally include current availability from landscape
    if (includeAvailability) {
      const resource = landscape.resources.getEntity(resConfig.key);
      if (resource) {
        let totalAvailable = 0;
        if (resource.original) {
          let node = resource.original.head;
          while (node) { totalAvailable += node.data.duration(); node = node.next; }
        }
        let totalAssigned = 0;
        if (resource.assignments) {
          let node = resource.assignments.head;
          while (node) { totalAssigned += node.data.duration(); node = node.next; }
        }
        entry.utilization = totalAvailable > 0
          ? Math.round((totalAssigned / totalAvailable) * 10000) / 100
          : 0;
        entry.availableMinutes = Math.round((totalAvailable - totalAssigned) / 60);
      }
    }

    results.push(entry);
  }

  return {
    attribute,
    value: value ?? null,
    count: results.length,
    resources: results,
  };
}
```

---

## Part 2: AI Tool Definition

Add as the 7th tool alongside the existing 6 in the AI chat handler:

```typescript
const queryResourcesTool = {
  name: 'query_resources',
  description: 'Query RESOURCES by their typed attributes — physical properties, capabilities, certifications, location. Use when the planner asks which resources have a certain characteristic: lights, surface type, park location, sport type, certification level, fencing, capacity, machine capability, etc. Returns matching resources with full hierarchy and optional availability data. Do NOT use this for task/game/operation questions — task attributes are already in context.',
  input_schema: {
    type: 'object',
    properties: {
      attribute: {
        type: 'string',
        description: 'The attribute name to filter on (e.g. "lightingAvailable", "surface", "park", "certificationLevel", "sport", "fenced", "capability")',
      },
      value: {
        type: 'string',
        description: 'Optional value to match. For booleans use "true" or "false". For enums use the enum value (e.g. "hard-court", "chsaa-certified", "precision-grinding"). Omit to return all resources that HAVE this attribute regardless of value.',
      },
      include_availability: {
        type: 'boolean',
        description: 'Set true to include current utilization and available minutes for each matching resource. Useful when the planner also wants to know which matching resources are free right now.',
      },
    },
    required: ['attribute'],
  },
};
```

---

## Part 3: Tool Implementation (Frontend Caller)

In the `executeTool` dispatcher, add the new case:

```typescript
case 'query_resources':
  return await executeQueryResources(
    input.attribute,
    input.value,
    input.include_availability ?? false,
  );
```

New implementation:

```typescript
async function executeQueryResources(
  attribute: string,
  value: string | undefined,
  includeAvailability: boolean,
): Promise<string> {
  try {
    const params = new URLSearchParams({ attribute });
    if (value !== undefined) params.set('value', value);
    if (includeAvailability) params.set('includeAvailability', 'true');

    const response = await fetch(`/api/v1/ctp/resources/query?${params}`);
    const data = await response.json();

    if (data.count === 0) {
      return value
        ? `No resources found with ${attribute} = "${value}".`
        : `No resources have a "${attribute}" attribute defined.`;
    }

    let result = `${data.count} resource${data.count !== 1 ? 's' : ''} `;
    result += `with ${attribute}${value ? ` = ${value}` : ''}:\n\n`;

    for (const r of data.resources) {
      // Render hierarchy as breadcrumb from whatever levels exist
      const hierarchyParts = Object.values(r.hierarchy ?? {}).filter(Boolean);
      const location = hierarchyParts.join(' › ');

      result += `${r.resourceName} (${r.resourceKey})`;
      if (location) result += ` — ${location}`;
      result += '\n';

      if (includeAvailability && r.availableMinutes !== undefined) {
        result += `  Availability: ${r.availableMinutes} min free (${r.utilization}% utilized)\n`;
      }
    }

    return result;
  } catch (err) {
    return `Error querying resources: ${err.message}`;
  }
}
```

---

## Part 4: System Prompt Update

### Add to the tools list:
```
- query_resources: Find resources by attribute (lights, surface, park, certification, capability, etc.)
```

### Add routing guidance — this is the critical addition:

```
## Attribute Questions — Where to Look

Task attributes (sport, division, homeTeam, phase, procedureType, operation, etc.) are already
in the schedule summary above. Answer task attribute questions directly from context — do NOT
call query_resources for tasks.

Resource attributes (lighting, surface, park, certification, capability, fencing, etc.) are NOT
in the schedule summary. Always call query_resources for questions about resource properties.

Examples:
  "Which games are baseball?"               → answer from task context (sport on tasks)
  "Which fields have lights?"               → call query_resources (lightingAvailable on resources)
  "Which cases are cardiology?"             → answer from task context (procedureType on tasks)
  "Which ORs have laparoscopic equipment?"  → call query_resources (capability on resources)
  "Which operations need a lathe?"          → answer from task context (tasks carry resource requirements)
  "Which machines CAN do lathe work?"       → call query_resources (capability on resources)
```

---

## Example Conversations

### HRMD — Lighting query
```
Planner: "Which fields have lights?"

AI: [calls query_resources with attribute="lightingAvailable", value="true"]

    4 resources with lightingAvailable = true:

    Redstone - Roxborough Field (RS-ROXBOROUGH) — Redstone Park Diamonds
    Redstone - Heritage Field (RS-HERITAGE) — Redstone Park Diamonds
    Civic Green - Main Field (CG-MAIN) — Civic Green Park › Main Fields
    Falcon Park - Field 2 (FP-02) — Falcon Park Fields
```

### HRMD — Lighting + availability
```
Planner: "Which lighted fields are free tonight?"

AI: [calls query_resources with attribute="lightingAvailable", value="true", include_availability=true]

    4 resources with lightingAvailable = true:

    Redstone - Roxborough Field (RS-ROXBOROUGH) — 90 min free (62% utilized)
    Redstone - Heritage Field (RS-HERITAGE) — 180 min free (38% utilized)
    Civic Green - Main Field (CG-MAIN) — 0 min free (100% utilized)
    Falcon Park - Field 2 (FP-02) — 120 min free (50% utilized)

    Heritage and Falcon Park Field 2 have the most open time tonight.
```

### HRMD — Task attribute question (no tool call)
```
Planner: "Which games are pickleball this week?"

AI: [answers from task context — no tool call]

    6 pickleball games scheduled this week:
    PB-W1-01 through PB-W1-06 (sport = pickleball in task attributes)
```

### HRMD — Certification query
```
Planner: "Which umpires are CHSAA certified?"

AI: [calls query_resources with attribute="certificationLevel", value="chsaa-certified"]

    3 resources with certificationLevel = chsaa-certified:

    Umpire Harris (UMP-01) — Umpires
    Umpire Jacobs (UMP-02) — Umpires
    Umpire Lee (UMP-03) — Umpires
```

### Manufacturing — hierarchy-aware capability query
```
Planner: "Which machines can do precision grinding?"

AI: [calls query_resources with attribute="capability", value="precision-grinding"]

    2 resources with capability = precision-grinding:

    CNC-03 — Plant-1 › Shop-Floor › CNC-Bay
    CNC-07 — Plant-1 › Shop-Floor › Grinding-Bay
```

---

## Verification

- [ ] `GET /ctp/resources/query?attribute=lightingAvailable&value=true` returns lighted fields
- [ ] `GET /ctp/resources/query?attribute=certificationLevel&value=chsaa-certified` returns certified umpires
- [ ] `GET /ctp/resources/query?attribute=lightingAvailable` (no value) returns ALL resources that have the attribute
- [ ] `include_availability=true` adds utilization and availableMinutes to each result
- [ ] Response includes all populated hierarchy levels (level1–level5), not just level1/level2
- [ ] Hierarchy renders as "level1 › level2 › level3" breadcrumb in tool output
- [ ] AI calls `query_resources` for "which fields have lights?"
- [ ] AI calls `query_resources` with `include_availability=true` when availability also asked
- [ ] AI does NOT call `query_resources` for "which games are baseball?" — answers from task context
- [ ] AI does NOT call `query_resources` for "which cases are cardiology?" — answers from task context
- [ ] Unknown attribute returns `count: 0` with helpful message (not an error)
- [ ] Works across all three tenants (HRMD, Healthcare, Manufacturing)
- [ ] Other 6 Sprint 2 tools unaffected

---

## Size Estimate

- Backend endpoint + service method: ~15 min
- Tool definition + dispatcher case: ~5 min
- Frontend caller with hierarchy breadcrumb formatting: ~5 min
- System prompt routing guidance: ~5 min
- Testing: ~10 min
- **Total: ~40 min**
