# Sprint: MappingEngine `toUTC` — NZ timezone → UTC for Stafford dates

**Status:** 📋 Ready
**Size:** ~1 hr CC work (single session: spec-first TDD, then impl, then verify)
**Depends on:** Data Adapter Phase 2 (commit `e6d9fb9`) — MappingEngine plumbing + rule dispatcher.
**Triggered by:** Mock-genius hardening queue item #2. The `toUTC` transform is marked as a TODO stub in `mapping-engine.ts` (`// TODO Phase 3: toUTC — convert NZ local time to UTC`). It's the one mapping gap that Stafford's real data hits on every record (every `DeliveryDate`, `TaskStartDate`, `TaskEndDate` comes through with a `+13:00`/`+12:00` NZDT/NZST offset). Until this lands, dates flow through the adapter as strings with offsets and downstream engine code has to re-parse them. This sprint closes the stub.

---

## Problem

Stafford's Genius API returns every date with a literal New Zealand offset:

```json
"DeliveryDate":     "2026-03-21T01:00:00+13:00",
"TaskStartDate":    "2026-03-16T09:00:00+13:00",
"LateDeliveryDate": "2026-03-23T01:00:00+13:00"
```

The current MappingEngine passes these through unchanged. Downstream CTP code uses UTC internally (landscape horizons, scheduled intervals, state change timestamps). Today this works by accident — `new Date("...+13:00")` parses correctly — but it leaves the engine to do timezone reconciliation every time it reads a mapped field, which is brittle:

- **Bare ISO strings without offsets** (some Genius endpoints return `"2026-03-21T01:00:00"` with no zone) are interpreted as **server-local time** by `new Date()`, producing silent off-by-13-hours errors on non-NZ deployments.
- **NZDT↔NZST transitions** (Apr and Sept in NZ) are handled correctly by ISO offsets only if Genius is emitting the correct offset at the moment of serialization. If it's not, the wall-clock looks right and the UTC conversion is wrong.
- **Downstream tests and diagnostics** that show dates to the user see `"2026-03-21T01:00:00+13:00"` strings mixed with engine-produced `"2026-03-21T00:00:00.000Z"` strings — inconsistent.

The fix is to normalize all date fields to UTC `Z`-suffixed ISO strings at the mapping boundary, so everything downstream sees a single canonical format.

## Non-problem (do not change)

- **Engine internals already use UTC.** No changes to `SchedulingLandscape`, `CTPDateTime`, or any scheduler code.
- **The `toUTC` applies only when explicitly opted in via the mapping profile.** Profiles for file-adapter tenants (acme-outpatient, demo-sandbox, healthcare, etc.) keep passing dates through unchanged — we do not touch their mapping rules.
- **Per-field error policy (`onError: "strict" | "skip" | "default"`)** — deferred. An unparseable date currently passes through as a raw string; this sprint keeps that fallback behavior.
- **NZDT↔NZST transition logic** — luxon handles this via the IANA zone database. No custom logic needed.

## Design

### Core principle

Opt-in per-field via a boolean flag on the mapping rule. The rule's `fromTimezone` is optional; if absent, the parser relies on the value's embedded offset. If the value has no offset AND no `fromTimezone` is configured, the rule passes through unchanged — making the transform always safe to add to a mapping profile even when source data is heterogeneous.

### Rule shape

```jsonc
// With explicit IANA zone (for dates that arrive without offsets):
{ "from": "DeliveryDate", "toUTC": true, "fromTimezone": "Pacific/Auckland" }

// Offset-only (Stafford's actual shape — value already has +13:00/+12:00):
{ "from": "DeliveryDate", "toUTC": true }
```

### Parsing rules

| Input shape | Parsing | Output |
|---|---|---|
| `"2026-03-21T01:00:00+13:00"` (offset present) | Parse; offset is authoritative | `"2026-03-20T12:00:00.000Z"` |
| `"2026-10-05T02:00:00+12:00"` (NZST offset) | Parse; offset is authoritative | `"2026-10-04T14:00:00.000Z"` |
| `"2026-03-21T01:00:00"` (bare) + `fromTimezone: "Pacific/Auckland"` | Interpret in IANA zone, correctly handling NZDT/NZST at that instant | `"2026-03-20T12:00:00.000Z"` |
| `"2026-03-21T01:00:00"` (bare) + no `fromTimezone` | **Pass through unchanged** | `"2026-03-21T01:00:00"` |
| `"not-a-date"` | `DateTime.fromISO().isValid === false` → pass through | `"not-a-date"` |
| `null` / `undefined` | Standard rule chain — applyMappings skips the field | not written to output |

### Library choice

**Luxon.** Already a dependency of `@ctp/engine`. Needs to be added to `packages/api`'s direct deps so TypeScript resolves types cleanly (it's available at runtime via transitive deps either way, but explicit is better). `luxon.DateTime.fromISO(value, { zone })` handles everything above with zero custom logic.

