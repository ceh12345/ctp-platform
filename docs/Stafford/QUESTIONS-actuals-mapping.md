# Questions for Stafford — actuals, task status, and what "in progress" means

Raised 2026-08-30 while investigating why CTP shows operations as *running* on dates
weeks or months in the future. Each question carries the evidence, our current
working assumption, and what breaks if the assumption is wrong.

Field evidence is from the 2026-06-03 WORK7 capture
(`productionTaskWithAdvancedInfoViewEntity`, 2,563 rows) unless noted. Scheduling
evidence is from the `stafford-all` book (1,722 tasks, 16 July capture).

---

## Background — what we're seeing

CTP treats an operation as **running** when it has an actual start and no actual
end. Running work is *pinned*: the scheduler cannot move it, because you can't
reschedule something a person is part-way through.

In the current book, **43 operations are pinned as "running" with start dates in
the future** — 12 in August, 3 in September, and 3 in **December 2026**:

| Task | "Actual start" |
|---|---|
| `24780-D-1` | 2026-12-22 |
| `28492-K-7` | 2026-12-11 |
| `28482-K-11` | 2026-12-09 |
| `29977-M-4` | 2026-09-24 |
| `28387-P-12` | 2026-08-06 |

Nobody can have started work in December. Something is being read as an actual
that isn't one.

The cause looks to be on our side: our mapping populates **both** `actualStart`
and `scheduledStart` from the **same** Genius field, `TaskStartDate`. Across all
1,722 tasks, `actualStart` and `scheduledStart` are identical — 1,721 matches, 0
differences. That is not what real actuals look like.

We can fix the mapping. What we need from you is **which fields actually carry
the truth**.

---

## Q1 — Does Genius record when an operation physically started?

**The question:** Is there a field that records the real start of an operation —
the moment work began on the floor — as opposed to when it was *planned* to start?

**Why we're asking:**

Scanning the 122 fields on the task entity, we can't find one. The date fields we
see are:

| Field | Populated | Notes |
|---|---|---|
| `TaskStartDate` | 496/500 | what we currently use for **both** planned and actual |
| `TaskEndDate` | 496/500 | |
| `CompletionDate` | 2563/2563 | **always `1900-01-01`** — never a real date in this capture |
| `JobClosingDate` | 2563/2563 | also `1900-01-01` sentinel |
| `WorkOrderClosingDate` | 2563/2563 | also `1900-01-01` sentinel |
| `SuccessfullInspectionDate` | 0/500 | always empty |
| `JobProductionStartDate` | 500/500 | job-level, not per operation |

**Working assumption:** Genius does not record a per-operation actual start, and
`TaskStartDate` is purely the plan.

**Impact if we're wrong:** we would keep pinning work to planned dates and the
scheduler stays unable to move 43 operations it should be free to move.

**If there is no actual-start field**, we will stop mapping `actualStart`
altogether. Absent is honest; a planned date pretending to be an actual is not.

---

## Q2 — Is `TaskStartDate` the plan, the actual, or "whichever is known"?

**The question:** For an operation that has already run, does `TaskStartDate` get
rewritten to when it actually started — or does it stay at the planned date?

**Why we're asking:** if Genius overwrites it with reality once work begins, then
the field means different things depending on status, and the mapping has to
branch on that rather than read it blindly.

**Working assumption:** it is always the plan and is never overwritten.

**Impact if we're wrong:** for completed work we would be discarding real actuals;
for future work we would keep treating plans as facts.

---

## Q3 — What is the correct signal that an operation is *currently* in progress?

**The question:** Which field tells you an operation is open on the floor right
now — started, not finished?

**Why we're asking:**

We currently derive it from `TotalCumulativeMachineHours > 0`. That is a
*cumulative* counter, so it stays above zero forever once any hours are booked —
it means "has ever been worked on," not "is being worked on."

In the capture, of the 336 tasks with cumulative hours > 0:

- **163 are actually finished** (`CompletionPercentage >= 99.99`)
- 173 are genuinely partial

