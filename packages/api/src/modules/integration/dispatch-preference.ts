// Dispatch preference pass — materializes Stafford's operation → group →
// machine model into task resource preferences at mapping time.
//
// Spec: docs/Stafford/operation-group-preference-mapping-spec.md
//
// The pass consumes RAW source records (operations master + resources) because
// group resolution needs source-shape fields (OperationsCode, IsFinite,
// GroupCode) that the per-entity mapping collapses away. Emitted preferences
// reference MAPPED resource keys (String(Id)) so they line up with what the
// hydrator loads.
//
// Rules (spec §2):
//   R1  task on a finite machine        → machine REQUIRED + group as AVAILABLE
//   R2  task on the infinite header     → group members as ranked PREFERRED
//   R3  header-only group (no members)  → the header itself, single preference
//   R4  machine missing from master     → warn, fall back to R2/R3 by group
//
// Everything here is pure functions over plain records — no Nest wiring.

// ── Config (profile.dispatch in mapping.json) ────────────────────────────────

export interface IDispatchConfig {
  /** R2 behavior: true (default) = distribute unassigned tasks across group
   *  members; false = leave them parked on the infinite header (load-bucket
   *  mode). */
  distributeUnassigned?: boolean;
  /** Task field carrying the operation code. Default 'OperationCode'. */
  operationCodeField?: string;
  /** Task field carrying the assigned machine id (joins resource Id). Default 'MachineId'. */
  machineIdField?: string;
  /** Task field summed into the pinned/float hour split. Default 'TotalRemainingMachineHours'. */
  remainingHoursField?: string;
  /** Relative drift between header-formula and member-sum weekly capacity
   *  before a warning is emitted. Default 0.10 (10%). */
  headerCapacityDriftTolerance?: number;
}

// ── Report ───────────────────────────────────────────────────────────────────

export interface DispatchFinding {
  code:
    | 'OPERATIONS_MISSING'
    | 'OP_CODE_UNRESOLVED'
    | 'GROUP_NO_HEADER'
    | 'MACHINE_NOT_IN_MASTER'
    | 'HEADER_CAPACITY_DRIFT';
  severity: 'error' | 'warn';
  message: string;
  taskKey?: string;
  group?: string;
  rawValue?: unknown;
}

export interface DispatchValidationReport {
  summary: {
    tasks: number;
    pinned: number;          // R1
    distributed: number;     // R2
    headerFallback: number;  // R3
    machineFallback: number; // R4
    unresolved: number;      // op code missing → legacy emit
    crossGroupPins: number;
    pinnedHours: number;
    floatHours: number;
  };
  errors: DispatchFinding[];
  warnings: DispatchFinding[];
  /** group → open-task count parked on the header (R3). */
  headerOnlyGroups: Record<string, number>;
  crossGroupPins: {
    taskKey: string;
    opCode: string;
    opGroup: string;
    machineCode: string;
    machineGroup: string | null;
  }[];
  capacityDrift: {
    group: string;
    headerHrsPerWeek: number;
    memberHrsPerWeek: number;
    driftPct: number;
  }[];
}

// ── Context ──────────────────────────────────────────────────────────────────

interface DispatchResourceInfo {
  key: string;          // mapped resource key — String(Id)
  code: string;         // raw Code (e.g. 'FA-01')
  groupCode: string | null;  // via opToGroup[OperationsCode]
  isFinite: boolean;
  efficiency: number;
  raw: Record<string, any>;
}

interface DispatchGroup {
  code: string;                       // GroupCode
  header: DispatchResourceInfo | null;
  members: DispatchResourceInfo[];    // finite, ranked (efficiency desc, code asc)
}

export interface DispatchContext {
  opToGroup: Map<string, string>;
  groups: Map<string, DispatchGroup>;
  resourceByKey: Map<string, DispatchResourceInfo>;
  config: Required<IDispatchConfig>;
  report: DispatchValidationReport;
}

const emptyReport = (): DispatchValidationReport => ({
  summary: {
    tasks: 0, pinned: 0, distributed: 0, headerFallback: 0,
    machineFallback: 0, unresolved: 0, crossGroupPins: 0,
    pinnedHours: 0, floatHours: 0,
  },
  errors: [],
  warnings: [],
  headerOnlyGroups: {},
  crossGroupPins: [],
  capacityDrift: [],
});

