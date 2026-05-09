#!/usr/bin/env python3
"""Slice the WORK7 capture into a smaller mock-genius scenario.

Pulls a coherent subset:
  - All 77 resources (small set; no slicing)
  - N work orders, selected via deterministic three-phase greedy:
      Phase 0 — priority diversity (one smallest WO per distinct Strategy value)
      Phase 1 — department coverage (one smallest WO per uncovered DepartmentCode)
      Phase 2 — fill to target (largest chains first, for length variety)
  - All tasks belonging to those work orders
  - Sales orders that link to selected WOs (via SO.JobCode == WO.Job)

Output is in mock-genius fixture format (plain arrays, one file per entity).
Selection is fully deterministic — secondary sort by WorkOrder code on every tie.

Usage:
    python scripts/slice-fixtures.py [--target-tasks N] [--name SCENARIO_NAME]

Examples:
    python scripts/slice-fixtures.py
    python scripts/slice-fixtures.py --target-tasks 250
    python scripts/slice-fixtures.py --target-tasks 500 --name custom-name
"""

import argparse
import json
import sys
from pathlib import Path
from collections import defaultdict, Counter

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

REPO     = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = REPO / 'tools/mock-genius/recorded/stafford-work7-2026-04-23'
FIXTURES = REPO / 'tools/mock-genius/fixtures'

# Set later from CLI args; load_paged() reads this module-level variable.
SOURCE = DEFAULT_SOURCE


def load_paged(entity_name):
    """Load all records for an entity from page files (or single file) in SOURCE."""
    records = []
    pages = sorted(SOURCE.glob(f'{entity_name}_page*.json'))
    for p in pages:
        with p.open(encoding='utf-8') as f:
            data = json.load(f)
        records.extend(data.get('Result', []))
    if not pages:
        single = SOURCE / f'{entity_name}.json'
        if single.exists():
            with single.open(encoding='utf-8') as f:
                data = json.load(f)
            records.extend(data.get('Result', []))
    return records


def annotate_wos(wos, tasks_by_wo, resources_by_code, statuses):
    """Build per-WO annotations for selection."""
    annotated = []
    for w in wos:
        if w.get('Wostatus') not in statuses:
            continue
        wo_code = w.get('WorkOrder')
        if not wo_code:
            continue
        chain = tasks_by_wo.get(wo_code, [])
        if not chain:
            continue
        deps = set()
        for t in chain:
            mc = t.get('MachineCode')
            if mc and mc in resources_by_code:
                dep = resources_by_code[mc].get('DepartmentCode')
                if dep:
                    deps.add(dep)
        annotated.append({
            'wo': w,
            'code': wo_code,
            'job': w.get('Job'),
            'chain_length': len(chain),
            'departments': deps,
            'strategy': w.get('Strategy'),
            'status': w.get('Wostatus'),
        })
    return annotated


def select_wos(annotated, target_tasks):
    """Three-phase greedy selection. Stable tie-break on WorkOrder code throughout."""

    selected = []
    selected_codes = set()

    def add(a):
        selected.append(a)
        selected_codes.add(a['code'])

    def total_tasks():
        return sum(s['chain_length'] for s in selected)

    # Phase 0 — priority diversity: smallest WO per distinct Strategy value
    strategies = sorted({a['strategy'] for a in annotated if a['strategy'] is not None})
    for strat in strategies:
        candidates = [a for a in annotated
                      if a['strategy'] == strat and a['code'] not in selected_codes]
        if not candidates:
            continue
        # Tie-break: chain_length asc, then WorkOrder code asc (stable)
        best = min(candidates, key=lambda a: (a['chain_length'], a['code']))
        add(best)

    # Phase 1 — department coverage: smallest WO per uncovered department
    all_deps = set()
    for a in annotated:
        all_deps.update(a['departments'])
    covered = set()
    for s in selected:
        covered.update(s['departments'])

    for dep in sorted(all_deps):
        if dep in covered:
            continue
        candidates = [a for a in annotated
                      if dep in a['departments'] and a['code'] not in selected_codes]
        if not candidates:
            continue
        best = min(candidates, key=lambda a: (a['chain_length'], a['code']))
        add(best)
        covered.update(best['departments'])

    # Phase 2 — fill to target: largest chains first for length variety
    remaining = [a for a in annotated if a['code'] not in selected_codes]
    # Tie-break: chain_length desc, then WorkOrder code asc (stable)
    remaining.sort(key=lambda a: (-a['chain_length'], a['code']))
    for a in remaining:
        if total_tasks() >= target_tasks:
            break
        add(a)

    return selected


