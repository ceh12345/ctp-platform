# CTP Manufacturing Demo Script

**Audience:** Prospective manufacturing client (production planner, operations manager, VP of operations)  
**Tenant:** Willoughby Manufacturing (demo-manufacturing)  
**Duration:** 30-45 minutes  
**Setup:** App running on localhost or Azure, manufacturing tenant loaded, schedule solved

---

## Before the Demo

1. Load the manufacturing tenant: `?tenant=demo-manufacturing`
2. Click Solve to ensure a fresh schedule
3. Note the starting metrics (feasibility rate, utilization, scheduled count)
4. Have the AI chat panel closed — you'll open it mid-demo for dramatic effect

---

## Act 1: "Here's Your Schedule" (5 min)

**Story:** It's Monday morning. The planner opens the dashboard.

### Show the Gantt
- Point out the resource rows (CNC machines, assembly stations, QC cells)
- Zoom in (3 hours) to show detail, zoom out (week) to show the full picture
- Click a task bar — show the detail panel (task name, order, resource, scheduled time, duration)
- Point out color coding by order or process category

**Say:** "This is your floor. Every bar is a job assigned to a machine with a specific start and end time. The solver placed all of these in under 2 seconds."

### Show the Analytics Tab
- Click Analytics — show utilization KPIs
- Point out the bottleneck resource (highest utilization)
- Point out the underutilized resource
- Show the feasibility rate: "96% — 2 tasks couldn't fit"

**Say:** "Before you've had your coffee, you know exactly where the problems are."

### Show the Conflicts Tab
- Click Conflicts — show the infeasible tasks
- Click one — show the bottleneck report: which resource is blocked, by whom
- "CNC-01 is at 97% — that's why this task couldn't fit. Here's exactly who's blocking it."

**Say:** "No more guessing. The system tells you WHY something didn't schedule and which resource to fix."

---

## Act 2: "Machine Breakdown" (5 min)

**Story:** CNC-01 just went down. Maintenance says it's out for the day.

### Redirect Work
1. Filter task table by Resource → CNC-01
2. "See these 5 tasks on CNC-01? Let's move them."
3. Select all 5 tasks (checkboxes)
4. Click "Set Resource Preference"
5. Show the dialog: CNC-01 → EXCLUDED, CNC-02 → PREFERRED
6. Click "Apply & Solve"
7. Show the result: 4 tasks moved to CNC-02, 1 to CNC-03

**Say:** "60 seconds. Machine goes down, work is redistributed, floor operators get updated assignments. No phone calls, no spreadsheets, no guessing."

### Show the Gantt After
- CNC-01 is now empty
- CNC-02 and CNC-03 have the redistributed work
- Point out that existing tasks on CNC-02 weren't disrupted — the solver fit the new work around them

---

## Act 3: "Rush Order" (5 min)

**Story:** Sales calls. Customer ABC's order is now critical — they need it by Friday or they lose the contract.

### Rush and Re-Solve
1. Filter by Order → find the order (e.g., WO-1004)
2. "This order has 4 tasks, currently scheduled for next week."
3. Select all 4 tasks
4. Click 🔥 Rush
5. Show the RUSH badges appearing
6. Click Solve
7. Show the result: WO-1004 jumps to this week, lower-priority tasks slide later

**Say:** "The customer is still on the phone. You just told them 'Wednesday.' That's a promise you can keep because the solver verified it against real capacity."

### Check the Impact
- Show that the bumped tasks are still within their windows
- If any went infeasible, show the conflict — "This is the trade-off. WO-1006 slipped to next week to make room for the rush."

---

## Act 4: "Ask the AI" (10 min) ⭐

**Story:** The planner wants to understand why something scheduled where it did, and whether they can fit a new order.

### Open the AI Chat
- Click the AI chat icon to open the panel
- "Let me show you something different. Instead of clicking through menus, I'll just ask."

### Investigation
Type: **"Why is WO-1004 scheduled on Wednesday instead of Tuesday?"**

- AI calls investigation tools behind the scenes
- Returns: "WO-1004's milling operation needs CNC-02, which is occupied Tuesday morning by WO-1001. The earliest CNC-02 has a 2-hour window is Wednesday 7:00 AM."
- **Say:** "The AI just checked every resource, every time window, and explained it in plain English. No clicking, no digging."

Type: **"What's the bottleneck this week?"**

- AI checks analytics, returns utilization breakdown
- "CNC-02 is at 94% utilization this week. It's the tightest resource. Assembly Station 1 is the least utilized at 42%."

Type: **"Which machines are free Thursday afternoon?"**

- AI calls find_available_resources
- Returns list of machines with available windows on Thursday PM

### CTP Query via AI ⭐⭐
Type: **"Can I fit a new machining job like WO-1001 for customer XYZ?"**

