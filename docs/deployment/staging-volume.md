# Staging Volume — Docker Deployment

The CTP API stores ETL staging snapshots on disk. In containerized deployments, this storage must live on a persistent volume, not inside the container image.

## Default location

| Platform | Path |
|---|---|
| Linux / Docker | `/var/ctp/staging` |
| Windows dev | `%LOCALAPPDATA%\ctp\staging` |

Overridable per tenant via `integration/staging.json` (`rootDir` field).

## Docker requirements

```dockerfile
# Dockerfile — relevant lines
VOLUME ["/var/ctp/staging"]
```

The image must **not** write anything to `/var/ctp/staging` during build. Image = code, volume = data. Baking snapshots into the image causes silent data loss when the container is recreated and is hard to detect until the first prune cycle.

## docker-compose example

```yaml
services:
  ctp-api:
    image: ctp-api:latest
    environment:
      TENANT_ID: stafford-engineering-test
    volumes:
      - ctp-staging:/var/ctp/staging
    # ... other config

volumes:
  ctp-staging:
    driver: local
```

A named volume persists across container restarts and recreations. A bind-mount from the host (`- /opt/ctp/staging:/var/ctp/staging`) works equivalently if the host filesystem is the source of truth for backup.

## Backup

Treat the volume as backup-worthy state. Snapshots accumulate at ~15 MB each (Stafford WORK7 scale) and are retained for 30 days by default. A full volume is in the low-GB range.

Typical strategy: nightly `tar -czf` of the volume mount, off-site retention. The CTP process tolerates being restarted at any point — no shutdown coordination needed for backup.

## What's on disk

```
/var/ctp/staging/
└── <tenant>/
    ├── current → 2026-05-23-1430/           # symlink (Linux) or junction (Windows)
    ├── 2026-05-23-1430/                     # promoted snapshot
    │   ├── _metadata.json
    │   ├── _validation-report.json
    │   ├── raw/                             # entity JSON files
    │   └── cleansed/                        # reserved for future use; currently empty
    ├── 2026-05-22-1430.failed/              # validation failed; not promoted
    └── 2026-05-21-1430/                     # older promoted snapshot
```

`*.tmp/` directories from interrupted syncs are cleaned up on container startup (`StagingLifecycleService.onModuleInit`).

## Permissions

The container user owns the volume. The default Docker volume model gives the running process write access — no special privilege required. On Windows dev, junctions are created without admin elevation.

## Health check

```bash
ls -la /var/ctp/staging/<tenant>/current
```

A working tenant has a symlink-or-junction pointing at a `YYYY-MM-DD-HHMM` directory. Missing pointer = no successful sync yet (or staging disabled for this tenant).

## Disabling staging

Tenants without `integration/staging.json` (or with `enabled: false`) bypass the staging layer entirely — `SyncService.sync()` takes the direct adapter path. No volume mount is required for those tenants, but mounting an empty volume is harmless.
