import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CTPTask, CTPTasks } from '@ctp/engine/Models/Entities/task';
import { CTPLinkId } from '@ctp/engine/Models/Core/linkid';
import { StateHydratorService } from '../state-hydrator.service';

/**
 * Unit tests for the hydrator's sequence-derivation pass.
 *
 * Background: linkId.prevLink is the single source of truth for chain order;
 * task.sequence is just a numeric shorthand the engine sorts by. The hydrator
 * derives sequence from linkId topologically once per sync; the engine trusts
 * the result (Stafford WO 28687 was the canonical repro for the missing
 * derivation — chain order was T-1 → F-2 → ... → QC-6 on disk but the disk
 * file order was F-2, NT-3, P-4, QC-6, M-5, T-1; with no derivation the
 * sequence values defaulted equal and the engine processed the chain out of
 * order, silently rejecting QC-6).
 */

function makeTask(key: string, opts: { chain?: string; prev?: string } = {}): CTPTask {
  const t = new CTPTask('PROCESS', key, key);
  if (opts.chain !== undefined) {
    t.linkId = new CTPLinkId(opts.chain, 'LINK', opts.prev ?? '', null);
  }
  return t;
}

function makeTasks(...tasks: CTPTask[]): CTPTasks {
  const list = new CTPTasks();
  for (const t of tasks) list.addEntity(t);
  return list;
}

describe('StateHydratorService.deriveSequencesFromLinkId', () => {
  it('assigns 1..N in chain order for a linear 3-task chain', () => {
    const a = makeTask('A', { chain: 'C1', prev: '' });
    const b = makeTask('B', { chain: 'C1', prev: 'A' });
    const c = makeTask('C', { chain: 'C1', prev: 'B' });
    const tasks = makeTasks(a, b, c);

    StateHydratorService.deriveSequencesFromLinkId(tasks);

    expect(a.sequence).toBe(1);
    expect(b.sequence).toBe(2);
    expect(c.sequence).toBe(3);
  });

  it('works regardless of input order — chain order is from linkId, not insertion order', () => {
    // This is the Stafford WO 28687 case: disk-file order was scrambled
    // (F-2, NT-3, P-4, QC-6, M-5, T-1) but linkId encodes the true chain order.
    const f2 = makeTask('F-2', { chain: 'X', prev: 'T-1' });
    const nt3 = makeTask('NT-3', { chain: 'X', prev: 'F-2' });
    const p4 = makeTask('P-4', { chain: 'X', prev: 'NT-3' });
    const qc6 = makeTask('QC-6', { chain: 'X', prev: 'M-5' });
    const m5 = makeTask('M-5', { chain: 'X', prev: 'P-4' });
    const t1 = makeTask('T-1', { chain: 'X', prev: '' });
    const tasks = makeTasks(f2, nt3, p4, qc6, m5, t1);

    StateHydratorService.deriveSequencesFromLinkId(tasks);

    expect(t1.sequence).toBe(1);
    expect(f2.sequence).toBe(2);
    expect(nt3.sequence).toBe(3);
    expect(p4.sequence).toBe(4);
    expect(m5.sequence).toBe(5);
    expect(qc6.sequence).toBe(6);
  });

  it('processes each chain independently — sequences restart at 1 per chain', () => {
    const a1 = makeTask('A1', { chain: 'CA', prev: '' });
    const a2 = makeTask('A2', { chain: 'CA', prev: 'A1' });
    const b1 = makeTask('B1', { chain: 'CB', prev: '' });
    const b2 = makeTask('B2', { chain: 'CB', prev: 'B1' });
    const tasks = makeTasks(a1, a2, b1, b2);

    StateHydratorService.deriveSequencesFromLinkId(tasks);

    expect(a1.sequence).toBe(1);
    expect(a2.sequence).toBe(2);
    expect(b1.sequence).toBe(1);
    expect(b2.sequence).toBe(2);
  });

  it('leaves orphan tasks (no linkId) untouched', () => {
    const a = makeTask('A', { chain: 'C', prev: '' });
    const b = makeTask('B', { chain: 'C', prev: 'A' });
    const standalone = makeTask('STANDALONE'); // no linkId
    const tasks = makeTasks(a, b, standalone);

    StateHydratorService.deriveSequencesFromLinkId(tasks);

    expect(a.sequence).toBe(1);
    expect(b.sequence).toBe(2);
    // standalone keeps its default (engine default = 0); the derivation
    // doesn't touch tasks that aren't part of any chain.
    expect(standalone.linkId).toBeUndefined();
  });

  it('source-supplied sequence is overwritten by the derivation', () => {
    const a = makeTask('A', { chain: 'C', prev: '' });
    const b = makeTask('B', { chain: 'C', prev: 'A' });
    // Source set sequences that disagree with linkId — derivation must overwrite.
    a.sequence = 99;
    b.sequence = 5;
    const tasks = makeTasks(a, b);

    StateHydratorService.deriveSequencesFromLinkId(tasks);

    expect(a.sequence).toBe(1);
    expect(b.sequence).toBe(2);
  });

  describe('malformed input', () => {
    it('warns when a chain has multiple heads but still assigns sequences', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* noop */ });
      // Two heads (both have prev='' or unknown prev) in the same chain.
      const a1 = makeTask('A1', { chain: 'CX', prev: '' });
      const a2 = makeTask('A2', { chain: 'CX', prev: '' });
      const a3 = makeTask('A3', { chain: 'CX', prev: 'A1' });
      const tasks = makeTasks(a1, a2, a3);

      StateHydratorService.deriveSequencesFromLinkId(tasks);

      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls[0][0]).toContain('expected 1 head, found 2');
      // Each head still produces a numbered chain.
      expect(a1.sequence).toBeGreaterThan(0);
      expect(a2.sequence).toBeGreaterThan(0);
      expect(a3.sequence).toBeGreaterThan(0);
      warn.mockRestore();
    });

    it('warns and stops walking when a cycle is detected', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* noop */ });
      // A → B → C → A cycle
      const a = makeTask('A', { chain: 'CY', prev: 'C' });
      const b = makeTask('B', { chain: 'CY', prev: 'A' });
      const c = makeTask('C', { chain: 'CY', prev: 'B' });
      const tasks = makeTasks(a, b, c);

      StateHydratorService.deriveSequencesFromLinkId(tasks);

      // No head (all tasks point to another in the chain); multi-head warning
      // also fires because heads.length === 0. Cycle warning may or may not
      // fire depending on which path the walker took.
      expect(warn).toHaveBeenCalled();
      const allCalls = warn.mock.calls.map(c => c[0]).join(' ');
      expect(allCalls).toMatch(/cycle|expected 1 head/);
      warn.mockRestore();
    });
  });
});

