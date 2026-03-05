# Highlands Ranch Metro District — Rec Sports Tenant Dataset

Create a third tenant for the Highlands Ranch Metro District recreation sports programs. Week 1 of a summer season, Saturday primary game day with full-week availability for rainout makeups. Baseball, flag football, and pickleball across real HRMD parks and facilities. Demonstrates multi-resource scheduling (Field + Umpire/Referee + Equipment), activity chains (Prep → Game → Reset), and high-volume repetitive scheduling.

**Tenant ID:** `hrmd-rec-sports`

Stop any running dev servers on ports 3000 and 3001 before starting. Restart both after all changes are complete.

---

## Part 1: Tenant Config Files

Create all files under `config/tenants/hrmd-rec-sports/`

### tenant.json

```json
{
  "tenantId": "hrmd-rec-sports",
  "name": "Highlands Ranch Metro District",
  "vertical": "sports",
  "createdAt": "2026-02-23T00:00:00Z",
  "updatedAt": "2026-02-23T00:00:00Z"
}
```

### terminology.json

```json
{
  "mappings": {
    "resource": "Resource",
    "task": "Activity",
    "order": "Game",
    "duration": "Duration",
    "stateChange": "Field Prep",
    "demand": "Game Request",
    "process": "Game Type",
    "schedule": "Game Schedule",
    "solve": "Build Schedule",
    "landscape": "HRMD Sports Complex"
  }
}
```

### horizon.json

Full week — Saturday (primary game day) through Friday for rainout makeups.

```json
{
  "startDate": "2026-06-06T06:00:00Z",
  "endDate": "2026-06-13T00:00:00Z"
}
```

### settings.json

```json
{
  "flowAround": false,
  "maxLateness": 0,
  "tasksPerLoop": 100,
  "topTasksToSchedule": 2,
  "resetUsageAfterProcessChange": false,
  "scheduleDirection": 1,
  "requiresPreds": true,
  "solverStrategy": "Chain"
}
```

### scoring.json

Weights sum to 1.0.

```json
{
  "name": "HRMD Sports Scheduling",
  "key": "hrmd-sports-default",
  "rules": [
    {
      "ruleName": "EarliestStartTimeScoringRule",
      "weight": 0.5,
      "objective": 0,
      "includeInSolve": true,
      "penaltyFactor": 0
    },
    {
      "ruleName": "ResourceUtilizationScoringRule",
      "weight": 0.3,
      "objective": 1,
      "includeInSolve": true,
      "penaltyFactor": 0
    },
    {
      "ruleName": "LatestStartTimeScoringRule",
      "weight": 0.2,
      "objective": 0,
      "includeInSolve": true,
      "penaltyFactor": 0
    }
  ]
}
```

### schemas/resource.schema.json

```json
{
  "typedAttributes": [
    { "name": "sport", "dataType": "enum", "category": "classification", "sequence": 1,
      "enumValues": ["baseball", "flag-football", "pickleball", "multi-use"] },
    { "name": "park", "dataType": "string", "category": "location", "sequence": 2 },
    { "name": "surface", "dataType": "enum", "category": "physical", "sequence": 3,
      "enumValues": ["dirt-infield", "grass", "synthetic-turf", "hard-court"] },
    { "name": "lightingAvailable", "dataType": "boolean", "category": "physical", "sequence": 4 },
    { "name": "fenced", "dataType": "boolean", "category": "physical", "sequence": 5 },
    { "name": "certificationLevel", "dataType": "enum", "category": "staff", "sequence": 6,
      "enumValues": ["volunteer", "certified", "chsaa-certified", "head-umpire", "head-referee", "coordinator"] }
  ]
}
```

### schemas/task.schema.json

```json
{
  "typedAttributes": [
    { "name": "sport", "dataType": "enum", "category": "game", "sequence": 1,
      "enumValues": ["baseball", "flag-football", "pickleball"] },
    { "name": "division", "dataType": "string", "category": "game", "sequence": 2 },
    { "name": "homeTeam", "dataType": "string", "category": "game", "sequence": 3 },
    { "name": "awayTeam", "dataType": "string", "category": "game", "sequence": 4 },
    { "name": "gameWeek", "dataType": "integer", "category": "game", "sequence": 5 },
    { "name": "phase", "dataType": "enum", "category": "game", "sequence": 6,
      "enumValues": ["prep", "play", "reset"] }
  ]
}
```

### schemas/order.schema.json

```json
{
  "typedAttributes": [
    { "name": "sport", "dataType": "string", "category": "game", "sequence": 1 },
    { "name": "division", "dataType": "string", "category": "game", "sequence": 2 },
    { "name": "gameWeek", "dataType": "integer", "category": "game", "sequence": 3 },
    { "name": "homeTeam", "dataType": "string", "category": "game", "sequence": 4 },
    { "name": "awayTeam", "dataType": "string", "category": "game", "sequence": 5 }
  ]
}
```

---

## Part 2: Resources

Create `config/tenants/hrmd-rec-sports/data/resources.json`

All resources use real Highlands Ranch Metro District park names, field names, and facility locations.

### Baseball/Softball Diamond Fields (14)

**Redstone Park** (main complex — 3280 Redstone Park Circle)

