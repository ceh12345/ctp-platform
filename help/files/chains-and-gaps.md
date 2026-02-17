# Chains and Gaps

## What is a chain?

A chain is an ordered sequence of tasks that must execute in order. Each task in the chain depends on the previous task completing before it can start.

**Healthcare example:**
```
Pre-Op Setup (30 min) → Knee Replacement (2.5 hr) → Recovery (3 hr)
```

**Manufacturing example:**
```
CNC Machining (4 hr) → Assembly (2 hr) → Quality Check (1 hr) → Packing (30 min)
```

The engine knows about chains through **link IDs**. Every task in the same chain shares a link name, and each task (except the first) points to its predecessor.

## Back-to-back scheduling

The ideal schedule has zero gap between chain phases — when one phase ends, the next begins immediately. This is called **back-to-back** scheduling.

```
✓ Back-to-back:
[Pre-Op 07:00-07:30][Procedure 07:30-10:00][Recovery 10:00-13:00]

✕ Gaps:
[Pre-Op 07:00-07:30]  ...45 min...  [Procedure 08:15-10:45]  ...gap...  [Recovery 12:00-15:00]
```

## What causes gaps?

Gaps happen when the next phase can't start immediately because one or more of its required resources isn't available.

**Common causes:**

- **Shared resource busy** — The anesthesiologist is finishing another case. The CNC machine is running another job.
- **Calendar gaps** — The next resource's shift doesn't start until later. Lunch breaks. Maintenance windows.
- **All alternatives occupied** — Every recovery bay is full. Every assembly station is running.
- **Predecessor scheduled at a bad time** — The first phase was placed at a time where the successor's resources don't align.

## Max gap constraint

You can set a maximum allowed gap between chain phases. This tells the engine: "these phases must happen within X minutes of each other."

| maxGap | Meaning |
|--------|---------|
| 0 | Tight — back-to-back only, no gap allowed |
| 900 (15 min) | Small buffer — allows for patient transport, material movement |
| 3600 (1 hr) | Loose — allows transport between facilities |
| -1 (unconstrained) | No gap limit — phases can be hours or days apart |

When maxGap is set, the engine tightens the successor's scheduling window so it must start within the allowed gap after the predecessor ends. If no feasible slot exists within that window, the task is marked infeasible.

## How to investigate a gap

1. **Go to Analytics → Chain Integrity** — Find the case with the gap
2. **Look at the gap indicator** — It tells you which two phases have the gap and how long it is
3. **Check the successor's resources** — What resources does the next phase need? Which one isn't available during the gap?
4. **Check utilization** — Is that resource at high utilization? Is it the bottleneck?
5. **Look for alternatives** — Can the next phase use a different resource? Click the case to go to the Task List for details.

## Chain status

| Status | Meaning |
|--------|---------|
| ✓ Fully scheduled, back-to-back | All phases placed with zero gaps — ideal |
| ⚠ Fully scheduled, with gaps | All phases placed but delays exist between them |
| ⚠ Partially scheduled | Some phases placed, others infeasible or unscheduled |
| ✕ Not scheduled | No phases placed yet (solve hasn't run, or fully infeasible) |
