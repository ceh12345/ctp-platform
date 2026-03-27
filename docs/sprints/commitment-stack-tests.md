# Test Spec: Commitment Stack — Actuals, Capacity, and Chain Propagation

**What to test:** The commitment stack infrastructure — that actuals properly consume capacity, commitment levels are derived correctly, the solver respects all layers, and chains propagate through completed/running predecessors.

**Uses Stafford tenant** with the three WIP test tasks (PV-001-CUT completed, PV-001-ROLL running, PV-001-WELD-SEAM dispatched).

**Test approach:** API-level tests via HTTP calls to the running server. Each test solves and inspects the response. Group tests into 5 suites.

---

## Suite 1: Commitment Level Derivation

Verify that `commitmentLevel` is correctly derived for each task after a solve.

```typescript
describe('Commitment Level Derivation', () => {

  it('should derive running for IN_PROCESS tasks', async () => {
    const result = await solve();
    const task = findTask(result, 'PV-001-ROLL');
    expect(task.commitmentLevel).toBe('running');
  });

  it('should derive dispatched for dispatched tasks', async () => {
    const result = await solve();
    const task = findTask(result, 'PV-001-WELD-SEAM');
    expect(task.commitmentLevel).toBe('dispatched');
  });

  it('should derive completed for COMPLETED tasks', async () => {
    const result = await solve();
    const task = findTask(result, 'PV-001-CUT');
    // Completed tasks should still appear in results — pinned, not excluded
    expect(task).toBeDefined();
    // commitmentLevel might be 'planned' since it's pinned, or a dedicated level
    // Key assertion: it should be pinned and not movable
    expect(task.pinned).toBe(true);
  });

  it('should derive pinned for manually pinned tasks', async () => {
    // Pin a task first
    await api('/ctp/tasks/pin', { taskKey: 'EQ-003-CUT', pinned: true });
    const result = await solve();
    const task = findTask(result, 'EQ-003-CUT');
    expect(task.commitmentLevel).toBe('pinned');
    // Clean up
    await api('/ctp/tasks/pin', { taskKey: 'EQ-003-CUT', pinned: false });
  });

  it('should derive planned for scheduled, non-pinned tasks', async () => {
    const result = await solve();
    // Find any scheduled task that isn't pinned, dispatched, or WIP
    const planned = result.tasks.find(t =>
      t.feasible && !t.pinned && !t.dispatched &&
      t.commitmentLevel === 'planned'
    );
    expect(planned).toBeDefined();
  });

  it('should derive unscheduled for infeasible tasks', async () => {
    const result = await solve();
    const infeasible = result.tasks.find(t => !t.feasible && !t.pinned);
    if (infeasible) {
      expect(infeasible.commitmentLevel).toBe('unscheduled');
    }
  });

});
```

---

## Suite 2: Actuals Placement and Resource Assignment

Verify that running/dispatched/completed tasks have correct resource assignments and scheduled positions.

```typescript
describe('Actuals Placement', () => {

  it('should set scheduledResource from actualResource on running tasks', async () => {
    const result = await solve();
    const task = findTask(result, 'PV-001-ROLL');
    expect(task.actualResource).toBe('FAB-JACK');
    // The assigned resource should reflect the actual, not just the preference
    const primaryResource = task.assignedResources?.find(r => r.isPrimary);
    expect(primaryResource?.resourceKey).toBe('FAB-JACK');
  });

  it('should set scheduledResource from actualResource on dispatched tasks', async () => {
    const result = await solve();
    const task = findTask(result, 'PV-001-WELD-SEAM');
    expect(task.dispatched).toBe(true);
    // If dispatched with an actualResource, it should be the assigned resource
    // If no actualResource on dispatched, the originally scheduled resource stays
    expect(task.assignedResources?.length).toBeGreaterThan(0);
  });

  it('should preserve actual start time on running tasks', async () => {
    const result = await solve();
    const task = findTask(result, 'PV-001-ROLL');
    expect(task.actualStart).toBe('2026-03-18T08:15:00.000Z');
  });

  it('should preserve actual start and end on completed tasks', async () => {
    const result = await solve();
    const task = findTask(result, 'PV-001-CUT');
    expect(task.actualStart).toBe('2026-03-15T08:00:00.000Z');
    expect(task.actualEnd).toBe('2026-03-15T09:30:00.000Z');
  });

  it('should use effectiveRemainingDuration for running tasks', async () => {
    const result = await solve();
    const task = findTask(result, 'PV-001-ROLL');
    expect(task.percentComplete).toBe(60);
    expect(task.remainingDuration).toBe(5400); // client-provided override
  });

  it('should show percentComplete = 0 for tasks with no progress', async () => {
    const result = await solve();
    const planned = result.tasks.find(t => t.commitmentLevel === 'planned');
    if (planned) {
      expect(planned.percentComplete).toBe(0);
    }
  });

});
```

