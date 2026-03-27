# Integrating OR-Tools CP-SAT with an Existing C# Scheduling System

## Context

I have an existing C# program that builds a list of feasible resource combinations for scheduling. Each combination represents a valid assignment of resources to tasks/activities within time windows. Today, the system selects the "best" combination using greedy heuristics — processing tasks in priority order and picking the highest-scoring feasible combo for each.

I want to explore using Google OR-Tools CP-SAT solver (free, Apache 2.0 license, available via NuGet as `Google.OrTools`) to replace the greedy selection with a global optimization that considers all tasks simultaneously and finds the best overall assignment.

## What I Have Today

- A C# program that generates feasible combinations per task/activity
- Each combination includes: assigned resources, feasible time window (earliest start, latest start, earliest end, latest end), and a quality score
- Tasks may be linked in chains (predecessor/successor relationships with timing constraints like max gap between tasks)
- Resources have capacity constraints (some are exclusive like machines/rooms, some are pooled like recovery bays)
- The greedy approach works but can paint itself into corners — Task A grabs a resource that Task B needed more, pushing Task B to a later day or making it infeasible

## What I Want

1. After generating all feasible combinations for all tasks, pass them to CP-SAT
2. CP-SAT selects one combination per task (or none if infeasible) that maximizes the global schedule quality
3. Constraints ensure no resource double-booking and chain timing requirements are met
4. The solution should be better than greedy — more tasks scheduled, earlier placements, fewer conflicts

## Questions for Discussion

1. **How do I model my feasible combinations as CP-SAT variables and constraints?** Each task has N feasible combos — I need to pick at most one. Each combo occupies specific resources during specific time windows.

2. **How do I handle the no-overlap constraint for exclusive resources?** If Combo A for Task 1 uses Resource R from 10:00-11:30, and Combo B for Task 2 also uses Resource R from 10:30-12:00, only one can be selected.

3. **How do I handle pooled resources with capacity > 1?** Recovery bays have capacity 4 — up to 4 tasks can use them simultaneously.

4. **How do I model chain timing constraints?** If Task 1 (SETUP) must end before Task 2 (PROC) starts, and maxGap=0 means they must be back-to-back, how does CP-SAT enforce this across the selected combos?

5. **What should the objective function look like?** I want to maximize the number of scheduled tasks (primary) and minimize total score (secondary). How do I balance these?

6. **What's the expected performance?** My problem size is roughly 10-100 tasks, each with 5-50 feasible combos. Is this within CP-SAT's comfort zone?

7. **Can I warm-start CP-SAT with my greedy solution?** Pass the greedy result as a hint so CP-SAT starts from a known-good solution and tries to improve it.

## Starter Code to Discuss

Here's a skeleton of how I think the integration would look. Please review, correct, and expand:

