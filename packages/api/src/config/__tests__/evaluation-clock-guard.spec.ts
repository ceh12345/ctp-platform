import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

/**
 * Phase-1 invariant guard (docs/sprints/SPRINT-evaluation-clock.md).
 *
 * Evaluation modules must read domain time via `ClockService.asOf()`, never the
 * wall clock (`Date.now()` / `DateTime.now()` / `new Date()`). Any such call in
 * these modules must be an EXPLICIT operational exception, annotated
 * `clock:operational` on the same line (perf timers, id generation, log/audit
 * stamps, the horizon anchor resolution itself).
 *
 * The project has no eslint config, so the invariant is enforced here as a
 * normal test — a new unmarked wall-clock call in an evaluation module fails CI.
 * `ClockService` itself is the sanctioned resolver and is intentionally not scanned.
 */
const EVAL_MODULES: ReadonlyArray<readonly [string, string]> = [
  ['orders.service', '../../modules/orders/orders.service.ts'],
  ['ctp.service', '../../modules/ctp/ctp.service.ts'],
];

const NOW_CALL = /\bDate\.now\s*\(\s*\)|\bDateTime\.now\s*\(\s*\)|\bnew\s+Date\s*\(\s*\)/;

function findUnmarked(src: string): string[] {
  // Blank block comments (preserving line count) so now-calls in JSDoc/`/* */`
  // don't count as code.
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const detect = noBlock.split('\n');
  const raw = src.split('\n');
  const offenders: string[] = [];
  detect.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, ''); // drop line comments for detection
    if (NOW_CALL.test(code) && !/clock:operational/.test(raw[i])) {
      offenders.push(`  L${i + 1}: ${raw[i].trim()}`);
    }
  });
  return offenders;
}

describe('evaluation clock invariant (asOf, not wall-clock)', () => {
  for (const [name, rel] of EVAL_MODULES) {
    it(`${name}: no unmarked wall-clock calls`, () => {
      const src = readFileSync(path.resolve(__dirname, rel), 'utf8');
      const offenders = findUnmarked(src);
      expect(
        offenders,
        `Unmarked wall-clock call(s) in ${name}. Read this.clock.asOf() for domain ` +
          `time, or annotate "// clock:operational — <reason>" if truly operational:\n` +
          offenders.join('\n'),
      ).toEqual([]);
    });
  }
});
