#!/usr/bin/env python3
"""Capture a fresh snapshot of all Genius data endpoints to disk.

Direct curl-style approach (matches the 2026-04-23 capture method).
Bearer token is provided via environment variable to avoid persisting
credentials in scripts.

Usage:
    GENIUS_TOKEN=<uuid> python scripts/capture-genius.py
    GENIUS_TOKEN=<uuid> python scripts/capture-genius.py --base-url <url> --out-dir <dir>

Output: one file per page, named `{entity}_page{N}.json`, plus `_metadata.json`.
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import ssl
from datetime import datetime, date
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

REPO = Path(__file__).resolve().parents[1]

DEFAULT_BASE_URL = 'https://genius.stafford.co.nz:53215'
DEFAULT_OUT_BASE = REPO / 'tools/mock-genius/recorded'

# Entity → filter. None = no filter.
#
# Filters mirror config/tenants/stafford-engineering-test/integration/adapter.json
# so a capture replays through the adapter with the same record set it would see
# live. Keep the two in sync when either side changes.
#
# No spaces inside a filter: urllib.parse.quote() encodes them as %20, which the
# Genius filter parser rejects. AND is a bare '&' (encoded to %26 inside the
# filter value, not a query separator).
ENDPOINTS = {
    'machineAndRessourceEntity':                  'Active=true',
    'salesOrderDetailEntity':                     'ItemStatus!=C',
    'workOrderWithAdvancedInformationViewEntity': 'Wostatus!=CLOSED&Wostatus!=CANCELLED&Job<SYST',
    'productionTaskWithAdvancedInfoViewEntity':   'IsCompleted=false&JobCode<SYST',
    'JobEntity':                                  'Active=true&Job<SYST',
    'operationEntity':                            'Active=true',
}

PAGE_SIZE = 100


def fetch_page(base_url: str, entity: str, page_number: int, page_size: int,
               filter_clause: str | None, token: str, timeout: int = 60) -> dict:
    """Fetch one page of an entity. Returns parsed JSON envelope."""
    qs_parts = [f'pageSize={page_size}', f'pageNumber={page_number}']
    if filter_clause:
        qs_parts.append('filter=' + urllib.parse.quote(filter_clause))
    url = f'{base_url}/api/data/fetch/{entity}?' + '&'.join(qs_parts)

    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {token}',
        'Accept': 'application/json',
    })
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # bypass cert chain on internal Stafford host

    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'HTTP {e.code} on {entity} page {page_number}: {body[:200]}') from e


def capture_entity(base_url: str, entity: str, filter_clause: str | None,
                   out_dir: Path, token: str) -> dict:
    """Capture all pages of one entity. Returns summary dict for _metadata."""
    print(f'\n→ {entity} (filter: {filter_clause or "<none>"})')
    started = time.time()
    page_number = 1
    total_pages = 1
    total_records = 0

    while page_number <= total_pages:
        data = fetch_page(base_url, entity, page_number, PAGE_SIZE, filter_clause, token)

        page_file = out_dir / f'{entity}_page{page_number}.json'
        with page_file.open('w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)

        paging = data.get('PagingInfos', {})
        total_pages = paging.get('TotalPagesFound', 1)
        total_records = paging.get('TotalElementsFound', total_records)
        n_in_page = len(data.get('Result', []))
        print(f'   page {page_number}/{total_pages}  ({n_in_page} records)')
        page_number += 1

    duration_ms = int((time.time() - started) * 1000)
    return {
        'recordCount': total_records,
        'pages': total_pages,
        'queryParams': {
            'pageSize': str(PAGE_SIZE),
            **({'filter': filter_clause} if filter_clause else {}),
        },
        'durationMs': duration_ms,
    }


def logout(base_url: str, token: str) -> None:
    """Best-effort logout to release the token. Non-fatal on failure."""
    req = urllib.request.Request(f'{base_url}/api/auth', method='DELETE',
                                  headers={'Authorization': f'Bearer {token}'})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            print(f'\n✓ logged out (status={resp.status})')
    except Exception as e:
        print(f'\n⚠ logout failed (non-fatal): {e}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default=DEFAULT_BASE_URL)
    parser.add_argument('--out-dir',  default=None,
                        help='Output directory (default: tools/mock-genius/recorded/stafford-work7-<today>)')
    parser.add_argument('--no-logout', action='store_true',
                        help='Skip the logout call at end')
    args = parser.parse_args()

    token = os.environ.get('GENIUS_TOKEN')
    if not token:
        print('ERROR: GENIUS_TOKEN env var not set', file=sys.stderr)
        sys.exit(1)

    today = date.today().isoformat()
    out_dir = Path(args.out_dir) if args.out_dir else (DEFAULT_OUT_BASE / f'stafford-work7-{today}')
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f'Base URL:   {args.base_url}')
    print(f'Output dir: {out_dir}')
    print(f'Endpoints:  {len(ENDPOINTS)}')
    for entity, filter_clause in ENDPOINTS.items():
        print(f'  - {entity:45} {filter_clause or "<none>"}')

    metadata = {
        'capturedAt':  datetime.utcnow().isoformat() + 'Z',
        'upstreamUrl': args.base_url,
        'endpoints':   {},
        'errors':      [],
    }

    for entity, filter_clause in ENDPOINTS.items():
        try:
            metadata['endpoints'][entity] = capture_entity(
                args.base_url, entity, filter_clause, out_dir, token)
        except Exception as e:
            print(f'   ✗ FAILED: {e}')
            metadata['errors'].append({'endpoint': entity, 'message': str(e)})

    with (out_dir / '_metadata.json').open('w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)

    print('\n=== Summary ===')
    for entity, info in metadata['endpoints'].items():
        print(f'  {entity:50} {info["recordCount"]:>5} records, {info["pages"]:>3} pages, {info["durationMs"]:>5}ms')
    if metadata['errors']:
        print(f'\n  Errors: {len(metadata["errors"])}')

    if not args.no_logout:
        logout(args.base_url, token)

    print(f'\nDone. Output: {out_dir}')


if __name__ == '__main__':
    main()
