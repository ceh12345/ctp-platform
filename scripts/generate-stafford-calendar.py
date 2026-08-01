#!/usr/bin/env python3
"""Generate a default Standard calendar for Stafford WORK7 resources.

Per Kaleb's email: "Calendar endpoint deferred for now, use Standard default."
The slim resource records confirm:
  - CalendarMspCode = 'Standard' (76/77)
  - OperatingDayPerWeek = 5 (75/77)
  - HourCapacityPerDay = 8 (72/77)

So the default is a 5-day, 8-hour Mon-Fri shift. We use 07:00-15:00 NZ local
(NZ early-shift convention). Subcontract resources (RessourceType='S') get a
24/7 unlimited calendar since they're external.

Coverage: START_DATE → END_DATE (defaults 2026-01-01 → 2027-12-31; override
with --end YYYY-MM-DD). Coverage must extend past every tenant horizon end —
a calendar that stops short of the horizon strands late-chain tasks with
"[HORIZON] partial" / "fully blocked" infeasibilities (found via slim-500,
2026-07-30). Handles NZDT↔NZST DST transitions via zoneinfo
(Pacific/Auckland) for any year.

Usage:
    python scripts/generate-stafford-calendar.py [--resources <capture.json>] [--end YYYY-MM-DD]

Output: overwrites config/tenants/stafford-engineering-test/data/calendars.json
"""

import json
import sys
from datetime import datetime, date, time, timedelta
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

REPO = Path(__file__).resolve().parents[1]


def arg_val(flag, default):
    argv = sys.argv
    return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else default


# Default to the newest full capture — an older capture misses recently added
# resources, which then have NO calendar and are unschedulable (MIKE/COOPER,
# found via slim-500 2026-07-30).
RESOURCES_FILE = Path(arg_val(
    '--resources',
    REPO / 'tools/mock-genius/recorded/stafford-work7-2026-07-16/machineAndRessourceEntity_page1.json',
))
OUTPUT_FILE = REPO / 'config/tenants/stafford-engineering-test/data/calendars.json'

START_DATE = date(2026, 1, 1)
END_DATE   = date.fromisoformat(arg_val('--end', '2027-12-31'))
SHIFT_START_HOUR = 7   # 07:00 NZ local
SHIFT_END_HOUR   = 15  # 15:00 NZ local — 8-hour shift

# NZ DST rules (any year): NZDT (+13) ends the first Sunday of April and
# begins the last Sunday of September; NZST (+12) between. Rule-based rather
# than zoneinfo because Windows Python lacks the tzdata package by default.

def _first_sunday(year, month):
    d = date(year, month, 1)
    return d + timedelta(days=(6 - d.weekday()) % 7)


def _last_sunday(year, month):
    d = (date(year, month, 28) + timedelta(days=7)).replace(day=1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def nz_offset_hours(d):
    """NZ UTC offset in hours for a given date (13 in NZDT, 12 in NZST)."""
    if d < _first_sunday(d.year, 4) or d >= _last_sunday(d.year, 9):
        return 13
    return 12


def iso_utc(local_y, local_m, local_d, local_h, local_min, offset_hours):
    """Build an ISO UTC string from NZ-local components and the offset that day."""
    nz_dt = datetime(local_y, local_m, local_d, local_h, local_min)
    utc_dt = nz_dt - timedelta(hours=offset_hours)
    return utc_dt.strftime('%Y-%m-%dT%H:%M:%SZ')


def weekday_intervals(start, end, qty=1):
    """Yield Mon-Fri intervals from start to end, each NZ 07:00-15:00, at `qty`.

    `qty` is the parallel capacity of the resource (how many jobs it can run at
    once) — sourced from Genius `NumOfAvgResource` for non-finite pooled work
    centers. The engine reads capacity from the calendar interval qty, so it MUST
    be written here; the `parallelCapacity` field on the resource record is not
    read in the scheduling path.
    """
    d = start
    while d <= end:
        if d.weekday() < 5:  # Monday=0 .. Friday=4
            off = nz_offset_hours(d)
            yield {
                'start': iso_utc(d.year, d.month, d.day, SHIFT_START_HOUR, 0, off),
                'end':   iso_utc(d.year, d.month, d.day, SHIFT_END_HOUR,   0, off),
                'qty':   qty,
            }
        d += timedelta(days=1)


def all_day_intervals(start, end):
    """Yield 24h NZ-local intervals from start to end for subcontract resources.

    Subcontract / OUTWORK resources represent the external vendor pool — no
    Stafford shift gates, no real capacity ceiling. Each day gets one 24h
    interval at qty=99999 (effectively unbounded). The 2026-06-08 single-
    interval Q4 workaround has been removed (commit `1611e65` fixed the
    underlying engine bug — see QUESTIONS-slim-100.md Q4).
    """
    d = start
    while d <= end:
        off_today = nz_offset_hours(d)
        d_next = d + timedelta(days=1)
        off_next = nz_offset_hours(d_next)
        yield {
            'start': iso_utc(d.year, d.month, d.day, 0, 0, off_today),
            'end':   iso_utc(d_next.year, d_next.month, d_next.day, 0, 0, off_next),
            'qty':   99999,  # effectively unlimited — subcontract vendor pool, no capacity binding
        }
        d = d_next


def main():
    with RESOURCES_FILE.open(encoding='utf-8') as f:
        resources = json.load(f)['Result']

    allday_template = list(all_day_intervals(START_DATE, END_DATE))
    weekday_count   = sum(1 for _ in weekday_intervals(START_DATE, END_DATE))

    print(f'Generating calendar for {len(resources)} resources')
    print(f'  Weekday shift: 07:00-15:00 NZ, Mon-Fri ({weekday_count} intervals/resource)')
    print(f'  Subcontract:   24/7 unlimited ({len(allday_template)} intervals/resource)')
    print(f'  Coverage:      {START_DATE} → {END_DATE}')

    # Resource key matches the CTP mapping (resources.key from Id, stringified).
    # Switched from Code to Id so renames in Genius don't orphan calendar entries.
    output = []
    counts = {'R': 0, 'W': 0, 'S': 0, 'other': 0}
    pooled = []
    for r in resources:
        rtype = r.get('RessourceType')
        rid = r.get('Id')
        if rid is None:
            continue
        if rtype == 'S':
            intervals = allday_template
            counts['S'] += 1
        else:
            # Parallel capacity lives in the calendar interval qty — the engine
            # reads qty, NOT the resource's parallelCapacity field. A non-finite
            # pooled work center runs NumOfAvgResource jobs at once; finite/named
            # resources and single-capacity pools stay qty=1.
            cap = int(r.get('NumOfAvgResource') or 1)
            qty = cap if (r.get('IsFinite') is False and cap > 1) else 1
            intervals = list(weekday_intervals(START_DATE, END_DATE, qty))
            counts[rtype if rtype in ('R', 'W') else 'other'] += 1
            if qty > 1:
                pooled.append(f"{r.get('Description1') or rid}={qty}")
        output.append({
            'resourceKey': str(rid),
            'intervals': intervals,
        })

    print(f'  By type: {counts}')
    if pooled:
        print(f'  Pooled (qty>1): {", ".join(pooled)}')

    with OUTPUT_FILE.open('w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    size_kb = OUTPUT_FILE.stat().st_size / 1024
    print(f'Wrote {OUTPUT_FILE} ({size_kb:.1f} KB)')


if __name__ == '__main__':
    main()
