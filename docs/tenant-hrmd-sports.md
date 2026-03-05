# Tenant Configuration: Highlands Ranch Metro District — Sports

**Tenant ID:** `hrmd-sports`  
**Domain:** Municipal youth & adult sports league scheduling  
**Engine mode:** CTP (season schedule generation) + Slot Finder (field reservations, rainout rescheduling)

---

## The Scenario

The Highlands Ranch Metro District (HRMD) Recreation Services department manages youth and adult sports across 26 parks in Highlands Ranch, Colorado — serving roughly 96,000 residents. They run youth baseball (1,500 participants, 125 teams), youth flag football (800 participants, 80 teams), adult softball, pickleball leagues, and more. Fields are shared across sports and seasons. Scheduling is coordinated by a small recreation staff: **Coleen Wheeler** (baseball/softball camps), **Beau Bressler** (competitive baseball), **Luke Ruter** (adult softball), and supervisor **Dave Parks**.

Currently they use **QuickScores** for schedule publishing and registration, plus phone/email coordination for field reservations. The actual schedule *building* — assigning 125 teams to fields, times, and umpires across a 10-week season — is largely manual.

### Pain Points

- **Field conflicts across sports:** Baseball and flag football share grass fields at the same parks. A coordinator manually checks each field before assigning it to a different sport's practice.
- **Umpire/referee scheduling:** 15 volunteer and part-time umpires with varying availability. Finding who's free for a Saturday double-header at Northridge is phone tag.
- **Rainout rescheduling:** A Saturday washout cancels 8-12 games. Rescheduling means checking field conditions, umpire availability, and team conflicts — takes 4+ hours of manual work.
- **Multi-park coordination:** Games happen at Redstone Park, Northridge Park, Paintbrush Park, Plum Valley Park, and several elementary school sites. Each has different field sizes, lighting, and amenities.
- **Seasonal transitions:** Baseball wraps up as flag football starts. Shared fields need a conversion buffer. No system tracks the handoff.
- **Practice field allocation:** 125 baseball teams each need 2 practice slots per week. Equitable distribution of prime-time (5-7pm weekday) vs. early slots is manual and generates complaints.

---

## Resources

### Baseball/Softball Fields

| Key | Name | Location | Type | Hierarchy1 | Size | Lights | Surface | Notes |
|-----|------|----------|------|------------|------|--------|---------|-------|
| RED-REDROCKS | Red Rocks Field | Redstone Park | Diamond | Baseball Field | Full | Yes | Grass/Dirt | Adult softball + older youth |
| RED-FLATIRONS | Flatirons Field | Redstone Park | Diamond | Baseball Field | Full | Yes | Grass/Dirt | Adult softball + older youth |
| RED-ROXBOROUGH | Roxborough Field | Redstone Park | Diamond | Baseball Field | Full | Yes | Grass/Dirt | Adult softball + older youth |
| RED-STADIUM | Highlands Ranch Stadium | Redstone Park | Diamond | Baseball Field | Full | Yes | Synthetic Turf | Premier field, all-weather |
| NR-1 | Northridge Field 1 | Northridge Park | Diamond | Baseball Field | Standard | No | Dirt | Youth baseball |
| NR-2 | Northridge Field 2 | Northridge Park | Diamond | Baseball Field | Standard | No | Dirt | Youth baseball |
| NR-3 | Northridge Field 3 | Northridge Park | Diamond | Baseball Field | Standard | No | Dirt | Youth baseball |
| PB-1 | Paintbrush Field 1 | Paintbrush Park | Diamond | Baseball Field | Standard | No | Grass/Dirt | Youth baseball/softball |
| PV-1 | Plum Valley Field 1 | Plum Valley Park | Diamond | Baseball Field | Standard | No | Grass/Dirt | Youth baseball/t-ball |
| PV-2 | Plum Valley Field 2 | Plum Valley Park | Diamond | Baseball Field | Small | No | Grass/Dirt | T-ball / coach pitch |
| RS-ELEM | Redstone Elementary | Redstone Elem. | Diamond | School Field | Small | No | Grass | Youth only, school hours restricted |
| CP-ELEM | Cresthill Elementary | Cresthill Elem. | Diamond | School Field | Small | No | Grass | Youth only, school hours restricted |