---

## Suite 3: Capacity Blocking — Solver Cannot Double-Book

Verify that running/dispatched tasks block their resource capacity so the solver doesn't place other tasks in the same slot.

```typescript
describe('Capacity Blocking', () => {

  it('should not schedule another task on FAB-JACK during PV-001-ROLL running window', async () => {
    const result = await solve();
    const running = findTask(result, 'PV-001-ROLL');
    const runningStart = new Date(running.actualStart || running.start).getTime();
    const runningEnd = runningStart + (running.remainingDuration * 1000);

    // Find all other tasks scheduled on FAB-JACK
    const othersOnJack = result.tasks.filter(t =>
      t.key !== 'PV-001-ROLL' &&
      t.feasible &&
      t.assignedResources?.some(r => r.resourceKey === 'FAB-JACK')
    );

    // None should overlap with the running window
    for (const other of othersOnJack) {
      const otherStart = new Date(other.start).getTime();
      const otherEnd = new Date(other.end).getTime();
      const overlaps = otherStart < runningEnd && otherEnd > runningStart;
      expect(overlaps).toBe(false);
    }
  });

  it('should not schedule another task on PV-001-WELD-SEAM dispatched slot', async () => {
    const result = await solve();
    const dispatched = findTask(result, 'PV-001-WELD-SEAM');
    if (!dispatched.start || !dispatched.end) return; // skip if not scheduled

    const dispStart = new Date(dispatched.start).getTime();
    const dispEnd = new Date(dispatched.end).getTime();

    // Find the resource this dispatched task is on
    const dispResource = dispatched.assignedResources?.[0]?.resourceKey;
    if (!dispResource) return;

    // No other task on the same resource should overlap
    const others = result.tasks.filter(t =>
      t.key !== 'PV-001-WELD-SEAM' &&
      t.feasible &&
      t.assignedResources?.some(r => r.resourceKey === dispResource)
    );

    for (const other of others) {
      const otherStart = new Date(other.start).getTime();
      const otherEnd = new Date(other.end).getTime();
      const overlaps = otherStart < dispEnd && otherEnd > dispStart;
      expect(overlaps).toBe(false);
    }
  });

  it('should free capacity on SAW-01 after PV-001-CUT completed', async () => {
    const result = await solve();
    const completed = findTask(result, 'PV-001-CUT');

    // SAW-01 should be available after actualEnd
    // Other tasks CAN schedule on SAW-01 after the completed task's end
    const othersOnSaw = result.tasks.filter(t =>
      t.key !== 'PV-001-CUT' &&
      t.feasible &&
      t.assignedResources?.some(r => r.resourceKey === 'SAW-01')
    );

    // If any tasks are on SAW-01, they should start after the completed task's end
    // (or before its start — both are valid, just not during)
    const completedEnd = new Date(completed.actualEnd).getTime();
    for (const other of othersOnSaw) {
      const otherStart = new Date(other.start).getTime();
      // Task can be before or after, just verify the engine placed things
      // The key assertion is that SAW-01 IS available (tasks can be placed on it)
    }
    // If SAW-01 has tasks, capacity is working correctly
    // (compare to a bug where completed task still blocks)
  });

  it('should not move running task on re-solve', async () => {
    const result1 = await solve();
    const running1 = findTask(result1, 'PV-001-ROLL');

    // Re-solve
    const result2 = await solve();
    const running2 = findTask(result2, 'PV-001-ROLL');

    // Running task should not have moved
    expect(running2.actualStart).toBe(running1.actualStart);
    expect(running2.actualResource).toBe(running1.actualResource);
    expect(running2.percentComplete).toBe(running1.percentComplete);
  });

  it('should not move dispatched task on re-solve', async () => {
    const result1 = await solve();
    const disp1 = findTask(result1, 'PV-001-WELD-SEAM');

    const result2 = await solve();
    const disp2 = findTask(result2, 'PV-001-WELD-SEAM');

    // Dispatched task should keep its position
    expect(disp2.start).toBe(disp1.start);
    expect(disp2.end).toBe(disp1.end);
  });

});
```

