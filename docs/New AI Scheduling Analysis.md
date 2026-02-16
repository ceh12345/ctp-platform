# Willoughby Scheduling Tutorial — Analysis & Application to CTP Engine

**Source:** "Recommendations on developing a Generalized Planning, Scheduling, and Resource Allocation Application" — John K. Willoughby, PhD (July 2025)

**Context:** Dr. Willoughby's document originated from NASA mission planning research at SAIC, later transitioned to manufacturing, healthcare, sports, and services. The architecture has been fielded in Fortune 500 manufacturing environments. This analysis maps his recommendations to our CTP engine and identifies gaps and improvement opportunities.

---

## 1. Architecture Validation — What We Already Have Right

### P-T-R Loop

Willoughby's core architecture decomposes the scheduling decision into five logic packets:

| Packet | Decision | Our Implementation |
|--------|----------|--------------------|
| **P** | Processing sequence — which task to schedule next | Task ranking via `CTPScoringConfiguration` weights, `solverSequence`, priority |
| **T** | Time selection — when to start the task | `CTPRange.computeDurationForward/Backward`, `CTPStartTimes` |
| **R** | Resource selection — which resources to assign | `ScheduleContext`, `CTPResourceSlots`, candidate scoring |
| **C** | Conflict/backtracking — undo and retry | **MISSING — see Gap #1 below** |
| **A** | Activity redefinition — split or redefine tasks | Not implemented (low priority) |

Our solver executes a forward P-T-R loop: rank tasks, build schedule contexts (resource combinations × time windows), score them, pick the best. This matches Willoughby's recommended AbA (Activity-by-Activity) process exactly.

### Profile Data Structure

Willoughby's foundational data object is the **piecewise-constant function of time** — a linked list of rectangular segments with start time, end time, and quantity. He calls this a "profile."

Our implementation: `CTPIntervals` (a `LinkedList<CTPInterval>`) where each `CTPInterval` has `startW`, `endW`, `qty`, and `runRate`. This is precisely the profile structure he recommends. Our profile algebra:

- **Decrement on schedule:** Add assignment to `staticAssignments`, recompute `staticAvailable`
- **Increment on unschedule:** Remove assignment, recompute available
- **Consumable materials:** Decrement through remainder of horizon (via material tracking mode)

### Constraint Space Search

Willoughby describes pre-filtering resource combinations using constraints (attributes, skills, compatibility rules), then computing feasible time intervals by "sliding" the requirement profile under the availability profile for each resource, then intersecting intervals across all required resources.

Our implementation:
- Pre-filtering: `CTPResourcePreferences`, attribute matching, mode ON/OFF/TRACK
- Sliding/intersection: `CTPRange` with `estPtr`/`lstPtr` walking the availability linked list
- Multi-resource intersection: `CTPResourceSlots` collecting `CTPStartTimes` across all resources in a slot

### One-to-Many Relationship (Activity → Multiple Resources)

Willoughby emphasizes that scheduling should be activity-centric, not resource-centric. Each activity requires multiple resources with potentially different usage intervals.

Our implementation: `CTPTask.capacityResources` (CTPTaskResourceList) and `CTPTask.materialResources` — each task can require N capacity resources and M material resources, each with its own mode (ON/OFF/TRACK).

### Weighted Blended Scoring

Willoughby recommends normalizing metrics and blending with a weighted linear combination. He lists: start time, cost, changeover implications, load distribution, transport, priorities, customer service, downstream impacts.

Our implementation: `CTPScoringConfiguration` with `ruleName`, `weight`, `objective` (MINIMIZE/MAXIMIZE), `penaltyFactor`. Rules like `EarliestStartTimeScoringRule`, `ResourceUtilizationRule`, `LatestStartTimeScoringRule`. Composite scores computed per `ScheduleContext`.

### Timing Relationships

Willoughby recommends general binary relationships between activity start/end times — not just simple predecessor chains. He specifically calls out start-to-start, end-to-end, offsets, and overlaps.

Our implementation: `CTPLinkId` with `prevLink` enables predecessor chains. `ITimingSetting` with `fromTiming`/`toTiming` supports START-to-START and END-to-START patterns. `CTPProcess` groups linked tasks. This covers the common cases but could be extended to support arbitrary offset/overlap relationships.

### Activity Windows

Willoughby recommends earliest start time and latest finish time on every activity, narrowed by constraint propagation.

