import { IRawDataPayload } from './adapter.interface';

/**
 * Drop WO records (and their tasks) whose `Job` FK isn't present in the
 * active JobEntity set. Stafford-style invariant: Genius's `Wostatus!=CLOSED`
 * filter leaks records belonging to inactive Jobs (typically CANCELLED WOs
 * under a deactivated Job). The mismatch is the entire orphan/headless
 * population observed in the 2026-06-03 WORK7 capture.
 *
 * Opt-in by data presence: if `payload.jobs` is empty, the filter is a
 * pass-through. Records lacking a Job/JobCode field are preserved (lenient).
 */
export function crossFilterByActiveJobs(payload: IRawDataPayload): IRawDataPayload {
  if (payload.jobs.length === 0) return payload;

  const activeJobs = new Set<string>();
  for (const j of payload.jobs as Record<string, unknown>[]) {
    const key = j?.Job;
    if (key != null && key !== '') activeJobs.add(String(key));
  }
  if (activeJobs.size === 0) return payload;

  const orders = (payload.orders as Record<string, unknown>[]).filter(o => {
    const fk = o?.Job;
    return fk == null || fk === '' || activeJobs.has(String(fk));
  });
  const tasks = (payload.tasks as Record<string, unknown>[]).filter(t => {
    const fk = t?.JobCode;
    return fk == null || fk === '' || activeJobs.has(String(fk));
  });

  return { ...payload, orders, tasks };
}
