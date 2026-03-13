# Quick Fix: CTP Query Need-By Date and Promise Status

**What it does:** Adds a `needByDate` field to the CTP query. Results show whether each option meets the deadline — early, on time, or late — with days of slack.

**Size:** ~20 min  
**Depends on:** What-If Sprint 1 (done)

---

## Part 1: Backend

### 1a. Add `needByDate` to CTPQueryDto

```typescript
export class CTPQueryDto {
  sourceChainKey: string;
  orderName: string;
  needByDate?: string;      // NEW — ISO date, e.g., "2026-03-20"
  priority?: number;
  preferredResources?: Record<string, string[]>;
  maxOptions?: number;
}
```

### 1b. Compute promise status per option

In the CTP query response, add promise status for each option:

```typescript
// After computing options, if needByDate is provided:
if (request.needByDate) {
  const needBy = new Date(request.needByDate).getTime();

  for (const option of options) {
    const lastTask = option.tasks[option.tasks.length - 1];
    const completionDate = new Date(lastTask.end).getTime();
    const slackMs = needBy - completionDate;
    const slackDays = Math.round(slackMs / (24 * 60 * 60 * 1000));

    option.promiseStatus = {
      needByDate: request.needByDate,
      completionDate: lastTask.end,
      slackDays,
      status: slackDays > 1 ? 'early' : slackDays >= 0 ? 'on-time' : 'late',
    };
  }
}
```

### 1c. Response shape addition

```typescript
export interface CTPQueryOption {
  rank: number;
  feasible: boolean;
  chainScore: number;
  tasks: CTPQueryTaskPlacement[];
  promiseStatus?: {             // NEW — present when needByDate provided
    needByDate: string;
    completionDate: string;
    slackDays: number;
    status: 'early' | 'on-time' | 'late';
  };
}
```

---

## Part 2: Frontend

### 2a. Add Need By Date field to CTP Query dialog

Add a date input after the Order Name field:

```tsx
<label>Need By Date</label>
<input
  type="date"
  value={needByDate}
  onChange={e => setNeedByDate(e.target.value)}
  style={inputStyle}
/>
```

### 2b. Show promise status in results

For each option, show the status badge:

```tsx
{option.promiseStatus && (
  <span style={{
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 4,
    color: option.promiseStatus.status === 'early' ? C.green
         : option.promiseStatus.status === 'on-time' ? C.yellow
         : C.red,
    background: option.promiseStatus.status === 'early' ? C.greenDim
              : option.promiseStatus.status === 'on-time' ? C.yellowDim
              : C.redDim,
  }}>
    {option.promiseStatus.status === 'early'
      ? `✅ ${option.promiseStatus.slackDays} days early`
      : option.promiseStatus.status === 'on-time'
      ? `⚠ On time (${option.promiseStatus.slackDays} days slack)`
      : `❌ ${Math.abs(option.promiseStatus.slackDays)} days late`}
  </span>
)}
```

### 2c. Sort options with status awareness

When needByDate is provided, options that meet the deadline sort before late options. Within on-time options, sort by earliest completion (most slack).

---

## Part 3: AI Tool Update

### 3a. Add needByDate to evaluate_new_order tool parameters

```typescript
{
  name: "evaluate_new_order",
  parameters: {
    properties: {
      sourceChainKey: { type: "string" },
      orderName: { type: "string" },
      needByDate: {
        type: "string",
        description: "Customer's need-by date (ISO format). If the user says 'by Friday' or 'need it March 20', convert to a date."
      },
      // ... existing params
    }
  }
}
```

### 3b. AI system prompt addition

```
When the user mentions a deadline ("by Friday", "need it by March 20", "end of week"),
extract the date and pass it as needByDate. The response will include promise status
showing whether each option is early, on time, or late relative to the deadline.

Present the status prominently:
  "Option 1 — Thursday on CNC-03. Ships Friday. ✅ 6 days early."
  "Option 2 — Next Monday on CNC-02. Ships Tuesday. ❌ 2 days late."
```

### 3c. AI response format with promise status

```
AI: "I found 3 options for Acme Corp Housings (need by March 20):

  Option 1 ⭐ Thursday Mar 14, CNC-03
    Setup 10:00 → Mill 10:45 → QC 12:45. Ships Friday Mar 14.
    ✅ 6 days early

  Option 2 — Friday Mar 14, CNC-04
    Setup 7:00 → Mill 7:45 → QC 9:45. Ships Friday Mar 14.
    ✅ 6 days early

  Option 3 — Monday Mar 17, CNC-02
    Setup 7:00 → Mill 7:45 → QC 9:45. Ships Tuesday Mar 18.
    ✅ 2 days early

  All 3 options meet the March 20 deadline."

  [Schedule Option 1] [Schedule Option 2] [Schedule Option 3]
```

---

## Part 4: Rename "Book" to "Schedule"

While we're here, rename all "Book This" / "Book Option N" buttons to **"Schedule This"** / **"Schedule Option N"** across:

- CTP query results panel buttons
- AI action buttons in chat responses
- Confirmation dialog ("Schedule Acme Corp Housings — Thursday 10:00 AM, CNC-03?")

---

## Part 5: Verification

- [ ] CTP query with needByDate returns promiseStatus on each option
- [ ] CTP query without needByDate — no promiseStatus field (backward compatible)
- [ ] Early options show green badge with days early
- [ ] On-time options show yellow badge with slack days
- [ ] Late options show red badge with days late
- [ ] Options sorted: on-time first, then late
- [ ] AI extracts "by Friday" → converts to needByDate
- [ ] AI presents promise status in response
- [ ] All "Book" buttons renamed to "Schedule"
- [ ] Confirmation dialog says "Schedule" not "Book"

Commit: "feat: CTP query need-by date with promise status + rename Book to Schedule"
