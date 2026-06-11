# Stafford WORK7 Capture — 2026-06-03

Raw fixture capture from the live Stafford Genius API. **This directory is
gitignored** (`tools/mock-genius/.gitignore` excludes `recorded/`). Contents
include real customer names, part numbers, project managers, and dates.
**Sanitize before any promotion to `fixtures/`** — see the mock-genius
README "Sanitization checklist" section.

## Capture summary

| Item | Value |
|---|---|
| Date | 2026-06-03 |
| Env | WORK7 (dev/test) |
| Genius host | `https://genius.stafford.co.nz:53215` |
| Genius version | 17.1.6.3 |
| Auth | Bearer token (session-scoped) |
| Capture method | Direct curl via bash; adapter bypassed |

## Endpoints captured

Five entities — four established + one new (`JobEntity`). All counts verified
against `PagingInfos.TotalElementsFound` on page 1 of each endpoint.

| Entity | Filter (decoded) | Records | Pages @ 100 |
|---|---|---|---|
| `machineAndRessourceEntity` | `Active=true` | 68 | 1 |
| `salesOrderDetailEntity` | `ItemStatus!=C` | 830 | 9 |
| `workOrderWithAdvancedInformationViewEntity` | `Wostatus!=CLOSED` | 871 | 9 |
| `productionTaskWithAdvancedInfoViewEntity` | `IsCompleted=false` | 2,563 | 26 |
| `JobEntity` | `Active=true & Job<SYST` | 558 | 6 |
| **Total** | — | **4,890** | **51** |

## File layout

```
stafford-work7-2026-06-03/
├── README.md                                            ← this file
├── _capture-metadata.json                               ← machine-readable
├── machineAndRessourceEntity_page1.json
├── salesOrderDetailEntity_page1.json  ..  _page9.json
├── workOrderWithAdvancedInformationViewEntity_page1.json .. _page9.json
├── productionTaskWithAdvancedInfoViewEntity_page1.json .. _page26.json
└── JobEntity_page1.json  ..  _page6.json
```

Each file contains the full Genius response envelope:

```json
{
  "Result": [ ... entity records ... ],
  "Messages": [ ... ],
  "PagingInfos": { "CurrentPageIndex": N, "PageSize": 100, "TotalElementsFound": ..., "TotalPagesFound": ... },
  "Tag": null
}
```

## Filter syntax reference (verified during this session)

Genius's filter parser uses:

| Element | Symbol | URL-encoded | Notes |
|---|---|---|---|
| AND separator | `&` | `%26` | Inside the filter value (NOT the URL query separator) |
| OR separator | `\|` | `%7C` | Untested in this session; docs say `%21` but that's `!` |
| Equal | `=` | `%3D` | Case-insensitive on boolean values (Active=true == Active=True) |
| Not equal | `!=` | `%21%3D` | Works despite not being in the official operator list |
| Less than | `<` | `%3C` | String comparison verified |
| Less than or equal | `<=` | `%3C%3D` | Per docs, untested |
| Greater than | `>` | `%3E` | Per docs, untested |
| Greater than or equal | `>=` | `%3E%3D` | Per docs, untested |
| Starts with | `[` | `%5B` | Verified — `Job[SYST` matched 2 records |
| Ends with | `]` | `%5D` | Per docs, untested |
| Contains | `:` | `%3A` | Per docs, untested |
| Range | `{` | `%7B` | Per docs, untested |

## Data drift vs 2026-04-23 capture

| Entity | 2026-04-23 (filtered) | 2026-06-03 (filtered) | Δ |
|---|---|---|---|
| Resources | 77 (unfiltered) | 68 (Active=true) | -9 (filter was not applied in prior capture) |
| Sales orders (open) | 474 | 830 | +356 — significant intake of new orders |
| Work orders (open) | 956 | 871 | -85 — net closure |
| Tasks (incomplete) | 3,118 | 2,563 | -555 — steady completion |
| Jobs (active planned) | — | 558 | new entity |

Drift is consistent with ongoing operations: sales orders grew, work-order
backlog shrank, tasks completed faster than created. No anomaly.

## Notable observations from this session

1. **JobEntity is huge unfiltered:** 9,350 records / 94 pages without filter,
   568 with `Active=true`, 558 with `Active=true & Job<SYST`. The filter
   reduces volume by ~94%.

2. **`JobStatusCode=Planned` is redundant with `Active=true`** for this
   dataset — all 568 active jobs are status "Planned". The capture filter
   omits the redundant clause for simplicity.

3. **`!=` operator works** despite not being in the documented operator list.
   All three legacy `!=` filters were verified against their complements:
   filtered + complement = unfiltered total, exactly. Hard proof.

4. **Customer data present.** First page of work orders includes
   FISHER & PAYKEL HEALTHCARE, project manager names, specific PO numbers.
   See sanitization checklist before any promotion.

## Next steps (NOT done in this session)

1. **Sanitize.** Strip customer names, part numbers, project managers,
   timestamps that look like PII. See mock-genius README "Sanitization
   checklist" — this is the load-bearing step before any sharing.
2. **Strip envelopes.** `node scripts/strip-envelope.js <this-dir-copy>` —
   produces the flat-array form mock-genius expects in `fixtures/`.
3. **Merge paginated files.** Each entity's `_pageN.json` files become a
   single combined `<entity>.json` after envelope stripping.
4. **Promote.** `cp -r` the sanitized result to
   `tools/mock-genius/fixtures/stafford-snapshot-2026-06-03/` and commit.
5. **Optionally update mapping.** If `JobEntity` becomes a top-level
   `IRawDataPayload` key, the mapping profile + engine model need additions.
   Decision deferred — depends on whether jobs flow into the engine landscape.
