# Parking Lot

Ideas, features, and improvements that aren't yet assigned to a sprint. Review periodically and promote to sprints as priorities shift.

---

## Solver Ideas

### Thorough Strategy (Tabu Search)
- V2 solver tier after Balanced
- TabuList class preventing recently-visited solutions
- Neighborhood exploration with diversification
- Target: 10-15% improvement over Balanced on complex scenarios
- **Prereqs:** Solver Prompts 1-3 complete

### Best Quality Strategy (ILS / RBRS)
- V3 solver tier
- Iterated Local Search with random perturbation
- Ruin-and-Recreate with adaptive destruction
- Population-based approaches
- **Prereqs:** Thorough strategy complete, significant testing

### Constraint Propagation Improvements
- Arc consistency beyond simple window tightening
- Resource capacity propagation (detect infeasibility earlier)
- Chain-aware propagation (predecessor/successor windows)

### Multi-Objective Optimization
- Pareto frontier instead of single blended score
- Let planner choose trade-off point
- "Show me the schedule that minimizes lateness vs maximizes utilization"

---

## UI Ideas

### Drag-and-Drop on Gantt
- Drag task bars to new time positions
- Drop on different resource row to reassign
- Visual snapping to available windows
- Translates to MoveTo API call
- **Complexity:** High (Gantt interaction, collision detection)

### Resource Comparison View
- Side-by-side view of 2-3 resources
- Compare utilization, task mix, availability
- Useful for deciding where to redirect work (Sprint 4)

### Order Timeline View
- Horizontal timeline per order showing all its tasks in sequence
- Visualize the critical path through an order
- Highlight bottleneck task

### Notification / Alert System
- "Task X is about to breach its due date"
- "Resource Y is at 95% utilization"
- "Material Z will run out before Task W"
- Push notifications or polling-based alerts

### Undo/Redo Stack
- Beyond What-If (Sprint 6) — a full undo/redo for every action
- Stack of snapshots with descriptions
- "Undo: Excluded Order-009" / "Redo"
- **Complexity:** Medium (snapshot per action, stack management)

### Multi-User Awareness
- Show when another planner is viewing/editing the same schedule
- Lock indicators on tasks being edited by others
- Real-time updates via WebSocket
- **Complexity:** High (requires backend WebSocket support)

### Schedule Templates
- Save a schedule configuration (pins, excludes, priorities, capacity adjustments) as a template
- "Apply Monday template" / "Apply rush-order template"
- Useful for recurring scheduling patterns

### Export / Report Generation
- Export Gantt as PDF or image
- Export schedule to Excel
- Automated shift report: "Here's what's scheduled for second shift"
- Email integration for sharing schedules

### Dark/Light Theme Toggle
- Currently dark theme only
- Some planners prefer light theme (factory floor screens)
- Already structured with C (color) constants — swap palette

### Mobile View
- Responsive layout for tablet
- Planner walking the factory floor checking schedule
- Simplified view: task list + status, no full Gantt
- Approve/reject actions via mobile

---

## API / Platform Ideas

### Webhook Notifications
- Fire webhooks on: solve complete, task becomes late, resource overloaded
- Client systems can react to scheduling events

### Scheduling History
- Store every solve result with timestamp
- Compare any two historical solves
- "What changed between Monday's schedule and Tuesday's?"
- Audit trail for regulatory compliance

### Multi-Scenario Management
- Named scenarios: "Baseline", "Rush Order", "Maintenance Window"
- Switch between scenarios
- Compare scenarios side-by-side
- Promote scenario to "active" schedule

### Batch / Async Solve
- Large solve jobs run asynchronously
- Return job ID, poll for completion
- Progress updates via WebSocket or SSE
- Important for large factories (500+ tasks)

### Rate Limiting / Quotas
- Per-tenant API rate limits
- Usage tracking and billing
- Throttle during peak periods

### Data Validation Layer
- Validate incoming data before solve
- "Resource X referenced by Task Y doesn't exist"
- "Task window ends before it starts"
- Return actionable validation errors

---

## Data Model Ideas

### Skill-Based Resource Matching
- Resources have skills (certifications, capabilities)
- Tasks require specific skills
- Solver matches based on skill compatibility
- Example: "This task needs a certified welder"

### Resource Groups / Pools
- Group of interchangeable resources
- Solver picks best available from the pool
- Example: "Any of the 3 CNC machines can do this"

### Sequence-Dependent Setup Times
- Setup time depends on what ran before AND what runs next
- State change matrix already supports this
- Need UI for visualizing and editing the matrix

### Calendar Templates
- Reusable shift patterns: "3-shift rotation", "Mon-Fri 8-5"
- Apply to resources instead of defining availability per resource
- Override specific dates (holidays, planned outage)

---

## Technical Debt

### Single-File Component
- App.tsx is 5,900+ lines
- Consider splitting into modules when a natural seam appears
- Don't force it — wait until it hurts

### Test Coverage
- Engine: 480 tests (good)
- API: 87 tests (adequate)
- UI: 0 tests (needs attention after Sprint 1)
- Add Playwright or Cypress for critical flows

### Performance
- Gantt rendering with 500+ tasks
- Virtual scrolling for task table
- Debounce filter inputs
- Memoize expensive computations (useMemo already used in places)

### Accessibility
- Keyboard navigation for task selection
- Screen reader support for Gantt
- ARIA labels on interactive elements
- Color-blind safe palette option

---

## Review Log

| Date | Action | Notes |
|------|--------|-------|
| _TBD_ | _Initial review_ | _Promote items as sprints complete_ |
