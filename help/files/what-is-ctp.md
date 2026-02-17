# What is CTP?

CTP (Capable to Promise) is a scheduling engine that answers one core question: **given everything happening right now, can I deliver this by when I need to?**

It looks at your current commitments, resource availability, constraints, and dependencies — then tells you what's possible, when it's possible, and what the trade-offs are.

## What it does

**Builds a schedule** — Takes all your unscheduled work (cases, orders, jobs) and finds the best time and resource assignment for each one, respecting all constraints simultaneously.

**Finds feasible options** — For a specific piece of work, shows you ranked alternatives: which resources, which times, and why one option scores better than another.

**Identifies bottlenecks** — Shows you which resources are overloaded, where gaps exist in your chains, and what's causing infeasibility.

**Evaluates impact** — When something changes (a resource goes down, a new urgent job arrives), quickly shows what's affected and what your options are.

## How it works

The engine uses an Activity-by-Activity (AbA) scheduling process:

1. **Rank** — Decide which task to schedule next (based on priority, due date, scoring rules)
2. **Find** — Search for feasible time-resource combinations (considering availability, constraints, dependencies)
3. **Score** — Evaluate each option against weighted criteria (earliest start, utilization, changeover cost, etc.)
4. **Assign** — Place the task at the best option, update resource availability
5. **Repeat** — Move to the next task

The result is always a feasible schedule — it can be stopped at any point and every placed task is valid.

## Key concepts

- **Resources** — Anything with limited availability: machines, people, rooms, equipment
- **Tasks** — Individual activities that need to be scheduled, each requiring one or more resources
- **Cases/Orders** — Groups of linked tasks that form a chain (e.g., Setup → Procedure → Recovery)
- **Chains** — The sequence of tasks within a case, with dependencies between them
- **Feasibility** — Whether a valid time slot exists that satisfies all constraints
- **Scoring** — How the engine ranks options when multiple feasible slots exist

## Solver strategies

The engine offers different strategies depending on how much time you're willing to spend:

| Strategy | Speed | Best for |
|----------|-------|----------|
| ⚡ Quick | < 1 second | Fast answers, simple schedules |
| 🎯 Balanced | 1-5 seconds | Daily scheduling, most situations |
| 🔬 Thorough | 10-30 seconds | Complex problems with many constraints |
| 🏆 Best Quality | 30-60 seconds | Weekly planning, scenario analysis |

Quick gives you a good answer fast. Best Quality explores more alternatives to find the optimal schedule. Balanced is the right default for most users.
