# Engine Sprint: Global Optimization Solver (CP-SAT)

**What it does:** Adds a "Best Quality" solver strategy that uses Google OR-Tools CP-SAT to find the globally optimal chain-combo assignment across all chains simultaneously. Instead of greedy chain-by-chain scheduling (which can paint itself into corners), the optimizer evaluates all feasible combos for all chains and selects the assignment that maximizes overall schedule quality.

**Why:** The greedy solver picks the best combo for each chain in priority order. But Chain A's "best" combo might consume a resource that Chain B desperately needs — and Chain B ends up infeasible or pushed days later. The optimizer sees all chains at once and makes trade-offs: "give Chain A its rank-2 resource so Chain B can have its rank-1 resource, and both land on Monday."

**When:** After the primary-task-anchor sprint is stable and the greedy solver is producing good results for most scenarios. This is the "Best Quality 🏆" strategy tier from the solver roadmap.

**Cost:** Zero. All tools are open source (Apache 2.0 / MIT / GPL). No API fees, no cloud dependencies. Runs on your own Azure compute.

**Size:** ~2-3 days  
**Depends on:** Primary-task-anchor sprint (done), all feasible combos returned per chain (not just the winner)

---

## Architecture Decision: Python Microservice

OR-Tools CP-SAT doesn't have a native TypeScript/JavaScript binding. Three options:

| Approach | Pros | Cons |
|----------|------|------|
| **Python microservice** | Full OR-Tools API, mature, well-documented | Separate process, Python dependency |
| **GLPK.js (WASM)** | Runs in-process, no Python | MILP only (no native CP), weaker constraint modeling |
| **Pyodide (Python in WASM)** | Runs in-process | Slow startup, large bundle, limited OR-Tools support |

**Recommendation: Python microservice.** A thin FastAPI or Flask service that accepts the optimization problem as JSON, solves it with CP-SAT, and returns the solution. Deployed alongside the NestJS API on the same Azure App Service (or as a sidecar container). The NestJS service calls it via HTTP on localhost.

This keeps the TypeScript engine clean and lets you use OR-Tools at full power. The Python service is stateless — it receives the problem, solves it, returns the answer. No shared state, no persistence.

**Alternative for simpler V1:** Use GLPK.js (pure WASM, runs in the NestJS process). This gives you MILP without the Python dependency. Good enough for the core assignment problem. Upgrade to CP-SAT later if you need disjunctive scheduling constraints.

---

## How It Works

### Phase 1: Chain Engine Produces Feasible Combos (existing)

The chain context engine runs as today — for each chain, it generates feasible combos with propagated range windows, scores them, and assigns start times. But instead of picking one winner per chain and discarding the rest, it **returns all valid combos** (or top-K per chain).

```typescript
// Today: returns ChainContextCombo | null (one winner)
evaluateChain(...): ChainContextCombo | null

// New: returns all valid combos, sorted by score
evaluateChainAll(...): ChainContextCombo[]
```

### Phase 2: Build Optimization Problem

Collect all feasible combos across all chains and build the optimization model:

```json
{
  "chains": [
    {
      "chainKey": "C003",
      "priority": 2,
      "combos": [
        {
          "comboIndex": 0,
          "chainScore": 1.23,
          "startTimes": [
            { "taskKey": "C003-SETUP", "start": 1709625600, "end": 1709627400, "resourceKeys": ["NURSE-02"] },
            { "taskKey": "C003-PROC", "start": 1709627400, "end": 1709632800, "resourceKeys": ["OR-02", "DR-PATEL", "AN-GARCIA"] },
            { "taskKey": "C003-RECOV", "start": 1709632800, "end": 1709636400, "resourceKeys": ["REC-01"] }
          ]
        },
        {
          "comboIndex": 1,
          "chainScore": 1.45,
          "startTimes": [...]
        }
      ]
    },
    {
      "chainKey": "C004",
      "combos": [...]
    }
  ],
  "resources": [
    { "resourceKey": "OR-01", "capacity": 1 },
    { "resourceKey": "OR-02", "capacity": 1 },
    { "resourceKey": "AN-GARCIA", "capacity": 1 },
    { "resourceKey": "REC-01", "capacity": 4 }
  ],
  "objective": "minimize_score",
  "timeoutSeconds": 30
}
```

### Phase 3: CP-SAT Solves the Global Assignment

The Python solver builds the CP-SAT model:

