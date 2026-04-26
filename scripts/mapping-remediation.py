"""
Mapping Remediation Pass — classify broken mapping rules against the
captured WORK7 fixture and produce a remediation report.

Reads:
  - tools/mock-genius/recorded/stafford-work7-2026-04-23/  (fresh re-analysis)
  - config/tenants/stafford-engineering-test/integration/mapping.json

Writes:
  - docs/Stafford/mapping-remediation-{YYYY-MM-DD}.md
  - docs/Stafford/mapping-remediation-{YYYY-MM-DD}.json

Does NOT modify mapping.json. Reuses load_records() and shape() from
mapping-gap-analysis.py.

Usage: python scripts/mapping-remediation.py
"""
import datetime
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

CAPTURE = Path('tools/mock-genius/recorded/stafford-work7-2026-04-23')
MAPPING_PATH = Path('config/tenants/stafford-engineering-test/integration/mapping.json')
ANALYSIS_SCRIPT = Path('scripts/mapping-gap-analysis.py')

ENTITY_TO_SECTION = {
    'salesOrderDetailEntity': 'orders',
    'machineAndRessourceEntity': 'resources',
    'productionTaskWithAdvancedInfoViewEntity': 'tasks',
}
ALL_ENTITIES = list(ENTITY_TO_SECTION.keys()) + ['workOrderWithAdvancedInformationViewEntity']

PREFIX_STRIP = ['Machine', 'Wo', 'Job', 'Task', 'Item', 'Worker', 'Sales', 'Production']

OUT_MD = Path(f'docs/Stafford/mapping-remediation-{datetime.date.today()}.md')
OUT_JSON = Path(f'docs/Stafford/mapping-remediation-{datetime.date.today()}.json')