export function buildDispatchContext(
  rawOperations: unknown[],
  rawResources: unknown[],
  config: IDispatchConfig,
): DispatchContext {
  const cfg: Required<IDispatchConfig> = {
    distributeUnassigned:         config.distributeUnassigned ?? true,
    operationCodeField:           config.operationCodeField ?? 'OperationCode',
    machineIdField:               config.machineIdField ?? 'MachineId',
    remainingHoursField:          config.remainingHoursField ?? 'TotalRemainingMachineHours',
    headerCapacityDriftTolerance: config.headerCapacityDriftTolerance ?? 0.10,
  };
  const report = emptyReport();

  const opToGroup = new Map<string, string>();
  for (const o of rawOperations as Record<string, any>[]) {
    const code = o?.Code;
    const group = o?.GroupCode;
    if (code != null && code !== '' && group != null && group !== '') {
      opToGroup.set(String(code), String(group));
    }
  }
  if (opToGroup.size === 0) {
    report.errors.push({
      code: 'OPERATIONS_MISSING',
      severity: 'error',
      message: 'Operations master is empty or lacks Code/GroupCode fields — dispatch preferences cannot be built',
    });
  }

  const resourceByKey = new Map<string, DispatchResourceInfo>();
  const infos: DispatchResourceInfo[] = [];
  for (const r of rawResources as Record<string, any>[]) {
    if (r?.Id == null) continue;
    const info: DispatchResourceInfo = {
      key:        String(r.Id),
      code:       String(r.Code ?? ''),
      groupCode:  opToGroup.get(String(r.OperationsCode ?? '')) ?? null,
      isFinite:   r.IsFinite === true,
      efficiency: Number(r.Efficiency ?? 0),
      raw:        r,
    };
    resourceByKey.set(info.key, info);
    infos.push(info);
  }

  // Groups: header join is GroupCode → header.Code first, then
  // header.OperationsCode (covers the QC→Q / OUT→O naming quirks — verified
  // against the 2026-07-16 capture: 1,648 tasks via Code, 83 via
  // OperationsCode, 0 unresolvable).
  const groups = new Map<string, DispatchGroup>();
  const groupCodes = new Set<string>(opToGroup.values());
  for (const g of groupCodes) {
    const header =
      infos.find(i => !i.isFinite && i.code === g) ??
      infos.find(i => !i.isFinite && String(i.raw.OperationsCode ?? '') === g) ??
      null;
    const members = infos
      .filter(i => i.isFinite && i.groupCode === g)
      .sort((a, b) => (b.efficiency - a.efficiency) || a.code.localeCompare(b.code));
    groups.set(g, { code: g, header, members });
  }

  // Header capacity drift (spec §4): formula capacity on the header vs the
  // sum over finite members. Both sides in hours/week.
  const weekHrs = (r: Record<string, any>) =>
    Number(r.NumOfAvgResource ?? 1) * Number(r.HourCapacityPerDay ?? 0) *
    Number(r.OperatingDayPerWeek ?? 0) * (Number(r.Efficiency ?? 100) / 100);
  for (const g of groups.values()) {
    if (!g.header || g.members.length === 0) continue;
    const headerHrs = weekHrs(g.header.raw);
    const memberHrs = g.members.reduce((s, m) => s + weekHrs(m.raw), 0);
    if (headerHrs <= 0 && memberHrs <= 0) continue;
    const driftPct = Math.abs(headerHrs - memberHrs) / Math.max(headerHrs, memberHrs);
    if (driftPct > cfg.headerCapacityDriftTolerance) {
      report.capacityDrift.push({
        group: g.code,
        headerHrsPerWeek: Math.round(headerHrs * 10) / 10,
        memberHrsPerWeek: Math.round(memberHrs * 10) / 10,
        driftPct: Math.round(driftPct * 1000) / 1000,
      });
      report.warnings.push({
        code: 'HEADER_CAPACITY_DRIFT',
        severity: 'warn',
        group: g.code,
        message: `Group '${g.code}': header formula capacity ${Math.round(headerHrs)} hrs/wk vs member sum ${Math.round(memberHrs)} hrs/wk (${Math.round(driftPct * 100)}% drift)`,
      });
    }
  }

  return { opToGroup, groups, resourceByKey, config: cfg, report };
}

// ── Per-task build ───────────────────────────────────────────────────────────

export interface TaskPreferenceResult {
  /** Grouped-format capacityResources slot, or null → caller keeps legacy emit. */
  slot: {
    isPrimary: boolean;
    qty: number;
    mode: string;
    preferences: { resource: string; rank: number; mode: string }[];
  } | null;
  /** Traceability attributes (spec §3): OperationCode + GroupCode. */
  attributes: { name: string; value: string }[];
}

