# Terminology

The scheduling engine uses a generic data model that adapts to your industry. The same engine powers healthcare scheduling, manufacturing planning, field services, and more — each with its own language.

## How terminology works

The engine has generic terms internally. Your tenant configuration maps them to your industry's language. Everything in the UI, analytics, and API responses uses your terms.

## Term mapping by industry

| Generic Term | Healthcare | Manufacturing | Field Services | Rec Sports |
|-------------|------------|---------------|----------------|------------|
| Resource | Resource | Resource | Technician / Van | Field / Referee |
| Task | Phase | Task / Operation | Service Call | Game / Match |
| Order | Case | Work Order | Work Order | Season Week |
| Duration | Procedure Time | Processing Time | Job Duration | Game Length |
| State Change | Turnover | Changeover | Travel Time | Field Prep |
| Process | Procedure Type | Process / Recipe | Service Type | Round |
| Schedule | OR Schedule | Production Schedule | Route Plan | Game Schedule |
| Solve | Build Schedule | Build Schedule | Build Routes | Build Schedule |
| Material | Supply / Implant | Material / Component | Parts | Equipment |

## Core concepts (in generic terms)

**Resource** — Anything with limited availability that tasks compete for. Machines, people, rooms, equipment, vehicles. Each resource has a calendar defining when it's available and a capacity (how many things it can do simultaneously — usually 1).

**Task** — A single schedulable activity. Has a duration, requires one or more resources, and belongs to a time window (earliest start, latest finish). Tasks can be linked into chains.

**Order/Case** — A group of linked tasks forming a complete piece of work. An order to manufacture a part, a surgical case, a customer service request. The chain defines the sequence.

**Chain** — The linked sequence of tasks within an order. Task B can't start until Task A is complete. The engine respects these dependencies when scheduling.

**Duration** — How long a task takes on its assigned resource. Can be fixed (always 2 hours), variable (depends on quantity), or rate-based (X units per hour).

**State Change / Changeover** — Time needed when switching between different types of work on the same resource. Switching an OR from orthopedic to general surgery, or a CNC machine from one part type to another. Different transitions may require different durations.

**Process / Procedure Type** — The category of work. Defines what resources are needed, what the default duration is, and what changeover rules apply.

**Window** — The time range within which a task must be scheduled. Defined by earliest start and latest finish. The engine only considers slots within this window.

**Feasibility** — Whether a valid time-resource combination exists for a task. A task is feasible if the engine can find at least one slot where all required resources are available simultaneously within the task's window.

**Scoring** — How the engine ranks options when multiple feasible slots exist. Weighted rules evaluate each option on criteria like earliest start time, resource utilization, changeover cost, and priority. The option with the best blended score wins.