So roughly half of what we call "in progress" is completed work.

Candidate fields we can see:

| Field | Values in capture |
|---|---|
| `WoStatusCode` | `PRINTED` 2443, `CREATED` 113, `CLOSED` 7 |
| `IsCompleted` | `False` on all 2,563 rows |
| `CompletionPercentage` | 0 → 2209, 100 → 179, partials (36, 43.75, 50…) → the rest |
| `TotalRemainingMachineHours` | numeric |
| `RemainingOnProgressOperationMachineHours` | numeric |

**Working assumption:** in-progress should be
`TotalCumulativeMachineHours > 0 AND CompletionPercentage < 99.99` — has hours
booked but isn't finished.

**Impact if we're wrong:** completed operations stay pinned as running, blocking
everything behind them in the chain.

---

## Q4 — How does an operation get closed out?

**The question:** When an operator finishes an operation, what changes in Genius?
And is it possible for work to be finished on the floor but left open in the
system?

**Why we're asking:**

- `IsCompleted` is `False` on **every one of the 2,563 rows**, including ones at
  `CompletionPercentage: 100`. It appears never to be set.
- `CompletionDate` is the `1900-01-01` sentinel on every row — no operation in the
  capture has a completion date.
- So the only usable completion signal we can find is `CompletionPercentage`.

**Working assumption:** `CompletionPercentage >= 99.99` is the only reliable
"finished" marker; `IsCompleted` and `CompletionDate` are unused in your workflow.

**Impact if we're wrong:** we are ignoring the field you actually rely on, and our
view of what's finished will drift from yours.

**Related:** if operations are commonly left open after the work is done, that
alone would explain several resources appearing double-booked — we found 9 people
with two or three "in progress" operations at once.

---

## Q5 — Is `1900-01-01` your standard "not set" for dates?

**The question:** Can we treat `1900-01-01T00:00:00` as null everywhere it appears?

**Why we're asking:** it appears in `CompletionDate`, `JobClosingDate`, and
`WorkOrderClosingDate` on 100% of rows. We want to confirm it's a sentinel rather
than a real value before filtering it out globally.

**Working assumption:** it means "no date."

**Impact if we're wrong:** minor — we'd be discarding a date that carries meaning.

---

## Q6 — Should partial progress affect scheduling?

**The question:** When an operation is 36% complete, should CTP schedule the
*remaining* work, or treat the whole operation as fixed where it sits?

**Why we're asking:** the capture has real partials (36%, 43.75%, 50%) and fields
that look built for this — `TotalRemainingMachineHours`,
`RemainingOnProgressOperationMachineHours`. Today CTP pins the whole operation and
ignores how much is left.

**Working assumption:** remaining hours should drive the remaining duration, and
partially-complete work should stay anchored at its start but be allowed to finish
later than originally planned.

**Impact if we're wrong:** the schedule either over- or under-states how much work
is genuinely left in the shop.

---

## What we'll do with the answers

Q1–Q3 change `config/tenants/stafford-*/integration/mapping.json` — specifically
the `actualStart` rule and the `wipState` cascade. **This is not a quiet change:**
43 operations currently pinned would become movable, so the schedule will shift
noticeably. That is the intended outcome, but worth expecting.

Q4–Q6 affect how we report progress and remaining work, not how we place tasks.

---

## Current mapping, for reference

```json
"actualStart":    { "from": "TaskStartDate", "toUTC": true },
"scheduledStart": { "from": "TaskStartDate", "toUTC": true },
"scheduledEnd":   { "from": "TaskEndDate",   "toUTC": true },
"wipState": { "cascade": [
    { "from": "CompletionPercentage",        "threshold": 99.99, "above": "COMPLETED" },
    { "from": "TotalCumulativeMachineHours", "threshold": 0,     "above": "IN_PROCESS" }
  ], "default": "NOT_STARTED" }
```

There is no `actualEnd` mapping, which is why no operation ever closes in CTP.
