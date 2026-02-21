# Prompt 4: Stress Tests — Quick vs Balanced

## Goal

Build complex, realistic scheduling scenarios and run both Quick and Balanced strategies against them. Measure and compare: feasibility rate, total score, makespan, bump statistics. These tests prove that backtracking **actually helps** on hard problems.

## Important

This prompt should run AFTER Prompts 1-3 are complete and their unit tests pass. The stress tests depend on all three preceding components.

## Test File

Create: `tests/engine/stress-scenarios.test.ts`

## Scenario Builders

### Scenario 1: Resource Contention (10 tasks, 2 machines)

```
Resources: CNC-01 and CNC-02, each available 8am-5pm (9h) for 5 days = 45h each, 90h total
Tasks: 10 tasks, each 8-12 hours, all can use either CNC-01 or CNC-02
Total demand: ~100 hours (>90 available = guaranteed contention)
Task priorities: 1-10 (1 = highest)
All tasks have same window: full 5-day horizon

Expected: Quick schedules ~8-9 tasks (greedy fills both machines, last 1-2 don't fit)
Expected: Balanced schedules 9-10 tasks (bumping rearranges to pack tighter)
```

### Scenario 2: Chain Under Pressure

```
Resources: MACHINE-A, MACHINE-B, QC-STATION (each 8h/day, 3 days)
Chain: Order-1 has 4 tasks in sequence:
  OP-10 (4h on MACHINE-A) → OP-20 (4h on MACHINE-B) → OP-30 (2h on QC-STATION) → OP-40 (3h on MACHINE-A)
Blockers: 3 independent tasks, each 6h, already using these resources (lower priority)
Priority: chain tasks = 1, blocker tasks = 5

Expected: Quick may fail OP-40 (MACHINE-A full from OP-10 + blocker)
Expected: Balanced bumps the blocker off MACHINE-A to fit OP-40
```

### Scenario 3: Tight Capacity (95% utilization)

```
Resources: 5 resources, each 8h/day for 5 days = 200h total
Tasks: 25 tasks, each 7-9 hours, with resource preferences (each task can use 2 of the 5)
Total demand: ~190h (95% of 200h)
Priorities: random 1-5
Windows: each task has a 3-day window (not the full 5 days)

Expected: Quick gets ~20-22 feasible
Expected: Balanced gets ~23-25 feasible (bumping critical for tight capacity)
```

### Scenario 4: Mixed Priorities (Rush Order)

```
Resources: 3 machines, 8h/day for 3 days = 72h total
Phase 1: solve 8 normal-priority tasks (total ~60h demand, fills most capacity)
Phase 2: add 2 urgent tasks (priority 1, each 8h, can only use machine-1)
Re-solve with all 10 tasks

Expected: Quick may fail the urgent tasks (machine-1 full from phase 1)
Expected: Balanced bumps lower-priority work off machine-1 to accommodate urgents
```

### Scenario 5: Changeover Sensitivity

```
Resources: 1 resource (PAINT-LINE), 8h/day for 5 days = 40h
Tasks: 8 tasks, each 4h, requiring different setups
State changes: changing between product types requires 1h changeover
If poorly ordered: 7 changeovers × 1h = 7h wasted = only 33h productive
If well ordered: group by product type, 3 changeovers = 3h wasted = 37h productive

Expected: Quick may produce a bad ordering with many changeovers
Expected: Balanced can bump tasks to reduce total changeover time
(Note: this tests whether bump improves changeover, not just capacity)
```

## Test Structure

For each scenario, run this comparison:

```typescript
describe('Scenario N: [name]', () => {
  let landscape: SchedulingLandscape;
  let scoring: CTPScoring;

  beforeEach(() => {
    // Build the scenario fresh
    ({ landscape, scoring } = buildScenarioN());
  });

  it('Quick strategy — baseline', () => {
    const stats = solveQuick(landscape, scoring);
    console.log(`Quick: ${stats.tasksFeasible}/${stats.tasksProcessed} feasible`);
    console.log(`Quick: score = ${computeOverallScore(landscape)}`);
    // Record baseline numbers
    expect(stats.tasksFeasible).toBeGreaterThanOrEqual(QUICK_MIN_FEASIBLE);
  });

  it('Balanced strategy — should improve on Quick', () => {
    const stats = solveBalanced(landscape, scoring);
    console.log(`Balanced: ${stats.tasksFeasible}/${stats.tasksProcessed} feasible`);
    console.log(`Balanced: score = ${computeOverallScore(landscape)}`);
    console.log(`Balanced: bumps = ${stats.bumpsPerformed}, successes = ${stats.backtrackSuccesses}`);
    expect(stats.tasksFeasible).toBeGreaterThanOrEqual(BALANCED_MIN_FEASIBLE);
  });

  it('Balanced >= Quick feasibility', () => {
    // Run both on identical scenarios
    const landscapeQ = cloneLandscape(landscape);
    const landscapeB = cloneLandscape(landscape);

    const quickStats = solveQuick(landscapeQ, scoring);
    const balancedStats = solveBalanced(landscapeB, scoring);

    expect(balancedStats.tasksFeasible).toBeGreaterThanOrEqual(quickStats.tasksFeasible);
  });

  it('Balanced completes within time budget', () => {
    const start = Date.now();
    solveBalanced(landscape, scoring);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000); // 5 seconds max for balanced
  });
});
```

## Key Assertions Across All Scenarios

- **Balanced feasibility >= Quick feasibility** — bumping should never reduce feasibility
- **Balanced time < 5 seconds** — must stay within the strategy's time budget
- **Bumps performed > 0 on contention scenarios** — proves the mechanism actually fires
- **No crashes on any scenario** — even if infeasible, the solver should complete cleanly
- **All invariants hold** — assigned tasks have valid scheduled intervals, resource assignment totals are consistent, no phantom assignments

## Output Format

Each stress test should log a comparison table:

```
┌─────────────────────┬─────────┬──────────┐
│ Metric              │ Quick   │ Balanced │
├─────────────────────┼─────────┼──────────┤
│ Feasible            │ 8/10    │ 10/10   │
│ Overall Score       │ 2000045 │ 45.2    │
│ Makespan (hours)    │ 38.5    │ 41.0    │
│ Bumps               │ 0       │ 3       │
│ Bump Successes      │ 0       │ 2       │
│ Solve Time (ms)     │ 120     │ 450     │
└─────────────────────┴─────────┴──────────┘
```

This gives you concrete evidence that the balanced strategy is worth the extra solve time.
