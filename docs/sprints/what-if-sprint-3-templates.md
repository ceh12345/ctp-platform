# What-If Sprint 3: Order Templates

**What it does:** Replaces clone-from-chain with configurable order templates in tenant config. Instead of "schedule another one like C001," the planner selects "Knee Replacement" from a template catalog. Templates define the chain structure, resource types, durations, and chain constraints — independent of any existing order.

**Why:** Clone-from-chain (Sprint 1) works but has limitations: it copies a specific order's resource preferences (C001 prefers Dr. Smith — is that right for every knee replacement?), and it requires an existing order of that type to exist. Templates are reusable, tenant-configured, and independent of current schedule data.

**Size:** ~1-1.5 hours  
**Depends on:** What-If Sprint 1 (CTP query endpoint), What-If Sprint 2 (session mode)

---

## Part 1: Template Configuration

### 1a. New tenant config file: `orderTemplates.json`

```json
[
  {
    "key": "knee-replacement",
    "name": "Knee Replacement",
    "category": "Orthopedic",
    "defaultPriority": 50,
    "tasks": [
      {
        "nameSuffix": "Pre-Op",
        "type": "SETUP",
        "durationMinutes": 30,
        "resources": [
          { "type": "Operating Room", "isPrimary": true },
          { "type": "Nurse", "isPrimary": false }
        ],
        "chainLink": { "maxGap": 0 }
      },
      {
        "nameSuffix": "Procedure",
        "type": "PROCESS",
        "durationMinutes": 120,
        "resources": [
          { "type": "Operating Room", "isPrimary": true },
          { "type": "Surgeon", "isPrimary": false },
          { "type": "Anesthesiologist", "isPrimary": false },
          { "type": "Nurse", "isPrimary": false }
        ],
        "chainLink": { "maxGap": 0 }
      },
      {
        "nameSuffix": "Recovery",
        "type": "TEARDOWN",
        "durationMinutes": 180,
        "resources": [
          { "type": "Recovery Bay", "isPrimary": true }
        ],
        "chainLink": { "maxGap": 1800 }
      }
    ]
  },
  {
    "key": "hip-replacement",
    "name": "Hip Replacement",
    "category": "Orthopedic",
    "defaultPriority": 50,
    "tasks": [
      {
        "nameSuffix": "Pre-Op",
        "type": "SETUP",
        "durationMinutes": 30,
        "resources": [
          { "type": "Operating Room", "isPrimary": true },
          { "type": "Nurse", "isPrimary": false }
        ],
        "chainLink": { "maxGap": 0 }
      },
      {
        "nameSuffix": "Procedure",
        "type": "PROCESS",
        "durationMinutes": 150,
        "resources": [
          { "type": "Operating Room", "isPrimary": true },
          { "type": "Surgeon", "isPrimary": false },
          { "type": "Anesthesiologist", "isPrimary": false },
          { "type": "Nurse", "isPrimary": false },
          { "type": "Equipment", "isPrimary": false, "filter": "fluoroscopy" }
        ],
        "chainLink": { "maxGap": 0 }
      },
      {
        "nameSuffix": "Recovery",
        "type": "TEARDOWN",
        "durationMinutes": 180,
        "resources": [
          { "type": "Recovery Bay", "isPrimary": true }
        ],
        "chainLink": { "maxGap": 1800 }
      }
    ]
  },
  {
    "key": "pain-injection",
    "name": "Pain Injection",
    "category": "Pain Management",
    "defaultPriority": 75,
    "tasks": [
      {
        "nameSuffix": "Prep",
        "type": "SETUP",
        "durationMinutes": 15,
        "resources": [
          { "type": "Operating Room", "isPrimary": true },
          { "type": "Nurse", "isPrimary": false }
        ],
        "chainLink": { "maxGap": 0 }
      },
      {
        "nameSuffix": "Injection",
        "type": "PROCESS",
        "durationMinutes": 30,
        "resources": [
          { "type": "Operating Room", "isPrimary": true },
          { "type": "Surgeon", "isPrimary": false },
          { "type": "Nurse", "isPrimary": false },
          { "type": "Equipment", "isPrimary": false, "filter": "fluoroscopy" }
        ],
        "chainLink": { "maxGap": 0 }
      },
      {
        "nameSuffix": "Recovery",
        "type": "TEARDOWN",
        "durationMinutes": 60,
        "resources": [
          { "type": "Recovery Bay", "isPrimary": true }
        ],
        "chainLink": { "maxGap": 900 }
      }
    ]
  }
]
```