def main():
    parser = argparse.ArgumentParser(description='Slice WORK7 capture into a smaller scenario.')
    parser.add_argument('--target-tasks', type=int, default=100,
                        help='Approximate task count target (default: 100)')
    parser.add_argument('--name', default=None,
                        help='Output scenario name (default: stafford-work7-{N}tasks)')
    parser.add_argument('--statuses', default='PRINTED,CREATED',
                        help='Comma-separated Wostatus values to include (default: PRINTED,CREATED)')
    parser.add_argument('--source', default=None,
                        help=f'Source recording directory (default: {DEFAULT_SOURCE.name})')
    args = parser.parse_args()

    global SOURCE
    if args.source:
        SOURCE = Path(args.source) if Path(args.source).is_absolute() else (REPO / 'tools/mock-genius/recorded' / args.source)
    if not SOURCE.is_dir():
        print(f'ERROR: source directory not found: {SOURCE}')
        sys.exit(1)

    statuses = set(args.statuses.split(','))
    scenario_name = args.name or f'stafford-work7-{args.target_tasks}tasks'

    print(f'Source:        {SOURCE}')
    print(f'Output:        {FIXTURES / scenario_name}')
    print(f'Target tasks:  ~{args.target_tasks}')
    print(f'WO statuses:   {sorted(statuses)}')
    print()

    wos       = load_paged('workOrderWithAdvancedInformationViewEntity')
    tasks     = load_paged('productionTaskWithAdvancedInfoViewEntity')
    resources = load_paged('machineAndRessourceEntity')
    sos       = load_paged('salesOrderDetailEntity')
    print(f'Loaded {len(wos)} WOs, {len(tasks)} tasks, {len(resources)} resources, {len(sos)} SOs')

    tasks_by_wo = defaultdict(list)
    for t in tasks:
        tasks_by_wo[t.get('WorkOrderCode')].append(t)
    resources_by_code = {r.get('Code'): r for r in resources}

    annotated = annotate_wos(wos, tasks_by_wo, resources_by_code, statuses)
    selected = select_wos(annotated, args.target_tasks)

    selected_wos = [s['wo'] for s in selected]
    selected_codes = {s['code'] for s in selected}
    selected_jobs = {s['job'] for s in selected if s['job']}
    selected_tasks = [t for t in tasks if t.get('WorkOrderCode') in selected_codes]
    selected_sos   = [s for s in sos if s.get('JobCode') in selected_jobs]

    dept_coverage = Counter()
    strategy_dist = Counter()
    status_dist = Counter()
    chain_lengths = []
    for s in selected:
        for d in s['departments']:
            dept_coverage[d] += 1
        strategy_dist[s['strategy']] += 1
        status_dist[s['status']] += 1
        chain_lengths.append(s['chain_length'])

    print()
    print(f'Selected {len(selected_wos)} WOs / {len(selected_tasks)} tasks / {len(selected_sos)} linked SOs')
    print(f'Chain-length range:    {min(chain_lengths)} .. {max(chain_lengths)} (mean {sum(chain_lengths)/len(chain_lengths):.1f})')
    print(f'Department coverage:   {dict(sorted(dept_coverage.items()))}')
    print(f'Strategy distribution: {dict(strategy_dist)}')
    print(f'Status distribution:   {dict(status_dist)}')

    # Stable output ordering
    selected_wos.sort(key=lambda w: w.get('WorkOrder', ''))
    selected_tasks.sort(key=lambda t: (t.get('WorkOrderCode', ''), t.get('Order') or 0))
    selected_sos.sort(key=lambda s: (s.get('JobCode', ''), s.get('LineNumber') or 0))

    out_dir = FIXTURES / scenario_name
    out_dir.mkdir(parents=True, exist_ok=True)

    files_to_write = {
        'workOrderWithAdvancedInformationViewEntity.json': selected_wos,
        'productionTaskWithAdvancedInfoViewEntity.json':   selected_tasks,
        'machineAndRessourceEntity.json':                  resources,
        'salesOrderDetailEntity.json':                     selected_sos,
    }

    for fname, data in files_to_write.items():
        with (out_dir / fname).open('w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)

    print()
    print(f'Wrote 4 files to {out_dir}:')
    print(f'  workOrderWithAdvancedInformationViewEntity.json  {len(selected_wos):>5} records')
    print(f'  productionTaskWithAdvancedInfoViewEntity.json    {len(selected_tasks):>5} records')
    print(f'  machineAndRessourceEntity.json                   {len(resources):>5} records (all)')
    print(f'  salesOrderDetailEntity.json                      {len(selected_sos):>5} records (linked to selected WOs via JobCode)')
    print()
    print(f'Use as mock-genius scenario: MOCK_SCENARIO={scenario_name}')


if __name__ == '__main__':
    main()
