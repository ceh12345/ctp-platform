# Admin Sprint 1 — Clone Tenant

## Goal
Add a "clone tenant" capability so any tenant configuration can be duplicated as a sandbox for testing actuals, holds, breakdowns, or what-if scenarios without touching the original data.

## Motivation
Testing commitment stack features (running, on_hold, dispatched, completed) requires modifying task data with actuals, WIP states, and holds. Today that means editing the source tenant directly, which pollutes clean demo data. A clone-and-test workflow keeps the original pristine and lets you blow away the sandbox and re-clone when you've made a mess.

## Endpoint

### `POST /v1/admin/clone-tenant`

**Request:**
```json
{
  "sourceTenant": "stafford-engineering",
  "targetTenant": "stafford-sandbox"
}
```

**Response (201):**
```json
{
  "status": "ok",
  "tenant": "stafford-sandbox",
  "source": "stafford-engineering"
}
```

**Error cases:**
| Condition | HTTP | Code |
|---|---|---|
| Source tenant not found | 404 | `SOURCE_NOT_FOUND` |
| Target tenant already exists | 409 | `TENANT_EXISTS` |
| Invalid tenant name | 400 | `INVALID_TENANT_NAME` |

## Behavior

1. **Validate** `sourceTenant` directory exists under `config/tenants/`
2. **Validate** `targetTenant` doesn't already exist (409 if it does)
3. **Validate** `targetTenant` name — alphanumeric + hyphens only, no path traversal (`..`, `/`, `\`)
4. **Recursive copy** `config/tenants/{source}/` to `config/tenants/{target}/`
5. **Patch `tenant.json`** in the clone — update `tenantId` to target name, derive display `name` from the slug (e.g. `stafford-sandbox` becomes `Stafford Sandbox`), set `updatedAt` to now
6. **Return** success with tenant key

No other files inside the tenant directory reference the tenant ID — only `tenant.json` needs patching.

## Tenant Directory Structure (reference)

```
config/tenants/{tenant}/
  tenant.json            # tenantId, name, vertical — ONLY file that references tenant ID
  settings.json          # app settings (solver strategy, detail level)
  horizon.json           # scheduling horizon
  scoring.json           # scoring weights
  colors.json            # UI color overrides
  locale.json            # locale settings
  terminology.json       # custom labels
  configurations.json    # schedule configurations
  data/
    tasks.json           # task definitions + WIP state + actuals
    resources.json       # resource definitions + shifts
    orders.json          # work orders
    materials.json       # material inventory
    products.json        # product definitions
    processes.json       # process routing definitions
    calendars.json       # calendar/shift patterns
    state-changes.json   # state change rules
  schemas/               # (optional) JSON schemas for validation
  kpis/                  # (optional) KPI configuration
```

## UI — Settings > Admin

Add an **Admin** section to the settings left nav. Clone Tenant is the first (and for now, only) admin page.

### Settings Left Nav

```
Settings
  ├── General
  ├── Display
  ├── ...existing sections...
  └── Admin          ← new section
       └── Clone Tenant
```

### Clone Tenant Page

Simple form with:
- **Source Tenant** — dropdown listing all available tenants (from `GET /v1/admin/tenants`)
- **Target Name** — text input for the new tenant slug (auto-validates: lowercase, hyphens, no spaces)
- **Clone** button — calls `POST /v1/admin/clone-tenant`, shows success/error inline
- Below the form: **Existing Clones** table listing tenants with a **Delete** button and a **Switch** link (`?tenant=...`)

### Endpoints (all three this sprint)

| Method | Route | Purpose |
|---|---|---|
| `GET /v1/admin/tenants` | List all tenant directories | Populates source dropdown + clone table |
| `POST /v1/admin/clone-tenant` | Clone a tenant | Core operation |
| `DELETE /v1/admin/tenant/:id` | Delete a tenant | Cleanup; refuses to delete source tenants |

## API Details

### `POST /v1/admin/clone-tenant`

**Request:**
```json
{
  "sourceTenant": "stafford-engineering",
  "targetTenant": "stafford-sandbox"
}
```

**Response (201):**
```json
{
  "status": "ok",
  "tenant": "stafford-sandbox",
  "source": "stafford-engineering"
}
```

### `GET /v1/admin/tenants`

**Response (200):**
```json
{
  "tenants": [
    { "tenantId": "demo-manufacturing", "name": "Demo Manufacturing", "vertical": "manufacturing" },
    { "tenantId": "stafford-engineering", "name": "Stafford Engineering", "vertical": "manufacturing" },
    { "tenantId": "stafford-sandbox", "name": "Stafford Sandbox", "vertical": "manufacturing" }
  ]
}
```

### `DELETE /v1/admin/tenant/:id`

**Response (200):**
```json
{ "status": "ok", "deleted": "stafford-sandbox" }
```

**Error: refuses to delete source tenants (tenants that shipped with the repo).**

### Error Cases

| Condition | HTTP | Code |
|---|---|---|
| Source tenant not found | 404 | `SOURCE_NOT_FOUND` |
| Target tenant already exists | 409 | `TENANT_EXISTS` |
| Invalid tenant name | 400 | `INVALID_TENANT_NAME` |
| Delete refused (source tenant) | 403 | `DELETE_PROTECTED` |

## Files to Change

| File | Change |
|---|---|
| `packages/api/src/modules/ctp/ctp.controller.ts` | Add three admin routes |
| `packages/api/src/modules/ctp/ctp.service.ts` | Add `cloneTenant`, `listTenants`, `deleteTenant` methods |
| `packages/web/src/App.tsx` | Add Admin section to settings left nav, Clone Tenant page |

## Implementation Notes

- Recursive copy: Node `fs.cp` with `{ recursive: true }`
- Tenant name validation: `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/` (min 3 chars)
- Derive display name: split on hyphens, capitalize each word
- Source tenant protection: read `tenant.json` from each dir at startup or maintain a hardcoded list of shipped tenants
- List tenants: read all directories under `config/tenants/`, parse each `tenant.json`
- Delete: `fs.rm` with `{ recursive: true, force: true }` after protection check

## Usage

```
# Clone via API
curl -X POST http://localhost:3000/v1/admin/clone-tenant \
  -H "Content-Type: application/json" \
  -d '{"sourceTenant":"demo-manufacturing","targetTenant":"demo-actuals-test"}'

# Clone via UI
Settings > Admin > Clone Tenant > select source, type name, click Clone

# Switch to clone
http://localhost:3001/?tenant=demo-actuals-test

# Delete when done
Settings > Admin > Clone Tenant > click Delete on the clone row
```

## Future (not this sprint)

- Auth-gate the Admin section based on user role
- UI tenant switcher dropdown in the header bar
