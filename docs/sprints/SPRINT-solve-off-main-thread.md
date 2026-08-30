# Sprint — Move the Solve Off the Main Thread

**Status:** design captured 2026-08-30, no code beyond the interim below.
**Est:** ~1 day for the recommended option.

## The problem

The engine solve is synchronous CPU work on Node's single thread. It never yields,
so for its entire duration the API cannot serve **any** request — not the UI, not
other tenants, not `/v1/health`, not even static assets.

This is not a timeout problem or a slow-solve problem. It is an availability
problem: while one person rebuilds the schedule, the site is down for everyone.

## Evidence

Measured directly (`test-blocking.mjs`, local, stafford-all, 1,660 tasks): start a
solve, then poll `/v1/health` every 2s and time each response.

```
[ 0.0s] starting solve
[53.6s] solve responded
[53.6s] poll  1 -> 200 after 51.6s wait     <- queued the whole solve
[55.6s] poll  2 -> 200 after 0.0s wait      <- instant once solving stops
[57.6s] poll  3 -> 200 after 0.0s wait
```

The cheapest endpoint in the app waited **51.6 seconds**. Every poll after the
solve finished returned in 0.0s.

On Azure the same behaviour, at the tier's speed:

| Environment | Solve / blackout | Notes |
|---|---|---|
| Local dev box | ~50–55s | 11.7 GB RAM |
| Azure, small tier | **~400s** | site fully deaf, incl. `index.html` |
| Azure, scaled up | **73s** | 5.5× faster; blackout still total, just shorter |

During an Azure solve, `GET /` returned nothing — confirmed repeatedly while
diagnosing. The container was **not** recycled (`uptime` kept climbing), and the
solve completed correctly: 1,660 of 1,660 scheduled, 0 unscheduled, 0 infeasible.

## Correction: there is no observed 230s cut

Azure App Service documents a ~230s idle-request timeout, and this was assumed
during diagnosis. **It was not observed.** A 400-second solve request on the small
tier completed intact and returned its result normally. Whatever the documented
limit, it did not fire here. Do not plan around it without re-measuring.

## What shipped in the meantime

`98f3e1f` — `solveWithRecovery()` in `App.tsx`. Notes the snapshot id before
solving; if the HTTP request dies it watches for a new snapshot with
`eventType: 'solve'`, then fetches `GET /ctp/results` (same object the POST would
have returned). Wired into all three solve paths.

Useful insurance, but **not** the fix — and now rarely exercised, since requests
are surviving. It deliberately carries no progress heartbeat: nothing can observe
progress while the event loop is blocked, so a countdown would either never appear
or appear only after the fact.

Note this also rules out the obvious "make solve a job" design on its own: a
`202 + jobId + poll` API fails identically, because the **status endpoint is just
as blocked** as everything else.

## Options

| Option | Effort | Effect |
|---|---|---|
| Do nothing | — | Acceptable only if solves are rare and single-user |
| Scale up | £ per month | Shortens the blackout (400s → 73s); does not remove it |
| Scale up only while solving | ~hours + ops risk | Same, billed per minute; fails badly if scale-down doesn't run |
| Narrow the solve (shorter horizon / subset) | varies | Scales ~linearly with task count |
| **Second process** | **~1 day** | Site stays responsive; recommended |
| Worker thread | 2–4 days | Same benefit, single process, less memory |
| Yield inside the engine loop | unknown | Invasive; slows the solve. Not recommended |

## Recommended: a second process of the same app

The blocker is not the CPU model — it is that `solve()` is bound to in-memory
state through Nest DI (`ensureLandscape()`, `configService`, `stateService`) and
mutates a live object graph of linked lists and Luxon dates. That graph is not
structured-cloneable, so a worker thread would first need a standalone hydration
path outside DI. That is the 2–4 day version.

Sidestep it by running **a second instance of the same image** as a solver:

1. Main API receives the solve, forwards it to the solver instance, returns `202 + jobId`
2. Solver blocks its own event loop, solves, writes the snapshot
3. Main API stays responsive throughout — health probes pass, UI loads, polling works
4. On completion the main API reloads from the snapshot

Almost no new code: the solver is the same image on a different port, and the
snapshot reload path already exists and is covered by
`reconstruct-on-load.e2e.test.ts`. Drops cleanly into the Docker delivery as a
second compose service sharing the config volume.

**On a small box this does not make the solve faster** — 400s stays 400s. It
converts "unavailable for 6–7 minutes" into "slower than usual while a background
solve runs," which is the difference between an outage and a delay.

Costs: two copies of the landscape in memory (matters on a 1.75 GB instance), and
one more moving part in the install guide.

## Why this matters for the client deployment

The Docker bundle lands on Stafford's own hardware, which will not be a scaled
Azure tier and cannot be scaled on demand. If their box performs like the small
tier, every schedule rebuild takes the system down for 6–7 minutes with no
recourse. That argues for doing this **before** the client deployment rather than
after.

## Open questions

- Is 400s representative of the small tier, or was that run slowed by a
  concurrent cold tenant load? Only measured once.
- How often does the planner actually rebuild? If it is a few times a day, the
  cheapest correct answer may be to do nothing.
- Does the extra capacity on the scaled tier come from faster cores or more of
  them? The solve is single-threaded, so only clock speed helps it — though more
  cores would help the main process once the solve moves off-thread.

## References

- `98f3e1f` — interim UI recovery
- `packages/api/src/modules/ctp/ctp.service.ts:191` — `solve()`
- `packages/engine/Snapshot/overlay.ts:216` — `serializeOverlay`
- `packages/engine/Snapshot/reconstruct.ts:108` — `reconstructOverlay`
- `packages/api/src/modules/ctp/optimize.controller.ts` — existing async job pattern (202 + jobId + poll)
