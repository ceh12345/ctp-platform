/**
 * v1 technique registry.
 *
 * Every technique here is a production code path reachable through
 * `appSettings.solverStrategy` — no new algorithms. v1's job is to tell the
 * truth about what the engine already does, which the two collapse groups
 * below make visible.
 *
 * Adding a technique with a different loop shape (parallel SGS, shifting
 * bottleneck, two-phase FJSP assignment) needs a scheduler factory rather than
 * a strategy string; `Technique` is the seam where that goes.
 */

import { Technique } from './technique-harness';

/**
 * Chain-routed techniques.
 *
 * All six are `chainCompatible`, so on a tenant with chain data
 * `basescheduler.ts:884` sends every one of them to `scheduleChainPass`, which
 * orders work by `getChainPriority` and never consults the neighborhood or its
 * dispatch plug. They are expected to produce identical schedules; the harness
 * asserts that explicitly rather than letting it pass unnoticed.
 */
export const CHAIN_TECHNIQUES: Technique[] = [
  {
    key: 'chain',
    label: 'Chain (baseline)',
    solverStrategy: 'Chain',
    expectedDecomposition: 'chain',
    note: 'Production default. Chain-atomic job insertion via ChainContextEngine.',
  },
  {
    key: 'chain-atc',
    label: 'ATC dispatch',
    solverStrategy: 'ATC',
    expectedDecomposition: 'chain',
    note: 'Apparent Tardiness Cost plug. Inert on chained data — chain pass bypasses it.',
  },
  {
    key: 'chain-dbr',
    label: 'DBR dispatch',
    solverStrategy: 'DBR',
    expectedDecomposition: 'chain',
    note: 'Drum-Buffer-Rope plug. Inert on chained data.',
  },
  {
    key: 'chain-slack',
    label: 'Slack dispatch',
    solverStrategy: 'Slack',
    expectedDecomposition: 'chain',
    note: 'Least-slack / critical ratio plug. Inert on chained data.',
  },
  {
    key: 'chain-duedate',
    label: 'Due date',
    solverStrategy: 'DueDate',
    expectedDecomposition: 'chain',
    note: 'Global EDD neighborhood. chainCompatible, so also routed to the chain pass.',
  },
  {
    key: 'chain-firstfit',
    label: 'Chain first fit',
    solverStrategy: 'ChainFirstFit',
    expectedDecomposition: 'chain',
    note: 'First-chain-first neighborhood. chainCompatible, so also routed to the chain pass.',
  },
];

/**
 * Task-routed techniques — the decomposition experiment.
 *
 * `Greedy` and `ShortestFirst` are the only two strategies with
 * `chainCompatible = false`, so they take the per-task serial SGS branch
 * (`scheduleTasksChainAware`) instead of chain-atomic placement. This is the
 * chain-vs-task comparison, run on production code with no gate flipped.
 *
 * Caveat worth knowing when reading the output: `basescheduler.ts:396-398`
 * swaps the neighborhood to `StaticRankPriority` whenever chains exist, so
 * these two share an ordering rule and are expected to match EACH OTHER. What
 * they should NOT match is the chain group — that difference is the signal.
 */
export const TASK_TECHNIQUES: Technique[] = [
  {
    key: 'task-greedy',
    label: 'Task-level (Greedy)',
    solverStrategy: 'Greedy',
    expectedDecomposition: 'task',
    note: 'Per-task serial SGS with predecessor window tightening.',
  },
  {
    key: 'task-shortest',
    label: 'Task-level (SPT)',
    solverStrategy: 'ShortestFirst',
    expectedDecomposition: 'task',
    note: 'Per-task serial SGS. Ordering swapped to StaticRank when chains exist.',
  },
];

/**
 * Processing-sequence techniques — the OTHER selection axis.
 *
 * `scheduleChainPass` ignores the dispatch plug entirely, but it DOES consult
 * `getChainPriority`, which reads `order.processingRanks[activeSequence]` when
 * a sequence is active and falls back to `task.priority` otherwise. So this is
 * the one selection lever that currently reaches the chain pass.
 *
 * It matters on Stafford because the fallback is degenerate: 160 of 166 orders
 * at slim-500 carry priority 5, spanning due dates from 2026-02 to 2027-02.
 * Ranking 96% of the book as a single tie means due dates play no part in what
 * gets scheduled first.
 *
 * `stafford-slim-500` already defines `delivery-date-first` and sets it as
 * `defaultSequence`, so PRODUCTION applies it via `ctp.service.ts:396`. The
 * harness drives the scheduler directly and must set it explicitly — which is
 * why the unsequenced `chain` baseline is not what a Stafford solve actually
 * does today. Both are measured so the difference is visible.
 */
export const SEQUENCE_TECHNIQUES: Technique[] = [
  {
    key: 'chain-edd',
    label: 'Chain + delivery-date-first',
    solverStrategy: 'Chain',
    activeSequence: 'delivery-date-first',
    expectedDecomposition: 'chain',
    note: "The tenant's own defaultSequence — what production actually runs.",
  },
  {
    key: 'chain-woprio',
    label: 'Chain + wo-priority',
    solverStrategy: 'Chain',
    activeSequence: 'wo-priority',
    expectedDecomposition: 'chain',
    note: 'Explicit order.priority ranking — the degenerate control (96% tie).',
  },
];

export const ALL_TECHNIQUES: Technique[] = [
  ...CHAIN_TECHNIQUES,
  ...TASK_TECHNIQUES,
  ...SEQUENCE_TECHNIQUES,
];

export const BASELINE_KEY = 'chain';

/**
 * Instance ladder. Ordered by size so a run can stop early when a technique is
 * too slow to be worth carrying up the ladder.
 *
 * The Stafford slim tenants are real customer data sliced to size, which makes
 * them a genuine scaling study rather than synthetic instances.
 */
export const INSTANCE_LADDER = [
  { tenantId: 'demo-manufacturing', label: 'demo-manufacturing (~29 tasks)' },
  { tenantId: 'acme-outpatient', label: 'acme-outpatient (~39 tasks)' },
  { tenantId: 'stafford-slim-100', label: 'stafford-slim-100 (120 tasks)' },
  { tenantId: 'stafford-slim-500', label: 'stafford-slim-500 (503 tasks)' },
  { tenantId: 'stafford-slim-1000', label: 'stafford-slim-1000 (1016 tasks)' },
  { tenantId: 'stafford-engineering-test', label: 'stafford-engineering-test (1722 tasks)' },
];