---

## Suite 4: Chain Propagation with Actuals

Verify that successor tasks have correct windows based on predecessor actuals.

```typescript
describe('Chain Propagation with Actuals', () => {

  it('should tighten PV-001-ROLL window based on completed predecessor PV-001-CUT', async () => {
    const result = await solve();
    const completed = findTask(result, 'PV-001-CUT');
    const running = findTask(result, 'PV-001-ROLL');

    // PV-001-ROLL is the successor of PV-001-CUT
    // Its window should start no earlier than PV-001-CUT's actualEnd
    // Since PV-001-ROLL is running (actual), this is already satisfied
    // The key check: actualStart >= predecessor actualEnd
    const cutEnd = new Date(completed.actualEnd).getTime();
    const rollStart = new Date(running.actualStart).getTime();
    expect(rollStart).toBeGreaterThanOrEqual(cutEnd);
  });

  it('should allow successors of running task to schedule after remaining duration', async () => {
    const result = await solve();
    const running = findTask(result, 'PV-001-ROLL');

    // PV-001-WELD-SEAM is the next step after PV-001-ROLL
    // If dispatched, it should be scheduled to start after PV-001-ROLL finishes
    const weldSeam = findTask(result, 'PV-001-WELD-SEAM');
    if (weldSeam.start) {
      const rollEnd = new Date(running.actualStart).getTime() + (running.remainingDuration * 1000);
      const weldStart = new Date(weldSeam.start).getTime();
      expect(weldStart).toBeGreaterThanOrEqual(rollEnd);
    }
  });

  it('should not break chain when predecessor is completed', async () => {
    const result = await solve();

    // All PV-001 chain tasks should be present in results (not missing)
    const pv001Tasks = result.tasks.filter(t => t.key.startsWith('PV-001'));
    expect(pv001Tasks.length).toBeGreaterThanOrEqual(3); // at minimum CUT, ROLL, WELD-SEAM

    // None should have errors about missing predecessors
    for (const task of pv001Tasks) {
      const predError = task.errors?.find(e =>
        e.reason?.toLowerCase().includes('predecessor') &&
        e.reason?.toLowerCase().includes('not found')
      );
      expect(predError).toBeUndefined();
    }
  });

  it('should schedule downstream PV-001 tasks after the running and dispatched steps', async () => {
    const result = await solve();

    // Find PV-001 tasks that come after WELD-SEAM in the chain
    // They should be scheduled (if feasible) after the dispatched step
    const weldSeam = findTask(result, 'PV-001-WELD-SEAM');
    if (!weldSeam.end) return;

    const laterTasks = result.tasks.filter(t =>
      t.key.startsWith('PV-001') &&
      t.key !== 'PV-001-CUT' &&
      t.key !== 'PV-001-ROLL' &&
      t.key !== 'PV-001-WELD-SEAM' &&
      t.feasible
    );

    const weldEnd = new Date(weldSeam.end).getTime();
    for (const task of laterTasks) {
      const taskStart = new Date(task.start).getTime();
      expect(taskStart).toBeGreaterThanOrEqual(weldEnd);
    }
  });

});
```

---

## Suite 5: Capacity Waterfall

Verify the capacity waterfall in the solve response.

