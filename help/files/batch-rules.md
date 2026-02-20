# Batch Rules

## What is batching?

Batching groups compatible tasks so they run together on a shared resource. Instead of scheduling each task individually, the engine combines them into a single batch that occupies one time slot.

**Manufacturing example:**
```
Heat Treatment — 10 parts need the same oven at 500°F for 2 hours.
Instead of 10 separate 2-hour runs, batch them into 1 run.
```

**Healthcare example:**
```
Sterilization — 8 instrument trays need the same autoclave cycle.
One 45-minute cycle handles all 8 trays.
```

## How batch rules work

A **batch rule** defines:

| Field | What it means |
|-------|--------------|
| Batch Key | Grouping key — tasks with the same batch key are candidates for the same batch |
| Resource Type | Which resource type runs the batch (e.g., "Oven", "PaintBooth", "Autoclave") |
| Min Batch Size | Don't start until at least this many units are ready |
| Max Batch Size | Resource can't hold more than this many units |
| Fixed Duration | How long the batch runs, regardless of how many items are in it (e.g., oven cycle is always 2 hours) |
| Min Duration | Minimum run time even for small batches |
| Batch Window | Maximum time to wait for the batch to fill before running with what's available |

## Task-to-batch relationship

Each task can reference a batch rule and declare how many units it contributes:

- **batchRuleKey** — Which batch rule this task belongs to (e.g., "HEAT-TREAT-500F")
- **batchQty** — How many units this task adds to the batch (e.g., 2 parts)

Tasks with the same `batchRuleKey` are candidates for grouping. The engine accumulates `batchQty` across tasks until the batch meets the minimum size.

## Example: Heat treatment

```
Batch Rule: HEAT-TREAT-500F
  Resource: Oven
  Min size: 5 units
  Max size: 20 units
  Duration: 2 hours (fixed)
  Window: 24 hours

Tasks:
  Order-001-HEAT: batchQty = 2
  Order-002-HEAT: batchQty = 3
  Order-003-HEAT: batchQty = 4
  ─────────────────────────────
  Total: 9 units (≥ 5 min, ≤ 20 max) → batch is valid
```

All three tasks get the same scheduled start and end time. The oven runs once for 2 hours.

## When batching applies

Batching is useful when:

- A resource processes multiple items simultaneously (ovens, paint booths, autoclaves, kilns)
- The processing time is the same regardless of load size (fixed duration)
- You want to avoid running a resource for just one item when you could wait and fill it
- Items must meet compatibility criteria (same temperature, same paint color, same sterilization cycle)

## Batch window trade-off

The **batch window** controls the trade-off between efficiency and lead time:

| Batch Window | Effect |
|-------------|--------|
| Short (4 hours) | Batches run quickly but may be underfilled — higher resource cost per unit |
| Long (48 hours) | Batches fill up efficiently but parts wait longer — longer lead times |
| 0 (no limit) | Wait as long as needed to fill the batch — most efficient but slowest |

## Current status

The batch rule data model is in place. Tasks can reference batch rules and declare their batch quantities. The solver batching logic (grouping, scheduling as a unit) is planned for a future phase.