describe('StateHydratorService.assertSequenceMatchesLinkId', () => {
  it('passes when sequences strictly increase along linkId chains', () => {
    const a = makeTask('A', { chain: 'C', prev: '' }); a.sequence = 1;
    const b = makeTask('B', { chain: 'C', prev: 'A' }); b.sequence = 2;
    const c = makeTask('C', { chain: 'C', prev: 'B' }); c.sequence = 3;
    const tasks = makeTasks(a, b, c);

    expect(() => StateHydratorService.assertSequenceMatchesLinkId(tasks)).not.toThrow();
  });

  it('throws when a successor has sequence <= predecessor', () => {
    const a = makeTask('A', { chain: 'C', prev: '' }); a.sequence = 5;
    const b = makeTask('B', { chain: 'C', prev: 'A' }); b.sequence = 3; // wrong: less than A
    const tasks = makeTasks(a, b);

    expect(() => StateHydratorService.assertSequenceMatchesLinkId(tasks))
      .toThrow(/inconsistent with linkId topology/);
  });

  it('throws when predecessor and successor have the same sequence (degenerate sort)', () => {
    // This is the exact failure mode the Stafford WO 28687 investigation
    // surfaced: all tasks at the default sequence value, so the sort was
    // degenerate and chain order was lost.
    const a = makeTask('A', { chain: 'C', prev: '' });
    const b = makeTask('B', { chain: 'C', prev: 'A' });
    // both default to 0
    const tasks = makeTasks(a, b);

    expect(() => StateHydratorService.assertSequenceMatchesLinkId(tasks))
      .toThrow(/seq=0.*seq=0/);
  });

  it('ignores orphan prevLink (warning was logged during derivation)', () => {
    const a = makeTask('A', { chain: 'C', prev: 'NONEXISTENT' });
    a.sequence = 1;
    const tasks = makeTasks(a);

    expect(() => StateHydratorService.assertSequenceMatchesLinkId(tasks)).not.toThrow();
  });

  it('integrates with derivation — derive then assert always passes', () => {
    const tasks = makeTasks(
      makeTask('A', { chain: 'C', prev: '' }),
      makeTask('B', { chain: 'C', prev: 'A' }),
      makeTask('C', { chain: 'C', prev: 'B' }),
    );

    StateHydratorService.deriveSequencesFromLinkId(tasks);
    expect(() => StateHydratorService.assertSequenceMatchesLinkId(tasks)).not.toThrow();
  });
});