| key | name | park | surface | fenced | lighting | hierarchy1 |
|-----|------|------|---------|--------|----------|-----------|
| RS-ROXBOROUGH | Redstone - Roxborough Field | Redstone Park | dirt-infield | true | true | Redstone Park Diamonds |
| RS-FLATIRONS | Redstone - Flatirons Field | Redstone Park | dirt-infield | true | true | Redstone Park Diamonds |
| RS-REDROCKS | Redstone - Red Rocks Field | Redstone Park | dirt-infield | true | true | Redstone Park Diamonds |
| RS-SOUTH-GREEN | Redstone - South Green | Redstone Park | dirt-infield | false | false | Redstone Park Diamonds |
| RS-FIELD5 | Redstone - Field 5 | Redstone Park | grass | false | false | Redstone Park Diamonds |
| RS-FIELD6 | Redstone - Field 6 | Redstone Park | grass | false | false | Redstone Park Diamonds |

**Satellite Parks**

| key | name | park | surface | fenced | lighting | hierarchy1 |
|-----|------|------|---------|--------|----------|-----------|
| FP-FIELD1 | Falcon Park - Field 1 | Falcon Park | dirt-infield | true | false | Satellite Diamonds |
| FP-FIELD2 | Falcon Park - Field 2 | Falcon Park | dirt-infield | true | false | Satellite Diamonds |
| NR-FIELD1 | Northridge - Field 1 | Northridge Park | dirt-infield | true | true | Satellite Diamonds |
| NR-FIELD2 | Northridge - Field 2 | Northridge Park | dirt-infield | true | true | Satellite Diamonds |
| HH-FIELD1 | Heritage - Field 1 | Highland Heritage Regional Park | dirt-infield | true | false | Satellite Diamonds |
| HH-FIELD2 | Heritage - Field 2 | Highland Heritage Regional Park | dirt-infield | true | false | Satellite Diamonds |
| MP-FIELD1 | Marcy Park - Upper Field | Marcy Park | dirt-infield | true | false | Satellite Diamonds |
| KP-FIELD1 | Kistler Park - Field 1 | Kistler Park | dirt-infield | true | false | Satellite Diamonds |

### Multi-Use / Flag Football Fields (5)

| key | name | park | surface | lighting | hierarchy1 |
|-----|------|------|---------|----------|-----------|
| RS-STADIUM | HR Stadium at Redstone (Turf) | Redstone Park | synthetic-turf | true | Multi-Use Fields |
| TP-FIELD1 | Toepfer Park - Field 1 | Toepfer Park | grass | false | Multi-Use Fields |
| CR-FIELD1 | Cougar Run - Field 1 | Cougar Run Park | grass | false | Multi-Use Fields |
| BDC-FIELD1 | Big Dry Creek - Field 1 | Big Dry Creek Park | grass | false | Multi-Use Fields |
| PV-FIELD1 | Plum Valley - Field 1 | Plum Valley Park | grass | false | Multi-Use Fields |

### Pickleball Courts (13)

