/**
 * Batch Optimization Smoke Test
 *
 * Flow:
 *   1. Reset demo-sandbox (everything unscheduled)
 *   2. Solve with Chain/balanced to get a live landscape
 *   3. POST /v1/ctp/optimize  → start background job
 *   4. Poll until complete
 *   5. Report result
 *   6. Accept the job (if improvement found) or reject
 *   7. Drift guard demo — re-run a job, manually solve mid-flight, then try to accept
 *
 * Run:  node run-batch-optimize.mjs
 */

const BASE = 'http://localhost:3000/v1/ctp';
const TENANT = 'demo-sandbox';

// ─── Helpers ───────────────────────────────────────────────────

async function post(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollJob(jobId, intervalMs = 1000, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { body } = await get(`/optimize/${jobId}`);
    const { status, progress, result } = body;

    if (progress) {
      process.stdout.write(
        `\r  [${status}] pass ${progress.currentPass}/${progress.totalPasses}  ` +
        `best=${Math.round(progress.bestMakespanSoFar / 3600 * 10) / 10}h  ` +
        `improvement=${progress.improvementPercent.toFixed(2)}%  ` +
        `elapsed=${progress.elapsedSeconds}s   `
      );
    } else {
      process.stdout.write(`\r  [${status}]...`);
    }

    if (status === 'complete' || status === 'failed') {
      process.stdout.write('\n');
      return body;
    }

    await sleep(intervalMs);
  }
  throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`);
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(' Batch Optimization Smoke Test');
  console.log('═══════════════════════════════════════════════════');

  // ─── Step 1: Reset ───
  console.log('\n[1] Resetting demo-sandbox...');
  const reset = await post(`/admin/tenant/${TENANT}/reset`);
  console.log(`    ${reset.body.status} (source: ${reset.body.source})`);

  // ─── Step 2: Solve ───
  console.log('\n[2] Running constructive solve (Chain / balanced)...');
  const { body: solveResult } = await post('/solve', { tenant: TENANT, strategy: 'Chain', tier: 'balanced' });
  const sr = solveResult.solveResult;
  console.log(`    scheduled=${sr.scheduled}  notScheduled=${sr.notScheduled}  infeasible=${sr.infeasible}  solveTime=${sr.solveTimeMs.toFixed(0)}ms`);

  // ─── Step 3: Start batch job ───
  console.log('\n[3] Starting batch optimization job (5 passes, 60s budget)...');
  const startResult = await post('/optimize', {
    timeBudgetSeconds: 60,
    passes: 5,
    perturbStrength: 0.07,
  });

  if (startResult.status !== 202) {
    console.error('    FAILED to start job:', startResult.body);
    process.exit(1);
  }

  const jobId = startResult.body.jobId;
  console.log(`    jobId: ${jobId}`);

  // ─── Step 4: Poll ───
  console.log('\n[4] Polling until complete...');
  const job = await pollJob(jobId, 500);

  if (job.status === 'failed') {
    console.error(`    Job FAILED: ${job.error}`);
    process.exit(1);
  }

  // ─── Step 5: Report ───
  console.log('\n[5] Result:');
  const r = job.result;
  console.log(`    convergence:      ${r.convergenceReason}`);
  console.log(`    original CP:      ${(r.originalMakespan / 3600).toFixed(2)}h`);
  console.log(`    optimized CP:     ${(r.optimizedMakespan / 3600).toFixed(2)}h`);
  console.log(`    improvement:      ${r.improvementPercent.toFixed(2)}%`);
  console.log(`    total iterations: ${r.iterations.toLocaleString()}`);
  console.log(`    moves evaluated:  ${r.movesEvaluated.toLocaleString()}`);
  console.log(`    elapsed:          ${(r.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`    passes:`);
  for (const p of r.passes) {
    console.log(`      pass ${p.pass}: makespan=${( p.makespan/3600).toFixed(2)}h  improvement=${p.improvement.toFixed(2)}%  iters=${p.iterations}`);
  }

  // ─── Step 6: Accept or Reject ───
  if (r.improvementPercent > 0) {
    console.log('\n[6] Improvement found — accepting...');
    const accept = await post(`/optimize/${jobId}/accept`);
    if (accept.status === 200) {
      const ar = accept.body.result;
      console.log(`    accepted: tasksRescheduled=${ar.tasksRescheduled}  tasksFailed=${ar.tasksFailed}  diff=${ar.diff.length} tasks`);
      if (ar.diff.length > 0) {
        console.log('    diff (top 5 by delta):');
        for (const d of ar.diff.slice(0, 5)) {
          const delta = Math.round(d.startDelta / 60);
          const res = d.movedResource ? `  (${d.originalResource}→${d.optimizedResource})` : '';
          console.log(`      ${d.taskKey}: ${delta > 0 ? '+' : ''}${delta}min${res}`);
        }
      }
    } else {
      console.log(`    accept failed (${accept.status}):`, accept.body);
    }
  } else {
    console.log('\n[6] No improvement found — rejecting...');
    const reject = await post(`/optimize/${jobId}/reject`);
    console.log(`    rejected: ${reject.body.rejected}`);
  }

  // ─── Step 7: Drift Guard Demo ───
  console.log('\n[7] Drift guard demo — start job, re-solve mid-flight, then try to accept...');

  // Start another job
  const drift1 = await post('/optimize', { timeBudgetSeconds: 30, passes: 2 });
  const driftJobId = drift1.body.jobId;
  console.log(`    started jobId: ${driftJobId}`);

  // Re-solve immediately (changes the landscape hash)
  await post('/solve', { tenant: TENANT, strategy: 'Chain', tier: 'balanced' });
  console.log('    re-solved (landscape now has a new hash)');

  // Wait for the drift job to finish
  console.log('    waiting for drift job to complete...');
  const driftJob = await pollJob(driftJobId, 500);
  console.log(`    drift job: ${driftJob.status}  improvement=${driftJob.result?.improvementPercent?.toFixed(2)}%`);

  // Try to accept — should 409 because landscape changed
  if (driftJob.result?.improvementPercent > 0) {
    const driftAccept = await post(`/optimize/${driftJobId}/accept`);
    if (driftAccept.status === 409) {
      console.log(`    409 Conflict (expected): "${driftAccept.body.message}"`);
    } else if (driftAccept.status === 200) {
      console.log('    accepted (hashes matched — solve produced same landscape hash)');
    } else if (driftAccept.status === 400) {
      console.log(`    400 (no snapshot — no improvement found): ${driftAccept.body.message}`);
    }
  } else {
    console.log('    no improvement in drift job — skipping accept (nothing to guard)');
    await post(`/optimize/${driftJobId}/reject`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Done.');
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
