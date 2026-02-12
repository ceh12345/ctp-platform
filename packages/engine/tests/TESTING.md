# CTP Test Suite

Automated test suite using [Vitest](https://vitest.dev/) — 246 tests across 16 files.

## Running Tests

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode (re-runs on file changes)
npm run test:coverage # Run with coverage report
```

### Run specific tests

```bash
npx vitest run tests/models/linklist.test.ts       # Single file
npx vitest run tests/models/                        # Entire directory
npx vitest run -t "mergeIntervals"                  # By test name pattern
npx vitest run -t "CTPSubtractSetEngine"            # By describe block name
```

## Test Structure

```
tests/
├── helpers/
│   └── builders.ts                  — Shared test factories (makeTask, makeResource, etc.)
├── models/                          — Tier 1: Core data structures (89 tests)
│   ├── linklist.test.ts             — LinkedList<T> pointer operations (28 tests)
│   ├── list.test.ts                 — List<T> add/remove/contains (15 tests)
│   ├── hashmap.test.ts              — HashMap & EntityHashMap (13 tests)
│   ├── interval.test.ts            — CTPInterval & CTPDuration (18 tests)
│   └── namevalue.test.ts            — NameValue matching & list parsing (15 tests)
├── intervals/                       — Tier 2: Interval operations (35 tests)
│   ├── intervals.test.ts            — CTPIntervals linked list operations (23 tests)
│   └── availablematrix.test.ts      — AvailableMatrix slot management (12 tests)
├── engines/                         — Tier 2-3: Engines (55 tests)
│   ├── setengine.test.ts            — Union/Intersect/Subtract/Add/Compliment (33 tests)
│   ├── baseengine.test.ts           — mergeIntervals, collapseIntervals (13 tests)
│   └── combinationengine.test.ts    — Resource combination generation (9 tests)
├── models/
│   └── range.test.ts                — CTPRange duration computation (24 tests)
├── agents/                          — Tier 4: AI Agents (32 tests)
│   ├── nextneighborhood.test.ts     — Task selection & sorting (10 tests)
│   ├── bestscorefortask.test.ts     — Score selection across contexts (6 tests)
│   ├── pickbestschedule.test.ts     — Best schedule context selection (6 tests)
│   └── dependencylookahead.test.ts  — Predecessor/successor search (10 tests)
└── scheduling/                      — Tier 4: End-to-end (11 tests)
    └── scheduler.test.ts            — Full schedule/unschedule/round-trip (11 tests)
```

## Test Helpers (`tests/helpers/builders.ts`)

Shared factory functions for building test data:

| Function | Description |
|----------|-------------|
| `makeInterval(s, e, q?)` | Single CTPInterval |
| `makeIntervals([{s, e, q}])` | CTPIntervals linked list from array |
| `makeAvailable([{s, e, q}])` | CTPAvailable linked list |
| `makeAssignments([{s, e, q}])` | CTPAssignments linked list |
| `makeDuration(dur, qty?, type?)` | CTPDuration |
| `makeHorizon(days?)` | CTPHorizon (fixed date: 2025-05-12, default 14 days) |
| `makeResource(name, key, avail?)` | CTPResource with optional availability |
| `makeTask(name, key, dur, qty?, wStart?, wEnd?)` | CTPTask with duration and window |
| `makeScoring([{name, weight, objective?}])` | CTPScoring with rules |
| `buildTestLandscape({resources, tasks})` | Full landscape for integration tests |
| `intervalsToArray(intervals)` | Convert linked list to `{s, e, q}[]` for assertions |

## Writing New Tests

### Basic pattern

```typescript
import { describe, it, expect } from 'vitest';
import { makeIntervals, intervalsToArray } from '../helpers/builders';

describe('MyFeature', () => {
  it('does something', () => {
    const intervals = makeIntervals([
      { s: 0, e: 10, q: 5 },
      { s: 10, e: 20, q: 3 },
    ]);
    const arr = intervalsToArray(intervals);
    expect(arr.length).toBe(2);
    expect(arr[0].q).toBe(5);
  });
});
```

### End-to-end scheduler test pattern

See `tests/scheduling/scheduler.test.ts` for the full pattern. Key steps:
1. Create horizon, resources (with availability), and tasks (with resource preferences)
2. Initialize `CTPScheduler` with landscape, scoring, and settings
3. Call `scheduler.schedule(taskList)`
4. Assert task states, scheduled intervals, and errors

## Known Behaviors Documented in Tests

These are actual engine behaviors captured by the tests (some are bugs, kept as regression tests):

- **CTPSubtractSetEngine** performs algebraic subtraction, not set-theoretic. B-only regions appear with negated qty; overlap regions have qty = A.qty - B.qty.
- **CTPUnionSetEngine.union()** does not extend intervals past existing boundaries. Adjacent intervals at exact boundaries are not merged.
- **CTPIntervals.atStartTime()** always returns head when startW >= head.data.startW (traversal direction issue).
- **CTPRange.computeDurationBackward** fails when lst would be 0 due to falsy check (`if (this.values.lst)`).
- **CTPBaseEngine.mergeIntervals** only advances aPtr (not bPtr), so adjacent intervals at boundaries can get qty from the wrong B node.
- **CTPAvailableEngine** has a circular dependency with `engines.ts` and cannot be tested in isolation.
- **Scheduler** allows tasks to overlap on the same resource within a single scheduling batch.