**Southpark Pickleball Complex** (400 W. County Line Rd — opened Jan 2026, 19 lighted courts, HRMD manages east courts #11-19)

| key | name | hierarchy1 |
|-----|------|-----------|
| SP-COURT11 | Southpark Court 11 | Southpark Courts |
| SP-COURT12 | Southpark Court 12 | Southpark Courts |
| SP-COURT13 | Southpark Court 13 | Southpark Courts |
| SP-COURT14 | Southpark Court 14 | Southpark Courts |
| SP-COURT15 | Southpark Court 15 | Southpark Courts |
| SP-COURT16 | Southpark Court 16 | Southpark Courts |
| SP-COURT17 | Southpark Court 17 | Southpark Courts |
| SP-COURT18 | Southpark Court 18 (Drop-In) | Southpark Courts |
| SP-COURT19 | Southpark Court 19 (Drop-In) | Southpark Courts |

All Southpark courts: surface=hard-court, lighting=true, park=Southpark Pickleball Complex

**Tanks Park** (10371 S. Broadway — 4 outdoor courts, no lights)

| key | name | hierarchy1 |
|-----|------|-----------|
| TK-COURT1 | Tanks Park Court 1 | Tanks Park Courts |
| TK-COURT2 | Tanks Park Court 2 | Tanks Park Courts |
| TK-COURT3 | Tanks Park Court 3 | Tanks Park Courts |
| TK-COURT4 | Tanks Park Court 4 | Tanks Park Courts |

All Tanks Park courts: surface=hard-court, lighting=false, park=Tanks Park

### Equipment (6)

| key | name | hierarchy1 |
|-----|------|-----------|
| EQ-BASES-A | Bases Set A | Equipment |
| EQ-BASES-B | Bases Set B | Equipment |
| EQ-BASES-C | Bases Set C | Equipment |
| EQ-PITCHMACHINE-1 | Pitching Machine 1 | Equipment |
| EQ-PITCHMACHINE-2 | Pitching Machine 2 | Equipment |
| EQ-SCOREBOARD | Portable Scoreboard | Equipment |

All equipment: type=INDIVIDUAL, class=REUSABLE

### Staff / Coordinators (5)

Based on real HRMD Recreation Services staff roles.

| key | name | certification | hierarchy1 |
|-----|------|--------------|-----------|
| STAFF-COLEEN | Coleen W. (Rec Coordinator) | coordinator | Staff |
| STAFF-LUKE | Luke R. (Baseball Coordinator) | coordinator | Staff |
| STAFF-BRENDA | Brenda W. (Rec Assistant) | certified | Staff |
| STAFF-FIELD-1 | Field Crew - Tom | volunteer | Staff |
| STAFF-FIELD-2 | Field Crew - Jess | volunteer | Staff |

### Baseball Umpires (8)

HRMD hires and trains umpires via CHSAA-certified program each summer.

| key | name | certification | hierarchy1 |
|-----|------|--------------|-----------|
| UMP-01 | Umpire Harris | chsaa-certified | Umpires |
| UMP-02 | Umpire Jacobs | chsaa-certified | Umpires |
| UMP-03 | Umpire Lee | chsaa-certified | Umpires |
| UMP-04 | Umpire Martinez | certified | Umpires |
| UMP-05 | Umpire O'Brien | certified | Umpires |
| UMP-06 | Umpire Patel | volunteer | Umpires |
| UMP-07 | Umpire Quinn | volunteer | Umpires |
| UMP-08 | Umpire Rivera | volunteer | Umpires |

### Flag Football Referees (6)

| key | name | certification | hierarchy1 |
|-----|------|--------------|-----------|
| REF-01 | Ref Adams | head-referee | Referees |
| REF-02 | Ref Brooks | certified | Referees |
| REF-03 | Ref Chen | certified | Referees |
| REF-04 | Ref Davis | certified | Referees |
| REF-05 | Ref Evans | volunteer | Referees |
| REF-06 | Ref Foster | volunteer | Referees |

### Resource JSON Format

Each resource follows this pattern:

```json
{
  "key": "RS-ROXBOROUGH",
  "name": "Redstone - Roxborough Field",
  "type": "INDIVIDUAL",
  "class": "REUSABLE",
  "hierarchy1": "Redstone Park Diamonds",
  "typedAttributes": [
    { "name": "sport", "dataType": "enum", "value": { "type": "enum", "value": "baseball" }, "category": "classification", "sequence": 1 },
    { "name": "park", "dataType": "string", "value": { "type": "string", "value": "Redstone Park" }, "category": "location", "sequence": 2 },
    { "name": "surface", "dataType": "enum", "value": { "type": "enum", "value": "dirt-infield" }, "category": "physical", "sequence": 3 },
    { "name": "lightingAvailable", "dataType": "boolean", "value": { "type": "boolean", "value": true }, "category": "physical", "sequence": 4 },
    { "name": "fenced", "dataType": "boolean", "value": { "type": "boolean", "value": true }, "category": "physical", "sequence": 5 }
  ]
}
```

**Total: 57 resources** (14 diamonds + 5 multi-use + 13 courts + 6 equipment + 5 staff + 8 umpires + 6 referees)

---

## Part 3: Calendars

Create `config/tenants/hrmd-rec-sports/data/calendars.json`

### Saturday June 6 (Primary Game Day)

- **Lighted diamonds (RS-ROXBOROUGH, RS-FLATIRONS, RS-REDROCKS, NR-FIELD1, NR-FIELD2):** 7:00 AM – 9:00 PM
- **Non-lighted diamonds (RS-SOUTH-GREEN, RS-FIELD5, RS-FIELD6, FP-FIELD1, FP-FIELD2, HH-FIELD1, HH-FIELD2, MP-FIELD1, KP-FIELD1):** 7:00 AM – 6:00 PM
- **RS-STADIUM (synthetic turf, lighted):** 8:00 AM – 9:00 PM
- **Other multi-use grass (TP-FIELD1, CR-FIELD1, BDC-FIELD1, PV-FIELD1):** 8:00 AM – 5:00 PM
- **Southpark Courts 11-19 (all lighted):** 7:00 AM – 10:00 PM
- **Tanks Park Courts 1-4 (no lights):** 7:00 AM – 6:00 PM
- **Equipment:** 6:30 AM – 9:30 PM
- **Staff:** 6:30 AM – 9:00 PM
- **Umpires:** 7:30 AM – 8:00 PM (lunch break 12:00–12:30 — TWO intervals)
- **Referees:** 8:30 AM – 7:00 PM (lunch break 12:00–12:30 — TWO intervals)

### Sunday June 7 — Partial day

- **Lighted diamonds and RS-STADIUM only:** 12:00 PM – 6:00 PM
- **Southpark Courts 11-17 only (not 18/19):** 12:00 PM – 6:00 PM
- **Equipment:** 11:30 AM – 6:30 PM
- **Staff (2 of 5):** STAFF-LUKE, STAFF-FIELD-1: 11:30 AM – 6:00 PM
- **Umpires (3 of 8):** UMP-01, UMP-02, UMP-03: 12:00 PM – 6:00 PM
- **Referees (2 of 6):** REF-01, REF-02: 12:00 PM – 6:00 PM

### Weeknight Evenings (Mon June 8 – Fri June 12)

Lighted resources only. This is where rainout makeups land.

- **Lighted diamonds (RS-ROXBOROUGH, RS-FLATIRONS, RS-REDROCKS, NR-FIELD1, NR-FIELD2):** 5:30 PM – 9:00 PM
- **RS-STADIUM:** 5:30 PM – 9:00 PM
- **Southpark Courts 11-17 (not 18/19 — reserved for drop-in):** 5:30 PM – 10:00 PM
- **Equipment:** 5:00 PM – 9:30 PM
- **Staff (2 per night, rotate):**
  - Mon/Wed/Fri: STAFF-BRENDA, STAFF-FIELD-1
  - Tue/Thu: STAFF-LUKE, STAFF-FIELD-2
- **Umpires (3 per night, rotate):**
  - Mon/Wed: UMP-01, UMP-04, UMP-06
  - Tue/Thu: UMP-02, UMP-05, UMP-07
  - Fri: UMP-03, UMP-04, UMP-08
- **Referees (2 per night, rotate):**
  - Mon/Wed/Fri: REF-01, REF-04
  - Tue/Thu: REF-02, REF-05

### Calendar JSON Examples

Lighted diamond (full week):
```json
{
  "resourceKey": "RS-ROXBOROUGH",
  "intervals": [
    { "start": "2026-06-06T07:00:00Z", "end": "2026-06-06T21:00:00Z", "qty": 1 },
    { "start": "2026-06-07T12:00:00Z", "end": "2026-06-07T18:00:00Z", "qty": 1 },
    { "start": "2026-06-08T17:30:00Z", "end": "2026-06-08T21:00:00Z", "qty": 1 },
    { "start": "2026-06-09T17:30:00Z", "end": "2026-06-09T21:00:00Z", "qty": 1 },
    { "start": "2026-06-10T17:30:00Z", "end": "2026-06-10T21:00:00Z", "qty": 1 },
    { "start": "2026-06-11T17:30:00Z", "end": "2026-06-11T21:00:00Z", "qty": 1 },
    { "start": "2026-06-12T17:30:00Z", "end": "2026-06-12T21:00:00Z", "qty": 1 }
  ]
}
```

Non-lighted diamond (Saturday only):
```json
{
  "resourceKey": "FP-FIELD1",
  "intervals": [
    { "start": "2026-06-06T07:00:00Z", "end": "2026-06-06T18:00:00Z", "qty": 1 }
  ]
}
```

Umpire with Saturday lunch break + weeknight evenings:
```json
{
  "resourceKey": "UMP-01",
  "intervals": [
    { "start": "2026-06-06T07:30:00Z", "end": "2026-06-06T12:00:00Z", "qty": 1 },
    { "start": "2026-06-06T12:30:00Z", "end": "2026-06-06T20:00:00Z", "qty": 1 },
    { "start": "2026-06-07T12:00:00Z", "end": "2026-06-07T18:00:00Z", "qty": 1 },
    { "start": "2026-06-08T17:30:00Z", "end": "2026-06-08T21:00:00Z", "qty": 1 },
    { "start": "2026-06-10T17:30:00Z", "end": "2026-06-10T21:00:00Z", "qty": 1 }
  ]
}
```
## Part 4: State Changes

Create `config/tenants/hrmd-rec-sports/data/state-changes.json`

```json
[]
```

---

## Part 5: Orders (Games)

Create `config/tenants/hrmd-rec-sports/data/orders.json`

### HRMD Summer Baseball Divisions

Based on real HRMD recreation baseball programs.

| Division | Ages | Teams | Games Week 1 | Game Duration | Preferred Fields |
|----------|------|-------|-------------|---------------|-----------------|
| T-Ball | 4-6 | 12 (6 games) | 6 | 60 min | Grass fields: RS-FIELD5, RS-FIELD6, then satellite parks |
| Coach Pitch | 7-8 | 10 (5 games) | 5 | 75 min | Satellite dirt diamonds: FP, HH, MP, KP |
| Minors | 9-10 | 8 (4 games) | 4 | 90 min | Any dirt diamond, prefer Northridge/Redstone |
| Majors | 11-12 | 8 (4 games) | 4 | 120 min | Lighted fenced diamonds: RS-ROXBOROUGH, RS-FLATIRONS, RS-REDROCKS |

### HRMD Flag Football (Coed, 5v5, Saturday games)

Based on real HRMD rec flag football — grades K-8th, games on Saturdays.

| Division | Grades | Teams | Games Week 1 | Game Duration | Preferred Fields |
|----------|--------|-------|-------------|---------------|-----------------|
| K-2nd | K-2 | 8 (4 games) | 4 | 45 min | Multi-use grass: TP-FIELD1, CR-FIELD1, BDC-FIELD1, PV-FIELD1 |
| 3rd-5th | 3-5 | 6 (3 games) | 3 | 60 min | RS-STADIUM (turf), multi-use grass |
| 6th-8th | 6-8 | 4 (2 games) | 2 | 60 min | RS-STADIUM (turf) |

### Adult Pickleball League (Southpark Complex)

| Division | Pairs | Matches Week 1 | Match Duration | Courts |
|----------|-------|----------------|----------------|--------|
| Open Doubles | 8 (4 matches) | 4 | 90 min | Southpark Courts 11-17 |

**Totals: 19 baseball + 9 flag football + 4 pickleball = 32 games = 32 orders = 96 tasks**

### Team Names

**T-Ball (12):** Rockies, Nuggets, Broncos, Avalanche, Rapids, Mammoth, Thunder, Lightning, Rockets, Comets, Tigers, Bears

**Coach Pitch (10):** Blazers, Strikers, Rebels, Mavericks, Knights, Titans, Rangers, Spartans, Warriors, Crusaders

**Minors (8):** Aces, Diamondbacks, Storm, Phantoms, Huskies, Outlaws, Legends, Fury

**Majors (8):** Mustangs, Stallions, Gladiators, Centurions, Falcons, Jaguars, Ironmen, Hammers

**Flag K-2 (8):** Chiefs, Chargers, Packers, Vikings, Ravens, Steelers, Patriots, 49ers

**Flag 3-5 (6):** Broncos Orange, Broncos Blue, Bills, Eagles, Lions, Dolphins

**Flag 6-8 (4):** Team Alpha, Team Beta, Team Gamma, Team Delta

**Pickleball (8 pairs):** Anderson/Baker, Chen/Davis, Evans/Foster, Garcia/Hayes, Ito/Jones, Kim/Lopez, Moore/Nguyen, Park/Quinn

### Game Matchups (pair teams sequentially)

**T-Ball (6 games):**
01: Rockies vs Nuggets, 02: Broncos vs Avalanche, 03: Rapids vs Mammoth, 04: Thunder vs Lightning, 05: Rockets vs Comets, 06: Tigers vs Bears

**Coach Pitch (5 games):**
01: Blazers vs Strikers, 02: Rebels vs Mavericks, 03: Knights vs Titans, 04: Rangers vs Spartans, 05: Warriors vs Crusaders

**Minors (4 games):**
01: Aces vs Diamondbacks, 02: Storm vs Phantoms, 03: Huskies vs Outlaws, 04: Legends vs Fury

**Majors (4 games):**
01: Mustangs vs Stallions, 02: Gladiators vs Centurions, 03: Falcons vs Jaguars, 04: Ironmen vs Hammers

**Flag K-2 (4 games):**
01: Chiefs vs Chargers, 02: Packers vs Vikings, 03: Ravens vs Steelers, 04: Patriots vs 49ers

**Flag 3-5 (3 games):**
01: Broncos Orange vs Broncos Blue, 02: Bills vs Eagles, 03: Lions vs Dolphins

**Flag 6-8 (2 games):**
01: Team Alpha vs Team Beta, 02: Team Gamma vs Team Delta

**Pickleball (4 matches):**
01: Anderson/Baker vs Chen/Davis, 02: Evans/Foster vs Garcia/Hayes, 03: Ito/Jones vs Kim/Lopez, 04: Moore/Nguyen vs Park/Quinn

### Game Key Convention

- T-Ball: `GAME-BB-TB-W1-{nn}` (01-06)
- Coach Pitch: `GAME-BB-CP-W1-{nn}` (01-05)
- Minors: `GAME-BB-MN-W1-{nn}` (01-04)
- Majors: `GAME-BB-MJ-W1-{nn}` (01-04)
- Flag K-2: `GAME-FF-K2-W1-{nn}` (01-04)
- Flag 3-5: `GAME-FF-35-W1-{nn}` (01-03)
- Flag 6-8: `GAME-FF-68-W1-{nn}` (01-02)
- Pickleball: `GAME-PB-W1-{nn}` (01-04)

### Priority by Division

| Priority | Division |
|----------|----------|
| 1 | Majors (oldest kids, most competitive) |
| 2 | Minors, Flag 6-8 |
| 3 | Coach Pitch, Flag 3-5 |
| 4 | T-Ball, Flag K-2 |
| 5 | Pickleball (most flexible) |

### Order JSON Format

```json
{
  "key": "GAME-BB-TB-W1-01",
  "name": "T-Ball: Rockies vs Nuggets (Wk1)",
  "productKey": "baseball-tball",
  "demandQty": 1,
  "dueDate": "2026-06-06T21:00:00Z",
  "priority": 4,
  "typedAttributes": [
    { "name": "sport", "dataType": "string", "value": { "type": "string", "value": "baseball" }, "category": "game", "sequence": 1 },
    { "name": "division", "dataType": "string", "value": { "type": "string", "value": "T-Ball" }, "category": "game", "sequence": 2 },
    { "name": "gameWeek", "dataType": "integer", "value": { "type": "integer", "value": 1 }, "category": "game", "sequence": 3 },
    { "name": "homeTeam", "dataType": "string", "value": { "type": "string", "value": "Rockies" }, "category": "game", "sequence": 4 },
    { "name": "awayTeam", "dataType": "string", "value": { "type": "string", "value": "Nuggets" }, "category": "game", "sequence": 5 }
  ]
}
```

---

## Part 6: Tasks (3-Task Chains per Game)

Create `config/tenants/hrmd-rec-sports/data/tasks.json`

Each game = 1 order = 3 linked tasks forming a chain:

1. **PREP** (type: SETUP, subType: prep) — Field setup
2. **PLAY** (type: PROCESS, subType: play) — The game
3. **RESET** (type: TEARDOWN, subType: reset) — Cleanup

### Duration Reference

| Sport | Division | Prep | Play | Reset |
|-------|----------|------|------|-------|
| Baseball | T-Ball | 600s (10m) | 3600s (60m) | 600s (10m) |
| Baseball | Coach Pitch | 900s (15m) | 4500s (75m) | 600s (10m) |
| Baseball | Minors | 900s (15m) | 5400s (90m) | 900s (15m) |
| Baseball | Majors | 1200s (20m) | 7200s (120m) | 900s (15m) |
| Flag Football | K-2 | 600s (10m) | 2700s (45m) | 600s (10m) |
| Flag Football | 3-5 | 600s (10m) | 3600s (60m) | 600s (10m) |
| Flag Football | 6-8 | 600s (10m) | 3600s (60m) | 600s (10m) |
| Pickleball | Open | 300s (5m) | 5400s (90m) | 300s (5m) |

### Resource Requirements by Phase

**Baseball T-Ball:**
- PREP: Field (primary) + Field Crew + Bases
- PLAY: Field (primary) + 1 Umpire
- RESET: Field (primary) + Field Crew

**Baseball Coach Pitch:**
- PREP: Field (primary) + Field Crew + Bases + Pitching Machine
- PLAY: Field (primary) + 1 Umpire + Pitching Machine
- RESET: Field (primary) + Field Crew

**Baseball Minors:**
- PREP: Field (primary) + Field Crew + Bases
- PLAY: Field (primary) + 2 Umpires
- RESET: Field (primary) + Field Crew

**Baseball Majors:**
- PREP: Field (primary) + Field Crew + Bases + Scoreboard
- PLAY: Field (primary) + 2 Umpires + Scoreboard
- RESET: Field (primary) + Field Crew

**Flag Football (all divisions):**
- PREP: Multi-use field (primary) + Field Crew
- PLAY: Multi-use field (primary) + 1 Referee (K-2) or 2 Referees (3-5, 6-8)
- RESET: Multi-use field (primary) + Field Crew

**Pickleball:**
- PREP: Court (primary) + Staff coordinator
- PLAY: Court (primary) only (self-officiated)
- RESET: Court (primary)

### Field Preference Lists by Division

**T-Ball** (grass fields, smaller diamonds OK): RS-FIELD5 (rank 1), RS-FIELD6 (rank 2), RS-SOUTH-GREEN (rank 3), TP-FIELD1 (rank 4), CR-FIELD1 (rank 5), BDC-FIELD1 (rank 6)

**Coach Pitch** (dirt diamonds at satellite parks): FP-FIELD1 (1), FP-FIELD2 (2), HH-FIELD1 (3), HH-FIELD2 (4), MP-FIELD1 (5), KP-FIELD1 (6), RS-SOUTH-GREEN (7)

**Minors** (dirt diamonds, prefer larger parks): NR-FIELD1 (1), NR-FIELD2 (2), RS-SOUTH-GREEN (3), FP-FIELD1 (4), FP-FIELD2 (5), HH-FIELD1 (6), HH-FIELD2 (7)

**Majors** (lighted fenced diamonds at Redstone only): RS-ROXBOROUGH (1), RS-FLATIRONS (2), RS-REDROCKS (3), NR-FIELD1 (4), NR-FIELD2 (5)

**Flag K-2** (multi-use grass): TP-FIELD1 (1), CR-FIELD1 (2), BDC-FIELD1 (3), PV-FIELD1 (4)

**Flag 3-5** (prefer turf): RS-STADIUM (1), TP-FIELD1 (2), CR-FIELD1 (3), BDC-FIELD1 (4)

**Flag 6-8** (turf required): RS-STADIUM (1), TP-FIELD1 (2)

**Pickleball** (Southpark courts, not 18/19 which are drop-in): SP-COURT11 (1), SP-COURT12 (2), SP-COURT13 (3), SP-COURT14 (4), SP-COURT15 (5), SP-COURT16 (6), SP-COURT17 (7)

### Chain Linking Rules

For a game with key `GAME-BB-MJ-W1-01`:

| Task Key | type | subType | seq | linkId.name | linkId.prevLink |
|----------|------|---------|-----|------------|----------------|
| GAME-BB-MJ-W1-01-PREP | SETUP | prep | 1 | GAME-BB-MJ-W1-01 | "" |
| GAME-BB-MJ-W1-01-PLAY | PROCESS | play | 2 | GAME-BB-MJ-W1-01 | GAME-BB-MJ-W1-01-PREP |
| GAME-BB-MJ-W1-01-RESET | TEARDOWN | reset | 3 | GAME-BB-MJ-W1-01 | GAME-BB-MJ-W1-01-PLAY |

All three tasks in a chain share `linkId.type = "game"`.

### Task Window

ALL tasks use the full week window so the solver CAN place games on weeknight evenings if Saturday is full or if a rainout forces rescheduling:

```json
"window": {
  "start": "2026-06-06T06:00:00Z",
  "end": "2026-06-13T00:00:00Z"
}
```

The solver will naturally prefer Saturday due to earliest-start scoring.

### Example: Complete 3-Task Chain (Majors Game 1: Mustangs vs Stallions)

```json
[
  {
    "key": "GAME-BB-MJ-W1-01-PREP",
    "name": "Prep: Mustangs vs Stallions",
    "type": "SETUP",
    "subType": "prep",
    "sequence": 1,
    "process": "baseball-majors",
    "linkId": {
      "name": "GAME-BB-MJ-W1-01",
      "type": "game",
      "prevLink": ""
    },
    "window": {
      "start": "2026-06-06T06:00:00Z",
      "end": "2026-06-13T00:00:00Z"
    },
    "duration": { "seconds": 1200, "type": "FIXED" },
    "capacityResources": [
      {
        "isPrimary": true,
        "preferences": [
          { "resourceKey": "RS-ROXBOROUGH", "rank": 1 },
          { "resourceKey": "RS-FLATIRONS", "rank": 2 },
          { "resourceKey": "RS-REDROCKS", "rank": 3 },
          { "resourceKey": "NR-FIELD1", "rank": 4 },
          { "resourceKey": "NR-FIELD2", "rank": 5 }
        ]
      },
      {
        "isPrimary": false,
        "preferences": [
          { "resourceKey": "STAFF-FIELD-1", "rank": 1 },
          { "resourceKey": "STAFF-FIELD-2", "rank": 2 }
        ]
      },
      {
        "isPrimary": false,
        "preferences": [
          { "resourceKey": "EQ-BASES-A", "rank": 1 },
          { "resourceKey": "EQ-BASES-B", "rank": 2 },
          { "resourceKey": "EQ-BASES-C", "rank": 3 }
        ]
      },
      {
        "isPrimary": false,
        "preferences": [
          { "resourceKey": "EQ-SCOREBOARD", "rank": 1 }
        ]
      }
    ],
    "typedAttributes": [
      { "name": "sport", "dataType": "enum", "value": { "type": "enum", "value": "baseball" }, "category": "game", "sequence": 1 },
      { "name": "division", "dataType": "string", "value": { "type": "string", "value": "Majors" }, "category": "game", "sequence": 2 },
      { "name": "homeTeam", "dataType": "string", "value": { "type": "string", "value": "Mustangs" }, "category": "game", "sequence": 3 },
      { "name": "awayTeam", "dataType": "string", "value": { "type": "string", "value": "Stallions" }, "category": "game", "sequence": 4 },
      { "name": "gameWeek", "dataType": "integer", "value": { "type": "integer", "value": 1 }, "category": "game", "sequence": 5 },
      { "name": "phase", "dataType": "enum", "value": { "type": "enum", "value": "prep" }, "category": "game", "sequence": 6 }
    ]
  },
  {
    "key": "GAME-BB-MJ-W1-01-PLAY",
    "name": "Majors: Mustangs vs Stallions",
    "type": "PROCESS",
    "subType": "play",
    "sequence": 2,
    "process": "baseball-majors",
    "linkId": {
      "name": "GAME-BB-MJ-W1-01",
      "type": "game",
      "prevLink": "GAME-BB-MJ-W1-01-PREP"
    },
    "window": {
      "start": "2026-06-06T06:00:00Z",
      "end": "2026-06-13T00:00:00Z"
    },
    "duration": { "seconds": 7200, "type": "FIXED" },
    "capacityResources": [
      {
        "isPrimary": true,
        "preferences": [
          { "resourceKey": "RS-ROXBOROUGH", "rank": 1 },
          { "resourceKey": "RS-FLATIRONS", "rank": 2 },
          { "resourceKey": "RS-REDROCKS", "rank": 3 },
          { "resourceKey": "NR-FIELD1", "rank": 4 },
          { "resourceKey": "NR-FIELD2", "rank": 5 }
        ]
      },
      {
        "isPrimary": false,
        "preferences": [
          { "resourceKey": "UMP-01", "rank": 1 },
          { "resourceKey": "UMP-02", "rank": 2 },
          { "resourceKey": "UMP-03", "rank": 3 },
          { "resourceKey": "UMP-04", "rank": 4 },
          { "resourceKey": "UMP-05", "rank": 5 },
          { "resourceKey": "UMP-06", "rank": 6 },
          { "resourceKey": "UMP-07", "rank": 7 },
          { "resourceKey": "UMP-08", "rank": 8 }
        ]
      },
      {
        "isPrimary": false,
        "preferences": [
          { "resourceKey": "UMP-01", "rank": 1 },
          { "resourceKey": "UMP-02", "rank": 2 },
          { "resourceKey": "UMP-03", "rank": 3 },
          { "resourceKey": "UMP-04", "rank": 4 },
          { "resourceKey": "UMP-05", "rank": 5 },
          { "resourceKey": "UMP-06", "rank": 6 },
          { "resourceKey": "UMP-07", "rank": 7 },
          { "resourceKey": "UMP-08", "rank": 8 }
        ]
      },
      {
        "isPrimary": false,
        "preferences": [
          { "resourceKey": "EQ-SCOREBOARD", "rank": 1 }
        ]
      }
    ],
    "typedAttributes": [
      { "name": "sport", "dataType": "enum", "value": { "type": "enum", "value": "baseball" }, "category": "game", "sequence": 1 },
      { "name": "division", "dataType": "string", "value": { "type": "string", "value": "Majors" }, "category": "game", "sequence": 2 },
      { "name": "homeTeam", "dataType": "string", "value": { "type": "string", "value": "Mustangs" }, "category": "game", "sequence": 3 },
      { "name": "awayTeam", "dataType": "string", "value": { "type": "string", "value": "Stallions" }, "category": "game", "sequence": 4 },
      { "name": "gameWeek", "dataType": "integer", "value": { "type": "integer", "value": 1 }, "category": "game", "sequence": 5 },
      { "name": "phase", "dataType": "enum", "value": { "type": "enum", "value": "play" }, "category": "game", "sequence": 6 }
    ]
  },
  {
    "key": "GAME-BB-MJ-W1-01-RESET",
    "name": "Reset: Mustangs vs Stallions",
    "type": "TEARDOWN",
    "subType": "reset",
    "sequence": 3,
    "process": "baseball-majors",
    "linkId": {
      "name": "GAME-BB-MJ-W1-01",
      "type": "game",
      "prevLink": "GAME-BB-MJ-W1-01-PLAY"
    },
    "window": {
      "start": "2026-06-06T06:00:00Z",
      "end": "2026-06-13T00:00:00Z"
    },
    "duration": { "seconds": 900, "type": "FIXED" },
    "capacityResources": [
      {
        "isPrimary": true,
        "preferences": [
          { "resourceKey": "RS-ROXBOROUGH", "rank": 1 },
          { "resourceKey": "RS-FLATIRONS", "rank": 2 },
          { "resourceKey": "RS-REDROCKS", "rank": 3 },
          { "resourceKey": "NR-FIELD1", "rank": 4 },
          { "resourceKey": "NR-FIELD2", "rank": 5 }
        ]
      },
      {
        "isPrimary": false,
        "preferences": [
          { "resourceKey": "STAFF-FIELD-1", "rank": 1 },
          { "resourceKey": "STAFF-FIELD-2", "rank": 2 }
        ]
      }
    ],
    "typedAttributes": [
      { "name": "sport", "dataType": "enum", "value": { "type": "enum", "value": "baseball" }, "category": "game", "sequence": 1 },
      { "name": "division", "dataType": "string", "value": { "type": "string", "value": "Majors" }, "category": "game", "sequence": 2 },
      { "name": "homeTeam", "dataType": "string", "value": { "type": "string", "value": "Mustangs" }, "category": "game", "sequence": 3 },
      { "name": "awayTeam", "dataType": "string", "value": { "type": "string", "value": "Stallions" }, "category": "game", "sequence": 4 },
      { "name": "gameWeek", "dataType": "integer", "value": { "type": "integer", "value": 1 }, "category": "game", "sequence": 5 },
      { "name": "phase", "dataType": "enum", "value": { "type": "enum", "value": "reset" }, "category": "game", "sequence": 6 }
    ]
  }
]
```

### CRITICAL RULES FOR ALL 96 TASKS:

1. **All 3 tasks in a chain MUST share the SAME field resource preference list** so the solver assigns them to the same field.
2. **PREP tasks** have `prevLink: ""` (chain start).
3. **PLAY tasks** have `prevLink` pointing to the PREP task key.
4. **RESET tasks** have `prevLink` pointing to the PLAY task key.
5. **All tasks use the full-week window** (`2026-06-06T06:00:00Z` to `2026-06-13T00:00:00Z`).
6. **Majors PLAY requires 2 separate umpire capacity resource entries** (two umpire slots, each with the full umpire preference list). Same for Minors PLAY.
7. **Flag 3-5 and 6-8 PLAY requires 2 separate referee capacity resource entries.**
8. **Coach Pitch PREP and PLAY both include pitching machine** in capacity resources.

### Generate ALL 32 games × 3 tasks = 96 tasks

Follow the pattern above for every game. Use the matchups, durations, resource requirements, and field preference lists defined in this document.

---

## Part 7: Processes

Create `config/tenants/hrmd-rec-sports/data/processes.json`

```json
[
  { "key": "baseball-tball", "name": "T-Ball Game", "category": "baseball" },
  { "key": "baseball-coachpitch", "name": "Coach Pitch Game", "category": "baseball" },
  { "key": "baseball-minors", "name": "Minors Game", "category": "baseball" },
  { "key": "baseball-majors", "name": "Majors Game", "category": "baseball" },
  { "key": "flag-football-k2", "name": "Flag Football K-2", "category": "flag-football" },
  { "key": "flag-football-35", "name": "Flag Football 3-5", "category": "flag-football" },
  { "key": "flag-football-68", "name": "Flag Football 6-8", "category": "flag-football" },
  { "key": "pickleball-open", "name": "Pickleball Open Doubles", "category": "pickleball" }
]
```

---

## Part 8: Verification Checklist

After generating all files, verify:

- [ ] **57 resources** in resources.json (14 diamonds + 5 multi-use + 13 courts + 6 equipment + 5 staff + 8 umpires + 6 referees)
- [ ] **32 orders** in orders.json (6 T-Ball + 5 Coach Pitch + 4 Minors + 4 Majors + 4 Flag K-2 + 3 Flag 3-5 + 2 Flag 6-8 + 4 Pickleball)
- [ ] **96 tasks** in tasks.json (32 games × 3 tasks each)
- [ ] **57 calendar entries** in calendars.json (one per resource)
- [ ] Every task has `linkId.name` matching its order key
- [ ] PREP tasks have `prevLink: ""`
- [ ] PLAY tasks have `prevLink` pointing to PREP key
- [ ] RESET tasks have `prevLink` pointing to PLAY key
- [ ] All 3 tasks in each chain share the SAME field preference list (primary resource)
- [ ] Durations match the reference table
- [ ] Lighted resources have weeknight evening + Sunday intervals
- [ ] Non-lighted resources have Saturday-only intervals
- [ ] Umpire/referee Saturday calendars have lunch break split (two intervals)
- [ ] Scoring weights sum to 1.0
- [ ] `hierarchy1` set on every resource
- [ ] Majors/Minors PLAY tasks have 2 separate umpire capacity entries
- [ ] Flag 3-5/6-8 PLAY tasks have 2 separate referee capacity entries
- [ ] Coach Pitch includes pitching machine in PREP and PLAY

---

## Part 9: Test Commands

```bash
TENANT_ID=hrmd-rec-sports npm run start:dev

curl -X POST http://localhost:3001/v1/state/sync \
  -H "X-Tenant-Id: hrmd-rec-sports"

curl http://localhost:3001/v1/state/summary \
  -H "X-Tenant-Id: hrmd-rec-sports"

curl -X POST http://localhost:3001/v1/solve \
  -H "X-Tenant-Id: hrmd-rec-sports" \
  -d '{"strategy": "Chain"}'
```

---

## Part 10: Expected Behavior & Rainout Demo

### What to look for in the solve result:

- **Chain propagation:** Prep → Play → Reset scheduled in sequence on the same field
- **Saturday packing:** Most/all games land on Saturday (earliest-start scoring)
- **No double-booking:** Each field has at most one game at a time
- **Umpire distribution:** Umpires spread across games, not stacked on one
- **Division time flow:** T-Ball morning, Majors into evening (longer games)
- **Weeknight spillover:** If Saturday overloads, lower-priority games may land on Sunday or weeknight evenings — correct behavior
- **Lighting constraint:** Non-lighted fields Saturday only. Weeknight games only on lighted fields.
- **Stadium contention:** RS-STADIUM shared across Flag 3-5 and Flag 6-8 divisions

### Rainout Demo Script

1. **Solve normally** — observe Saturday-packed schedule across Redstone, Falcon, Northridge, Heritage parks
2. **Simulate morning rain:** Exclude RS-ROXBOROUGH, RS-FLATIRONS, RS-REDROCKS, RS-FIELD5, RS-FIELD6 (all Redstone fields flooded)
3. **Re-solve** — displaced Majors games move to NR-FIELD1/NR-FIELD2, or push to weeknight evenings at lighted diamonds
4. **Check infeasible** — some games may not fit (umpire constraint)
5. **Restore fields, re-solve** — back to normal

### Weather Hotline Reference

Real HRMD weather info: Call 720-348-6970 or check online field closure updates at highlandsranch.org/recreation/field-skate-park-closures. Weekday closures determined by 3 PM, weekend closures by 7 AM.
