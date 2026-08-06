# Sprint — Multi-Environment Tenant Configuration

**Status:** Draft — ready for CC execution
**Estimated effort:** 1.5-2 days
**Dependencies:** Bearer-session auth in RestAdapter (separate sprint, may already exist)
**Output:** Tenant configs split into base + environment overlays, with `CTP_ENVIRONMENT` env var driving environment selection

---

## Goal

Enable a single tenant configuration to work across multiple environments (local mock, recorded fixtures, real Stafford dev, real Stafford prod) without forking the config or duplicating shared settings. Selection driven by a single env var, following established conventions (NODE_ENV / ASPNETCORE_ENVIRONMENT).

Anchored to current Stafford integration: stafford-engineering-test tenant needs to work in four environments simultaneously available, not editable mid-flight.

---

## Why this sprint exists

Right now, swapping between mock-genius and real Genius requires editing tenant config files. That's:

- **Error-prone** — easy to commit a "real Genius" config by mistake
- **Inflexible** — one developer testing against the mock blocks another from testing against fixtures
- **Doesn't scale to multiple tenants** — Stafford prod and Stafford dev both need to coexist when we get production access
- **Conflates concerns** — adapter URL changes drag mapping config along for the ride in diffs

We want: change one env var, hit a different environment. No config edits. No risk of the wrong config landing in production.

---

## Design summary

### Selection mechanism

A single environment variable: `CTP_ENVIRONMENT`.

Acceptable values:
- `local` — mock-genius running locally
- `fixtures` — recorded fixtures replay (no live network)
- `dev` — real Stafford dev environment (WORK7)
- `prod` — real Stafford prod environment (STAFFO, when available)

Adapter reads this at startup. Resolves the appropriate environment overlay file for each tenant. Fails loudly if the value is missing or unrecognized.

### File structure

Per-tenant directory grows from a single config to base + overlays:

```
config/tenants/stafford-engineering-test/
├── base.json                    # shared adapter settings (filters, sync cadence, retry policy)
├── env.local.json               # mock-genius URL, no auth
├── env.fixtures.json            # local fixtures path, no auth
├── env.dev.json                 # real Stafford dev URL, dev credentials via env vars
├── env.prod.json                # real Stafford prod URL, prod credentials via env vars
└── integration/
    └── mapping.json             # shared mapping rules (unchanged by environment)
```

Mapping stays in `integration/mapping.json` as today. Environment files only override adapter-level settings.

### Merge strategy

At startup, for tenant `T` and environment `E`:

1. Load `config/tenants/T/base.json`
2. Load `config/tenants/T/env.{E}.json`
3. Deep-merge: env overrides base, env can add new keys but cannot remove keys defined in base (overrides only)
4. Resolve `${ENV_VAR}` placeholders against process env vars
5. Validate the merged result has all required fields populated

### What's in base.json (shared)

Adapter settings that don't vary by environment:
- Sync filters (`IsCompleted=false`, etc.)
- Pagination defaults (pageSize: 100)
- Retry policy (timeouts, backoff, max attempts)
- Default sync cadence (or rule for which environments enable scheduled sync)
- Reference to mapping config path

Things explicitly NOT in base:
- URLs (those are environment-specific)
- Credentials (those are environment-specific)
- Anything that would be wrong to use in the wrong environment

### What's in env.{name}.json (per-environment)

- `baseUrl` — full URL of the upstream API
- `auth` block — type and credential references (env var names)
- Optional overrides for sync behavior (e.g., enable scheduled sync only in prod)
- Optional overrides for logging (more verbose in dev)

Credentials are NEVER literal values. They're always env var references like `${STAFFORD_DEV_USERNAME}`. Adapter resolves at startup.

---

## Concrete artifacts

### 1. `config/tenants/stafford-engineering-test/base.json`

