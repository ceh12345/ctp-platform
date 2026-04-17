# Phase 2 — Mock-Genius Failure Injection

**Phase closed:** 2026-04-17
**Partner:** Stafford Engineering (beta)
**Commits:** pending (see `sprint-mock-genius-server.md` for the technical spec)

---

## What this means for our beta partnership

During beta, we need to iterate quickly on how the CTP platform talks to Stafford's Genius API. Phase 2 gave us a local "stunt double" for Genius that we can poke at any time — including making it misbehave in specific ways — without needing VPN access, without bothering Stafford's team, and without waiting for the real system to happen to produce the error we want to see.

The upshot: **we can work productively on the integration offline, and we can demonstrate behavior to Stafford with repeatable scenarios instead of "trust us, we tested it."**

## What we built

**A controllable Genius simulator.** The mock server already returned a realistic Genius response shape; Phase 2 lets us dial up misbehavior on demand:

- Server errors, auth rejections, rate limits, hangs, delays
- Corrupted or partial responses
- Data in the wrong format
- Multi-page responses (pagination)

All controllable through simple API calls — no restart, no code change. Useful for: (a) demos with Stafford where we show "here's what happens when X goes wrong," (b) quick iteration when we discover a new edge case in their real data, (c) reproducible bug reports.

**Six realistic edge-case datasets** shaped like Stafford's data with specific problems embedded — missing fields, malformed dates, circular job dependencies, tasks pointing to machines that don't exist, paginated result sets. These are the kinds of shapes we expect to encounter once we're pulling from real Stafford dev data.

## What we tested — 30 automated tests, all passing

**22 tests prove the simulator itself works correctly** — scenario switching, every failure type, pagination, state inspection, reset behavior, endpoint-specific vs. global failures.

**8 tests prove our integration code handles each problem cleanly when talking to the simulator.** These matter most because they exercise the real HTTP path end-to-end (network, JSON parsing, retry logic, error messages) rather than just unit-testing pieces in isolation:

| Scenario | What it confirms |
|---|---|
| Happy path | Full Stafford-shaped dataset flows through end-to-end |
| Empty response | "No data today" handled correctly |
| Intermittent server error | We retry once and succeed — no manual intervention |
| Auth rejection | We fail in <1s with a clear "HTTP 401" message — not 6s of retry spam |
| Corrupted JSON | We produce a readable error naming the endpoint |
| Unexpected response shape | We fall back gracefully without crashing |
| Multi-page response | We loop through all pages and stitch them together |
| Partial payload | We faithfully report what we got |

## What this unlocks for beta iteration

- **Nobody has to be on the VPN to make progress.** Developer laptops, CI, demos — all work against the simulator.
- **When Stafford's real data surfaces a new edge case**, we can capture that shape as a new fixture file (a matter of minutes) and iterate against it repeatedly.
- **The behavior is observable and reproducible** — every scenario is a checked-in file, every simulated failure is a controllable API call.
- **Beta confidence:** when we deploy to Stafford's dev servers, we've already seen the integration survive the likely misbehaviors; we can focus the conversation on real data shape drift rather than re-discovering basic failure modes.

Everything in Phase 2 is still development-grade — we're a beta partner iterating together, not hardening for production launch.

---

*This document is a frozen snapshot of Phase 2's outcome. The live technical spec is `docs/sprints/sprint-mock-genius-server.md` and may evolve as Phase 3 work lands.*
