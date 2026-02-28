import { CTPStartTimes } from "../../Models/Entities/starttime";

/**
 * Generate boundary ticks for a cadence interval across a horizon.
 * Ticks are aligned to a midnight-based grid so 30-min cadence always
 * produces :00 and :30, regardless of where the horizon starts.
 *
 * @param intervalMinutes  cadence interval (e.g. 30, 15, 60)
 * @param horizonStartW    horizon start in epoch seconds
 * @param horizonEndW      horizon end in epoch seconds
 * @returns sorted array of tick times (epoch seconds)
 */
export function generateCadenceTicks(
  intervalMinutes: number,
  horizonStartW: number,
  horizonEndW: number,
): number[] {
  const ticks: number[] = [];
  const intervalSec = intervalMinutes * 60;
  if (intervalSec <= 0) return ticks;

  // Align to the interval grid from midnight UTC
  const midnight = Math.floor(horizonStartW / 86400) * 86400;
  let tick = midnight;

  // Advance to first tick >= horizonStartW
  while (tick < horizonStartW) {
    tick += intervalSec;
  }

  // Generate ticks through horizon end
  while (tick <= horizonEndW) {
    ticks.push(tick);
    tick += intervalSec;
  }

  return ticks;
}

/**
 * Filter a linked list of CTPStartTime nodes to only allow starts that
 * land on a cadence boundary tick. For each node:
 * - Binary-search for ticks within [eStartW, lStartW]
 * - If none found → remove the node
 * - If found → tighten eStartW/lStartW to the first/last tick in range
 *
 * Mutates the list in-place.
 */
export function filterStartTimesByCadence(
  startTimes: CTPStartTimes,
  ticks: number[],
): void {
  if (!ticks.length) return;

  let node = startTimes.head;

  while (node) {
    const st = node.data;
    const nextNode = node.next;

    // Binary search for first tick >= eStartW
    let lo = 0;
    let hi = ticks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ticks[mid] < st.eStartW) lo = mid + 1;
      else hi = mid;
    }
    const firstTickIdx = lo;

    // Find last tick <= lStartW
    let lastTickIdx = -1;
    for (let i = firstTickIdx; i < ticks.length && ticks[i] <= st.lStartW; i++) {
      lastTickIdx = i;
    }

    if (lastTickIdx < firstTickIdx) {
      // No boundary tick in this start time range — remove it
      startTimes.deleteNode(node);
    } else {
      // Tighten to boundary-aligned window
      const duration = st.duration;
      st.eStartW = ticks[firstTickIdx];
      st.lStartW = ticks[lastTickIdx];
      st.eEndW = st.eStartW + duration;
      st.lEndW = st.lStartW + duration;
    }

    node = nextNode;
  }
}