def load_analysis_module():
    if not ANALYSIS_SCRIPT.exists():
        raise SystemExit(f'PREREQ FAIL: {ANALYSIS_SCRIPT} not found')
    spec = importlib.util.spec_from_file_location('analysis', ANALYSIS_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules['analysis'] = mod
    spec.loader.exec_module(mod)
    return mod


def prereq_checks():
    if not CAPTURE.exists():
        raise SystemExit(f'PREREQ FAIL: {CAPTURE} not found')
    for entity in ALL_ENTITIES:
        files = list(CAPTURE.glob(f'{entity}_page*.json'))
        if not files:
            raise SystemExit(f'PREREQ FAIL: no page files for {entity} in {CAPTURE}')
    if not MAPPING_PATH.exists():
        raise SystemExit(f'PREREQ FAIL: {MAPPING_PATH} not found')
    try:
        with open(MAPPING_PATH) as f:
            json.load(f)
    except Exception as e:
        raise SystemExit(f'PREREQ FAIL: {MAPPING_PATH} does not parse as JSON: {e}')


def levenshtein(a, b):
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = curr
    return prev[-1]


def field_stats(entity_analysis, field):
    """Return (populated, total, populationPct, distinctValues, type) for a field."""
    if entity_analysis is None or field not in entity_analysis['fields']:
        return None
    n = entity_analysis['n']
    populated = entity_analysis['count'][field]
    distinct = len(entity_analysis['values'].get(field, Counter()))
    types = entity_analysis['types'].get(field, Counter())
    type_str = '/'.join(sorted(types.keys())) if types else 'unknown'
    pct = round(100 * populated / n, 1) if n else 0.0
    return {
        'type': type_str,
        'populated': populated,
        'total': n,
        'populationPct': pct,
        'distinctValues': distinct,
    }


def find_same_entity_candidates(missing_field, entity_analysis, expected_type=None):
    """Return list of (candidate_field, confidence, heuristic) tuples."""
    if entity_analysis is None:
        return []
    candidates = []
    fields = entity_analysis['fields']

    # 1. Prefix-strip exact match (highest)
    for prefix in PREFIX_STRIP:
        if missing_field.startswith(prefix) and len(missing_field) > len(prefix):
            stripped = missing_field[len(prefix):]
            if stripped in fields:
                candidates.append((stripped, 0.95, f'prefix-strip-exact ({prefix})'))

    # 2. Suffix match
    for f in fields:
        if f != missing_field and len(f) >= 3 and missing_field.endswith(f):
            if not any(c[0] == f for c in candidates):
                candidates.append((f, 0.85, 'suffix-match'))

    # 3. Substring containment (excludes already-matched)
    for f in fields:
        if f != missing_field and len(f) >= 3 and f in missing_field:
            if not any(c[0] == f for c in candidates):
                candidates.append((f, 0.70, 'substring-match'))

    # 4. Levenshtein (last resort)
    if not candidates:
        for f in fields:
            if f == missing_field:
                continue
            d = levenshtein(missing_field.lower(), f.lower())
            ml = max(len(missing_field), len(f))
            if d < ml * 0.5:
                conf = max(0.50, 0.80 - (d / ml))
                stats = field_stats(entity_analysis, f)
                if stats and stats['populated'] / stats['total'] >= 0.5:
                    candidates.append((f, round(conf, 2), f'levenshtein (dist={d})'))

    # Type-and-population gate: drop confidence by 0.2 on type mismatch
    final = []
    for f, conf, heur in candidates:
        stats = field_stats(entity_analysis, f)
        if stats is None:
            continue
        adjusted = conf
        type_note = ''
        if expected_type and stats['type'] != 'null' and expected_type not in stats['type']:
            adjusted = max(0.0, conf - 0.2)
            type_note = f'; type mismatch (rule expects {expected_type}, field is {stats["type"]})'
        final.append({
            'field': f,
            'confidence': round(adjusted, 2),
            'heuristic': heur + type_note,
            'stats': stats,
        })
    final.sort(key=lambda c: -c['confidence'])
    return final


def find_cross_entity_candidates(missing_field, all_analyses, current_entity):
    """Same name (or close) in other entities. Always tagged with semantics warning."""
    out = []
    for entity, analysis in all_analyses.items():
        if entity == current_entity or analysis is None:
            continue
        if missing_field in analysis['fields']:
            stats = field_stats(analysis, missing_field)
            out.append({
                'field': missing_field,
                'entity': entity,
                'stats': stats,
                'warning': 'different entity — semantics may differ; verify before adopting',
            })
    return out


def expected_type_for_rule(rule):
    """Best-guess of expected field type given rule shape."""
    if 'lookup' in rule:
        return 'str'  # lookups usually take string keys
    if rule.get('toUTC'):
        return 'str'
    if 'factor' in rule:
        return 'int/float'
    return None  # passthrough — any type OK


def classify(rule, missing_field, current_entity, all_analyses, key_role=False):
    """
    Return a dict:
      { classification, confidence, suggested?, candidates?, cross_entity?, conceptual_kin?, status }
    classification ∈ DIRECT_RENAME / PARTIAL_POPULATION / DERIVE / AMBIGUOUS / UNMAPPABLE
    """
    entity_analysis = all_analyses.get(current_entity)
    expected_type = expected_type_for_rule(rule)
    same = find_same_entity_candidates(missing_field, entity_analysis, expected_type)
    cross = find_cross_entity_candidates(missing_field, all_analyses, current_entity)

    # PARTIAL POPULATION: field exists but isn't 100% populated
    # (only relevant when missing_field IS in entity but partially populated)
    if entity_analysis and missing_field in entity_analysis['fields']:
        stats = field_stats(entity_analysis, missing_field)
        if stats and stats['populationPct'] < 100.0 and (key_role or stats['populationPct'] < 80.0):
            # Find 100%-populated alternatives
            alternatives = []
            for f in entity_analysis['fields']:
                if f == missing_field:
                    continue
                fs = field_stats(entity_analysis, f)
                if fs and fs['populationPct'] >= 99.5 and fs['type'] == stats['type']:
                    alternatives.append({'field': f, 'stats': fs})
            return {
                'classification': 'PARTIAL_POPULATION',
                'confidence': None,
                'currentFieldStats': stats,
                'alternatives100pct': alternatives[:5],
                'status': 'PARTIAL',
            }
        # Field is fully populated → not actually a problem
        return {
            'classification': 'OK',
            'confidence': 1.0,
            'currentFieldStats': stats,
            'status': 'OK',
        }

    # MISSING — field not in any record
    # Direct rename: top candidate confidence ≥ 0.85
    if same and same[0]['confidence'] >= 0.85:
        return {
            'classification': 'DIRECT_RENAME',
            'confidence': same[0]['confidence'],
            'suggested': same[0],
            'allCandidates': same,
            'crossEntity': cross,
            'status': 'MISSING',
        }

    # Ambiguous: multiple candidates (same-entity ≥ 0.5, OR cross-entity present, with no clear winner)
    multiple_same = len([c for c in same if c['confidence'] >= 0.5]) > 1
    cross_present = len(cross) > 0
    same_low = same and same[0]['confidence'] < 0.85 and same[0]['confidence'] >= 0.5
    if multiple_same or (same_low and cross_present) or (cross_present and not same):
        return {
            'classification': 'AMBIGUOUS',
            'confidence': same[0]['confidence'] if same else 0.5,
            'allCandidates': same,
            'crossEntity': cross,
            'status': 'MISSING',
        }

    # Derive: no rename match but some conceptual relatives exist
    # (heuristic: any same-entity field whose name shares a 3+ char substring with missing,
    #  or that's a boolean/date field for fields ending in "State", "Date", "Status")
    if entity_analysis:
        kin = []
        ml = missing_field.lower()
        for f in entity_analysis['fields']:
            fl = f.lower()
            if f == missing_field:
                continue
            # Substring overlap of 4+ chars
            for i in range(len(ml) - 3):
                if ml[i:i+4] in fl:
                    fs = field_stats(entity_analysis, f)
                    if fs and fs['populationPct'] >= 50:
                        kin.append({'field': f, 'stats': fs})
                        break
        if kin:
            return {
                'classification': 'DERIVE',
                'confidence': None,
                'conceptualKin': kin[:8],
                'crossEntity': cross,
                'note': 'No direct rename found. These same-entity fields share name fragments and could be candidates for a computed transform. Formula is a human decision.',
                'status': 'MISSING',
            }

    # Unmappable: nothing fit
    return {
        'classification': 'UNMAPPABLE',
        'confidence': 0.0,
        'searched': {
            'sameEntityFields': len(entity_analysis['fields']) if entity_analysis else 0,
            'crossEntities': list(all_analyses.keys()),
        },
        'status': 'MISSING',
    }


def collect_rules(profile, section_name):
    """Return list of (target, source_field, rule, key_role_bool)."""
    section = profile.get(section_name, {})
    rules = section.get('mappings', {})
    out = []
    for tgt, rule in rules.items():
        from_field = rule.get('from')
        if isinstance(from_field, list):
            for f in from_field:
                out.append((tgt, f, rule, tgt == 'key'))
        elif from_field:
            out.append((tgt, from_field, rule, tgt == 'key'))
    # Also surface task-specific structural fields
    if section_name == 'tasks':
        cap = section.get('capacityResources', {})
        if cap.get('from'):
            out.append(('capacityResources', cap['from'], cap, False))
        link = section.get('linkId', {})
        for k in ['chainKey', 'orderKey', 'lagHoursField']:
            if link.get(k):
                out.append((f'linkId.{k}', link[k], link, k == 'chainKey'))
    return out


def render_finding_md(f):
    """Render one finding as markdown. Returns list of lines."""
    out = []
    cls = f['classification']
    rule_str = json.dumps(f['currentRule']) if f.get('currentRule') else 'n/a'
    confidence_str = f'(confidence: {f["confidence"]})' if f.get('confidence') is not None else ''

    out.append(f'### {f["entity"]}.{f["ruleTarget"]}')
    out.append('')
    out.append(f'**Currently:** `{rule_str}`')
    if cls == 'OK':
        out.append(f'**Status:** ✓ OK — `{f["currentSourceField"]}` populated {f["currentFieldStats"]["populationPct"]}%')
        out.append('')
        return out
    status_emoji = {'MISSING': '❌', 'PARTIAL': '⚠️'}.get(f['status'], '?')
    if f['status'] == 'MISSING':
        out.append(f'**Status:** {status_emoji} MISSING — `{f["currentSourceField"]}` not found in `{f["entity"]}` records')
    else:
        s = f['currentFieldStats']
        out.append(f'**Status:** {status_emoji} PARTIAL — `{f["currentSourceField"]}` populated {s["populated"]}/{s["total"]} ({s["populationPct"]}%)')
    out.append(f'**Classification:** {cls.replace("_"," ")} {confidence_str}')
    out.append('')

    if cls == 'DIRECT_RENAME':
        s = f['suggested']
        st = s['stats']
        out.append(f'**Suggested replacement:** `{s["field"]}`')
        out.append(f'- Type: {st["type"]}')
        out.append(f'- Populated: {st["populated"]}/{st["total"]} ({st["populationPct"]}%)')
        out.append(f'- Distinct values: {st["distinctValues"]}')
        out.append(f'- Heuristic: {s["heuristic"]}')
        risk = 'Low risk' if f['confidence'] >= 0.85 else 'Review before applying'
        out.append('')
        out.append(f'**Recommended action:** Rename `from: "{f["currentSourceField"]}"` to `from: "{s["field"]}"`. {risk}.')

    elif cls == 'PARTIAL_POPULATION':
        out.append('**Concern:** key fields with null values produce broken landscape entities (no addressable identity).' if f.get('keyRole') else '**Concern:** rule assumes populated data; null/missing values will cause downstream issues.')
        if f.get('alternatives100pct'):
            out.append('')
            out.append('**100%-populated alternatives:**')
            for alt in f['alternatives100pct']:
                a = alt['stats']
                out.append(f'- `{alt["field"]}` — {a["type"]}, {a["populated"]}/{a["total"]} ({a["populationPct"]}%), {a["distinctValues"]} distinct')
        out.append('')
        out.append('**Recommended action:** Either change to a 100%-populated alternative, OR add null-tolerance handling.')

    elif cls == 'AMBIGUOUS':
        if f.get('allCandidates'):
            out.append('**Same-entity candidates:**')
            out.append('')
            for c in f['allCandidates']:
                st = c['stats']
                out.append(f'◇ `{c["field"]}`')
                out.append(f'  - Type: {st["type"]}')
                out.append(f'  - Populated: {st["populated"]}/{st["total"]} ({st["populationPct"]}%)')
                out.append(f'  - Distinct: {st["distinctValues"]}')
                out.append(f'  - Confidence: {c["confidence"]} ({c["heuristic"]})')
            out.append('')
        if f.get('crossEntity'):
            out.append('**Cross-entity candidates** (different entity — semantics may differ; verify before adopting):')
            out.append('')
            for c in f['crossEntity']:
                st = c['stats']
                out.append(f'◇ `{c["field"]}` in `{c["entity"]}`')
                out.append(f'  - Type: {st["type"]}, Populated: {st["populated"]}/{st["total"]} ({st["populationPct"]}%), Distinct: {st["distinctValues"]}')
            out.append('')
        out.append('**Recommended action:** Human decision before applying. Possibly escalate to Stafford if intent unclear.')

    elif cls == 'DERIVE':
        out.append(f'_{f["note"]}_')
        out.append('')
        if f.get('conceptualKin'):
            out.append('**Conceptually-related fields in this entity:**')
            for k in f['conceptualKin']:
                st = k['stats']
                out.append(f'- `{k["field"]}` — {st["type"]}, {st["populationPct"]}% populated, {st["distinctValues"]} distinct')
        if f.get('crossEntity'):
            out.append('')
            out.append('**Cross-entity matches** (semantics may differ):')
            for c in f['crossEntity']:
                out.append(f'- `{c["field"]}` in `{c["entity"]}`')
        out.append('')
        out.append('**Recommended action:** Design a transform/computed field. Formula is a human decision (script does not propose).')

    elif cls == 'UNMAPPABLE':
        out.append(f'**Searched:** {f["searched"]["sameEntityFields"]} fields in this entity, plus 3 other entities.')
        out.append('No rename, suffix, substring, or Levenshtein match. No conceptually-related fields. No cross-entity hits.')
        out.append('')
        out.append('**Recommended action:** Default value, omit field, or escalate to Stafford for schema clarification.')

    out.append('')
    return out


def main():
    prereq_checks()
    analysis = load_analysis_module()

    # Analyze every captured entity once
    all_analyses = {e: analysis.analyze(e) for e in ALL_ENTITIES}

    with open(MAPPING_PATH) as f:
        profile = json.load(f)

    # Process each section
    findings = []
    for entity, section_name in ENTITY_TO_SECTION.items():
        rules = collect_rules(profile, section_name)
        for tgt, src, rule, key_role in rules:
            verdict = classify(rule, src, entity, all_analyses, key_role=key_role)
            verdict['entity'] = section_name
            verdict['entityRaw'] = entity
            verdict['ruleTarget'] = tgt
            verdict['currentRule'] = rule
            verdict['currentSourceField'] = src
            verdict['keyRole'] = key_role
            findings.append(verdict)

    # Build markdown
    today = datetime.date.today()
    lines = [
        f'# Mapping Remediation Report — {today}',
        '',
        f'Classified {len(findings)} mapping rules against captured WORK7 fixtures (n=7,665 records across 4 entities).',
        '',
        '## Summary',
        '',
        '| Entity | OK | DIRECT_RENAME | PARTIAL_POPULATION | DERIVE | AMBIGUOUS | UNMAPPABLE |',
        '|---|---|---|---|---|---|---|',
    ]
    summary = {}
    for f in findings:
        s = summary.setdefault(f['entity'], Counter())
        s[f['classification']] += 1
    for ent in ['orders', 'resources', 'tasks']:
        s = summary.get(ent, Counter())
        lines.append(f'| {ent} | {s.get("OK",0)} | {s.get("DIRECT_RENAME",0)} | {s.get("PARTIAL_POPULATION",0)} | {s.get("DERIVE",0)} | {s.get("AMBIGUOUS",0)} | {s.get("UNMAPPABLE",0)} |')
    lines.append('')

    # Per-entity sections
    for ent in ['orders', 'resources', 'tasks']:
        section_findings = [f for f in findings if f['entity'] == ent]
        problems = [f for f in section_findings if f['classification'] != 'OK']
        oks = [f for f in section_findings if f['classification'] == 'OK']
        lines.append(f'## {ent}')
        lines.append('')
        if not problems:
            lines.append(f'_All {len(oks)} rules OK._')
            lines.append('')
            continue
        lines.append(f'**{len(oks)} OK / {len(problems)} need attention.**')
        lines.append('')
        for f in problems:
            lines.extend(render_finding_md(f))

    # Action plan
    lines.append('## Prioritized action plan')
    lines.append('')
    high = [f for f in findings if f['classification'] == 'DIRECT_RENAME' and f.get('confidence', 0) >= 0.85]
    med = [f for f in findings if f['classification'] == 'DIRECT_RENAME' and 0.70 <= f.get('confidence', 0) < 0.85]
    pop = [f for f in findings if f['classification'] == 'PARTIAL_POPULATION']
    der = [f for f in findings if f['classification'] == 'DERIVE']
    amb = [f for f in findings if f['classification'] == 'AMBIGUOUS']
    un = [f for f in findings if f['classification'] == 'UNMAPPABLE']

    def list_findings(label, items):
        if not items:
            return
        lines.append(f'**{label}** ({len(items)})')
        for f in items:
            sug = f"→ {f.get('suggested',{}).get('field','?')}" if f['classification'] == 'DIRECT_RENAME' else ''
            lines.append(f'- `{f["entity"]}.{f["ruleTarget"]}` (`{f["currentSourceField"]}`) {sug}')
        lines.append('')

    list_findings('Apply immediately (DIRECT_RENAME, confidence ≥ 0.85, low risk)', high)
    list_findings('Review before applying (DIRECT_RENAME, confidence 0.70-0.84)', med)
    list_findings('Decide null-handling strategy (PARTIAL_POPULATION)', pop)
    list_findings('Design transform logic (DERIVE)', der)
    list_findings('Pick option or escalate (AMBIGUOUS)', amb)
    list_findings('Escalate to Stafford (UNMAPPABLE)', un)

    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_MD, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    # JSON sidecar
    json_payload = {
        'generatedAt': datetime.datetime.now().isoformat(),
        'captureDir': str(CAPTURE),
        'mappingProfile': str(MAPPING_PATH),
        'summary': {ent: dict(summary.get(ent, Counter())) for ent in ['orders', 'resources', 'tasks']},
        'findings': findings,
    }
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(json_payload, f, indent=2, default=str)

    # Console summary
    print(f'Wrote {OUT_MD}')
    print(f'Wrote {OUT_JSON}')
    print()
    print('Counts per entity:')
    for ent in ['orders', 'resources', 'tasks']:
        s = summary.get(ent, Counter())
        total = sum(s.values())
        print(f'  {ent:10s}  total={total:2d}  OK={s.get("OK",0):2d}  rename={s.get("DIRECT_RENAME",0):2d}  partial={s.get("PARTIAL_POPULATION",0):2d}  derive={s.get("DERIVE",0):2d}  amb={s.get("AMBIGUOUS",0):2d}  unmap={s.get("UNMAPPABLE",0):2d}')


if __name__ == '__main__':
    main()