```python
from ortools.sat.python import cp_model

model = cp_model.CpModel()

# Decision variables: x[chain][combo] = 1 if chain uses this combo
x = {}
for chain in problem['chains']:
    chain_vars = []
    for combo in chain['combos']:
        var = model.NewBoolVar(f"x_{chain['chainKey']}_{combo['comboIndex']}")
        x[(chain['chainKey'], combo['comboIndex'])] = var
        chain_vars.append(var)
    
    # Each chain uses at most one combo
    model.Add(sum(chain_vars) <= 1)

# No-overlap constraints per resource
# For each resource, collect all (interval, chain, combo) that use it
# Ensure no two selected intervals overlap on the same resource
for resource in problem['resources']:
    intervals = []
    presences = []
    
    for chain in problem['chains']:
        for combo in chain['combos']:
            for task_st in combo['startTimes']:
                if resource['resourceKey'] in task_st['resourceKeys']:
                    # Create an optional interval variable
                    start = task_st['start']
                    end = task_st['end']
                    duration = end - start
                    
                    interval = model.NewOptionalFixedSizeIntervalVar(
                        start, duration,
                        x[(chain['chainKey'], combo['comboIndex'])],
                        f"interval_{chain['chainKey']}_{combo['comboIndex']}_{task_st['taskKey']}_{resource['resourceKey']}"
                    )
                    intervals.append(interval)
    
    # No overlap on this resource (respects capacity for pooled resources)
    if resource['capacity'] == 1:
        model.AddNoOverlap(intervals)
    else:
        # For pooled resources, use cumulative constraint
        demands = [1] * len(intervals)
        model.AddCumulative(intervals, demands, resource['capacity'])

# Objective: minimize total score of selected combos
# Also maximize number of scheduled chains (weighted)
score_terms = []
scheduled_terms = []

for chain in problem['chains']:
    chain_scheduled = []
    for combo in chain['combos']:
        var = x[(chain['chainKey'], combo['comboIndex'])]
        # Score penalty (lower is better, scaled to integers for CP-SAT)
        score_terms.append(var * int(combo['chainScore'] * 1000))
        chain_scheduled.append(var)
    scheduled_terms.append(sum(chain_scheduled))

# Primary: maximize chains scheduled (weight: 1,000,000 per chain)
# Secondary: minimize total score among scheduled chains
total_scheduled = sum(scheduled_terms)
total_score = sum(score_terms)

model.Maximize(total_scheduled * 1000000 - total_score)

# Solve with timeout
solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = problem.get('timeoutSeconds', 30)
status = solver.Solve(model)

# Extract solution
if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    solution = {
        'status': 'optimal' if status == cp_model.OPTIMAL else 'feasible',
        'scheduledChains': 0,
        'totalScore': 0,
        'assignments': []
    }
    
    for chain in problem['chains']:
        for combo in chain['combos']:
            if solver.Value(x[(chain['chainKey'], combo['comboIndex'])]):
                solution['scheduledChains'] += 1
                solution['totalScore'] += combo['chainScore']
                solution['assignments'].append({
                    'chainKey': chain['chainKey'],
                    'comboIndex': combo['comboIndex'],
                })
    
    return solution
```

### Phase 4: Apply Solution

The NestJS service receives the solution and commits the selected combos:

```typescript
for (const assignment of solution.assignments) {
  const chain = chains.find(c => c.key === assignment.chainKey);
  const combo = allCombos[assignment.chainKey][assignment.comboIndex];
  chainEngine.commitChain(combo, scheduleEngine, landscape, direction);
}
```

---

## Python Microservice Design

### Endpoint

```
POST /optimize
```

Accepts the problem JSON, returns the solution JSON. Stateless — no database, no persistence.

### FastAPI Service

```python
from fastapi import FastAPI
from pydantic import BaseModel
from ortools.sat.python import cp_model

app = FastAPI()

class OptimizeRequest(BaseModel):
    chains: list
    resources: list
    objective: str = "minimize_score"
    timeoutSeconds: int = 30

class OptimizeResponse(BaseModel):
    status: str
    scheduledChains: int
    totalScore: float
    assignments: list
    solveTimeMs: int

@app.post("/optimize", response_model=OptimizeResponse)
def optimize(request: OptimizeRequest):
    # Build and solve CP-SAT model
    # Return assignments
    ...
```

### Deployment

Deploy alongside the NestJS API:

**Option A: Same App Service**
- Install Python + OR-Tools in the Docker image
- NestJS spawns the FastAPI process on startup
- Internal HTTP calls on localhost:8001

**Option B: Azure Container Apps sidecar**
- Separate container for the Python service
- NestJS calls it via localhost (sidecar networking)
- Independent scaling and deployment