### 1b. Manufacturing templates

```json
[
  {
    "key": "standard-machining",
    "name": "Standard Machining Job",
    "category": "Machining",
    "defaultPriority": 50,
    "tasks": [
      {
        "nameSuffix": "Setup",
        "type": "SETUP",
        "durationMinutes": 45,
        "resources": [
          { "type": "CNC Machine", "isPrimary": true },
          { "type": "Operator", "isPrimary": false }
        ],
        "chainLink": { "maxGap": 0 }
      },
      {
        "nameSuffix": "Run",
        "type": "PROCESS",
        "durationMinutes": 120,
        "resources": [
          { "type": "CNC Machine", "isPrimary": true }
        ],
        "chainLink": { "maxGap": 0 }
      },
      {
        "nameSuffix": "QC",
        "type": "TEARDOWN",
        "durationMinutes": 30,
        "resources": [
          { "type": "QC Station", "isPrimary": true }
        ],
        "chainLink": { "maxGap": 3600 }
      }
    ]
  }
]
```

### 1c. HRMD templates

```json
[
  {
    "key": "baseball-game",
    "name": "Baseball Game",
    "category": "Baseball",
    "defaultPriority": 50,
    "tasks": [
      {
        "nameSuffix": "Field Prep",
        "type": "SETUP",
        "durationMinutes": 15,
        "resources": [
          { "type": "Diamond Field", "isPrimary": true },
          { "type": "Field Prep Equipment", "isPrimary": false }
        ],
        "chainLink": { "maxGap": 0 }
      },
      {
        "nameSuffix": "Game",
        "type": "PROCESS",
        "durationMinutes": 90,
        "resources": [
          { "type": "Diamond Field", "isPrimary": true },
          { "type": "Umpire", "isPrimary": false }
        ],
        "chainLink": { "maxGap": 0 }
      },
      {
        "nameSuffix": "Field Reset",
        "type": "TEARDOWN",
        "durationMinutes": 15,
        "resources": [
          { "type": "Diamond Field", "isPrimary": true },
          { "type": "Field Prep Equipment", "isPrimary": false }
        ],
        "chainLink": { "maxGap": 0 }
      }
    ]
  }
]
```

---

## Part 2: Template Hydration

### 2a. Resource type → resource preferences resolution

Templates specify resource **types**, not specific resources. During hydration, resolve types to all resources of that type in the tenant:

```typescript
private resolveResourcePreferences(
  resourceType: string,
  filter: string | undefined,
  landscape: SchedulingLandscape,
): CTPResourcePreference[] {
  const prefs: CTPResourcePreference[] = [];
  let rank = 1;

  landscape.resources?.forEach(resource => {
    if (resource.type === resourceType) {
      // Apply optional filter (e.g., "fluoroscopy" equipment)
      if (filter && !resource.name?.toLowerCase().includes(filter.toLowerCase())
          && !resource.key?.toLowerCase().includes(filter.toLowerCase())) {
        return;
      }
      prefs.push({ resourceKey: resource.key, rank: rank++ });
    }
  });

  return prefs;
}
```

### 2b. Template → CTPProcess + CTPTask[]

