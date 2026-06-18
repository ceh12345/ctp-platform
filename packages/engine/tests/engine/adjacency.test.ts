"strict";
import { describe, it, expect, vi } from "vitest";
import { CTPTask, CTPTasks } from "../../Models/Entities/task";
import { CTPLinkId } from "../../Models/Core/linkid";
import {
  buildAdjacency,
  topoOrder,
  predsOf,
  succsOf,
  indexByKey,
} from "../../Models/Entities/adjacency";

function mk(key: string, chain: string, prev: string, seq: number): CTPTask {
  const t = new CTPTask("PROCESS", key, key);
  t.linkId = new CTPLinkId(chain, "ES", prev, null);
  t.sequence = seq;
  return t;
}

function collection(arr: CTPTask[]): CTPTasks {
  const ts = new CTPTasks();
  arr.forEach((t) => ts.addEntity(t));
  return ts;
}

/** Assert every task's preds appear before it in the order (valid topo sort). */
function assertTopoValid(order: CTPTask[]): void {
  const pos = new Map<string, number>();
  order.forEach((t, i) => pos.set(t.key, i));
  for (const t of order) {
    for (const p of t.preds) {
      if (pos.has(p)) expect(pos.get(p)!).toBeLessThan(pos.get(t.key)!);
    }
  }
}

describe("buildAdjacency", () => {
  it("linear chain A->B->C: preds/succs are length<=1 and reciprocal", () => {
    const a = mk("A", "CH", "", 1);
    const b = mk("B", "CH", "A", 2);
    const c = mk("C", "CH", "B", 3);
    buildAdjacency(collection([a, b, c]));

    expect(a.preds).toEqual([]);
    expect(a.succs).toEqual(["B"]);
    expect(b.preds).toEqual(["A"]);
    expect(b.succs).toEqual(["C"]);
    expect(c.preds).toEqual(["B"]);
    expect(c.succs).toEqual([]);
  });

  it("fork: one task is prevLink of two -> multi-succ, single-pred each", () => {
    const a = mk("A", "CH", "", 1);
    const b = mk("B", "CH", "A", 2);
    const c = mk("C", "CH", "A", 3);
    buildAdjacency(collection([a, b, c]));

    expect(a.succs.sort()).toEqual(["B", "C"]);
    expect(b.preds).toEqual(["A"]);
    expect(c.preds).toEqual(["A"]);
  });

  it("ignores self-reference, cross-chain, and orphan prevLinks", () => {
    const self = mk("S", "CH", "S", 1); // self-ref
    const x = mk("X", "CH", "", 1);
    const cross = mk("Y", "OTHER", "X", 2); // prev in a different chain
    const orphan = mk("Z", "CH", "GHOST", 3); // prev not in set
    buildAdjacency(collection([self, x, cross, orphan]));

    expect(self.preds).toEqual([]);
    expect(cross.preds).toEqual([]); // cross-chain ignored
    expect(x.succs).toEqual([]); // so X gains no successor
    expect(orphan.preds).toEqual([]); // orphan ignored
  });

  it("is idempotent (clears before rebuilding)", () => {
    const a = mk("A", "CH", "", 1);
    const b = mk("B", "CH", "A", 2);
    const ts = collection([a, b]);
    buildAdjacency(ts);
    buildAdjacency(ts);
    expect(a.succs).toEqual(["B"]); // not ["B","B"]
    expect(b.preds).toEqual(["A"]);
  });
});

describe("predsOf / succsOf", () => {
  it("resolve keys to tasks and skip unresolved keys", () => {
    const a = mk("A", "CH", "", 1);
    const b = mk("B", "CH", "A", 2);
    const ts = collection([a, b]);
    buildAdjacency(ts);
    const byKey = indexByKey(ts);

    expect(succsOf(a, byKey).map((t) => t.key)).toEqual(["B"]);
    expect(predsOf(b, byKey).map((t) => t.key)).toEqual(["A"]);

    b.preds = ["A", "MISSING"]; // unresolved key is skipped
    expect(predsOf(b, byKey).map((t) => t.key)).toEqual(["A"]);
  });
});

describe("topoOrder", () => {
  it("linear chain returns sequence order", () => {
    const a = mk("A", "CH", "", 1);
    const b = mk("B", "CH", "A", 2);
    const c = mk("C", "CH", "B", 3);
    buildAdjacency(collection([a, b, c]));
    const order = topoOrder([c, a, b]); // shuffled input
    expect(order.map((t) => t.key)).toEqual(["A", "B", "C"]);
  });

  it("diamond (multi-pred join, set directly) yields a valid topo order", () => {
    // A -> B, A -> C, B -> D, C -> D  (D has TWO preds — not expressible via
    // prevLink, so wired directly, per the spec's DAG-fixture approach)
    const a = mk("A", "CH", "", 1);
    const b = mk("B", "CH", "", 2);
    const c = mk("C", "CH", "", 3);
    const d = mk("D", "CH", "", 4);
    a.succs = ["B", "C"];
    b.preds = ["A"]; b.succs = ["D"];
    c.preds = ["A"]; c.succs = ["D"];
    d.preds = ["B", "C"];

    const order = topoOrder([d, c, b, a]);
    expect(order.length).toBe(4);
    assertTopoValid(order);
    expect(order[0].key).toBe("A"); // sole source first
    expect(order[3].key).toBe("D"); // sole sink last
  });

  it("cycle falls back to sequence order without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = mk("A", "CH", "", 1);
    const b = mk("B", "CH", "", 2);
    a.preds = ["B"]; a.succs = ["B"];
    b.preds = ["A"]; b.succs = ["A"];

    const order = topoOrder([b, a]);
    expect(order.map((t) => t.key)).toEqual(["A", "B"]); // sequence fallback
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