**Option C: Azure Functions**
- Serverless Python function
- NestJS calls it via HTTP
- Pay-per-execution, auto-scales to zero
- Cold start penalty (~2-3 seconds first call)

Option A is simplest for V1. Option B is cleaner for production.

---

## Integration with Solver Strategy Tiers

```
⚡ Quick     — Greedy, single-pass, no backtracking (existing)
🎯 Balanced  — Primary-task anchor + bump-and-retry (current sprint)
🔬 Thorough  — Greedy + contention scoring penalty (Level 1 look-ahead)
🏆 Best      — CP-SAT global optimization (this sprint)
```

The UI strategy selector already exists (from Sprint 5). When the planner picks 🏆 Best Quality:

1. NestJS runs the chain engine for all chains → collects all feasible combos (not just winners)
2. Builds the optimization problem JSON
3. Calls the Python solver service
4. Receives the globally optimal assignments
5. Commits the selected combos
6. Returns results with `strategy: "Best (CP-SAT)"` and `solveTimeMs`

The planner sees: "Solved in 4.2 seconds — 13/13 chains scheduled (Quick got 11/13)"

---

## What the Optimizer Can Do That Greedy Can't

### 1. Resource Sharing Trade-offs
Chain A wants OR-01 Monday morning (best score). Chain B also wants OR-01 Monday morning (only option). Greedy: A gets it (higher priority), B goes to Tuesday. Optimizer: gives A its rank-2 resource (OR-02), both land on Monday.

### 2. Anesthesiologist Balancing
5 chains need AN-JONES, 2 chains need AN-GARCIA. Greedy schedules in priority order — chains 4 and 5 can't get Jones. Optimizer distributes: 3 chains on Jones, 2 on Garcia, all on Monday.

### 3. Recovery Bay Contention
4 chains finish within the same hour, all need recovery bays. Only 3 bays. Greedy: chain 4 waits. Optimizer: staggers PROC start times by 30 minutes so recovery bays cycle.

### 4. Cross-Day Optimization
Greedy packs Monday until it breaks, then spills to Tuesday. Optimizer might voluntarily place 2 chains on Tuesday to reduce Monday contention, resulting in better overall utilization and fewer infeasible chains.

---

## Fallback Behavior

If the Python service is unavailable (not deployed, crashed, timeout):
- Fall back to the Balanced strategy automatically
- Log a warning: "CP-SAT solver unavailable, using Balanced strategy"
- Return results with `strategy: "Balanced (CP-SAT unavailable)"`

If CP-SAT finds no better solution than greedy:
- Return the greedy solution
- Include comparison: `"improvement": { "chainsGained": 0, "scoreImprovement": 0 }`

---

## GLPK.js Alternative (No Python)

For a simpler V1 without the Python dependency, use GLPK.js (GLPK compiled to WebAssembly):

```bash
npm install glpk.js
```

```typescript
import GLPK from 'glpk.js';

const glpk = GLPK();

const lp = {
  name: 'ChainAssignment',
  objective: {
    direction: glpk.GLP_MIN,
    name: 'totalScore',
    vars: [
      { name: 'x_C003_0', coef: 1.23 },
      { name: 'x_C003_1', coef: 1.45 },
      { name: 'x_C004_0', coef: 0.89 },
    ]
  },
  subjectTo: [
    // Each chain uses at most one combo
    {
      name: 'chain_C003',
      vars: [
        { name: 'x_C003_0', coef: 1 },
        { name: 'x_C003_1', coef: 1 },
      ],
      bnds: { type: glpk.GLP_UP, ub: 1 }
    },
    // Resource conflicts (no overlap)
    // ... generated from time windows
  ],
  binaries: ['x_C003_0', 'x_C003_1', 'x_C004_0'],
};

const result = glpk.solve(lp);
```

**Trade-offs vs CP-SAT:**

| Feature | GLPK.js | CP-SAT |
|---------|---------|--------|
| Language | TypeScript (in-process) | Python (microservice) |
| Constraint types | Linear only | Linear + disjunctive + cumulative |
| No-overlap | Must discretize time into slots | Native `AddNoOverlap` |
| Pooled resources | Must enumerate capacity slots | Native `AddCumulative` |
| Performance | Good for < 500 variables | Good for < 10,000 variables |
| Deployment | Zero extra infrastructure | Python service needed |

**Recommendation:** Start with GLPK.js for V1 (no Python, runs in-process, handles the core assignment problem). Upgrade to CP-SAT when you need disjunctive constraints or problem size exceeds GLPK's comfort zone.