### Multi-Use / Football Fields

| Key | Name | Location | Type | Hierarchy1 | Size | Lights | Notes |
|-----|------|----------|------|------------|------|--------|-------|
| RED-MULTI-1 | Redstone Multi-Use 1 | Redstone Park | Rectangle | Multi-Use Field | 60 yd | Yes | Flag football / soccer / lacrosse |
| RED-MULTI-2 | Redstone Multi-Use 2 | Redstone Park | Rectangle | Multi-Use Field | 60 yd | Yes | Flag football / soccer |
| NR-MULTI | Northridge Multi-Use | Northridge Park | Rectangle | Multi-Use Field | 60 yd | No | Flag football / soccer |
| TANK-1 | Tanks Park Field 1 | Tanks Park | Rectangle | Multi-Use Field | 60 yd | No | Flag football |
| TANK-2 | Tanks Park Field 2 | Tanks Park | Rectangle | Multi-Use Field | 60 yd | No | Flag football |
| PB-MULTI | Paintbrush Multi-Use | Paintbrush Park | Rectangle | Multi-Use Field | 60 yd | No | Flag football / soccer |

### Pickleball Courts

| Key | Name | Location | Type | Hierarchy1 | Notes |
|-----|------|----------|------|------------|-------|
| SP-PB-11 | Southpark Court 11 | Southpark Complex | Court | Pickleball Court | East courts (Metro District managed) |
| SP-PB-12 | Southpark Court 12 | Southpark Complex | Court | Pickleball Court | |
| SP-PB-13 | Southpark Court 13 | Southpark Complex | Court | Pickleball Court | |
| SP-PB-14 | Southpark Court 14 | Southpark Complex | Court | Pickleball Court | |
| SP-PB-15 | Southpark Court 15 | Southpark Complex | Court | Pickleball Court | |
| SP-PB-16 | Southpark Court 16 | Southpark Complex | Court | Pickleball Court | |
| SP-PB-17 | Southpark Court 17 | Southpark Complex | Court | Pickleball Court | |
| SP-PB-18 | Southpark Court 18 | Southpark Complex | Court | Pickleball Court | |
| SP-PB-19 | Southpark Court 19 | Southpark Complex | Court | Pickleball Court | |

### Staff & Officials