export function buildTaskPreferences(
  ctx: DispatchContext,
  record: Record<string, any>,
  taskKey: string,
): TaskPreferenceResult {
  const { config: cfg, report } = ctx;
  report.summary.tasks++;

  const opCodeRaw = record[cfg.operationCodeField];
  const opCode = opCodeRaw == null ? '' : String(opCodeRaw);
  const machineIdRaw = record[cfg.machineIdField];
  const machineKey = machineIdRaw == null || machineIdRaw === '' ? null : String(machineIdRaw);
  const machine = machineKey ? ctx.resourceByKey.get(machineKey) : undefined;
  const remainingHours = Number(record[cfg.remainingHoursField] ?? 0) || 0;

  const attributes: { name: string; value: string }[] = [];
  if (opCode) attributes.push({ name: 'OperationCode', value: opCode });

  const group = opCode ? ctx.opToGroup.get(opCode) : undefined;
  if (!group) {
    report.summary.unresolved++;
    report.errors.push({
      code: 'OP_CODE_UNRESOLVED',
      severity: 'error',
      taskKey,
      rawValue: opCodeRaw,
      message: `Task '${taskKey}' operation code '${opCode}' not found in operations master`,
    });
    return { slot: null, attributes };
  }
  attributes.push({ name: 'GroupCode', value: group });

  const groupInfo = ctx.groups.get(group);
  if (!groupInfo || (!groupInfo.header && groupInfo.members.length === 0)) {
    report.summary.unresolved++;
    report.errors.push({
      code: 'GROUP_NO_HEADER',
      severity: 'error',
      taskKey,
      group,
      message: `Task '${taskKey}': group '${group}' has no header resource and no finite members`,
    });
    return { slot: null, attributes };
  }

  const pref = (resource: string, rank: number, mode: string) => ({ resource, rank, mode });

  // R1 — explicit finite assignment: hard pin, group carried as dormant
  // alternates. Engine semantics: any REQUIRED preference masks the rest, so
  // this binds to the machine while recording who else could do it (the
  // unpin seam — flip REQUIRED → PREFERRED to re-admit the group).
  if (machine && machine.isFinite) {
    report.summary.pinned++;
    report.summary.pinnedHours += remainingHours;
    if (machine.groupCode !== group) {
      report.summary.crossGroupPins++;
      report.crossGroupPins.push({
        taskKey, opCode, opGroup: group,
        machineCode: machine.code, machineGroup: machine.groupCode,
      });
    }
    const preferences = [pref(machine.key, 1, 'REQUIRED')];
    let rank = 2;
    for (const m of groupInfo.members) {
      if (m.key === machine.key) continue;
      preferences.push(pref(m.key, rank++, 'AVAILABLE'));
    }
    return { slot: { isPrimary: true, qty: 1, mode: 'ON', preferences }, attributes };
  }

  // R4 — machine referenced but absent from the resource master (e.g. a
  // retired machine still holding open tasks). Warn, then fall through to
  // the group-based R2/R3 path.
  if (machineKey && !machine) {
    report.summary.machineFallback++;
    report.warnings.push({
      code: 'MACHINE_NOT_IN_MASTER',
      severity: 'warn',
      taskKey,
      rawValue: machineIdRaw,
      message: `Task '${taskKey}' references machine id '${machineKey}' not present in the resource master — falling back to group '${group}'`,
    });
  }

  // R2 — unassigned (or header-parked) with real members: distribute.
  if (groupInfo.members.length > 0 && cfg.distributeUnassigned) {
    report.summary.distributed++;
    report.summary.floatHours += remainingHours;
    const preferences = groupInfo.members.map((m, i) => pref(m.key, i + 1, 'PREFERRED'));
    return { slot: { isPrimary: true, qty: 1, mode: 'ON', preferences }, attributes };
  }

  // R3 — header-only group (or distribution disabled): park on the header.
  // If the group somehow has members but no header (distribution disabled +
  // missing header), use the members — work can't be parked on nothing.
  report.summary.headerFallback++;
  report.summary.floatHours += remainingHours;
  report.headerOnlyGroups[group] = (report.headerOnlyGroups[group] ?? 0) + 1;
  const preferences = groupInfo.header
    ? [pref(groupInfo.header.key, 1, 'AVAILABLE')]
    : groupInfo.members.map((m, i) => pref(m.key, i + 1, 'PREFERRED'));
  return { slot: { isPrimary: true, qty: 1, mode: 'ON', preferences }, attributes };
}