Our implementation: `CTPTask.window` (CTPInterval with startW/endW) — exactly this.

---

## 2. Gaps & Improvement Opportunities

### Gap #1: Backtracking Logic (Decision "C") — HIGHEST PRIORITY

**What Willoughby describes:**
When a task can't be scheduled (the constraint space is empty), skilled schedulers backtrack — they unschedule previously-scheduled tasks, revise the processing sequence, and resume the forward P-T-R loop. He compares this to a box-filling analogy: if the next block doesn't fit, unpack some shapes and rearrange.

**What we have:**
Our solver does a single forward pass. If a task is infeasible, it records errors (`task.addError()`) and moves on. No automatic retry. The `UnscheduleSingleTask` method (planned for the debug page) provides the primitive, but there's no automated backtracking loop.

**Recommended implementation — "Bump" heuristic:**

```
When task T is infeasible:
  1. Identify the bottleneck resource R (resource with least available capacity in T's window)
  2. Find tasks currently assigned to R that overlap T's window
  3. Rank those tasks by priority (lowest first) or by score (highest score = least optimal)
  4. Unschedule the lowest-priority blocking task B
  5. Retry scheduling T
  6. If T is now feasible, attempt to reschedule B elsewhere
  7. If B can't be rescheduled, record the trade-off (T scheduled, B displaced)
  8. If T is still infeasible after K attempts, mark infeasible and move on
```

**Configurable parameters:**
- `maxBacktrackAttempts` — how many bumps to try per infeasible task (default: 3)
- `backtrackStrategy` — "bump-lowest-priority" | "bump-highest-score" | "bump-most-flexible"
- `allowCascadeBacktrack` — whether bumping B can trigger further bumps (depth limit)

This alone would dramatically improve feasibility rates in constrained scenarios.

### Gap #2: Keep Top-N Scored Contexts (Neighborhoods)

**What Willoughby describes:**
The scored alternatives arranged in descending order create "neighborhoods." When backtracking, try the 2nd-place score, or jump to a score outside the cluster of previous selections. The scores give a rationale for revision that doesn't exist with purely discrete optimization methods.

**What we have:**
`BestScheduleContext` stores only the single best context. All other scored alternatives are discarded after selection.

**Recommended implementation:**

```typescript
class RankedScheduleContexts {
  ranked: BestScheduleContext[];  // top N, sorted by score
  maxRank: number;                // configurable, default 5

  constructor(max: number = 5) {
    this.ranked = [];
    this.maxRank = max;
  }

  addCandidate(ctx: BestScheduleContext) {
    this.ranked.push(ctx);
    this.ranked.sort((a, b) => a.best.blendedScore.score - b.best.blendedScore.score);
    if (this.ranked.length > this.maxRank) this.ranked.pop();
  }

  best(): BestScheduleContext | undefined { return this.ranked[0]; }
  alternative(rank: number): BestScheduleContext | undefined { return this.ranked[rank]; }
}
```

**Usage in backtracking:**
- First pass: use `best()` (rank 0)
- If downstream task fails: backtrack, try `alternative(1)` for the blocking task
- If still fails: try `alternative(2)`, etc.
- This creates a bounded tree search with depth = backtrack attempts × breadth = rank alternatives

**Neighborhood clusters:**
Score the gap between alternatives. If alternatives 1-3 have scores 12.4, 12.6, 12.8 and alternative 4 has score 24.1, then 1-3 form a "neighborhood" and 4 is a "jump." Backtracking within a neighborhood makes small adjustments; jumping outside explores different regions of the solution space.

### Gap #3: Flexibility Scoring Rule (Look-Ahead)

**What Willoughby describes:**
When making local decisions, compute a "flexibility metric" — prefer choices that preserve the most options for future tasks. Skilled schedulers learn to avoid locally optimal decisions that constrain downstream options.

**What we have:**
`CTPStartTimes.whiteSpace()` computes remaining slack. But this isn't used as a scoring input.

**Recommended implementation — FlexibilityScoringRule:**

