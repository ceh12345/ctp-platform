# Solver Strategies

The solver offers four strategies that trade speed for schedule quality. Choose based on your situation.

## ⚡ Quick (< 1 second)

**What it does:** Single forward pass through all tasks. For each task, finds the best available slot and assigns it. No retries, no backtracking.

**Best for:**
- CTP queries ("can I deliver by Friday?")
- Real-time slot finding
- Simple schedules with few conflicts
- Getting a fast baseline

**Limitations:** If a task can't be placed, it's marked infeasible immediately. It won't try to rearrange other tasks to make room.

## 🎯 Balanced (1-5 seconds) — Recommended Default

**What it does:** Same forward pass as Quick, but when a task can't be placed, it **backtracks** — it identifies the task blocking the way, temporarily removes it, places the current task, then tries to re-place the removed task elsewhere.

**Best for:**
- Daily scheduling
- Most production scenarios
- When you need good results without waiting

**How backtracking works:**
1. Task B can't be placed — Resource R is fully booked
2. The solver finds the lowest-priority task on Resource R that overlaps B's window
3. That task is temporarily unscheduled ("bumped")
4. Task B is placed in the freed slot
5. The bumped task is rescheduled elsewhere
6. If it can't be rescheduled, the trade-off is recorded

The solver tries up to 3 bumps per infeasible task before giving up.

## 🔬 Thorough (10-30 seconds)

**What it does:** Builds on Balanced by adding **memory**. After the initial schedule, it iteratively improves by moving the worst-scored tasks to better alternatives — but remembers which moves it already tried so it doesn't cycle.

**Best for:**
- Complex environments with many changeovers
- Tight capacity where small improvements matter
- When Balanced produces too many infeasibilities

**How it works:**
1. Run Balanced to get an initial schedule
2. Find the 3 worst-scored tasks
3. For each, try alternative placements (ranked by score)
4. If a move improves the overall schedule, keep it
5. Add the old placement to a "don't go back" list
6. Repeat for up to 50 iterations or 30 seconds

This approach (called Tabu Search) systematically explores alternatives without wasting time revisiting dead ends.

## 🏆 Best Quality (30-60 seconds)

**What it does:** Runs multiple complete scheduling passes with deliberate variation, keeping the best overall result.

**Best for:**
- Weekly planning
- What-if scenario analysis
- When schedule quality matters more than speed
- Presentations and demos

**How it works:**
For larger problems (>100 tasks): Solve → shake up 20% of the schedule → re-solve → keep the best. Repeat multiple times.

For smaller problems (<100 tasks): Run many quick solves with weighted randomness (instead of always picking the best option, sometimes pick the 2nd or 3rd best). Keep the best overall result.

## Choosing a strategy

| Situation | Strategy |
|-----------|----------|
| "Just show me what's possible" | Quick |
| "Build today's schedule" | Balanced |
| "We have changeover problems" | Thorough |
| "Find the best possible schedule for the week" | Best Quality |
| "Can I fit one more case on Thursday?" | Quick |
| "Optimize the entire OR block" | Best Quality |

## Solver results

After every solve, you'll see:
- **Strategy used** and how long it took
- **Tasks placed** vs. infeasible
- **Iterations** (for Thorough/Best — how many improvement rounds)
- **Backtracks** (for Balanced+ — how many times it bumped a task)
- **Score** — Overall schedule quality metric (lower is better for most objectives)

The Analytics page gives you the full picture of schedule quality after any strategy.