- AI identifies WO-1001's chain structure, calls evaluate_new_order
- Returns: "I found 3 options for XYZ Machining Job: Option 1 — Thursday 10:00 AM on CNC-03 (Setup → Mill → QC). Option 2 — Friday 7:00 AM on CNC-04. Option 3 — Monday next week on CNC-02."
- **Action buttons appear:** [Book Option 1] [Book Option 2] [Book Option 3]

**Say:** "This is Capable to Promise. The customer asks 'when can I have it?' You ask the AI, it evaluates against your REAL capacity — not a guess, not a spreadsheet — and gives you options in 3 seconds. Click Book and it's on the schedule."

### Book It
- Click "Book Option 1"
- Confirm in the dialog
- Show the new order appearing on the Gantt

**Say:** "That just went from 'customer request' to 'scheduled on the floor' in under 30 seconds. That's the power of CTP."

---

## Act 5: "Investigate and Fix" (5 min)

**Story:** There's still an infeasible task from the morning. Let's resolve it.

### WhereTo
1. Click the infeasible task
2. Right-click → "Where Can This Go?"
3. Ghost bars appear on the Gantt showing feasible options
4. "Three options. CNC-03 tomorrow at 2 PM is the best score."
5. Click the ghost bar → task moves

**Say:** "Right-click, see your options, click to place. The solver shows you exactly what's possible."

### Resource Agenda
1. Right-click a busy resource (CNC-02)
2. Click "View Agenda"
3. Show the slide-over: assignments, gaps, off-shift

**Say:** "Instant visibility into any resource. You can see exactly why CNC-02 is the bottleneck — it's booked solid from 7 AM to 5 PM with only a 30-minute gap at lunch."

---

## Act 6: "Lock It Down" (3 min)

**Story:** End of day. Lock today and tomorrow so the floor is stable.

### Pin the Floor
1. Filter by time → Today and Tomorrow
2. Filter by status → Scheduled
3. Select all
4. Click 📌 Pin
5. "These 14 tasks are now locked. The next solve will only optimize Wednesday through Friday."

**Say:** "Floor stability. Your operators trust the schedule because it doesn't change under their feet."

---

## Act 7: "Strategy Comparison" (3 min)

**Story:** Before leaving, try the Balanced strategy to see if the schedule improves.

### Switch Strategy
1. Note current metrics: 96% feasibility, 72% utilization
2. Switch from Quick to Balanced in the solver dropdown
3. Solve — takes 3 seconds instead of <1
4. Show improved metrics: 100% feasibility, 75% utilization
5. "The Balanced strategy found a better arrangement by moving one task to reduce a changeover."

**Say:** "Quick gives you instant answers. Balanced gives you better answers. Best Quality uses mathematical optimization for the globally best schedule. You choose based on how much time you have."

---

## Act 8: "Solve Replay" (2 min, optional)

**Story:** How did the solver build this schedule?

### Replay
1. Open the Solve Replay panel above the Gantt
2. Play — watch tasks get placed one by one with flash animations
3. Pause at an interesting moment
4. "You can see the solver placed the Rush order first (priority 1), then worked down. This task got bumped from CNC-01 to CNC-03 because of the machine breakdown redirect."

**Say:** "Full transparency. You can watch every decision the solver made and understand why your schedule looks the way it does."

---

## Closing (2 min)

### Recap the Story
"In 30 minutes, you saw a planner handle a full day of disruptions:

1. **Reviewed** the schedule and spotted bottlenecks in seconds
2. **Handled a machine breakdown** — work redistributed in 60 seconds
3. **Rushed an order** — customer got a promise while still on the phone
4. **Asked the AI** why things scheduled where they did — got answers in plain English
5. **Ran a CTP query** — 'can I fit this new job?' — with bookable options in 3 seconds
6. **Fixed a conflict** — right-click, see options, click to place
7. **Locked the floor** — stable schedule operators can trust
8. **Compared strategies** — Quick for speed, Balanced for quality

All against real capacity, real constraints, real resource availability. No spreadsheets. No guessing."

### The Ask
"What does a typical day look like for your planner? I'd love to load YOUR data and show you what CTP does with it."

---

## Demo Tips

- **Don't explain features. Tell stories.** "CNC-01 just went down" is more compelling than "let me show you the resource preference override dialog."
- **Let the AI chat be the wow moment.** Save it for Act 4. The natural language interaction is what separates CTP from every other scheduling tool.
- **Use the CTP query as the closer for Act 4.** "Can I fit this?" → options in 3 seconds → Book it → on the schedule. That's the product in one interaction.
- **Watch their eyes during the bottleneck report.** If they lean in, that's their pain point. Spend more time there.
- **If they ask about their specific scenario,** say "let's try it" and use the AI chat to explore it live. The AI handles edge cases gracefully.
- **Don't show Solve Replay unless they're technical.** It's impressive for engineers and IT, but planners just want the result.