```typescript
class FlexibilityScoringRule {
  // For each candidate assignment, compute how much capacity
  // remains on the assigned resources for unscheduled tasks

  score(context: ScheduleContext, landscape: SchedulingLandscape): number {
    let flexibility = 0;

    context.slot.resources?.forEach(slot => {
      if (slot.resource) {
        const available = slot.resource.available.staticAvailable;
        if (available) {
          // White space remaining after this assignment
          const remaining = available.whiteSpace(context.startTime);
          // Count unscheduled tasks that need this resource
          const pendingTasks = countPendingTasksForResource(slot.resource, landscape);
          // Flexibility = remaining capacity per pending task
          flexibility += pendingTasks > 0 ? remaining / pendingTasks : remaining;
        }
      }
    });

    return flexibility;  // MAXIMIZE — prefer assignments that leave more room
  }
}
```

Add to scoring config:
```typescript
new CTPScoringConfiguration("FlexibilityScoringRule", 0.3, CTPScoreObjectiveConstants.MAXIMIZE)
```

This penalizes assignments that consume scarce windows where other unscheduled tasks will need capacity.

### Gap #4: Adaptive Weight Learning

**What Willoughby describes:**
After repeated use, the weighting values can be learned from user evaluations. An experienced manager evaluates schedule quality; over time, weights converge to ideal settings for the environment. "Envision a scheduling application that adapts to the environment it's placed in by using evaluations from managers experienced in that environment."

**What we have:**
Static weights configured in `CTPScoringConfiguration`. Users can change them manually but there's no learning loop.

**Recommended implementation — phased approach:**

**Phase 1: Capture feedback data (implement now)**

```typescript
interface SchedulingFeedback {
  taskKey: string;
  solverChoice: {
    resourceKey: string;
    startTime: number;
    score: number;
    scoreBreakdown: Record<string, number>;  // per-rule scores
  };
  userChoice: {
    resourceKey: string;
    startTime: number;
  };
  timestamp: number;
  userId: string;
  tenantId: string;
}
```

Every time a user manually overrides the solver (moves a task, changes a resource), log both what the solver picked and what the user chose. Store in a `scheduling_feedback` table.

**Phase 2: Analyze patterns (implement when sufficient data exists)**

Simple analysis: for each override, compute what weights would have made the solver rank the user's choice higher. If users consistently prefer later start times over earlier ones, the EarliestStartTime weight should decrease.

**Phase 3: Suggest weight adjustments (future)**

After N feedback events, run linear regression:
- Features: per-rule scores for each alternative
- Target: user's binary choice (1 = picked, 0 = not picked)
- Output: suggested weight adjustments

Present to the user: "Based on your last 50 scheduling decisions, we suggest increasing the ResourceUtilization weight from 0.5 to 0.7 and decreasing EarliestStartTime from 1.0 to 0.6. Apply?"

### Gap #5: Profile-Based Resource Requirements

**What Willoughby describes:**
A task's resource requirement should itself be a profile — not a constant. A machining operation might need 1 technician for setup (first 30 min), 0 technicians during automated processing (4 hours), and 1 technician for teardown (15 min). Requiring the technician for the entire 4.75 hours is oversubscription.

**What we have:**
`CTPDuration` is a single interval with one qty. We partially model this with separate SETUP/PROCESS/TEARDOWN sub-tasks, but the resource requirement per sub-task is still a single quantity.

**Recommended implementation (defer unless customer needs it):**

Allow `CTPTaskResource` to carry a requirement profile (list of intervals with qty) rather than a single qty. The constraint space search would decompose into sub-activity intervals as Willoughby describes, compute feasible times for each sub-interval, then intersect.

This is a significant refactor of `computeDurationForward/Backward` and the range logic. It's the right architecture long-term but not urgent for initial launch.

### Gap #6: General Timing Relationships

**What Willoughby describes:**
Any binary relationship between pairs of activities' start and end times — with offsets and overlaps. Not just "end-to-start with zero offset" (simple predecessor).

**What we have:**
`CTPLinkId` with `prevLink` and `ITimingSetting` (START-to-START, END-to-START). This covers common cases.

**Missing:**
- Arbitrary offset values (e.g., "start B at least 2 hours after start of A")
- End-to-end relationships (e.g., "B must finish within 1 hour of A finishing")
- Overlap constraints (e.g., "B can start when A is 50% complete")

**Recommended extension:**

```typescript
interface ITimingConstraint {
  predecessorKey: string;
  predecessorAnchor: 'START' | 'END';
  successorAnchor: 'START' | 'END';
  offsetSeconds: number;       // positive = gap, negative = overlap
  offsetType: 'MIN' | 'MAX' | 'EXACT';
}
```

