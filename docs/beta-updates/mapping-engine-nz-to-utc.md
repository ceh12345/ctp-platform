# Mapping Engine — NZ dates normalized to UTC

**Closed:** 2026-04-17
**Partner:** Stafford Engineering (beta)
**Commit:** `b2114b6` (see `sprint-mapping-engine-touc.md` for the technical spec)

---

## What this means for our beta partnership

Stafford's Genius API returns every date with a literal New Zealand offset — `2026-03-21T01:00:00+13:00` during NZDT (summer), `+12:00` during NZST (winter). Up until now, those dates flowed through our integration unchanged, and downstream code did ad-hoc parsing every time it needed to compare or display them. It worked, but quietly risked silent off-by-13-hour errors if we ever ran the platform in a non-NZ timezone, or if Genius ever sent us a bare date without the offset tag.

This sprint fixes that at the edge: when we pull data from Genius (or the mock), every date field gets normalized to a canonical UTC format (`2026-03-20T12:00:00Z`) at the boundary. Everything downstream — scheduler, UI, API responses, logs — sees one consistent format regardless of where the server runs.

The upshot: **time-of-day bugs become impossible for the categories we've just closed.** The beta is more stable, and demo behavior is reproducible across developer laptops, CI environments, and Stafford's dev servers.

## What we built

**An opt-in `toUTC` flag** on the mapping profile. For any date field coming from Genius (delivery dates on orders, start/end times on tasks, actual-start timestamps for work in progress), we add a single `"toUTC": true` annotation and the integration layer handles the rest.

**Smart parsing** — uses the IANA timezone database (via the luxon library, which we already depend on for the engine). Four behaviors, all safe:

| Input | Result |
|---|---|
| `"2026-03-21T01:00:00+13:00"` (NZDT offset) | `"2026-03-20T12:00:00Z"` |
| `"2026-07-10T09:00:00+12:00"` (NZST offset) | `"2026-07-09T21:00:00Z"` |
| `"2026-03-21T01:00:00"` + `"fromTimezone": "Pacific/Auckland"` config | `"2026-03-20T12:00:00Z"` |
| `"2026-03-21T01:00:00"` with no timezone hint | **passes through unchanged** — never silently assumes a zone |
| `"not-a-date"` or other unparseable junk | passes through unchanged, no exception |
| missing / null date | field is absent from output (standard behavior) |

**Daylight saving transitions are handled correctly.** A date on either side of the April NZST→NZDT boundary (and September NZDT→NZST) picks up the right offset automatically because luxon reads the IANA zone database.

**Stafford profile updated.** Five date fields in `stafford-engineering-test/integration/mapping.json` now carry `"toUTC": true` — `DeliveryDate`, `LateDeliveryDate`, `ActualStartDate`, `TaskStartDate`, `TaskEndDate`.

## What we tested

**10 new automated tests** exercising every row of the table above, plus a dedicated test for the NZDT/NZST transition boundary (two dates on either side of the September transition — luxon picks the correct offset for each).

**Live end-to-end verification.** We ran the full integration path against the running mock server — `POST /v1/state/sync`, then `POST /v1/ctp/solve-and-sync` — and confirmed the response body has **zero `+12:00` or `+13:00` offsets anywhere.** Orders' `dueDate` and `lateDueDate` land as clean `Z`-suffixed UTC strings.

**Full platform suite.** 971 tests pass across 53 files (up from 961 before this sprint). No regressions in the non-REST tenants (acme, healthcare, manufacturing, etc.) — their file-adapter profiles don't opt into `toUTC`, so their date handling is unchanged.

## What this unlocks for beta iteration

- **Server location doesn't matter.** The platform now behaves identically whether the API is running on the developer's laptop, in a Windows datacenter, or on Stafford's Linux dev server. No hidden dependency on the host timezone.
- **Demos are timezone-stable.** What you see in a demo at 09:00 NZDT is what you see at 09:00 NZST six months later — dates don't drift by an hour at DST boundaries.
- **Logs and diagnostics are consistent.** A stacktrace, a solve result, and a log line all quote dates in the same format.
- **Adding other beta partners in different timezones is a config change, not a code change.** An Australian or European partner just sets their own `fromTimezone` in the mapping profile; no new development.

Still beta-grade — we haven't hardened against every imaginable malformed-date case Stafford might send us — but the common path and the categories we've tested are solid.

---

*This document is a frozen snapshot of the sprint's outcome. The live technical spec is `docs/sprints/sprint-mapping-engine-touc.md`.*