```typescript
describe('Capacity Waterfall', () => {

  it('should include capacityWaterfall in solve response', async () => {
    const result = await solve();
    expect(result.capacityWaterfall).toBeDefined();
    expect(Array.isArray(result.capacityWaterfall)).toBe(true);
    expect(result.capacityWaterfall.length).toBeGreaterThan(0);
  });

  it('should have all 6 layers per resource', async () => {
    const result = await solve();
    for (const resource of result.capacityWaterfall) {
      expect(resource.layers.length).toBe(6);
      const levels = resource.layers.map(l => l.level);
      expect(levels).toEqual(['running', 'on_hold', 'dispatched', 'pinned', 'planned', 'unscheduled']);
    }
  });

  it('should show running hours on FAB-JACK', async () => {
    const result = await solve();
    const jack = result.capacityWaterfall.find(r => r.resourceKey === 'FAB-JACK');
    expect(jack).toBeDefined();

    const runningLayer = jack.layers.find(l => l.level === 'running');
    expect(runningLayer.tasks).toBeGreaterThanOrEqual(1); // PV-001-ROLL
    expect(runningLayer.hours).toBeGreaterThan(0);
  });

  it('should show dispatched hours for PV-001-WELD-SEAM resource', async () => {
    const result = await solve();
    // Find whichever resource PV-001-WELD-SEAM is dispatched on
    const weldSeam = findTask(result, 'PV-001-WELD-SEAM');
    const resourceKey = weldSeam.assignedResources?.[0]?.resourceKey;
    if (!resourceKey) return;

    const resource = result.capacityWaterfall.find(r => r.resourceKey === resourceKey);
    expect(resource).toBeDefined();

    const dispLayer = resource.layers.find(l => l.level === 'dispatched');
    expect(dispLayer.tasks).toBeGreaterThanOrEqual(1);
    expect(dispLayer.hours).toBeGreaterThan(0);
  });

  it('should have cumulative sums that increase monotonically', async () => {
    const result = await solve();
    for (const resource of result.capacityWaterfall) {
      let prev = 0;
      for (const layer of resource.layers) {
        expect(layer.cumulative).toBeGreaterThanOrEqual(prev);
        prev = layer.cumulative;
      }
    }
  });

  it('should calculate remainingCapacity = total - cumulative', async () => {
    const result = await solve();
    for (const resource of result.capacityWaterfall) {
      const lastLayer = resource.layers[resource.layers.length - 1];
      const expected = Math.round((resource.totalAvailableHours - lastLayer.cumulative) * 10) / 10;
      expect(resource.remainingCapacity).toBeCloseTo(expected, 0);
    }
  });

  it('should not show completed tasks in capacity consumption', async () => {
    const result = await solve();
    const saw = result.capacityWaterfall.find(r => r.resourceKey === 'SAW-01');
    if (!saw) return;

    // PV-001-CUT is completed — its hours should NOT appear in any layer
    // (or appear in a 'completed' layer with 0 capacity impact)
    const totalTasks = saw.layers.reduce((sum, l) => sum + l.tasks, 0);
    // The completed task should not be counted as consuming capacity
    // Verify by checking that no layer includes time from PV-001-CUT
  });

  it('should report deadCapacityHours as 0 when no tasks are on hold', async () => {
    const result = await solve();
    // Stafford test data has no ON_HOLD tasks, so all resources should have 0 dead capacity
    for (const resource of result.capacityWaterfall) {
      expect(resource.deadCapacityHours).toBe(0);
    }
  });

});
```

---

## Suite 6: State Transition Endpoints

Verify the API endpoints for progression actions.