```json
{
  "tenantId": "stafford-engineering-test",
  "mapping": "integration/mapping.json",

  "filters": {
    "salesOrderDetailEntity":            "ItemStatus!=C",
    "workOrderWithAdvancedInformationViewEntity": "Wostatus!=CLOSED",
    "productionTaskWithAdvancedInfoViewEntity":   "IsCompleted=false"
  },

  "pagination": {
    "pageSize": 100,
    "maxPages": 100
  },

  "retry": {
    "maxAttempts": 3,
    "initialBackoffMs": 500,
    "maxBackoffMs": 8000
  },

  "_comment": "Shared adapter settings. Environment overlays in env.{name}.json provide URLs, credentials, and behavior overrides."
}
```

### 2. `config/tenants/stafford-engineering-test/env.local.json`

```json
{
  "_environment": "local",
  "_comment": "Mock-genius running on localhost. No authentication. Used for offline development and CI.",

  "adapter": {
    "type": "rest",
    "baseUrl": "http://localhost:3001",
    "auth": { "type": "none" }
  },

  "sync": {
    "scheduledSyncEnabled": false
  },

  "logging": {
    "level": "debug"
  }
}
```

### 3. `config/tenants/stafford-engineering-test/env.fixtures.json`

```json
{
  "_environment": "fixtures",
  "_comment": "Recorded fixtures replay. No live network. Used for testing against real-shape Stafford data offline.",

  "adapter": {
    "type": "fixture-replay",
    "fixturePath": "tools/mock-genius/recorded/stafford-work7-2026-04-23"
  },

  "sync": {
    "scheduledSyncEnabled": false
  }
}
```

Note: this requires a `fixture-replay` adapter type that reads from disk instead of HTTP. May be a separate small piece of work — flag in acceptance criteria.

### 4. `config/tenants/stafford-engineering-test/env.dev.json`

```json
{
  "_environment": "dev",
  "_comment": "Real Stafford dev environment (WORK7). Requires VPN and dev credentials.",

  "adapter": {
    "type": "rest",
    "baseUrl": "https://genius.stafford.co.nz:53215",
    "auth": {
      "type": "bearer-session",
      "loginPath": "/api/auth",
      "logoutPath": "/api/auth",
      "credentials": {
        "Username":    "${STAFFORD_DEV_USERNAME}",
        "Password":    "${STAFFORD_DEV_PASSWORD}",
        "CompanyCode": "${STAFFORD_DEV_COMPANY_CODE}"
      },
      "tokenPath": "Result"
    }
  },

  "sync": {
    "scheduledSyncEnabled": false
  },

  "logging": {
    "level": "info"
  }
}
```

### 5. `config/tenants/stafford-engineering-test/env.prod.json`

```json
{
  "_environment": "prod",
  "_comment": "Real Stafford production (STAFFO). Requires production credentials. Scheduled sync enabled. NOT YET IN USE — placeholder until production access is granted.",

  "adapter": {
    "type": "rest",
    "baseUrl": "https://genius.stafford.co.nz:53215",
    "auth": {
      "type": "bearer-session",
      "loginPath": "/api/auth",
      "logoutPath": "/api/auth",
      "credentials": {
        "Username":    "${STAFFORD_PROD_USERNAME}",
        "Password":    "${STAFFORD_PROD_PASSWORD}",
        "CompanyCode": "${STAFFORD_PROD_COMPANY_CODE}"
      },
      "tokenPath": "Result"
    }
  },

  "sync": {
    "scheduledSyncEnabled": true,
    "intervalMinutes": 15
  },

  "logging": {
    "level": "warn"
  }
}
```

### 6. ConfigLoader implementation

A new module / function that:

1. Reads `CTP_ENVIRONMENT` from process env vars
2. For each tenant directory under `config/tenants/`:
   - Reads `base.json`
   - Reads `env.{CTP_ENVIRONMENT}.json`
   - Deep-merges them (env wins on conflict)
   - Resolves `${VAR}` references against process env vars
   - Validates the merged result
3. Returns a fully-resolved tenant configuration to the rest of the system

If `CTP_ENVIRONMENT` is unset, fail with a clear message:
```
Error: CTP_ENVIRONMENT environment variable is not set.
Valid values: local, fixtures, dev, prod
Example: CTP_ENVIRONMENT=local npm start
```