Add to `CTPTask`:
```typescript
public timingConstraints: ITimingConstraint[];
```

Window narrowing in the solver would apply these constraints to adjust `task.window.startW` and `task.window.endW` before building schedule contexts.

---

## 3. Priority Ranking for Roadmap

| Priority | Feature | Effort | Impact | When |
|----------|---------|--------|--------|------|
| **1** | Backtracking (C logic) — bump heuristic | Medium | High — makes infeasible schedules feasible | Next engine sprint |
| **2** | Keep top-N scored contexts | Low | Medium — enables backtracking and scenario comparison | Same sprint as #1 |
| **3** | Flexibility scoring rule | Low-Medium | Medium — improves schedule quality via look-ahead | Following sprint |
| **4** | Adaptive weight learning — data capture | Low | Foundation for future ML | Implement logging now |
| **5** | General timing relationships | Medium | Medium — enables complex precedence networks | When customer needs it |
| **6** | Profile-based resource requirements | High | Medium — reduces oversubscription | When customer needs it |
| **7** | Adaptive weight learning — regression | Medium | High long-term — self-adapting scheduler | After sufficient feedback data |
| **8** | Activity redefinition (A logic) | High | Low — rare in initial use cases | Future |

---

## 4. Key Quotes & Principles from the Document

### On Architecture
> "A general scheduler should schedule activities, each of which may require multiple resources."
— Validates our task-centric (not resource-centric) approach.

### On Profile Data Structure
> "This piecewise-constant profile modelling allows much better description of resource requirements than is typically modelled in many applications. The goal here is descriptive accuracy and completeness, not compatibility with mathematical techniques."
— Validates our CTPIntervals linked list over time-bucket approaches.

### On Constraint Space
> "We have eliminated the 'bucketing' logic of the spreadsheet which is the basis for many scheduling applications that do not model the environment adequately."
— Our continuous-time model (startW/endW as seconds from epoch) avoids bucketing.

### On the AbA Process
> "A major advantage of the AbA process is that it produces at each step a feasible timeline. It can be stopped at any point and the schedule produced to that point is usable because it is resource feasible."
— This is exactly how our solver works — partial results are always valid.

### On Revision Over Restart
> "Practically requires that schedule revision be done with as few changes to the previous schedule as possible."
— This supports our interactive schedule/unschedule approach and argues against full re-solve.

### On Neighborhoods
> "The metrics arranged in descending order create the concept of neighborhoods. These can be used as the guidance for implementing iterations in C that are excellent alternatives for impacting the global criteria."
— The key insight for our backtracking implementation: use ranked scores to guide retry logic.

### On Adaptive Learning
> "Envision a scheduling application that adapts to the environment it's placed in by using evaluations from managers experienced in that environment."
— The long-term vision for our multi-tenant platform: each tenant's solver learns from their planners.

---

## 5. Mapping to Our Multi-Vertical Strategy

Willoughby's document originated from NASA and transitioned to manufacturing, healthcare, sports, and services — the same verticals we're targeting. His architecture's generality validates our multi-tenant approach:

| Vertical | P (Sequence) | T-R (Time-Resource) | C (Backtrack) |
|----------|-------------|---------------------|---------------|
| **Manufacturing** | Priority + due date | Earliest feasible + min changeover | Bump low-priority jobs |
| **Healthcare** | Urgency + appointment time | Provider availability intersection | Reschedule non-urgent cases |
| **Rec Sports** | Round/week structure | Field + referee + team availability | Swap game slots |
| **Field Services** | Priority + geography | Technician + van + parts + travel time | Reassign nearby technician |
| **Auto Repair** | Appointment time + severity | Bay + mechanic + parts | Delay lower-priority jobs |

The P-T-R-C architecture with configurable scoring weights handles all of these without code changes — only configuration changes. This is the core value proposition of our platform.

---

## 6. Document Provenance

- **Author:** John K. Willoughby, PhD
- **Origin:** NASA mission planning research at SAIC (Science Applications International Corporation)
- **Researchers credited:** Drs. Rudy Ramsey and James Van Doren
- **Validation:** Fielded in NASA applications and Fortune 500 manufacturing environments
- **Date:** July 2025
- **Relevance:** Directly applicable to CTP engine architecture, scoring system, and multi-tenant scheduling platform
