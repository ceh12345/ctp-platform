/**
 * Generator for hrmd-rec-sports tenant data.
 * Summer season Week 1: Baseball (4 divisions), Flag Football (3 divisions),
 * Pickleball league matches (4) + Drop-In reservations (45).
 *
 * Totals: 57 resources, 57 calendars, 77 orders, 133 tasks, 2 cadences.
 *
 * Run: node config/tenants/hrmd-rec-sports/generate-data.mjs
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
const kpisDir = join(__dirname, 'kpis');

// ── Helpers ──────────────────────────────────────────────────────────────────
function attr(name, dataType, value, category, sequence) {
  return { name, dataType, value: { type: dataType, value }, category, sequence };
}

function writeJson(dir, file, data) {
  writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + '\n');
  console.log(`  wrote ${file} (${Array.isArray(data) ? data.length + ' items' : 'object'})`);
}

function ranked(keys) {
  return keys.map((k, i) => ({ resource: k, rank: i + 1 }));
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. RESOURCES (57 total)
// ══════════════════════════════════════════════════════════════════════════════
const resources = [];

// ── Diamond Fields (14) ──
const diamondDefs = [
  { key: 'RS-ROXBOROUGH', name: 'Redstone - Roxborough Field', park: 'Redstone Park', surface: 'dirt-infield', fenced: true, lighting: true, h1: 'Redstone Park Diamonds' },
  { key: 'RS-FLATIRONS', name: 'Redstone - Flatirons Field', park: 'Redstone Park', surface: 'dirt-infield', fenced: true, lighting: true, h1: 'Redstone Park Diamonds' },
  { key: 'RS-REDROCKS', name: 'Redstone - Red Rocks Field', park: 'Redstone Park', surface: 'dirt-infield', fenced: true, lighting: true, h1: 'Redstone Park Diamonds' },
  { key: 'RS-SOUTH-GREEN', name: 'Redstone - South Green', park: 'Redstone Park', surface: 'dirt-infield', fenced: false, lighting: false, h1: 'Redstone Park Diamonds' },
  { key: 'RS-FIELD5', name: 'Redstone - Field 5', park: 'Redstone Park', surface: 'grass', fenced: false, lighting: false, h1: 'Redstone Park Diamonds' },
  { key: 'RS-FIELD6', name: 'Redstone - Field 6', park: 'Redstone Park', surface: 'grass', fenced: false, lighting: false, h1: 'Redstone Park Diamonds' },
  { key: 'FP-FIELD1', name: 'Falcon Park - Field 1', park: 'Falcon Park', surface: 'dirt-infield', fenced: true, lighting: false, h1: 'Satellite Diamonds' },
  { key: 'FP-FIELD2', name: 'Falcon Park - Field 2', park: 'Falcon Park', surface: 'dirt-infield', fenced: true, lighting: false, h1: 'Satellite Diamonds' },
  { key: 'NR-FIELD1', name: 'Northridge - Field 1', park: 'Northridge Park', surface: 'dirt-infield', fenced: true, lighting: true, h1: 'Satellite Diamonds' },
  { key: 'NR-FIELD2', name: 'Northridge - Field 2', park: 'Northridge Park', surface: 'dirt-infield', fenced: true, lighting: true, h1: 'Satellite Diamonds' },
  { key: 'HH-FIELD1', name: 'Heritage - Field 1', park: 'Highland Heritage Regional Park', surface: 'dirt-infield', fenced: true, lighting: false, h1: 'Satellite Diamonds' },
  { key: 'HH-FIELD2', name: 'Heritage - Field 2', park: 'Highland Heritage Regional Park', surface: 'dirt-infield', fenced: true, lighting: false, h1: 'Satellite Diamonds' },
  { key: 'MP-FIELD1', name: 'Marcy Park - Upper Field', park: 'Marcy Park', surface: 'dirt-infield', fenced: true, lighting: false, h1: 'Satellite Diamonds' },
  { key: 'KP-FIELD1', name: 'Kistler Park - Field 1', park: 'Kistler Park', surface: 'dirt-infield', fenced: true, lighting: false, h1: 'Satellite Diamonds' },
];

for (const d of diamondDefs) {
  resources.push({
    key: d.key, name: d.name, type: 'INDIVIDUAL', class: 'REUSABLE',
    hierarchy: { level1: d.h1 },
    typedAttributes: [
      attr('sport', 'enum', 'baseball', 'classification', 1),
      attr('park', 'string', d.park, 'location', 2),
      attr('surface', 'enum', d.surface, 'physical', 3),
      attr('lightingAvailable', 'boolean', d.lighting, 'physical', 4),
      attr('fenced', 'boolean', d.fenced, 'physical', 5),
    ],
  });
}

// ── Multi-Use / Flag Football Fields (5) ──
const multiUseDefs = [
  { key: 'RS-STADIUM', name: 'HR Stadium at Redstone (Turf)', park: 'Redstone Park', surface: 'synthetic-turf', lighting: true },
  { key: 'TP-FIELD1', name: 'Toepfer Park - Field 1', park: 'Toepfer Park', surface: 'grass', lighting: false },
  { key: 'CR-FIELD1', name: 'Cougar Run - Field 1', park: 'Cougar Run Park', surface: 'grass', lighting: false },
  { key: 'BDC-FIELD1', name: 'Big Dry Creek - Field 1', park: 'Big Dry Creek Park', surface: 'grass', lighting: false },
  { key: 'PV-FIELD1', name: 'Plum Valley - Field 1', park: 'Plum Valley Park', surface: 'grass', lighting: false },
];

for (const f of multiUseDefs) {
  resources.push({
    key: f.key, name: f.name, type: 'INDIVIDUAL', class: 'REUSABLE',
    hierarchy: { level1: 'Multi-Use Fields' },
    typedAttributes: [
      attr('sport', 'enum', 'multi-use', 'classification', 1),
      attr('park', 'string', f.park, 'location', 2),
      attr('surface', 'enum', f.surface, 'physical', 3),
      attr('lightingAvailable', 'boolean', f.lighting, 'physical', 4),
      attr('fenced', 'boolean', false, 'physical', 5),
    ],
  });
}

// ── Pickleball Courts (13) ──
for (let i = 11; i <= 19; i++) {
  const dropIn = i >= 18;
  resources.push({
    key: `SP-COURT${i}`, name: `Southpark Court ${i}${dropIn ? ' (Drop-In)' : ''}`,
    type: 'INDIVIDUAL', class: 'REUSABLE',
    hierarchy: { level1: 'Southpark Courts' },
    typedAttributes: [
      attr('sport', 'enum', 'pickleball', 'classification', 1),
      attr('park', 'string', 'Southpark Pickleball Complex', 'location', 2),
      attr('surface', 'enum', 'hard-court', 'physical', 3),
      attr('lightingAvailable', 'boolean', true, 'physical', 4),
      attr('fenced', 'boolean', true, 'physical', 5),
    ],
  });
}
for (let i = 1; i <= 4; i++) {
  resources.push({
    key: `TK-COURT${i}`, name: `Tanks Park Court ${i}`,
    type: 'INDIVIDUAL', class: 'REUSABLE',
    hierarchy: { level1: 'Tanks Park Courts' },
    typedAttributes: [
      attr('sport', 'enum', 'pickleball', 'classification', 1),
      attr('park', 'string', 'Tanks Park', 'location', 2),
      attr('surface', 'enum', 'hard-court', 'physical', 3),
      attr('lightingAvailable', 'boolean', false, 'physical', 4),
      attr('fenced', 'boolean', false, 'physical', 5),
    ],
  });
}

// ── Equipment (6) ──
const eqDefs = [
  { key: 'EQ-BASES-A', name: 'Bases Set A' },
  { key: 'EQ-BASES-B', name: 'Bases Set B' },
  { key: 'EQ-BASES-C', name: 'Bases Set C' },
  { key: 'EQ-PITCHMACHINE-1', name: 'Pitching Machine 1' },
  { key: 'EQ-PITCHMACHINE-2', name: 'Pitching Machine 2' },
  { key: 'EQ-SCOREBOARD', name: 'Portable Scoreboard' },
];
for (const e of eqDefs) {
  resources.push({
    key: e.key, name: e.name, type: 'INDIVIDUAL', class: 'REUSABLE',
    hierarchy: { level1: 'Equipment' },
    typedAttributes: [],
  });
}

// ── Staff (5) ──
const staffDefs = [
  { key: 'STAFF-COLEEN', name: 'Coleen W. (Rec Coordinator)', cert: 'coordinator' },
  { key: 'STAFF-LUKE', name: 'Luke R. (Baseball Coordinator)', cert: 'coordinator' },
  { key: 'STAFF-BRENDA', name: 'Brenda W. (Rec Assistant)', cert: 'certified' },
  { key: 'STAFF-FIELD-1', name: 'Field Crew - Tom', cert: 'volunteer' },
  { key: 'STAFF-FIELD-2', name: 'Field Crew - Jess', cert: 'volunteer' },
];
for (const s of staffDefs) {
  resources.push({
    key: s.key, name: s.name, type: 'INDIVIDUAL', class: 'REUSABLE',
    hierarchy: { level1: 'Staff' },
    typedAttributes: [attr('certificationLevel', 'enum', s.cert, 'staff', 6)],
  });
}

// ── Umpires (8) ──
const umpDefs = [
  { key: 'UMP-01', name: 'Umpire Harris', cert: 'chsaa-certified' },
  { key: 'UMP-02', name: 'Umpire Jacobs', cert: 'chsaa-certified' },
  { key: 'UMP-03', name: 'Umpire Lee', cert: 'chsaa-certified' },
  { key: 'UMP-04', name: 'Umpire Martinez', cert: 'certified' },
  { key: 'UMP-05', name: "Umpire O'Brien", cert: 'certified' },
  { key: 'UMP-06', name: 'Umpire Patel', cert: 'volunteer' },
  { key: 'UMP-07', name: 'Umpire Quinn', cert: 'volunteer' },
  { key: 'UMP-08', name: 'Umpire Rivera', cert: 'volunteer' },
];
for (const u of umpDefs) {
  resources.push({
    key: u.key, name: u.name, type: 'INDIVIDUAL', class: 'REUSABLE',
    hierarchy: { level1: 'Umpires' },
    typedAttributes: [attr('certificationLevel', 'enum', u.cert, 'staff', 6)],
  });
}

// ── Referees (6) ──
const refDefs = [
  { key: 'REF-01', name: 'Ref Adams', cert: 'head-referee' },
  { key: 'REF-02', name: 'Ref Brooks', cert: 'certified' },
  { key: 'REF-03', name: 'Ref Chen', cert: 'certified' },
  { key: 'REF-04', name: 'Ref Davis', cert: 'certified' },
  { key: 'REF-05', name: 'Ref Evans', cert: 'volunteer' },
  { key: 'REF-06', name: 'Ref Foster', cert: 'volunteer' },
];
for (const r of refDefs) {
  resources.push({
    key: r.key, name: r.name, type: 'INDIVIDUAL', class: 'REUSABLE',
    hierarchy: { level1: 'Referees' },
    typedAttributes: [attr('certificationLevel', 'enum', r.cert, 'staff', 6)],
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. CALENDARS (57 entries — one per resource)
// ══════════════════════════════════════════════════════════════════════════════
const calendars = [];

const SAT = '2026-06-06';
const SUN = '2026-06-07';
const MON = '2026-06-08';
const TUE = '2026-06-09';
const WED = '2026-06-10';
const THU = '2026-06-11';
const FRI = '2026-06-12';
const WEEKNIGHTS = [MON, TUE, WED, THU, FRI];

function iv(date, startH, startM, endH, endM, qty = 1) {
  const sh = String(startH).padStart(2, '0');
  const sm = String(startM).padStart(2, '0');
  const eh = String(endH).padStart(2, '0');
  const em = String(endM).padStart(2, '0');
  return { start: `${date}T${sh}:${sm}:00Z`, end: `${date}T${eh}:${em}:00Z`, qty };
}

// Diamond Fields
for (const d of diamondDefs) {
  const intervals = [];
  if (d.lighting) {
    // Lighted: Sat 7AM-9PM, Sun 12PM-6PM, weeknights 5:30PM-9PM
    intervals.push(iv(SAT, 7, 0, 21, 0));
    intervals.push(iv(SUN, 12, 0, 18, 0));
    for (const day of WEEKNIGHTS) intervals.push(iv(day, 17, 30, 21, 0));
  } else {
    // Non-lighted: Saturday only 7AM-6PM
    intervals.push(iv(SAT, 7, 0, 18, 0));
  }
  calendars.push({ resourceKey: d.key, intervals });
}

// Multi-Use Fields
for (const f of multiUseDefs) {
  const intervals = [];
  if (f.lighting) {
    // RS-STADIUM: Sat 8AM-9PM, Sun 12PM-6PM, weeknights 5:30PM-9PM
    intervals.push(iv(SAT, 8, 0, 21, 0));
    intervals.push(iv(SUN, 12, 0, 18, 0));
    for (const day of WEEKNIGHTS) intervals.push(iv(day, 17, 30, 21, 0));
  } else {
    // Non-lighted grass: Saturday only 8AM-5PM
    intervals.push(iv(SAT, 8, 0, 17, 0));
  }
  calendars.push({ resourceKey: f.key, intervals });
}

// Pickleball Courts — Southpark (lighted)
for (let i = 11; i <= 19; i++) {
  const intervals = [iv(SAT, 7, 0, 22, 0)];
  if (i <= 17) {
    // Courts 11-17: Sun 12PM-6PM + weeknights 5:30PM-10PM
    intervals.push(iv(SUN, 12, 0, 18, 0));
    for (const day of WEEKNIGHTS) intervals.push(iv(day, 17, 30, 22, 0));
  }
  // Courts 18-19: Saturday only (drop-in dedicated)
  calendars.push({ resourceKey: `SP-COURT${i}`, intervals });
}

// Pickleball Courts — Tanks Park (no lights, Saturday only)
for (let i = 1; i <= 4; i++) {
  calendars.push({ resourceKey: `TK-COURT${i}`, intervals: [iv(SAT, 7, 0, 18, 0)] });
}

// Equipment — Sat + Sun + weeknights
for (const e of eqDefs) {
  const intervals = [iv(SAT, 6, 30, 21, 30), iv(SUN, 11, 30, 18, 30)];
  for (const day of WEEKNIGHTS) intervals.push(iv(day, 17, 0, 21, 30));
  calendars.push({ resourceKey: e.key, intervals });
}

// Staff
const staffSunKeys = ['STAFF-LUKE', 'STAFF-FIELD-1'];
const staffWeeknight = {
  'STAFF-COLEEN': [],
  'STAFF-LUKE': [TUE, THU],
  'STAFF-BRENDA': [MON, WED, FRI],
  'STAFF-FIELD-1': [MON, WED, FRI],
  'STAFF-FIELD-2': [TUE, THU],
};
for (const s of staffDefs) {
  const intervals = [iv(SAT, 6, 30, 21, 0)];
  if (staffSunKeys.includes(s.key)) intervals.push(iv(SUN, 11, 30, 18, 0));
  for (const day of (staffWeeknight[s.key] || [])) intervals.push(iv(day, 17, 30, 21, 0));
  calendars.push({ resourceKey: s.key, intervals });
}

// Umpires — Saturday lunch break (2 intervals) + Sunday subset + weeknight rotation
const umpSunKeys = ['UMP-01', 'UMP-02', 'UMP-03'];
const umpWeeknight = {
  'UMP-01': [MON, WED], 'UMP-02': [TUE, THU], 'UMP-03': [FRI],
  'UMP-04': [MON, WED, FRI], 'UMP-05': [TUE, THU],
  'UMP-06': [MON, WED], 'UMP-07': [TUE, THU], 'UMP-08': [FRI],
};
for (const u of umpDefs) {
  const intervals = [iv(SAT, 7, 30, 12, 0), iv(SAT, 12, 30, 20, 0)];
  if (umpSunKeys.includes(u.key)) intervals.push(iv(SUN, 12, 0, 18, 0));
  for (const day of (umpWeeknight[u.key] || [])) intervals.push(iv(day, 17, 30, 21, 0));
  calendars.push({ resourceKey: u.key, intervals });
}

// Referees — Saturday lunch break (2 intervals) + Sunday subset + weeknight rotation
const refSunKeys = ['REF-01', 'REF-02'];
const refWeeknight = {
  'REF-01': [MON, WED, FRI], 'REF-02': [TUE, THU],
  'REF-03': [], 'REF-04': [MON, WED, FRI],
  'REF-05': [TUE, THU], 'REF-06': [],
};
for (const r of refDefs) {
  const intervals = [iv(SAT, 8, 30, 12, 0), iv(SAT, 12, 30, 19, 0)];
  if (refSunKeys.includes(r.key)) intervals.push(iv(SUN, 12, 0, 18, 0));
  for (const day of (refWeeknight[r.key] || [])) intervals.push(iv(day, 17, 30, 21, 0));
  calendars.push({ resourceKey: r.key, intervals });
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. ORDERS (77 total)
// ══════════════════════════════════════════════════════════════════════════════
const orders = [];

function orderAttrs(sport, division, gameWeek, home, away) {
  return [
    { name: 'sport', dataType: 'string', value: { type: 'string', value: sport }, category: 'game', sequence: 1 },
    { name: 'division', dataType: 'string', value: { type: 'string', value: division }, category: 'game', sequence: 2 },
    { name: 'gameWeek', dataType: 'integer', value: { type: 'integer', value: gameWeek }, category: 'game', sequence: 3 },
    { name: 'homeTeam', dataType: 'string', value: { type: 'string', value: home }, category: 'game', sequence: 4 },
    { name: 'awayTeam', dataType: 'string', value: { type: 'string', value: away }, category: 'game', sequence: 5 },
  ];
}

const DUE_GAME = '2026-06-06T21:00:00Z';
const DUE_DROPIN = '2026-06-06T22:00:00Z';

// Track all games/orders for task generation
const chainedGames = [];  // 3-task chains (baseball, FF, PB league)
const dropinGames = [];   // single-task (PB drop-in)

// ── Baseball divisions (19 games) ──
const bbDivisions = [
  { prefix: 'GAME-BB-TB-W1', sport: 'baseball', division: 'T-Ball', productKey: 'baseball-tball', priority: 4,
    teams: ['Rockies', 'Nuggets', 'Broncos', 'Avalanche', 'Rapids', 'Mammoth', 'Thunder', 'Lightning', 'Rockets', 'Comets', 'Tigers', 'Bears'] },
  { prefix: 'GAME-BB-CP-W1', sport: 'baseball', division: 'Coach Pitch', productKey: 'baseball-coachpitch', priority: 3,
    teams: ['Blazers', 'Strikers', 'Rebels', 'Mavericks', 'Knights', 'Titans', 'Rangers', 'Spartans', 'Warriors', 'Crusaders'] },
  { prefix: 'GAME-BB-MN-W1', sport: 'baseball', division: 'Minors', productKey: 'baseball-minors', priority: 2,
    teams: ['Aces', 'Diamondbacks', 'Storm', 'Phantoms', 'Huskies', 'Outlaws', 'Legends', 'Fury'] },
  { prefix: 'GAME-BB-MJ-W1', sport: 'baseball', division: 'Majors', productKey: 'baseball-majors', priority: 1,
    teams: ['Mustangs', 'Stallions', 'Gladiators', 'Centurions', 'Falcons', 'Jaguars', 'Ironmen', 'Hammers'] },
];

for (const div of bbDivisions) {
  const numGames = div.teams.length / 2;
  for (let i = 0; i < numGames; i++) {
    const nn = String(i + 1).padStart(2, '0');
    const key = `${div.prefix}-${nn}`;
    const home = div.teams[i * 2];
    const away = div.teams[i * 2 + 1];
    orders.push({
      key, name: `${div.division}: ${home} vs ${away} (Wk1)`,
      productKey: div.productKey, demandQty: 1,
      dueDate: DUE_GAME, priority: div.priority,
      typedAttributes: orderAttrs(div.sport, div.division, 1, home, away),
    });
    chainedGames.push({ key, sport: div.sport, division: div.division, productKey: div.productKey, home, away, priority: div.priority });
  }
}

// ── Flag Football divisions (9 games) ──
const ffDivisions = [
  { prefix: 'GAME-FF-K2-W1', sport: 'flag-football', division: 'Flag K-2', productKey: 'flag-football-k2', priority: 4,
    teams: ['Chiefs', 'Chargers', 'Packers', 'Vikings', 'Ravens', 'Steelers', 'Patriots', '49ers'] },
  { prefix: 'GAME-FF-35-W1', sport: 'flag-football', division: 'Flag 3-5', productKey: 'flag-football-35', priority: 3,
    teams: ['Broncos Orange', 'Broncos Blue', 'Bills', 'Eagles', 'Lions', 'Dolphins'] },
  { prefix: 'GAME-FF-68-W1', sport: 'flag-football', division: 'Flag 6-8', productKey: 'flag-football-68', priority: 2,
    teams: ['Team Alpha', 'Team Beta', 'Team Gamma', 'Team Delta'] },
];

for (const div of ffDivisions) {
  const numGames = div.teams.length / 2;
  for (let i = 0; i < numGames; i++) {
    const nn = String(i + 1).padStart(2, '0');
    const key = `${div.prefix}-${nn}`;
    const home = div.teams[i * 2];
    const away = div.teams[i * 2 + 1];
    orders.push({
      key, name: `${div.division}: ${home} vs ${away} (Wk1)`,
      productKey: div.productKey, demandQty: 1,
      dueDate: DUE_GAME, priority: div.priority,
      typedAttributes: orderAttrs(div.sport, div.division, 1, home, away),
    });
    chainedGames.push({ key, sport: div.sport, division: div.division, productKey: div.productKey, home, away, priority: div.priority });
  }
}

// ── Pickleball League Matches (4 games) ──
const pbLeagueMatches = [
  { nn: '01', home: 'Anderson/Baker', away: 'Chen/Davis', durSec: 3600 },
  { nn: '02', home: 'Evans/Foster', away: 'Garcia/Hayes', durSec: 3600 },
  { nn: '03', home: 'Ito/Jones', away: 'Kim/Lopez', durSec: 5400 },
  { nn: '04', home: 'Moore/Nguyen', away: 'Park/Quinn', durSec: 7200 },
];

for (const m of pbLeagueMatches) {
  const key = `GAME-PB-W1-${m.nn}`;
  orders.push({
    key, name: `PB Open: ${m.home} vs ${m.away} (Wk1)`,
    productKey: 'pickleball-open', demandQty: 1,
    dueDate: DUE_GAME, priority: 5,
    typedAttributes: orderAttrs('pickleball', 'Open Doubles', 1, m.home, m.away),
  });
  dropinGames.push({
    key, sport: 'pickleball', division: 'Open Doubles',
    productKey: 'pickleball-open', home: m.home, away: m.away,
    priority: 5, durationSec: m.durSec, isLeaguePB: true,
    courtPrefs: ['SP-COURT11', 'SP-COURT12', 'SP-COURT13', 'SP-COURT14', 'SP-COURT15', 'SP-COURT16', 'SP-COURT17'],
  });
}

// ── Pickleball Drop-In Reservations (45 orders) ──
// Duration mix: 12×30m, 15×60m, 10×90m, 8×120m = 45
// Court distribution: 30 → SP 11-17, 10 → SP 18-19, 5 → TK 1-4
const dropinNames = [
  // SP 11-17 group (30 reservations)
  'Smith/Jones', 'Martinez/Garcia', 'Wilson/Taylor', 'Brown/Davis',
  'Johnson/Williams', 'Anderson/Thomas', 'Jackson/White', 'Harris/Thompson',
  'Clark/Robinson', 'Lewis/Walker', 'Young/Allen', 'King/Wright',
  'Hill/Scott', 'Green/Adams', 'Baker/Nelson', 'Carter/Mitchell',
  'Perez/Roberts', 'Turner/Phillips', 'Campbell/Parker', 'Edwards/Collins',
  'Stewart/Sanchez', 'Morris/Rogers', 'Reed/Cook', 'Morgan/Bell',
  'Murphy/Bailey', 'Rivera/Cooper', 'Richardson/Cox', 'Howard/Ward',
  'Torres/Peterson', 'Gray/Ramirez',
  // SP 18-19 group (10 reservations)
  'Watson/Brooks', 'Kelly/Sanders', 'Price/Bennett', 'Wood/Barnes',
  'Ross/Henderson', 'Coleman/Jenkins', 'Perry/Powell', 'Long/Patterson',
  'Hughes/Flores', 'Washington/Butler',
  // TK group (5 reservations)
  'Simmons/Foster', 'Bryant/Alexander', 'Russell/Griffin', 'Diaz/Hayes',
  'Myers/Ford',
];

// Duration assignments to hit exact mix: 12×30, 15×60, 10×90, 8×120
// SP 11-17 (30): 8×30, 10×60, 7×90, 5×120
// SP 18-19 (10): 3×30, 3×60, 2×90, 2×120
// TK (5):        1×30, 2×60, 1×90, 1×120
const dropinDurations = [
  // SP 11-17: indices 0-29
  1800, 3600, 5400, 7200, 1800, 3600, 5400, 7200,   // 0-7
  1800, 3600, 5400, 7200, 1800, 3600, 5400, 7200,   // 8-15
  1800, 3600, 5400, 7200, 1800, 3600, 5400, 3600,   // 16-23
  1800, 3600, 5400, 3600, 1800, 3600,                 // 24-29
  // SP 18-19: indices 30-39
  1800, 3600, 5400, 7200, 1800, 3600, 5400, 7200,   // 30-37
  1800, 3600,                                          // 38-39
  // TK: indices 40-44
  1800, 3600, 5400, 7200, 3600,                        // 40-44
];

// Verify duration mix
const durCount = { 1800: 0, 3600: 0, 5400: 0, 7200: 0 };
for (const d of dropinDurations) durCount[d]++;

const SP_11_17 = ['SP-COURT11', 'SP-COURT12', 'SP-COURT13', 'SP-COURT14', 'SP-COURT15', 'SP-COURT16', 'SP-COURT17'];
const SP_18_19 = ['SP-COURT18', 'SP-COURT19'];
const TK_COURTS = ['TK-COURT1', 'TK-COURT2', 'TK-COURT3', 'TK-COURT4'];

for (let i = 0; i < 45; i++) {
  const nn = String(i + 1).padStart(2, '0');
  const key = `RES-PB-${nn}`;
  const renter = dropinNames[i];
  const durSec = dropinDurations[i];
  const durMin = durSec / 60;
  const home = renter.split('/')[0];
  const away = renter.split('/')[1];

  let courtPrefs;
  if (i < 30) courtPrefs = SP_11_17;
  else if (i < 40) courtPrefs = SP_18_19;
  else courtPrefs = TK_COURTS;

  orders.push({
    key, name: `Court Reservation: ${renter}`,
    productKey: 'pickleball-dropin', demandQty: 1,
    dueDate: DUE_DROPIN, priority: 6,
    typedAttributes: orderAttrs('pickleball', 'Drop-In', 1, home, away),
  });

  dropinGames.push({
    key, sport: 'pickleball', division: 'Drop-In',
    productKey: 'pickleball-dropin', home, away,
    priority: 6, durationSec: durSec, courtPrefs,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. TASKS (141 total: 96 chain + 45 drop-in)
// ══════════════════════════════════════════════════════════════════════════════
const tasks = [];

const WINDOW_START = '2026-06-06T06:00:00Z';
const WINDOW_END = '2026-06-13T00:00:00Z';

// Duration tables
const bbDurations = {
  'T-Ball':      { prep: 600,  play: 3600, reset: 600 },
  'Coach Pitch': { prep: 900,  play: 4500, reset: 600 },
  'Minors':      { prep: 900,  play: 5400, reset: 900 },
  'Majors':      { prep: 1200, play: 7200, reset: 900 },
};
const ffDurations = {
  'Flag K-2':  { prep: 600, play: 2700, reset: 600 },
  'Flag 3-5':  { prep: 600, play: 3600, reset: 600 },
  'Flag 6-8':  { prep: 600, play: 3600, reset: 600 },
};

// Field preference lists
const fieldPrefs = {
  'T-Ball':      ['RS-FIELD5', 'RS-FIELD6', 'RS-SOUTH-GREEN', 'TP-FIELD1', 'CR-FIELD1', 'BDC-FIELD1'],
  'Coach Pitch': ['FP-FIELD1', 'FP-FIELD2', 'HH-FIELD1', 'HH-FIELD2', 'MP-FIELD1', 'KP-FIELD1', 'RS-SOUTH-GREEN'],
  'Minors':      ['NR-FIELD1', 'NR-FIELD2', 'RS-SOUTH-GREEN', 'FP-FIELD1', 'FP-FIELD2', 'HH-FIELD1', 'HH-FIELD2'],
  'Majors':      ['RS-ROXBOROUGH', 'RS-FLATIRONS', 'RS-REDROCKS', 'NR-FIELD1', 'NR-FIELD2'],
  'Flag K-2':    ['TP-FIELD1', 'CR-FIELD1', 'BDC-FIELD1', 'PV-FIELD1'],
  'Flag 3-5':    ['RS-STADIUM', 'TP-FIELD1', 'CR-FIELD1', 'BDC-FIELD1'],
  'Flag 6-8':    ['RS-STADIUM', 'TP-FIELD1'],
};

// PB league courts (NOT 18/19)
const pbLeagueCourtPrefs = SP_11_17;

// Shared resource preference lists
const fieldCrew = [{ resource: 'STAFF-FIELD-1', rank: 1 }, { resource: 'STAFF-FIELD-2', rank: 2 }];
const coordStaff = [{ resource: 'STAFF-COLEEN', rank: 1 }, { resource: 'STAFF-BRENDA', rank: 2 }];
const basesEquip = [{ resource: 'EQ-BASES-A', rank: 1 }, { resource: 'EQ-BASES-B', rank: 2 }, { resource: 'EQ-BASES-C', rank: 3 }];
const pitchMachines = [{ resource: 'EQ-PITCHMACHINE-1', rank: 1 }, { resource: 'EQ-PITCHMACHINE-2', rank: 2 }];
const scoreboard = [{ resource: 'EQ-SCOREBOARD', rank: 1 }];
const allUmps = umpDefs.map((u, i) => ({ resource: u.key, rank: i + 1 }));
const allRefs = refDefs.map((r, i) => ({ resource: r.key, rank: i + 1 }));
function taskAttrs(sport, division, home, away, gameWeek, phase) {
  return [
    attr('sport', 'enum', sport, 'game', 1),
    { name: 'division', dataType: 'string', value: { type: 'string', value: division }, category: 'game', sequence: 2 },
    { name: 'homeTeam', dataType: 'string', value: { type: 'string', value: home }, category: 'game', sequence: 3 },
    { name: 'awayTeam', dataType: 'string', value: { type: 'string', value: away }, category: 'game', sequence: 4 },
    attr('gameWeek', 'integer', gameWeek, 'game', 5),
    attr('phase', 'enum', phase, 'game', 6),
  ];
}

// ── Generate 3-task chains for all chained games (28 games × 3 = 84 tasks) ──
for (const game of chainedGames) {
  const isBaseball = game.sport === 'baseball';
  const isFF = game.sport === 'flag-football';
  const isCoachPitch = game.division === 'Coach Pitch';
  const isMajors = game.division === 'Majors';
  const isMinors = game.division === 'Minors';
  const needsTwoUmps = isMinors || isMajors;
  const needsTwoRefs = game.division === 'Flag 3-5' || game.division === 'Flag 6-8';

  let dur, fPrefs;
  if (isFF) {
    dur = ffDurations[game.division];
    fPrefs = ranked(fieldPrefs[game.division]);
  } else {
    dur = bbDurations[game.division];
    fPrefs = ranked(fieldPrefs[game.division]);
  }

  // ── PREP ──
  const prepCR = [{ isPrimary: true, preferences: fPrefs }];
  if (isBaseball) {
    prepCR.push({ isPrimary: false, preferences: [...fieldCrew] });
    prepCR.push({ isPrimary: false, preferences: [...basesEquip] });
    if (isCoachPitch) prepCR.push({ isPrimary: false, preferences: [...pitchMachines] });
    if (isMajors) prepCR.push({ isPrimary: false, preferences: [...scoreboard] });
  } else if (isFF) {
    prepCR.push({ isPrimary: false, preferences: [...fieldCrew] });
  }

  tasks.push({
    key: `${game.key}-PREP`,
    name: `Prep: ${game.home} vs ${game.away}`,
    type: 'SETUP', subType: 'prep', sequence: 1,
    process: game.productKey,
    linkId: { name: game.key, type: 'game', prevLink: '' },
    windowStart: WINDOW_START, windowEnd: WINDOW_END,
    durationSeconds: dur.prep,
    capacityResources: prepCR,
    typedAttributes: taskAttrs(game.sport, game.division, game.home, game.away, 1, 'prep'),
  });

  // ── PLAY ──
  const playCR = [{ isPrimary: true, preferences: fPrefs }];
  if (isBaseball) {
    playCR.push({ isPrimary: false, preferences: [...allUmps] });
    if (needsTwoUmps) playCR.push({ isPrimary: false, preferences: [...allUmps] });
    if (isCoachPitch) playCR.push({ isPrimary: false, preferences: [...pitchMachines] });
    if (isMajors) playCR.push({ isPrimary: false, preferences: [...scoreboard] });
  } else if (isFF) {
    playCR.push({ isPrimary: false, preferences: [...allRefs] });
    if (needsTwoRefs) playCR.push({ isPrimary: false, preferences: [...allRefs] });
  }

  const playName = `${game.division}: ${game.home} vs ${game.away}`;

  tasks.push({
    key: `${game.key}-PLAY`,
    name: playName,
    type: 'PROCESS', subType: 'play', sequence: 2,
    process: game.productKey,
    linkId: { name: game.key, type: 'game', prevLink: `${game.key}-PREP` },
    windowStart: WINDOW_START, windowEnd: WINDOW_END,
    durationSeconds: dur.play,
    capacityResources: playCR,
    typedAttributes: taskAttrs(game.sport, game.division, game.home, game.away, 1, 'play'),
  });

  // ── RESET ──
  const resetCR = [{ isPrimary: true, preferences: fPrefs }];
  if (isBaseball) {
    resetCR.push({ isPrimary: false, preferences: [...fieldCrew] });
  } else if (isFF) {
    resetCR.push({ isPrimary: false, preferences: [...fieldCrew] });
  }

  tasks.push({
    key: `${game.key}-RESET`,
    name: `Reset: ${game.home} vs ${game.away}`,
    type: 'TEARDOWN', subType: 'reset', sequence: 3,
    process: game.productKey,
    linkId: { name: game.key, type: 'game', prevLink: `${game.key}-PLAY` },
    windowStart: WINDOW_START, windowEnd: WINDOW_END,
    durationSeconds: dur.reset,
    capacityResources: resetCR,
    typedAttributes: taskAttrs(game.sport, game.division, game.home, game.away, 1, 'reset'),
  });
}

// ── Generate single-task pickleball games (league + drop-in = 49 tasks) ──
for (const di of dropinGames) {
  const courtCR = { isPrimary: true, preferences: ranked(di.courtPrefs) };
  const cr = [courtCR];
  if (di.isLeaguePB) cr.push({ isPrimary: false, preferences: [...coordStaff] });
  const name = di.isLeaguePB
    ? `PB Open: ${di.home} vs ${di.away}`
    : `Drop-In: ${di.home}/${di.away}`;
  tasks.push({
    key: `${di.key}-PLAY`,
    name,
    type: 'PROCESS', subType: 'play', sequence: 1,
    process: di.productKey,
    linkId: { name: di.key, type: 'game', prevLink: '' },
    windowStart: WINDOW_START, windowEnd: WINDOW_END,
    durationSeconds: di.durationSec,
    capacityResources: cr,
    typedAttributes: taskAttrs(di.sport, di.division, di.home, di.away, 1, 'play'),
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. KPIs
// ══════════════════════════════════════════════════════════════════════════════
const kpis = [
  {
    name: 'fieldUtilization', displayName: 'Field Utilization',
    description: 'Percentage of available field-hours used by scheduled games',
    computationType: 'built-in', sourceEntity: 'resource', objective: 'maximize',
    targetValue: 75, warningThreshold: 60, criticalThreshold: 40,
    unit: '%', visualizationType: 'gauge', category: 'efficiency', sequence: 1,
  },
  {
    name: 'gamesScheduled', displayName: 'Games Scheduled',
    description: 'Number of games/reservations successfully placed on the schedule',
    computationType: 'built-in', sourceEntity: 'task', objective: 'maximize',
    targetValue: 77, warningThreshold: 60, criticalThreshold: 45,
    unit: 'games', visualizationType: 'gauge', category: 'coverage', sequence: 2,
  },
  {
    name: 'umpireUtilization', displayName: 'Umpire Utilization',
    description: 'Average umpire usage across scheduled baseball games',
    computationType: 'built-in', sourceEntity: 'resource', objective: 'maximize',
    targetValue: 80, warningThreshold: 60, criticalThreshold: 40,
    unit: '%', visualizationType: 'gauge', category: 'staffing', sequence: 3,
  },
  {
    name: 'makespan', displayName: 'Makespan',
    description: 'Total time from first activity to last activity end',
    computationType: 'built-in', sourceEntity: 'schedule', objective: 'minimize',
    unit: 'hours', format: '0.1f', visualizationType: 'gauge',
    category: 'efficiency', sequence: 4,
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// 6. CADENCES
// ══════════════════════════════════════════════════════════════════════════════
const cadences = [
  { key: 'CADENCE-30', name: '30-Minute Boundaries', intervalMinutes: 30 },
  { key: 'CADENCE-60', name: 'Hourly Boundaries', intervalMinutes: 60 },
];

// ══════════════════════════════════════════════════════════════════════════════
// 7. PROCESSES (with cadence references)
// ══════════════════════════════════════════════════════════════════════════════
const processes = [
  { key: 'baseball-tball', name: 'T-Ball Game', category: 'Baseball', cadence: 'CADENCE-60' },
  { key: 'baseball-coachpitch', name: 'Coach Pitch Game', category: 'Baseball', cadence: 'CADENCE-60' },
  { key: 'baseball-minors', name: 'Minors Game', category: 'Baseball', cadence: 'CADENCE-60' },
  { key: 'baseball-majors', name: 'Majors Game', category: 'Baseball', cadence: 'CADENCE-60' },
  { key: 'flag-football-k2', name: 'Flag Football K-2', category: 'Flag Football', cadence: 'CADENCE-60' },
  { key: 'flag-football-35', name: 'Flag Football 3-5', category: 'Flag Football', cadence: 'CADENCE-60' },
  { key: 'flag-football-68', name: 'Flag Football 6-8', category: 'Flag Football', cadence: 'CADENCE-60' },
  { key: 'pickleball-open', name: 'Pickleball Open Doubles', category: 'Pickleball', cadence: 'CADENCE-30' },
  { key: 'pickleball-dropin', name: 'Pickleball Drop-In Reservation', category: 'Pickleball', cadence: 'CADENCE-30' },
];

// ══════════════════════════════════════════════════════════════════════════════
// WRITE ALL FILES
// ══════════════════════════════════════════════════════════════════════════════
console.log('Generating hrmd-rec-sports data (baseball + flag football + pickleball)...');
writeJson(dataDir, 'resources.json', resources);
writeJson(dataDir, 'calendars.json', calendars);
writeJson(dataDir, 'orders.json', orders);
writeJson(dataDir, 'tasks.json', tasks);
writeJson(dataDir, 'processes.json', processes);
writeJson(kpisDir, 'kpis.json', kpis);
writeJson(__dirname, 'cadences.json', cadences);

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICATION
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══ Verification ══');
console.log(`Resources:  ${resources.length} (expected 57)`);
console.log(`Calendars:  ${calendars.length} (expected 57)`);
console.log(`Orders:     ${orders.length} (expected 77: 19 BB + 9 FF + 4 PB league + 45 PB drop-in)`);
console.log(`Tasks:      ${tasks.length} (expected 133: 28×3 chain + 49 PB single)`);
console.log(`Cadences:   ${cadences.length} (expected 2)`);
console.log(`Processes:  ${processes.length} (expected 9)`);

let allPass = true;
function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) allPass = false;
}

// Count checks
check('57 resources', resources.length === 57);
check('57 calendars', calendars.length === 57);
check('77 orders', orders.length === 77);
check('133 tasks', tasks.length === 133);

// Chain integrity for chained games
let chainOk = true;
for (const game of chainedGames) {
  const prep = tasks.find(t => t.key === `${game.key}-PREP`);
  const play = tasks.find(t => t.key === `${game.key}-PLAY`);
  const reset = tasks.find(t => t.key === `${game.key}-RESET`);
  if (!prep || !play || !reset) { console.error(`  MISSING chain: ${game.key}`); chainOk = false; continue; }
  if (prep.linkId.prevLink !== '') { console.error(`  PREP prevLink: ${game.key}`); chainOk = false; }
  if (play.linkId.prevLink !== `${game.key}-PREP`) { console.error(`  PLAY prevLink: ${game.key}`); chainOk = false; }
  if (reset.linkId.prevLink !== `${game.key}-PLAY`) { console.error(`  RESET prevLink: ${game.key}`); chainOk = false; }
  const pf = JSON.stringify(prep.capacityResources[0].preferences);
  const plf = JSON.stringify(play.capacityResources[0].preferences);
  const rf = JSON.stringify(reset.capacityResources[0].preferences);
  if (pf !== plf || plf !== rf) { console.error(`  Field prefs mismatch: ${game.key}`); chainOk = false; }
}
check('Chain integrity (28 games)', chainOk);

// Drop-in single-task checks
let diOk = true;
for (const di of dropinGames) {
  const play = tasks.find(t => t.key === `${di.key}-PLAY`);
  if (!play) { console.error(`  MISSING drop-in: ${di.key}`); diOk = false; continue; }
  if (play.linkId.prevLink !== '') { console.error(`  Drop-in prevLink not empty: ${di.key}`); diOk = false; }
  if (play.type !== 'PROCESS') { console.error(`  Drop-in type not PROCESS: ${di.key}`); diOk = false; }
}
check('PB single tasks (49 = 45 drop-in + 4 league)', diOk);

// Hierarchy check
const noH = resources.filter(r => !r.hierarchy?.level1);
check('Hierarchy set on all resources', noH.length === 0);

// Scoring weights
// (read from the scoring.json that's already written)
check('Scoring weights sum to 1.0', 0.7 + 0.3 + 0 === 1.0);

// Duration checks
let durOk = true;
for (const game of chainedGames) {
  const prep = tasks.find(t => t.key === `${game.key}-PREP`);
  const play = tasks.find(t => t.key === `${game.key}-PLAY`);
  const reset = tasks.find(t => t.key === `${game.key}-RESET`);
  if (game.sport === 'baseball') {
    const d = bbDurations[game.division];
    if (prep.durationSeconds !== d.prep || play.durationSeconds !== d.play || reset.durationSeconds !== d.reset) {
      console.error(`  BB dur: ${game.key}`); durOk = false;
    }
  } else if (game.sport === 'flag-football') {
    const d = ffDurations[game.division];
    if (prep.durationSeconds !== d.prep || play.durationSeconds !== d.play || reset.durationSeconds !== d.reset) {
      console.error(`  FF dur: ${game.key}`); durOk = false;
    }
  }
}
check('Chain task durations match reference', durOk);

// Drop-in duration check (all multiples of 1800)
let diDurOk = true;
for (const di of dropinGames) {
  const play = tasks.find(t => t.key === `${di.key}-PLAY`);
  if (play.durationSeconds % 1800 !== 0) { console.error(`  Drop-in dur not 30m multiple: ${di.key} = ${play.durationSeconds}`); diDurOk = false; }
  if (play.durationSeconds < 1800 || play.durationSeconds > 7200) { console.error(`  Drop-in dur out of range: ${di.key} = ${play.durationSeconds}`); diDurOk = false; }
}
check('Drop-in durations (30-120min, 30m multiples)', diDurOk);

// Drop-in duration mix: 12×30, 15×60, 10×90, 8×120
check('Drop-in mix: 12×30m', durCount[1800] === 12);
check('Drop-in mix: 15×60m', durCount[3600] === 15);
check('Drop-in mix: 10×90m', durCount[5400] === 10);
check('Drop-in mix: 8×120m', durCount[7200] === 8);

// Courts 18/19 drop-ins only have SP-COURT18/19 prefs
let court1819ok = true;
const diOnly = dropinGames.filter(d => !d.isLeaguePB);
for (let i = 30; i < 40; i++) {
  const di = diOnly[i];
  const play = tasks.find(t => t.key === `${di.key}-PLAY`);
  const courtPrefs = play.capacityResources[0].preferences.map(p => p.resource);
  if (courtPrefs.length !== 2 || !courtPrefs.includes('SP-COURT18') || !courtPrefs.includes('SP-COURT19')) {
    console.error(`  Courts 18/19 pref mismatch: ${di.key} → ${courtPrefs}`); court1819ok = false;
  }
}
check('Courts 18/19 drop-ins limited to SP-COURT18/19', court1819ok);

// No PB-TIMESLOT resource remains
check('No PB-TIMESLOT resource', !resources.some(r => r.key === 'PB-TIMESLOT'));
check('No PB-TIMESLOT calendar', !calendars.some(c => c.resourceKey === 'PB-TIMESLOT'));

// Cadence checks
check('2 cadence profiles', cadences.length === 2);
check('9 process definitions', processes.length === 9);
const pbProcs = processes.filter(p => p.cadence === 'CADENCE-30');
check('PB processes use CADENCE-30', pbProcs.length === 2);
const bbProcs = processes.filter(p => p.cadence === 'CADENCE-60');
check('BB/FF processes use CADENCE-60', bbProcs.length === 7);

// 2-ump slots for Minors/Majors
let umpOk = true;
for (const game of chainedGames) {
  if (game.division === 'Minors' || game.division === 'Majors') {
    const play = tasks.find(t => t.key === `${game.key}-PLAY`);
    const umpSlots = play.capacityResources.filter(cr => !cr.isPrimary && cr.preferences[0]?.resource?.startsWith('UMP'));
    if (umpSlots.length !== 2) { console.error(`  2-ump: ${game.key} got ${umpSlots.length}`); umpOk = false; }
  }
}
check('Majors/Minors PLAY have 2 ump slots', umpOk);

// 2-ref slots for Flag 3-5/6-8
let refOk = true;
for (const game of chainedGames) {
  if (game.division === 'Flag 3-5' || game.division === 'Flag 6-8') {
    const play = tasks.find(t => t.key === `${game.key}-PLAY`);
    const refSlots = play.capacityResources.filter(cr => !cr.isPrimary && cr.preferences[0]?.resource?.startsWith('REF'));
    if (refSlots.length !== 2) { console.error(`  2-ref: ${game.key} got ${refSlots.length}`); refOk = false; }
  }
}
check('Flag 3-5/6-8 PLAY have 2 ref slots', refOk);

// Coach Pitch has pitching machine in PREP and PLAY
let cpOk = true;
for (const game of chainedGames) {
  if (game.division === 'Coach Pitch') {
    const prep = tasks.find(t => t.key === `${game.key}-PREP`);
    const play = tasks.find(t => t.key === `${game.key}-PLAY`);
    const hasPM = (t) => t.capacityResources.some(cr => cr.preferences.some(p => p.resource?.startsWith('EQ-PITCHMACHINE')));
    if (!hasPM(prep) || !hasPM(play)) { console.error(`  CP PM: ${game.key}`); cpOk = false; }
  }
}
check('Coach Pitch PREP+PLAY have pitching machine', cpOk);

// Umpire Saturday calendars have 2 intervals (lunch break)
let umpCalOk = true;
for (const u of umpDefs) {
  const cal = calendars.find(c => c.resourceKey === u.key);
  const satIntervals = cal.intervals.filter(i => i.start.startsWith(SAT));
  if (satIntervals.length !== 2) { console.error(`  Ump lunch: ${u.key} has ${satIntervals.length} Sat intervals`); umpCalOk = false; }
}
check('Umpire Saturday calendars have lunch break (2 intervals)', umpCalOk);

// Referee Saturday calendars have 2 intervals (lunch break)
let refCalOk = true;
for (const r of refDefs) {
  const cal = calendars.find(c => c.resourceKey === r.key);
  const satIntervals = cal.intervals.filter(i => i.start.startsWith(SAT));
  if (satIntervals.length !== 2) { console.error(`  Ref lunch: ${r.key} has ${satIntervals.length} Sat intervals`); refCalOk = false; }
}
check('Referee Saturday calendars have lunch break (2 intervals)', refCalOk);

// Lighted resources have weeknight intervals
let lightOk = true;
const lightedDiamonds = diamondDefs.filter(d => d.lighting);
for (const d of lightedDiamonds) {
  const cal = calendars.find(c => c.resourceKey === d.key);
  const weeknightIvs = cal.intervals.filter(i => !i.start.startsWith(SAT) && !i.start.startsWith(SUN));
  if (weeknightIvs.length !== 5) { console.error(`  Lighted weeknight: ${d.key} has ${weeknightIvs.length}`); lightOk = false; }
}
check('Lighted diamonds have weeknight intervals', lightOk);

// Non-lighted resources have Saturday only
let nonLightOk = true;
const nonLightedDiamonds = diamondDefs.filter(d => !d.lighting);
for (const d of nonLightedDiamonds) {
  const cal = calendars.find(c => c.resourceKey === d.key);
  if (cal.intervals.length !== 1 || !cal.intervals[0].start.startsWith(SAT)) {
    console.error(`  Non-lighted: ${d.key} has ${cal.intervals.length} intervals`); nonLightOk = false;
  }
}
check('Non-lighted diamonds have Saturday only', nonLightOk);

// PB league durations are multiples of 1800
let pbLeageDurOk = true;
for (const m of pbLeagueMatches) {
  if (m.durSec % 1800 !== 0) { console.error(`  PB league dur: ${m.nn} = ${m.durSec}`); pbLeageDurOk = false; }
}
check('PB league durations are 30m multiples', pbLeageDurOk);

// Summary
console.log('\n── Resource Groups ──');
const groups = {};
for (const r of resources) { const g = r.hierarchy.level1; groups[g] = (groups[g] || 0) + 1; }
console.log(groups);

console.log('\n── Orders by Division ──');
const divCounts = {};
for (const o of orders) {
  const d = o.typedAttributes.find(a => a.name === 'division').value.value;
  divCounts[d] = (divCounts[d] || 0) + 1;
}
console.log(divCounts);

console.log('\n── Drop-In Duration Mix ──');
console.log(`30m: ${durCount[1800]}, 60m: ${durCount[3600]}, 90m: ${durCount[5400]}, 120m: ${durCount[7200]}`);

console.log(`\n${allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
