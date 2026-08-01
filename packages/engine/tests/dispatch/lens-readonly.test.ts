import { describe, it, expect } from "vitest";
import { IDispatchPriority } from "../../AI/Dispatch/dispatchpriority";
import { StaticRankPriority } from "../../AI/Dispatch/staticrankpriority";
import { ATCDispatchPriority } from "../../AI/Dispatch/atcdispatchpriority";
import { DBRDispatchPriority } from "../../AI/Dispatch/dbrdispatchpriority";
import { SlackDispatchPriority } from "../../AI/Dispatch/slackdispatchpriority";
import { DispatchStateLens } from "../../AI/Dispatch/dispatchstate";
import { CTPTask } from "../../Models/Entities/task";

const DAY = 86400;

/**
 * The dispatch lens is a READ-ONLY view (SPRINT-dispatch-strategy-seam.md, Phase 4).
 * The `DispatchState` interface exposes only `readonly` fields and derived
 * accessors — no mutators — so this is enforced at the type layer. This test is
 * the runtime guard: a plug's prepare()/compare() must not mutate the ready set
 * or any task it reads. If a future plug sneaks a write, this fails.
 */
function mkTask(resourceKey: string, durSec: number, dueDate: number, rank: number): CTPTask {
  return {
    key: `${resourceKey}-${rank}`,
    dueDate,
    rank,
    latenessPenaltyPerDay: 1,
    customerDeliveryDate: dueDate,
    duration: { duration: () => durSec },
    window: { startW: 0 },
    feasible: null,
    capacityResources: { forEach: (cb: (tr: unknown) => void) => cb({ resource: resourceKey, isPrimary: true }) },
  } as unknown as CTPTask;
}

function snapshot(tasks: CTPTask[]): string {
  return JSON.stringify(
    tasks.map((t) => ({
      key: (t as any).key,
      rank: t.rank,
      dueDate: t.dueDate,
      startW: t.window?.startW,
      customerDeliveryDate: t.customerDeliveryDate,
    })),
  );
}

describe("dispatch lens is read-only", () => {
  const plugs: IDispatchPriority[] = [
    new StaticRankPriority(),
    new ATCDispatchPriority(),
    new DBRDispatchPriority(),
    new SlackDispatchPriority(),
  ];

  for (const plug of plugs) {
    it(`${plug.name} does not mutate the ready set or its tasks`, () => {
      const ready = [
        mkTask("A", 2 * DAY, 5 * DAY, 3),
        mkTask("B", DAY, 3 * DAY, 1),
        mkTask("A", 4 * DAY, 10 * DAY, 2),
      ];
      const before = snapshot(ready);
      const beforeOrder = ready.map((t) => (t as any).key).join(",");

      const lens = new DispatchStateLens(null, null, ready);
      plug.prepare?.(lens);
      // Exercise the comparator across the ready set the way the neighborhood does.
      ready.slice().sort((a, b) => plug.compare(a, b, lens));

      expect(snapshot(ready), `${plug.name} mutated a task field`).toBe(before);
      // The comparator sorts a *copy*; the source ready array is untouched.
      expect(ready.map((t) => (t as any).key).join(","), `${plug.name} reordered the source array`).toBe(beforeOrder);
    });
  }
});