```typescript
private hydrateFromTemplate(
  template: OrderTemplate,
  orderName: string,
  landscape: SchedulingLandscape,
  overrides?: {
    priority?: number;
    durationOverrides?: Record<string, number>;
    preferredResources?: Record<string, string[]>;
  },
): { chain: CTPProcess; tasks: CTPTask[] } {
  const chainKey = `CTP-${Date.now()}`;
  const chain = new CTPProcess(orderName);
  chain.key = chainKey;
  chain.category = template.category;

  const tasks: CTPTask[] = [];
  let prevTaskKey: string | null = null;

  for (let i = 0; i < template.tasks.length; i++) {
    const tmpl = template.tasks[i];
    const taskKey = `${chainKey}-${tmpl.type || i}`;

    const task = new CTPTask();
    task.key = taskKey;
    task.name = `${orderName} - ${tmpl.nameSuffix}`;
    task.type = tmpl.type;
    task.priority = overrides?.priority ?? template.defaultPriority;

    // Duration (with optional override)
    const durationSec = (overrides?.durationOverrides?.[tmpl.nameSuffix]
      ?? tmpl.durationMinutes) * 60;
    task.duration = new CTPDuration(durationSec);

    // Resources — resolve types to tenant resources
    for (const resTmpl of tmpl.resources) {
      let prefs = this.resolveResourcePreferences(
        resTmpl.type, resTmpl.filter, landscape
      );

      // Apply preferred resource override if provided
      if (overrides?.preferredResources?.[resTmpl.type]) {
        const preferred = overrides.preferredResources[resTmpl.type];
        prefs = this.boostPreferences(prefs, preferred);
      }

      const tr = new CTPTaskResource(
        prefs[0]?.resourceKey || '', resTmpl.isPrimary, 1, ''
      );
      prefs.forEach(p => tr.addPreference(p.resourceKey, p.rank));
      task.capacityResources?.add(tr);
    }

    // Chain link
    if (tmpl.chainLink && prevTaskKey) {
      task.linkId = {
        name: chainKey,
        prevLink: prevTaskKey,
        maxGap: tmpl.chainLink.maxGap,
      };
    } else if (i === 0) {
      task.linkId = { name: chainKey, prevLink: null, maxGap: null };
    }

    // Window — full horizon
    task.window = new CTPWindow(landscape.horizon.startW, landscape.horizon.endW);

    tasks.push(task);
    chain.tasks?.add(task);
    prevTaskKey = taskKey;
  }

  return { chain, tasks };
}
```

---

## Part 3: Updated CTP Query

### 3a. Extended CTPQueryDto

```typescript
export class CTPQueryDto {
  // Option A: clone from existing chain
  sourceChainKey?: string;

  // Option B: use a template (new in Sprint 3)
  templateKey?: string;

  // Required
  orderName: string;

  // Optional overrides
  priority?: number;
  dueDate?: string;
  preferredResources?: Record<string, string[]>;
  durationOverrides?: Record<string, number>;  // nameSuffix → minutes
  maxOptions?: number;
}
```

### 3b. Updated CTP query logic

```typescript
public ctpQuery(request: CTPQueryDto): CTPQueryResponse {
  // ...

  let cloned;
  if (request.templateKey) {
    const template = this.configService.getOrderTemplate(request.templateKey);
    if (!template) throw new HttpException(
      `Template ${request.templateKey} not found`, HttpStatus.NOT_FOUND
    );
    cloned = this.hydrateFromTemplate(template, request.orderName, landscape, {
      priority: request.priority,
      durationOverrides: request.durationOverrides,
      preferredResources: request.preferredResources,
    });
  } else if (request.sourceChainKey) {
    cloned = this.cloneChainFromExisting(
      request.sourceChainKey, request.orderName, landscape
    );
  } else {
    throw new HttpException(
      'Either sourceChainKey or templateKey is required', HttpStatus.BAD_REQUEST
    );
  }

  // ... rest of evaluation logic unchanged ...
}
```

### 3c. Template list endpoint