```csharp
using Google.OrTools.Sat;
using System;
using System.Collections.Generic;
using System.Linq;

// ── Data structures (simplified from my actual code) ──

public class FeasibleCombo
{
    public string TaskKey { get; set; }
    public int ComboIndex { get; set; }
    public double Score { get; set; }  // lower is better
    public long StartTime { get; set; }  // epoch seconds
    public long EndTime { get; set; }
    public List<string> ResourceKeys { get; set; }  // resources used by this combo
    public string ChainKey { get; set; }  // which chain this task belongs to
    public int ChainSequence { get; set; }  // position in chain (0, 1, 2...)
}

public class ResourceInfo
{
    public string ResourceKey { get; set; }
    public int Capacity { get; set; }  // 1 for exclusive, >1 for pooled
}

public class ChainConstraint
{
    public string PredecessorTaskKey { get; set; }
    public string SuccessorTaskKey { get; set; }
    public long MaxGapSeconds { get; set; }  // -1 = unconstrained, 0 = back-to-back
}

// ── Optimizer ──

public class ScheduleOptimizer
{
    public Dictionary<string, int> Optimize(
        List<FeasibleCombo> allCombos,
        List<ResourceInfo> resources,
        List<ChainConstraint> chainConstraints,
        int timeoutSeconds = 30)
    {
        var model = new CpModel();
        
        // Group combos by task
        var combosByTask = allCombos
            .GroupBy(c => c.TaskKey)
            .ToDictionary(g => g.Key, g => g.ToList());
        
        // ── Decision Variables ──
        // x[taskKey, comboIndex] = 1 if task uses this combo
        var x = new Dictionary<(string task, int combo), BoolVar>();
        var taskScheduled = new Dictionary<string, BoolVar>();
        
        foreach (var (taskKey, combos) in combosByTask)
        {
            var comboVars = new List<BoolVar>();
            foreach (var combo in combos)
            {
                var v = model.NewBoolVar($"x_{taskKey}_{combo.ComboIndex}");
                x[(taskKey, combo.ComboIndex)] = v;
                comboVars.Add(v);
            }
            
            // At most one combo per task
            var scheduled = model.NewBoolVar($"scheduled_{taskKey}");
            taskScheduled[taskKey] = scheduled;
            model.Add(LinearExpr.Sum(comboVars) == scheduled);
        }
        
        // ── Resource No-Overlap Constraints ──
        foreach (var resource in resources)
        {
            // Collect all intervals that use this resource
            var intervals = new List<IntervalVar>();
            var demands = new List<IntVar>();
            
            foreach (var combo in allCombos)
            {
                if (!combo.ResourceKeys.Contains(resource.ResourceKey))
                    continue;
                
                var isPresent = x[(combo.TaskKey, combo.ComboIndex)];
                
                // Fixed interval — start and end are known for each combo
                var interval = model.NewOptionalFixedSizeIntervalVar(
                    combo.StartTime,
                    combo.EndTime - combo.StartTime,
                    isPresent,
                    $"interval_{combo.TaskKey}_{combo.ComboIndex}_{resource.ResourceKey}"
                );
                
                intervals.Add(interval);
                demands.Add(model.NewConstant(1));
            }
            
            if (intervals.Count == 0) continue;
            
            if (resource.Capacity == 1)
            {
                // Exclusive resource — no overlap
                model.AddNoOverlap(intervals);
            }
            else
            {
                // Pooled resource — cumulative constraint
                model.AddCumulative(intervals, demands, resource.Capacity);
            }
        }
        
        // ── Chain Timing Constraints ──
        foreach (var chain in chainConstraints)
        {
            if (!combosByTask.ContainsKey(chain.PredecessorTaskKey) ||
                !combosByTask.ContainsKey(chain.SuccessorTaskKey))
                continue;
            
            var predCombos = combosByTask[chain.PredecessorTaskKey];
            var succCombos = combosByTask[chain.SuccessorTaskKey];
            
            // If both are scheduled, enforce timing
            // For each pair of selected pred/succ combos:
            //   succ.start >= pred.end (predecessor must finish first)
            //   if maxGap >= 0: succ.start <= pred.end + maxGap
            
            foreach (var pred in predCombos)
            {
                foreach (var succ in succCombos)
                {
                    var bothSelected = model.NewBoolVar(
                        $"both_{pred.TaskKey}_{pred.ComboIndex}_{succ.TaskKey}_{succ.ComboIndex}");
                    
                    // bothSelected = pred.selected AND succ.selected
                    model.AddMultiplicationEquality(bothSelected, new[] {
                        x[(pred.TaskKey, pred.ComboIndex)],
                        x[(succ.TaskKey, succ.ComboIndex)]
                    });
                    
                    // If both selected: succ must start after pred ends
                    // succ.start >= pred.end  (reified: only when bothSelected = 1)
                    if (succ.StartTime < pred.EndTime)
                    {
                        // This combo pair violates ordering — forbid it
                        model.Add(bothSelected == 0);
                    }
                    
                    // If both selected and maxGap is set: succ must start within maxGap
                    if (chain.MaxGapSeconds >= 0)
                    {
                        long maxSuccStart = pred.EndTime + chain.MaxGapSeconds;
                        if (succ.StartTime > maxSuccStart)
                        {
                            // This combo pair violates maxGap — forbid it
                            model.Add(bothSelected == 0);
                        }
                    }
                }
            }
        }
        
        // ── Objective ──
        // Primary: maximize scheduled tasks (weight: 1,000,000)
        // Secondary: minimize total score (weight: 1)
        
        var scheduledCount = LinearExpr.Sum(taskScheduled.Values);
        
        var scoreTerms = new List<LinearExpr>();
        foreach (var combo in allCombos)
        {
            // Scale score to integer (CP-SAT works with integers)
            int scaledScore = (int)(combo.Score * 1000);
            scoreTerms.Add(x[(combo.TaskKey, combo.ComboIndex)] * scaledScore);
        }
        var totalScore = LinearExpr.Sum(scoreTerms);
        
        // Maximize: (scheduled * 1000000) - totalScore
        model.Maximize(scheduledCount * 1000000 - totalScore);
        
        // ── Solve ──
        var solver = new CpSolver();
        solver.StringParameters = $"max_time_in_seconds:{timeoutSeconds}";
        
        var status = solver.Solve(model);
        
        // ── Extract Solution ──
        var result = new Dictionary<string, int>();  // taskKey → comboIndex
        
        if (status == CpSolverStatus.Optimal || status == CpSolverStatus.Feasible)
        {
            foreach (var (taskKey, combos) in combosByTask)
            {
                foreach (var combo in combos)
                {
                    if (solver.Value(x[(taskKey, combo.ComboIndex)]) == 1)
                    {
                        result[taskKey] = combo.ComboIndex;
                        break;
                    }
                }
            }
            
            Console.WriteLine($"Status: {status}");
            Console.WriteLine($"Scheduled: {result.Count} / {combosByTask.Count} tasks");
            Console.WriteLine($"Objective: {solver.ObjectiveValue}");
            Console.WriteLine($"Solve time: {solver.WallTime:F2}s");
        }
        else
        {
            Console.WriteLine($"No solution found. Status: {status}");
        }
        
        return result;
    }
}
```

## What I'd Like Help With

1. Review the starter code above — is the CP-SAT modeling correct?
2. Is `AddMultiplicationEquality` the right way to handle "if both combos are selected, enforce timing"? Or is there a cleaner reification pattern?
3. How should I handle the case where a task has variable start times within a combo's feasible window (not fixed)? Today each combo has a fixed start/end, but ideally the optimizer could slide the start time within the feasible range.
4. Performance tuning — any solver parameters I should set beyond `max_time_in_seconds`?
5. How do I add warm-starting with my greedy solution as a hint?
6. What's the best way to structure this for incremental re-optimization when one task changes?

## Install

```bash
dotnet add package Google.OrTools
```

No license key, no API key, no subscription. Completely free (Apache 2.0).