| Key | Name | Type | Hierarchy1 | Role | Calendar |
|-----|------|------|------------|------|----------|
| STAFF-COLEEN | Coleen Wheeler | Staff | Recreation Staff | Recreation Coordinator (Baseball/Softball/Camps) | Mon-Fri 8:00-17:00 |
| STAFF-BEAU | Beau Bressler | Staff | Recreation Staff | Recreation Coordinator (Competitive Baseball) | Mon-Fri 8:00-17:00, Sat 7:00-14:00 |
| STAFF-LUKE | Luke Ruter | Staff | Recreation Staff | Recreation Coordinator (Adult Softball) | Mon-Fri 8:00-17:00, Sat 7:00-14:00 |
| STAFF-DAVE | Dave Parks | Staff | Recreation Staff | Recreation Supervisor | Mon-Fri 8:00-17:00 |
| STAFF-BRENDA | Brenda Willcutt | Staff | Recreation Staff | Recreation Assistant (Registration/Pickleball) | Mon-Fri 8:00-17:00 |
| UMP-01 | Garcia (Umpire) | Official | Umpire | Baseball/Softball Umpire | Mon-Fri 17:00-21:00, Sat 8:00-18:00 |
| UMP-02 | Hernandez (Umpire) | Official | Umpire | Baseball/Softball Umpire | Tue-Thu 17:00-21:00, Sat-Sun 8:00-18:00 |
| UMP-03 | Davis (Umpire) | Official | Umpire | Baseball/Softball Umpire | Mon-Wed-Fri 17:00-21:00, Sat 8:00-16:00 |
| UMP-04 | Miller (Umpire) | Official | Umpire | Baseball/Softball Umpire | Sat-Sun 8:00-18:00 |
| UMP-05 | Wilson (Umpire) | Official | Umpire | Baseball/Softball Umpire | Mon-Fri 17:00-21:00 |
| UMP-06 | Anderson (Umpire) | Official | Umpire | Baseball/Softball Umpire | Wed-Fri 17:00-21:00, Sat 8:00-18:00 |
| UMP-07 | Thomas (Umpire) | Official | Umpire | Baseball/Softball Umpire (T-ball certified) | Sat 8:00-14:00 |
| UMP-08 | Jackson (Umpire) | Official | Umpire | Baseball/Softball Umpire | Mon-Thu 17:00-21:00 |
| REF-01 | Martinez (Ref) | Official | Referee | Flag Football Referee | Sat 8:00-16:00 |
| REF-02 | Lopez (Ref) | Official | Referee | Flag Football Referee | Sat 8:00-16:00, Sun 10:00-16:00 |
| REF-03 | Clark (Ref) | Official | Referee | Flag Football Referee | Sat 8:00-18:00 |
| REF-04 | Lewis (Ref) | Official | Referee | Flag Football Referee | Sat-Sun 8:00-16:00 |
| REF-05 | Young (Ref) | Official | Referee | Flag Football Referee | Sat 8:00-14:00 |
| REF-06 | Hall (Ref) | Official | Referee | Flag Football / Pickleball | Sat-Sun 8:00-16:00, Wed 18:00-21:00 |
| REF-07 | Allen (Ref) | Official | Referee | Flag Football Referee | Sat 10:00-16:00 |

### Equipment

| Key | Name | Type | Hierarchy1 | Notes |
|-----|------|------|------------|-------|
| BASES-SET-1 | Portable Base Set 1 | Equipment | Field Equipment | For fields without permanent bases |
| BASES-SET-2 | Portable Base Set 2 | Equipment | Field Equipment | |
| SCOREBOARD-1 | Portable Scoreboard 1 | Equipment | Field Equipment | Electronic |
| SCOREBOARD-2 | Portable Scoreboard 2 | Equipment | Field Equipment | Electronic |
| FIELD-LINER | Field Liner | Equipment | Field Equipment | Shared — 1 per park complex |
| PA-SYSTEM | PA System | Equipment | Field Equipment | For tournaments / events |

---

## Calendars

### Field Availability

```json
{
  "lighted-fields-weekday": {
    "days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    "start": "07:00",
    "end": "21:00",
    "applies_to": ["RED-REDROCKS", "RED-FLATIRONS", "RED-ROXBOROUGH", "RED-STADIUM", "RED-MULTI-1", "RED-MULTI-2"]
  },
  "lighted-fields-weekend": {
    "days": ["Sat", "Sun"],
    "start": "07:00",
    "end": "21:00",
    "applies_to": ["RED-REDROCKS", "RED-FLATIRONS", "RED-ROXBOROUGH", "RED-STADIUM", "RED-MULTI-1", "RED-MULTI-2"]
  },
  "unlighted-fields-weekday": {
    "days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    "start": "07:00",
    "end": "19:30",
    "notes": "Sunset-dependent, latest usable time varies by month",
    "applies_to": ["NR-1", "NR-2", "NR-3", "PB-1", "PV-1", "PV-2", "NR-MULTI", "TANK-1", "TANK-2", "PB-MULTI"]
  },
  "unlighted-fields-weekend": {
    "days": ["Sat", "Sun"],
    "start": "07:00",
    "end": "19:30",
    "applies_to": ["NR-1", "NR-2", "NR-3", "PB-1", "PV-1", "PV-2", "NR-MULTI", "TANK-1", "TANK-2", "PB-MULTI"]
  },
  "school-fields-weekday": {
    "days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    "start": "16:00",
    "end": "19:30",
    "notes": "Available after school hours only",
    "applies_to": ["RS-ELEM", "CP-ELEM"]
  },
  "school-fields-weekend": {
    "days": ["Sat", "Sun"],
    "start": "08:00",
    "end": "18:00",
    "applies_to": ["RS-ELEM", "CP-ELEM"]
  },
  "pickleball-courts": {
    "days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    "start": "07:00",
    "end": "21:00",
    "applies_to": ["SP-PB-11", "SP-PB-12", "SP-PB-13", "SP-PB-14", "SP-PB-15", "SP-PB-16", "SP-PB-17", "SP-PB-18", "SP-PB-19"]
  }
}
```

