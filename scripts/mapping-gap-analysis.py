"""
Mapping Gap Analysis — interrogate captured WORK7 data and partition fields
into static / dynamic categories. Cross-reference against current mapping
profile. Output: docs/Stafford/mapping-gap-{date}.md (reference only, no
code changes).

Usage: python scripts/mapping-gap-analysis.py
"""
import json
import datetime
from collections import Counter
from pathlib import Path

CAPTURE = Path('tools/mock-genius/recorded/stafford-work7-2026-04-23')
MAPPING_PATH = Path('config/tenants/stafford-engineering-test/integration/mapping.json')
ENTITIES = [
    ('machineAndRessourceEntity',                   77),
    ('salesOrderDetailEntity',                      474),
    ('workOrderWithAdvancedInformationViewEntity',  956),
    ('productionTaskWithAdvancedInfoViewEntity',    3118),
]

OUT = Path(f'docs/Stafford/mapping-gap-{datetime.date.today()}.md')


def load_records(entity):
    records = []
    for p in sorted(CAPTURE.glob(f'{entity}_page*.json')):
        with open(p) as f:
            d = json.load(f)
        records.extend(d.get('Result') or [])
    return records


def shape(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'bool'
    if isinstance(v, int):
        return 'int'
    if isinstance(v, float):
        return 'float'
    if isinstance(v, str):
        return 'str'
    if isinstance(v, list):
        return 'array'
    if isinstance(v, dict):
        return 'object'
    return type(v).__name__


def analyze(entity):
    records = load_records(entity)
    n = len(records)
    if n == 0:
        return None
    field_count = Counter()        # populated (non-null, non-empty)
    field_present = Counter()      # present (incl null)
    field_values = {}              # field -> Counter(stringified values)
    field_types = {}               # field -> Counter(type names)
    all_fields = set()
    for rec in records:
        for k in rec:
            all_fields.add(k)
    for rec in records:
        for k in all_fields:
            if k in rec:
                field_present[k] += 1
                v = rec[k]
                field_types.setdefault(k, Counter())[shape(v)] += 1
                if v is not None and v != '':
                    field_count[k] += 1
                    fv = field_values.setdefault(k, Counter())
                    s = str(v)
                    if len(s) <= 80:
                        fv[s] += 1
                    else:
                        fv[f'<{len(s)}-char>'] += 1
    return {
        'n': n,
        'fields': sorted(all_fields),
        'count': field_count,
        'present': field_present,
        'values': field_values,
        'types': field_types,
    }


def md_escape_pipe(s):
    return s.replace('|', '\\|')


def render_entity(entity, expected_n, lines):
    a = analyze(entity)
    if a is None:
        lines.append(f'## {entity}\n\nNo data found.\n')
        return
    n = a['n']
    lines.append(f'## {entity}')
    lines.append('')
    lines.append(f'**Records:** {n} (expected {expected_n}). **Fields:** {len(a["fields"])}.')
    lines.append('')

    constants, categoricals, highvar, sparse, dead = [], [], [], [], []
    for f in a['fields']:
        c = a['count'][f]
        vals = a['values'].get(f, Counter())
        card = len(vals)
        pct = round(100 * c / n, 1)
        if c == 0:
            dead.append(f)
        elif card == 1:
            constants.append((f, c, list(vals.items())[0][0]))
        elif card <= 30:
            if pct < 50:
                sparse.append((f, c, pct, vals))
            else:
                categoricals.append((f, c, pct, vals))
        else:
            if pct < 50:
                sparse.append((f, c, pct, vals))
            else:
                highvar.append((f, c, pct, card))

    if constants:
        lines.append('### Constant (one distinct value across all records)')
        lines.append('')
        lines.append('| Field | Populated | Value |')
        lines.append('|---|---|---|')
        for f, c, v in sorted(constants):
            v_disp = v if len(v) <= 60 else v[:57] + '...'
            lines.append(f'| `{f}` | {c}/{n} | `{md_escape_pipe(v_disp)}` |')
        lines.append('')

    if categoricals:
        lines.append('### Categorical (2-30 distinct values, >=50% populated)')
        lines.append('')
        lines.append('| Field | Populated | Distinct | Top values |')
        lines.append('|---|---|---|---|')
        for f, c, pct, vals in sorted(categoricals, key=lambda x: -x[1]):
            top = ', '.join([f'`{md_escape_pipe(v)}`={n2}' for v, n2 in vals.most_common(5)])
            extra = '' if len(vals) <= 5 else f' (+{len(vals) - 5} more)'
            lines.append(f'| `{f}` | {c}/{n} ({pct}%) | {len(vals)} | {top}{extra} |')
        lines.append('')

    if highvar:
        lines.append('### High-variance (>30 distinct values, >=50% populated)')
        lines.append('')
        lines.append('| Field | Populated | Distinct |')
        lines.append('|---|---|---|')
        for f, c, pct, card in sorted(highvar, key=lambda x: -x[3]):
            lines.append(f'| `{f}` | {c}/{n} ({pct}%) | {card} |')
        lines.append('')

    if sparse:
        lines.append('### Sparse (<50% populated)')
        lines.append('')
        lines.append('| Field | Populated | Distinct | Top values |')
        lines.append('|---|---|---|---|')
        for f, c, pct, vals_or_card in sorted(sparse, key=lambda x: x[2]):
            if isinstance(vals_or_card, Counter):
                card = len(vals_or_card)
                top = ', '.join([f'`{md_escape_pipe(v)}`' for v, _ in vals_or_card.most_common(3)])
            else:
                card = vals_or_card
                top = '(>30 distinct)'
            lines.append(f'| `{f}` | {c}/{n} ({pct}%) | {card} | {top} |')
        lines.append('')

    if dead:
        lines.append('### Dead (never populated)')
        lines.append('')
        lines.append(', '.join([f'`{f}`' for f in dead]))
        lines.append('')

    lines.append('---')
    lines.append('')


def render_mapping_xref(lines):
    lines.append('## Cross-reference: current `stafford-engineering-test` mapping profile')
    lines.append('')
    try:
        with open(MAPPING_PATH) as f:
            profile = json.load(f)
    except Exception as e:
        lines.append(f'Could not parse mapping profile: {e}')
        lines.append('')
        return
    for section_name in ['orders', 'resources', 'tasks']:
        section = profile.get(section_name, {})
        rules = section.get('mappings', {})
        lines.append(f'### {section_name}')
        lines.append('')
        if not rules:
            lines.append('No mapping rules.')
            lines.append('')
            continue
        lines.append('| Target | Source | Rule type | Notes |')
        lines.append('|---|---|---|---|')
        for tgt, rule in rules.items():
            from_field = rule.get('from')
            if 'lookup' in rule:
                kind = 'lookup'
                note = f"keys: {list(rule['lookup'].keys())}"
            elif rule.get('toUTC'):
                kind = 'toUTC'
                note = ''
            elif 'factor' in rule:
                kind = 'factor'
                note = f"factor: {rule['factor']}"
            elif 'value' in rule:
                kind = 'value'
                note = f"value: {rule['value']}"
            else:
                kind = 'from'
                note = ''
            lines.append(f'| `{tgt}` | `{from_field}` | {kind} | {note} |')
        lines.append('')


def main():
    lines = [
        f'# WORK7 Mapping Gap Analysis — {datetime.date.today()}',
        '',
        'Static vs dynamic field interrogation against the 2026-04-23 WORK7 capture.',
        'For each entity: fields are partitioned by population frequency and cardinality.',
        'Use this to identify mapping rule changes needed before pointing the adapter at real Stafford data.',
        '',
        '**Bands:**',
        '- **Constant** — exactly one distinct non-null value across all records. Candidate for `value` rule, or ignore.',
        '- **Categorical** — 2-30 distinct values, >=50% populated. Candidate for `lookup` rule.',
        '- **High-variance** — 30+ distinct values, >=50% populated. Use `from` (pass-through).',
        '- **Sparse** — <50% populated. Mapping rules need null tolerance.',
        '- **Dead** — never populated. Skip.',
        '',
    ]

    for entity, expected in ENTITIES:
        render_entity(entity, expected, lines)

    render_mapping_xref(lines)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f'Wrote {OUT} ({len(lines)} lines)')
    print()
    print('Tight summary:')
    for entity, expected in ENTITIES:
        a = analyze(entity)
        if not a:
            continue
        n = a['n']
        constants = sum(1 for fld in a['fields'] if len(a['values'].get(fld, Counter())) == 1 and a['count'][fld] > 0)
        dead = sum(1 for fld in a['fields'] if a['count'][fld] == 0)
        cat = sum(1 for fld in a['fields'] if 1 < len(a['values'].get(fld, Counter())) <= 30 and a['count'][fld] / n >= 0.5)
        hv = sum(1 for fld in a['fields'] if len(a['values'].get(fld, Counter())) > 30 and a['count'][fld] / n >= 0.5)
        sparse = sum(1 for fld in a['fields'] if 0 < a['count'][fld] and a['count'][fld] / n < 0.5)
        print(f'  {entity:55s}  records={n:5d}  fields={len(a["fields"]):3d}  '
              f'const={constants:3d}  cat={cat:3d}  hv={hv:3d}  sparse={sparse:3d}  dead={dead:3d}')


if __name__ == '__main__':
    main()
