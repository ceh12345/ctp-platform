# Work Order Groups — Scheduling Discovery Questions for Stafford

**Date:** 2026-06-17
**Status:** Discovery. We need to understand how Stafford actually schedules grouped work orders before designing engine support.
**Related design note:** `docs/sprints/sprint-parallel-processes-wo-groups.md`

## TL;DR

We're adding support for **work order groups** (a head WO with child WOs) to the
scheduling engine. The engine can chain tasks in a single sequence today; what we
don't yet know is **how the work orders within a group relate to each other in
time** — sequential, parallel, or a mix. That one fact decides whether this is a
small change or a significant one, so we want to hear it from Stafford rather than
guess. None of these require Stafford to know anything technical — they're about
how the shop actually runs.

The single most important question is **#4** (does a downstream step depend on
*all* the parallel work orders, or only some).

---

## The questions

### 1. How do work orders in a group relate in time?
When several work orders are grouped together, does one finish before the next
starts (**sequential**), or do multiple run **at the same time** (parallel)?
A concrete example of a real grouped job would help.

> *Why we're asking:* If they're always sequential, the engine can treat the
> whole group as one long chain — a small change. If they run in parallel, we
> need new scheduling logic.

### 2. If they run in parallel, do the branches ever come back together?
Is there a later step (e.g. an assembly, inspection, or final operation) that
can't start until **several** of the parallel work orders are finished? Or are
the parallel work orders independent all the way to the end?

> *Why we're asking:* A "wait for several to finish" step (a *join*) is the thing
> we'd specifically need to model.

### 3. Are parallel branches roughly the same length, or can one be much longer?
For example, a 2-hour branch and a 2-day branch both feeding the same next step.
How common is a big mismatch?

> *Why we're asking:* The simplest design assumes branches finish around the same
> time. If one branch is routinely much longer, that assumption forces the short
> branch to sit idle, and we'd design differently.

### 4. ⭐ Does a later step ever depend on *only some* of the parallel work orders?
When work converges, does the next step wait for **all** the parallel work orders,
or can it start once **specific ones** are done (while others are still running)?

> *Why we're asking:* This is the deciding question. "Waits for all" is a clean,
> contained pattern. "Depends on specific ones" requires a full dependency-graph
> model — a much bigger build. We want to size this correctly.

### 5. Do parallel work orders ever compete for the same machine or operator?
When two work orders in a group are scheduled to run at the same time, are they
always on **different** machines/people, or can they need the **same** one (so
one has to wait)?

> *Why we're asking:* If parallel work is always on different resources, we can
> defer a chunk of work. If they can share a resource, we need to handle that
> contention up front.

### 6. How is the grouping represented in Genius today?
- Is there an explicit **parent/child link** between work orders, or a shared
  **group ID**?
- Is the order of operations explicit (an operation-to-operation link), or implied
  by **operation numbers / dates**?
- For a grouped job, how would we tell from the data that WO-B's first operation
  should follow WO-A's last operation?

> *Why we're asking:* Whatever structure exists in Genius is what our integration
> has to read to reconstruct the grouping. If it's implicit, we need to know what
> to infer it from.

---

## What each answer changes on our side (internal — not for the meeting)

| Answer | Design impact |
| --- | --- |
| Q1 sequential | Linear "collapse to one chain" driver — small, no engine math change |
| Q1 parallel | Need rank-aware (parallel) scheduling |
| Q2 no join | Independent branches — simplest parallel case |
| Q2 join exists | Must model convergence (barrier or graph) |
| Q3 synchronized | Barrier model (`sequence`-as-rank) is fine |
| Q3 mismatched | Barrier wastes time on the short branch — lean toward graph |
| **Q4 waits for all** | **Diamond / rank model — contained (~days)** |
| **Q4 depends on some** | **True dependency graph (`prevLinks`) — significant build** |
| Q5 different resources | Defer intra-group capacity accounting + ship a guard |
| Q5 shared resources | Need intra-combo soft-allocation now |
| Q6 explicit links | Clean ETL mapping |
| Q6 implicit | Need inference rules in the mapping layer |

---

## Notes after the call
_(capture answers here)_

- Q1:
- Q2:
- Q3:
- Q4:
- Q5:
- Q6:
