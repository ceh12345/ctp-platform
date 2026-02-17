# Utilization

Utilization measures how much of a resource's available time is actually being used.

## How it's calculated

```
Utilization = Assigned Time / Available Time × 100
```

- **Available Time** — The total time a resource is open for work (based on its calendar/shift schedule)
- **Assigned Time** — The total time tasks are scheduled on that resource

A resource available 8 hours/day with 6 hours of scheduled work has 75% utilization.

## Reading the utilization view

Click any utilization KPI in the left panel to see the detail:

**Group average** — The average utilization across all resources in that group (e.g., all Operating Rooms, all CNC machines).

**Per-resource bars** — Horizontal stacked bars for each individual resource:
- Green section = time with assigned work
- Light grey = available but no work assigned (idle capacity)
- Dark grey = unavailable (outside calendar hours, maintenance, holidays)

**Daily breakdown** — Click a resource to see its utilization day by day. Helps identify specific days that are overloaded vs. underutilized.

## What the numbers mean

| Utilization | What it means | Action |
|-------------|---------------|--------|
| > 90% | Near capacity — almost no room for new work | This is likely your bottleneck. Adding work here risks infeasibility. |
| 70-90% | Healthy utilization — well-loaded with some buffer | Good target range. Room for disruptions. |
| 50-70% | Moderate — has significant available capacity | Can absorb more work. Consider redirecting tasks here. |
| < 50% | Underutilized — lots of idle time | Either low demand or tasks are being routed elsewhere. |

## Bottleneck identification

The system automatically identifies the bottleneck — the resource with the highest utilization. This is shown in the analytics summary.

A bottleneck resource constrains your entire schedule. If the anesthesiologist is at 91% and everything else is at 65%, adding more operating rooms won't help — you need more anesthesiologist availability.

## Tips

- **Compare across groups** — If surgeons are at 58% but anesthesiologists are at 85%, the constraint isn't the surgeons
- **Check daily patterns** — A resource might average 70% but spike to 95% on Tuesdays. That Tuesday spike is your real bottleneck
- **Utilization ≠ productivity** — A resource can be 90% utilized but spending 30% of that on changeovers/setup. The turnover metrics in Scheduling KPIs tell you that story
