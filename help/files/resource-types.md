# Resource Types

Resources are anything with limited availability that tasks compete for. The engine handles different resource types through configuration, not code changes.

## Reusable vs. Consumable

**Reusable resources** — Available again after a task finishes. Machines, people, rooms, equipment. When a surgery ends, the OR is available for the next case.

**Consumable resources** — Used up when assigned. Materials, supplies, inventory. When you use 10 bolts for an assembly, those bolts are gone. Available quantity decreases through the rest of the horizon.

Most scheduling uses reusable resources. Consumable resources are relevant for manufacturing with material constraints.

## Common resource types by industry

### Healthcare
| Resource | Examples | Notes |
|----------|----------|-------|
| Room | Operating Room 1, OR-2 | Limited quantity, each has a calendar |
| Surgeon | Dr. Smith, Dr. Patel | Each has their own schedule (clinic days, OR days, days off) |
| Anesthesiologist | AN-Jones, AN-Garcia | Often the bottleneck — fewer than surgeons |
| Nursing | Nurse Team 1, RN-02 | Shift-based availability |
| Equipment | Fluoroscopy, Surgical Laser | Shared across rooms, creates conflicts |
| Recovery | Recovery Bay 1-4 | Can become bottleneck with long-recovery cases |

### Manufacturing
| Resource | Examples | Notes |
|----------|----------|-------|
| Machine | CNC-01, CNC-02, Mill-01 | Each has capacity, calendar, capabilities |
| Operator | Tech-A, Tech-B | May be cross-trained on multiple machines |
| Station | Assembly-1, QC-01 | Dedicated areas for specific operations |
| Tool | Fixture-A, Jig-B | Shared tooling that moves between machines |

### Field Services
| Resource | Examples | Notes |
|----------|----------|-------|
| Technician | John, Maria | Skills, certifications, geographic zone |
| Vehicle | Van-01, Truck-02 | Carries tools and parts |
| Parts | Specific replacement parts | Consumable, must be in stock |

## Resource calendars

Every resource has a calendar defining when it's available:

- **Working hours** — Mon-Fri 6:00-18:00, or shift-based (6:00-14:00, 14:00-22:00)
- **Days off** — Weekends, holidays, personal days
- **Maintenance windows** — Scheduled downtime for maintenance
- **Block schedules** — Reserved time (surgeon block time, machine reserved for specific product)

The engine only schedules tasks during available calendar time. Unavailable periods appear as dark grey on the Gantt chart.

## Resource capacity

Most resources have a capacity of 1 — they can do one thing at a time. A single operating room handles one surgery at a time. A CNC machine runs one job at a time.

Some resources can handle multiple simultaneous tasks:
- A recovery area with 4 bays can have 4 patients recovering simultaneously
- A pool of 3 identical machines can run 3 jobs in parallel

Capacity is set per resource. The engine tracks how much capacity is used at each point in time and only schedules tasks when sufficient capacity remains.

## Resource preferences

Tasks can specify preferred resources with rankings:

- **Primary preference** — The preferred resource (rank 1)
- **Alternatives** — Other resources that can do the work (rank 2, 3, etc.)

The scoring rules factor in preferences — placing a task on its preferred resource scores better than placing it on an alternative, all else being equal.

## Hierarchies

Resources are organized into hierarchies for reporting and filtering:

- **Level 1:** Resource group (e.g., "Operating Room", "Surgeon", "CNC")
- **Level 2-5:** Sub-groups as needed

The Analytics utilization view groups resources by hierarchy, so you see "Surgeon Utilization" as a group rather than individual utilization for each doctor.
