# Scoring Rules

When the engine finds multiple feasible slots for a task, it needs to decide which one is best. Scoring rules evaluate each option and the engine picks the highest-ranked one.

## How scoring works

Each scoring rule produces a score for a scheduling option. Rules have:
- **Name** — What it measures
- **Weight** — How important it is (higher = more influence)
- **Objective** — Whether to minimize or maximize the score

The engine computes a **blended score** by combining all rule scores with their weights. The option with the best blended score wins.

## Available scoring rules

### EarliestStartTimeScoringRule
**Objective:** Minimize
**What it does:** Prefers options that start sooner. The earlier a task starts, the lower the score (better).

**Use when:** You want to complete work as fast as possible — rush orders, urgent cases, "pack early" strategies.

### LatestStartTimeScoringRule
**Objective:** Minimize
**What it does:** Prefers options that start later (closer to the due date). Avoids scheduling work too early.

**Use when:** You want just-in-time scheduling — don't tie up resources until needed, leave room for higher-priority work that might arrive.

### ResourceUtilizationScoringRule
**Objective:** Maximize
**What it does:** Prefers options that balance load across resources. Penalizes putting more work on an already-busy resource.

**Use when:** You want even utilization — avoid overloading one resource while others sit idle.

### ChangeoverScoringRule
**Objective:** Minimize
**What it does:** Prefers options that minimize changeover/setup time. If a resource just finished the same type of work, there's no setup needed — that option scores better.

**Use when:** Changeover time is significant. Switching between product types costs time you want to minimize.

### FlexibilityScoringRule
**Objective:** Maximize
**What it does:** Prefers options that leave the most flexibility for future tasks. Looks ahead at what other tasks need the same resources and avoids blocking them.

**Use when:** You have a mix of constrained and flexible tasks. Schedule the flexible ones in ways that don't box in the constrained ones.

## Configuring weights

Weights control the trade-off between competing objectives. There's no single right answer — it depends on your priorities.

**Example: "Get everything done ASAP"**
```
EarliestStartTime: weight 1.0
ResourceUtilization: weight 0.3
Changeover: weight 0.2
```

**Example: "Minimize changeovers, balance load"**
```
EarliestStartTime: weight 0.3
ResourceUtilization: weight 0.8
Changeover: weight 1.0
```

**Example: "Just-in-time, don't schedule early"**
```
LatestStartTime: weight 1.0
ResourceUtilization: weight 0.5
```

## Tips

- Start with the defaults and adjust based on what you see in the results
- If the schedule looks too "front-loaded" (everything crammed early), increase LatestStartTime weight or decrease EarliestStartTime
- If one resource is overloaded while others are idle, increase ResourceUtilization weight
- If changeover time is killing your throughput, increase Changeover weight
- You can see the score breakdown per task in the detailed/expert view to understand why the engine made each choice