### Blocked / Maintenance

```json
{
  "stadium-turf-maintenance": {
    "type": "MAINTENANCE",
    "resource": "RED-STADIUM",
    "recurrence": "weekly",
    "day": "Wed",
    "start": "07:00",
    "end": "12:00",
    "notes": "Synthetic turf grooming and inspection"
  },
  "spring-field-closure": {
    "type": "SEASONAL_CLOSURE",
    "resources": ["NR-1", "NR-2", "NR-3", "PB-1", "PV-1", "PV-2"],
    "start": "2025-11-01",
    "end": "2026-03-15",
    "notes": "Grass fields closed for winter. Reopen weather-dependent (generally March)."
  }
}
```

---

## Activity Types

### Baseball/Softball Game

A game is a chain: Field Prep → Game → Field Reset.

```
FIELD-PREP (15 min): Field + Field Liner (optional)
  → Drag infield, chalk lines, set bases
GAME (90-120 min): Field + Umpire
  → Actual game play, duration varies by age division
FIELD-RESET (15 min): Field
  → Rake infield, collect bases, pick up trash
```

maxGap: 0 between PREP→GAME, 900 (15 min) between GAME→RESET

Duration by age division:

| Division | Ages | Game Duration | Field Size |
|----------|------|---------------|------------|
| T-Ball | 4-5 | 60 min | Small (PV-2, school fields) |
| Coach Pitch | 6-7 | 75 min | Small/Standard |
| Minors | 7-8 | 90 min | Standard |
| Majors | 9-10 | 90 min | Standard |
| Juniors | 11-12 | 105 min | Standard/Full |
| Seniors | 13+ | 120 min | Full |
| Adult Softball | 18+ | 75 min | Full (lighted fields only for evening) |

### Flag Football Game

```
FF-SETUP (10 min): Multi-Use Field + Referee
  → Set cones, check field markers, team check-in
FF-GAME (50 min): Multi-Use Field + Referee
  → 5v5, two 20-minute halves with halftime
FF-RESET (5 min): Multi-Use Field
  → Collect cones
```

maxGap: 0 between SETUP→GAME, 0 between GAME→RESET

Games on Saturdays. Practices one weekday evening per team.

### Practice Session

Single activity, single resource (no umpire/ref needed):

```
PRACTICE (90 min): Field
  → Team practice, coach-led
```