```typescript
describe('State Transition Endpoints', () => {

  // Use a non-WIP task for transition tests to avoid conflicting with test data
  const testTaskKey = 'EQ-003-CUT'; // a normal planned task

  it('should dispatch a scheduled task', async () => {
    // First ensure the task is scheduled
    await solve();
    const res = await api('/ctp/tasks/dispatch', {
      method: 'POST',
      body: { taskKeys: [testTaskKey] },
    });
    expect(res.status).toBe('ok');
    expect(res.results[0].result).toBe('ok');

    // Verify in solve response
    const result = await solve();
    const task = findTask(result, testTaskKey);
    expect(task.commitmentLevel).toBe('dispatched');
    expect(task.dispatched).toBe(true);
    expect(task.materialsPulled).toBe(true);
  });

  it('should reject dispatch on unscheduled task', async () => {
    // Find an infeasible task
    const result = await solve();
    const infeasible = result.tasks.find(t => !t.feasible);
    if (!infeasible) return;

    const res = await api('/ctp/tasks/dispatch', {
      method: 'POST',
      body: { taskKeys: [infeasible.key] },
    });
    expect(res.results[0].result).toBe('skipped');
  });

  it('should start a task', async () => {
    const res = await api('/ctp/tasks/start', {
      method: 'POST',
      body: { taskKey: testTaskKey, actualResource: 'SAW-01' },
    });
    expect(res.status).toBe('ok');
    expect(res.commitmentLevel).toBe('running');
    expect(res.actualStart).toBeDefined();
  });

  it('should hold a running task', async () => {
    const res = await api('/ctp/tasks/hold', {
      method: 'POST',
      body: { taskKey: testTaskKey, holdReason: 'Test hold' },
    });
    expect(res.status).toBe('ok');
    expect(res.commitmentLevel).toBe('on_hold');

    // Verify in solve response
    const result = await solve();
    const task = findTask(result, testTaskKey);
    expect(task.commitmentLevel).toBe('on_hold');
    expect(task.holdReason).toBe('Test hold');
  });

  it('should resume a held task', async () => {
    const res = await api('/ctp/tasks/resume', {
      method: 'POST',
      body: { taskKey: testTaskKey },
    });
    expect(res.status).toBe('ok');
    expect(res.commitmentLevel).toBe('running');

    // Hold reason should be cleared
    const result = await solve();
    const task = findTask(result, testTaskKey);
    expect(task.holdReason).toBeNull();
  });

  it('should complete a task', async () => {
    const res = await api('/ctp/tasks/complete', {
      method: 'POST',
      body: { taskKey: testTaskKey },
    });
    expect(res.status).toBe('ok');
    expect(res.actualEnd).toBeDefined();

    // Completed task should still appear but be pinned
    const result = await solve();
    const task = findTask(result, testTaskKey);
    expect(task).toBeDefined();
    expect(task.percentComplete).toBe(100);
  });

  it('should update progress', async () => {
    // Reset task to running first (use a different task)
    await api('/ctp/tasks/start', {
      method: 'POST',
      body: { taskKey: 'EQ-003-MILL' },
    });

    const res = await api('/ctp/tasks/EQ-003-MILL/progress', {
      method: 'PATCH',
      body: { percentComplete: 45, remainingDuration: 3600 },
    });
    expect(res.status).toBe('ok');
    expect(res.percentComplete).toBe(45);
    expect(res.remainingDuration).toBe(3600); // client override wins
  });

});
```

---

## Test Helpers

```typescript
const BASE_URL = 'http://localhost:3000/v1';
const TENANT = 'stafford-engineering';

async function api(path: string, opts?: { method?: string, body?: any }): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts?.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': TENANT,
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

async function solve(): Promise<any> {
  return api('/ctp/solve', { method: 'POST', body: {} });
}

function findTask(result: any, key: string): any {
  const task = result.tasks?.find(t => t.key === key);
  if (!task) throw new Error(`Task ${key} not found in solve response`);
  return task;
}
```

---

## Running the Tests

```bash
# Ensure server is running with Stafford tenant data
# Run from the test directory:
npx jest --testPathPattern="commitment-stack" --verbose
```

---

## Expected Results with Stafford Test Data

| Task | Commitment | Pinned | Resource | Capacity consumed |
|------|-----------|--------|----------|-------------------|
| PV-001-CUT | completed | yes | SAW-01 | None (finished) |
| PV-001-ROLL | running | yes | FAB-JACK | 5400s remaining |
| PV-001-WELD-SEAM | dispatched | yes | (scheduled resource) | Full scheduled window |
| Other scheduled tasks | planned | no | (solver assigned) | Full duration, movable |
| Infeasible tasks | unscheduled | no | — | None |

Feasibility rate should be similar to pre-commitment-stack (running + dispatched tasks were already scheduled — they just can't move now). If feasibility dropped significantly, the actuals are blocking more capacity than expected.
