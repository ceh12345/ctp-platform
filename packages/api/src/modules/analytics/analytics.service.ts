import { Injectable } from '@nestjs/common';
import {
  CTPDateTime,
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
  DisjunctiveGraph,
  CTPResource,
} from '@ctp/engine';
import { StateService } from '../state/state.service';
import { ConfigService } from '../../config/config.service';

export interface IntervalOut {
  start: string;
  end: string;
  durationSec: number;
}

export interface ResourceDaily {
  date: string;
  available: number;
  assigned: number;
  utilization: number;
}

export interface UtilizationResource {
  key: string;
  name: string;
  totalAvailable: number;
  totalAssigned: number;
  utilization: number;
  daily: ResourceDaily[];
}

export interface UtilizationGroup {
  hierarchy: string;
  avgUtilization: number;
  resources: UtilizationResource[];
}

export interface TurnoverEntry {
  resource: string;
  from: string;
  to: string;
  duration: number;
}

export interface ChainPhase {
  taskKey: string;
  name: string;
  type: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  resources: string[];
  duration: number;
}

export interface ChainGap {
  from: string;
  to: string;
  gapSeconds: number;
  backToBack: boolean;
}

export interface Chain {
  caseKey: string;
  caseName: string;
  phases: ChainPhase[];
  gaps: ChainGap[];
  totalDuration: number;
  totalGap: number;
  status: 'complete' | 'partial';
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly stateService: StateService,
    private readonly configService: ConfigService,
  ) {}

  // ── Helpers ───────────────────────────────────────────────────────

  private extractIntervals(list: any): IntervalOut[] {
    const out: IntervalOut[] = [];
    if (!list) return out;
    let node = list.head;
    while (node) {
      out.push({
        start: node.data.AbsoluteStartTime.toISO()!,
        end: node.data.AbsoluteEndTime.toISO()!,
        // workDuration() returns segment-summed time for FLOAT assignments;
        // for calendar intervals (CTPInterval base) it equals duration().
        // Prevents utilization from over-reporting on FLOAT-spanning tasks.
        durationSec: node.data.workDuration(),
      });
      node = node.next;
    }
    return out;
  }

  private noSolveResponse(endpoint: string) {
    return {
      status: 'no-solve',
      message: 'Run Build Schedule to see analytics',
      endpoint,
    };
  }

  private kpiStatus(
    value: number,
    objective: 'maximize' | 'minimize',
    thresholds: { good: number; warning: number },
  ): 'good' | 'warning' | 'critical' {
    if (objective === 'maximize') {
      if (value >= thresholds.good) return 'good';
      if (value >= thresholds.warning) return 'warning';
      return 'critical';
    }
    // minimize — lower is better
    if (value <= thresholds.good) return 'good';
    if (value <= thresholds.warning) return 'warning';
    return 'critical';
  }

  /** Bucket intervals into daily totals by date string */
  private bucketByDate(intervals: IntervalOut[]): Map<string, number> {
    const buckets = new Map<string, number>();
    for (const iv of intervals) {
      const startMs = new Date(iv.start).getTime();
      const endMs = new Date(iv.end).getTime();
      // Walk day boundaries
      let cursor = startMs;
      while (cursor < endMs) {
        const d = new Date(cursor);
        const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const nextDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
        const sliceEnd = Math.min(nextDay, endMs);
        const dur = (sliceEnd - cursor) / 1000;
        buckets.set(dayKey, (buckets.get(dayKey) ?? 0) + dur);
        cursor = sliceEnd;
      }
    }
    return buckets;
  }

  // ── GET /analytics/utilization ────────────────────────────────────

  getUtilization(filters?: { hierarchy?: string; date?: string }) {
    const landscape = this.stateService.getLandscape();
    if (!landscape) return this.noSolveResponse('utilization');

    // Check if any tasks are scheduled
    let hasScheduled = false;
    landscape.tasks.forEach((t) => {
      if (t.state === CTPTaskStateConstants.SCHEDULED) hasScheduled = true;
    });
    if (!hasScheduled) return this.noSolveResponse('utilization');

    const resourceConfigs = this.configService.getResources();
    const configMap = new Map(resourceConfigs.map((r) => [r.key, r]));

    // Build per-resource data
    const groupMap = new Map<string, UtilizationResource[]>();

    landscape.resources.forEach((resource) => {
      const cfg = configMap.get(resource.key);
      const hierarchy = cfg?.hierarchy?.level1 ?? 'Other';

      // Apply hierarchy filter
      if (filters?.hierarchy && hierarchy !== filters.hierarchy) return;

      const availability = this.extractIntervals(resource.original);
      const assignments = this.extractIntervals(resource.available.staticAssignments);

      let totalAvailable = 0;
      for (const iv of availability) totalAvailable += iv.durationSec;
      let totalAssigned = 0;
      for (const iv of assignments) totalAssigned += iv.durationSec;

      // Daily breakdown
      const availByDate = this.bucketByDate(availability);
      const assignByDate = this.bucketByDate(assignments);
      const allDates = new Set([...availByDate.keys(), ...assignByDate.keys()]);
      const daily: ResourceDaily[] = [...allDates].sort().map((date) => {
        const avail = availByDate.get(date) ?? 0;
        const assigned = assignByDate.get(date) ?? 0;
        return {
          date,
          available: Math.round(avail),
          assigned: Math.round(assigned),
          utilization: avail > 0 ? Math.round((assigned / avail) * 1000) / 10 : 0,
        };
      });

      // Apply date filter
      if (filters?.date) {
        const filteredDaily = daily.filter((d) => d.date === filters!.date);
        if (filteredDaily.length === 0) return;
      }

      const resData: UtilizationResource = {
        key: resource.key,
        name: resource.name,
        totalAvailable: Math.round(totalAvailable),
        totalAssigned: Math.round(totalAssigned),
        utilization:
          totalAvailable > 0
            ? Math.round((totalAssigned / totalAvailable) * 1000) / 10
            : 0,
        daily,
      };

      if (!groupMap.has(hierarchy)) groupMap.set(hierarchy, []);
      groupMap.get(hierarchy)!.push(resData);
    });

    // Build groups with avg utilization
    const groups: UtilizationGroup[] = [];
    let bottleneckGroup: { hierarchy: string; utilization: number; resource: string; resourceUtilization: number } | null = null;

    for (const [hierarchy, resources] of groupMap) {
      const avg =
        resources.length > 0
          ? Math.round(
              (resources.reduce((s, r) => s + r.utilization, 0) /
                resources.length) *
                10,
            ) / 10
          : 0;
      groups.push({ hierarchy, avgUtilization: avg, resources });

      for (const r of resources) {
        if (!bottleneckGroup || r.utilization > bottleneckGroup.resourceUtilization) {
          bottleneckGroup = {
            hierarchy,
            utilization: avg,
            resource: r.key,
            resourceUtilization: r.utilization,
          };
        }
      }
    }

    // Sort groups by hierarchy name
    groups.sort((a, b) => a.hierarchy.localeCompare(b.hierarchy));

    return {
      groups,
      bottleneck: bottleneckGroup
        ? {
            ...bottleneckGroup,
            reason: `Highest utilized resource across all groups`,
          }
        : null,
      meta: { computedAt: new Date().toISOString(), resourceCount: landscape.resources.size() },
    };
  }

  // ── GET /analytics/scheduling ─────────────────────────────────────

  getScheduling() {
    const landscape = this.stateService.getLandscape();
    if (!landscape) return this.noSolveResponse('scheduling');

    let hasScheduled = false;
    landscape.tasks.forEach((t) => {
      if (t.state === CTPTaskStateConstants.SCHEDULED) hasScheduled = true;
    });
    if (!hasScheduled) return this.noSolveResponse('scheduling');

    // Count task states
    let totalTasks = 0;
    let scheduled = 0;
    let infeasible = 0;
    let onTimeCount = 0;
    let onTimeTotal = 0;

    // Build per-resource task lists for turnover computation
    const resourceTasks = new Map<string, { start: number; end: number; process: string; taskName: string }[]>();

    landscape.tasks.forEach((task) => {
      // Only count PROCESS tasks for scheduling metrics
      if (task.type === CTPTaskTypeConstants.SET_UP || task.type === CTPTaskTypeConstants.TEAR_DOWN) return;

      totalTasks++;
      const isScheduled = task.state === CTPTaskStateConstants.SCHEDULED;

      if (isScheduled) {
        scheduled++;

        // On-time: scheduled within first 25% of window or within 15 min of window start
        if (task.scheduled && task.window) {
          onTimeTotal++;
          const windowSpan = task.window.endW - task.window.startW;
          const tolerance = Math.min(windowSpan * 0.25, 15 * 60); // 15 min or 25% of window (engine units = seconds)
          if (task.scheduled.startW <= task.window.startW + tolerance) {
            onTimeCount++;
          }
        }

        // Collect per-resource assignments for turnovers
        if (task.scheduled) {
          task.capacityResources?.forEach((entry) => {
            if (entry.scheduledResource) {
              if (!resourceTasks.has(entry.scheduledResource)) {
                resourceTasks.set(entry.scheduledResource, []);
              }
              resourceTasks.get(entry.scheduledResource)!.push({
                start: task.scheduled!.startW,
                end: task.scheduled!.endW,
                process: task.process ?? task.name,
                taskName: task.name,
              });
            }
          });
        }
      } else {
        if (task.includeInSolve) infeasible++;
      }
    });

    // Compute turnovers: gap between consecutive tasks on same resource
    const turnovers: TurnoverEntry[] = [];
    for (const [resourceKey, tasks] of resourceTasks) {
      tasks.sort((a, b) => a.start - b.start);
      for (let i = 0; i < tasks.length - 1; i++) {
        const gap = tasks[i + 1].start - tasks[i].end;
        if (gap > 0) {
          turnovers.push({
            resource: resourceKey,
            from: tasks[i].taskName,
            to: tasks[i + 1].taskName,
            duration: Math.round(gap),
          });
        }
      }
    }

    const avgTurnoverSec =
      turnovers.length > 0
        ? Math.round(turnovers.reduce((s, t) => s + t.duration, 0) / turnovers.length)
        : 0;

    return {
      totalTasks,
      scheduled,
      unscheduled: totalTasks - scheduled,
      infeasible,
      onTimeStarts: {
        count: onTimeCount,
        total: onTimeTotal,
        percentage: onTimeTotal > 0 ? Math.round((onTimeCount / onTimeTotal) * 1000) / 10 : 0,
      },
      avgTurnover: {
        seconds: avgTurnoverSec,
        minutes: Math.round(avgTurnoverSec / 60),
        count: turnovers.length,
        turnovers,
      },
      meta: { computedAt: new Date().toISOString(), taskCount: totalTasks },
    };
  }

  // ── GET /analytics/chains ─────────────────────────────────────────

  getChains(filters?: { caseKey?: string }) {
    const landscape = this.stateService.getLandscape();
    if (!landscape) return this.noSolveResponse('chains');

    let hasScheduled = false;
    landscape.tasks.forEach((t) => {
      if (t.state === CTPTaskStateConstants.SCHEDULED) hasScheduled = true;
    });
    if (!hasScheduled) return this.noSolveResponse('chains');

    // Group tasks by linkId.name (order/case key)
    const caseMap = new Map<string, any[]>();
    landscape.tasks.forEach((task) => {
      const caseKey = task.linkId?.name;
      if (!caseKey) return;
      if (!caseMap.has(caseKey)) caseMap.set(caseKey, []);
      caseMap.get(caseKey)!.push(task);
    });

    // Apply case filter
    if (filters?.caseKey) {
      for (const key of caseMap.keys()) {
        if (key !== filters.caseKey) caseMap.delete(key);
      }
    }

    // Build chains
    const chains: Chain[] = [];
    for (const [caseKey, tasks] of caseMap) {
      // Sort by chain order: build dependency graph from prevLink
      const taskMap = new Map(tasks.map((t) => [t.key, t]));
      const sorted: any[] = [];
      const visited = new Set<string>();

      // Find root tasks (no prevLink or prevLink not in this case)
      const roots = tasks.filter(
        (t) => !t.linkId?.prevLink || !taskMap.has(t.linkId.prevLink),
      );

      // BFS to build chain order
      const queue = [...roots];
      while (queue.length > 0) {
        const t = queue.shift()!;
        if (visited.has(t.key)) continue;
        visited.add(t.key);
        sorted.push(t);
        // Find successors (tasks whose prevLink is t.key)
        for (const candidate of tasks) {
          if (candidate.linkId?.prevLink === t.key && !visited.has(candidate.key)) {
            queue.push(candidate);
          }
        }
      }
      // Add any unvisited tasks at the end
      for (const t of tasks) {
        if (!visited.has(t.key)) sorted.push(t);
      }

      // Build phases
      const phases: ChainPhase[] = sorted.map((task) => {
        const resources: string[] = [];
        task.capacityResources?.forEach((entry: any) => {
          if (entry.scheduledResource) resources.push(entry.scheduledResource);
        });
        return {
          taskKey: task.key,
          name: task.name,
          type: task.type || CTPTaskTypeConstants.PROCESS,
          scheduledStart: task.scheduled
            ? CTPDateTime.toDateTime(task.scheduled.startW).toISO()
            : null,
          scheduledEnd: task.scheduled
            ? CTPDateTime.toDateTime(task.scheduled.endW).toISO()
            : null,
          resources,
          duration: task.scheduled ? Math.round(task.scheduled.duration() / 1000) : 0,
        };
      });

      // Compute gaps
      const gaps: ChainGap[] = [];
      let totalGap = 0;
      for (let i = 0; i < phases.length - 1; i++) {
        const curr = phases[i];
        const next = phases[i + 1];
        let gapSec = 0;
        if (curr.scheduledEnd && next.scheduledStart) {
          gapSec = Math.max(
            0,
            Math.round(
              (new Date(next.scheduledStart).getTime() -
                new Date(curr.scheduledEnd).getTime()) /
                1000,
            ),
          );
        }
        totalGap += gapSec;
        gaps.push({
          from: curr.taskKey,
          to: next.taskKey,
          gapSeconds: gapSec,
          backToBack: gapSec === 0,
        });
      }

      // Total duration: first scheduledStart to last scheduledEnd
      let totalDuration = 0;
      const firstStart = phases.find((p) => p.scheduledStart)?.scheduledStart;
      const lastEnd = [...phases].reverse().find((p) => p.scheduledEnd)?.scheduledEnd;
      if (firstStart && lastEnd) {
        totalDuration = Math.round(
          (new Date(lastEnd).getTime() - new Date(firstStart).getTime()) / 1000,
        );
      }

      const allScheduled = phases.every((p) => p.scheduledStart !== null);

      // Build case name from order config or first task name
      const orderData = this.configService.getOrders();
      const order = orderData.find((o) => o.key === caseKey);
      const caseName = order?.name ?? caseKey;

      chains.push({
        caseKey,
        caseName,
        phases,
        gaps,
        totalDuration,
        totalGap,
        status: allScheduled ? 'complete' : 'partial',
      });
    }

    // Summary
    const totalChains = chains.length;
    const completeChains = chains.filter((c) => c.status === 'complete').length;
    const allGaps = chains.flatMap((c) => c.gaps);
    const allGapSeconds = allGaps.map((g) => g.gapSeconds);
    const avgGapSeconds =
      allGapSeconds.length > 0
        ? Math.round(allGapSeconds.reduce((s, g) => s + g, 0) / allGapSeconds.length)
        : 0;
    const maxGapSeconds =
      allGapSeconds.length > 0 ? Math.max(...allGapSeconds) : 0;
    const backToBackCount = allGaps.filter((g) => g.backToBack).length;
    const backToBackRate =
      allGaps.length > 0
        ? Math.round((backToBackCount / allGaps.length) * 1000) / 10
        : 100;
    const violations = allGaps
      .filter((g) => g.gapSeconds > 0)
      .map((g) => {
        const chain = chains.find((c) => c.gaps.includes(g));
        return { caseKey: chain?.caseKey ?? '', from: g.from, to: g.to, gapSeconds: g.gapSeconds };
      });

    return {
      chains,
      summary: {
        totalChains,
        completeChains,
        avgGapSeconds,
        maxGapSeconds,
        backToBackRate,
        violations,
      },
      meta: { computedAt: new Date().toISOString() },
    };
  }

  // ── GET /analytics/summary ────────────────────────────────────────

  getSummary() {
    const landscape = this.stateService.getLandscape();
    if (!landscape) return { status: 'no-solve', message: 'Run Build Schedule to see analytics', kpis: [] };

    let hasScheduled = false;
    landscape.tasks.forEach((t) => {
      if (t.state === CTPTaskStateConstants.SCHEDULED) hasScheduled = true;
    });
    if (!hasScheduled) return { status: 'no-solve', message: 'Run Build Schedule to see analytics', kpis: [] };

    // Load KPI thresholds from config
    const kpiDefs = this.configService.getKPIs();
    const kpiThresholdMap = new Map(kpiDefs.map((k) => [k.name, k]));

    // Compute all metrics
    const utilData = this.getUtilization();
    const schedData = this.getScheduling();
    const chainData = this.getChains();

    const kpis: any[] = [];

    // Utilization KPIs — one per hierarchy group (dynamic)
    if ('groups' in utilData) {
      for (const group of utilData.groups) {
        const slug = group.hierarchy.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-utilization';
        const def = kpiThresholdMap.get('ORUtilization'); // Use OR thresholds as default for all util
        kpis.push({
          key: slug,
          group: 'Utilization',
          name: `${group.hierarchy} Utilization`,
          value: group.avgUtilization,
          unit: '%',
          status: this.kpiStatus(
            group.avgUtilization,
            'maximize',
            { good: def?.targetValue ?? 70, warning: def?.criticalThreshold ?? 50 },
          ),
          format: 'percent',
        });
      }
    }

    // Scheduling KPIs
    if ('totalTasks' in schedData) {
      const otDef = kpiThresholdMap.get('OnTimeStart');
      kpis.push({
        key: 'on-time-starts',
        group: 'Scheduling',
        name: 'On-Time Starts',
        value: schedData.onTimeStarts.percentage,
        unit: '%',
        status: this.kpiStatus(
          schedData.onTimeStarts.percentage,
          'maximize',
          { good: otDef?.targetValue ?? 90, warning: otDef?.criticalThreshold ?? 75 },
        ),
        format: 'percent',
      });

      const toDef = kpiThresholdMap.get('TurnoverTime');
      kpis.push({
        key: 'avg-turnover',
        group: 'Scheduling',
        name: 'Avg Turnover Time',
        value: schedData.avgTurnover.minutes,
        unit: 'min',
        status: this.kpiStatus(
          schedData.avgTurnover.minutes,
          'minimize',
          { good: toDef?.targetValue ?? 20, warning: toDef?.criticalThreshold ?? 45 },
        ),
        format: 'duration',
      });

      kpis.push({
        key: 'tasks-scheduled',
        group: 'Scheduling',
        name: 'Tasks Scheduled',
        value: `${schedData.scheduled}/${schedData.totalTasks}`,
        unit: '',
        status: this.kpiStatus(
          schedData.totalTasks > 0 ? (schedData.scheduled / schedData.totalTasks) * 100 : 100,
          'maximize',
          { good: 90, warning: 70 },
        ),
        format: 'ratio',
      });

      kpis.push({
        key: 'tasks-infeasible',
        group: 'Scheduling',
        name: 'Infeasible Tasks',
        value: schedData.infeasible,
        unit: '',
        status: schedData.infeasible === 0 ? 'good' : schedData.infeasible <= 2 ? 'warning' : 'critical',
        format: 'count',
      });
    }

    // Chain Integrity KPIs
    if ('summary' in chainData) {
      const summary = chainData.summary;
      kpis.push({
        key: 'avg-gap',
        group: 'Chain Integrity',
        name: 'Avg Gap Between Phases',
        value: Math.round(summary.avgGapSeconds / 60),
        unit: 'min',
        status: this.kpiStatus(summary.avgGapSeconds / 60, 'minimize', { good: 0, warning: 15 }),
        format: 'duration',
      });

      kpis.push({
        key: 'max-gap',
        group: 'Chain Integrity',
        name: 'Max Gap Between Phases',
        value: Math.round(summary.maxGapSeconds / 60),
        unit: 'min',
        status: this.kpiStatus(summary.maxGapSeconds / 60, 'minimize', { good: 0, warning: 15 }),
        format: 'duration',
      });

      kpis.push({
        key: 'back-to-back-rate',
        group: 'Chain Integrity',
        name: 'Back-to-Back Rate',
        value: summary.backToBackRate,
        unit: '%',
        status: this.kpiStatus(summary.backToBackRate, 'maximize', { good: 90, warning: 70 }),
        format: 'percent',
      });

      kpis.push({
        key: 'chain-violations',
        group: 'Chain Integrity',
        name: 'Chain Violations',
        value: summary.violations.length,
        unit: '',
        status: summary.violations.length === 0 ? 'good' : summary.violations.length <= 3 ? 'warning' : 'critical',
        format: 'count',
      });
    }

    // Critical Path KPIs
    const graph = DisjunctiveGraph.buildFromLandscape(landscape);
    const cp = graph?.criticalPath;
    if (cp) {
      kpis.push({
        key: 'critical-path-length',
        name: 'Critical Path',
        group: 'Critical Path',
        value: cp.makespanFormatted,
        numericValue: cp.makespan,
        status: 'info',
        unit: '',
      });
      kpis.push({
        key: 'critical-path-bottleneck',
        name: 'Bottleneck Resource',
        group: 'Critical Path',
        value: `${cp.bottleneckResource.resourceName} (${cp.bottleneckResource.percentOfCriticalPath}%)`,
        numericValue: cp.bottleneckResource.percentOfCriticalPath,
        status: cp.bottleneckResource.percentOfCriticalPath > 50 ? 'warning' : 'good',
        unit: '%',
      });
      kpis.push({
        key: 'critical-path-tasks',
        name: 'Critical Tasks',
        group: 'Critical Path',
        value: `${cp.criticalTasks} of ${cp.totalTasks}`,
        numericValue: cp.criticalTasks,
        status: 'info',
        unit: '',
      });
      kpis.push({
        key: 'near-critical-tasks',
        name: 'Near-Critical (<30m slack)',
        group: 'Critical Path',
        value: cp.nearCriticalTasks,
        numericValue: cp.nearCriticalTasks,
        status: cp.nearCriticalTasks > 5 ? 'warning' : 'good',
        unit: '',
      });
      kpis.push({
        key: 'avg-slack',
        name: 'Average Slack',
        group: 'Critical Path',
        value: this.formatDuration(cp.avgSlack),
        numericValue: cp.avgSlack,
        status: cp.avgSlack < 1800 ? 'warning' : 'good',
        unit: '',
      });
    }

    // Cost KPIs (only if any resources have hourlyRate)
    const costData = this.computeCostData(landscape);
    if (costData && costData.totalCost > 0) {
      const locale = this.configService.getLocale();
      const currency = locale?.currency || 'USD';
      const loc = locale?.locale || 'en-US';
      const fmtCost = (v: number) => v.toLocaleString(loc, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });

      kpis.push({
        key: 'total-schedule-cost',
        name: 'Total Schedule Cost',
        group: 'Cost',
        value: fmtCost(costData.totalCost),
        numericValue: costData.totalCost,
        status: 'info',
        unit: currency,
      });
      kpis.push({
        key: 'most-expensive-resource',
        name: 'Most Expensive Resource',
        group: 'Cost',
        value: `${costData.mostExpensiveResource.name} (${fmtCost(costData.mostExpensiveResource.cost)})`,
        numericValue: costData.mostExpensiveResource.cost,
        status: 'info',
        unit: currency,
      });
      kpis.push({
        key: 'avg-cost-per-task',
        name: 'Avg Cost per Task',
        group: 'Cost',
        value: fmtCost(costData.avgCostPerTask),
        numericValue: costData.avgCostPerTask,
        status: 'info',
        unit: currency,
      });
      kpis.push({
        key: 'most-expensive-order',
        name: 'Most Expensive Order',
        group: 'Cost',
        value: costData.mostExpensiveOrder ? `${costData.mostExpensiveOrder.key} (${fmtCost(costData.mostExpensiveOrder.cost)})` : '—',
        numericValue: costData.mostExpensiveOrder?.cost ?? 0,
        status: 'info',
        unit: currency,
      });
    }

    return {
      kpis,
      meta: { computedAt: new Date().toISOString() },
    };
  }

  private computeCostData(landscape: any): any {
    let totalCost = 0;
    let taskCount = 0;
    const costByResource = new Map<string, { name: string; cost: number; taskCount: number }>();
    const costByOrder = new Map<string, { cost: number }>();

    landscape.tasks.forEach((task: any) => {
      if (task.state !== CTPTaskStateConstants.SCHEDULED || !task.scheduled) return;
      const durationHrs = (task.scheduled.endW - task.scheduled.startW) / 3600;
      let taskCost = 0;

      task.capacityResources?.forEach((entry: any) => {
        if (!entry.scheduledResource) return;
        const res = landscape.resources.getEntity(entry.scheduledResource);
        if (!res?.hourlyRate) return;
        const cost = res.hourlyRate * durationHrs;
        taskCost += cost;

        const prev = costByResource.get(entry.scheduledResource);
        costByResource.set(entry.scheduledResource, {
          name: res.name || entry.scheduledResource,
          cost: (prev?.cost ?? 0) + cost,
          taskCount: (prev?.taskCount ?? 0) + 1,
        });
      });

      if (taskCost > 0) {
        totalCost += taskCost;
        taskCount++;
        const orderKey = task.linkId?.name;
        if (orderKey) {
          const prev = costByOrder.get(orderKey);
          costByOrder.set(orderKey, { cost: (prev?.cost ?? 0) + taskCost });
        }
      }
    });

    if (totalCost === 0) return null;

    const resourceArr = [...costByResource.entries()]
      .map(([k, v]) => ({ key: k, name: v.name, cost: Math.round(v.cost * 100) / 100, taskCount: v.taskCount }))
      .sort((a, b) => b.cost - a.cost);

    const orderArr = [...costByOrder.entries()]
      .map(([k, v]) => ({ key: k, cost: Math.round(v.cost * 100) / 100 }))
      .sort((a, b) => b.cost - a.cost);

    return {
      totalCost: Math.round(totalCost * 100) / 100,
      avgCostPerTask: taskCount > 0 ? Math.round((totalCost / taskCount) * 100) / 100 : 0,
      mostExpensiveResource: resourceArr[0] || { name: '—', cost: 0 },
      mostExpensiveOrder: orderArr[0] || null,
      costByResource: resourceArr,
      costByOrder: orderArr,
      taskCount,
    };
  }

  getCostAnalytics(): any {
    const landscape = this.stateService.getLandscape();
    if (!landscape) return { status: 'no_data' };

    const costData = this.computeCostData(landscape);
    if (!costData) return { status: 'no_cost_data', message: 'No resources with hourly rates configured' };

    const locale = this.configService.getLocale();
    const currency = locale?.currency || 'USD';
    const loc = locale?.locale || 'en-US';
    const fmtCost = (v: number) => v.toLocaleString(loc, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });

    return {
      status: 'ok',
      currency,
      totalCost: costData.totalCost,
      totalCostFormatted: fmtCost(costData.totalCost),
      avgCostPerTask: costData.avgCostPerTask,
      avgCostPerTaskFormatted: fmtCost(costData.avgCostPerTask),
      taskCount: costData.taskCount,
      costByResource: costData.costByResource.map((r: any) => ({
        ...r,
        costFormatted: fmtCost(r.cost),
        percentOfTotal: costData.totalCost > 0 ? Math.round((r.cost / costData.totalCost) * 100) : 0,
      })),
      costByOrder: costData.costByOrder.map((o: any) => ({
        ...o,
        costFormatted: fmtCost(o.cost),
        percentOfTotal: costData.totalCost > 0 ? Math.round((o.cost / costData.totalCost) * 100) : 0,
      })),
    };
  }

  getCriticalPathAnalytics(): any {
    const landscape = this.stateService.getLandscape();
    if (!landscape) return { status: 'no_data' };

    const graph = DisjunctiveGraph.buildFromLandscape(landscape);
    if (!graph.criticalPath) return { status: 'no_critical_path', message: 'No scheduled tasks' };

    const cp = graph.criticalPath;

    // Per-resource breakdown
    const resourceCritTime = new Map<string, { name: string; time: number; taskCount: number }>();
    for (const node of graph.nodes) {
      if (!node.isOnCriticalPath) continue;
      const prev = resourceCritTime.get(node.resourceKey);
      resourceCritTime.set(node.resourceKey, {
        name: node.resourceName,
        time: (prev?.time ?? 0) + node.duration,
        taskCount: (prev?.taskCount ?? 0) + 1,
      });
    }
    const resourceBreakdown: any[] = [];
    for (const [key, val] of resourceCritTime) {
      resourceBreakdown.push({
        resourceKey: key,
        resourceName: val.name,
        criticalTime: val.time,
        criticalTimeFormatted: this.formatDuration(val.time),
        taskCount: val.taskCount,
        percentOfCriticalPath: cp.makespan > 0 ? Math.round((val.time / cp.makespan) * 100) : 0,
      });
    }
    resourceBreakdown.sort((a, b) => b.criticalTime - a.criticalTime);

    // Slack distribution buckets
    const slackBuckets = [
      { label: 'Critical (0)', count: 0, color: '#ef4444' },
      { label: '< 30min', count: 0, color: '#f97316' },
      { label: '30min – 2h', count: 0, color: '#eab308' },
      { label: '2h – 8h', count: 0, color: '#22c55e' },
      { label: '> 8h', count: 0, color: '#3b82f6' },
    ];
    for (const node of graph.nodes) {
      if (node.isOnCriticalPath) slackBuckets[0].count++;
      else if (node.totalSlack < 1800) slackBuckets[1].count++;
      else if (node.totalSlack < 7200) slackBuckets[2].count++;
      else if (node.totalSlack < 28800) slackBuckets[3].count++;
      else slackBuckets[4].count++;
    }

    // Path tasks for strip visualization
    const pathTasks = cp.path.map(p => ({
      key: p.key,
      name: p.name,
      resourceKey: p.resourceKey,
      resourceName: p.resourceName,
      duration: p.duration,
      durationFormatted: this.formatDuration(p.duration),
      start: p.start,
      end: p.end,
    }));

    return {
      status: 'ok',
      makespan: cp.makespan,
      makespanFormatted: cp.makespanFormatted,
      criticalTasks: cp.criticalTasks,
      totalTasks: cp.totalTasks,
      criticalPercent: cp.totalTasks > 0 ? Math.round((cp.criticalTasks / cp.totalTasks) * 100) : 0,
      bottleneckResource: cp.bottleneckResource,
      avgSlack: cp.avgSlack,
      avgSlackFormatted: this.formatDuration(cp.avgSlack),
      nearCriticalTasks: cp.nearCriticalTasks,
      resourceBreakdown,
      slackBuckets,
      segments: cp.segments,
      pathTasks,
    };
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }
}