If the selected environment file doesn't exist for a tenant:
```
Error: Tenant 'stafford-engineering-test' has no env.dev.json file.
Available environments: local, fixtures, prod
```

If a required env var placeholder can't be resolved:
```
Error: env.dev.json references ${STAFFORD_DEV_USERNAME} but this env var is not set.
Required env vars for environment 'dev': STAFFORD_DEV_USERNAME, STAFFORD_DEV_PASSWORD, STAFFORD_DEV_COMPANY_CODE
```

### 7. Documentation

A `docs/configuration/multi-environment.md` that documents:
- The four environments and what each is for
- How to set `CTP_ENVIRONMENT`
- Required env vars per environment per tenant
- How to add a new environment to an existing tenant
- How to add a new tenant (file structure to create)
- Examples of running the system in each environment

---

## Acceptance criteria

### Configuration structure
- [ ] `config/tenants/stafford-engineering-test/base.json` exists with shared settings
- [ ] Four environment overlay files exist: `env.local.json`, `env.fixtures.json`, `env.dev.json`, `env.prod.json`
- [ ] Mapping config remains at `integration/mapping.json`, untouched by this sprint
- [ ] No credentials anywhere in any JSON file — only `${VAR}` references

### ConfigLoader behavior
- [ ] Reads `CTP_ENVIRONMENT`, fails clearly if unset
- [ ] Loads `base.json`, then merges `env.{CTP_ENVIRONMENT}.json` over it
- [ ] Deep-merge handles nested objects correctly (e.g., `auth.credentials` partial override)
- [ ] Resolves `${VAR}` references against `process.env`
- [ ] Fails with clear, actionable error if a referenced env var is missing
- [ ] Fails with clear error if the environment file doesn't exist
- [ ] Returns a fully-resolved object; downstream code doesn't see placeholders

### Validation at startup
- [ ] All four environments load successfully when their env vars are set
- [ ] Missing required field (e.g., `baseUrl`) fails startup with clear error
- [ ] Unknown `CTP_ENVIRONMENT` value fails startup with list of valid values

### Adapter integration
- [ ] RestAdapter receives the resolved config and can connect successfully in `local` (mock-genius)
- [ ] RestAdapter receives the resolved config and can connect successfully in `dev` (real Genius, when on VPN with credentials)
- [ ] `fixture-replay` adapter type is implemented (or stubbed with a clear "not yet implemented" error if this is too much for one sprint — flag in change log)

### Tests
- [ ] Unit tests for ConfigLoader cover: missing env, unknown env, missing env vars, missing files, successful merge
- [ ] Integration test: load each of the four environments, verify expected URL/auth/etc. appear in resolved config
- [ ] No regression: existing tests still pass

### Security hygiene
- [ ] No credentials in any committed file (verified by grep at end)
- [ ] `.gitignore` excludes `.env*` files developers might use locally
- [ ] Documentation explicitly states "credentials never go in JSON config"
- [ ] An example `.env.example` file exists showing what env vars need to be set per environment

### Documentation
- [ ] `docs/configuration/multi-environment.md` covers all four environments
- [ ] How to switch environments documented
- [ ] How to add a new tenant or environment documented

---

## Out of scope

- **Mid-flight environment switching.** Once the process starts, `CTP_ENVIRONMENT` is fixed. No runtime switching. Restart to change.
- **Per-request environment override.** No "this API call goes to dev, that one goes to prod." Whole process operates in one environment.
- **Encrypted credential storage.** Env vars are plain text. Production secret management (Azure Key Vault, etc.) is a separate concern, addressed at deploy time, not config time.
- **UI / API for managing environment configs.** Engineers edit JSON files. No admin interface.
- **Automatic sync of credentials from a central store.** Env vars set by deployment tooling. CTP just reads them.
- **Per-environment mapping overrides.** Mapping is the same in dev and prod. If we ever need this, separate sprint.

---

## Risks and mitigations

### Risk: developer accidentally runs against prod
A developer working locally types `CTP_ENVIRONMENT=prod` (or has it leftover in their shell) and runs against real production data.