```typescript
@Get('ctp/templates')
@ApiOperation({ summary: 'List available order templates for this tenant' })
getTemplates() {
  const templates = this.configService.getOrderTemplates();
  return {
    templates: templates.map(t => ({
      key: t.key,
      name: t.name,
      category: t.category,
      defaultPriority: t.defaultPriority,
      taskCount: t.tasks.length,
      totalDurationMinutes: t.tasks.reduce((sum, task) => sum + task.durationMinutes, 0),
      tasks: t.tasks.map(task => ({
        nameSuffix: task.nameSuffix,
        type: task.type,
        durationMinutes: task.durationMinutes,
        resourceTypes: task.resources.map(r => r.type),
      })),
    })),
  };
}
```

---

## Part 4: Updated UI

### 4a. CTP Query dialog — template selector

Update the "Based on" dropdown to show both templates and existing chains:

```
Based on:
┌──────────────────────────────────────┐
│  Templates                           │
│    Knee Replacement (3 tasks, 5.5h)  │
│    Hip Replacement (3 tasks, 6h)     │
│    Pain Injection (3 tasks, 1.75h)   │
│  ──────────────────────────────────  │
│  From Existing Orders                │
│    C001 - Hip Replacement            │
│    C003 - Laparoscopic Surgery       │
│    C005 - Pain Injection             │
└──────────────────────────────────────┘
```

Templates are listed first (preferred), existing chains below as fallback.

### 4b. Duration override fields (optional)

When a template is selected, show the task durations with editable fields:

```
Tasks:
  Pre-Op      [30] min    OR + Nurse
  Procedure   [120] min   OR + Surgeon + Anesthesiologist + Nurse
  Recovery    [180] min   Recovery Bay
```

The planner can adjust durations for this specific query (e.g., a more complex knee replacement might need 150 min instead of 120).

### 4c. AI system prompt update

```
When the user asks to schedule a new order:
1. First check if a matching template exists (GET /ctp/templates)
2. If a template matches, use templateKey in the CTP query
3. If no template matches, fall back to cloning an existing chain
4. If neither works, ask the user which existing case to use as a model

Example:
  User: "Schedule a new knee replacement for Johnson"
  → Check templates → found "knee-replacement"
  → Call evaluate_new_order with templateKey: "knee-replacement"
```

---

## Part 5: Verification

### Templates

- [ ] `orderTemplates.json` loaded for each tenant during config init
- [ ] `GET /ctp/templates` returns template list with metadata
- [ ] Healthcare tenant has 3+ templates (knee, hip, pain injection)
- [ ] Manufacturing tenant has 1+ templates (standard machining)
- [ ] HRMD has 1+ templates (baseball game)
- [ ] Tenant without `orderTemplates.json` → empty list, no errors

### Template-based CTP Query

- [ ] `POST /ctp/query` with `templateKey` returns ranked options
- [ ] Resource types resolved to actual tenant resources
- [ ] All resources of matching type included as preferences
- [ ] Equipment filter ("fluoroscopy") narrows to matching equipment only
- [ ] Duration override applied when provided
- [ ] Priority override applied when provided
- [ ] Preferred resource boost works (Dr. Patel becomes rank 1)

### UI

- [ ] Template dropdown shows templates first, existing chains second
- [ ] Selecting a template shows task structure with editable durations
- [ ] Evaluate with template returns same quality results as clone-from-chain
- [ ] Works in standalone mode (CTP Query button) and session mode (Add Order)

### AI

- [ ] "Schedule a knee replacement" → AI finds template, uses templateKey
- [ ] "Schedule something like C001" → AI falls back to sourceChainKey
- [ ] Template not found → AI asks user to clarify or pick from existing

### Regression

- [ ] Clone-from-chain still works (sourceChainKey path unchanged)
- [ ] Existing CTP queries from Sprint 1 unaffected
- [ ] Session add-order works with both templates and clone-from-chain

Commit: "feat(what-if-3): order templates — tenant-configured chain blueprints for CTP queries"