## Deliverables

### 1. Luxon in API deps (`packages/api/package.json`)

```
"dependencies": {
  ...,
  "luxon": "^3.4.0"
},
"devDependencies": {
  ...,
  "@types/luxon": "^3.4.0"
}
```

### 2. `toUTC` rule in `applyRule()` (`mapping-engine.ts`)

Replace the current stub comment with a real implementation. Placed after the existing `lookup` and `factor` branches so direct field access still wins for most rules.

```ts
if (rule.toUTC && val !== undefined && val !== null && val !== '') {
  const dt = DateTime.fromISO(String(val), {
    zone: rule.fromTimezone ?? undefined,  // if no zone, rely on embedded offset
  });
  if (!dt.isValid) return val;             // unparseable → pass through
  // If input had no offset AND no fromTimezone, fromISO defaults to local
  // system zone — not what we want. Detect by re-serializing and checking.
  if (!rule.fromTimezone && !/[Z+\-]\d{2}:?\d{2}$|Z$/.test(String(val))) {
    return val;  // bare date without timezone hint — pass through
  }
  return dt.toUTC().toISO();
}
```

### 3. Test coverage (`mapping-engine.spec.ts`)

Six new scenarios exercising each row of the parsing-rules table above.

## Testing Scenarios

Additions to the existing `MappingEngine` describe block:

| # | Scenario | Expected |
|---|---|---|
| 1 | NZDT offset (+13:00) | `"2026-03-21T01:00:00+13:00"` → `"2026-03-20T12:00:00.000Z"` |
| 2 | NZST offset (+12:00) | `"2026-07-10T09:00:00+12:00"` → `"2026-07-09T21:00:00.000Z"` |
| 3 | Bare date + `fromTimezone: "Pacific/Auckland"` | `"2026-03-21T01:00:00"` → `"2026-03-20T12:00:00.000Z"` |
| 4 | Bare date + `fromTimezone` on NZST day | `"2026-07-10T09:00:00"` → `"2026-07-09T21:00:00.000Z"` |
| 5 | Bare date, no `fromTimezone` | passes through unchanged (no silent local-time interpretation) |
| 6 | Unparseable date (`"not-a-date"`) | passes through unchanged |
| 7 | `null` input | rule returns undefined, field absent from output |
| 8 | `""` (empty string) | passes through as `""` (applyMappings still writes it because `''` is falsy-but-defined) — or is skipped; test locks in the chosen behavior |
| 9 | NZDT/NZST transition boundary | Two dates, one side of the Apr transition, one side of Sept — luxon's IANA zone produces the correct offset for each |

**Invariant locked in by the tests:** for Stafford's actual data shape (ISO with offset), every date field ends up as a UTC `Z` ISO string.

## Files Changed

| File | Change |
|------|--------|
| `packages/api/package.json` | **MODIFIED** — add `luxon` + `@types/luxon` to deps. |
| `packages/api/src/modules/integration/mapping-engine.ts` | **MODIFIED** — replace the TODO stub in `applyRule()` with a real `toUTC` implementation using `DateTime.fromISO`. ~12 LOC. |
| `packages/api/src/modules/integration/__tests__/mapping-engine.spec.ts` | **MODIFIED** — add `describe('toUTC transform')` block with 9 scenarios from the table above. |

## Verification

Before committing:

1. `rm -rf packages/engine/dist && npm run build --workspace=@ctp/engine && npm run build --workspace=@ctp/api`
2. `npx vitest run` — all 961+ tests still pass; 9 new tests pass.
3. Manually: point the stafford-engineering-test tenant at the running mock (`npm run dev` in `tools/mock-genius`), call `POST /v1/state/sync`, call `GET /v1/ctp/state`, confirm order `dueDate` and task window dates are `Z`-suffixed UTC strings rather than `+13:00`.

## Out of Scope

- **Per-field error policies** (`onError: "strict" | "skip" | "default"`) — a separate, larger scope.
- **`sensitive: true` field masking** — separate concern.
- **Reverse direction** (UTC → NZ local for display) — downstream UI concern; the mapping engine is one-way (source → CTP model).
- **Timezones other than NZ** — the IANA database covers all of them; this sprint's only config knob is `fromTimezone`, which accepts any IANA zone. No extra work needed for future tenants in other regions.
- **Updating non-Stafford mapping profiles** — no other tenant currently uses REST adapter, and file-adapter tenants pass dates through as pre-written ISO strings. If a future tenant opts in, they add `toUTC: true` to their profile.

---

*Small, bounded sprint. Unblocks clean end-to-end UTC handling for the Stafford beta deploy and removes the last mapping-engine TODO.*