**Mitigations:**
- Production environment requires production env vars set. If `STAFFORD_PROD_USERNAME` isn't set, startup fails before any request goes out.
- Production environment (when configured) should have additional safety: maybe require an explicit `CTP_ALLOW_PROD=true` env var. Belt and suspenders.
- Logging at startup should clearly state which environment is active: `[CTP] Starting in environment: dev (Stafford WORK7)`.
- Consider a "are you sure" prompt for prod in interactive contexts.

### Risk: env var leaks via logs or error messages
Process logs printing the resolved config could expose credentials.

**Mitigations:**
- ConfigLoader has a `redact()` method that masks credential values in any logged or displayed config.
- Test that error messages never include resolved credential values.
- Production logging level (`warn`) reduces incidental output.

### Risk: tenant config files accumulate stale environment overlays
Over time, environments are added and abandoned. Old `env.staging.json` files might reference URLs that no longer exist.

**Mitigations:**
- Documentation says "remove env files when retiring environments."
- Audit scripts could flag tenants with environment files referencing unreachable URLs.
- Not a launch blocker; cleanup hygiene rather than safety.

### Risk: deep-merge edge cases
Merging nested objects can have surprising semantics — arrays especially. Does env.dev arrays replace base arrays or append?

**Mitigations:**
- Document the merge semantics clearly: "objects deep-merge, arrays replace, primitives override."
- Avoid arrays in environment overlays if possible — design configs so the things env files override are always primitives or objects.
- Unit tests for merge edge cases.

---

## Migration plan

For the existing live config:

1. Read the current `config/tenants/stafford-engineering-test/integration/mapping.json` — stays put, no changes.
2. Read the current adapter config (wherever it lives today) — split into `base.json` (shared) + `env.local.json` (current dev settings, since today everything points at mock).
3. Create the other three environment files (fixtures, dev, prod) as new artifacts.
4. Update any startup code that reads tenant config to use the new ConfigLoader.
5. Set `CTP_ENVIRONMENT=local` as the default in development scripts (`package.json` scripts, dev docker-compose, etc.) — preserves current behavior.
6. Document that contributors need to set `CTP_ENVIRONMENT` for non-local work.

The migration is non-breaking if `local` is the default and matches today's setup.

---

## Definition of done

1. All four environment files exist for stafford-engineering-test tenant
2. ConfigLoader implemented, tested, integrated with adapter startup
3. Adapter successfully starts and connects in `local` environment
4. Adapter successfully starts and connects in `dev` environment (verified once when next on VPN)
5. Adapter fails cleanly with helpful errors in misconfigured states (tested)
6. Documentation written
7. No credentials in any committed file
8. Existing tests still pass
9. Migration plan executed — no behavior regression in current mock-based development workflow

---

## Stretch goals (not required for this sprint)

- **Add `staging` environment** if Stafford has a staging instance distinct from dev. Just another env file, no code changes needed once the framework is in place.
- **Configuration hot-reload.** Restart-free env switching. Tempting but adds complexity; defer until proven necessary.
- **Tenant-aware logging context.** Every log line tagged with tenant + environment. Makes multi-tenant debugging easier.
- **Schema validation for environment files.** JSON schema document that env files must conform to. Useful but not blocking.

---

## Notes for CC implementing this

- Read `cc-prompt-mapping-proposed-v3.md` for context on what the mapping changes are doing concurrently. Multi-environment work is independent of mapping work but they overlap in time.
- The `fixture-replay` adapter type is the only genuinely new component required. Everything else is config restructuring + a loader. Most of the sprint is in the loader and the docs.
- The Bearer-session auth in `env.dev.json` and `env.prod.json` may already exist as a separate piece of work. Coordinate.
- Be careful with the credential redaction. It's the kind of thing that's easy to half-implement (redact in one log path, leak in another). Be thorough or call it out as needing follow-up.
- Don't add features beyond scope. Resist the urge to build a credential vault or a config-management UI. Multi-environment is the goal; everything else is later.

---

*Drafted 2026-04-26 alongside the work-order-centric mapping rework. Multi-environment infrastructure makes both Stafford dev and (eventually) Stafford prod work without forking configs.*