---

## Verification

### Unit Tests

1. **Two chains competing for same resource — optimizer shares**
   - Chain A: combo 1 (OR-01, score 1.0), combo 2 (OR-02, score 1.5)
   - Chain B: combo 1 (OR-01, score 1.0) — only option
   - Greedy: A gets OR-01 (higher priority), B infeasible
   - Optimizer: A gets OR-02 (score 1.5), B gets OR-01 (score 1.0), both scheduled

2. **No conflicts — optimizer matches greedy**
   - 5 chains with non-overlapping resource requirements
   - Optimizer picks same combos as greedy (best score for each)
   - Solve time < 1 second

3. **All chains infeasible — optimizer returns empty**
   - No feasible combos for any chain
   - Returns `scheduledChains: 0`, status: "infeasible"

4. **Timeout — returns best-so-far**
   - Large problem (50 chains × 20 combos), timeout = 2 seconds
   - Returns feasible (not necessarily optimal) solution
   - Status: "feasible" (not "optimal")

5. **Pooled resource capacity respected**
   - 4 recovery bays (capacity = 4)
   - 5 chains needing recovery in the same window
   - Optimizer schedules 4, staggers the 5th

### Integration Tests

6. **Healthcare — C003 Monday with global optimization**
   - All 13 cases solved with Best Quality strategy
   - C003 on Monday (same as primary-task anchor)
   - Other cases not degraded compared to Balanced strategy

7. **Healthcare — optimizer schedules more chains than greedy**
   - Artificially tighten resources so greedy gets 10/13
   - Optimizer gets 12/13 or 13/13 by redistributing resources

8. **Fallback when solver unavailable**
   - Kill the Python service
   - NestJS falls back to Balanced, logs warning
   - Results returned normally

9. **Manufacturing — optimizer handles non-chain tasks**
   - Single-task "chains" (no predecessors)
   - Optimizer treats each as a chain with one combo
   - Results match or beat greedy

10. **HRMD — 77 orders with cadence**
    - Optimizer respects cadence-aligned start times
    - More games scheduled than greedy on tight Saturdays

### Performance

11. **Healthcare (13 chains) — < 5 seconds**
12. **HRMD (77 orders) — < 30 seconds**
13. **Stress test (100 chains × 50 combos) — < 60 seconds with timeout**

---

## Future Extensions

### Adaptive Objective Weights
Let the planner adjust the optimization objective:
- "Maximize scheduled chains" (feasibility-first)
- "Minimize makespan" (finish everything ASAP)
- "Minimize changeovers" (reduce setup time)
- "Balance utilization" (spread work across resources)

These become different objective functions in the CP-SAT model, selectable from the UI.

### Warm Starting
Pass the greedy solution as an initial hint to CP-SAT. The optimizer starts from a known-good solution and tries to improve it, rather than searching from scratch. Reduces solve time significantly.

### Incremental Re-optimization
When the planner makes a manual change (unschedule a task, add a rush order), don't re-solve everything. Fix the changed chains and re-optimize only the affected portion. CP-SAT supports assumptions that can lock in previous decisions.

### Multi-Objective Pareto Front
Instead of a single "best" solution, return 3-5 solutions on the Pareto front:
- Solution A: 13/13 scheduled, moderate utilization
- Solution B: 12/13 scheduled, best utilization
- Solution C: 13/13 scheduled, minimum changeovers

The planner picks the trade-off they prefer. Display as a comparison table in the UI.

---

## Summary

| Component | Technology | Cost | Deployment |
|-----------|------------|------|------------|
| V1 Optimizer | GLPK.js (WASM) | Free (GPL) | In-process with NestJS |
| V2 Optimizer | OR-Tools CP-SAT | Free (Apache 2.0) | Python FastAPI sidecar |
| Modeling | Linear programming (V1) / Constraint programming (V2) | Free | N/A |

| Change | File | Type |
|--------|------|------|
| `evaluateChainAll()` | chaincontextengine.ts | New method (return all combos) |
| `buildOptimizationProblem()` | optimization.service.ts | New service |
| `callOptimizer()` | optimization.service.ts | HTTP call to solver |
| `applyOptimizedSolution()` | ctp.service.ts | Apply CP-SAT solution |
| `optimize` endpoint | optimizer.py | New Python service |
| Strategy tier wiring | ctp.service.ts | Route "Best" to optimizer |
| Fallback logic | optimization.service.ts | Graceful degradation |

Commit: "feat(engine): global optimization solver — CP-SAT for Best Quality strategy tier"