No chain. But constrained by: field type must match division (T-ball can't practice on full-size), no lights means must end by sunset.

### Pickleball League Match

```
PB-MATCH (90 min): 2 Courts + Referee (optional for league play)
  → Doubles format, best of 3 games
```

10-match regular season (2 matches per week) + end-of-season tournament.

### Tournament (Baseball)

A tournament is a set of chained games with precedence:

```
Pool Play: Game A, Game B, Game C, Game D (parallel, different fields)
  → Results determine seeding
Semifinal 1: Winner Pool A vs Runner-up Pool B (chain dependency)
Semifinal 2: Winner Pool B vs Runner-up Pool A (chain dependency)
Championship: Winner SF1 vs Winner SF2 (chain dependency on both SFs)
```

Each game follows the FIELD-PREP → GAME → FIELD-RESET chain.
Tournament-level chain: SF can't start until pool play results are in.
Championship can't start until both SFs complete.

---

## Sample Season: Summer 2026 Youth Baseball

### Divisions and Teams

| Division | Code | Teams | Age | Games/Week | Practices/Week | Field Requirement |
|----------|------|-------|-----|------------|-----------------|-------------------|
| T-Ball | TBALL | 16 | 4-5 | 1 (Sat AM) | 1 | Small field |
| Coach Pitch | CP | 20 | 6-7 | 1 (Sat) | 2 | Standard field |
| Minors | MIN | 24 | 7-8 | 1 (Sat) | 2 | Standard field |
| Majors | MAJ | 24 | 9-10 | 2 (Tue/Sat) | 1 | Standard/Full field |
| Juniors | JR | 16 | 11-12 | 2 (Tue/Thu or Sat) | 1 | Full field |
| Seniors | SR | 12 | 13+ | 2 (Mon/Wed or Sat) | 1 | Full field |
| Adult Softball | SOFT | 20 | 18+ | 1-2 (weekday evenings) | 0 | Full lighted field |

**Season:** 10 weeks, June 1 – August 8, 2026

### Weekly Demand Summary

| Slot Type | Count | When | Duration | Resources Needed |
|-----------|-------|------|----------|------------------|
| T-Ball games | 8 | Sat 8:00-12:00 | 60 min each | Small field + 1 umpire |
| Coach Pitch games | 10 | Sat 8:00-14:00 | 75 min each | Standard field + 1 umpire |
| Minors games | 12 | Sat 8:00-16:00 | 90 min each | Standard field + 1 umpire |
| Majors games | 12 | Tue 17:30-20:00 + Sat 8:00-16:00 | 90 min each | Standard/Full field + 1 umpire |
| Juniors games | 8 | Tue/Thu 17:30-20:00 + Sat | 105 min each | Full field + 1 umpire |
| Seniors games | 6 | Mon/Wed 17:30-20:00 + Sat | 120 min each | Full field + 1 umpire |
| Adult softball | 10-12 | Mon-Fri 18:00-21:00 | 75 min each | Full lighted field + 1 umpire |
| Practices (all) | ~80 | Mon-Fri 17:00-19:30 | 90 min each | Any age-appropriate field |

**Total weekly field-hours needed:** ~250 hours  
**Total weekly field-hours available:** ~300 hours (across all parks)  
**Utilization target:** ~80% (leaving buffer for rainouts and maintenance)

### Sample Orders (Week 1 Games)

```json
[
  {
    "key": "GAME-MIN-W1-01",
    "name": "Minors: Rockies vs Dodgers — Week 1",
    "type": "GAME",
    "division": "MIN",
    "priority": "STANDARD",
    "rank": 50,
    "homeTeam": "MIN-ROCKIES",
    "awayTeam": "MIN-DODGERS",
    "tasks": [
      {
        "key": "GAME-MIN-W1-01-PREP",
        "name": "Field Prep",
        "type": "FIELD-PREP",
        "sequence": 1,
        "duration": 900,
        "linkId": { "name": "GAME-MIN-W1-01", "prevLink": "", "maxGap": 0 },
        "window": { "start": "2026-06-06T07:00:00", "end": "2026-06-06T16:00:00" },
        "capacityResources": [
          {
            "resource": "NR-1", "isPrimary": true,
            "preferences": ["NR-2", "NR-3", "PB-1", "PV-1"]
          }
        ],
        "typedAttributes": [
          { "key": "division", "value": "Minors" },
          { "key": "sport", "value": "Baseball" }
        ]
      },
      {
        "key": "GAME-MIN-W1-01-PLAY",
        "name": "Rockies vs Dodgers",
        "type": "GAME-PLAY",
        "sequence": 2,
        "duration": 5400,
        "linkId": { "name": "GAME-MIN-W1-01", "prevLink": "GAME-MIN-W1-01-PREP", "maxGap": 0 },
        "window": { "start": "2026-06-06T07:00:00", "end": "2026-06-06T18:00:00" },
        "capacityResources": [
          {
            "resource": "NR-1", "isPrimary": true,
            "preferences": ["NR-2", "NR-3", "PB-1", "PV-1"]
          },
          {
            "resource": "UMP-01", "isPrimary": false,
            "preferences": ["UMP-02", "UMP-03", "UMP-04", "UMP-05", "UMP-06", "UMP-07"]
          }
        ],
        "typedAttributes": [
          { "key": "division", "value": "Minors" },
          { "key": "sport", "value": "Baseball" },
          { "key": "homeTeam", "value": "Rockies" },
          { "key": "awayTeam", "value": "Dodgers" }
        ]
      },
      {
        "key": "GAME-MIN-W1-01-RESET",
        "name": "Field Reset",
        "type": "FIELD-RESET",
        "sequence": 3,
        "duration": 900,
        "linkId": { "name": "GAME-MIN-W1-01", "prevLink": "GAME-MIN-W1-01-PLAY", "maxGap": 900 },
        "window": { "start": "2026-06-06T08:00:00", "end": "2026-06-06T19:00:00" },
        "capacityResources": [
          {
            "resource": "NR-1", "isPrimary": true,
            "preferences": ["NR-2", "NR-3", "PB-1", "PV-1"]
          }
        ]
      }
    ]
  },
  {
    "key": "GAME-SR-W1-01",
    "name": "Seniors: Eagles vs Hawks — Week 1 (Mon Evening)",
    "type": "GAME",
    "division": "SR",
    "priority": "STANDARD",
    "rank": 50,
    "tasks": [
      {
        "key": "GAME-SR-W1-01-PREP",
        "name": "Field Prep",
        "type": "FIELD-PREP",
        "sequence": 1,
        "duration": 900,
        "linkId": { "name": "GAME-SR-W1-01", "prevLink": "", "maxGap": 0 },
        "window": { "start": "2026-06-01T17:00:00", "end": "2026-06-01T19:00:00" },
        "capacityResources": [
          { "resource": "RED-REDROCKS", "isPrimary": true, "preferences": ["RED-FLATIRONS", "RED-ROXBOROUGH"] }
        ]
      },
      {
        "key": "GAME-SR-W1-01-PLAY",
        "name": "Eagles vs Hawks",
        "type": "GAME-PLAY",
        "sequence": 2,
        "duration": 7200,
        "linkId": { "name": "GAME-SR-W1-01", "prevLink": "GAME-SR-W1-01-PREP", "maxGap": 0 },
        "window": { "start": "2026-06-01T17:00:00", "end": "2026-06-01T21:00:00" },
        "capacityResources": [
          { "resource": "RED-REDROCKS", "isPrimary": true, "preferences": ["RED-FLATIRONS", "RED-ROXBOROUGH"] },
          { "resource": "UMP-05", "isPrimary": false, "preferences": ["UMP-01", "UMP-03", "UMP-08"] }
        ]
      },
      {
        "key": "GAME-SR-W1-01-RESET",
        "name": "Field Reset",
        "type": "FIELD-RESET",
        "sequence": 3,
        "duration": 900,
        "linkId": { "name": "GAME-SR-W1-01", "prevLink": "GAME-SR-W1-01-PLAY", "maxGap": 900 },
        "capacityResources": [
          { "resource": "RED-REDROCKS", "isPrimary": true, "preferences": ["RED-FLATIRONS", "RED-ROXBOROUGH"] }
        ]
      }
    ]
  }
]
```

### Sample: Flag Football Saturday (Fall)

```json
[
  {
    "key": "FF-3RD-W1-01",
    "name": "3rd Grade: Broncos vs Chiefs — Week 1",
    "type": "GAME",
    "division": "FF-3RD",
    "priority": "STANDARD",
    "tasks": [
      {
        "key": "FF-3RD-W1-01-SETUP",
        "name": "Game Setup",
        "type": "FF-SETUP",
        "sequence": 1,
        "duration": 600,
        "linkId": { "name": "FF-3RD-W1-01", "prevLink": "", "maxGap": 0 },
        "window": { "start": "2026-09-12T08:00:00", "end": "2026-09-12T14:00:00" },
        "capacityResources": [
          { "resource": "RED-MULTI-1", "isPrimary": true, "preferences": ["RED-MULTI-2", "NR-MULTI", "TANK-1"] },
          { "resource": "REF-01", "isPrimary": false, "preferences": ["REF-02", "REF-03", "REF-04", "REF-05"] }
        ]
      },
      {
        "key": "FF-3RD-W1-01-GAME",
        "name": "Broncos vs Chiefs",
        "type": "FF-GAME",
        "sequence": 2,
        "duration": 3000,
        "linkId": { "name": "FF-3RD-W1-01", "prevLink": "FF-3RD-W1-01-SETUP", "maxGap": 0 },
        "window": { "start": "2026-09-12T08:00:00", "end": "2026-09-12T15:00:00" },
        "capacityResources": [
          { "resource": "RED-MULTI-1", "isPrimary": true, "preferences": ["RED-MULTI-2", "NR-MULTI", "TANK-1"] },
          { "resource": "REF-01", "isPrimary": false, "preferences": ["REF-02", "REF-03", "REF-04", "REF-05"] }
        ]
      },
      {
        "key": "FF-3RD-W1-01-RESET",
        "name": "Field Reset",
        "type": "FF-RESET",
        "sequence": 3,
        "duration": 300,
        "linkId": { "name": "FF-3RD-W1-01", "prevLink": "FF-3RD-W1-01-GAME", "maxGap": 0 },
        "capacityResources": [
          { "resource": "RED-MULTI-1", "isPrimary": true, "preferences": ["RED-MULTI-2", "NR-MULTI", "TANK-1"] }
        ]
      }
    ]
  }
]
```

---

## App Settings

```json
{
  "tenantId": "hrmd-sports",
  "tenantName": "Highlands Ranch Metro District — Sports",
  "flowAround": false,
  "maxLateness": 0,
  "tasksPerLoop": 50,
  "topTasksToSchedule": 3,
  "requiresPreds": true,
  "scheduleDirection": 1,
  "solverStrategy": "Chain",
  "experienceLevel": "standard"
}
```

---

## Scoring Configuration

```json
{
  "name": "HRMD Sports Scoring",
  "key": "hrmd-sports-scoring",
  "rules": [
    {
      "ruleName": "EarliestStartTimeScoringRule",
      "weight": 0.3,
      "objective": 0,
      "includeInSolve": true,
      "penaltyFactor": 0,
      "notes": "Prefer earlier game times to finish the day sooner"
    },
    {
      "ruleName": "ResourceUtilizationScoringRule",
      "weight": 0.35,
      "objective": 1,
      "includeInSolve": true,
      "penaltyFactor": 0,
      "notes": "Spread games across fields — avoid overusing Red Rocks while Northridge sits empty"
    },
    {
      "ruleName": "ResourcePreferenceScoringRule",
      "weight": 0.2,
      "objective": 0,
      "includeInSolve": true,
      "penaltyFactor": 0,
      "notes": "Prefer age-appropriate fields (T-ball on small fields, seniors on full)"
    },
    {
      "ruleName": "ChangeoverScoringRule",
      "weight": 0.15,
      "objective": 0,
      "includeInSolve": true,
      "penaltyFactor": 0,
      "notes": "Minimize umpire travel between parks — keep umpire at same park for consecutive games"
    }
  ]
}
```

---

## Terminology

```json
{
  "task": "Activity",
  "order": "Game",
  "resource": "Resource",
  "process": "Game",
  "horizon": "Season",
  "scheduled": "Confirmed",
  "unscheduled": "Unassigned",
  "pinned": "Locked",
  "setup": "Field Prep",
  "teardown": "Field Reset",
  "infeasible": "No Availability",
  "feasible": "Available"
}
```

---

## Colors

```json
{
  "FIELD-PREP": "#E8F5E9",
  "GAME-PLAY": "#1B5E20",
  "FIELD-RESET": "#E8F5E9",
  "FF-SETUP": "#FFF3E0",
  "FF-GAME": "#E65100",
  "FF-RESET": "#FFF3E0",
  "PRACTICE": "#90CAF9",
  "PB-MATCH": "#7B1FA2",
  "TOURNAMENT": "#B71C1C",
  "TBALL": "#AED581",
  "COACH-PITCH": "#81C784",
  "MINORS": "#4CAF50",
  "MAJORS": "#388E3C",
  "JUNIORS": "#2E7D32",
  "SENIORS": "#1B5E20",
  "ADULT-SOFTBALL": "#FF8F00"
}
```

---

## Key Demo Scenarios

### 1. Build a Saturday Game Day
**Input:** 12 Minors games + 8 Majors games + 8 T-Ball games for Saturday June 6  
**Solver does:** Assigns each game to a field (respecting size constraints), assigns umpires (respecting availability + minimizing travel between parks), chains Field Prep → Game → Reset with maxGap=0.  
**Show:** Gantt view grouped by park → fields stacked under Redstone, Northridge, etc. Umpire utilization showing balanced assignments.

### 2. Rainout Rescheduling
**Input:** Saturday June 13 washed out. 28 games canceled.  
**Action:** Unschedule all June 13 games. Solver re-solves across next 2 weeks.  
**Show:** Games distributed into weekday evening slots and the following Saturday. Umpire conflicts auto-resolved. Stadium (synthetic turf) gets priority since it drains fastest.

### 3. Umpire Shortage
**Input:** UMP-01, UMP-02, UMP-04 all unavailable this Saturday (tournament in Parker).  
**Action:** Exclude those 3 umpires → re-solve.  
**Show:** Engine redistributes games to the 4 remaining Saturday umpires. Some games shift to later time slots to allow umpire back-to-back doubleheaders. T-Ball gets UMP-07 (only T-Ball certified ump still available).

### 4. Baseball→Football Season Transition
**Input:** Baseball season ends Aug 8. Flag football practices start Aug 10 on shared multi-use fields.  
**Show:** Engine knows RED-MULTI-1 and RED-MULTI-2 switch from baseball overflow to flag football. Any late-season baseball makeups can't use those fields after Aug 8. Football practices auto-assigned to open slots.

### 5. Tournament Weekend
**Input:** End-of-season tournament. 8 teams, bracket play. 4 fields at Redstone, full Saturday.  
**Show:** Pool play games scheduled in parallel across 4 fields in the morning. Semifinals in early afternoon (chained to pool play completion). Championship at 3pm on the Stadium (the premier field). Umpires rotate — no umpire works more than 3 consecutive games.

### 6. Equitable Practice Distribution
**Input:** 24 Minors teams need 2 practice slots/week each for 10 weeks.  
**Query:** "Show me which teams got the most 5-6pm slots vs. 7-8pm slots."  
**Show:** Scoring rule ensures balanced distribution of prime-time slots. No team gets stuck with all early-morning or all late-evening practices.

---

## What This Demonstrates for HRMD

| Their Problem | Engine Capability |
|---|---|
| "Who has the field?" | Multi-resource scheduling with calendar-based availability |
| "Can we fit 28 rain-out games into next week?" | CTP query — feasibility + optimal placement |
| "Find me an umpire for Saturday's double-header" | Slot finder with multi-resource intersection |
| "Baseball ends, football starts — same fields" | Seasonal calendar transitions, resource sharing |
| "Tournament bracket with field assignments" | Chain dependencies with precedence networks |
| "Are we giving all teams fair practice times?" | Utilization scoring + equitable distribution |
| "This umpire called in sick — reassign his games" | Resource preference overrides (redirect work) |
| "What if we add a Wednesday evening league?" | What-if mode — snapshot, test, compare |

---

## Integration Notes

HRMD currently uses **QuickScores** for schedule publishing, team registration, and public-facing schedules. This engine wouldn't replace QuickScores — it would feed it. The workflow:

1. **Registration** happens in QuickScores (teams, players, fees)
2. **Schedule building** happens in our engine (field + umpire + time optimization)
3. **Schedule export** pushes the confirmed schedule to QuickScores via their API
4. **Ongoing management** (rainouts, changes) happens in our engine, syncs back

QuickScores already has a public API. The integration is: our engine produces the schedule, QuickScores displays it. We solve the hard problem, they handle the public-facing part.
