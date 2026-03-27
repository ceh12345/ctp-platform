# CTP Platform — Azure Deployment Guide
*Based on actual deployment walkthrough, March 2026*

---

## Platform Context

- **App:** CTP Scheduling Engine API-as-a-Service (TypeScript / NestJS + Fastify)
- **Monorepo structure:** `packages/engine` + `packages/api` + `packages/web` (React/Vite)
- **Data:** Flat files per tenant loaded on startup (database deferred)
- **Goal:** Personal testing → early beta clients

---

## Architecture — Single URL Deployment

Everything is served from one URL — no CORS, no separate hosting, no source code exposure:

```
https://ctp-platform-api.azurewebsites.net

  /           → React UI (static files served by NestJS)
  /v1/*       → NestJS API endpoints
  /docs       → Swagger UI
```

**How it works:**
- Local dev: `VITE_API_URL=/api` → Vite proxy rewrites `/api/v1/...` → `localhost:3000/v1/...`
- Production: `VITE_API_URL=` (empty) → fetches `/v1/...` directly from same server
- Static serving: `@fastify/static` registered in `main.ts` pointing to `packages/api/public/`
- SPA fallback: Wildcard NestJS controller serves `index.html` for non-API routes
- Deploy: Vite build output (`packages/web/dist/`) copied to `packages/api/public/` in zip

---

## Azure Resources Provisioned

| Resource | Name | Region | Tier | Est. Cost |
|---|---|---|---|---|
| Resource Group | `ctp-platform-rg` | eastus | — | free |
| App Service Plan | `ctp-platform-plan` | centralus | B1 Linux | ~$13/mo |
| Web App | `ctp-platform-api` | centralus | Node 20 | included |
| Storage Account | `ctpplatformfiles` | centralus | Standard LRS | ~$1/mo |
| Storage Container | `tenant-data` | — | private | included |
| Application Insights | `ctp-platform-insights` | centralus | free tier | ~$0 |

> **Note:** Resource group is in `eastus` but compute resources are in `centralus` due to quota limits on the Visual Studio MSDN subscription. Resource group is a logical container only — this is fine.

### Deferred Until Needed
- PostgreSQL Flexible Server
- Azure Cache for Redis
- Azure Service Bus
- Azure API Management

---

## Step-by-Step CLI Commands

### Prerequisites
Install Azure CLI on Windows:
```powershell
winget install Microsoft.AzureCLI
```

Login (use `--tenant` flag to avoid MFA issues):
```powershell
az login --tenant 5076d208-2e10-44b9-8478-ce3cf5238683
```

Verify login:
```powershell
az account show
```

---

### Step 1 — Resource Group
```powershell
az group create `
  --name ctp-platform-rg `
  --location eastus
```

---

### Step 2 — App Service Plan
> ⚠️ `eastus` had no quota on the MSDN subscription — use `centralus` instead.

```powershell
az appservice plan create `
  --resource-group ctp-platform-rg `
  --name ctp-platform-plan `
  --sku B1 `
  --is-linux `
  --location centralus
```

---

### Step 3 — Web App
```powershell
az webapp create `
  --resource-group ctp-platform-rg `
  --plan ctp-platform-plan `
  --name ctp-platform-api `
  --runtime "NODE:20-lts"
```

App URL: `https://ctp-platform-api.azurewebsites.net`

---

### Step 4 — Storage Account
> ⚠️ Storage account names cannot have dashes and must be lowercase.

```powershell
az storage account create `
  --resource-group ctp-platform-rg `
  --name ctpplatformfiles `
  --sku Standard_LRS `
  --kind StorageV2 `
  --location centralus
```

Create the tenant data container:
```powershell
az storage container create `
  --account-name ctpplatformfiles `
  --name tenant-data `
  --public-access off
```

> Note: TLS warning on creation is harmless — Azure applied secure defaults.

---

### Step 5 — Application Insights
> Note: First run installs the `application-insights` CLI extension. Type Y when prompted.

```powershell
az monitor app-insights component create `
  --resource-group ctp-platform-rg `
  --app ctp-platform-insights `
  --location centralus `
  --kind web
```

---

### Step 6 — App Settings
Get your storage connection string:
```powershell
az storage account show-connection-string `
  --resource-group ctp-platform-rg `
  --name ctpplatformfiles `
  --query connectionString -o tsv
```

> ⚠️ Setting app settings via CLI can result in null values due to PowerShell quoting issues. Use the **Portal instead**.

**Set via Portal → `ctp-platform-api` → Settings → Environment variables:**

| Name | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `TENANT_ID` | `tenant-abc` | Default tenant fallback |
| `BLOB_CONNECTION_STRING` | *(paste connection string)* | From step above |
| `PORT` | `8080` | ⚠️ Required — Azure must not use hardcoded 3000 |
| `CONFIG_ROOT` | `/home/site/wwwroot/config` | ⚠️ Required — fixes tenant config path on Azure |

> **PORT and CONFIG_ROOT are critical** — the app will not work without them.

---

### Step 7 — Portal Settings (Day One)

**Always On** — prevents cold start delays:
- App Service → **Settings** → **Configuration** → **General settings**
- Always On → **On** → **Save**

**App Service Logs:**
- App Service → **Monitoring** → **App Service logs**
- Application Logging → **On** → **Save**

---

### Step 8 — GitHub Actions Service Principal

> ⚠️ Basic authentication was disabled on the App Service — publish profile method doesn't work. Use Service Principal instead.

```powershell
az ad sp create-for-rbac `
  --name "ctp-platform-github" `
  --role contributor `
  --scopes /subscriptions/86cd349b-0ea0-4969-a484-62f49ccf55df/resourceGroups/ctp-platform-rg `
  --sdk-auth
```

> Note: `--sdk-auth` deprecation warning is harmless for now.

Copy the entire JSON output and add to GitHub:
- Repo → **Settings** → **Secrets and variables** → **Actions**
- New secret: `AZURE_CREDENTIALS`
- Paste the full JSON block

---

### Step 9 — Create GitHub Actions Workflow Files

Use Claude Code to generate both files:

```
Create two GitHub Actions workflow files in .github/workflows/

File 1: build-check.yml
- Trigger: on every push to main and pull requests to main
- Steps: checkout, setup Node 20, npm ci
  Build order: engine → web (Vite) → api
  Then npx tsc --noEmit

File 2: deploy.yml
- Name: "Build and Deploy to Azure"
- run-name: "Deploy — ${{ github.event.inputs.reason }}"
- Trigger: manual only (workflow_dispatch) with optional input field called "reason"
- Build order: engine → web (Vite) → api
- Copy packages/web/dist/ to deploy/packages/api/public/
- azure/login@v1 using secret AZURE_CREDENTIALS
- azure/webapps-deploy@v3 with app-name ctp-platform-api
- Deploy only the zip package, not source files
```

Push to GitHub:
```powershell
git add .github/workflows/
git commit -m "Add build check and manual deploy workflows"
git push origin main
```

---

## GitHub Actions Workflows

### `build-check.yml` — Runs on Every Push
- Triggers automatically on every push to `main` and PRs
- Build order: `packages/engine` → `packages/web` → `packages/api`
- Runs TypeScript type check
- No deploy — just validates the build
- Sends email if build breaks

### `deploy.yml` — Manual Trigger Only
- GitHub → Actions tab → **Build and Deploy to Azure** → **Run workflow**
- Enter optional comment → click green **Run workflow**
- Uses `AZURE_CREDENTIALS` secret for Azure login
- Deploys only compiled JS + built UI — no source files, no dev dependencies

---

## Deployment Package Contents

```
deploy.zip
  packages/api/dist/          # Compiled API (.js only)
  packages/api/public/        # Built React UI (copied from packages/web/dist/)
  packages/api/package.json
  packages/engine/dist/       # Compiled engine (.js only)
  packages/engine/package.json
  config/tenants/             # Tenant config + demo data
  node_modules/               # Production deps only (--omit=dev)
  package.json
  package-lock.json
```

**Not included:** `.ts` source files, docs, tests, dev dependencies, `.github/`, `.git/`

---

## Tenant Config Structure

```
config/tenants/<tenant-id>/
  ├── tenant.json
  ├── settings.json
  ├── horizon.json
  ├── scoring.json
  ├── terminology.json
  ├── colors.json
  ├── locale.json
  ├── data/
  │   ├── resources.json
  │   ├── tasks.json
  │   ├── calendars.json
  │   ├── orders.json
  │   ├── products.json
  │   ├── materials.json
  │   ├── processes.json
  │   └── state-changes.json
  ├── kpis/
  │   └── kpis.json
  └── schemas/
      ├── task.schema.json
      └── resource.schema.json
```

Tenant is selected via `x-tenant-id` request header. Defaults to `demo-manufacturing`.

---

## Portal vs CLI — What to Use Where

| Task | Use |
|---|---|
| Create resources | **CLI** — faster, repeatable |
| Set environment variables | **Portal** → Environment variables (avoids quoting issues) |
| Upload tenant flat files | **Portal** → Storage → Containers |
| Watch live logs | **Portal** → App Service → Log stream |
| Trigger a manual deploy | **GitHub UI** → Actions → Build and Deploy to Azure → Run workflow |
| Check deployment history | **GitHub UI** → Actions tab |
| Debug errors / exceptions | **Portal** → Application Insights → Failures |
| Restart the app | **Portal** → App Service → Overview → Restart |
| Grab storage connection string | **CLI** → `az storage account show-connection-string` |
| Test API endpoints | **Swagger** → `https://ctp-platform-api.azurewebsites.net/docs` |
| Test via CLI | **Claude Code** → `curl -s -H "x-tenant-id: demo-manufacturing" <url>` |

---

## Known Gotchas

| Issue | Fix |
|---|---|
| `eastus` quota error on MSDN subscription | Use `centralus` for compute resources |
| App settings showing `null` via CLI | Set via Portal → Environment variables instead |
| Basic auth disabled — publish profile won't download | Use Service Principal + `AZURE_CREDENTIALS` secret |
| 63 TS6305 build errors in CI | Monorepo — must build `packages/engine` before `packages/api` |
| TLS warning on storage container create | Harmless — Azure applied secure defaults |
| Node.js 20 deprecation warning in Actions | Update to `@v5` actions before June 2026 (not urgent) |
| 502 Bad Gateway after deploy | App listening on wrong port — set `PORT=8080` in env vars |
| `Tenant 'x' not found` on all routes | Set `CONFIG_ROOT=/home/site/wwwroot/config` in env vars |
| NestJS exception filter crash on Fastify | Don't use raw Fastify `.code()` — use NestJS adapter `.status().send()` or remove custom filter |
| `CTP_ANTHROPIC_API_KEY not set` warning | Harmless — AI chat disabled until key is added |
| UI returns 404 at `/` | `@fastify/static` not registered or wrong public folder path |
| `Not found handler already set for Fastify` | Don't use `setNotFoundHandler()` — use a NestJS wildcard controller for SPA fallback instead |
| `x-tenant-id` not visible in Swagger | Add `.addGlobalParameters()` to Swagger config in `main.ts` |

---

## Verifying the Deployment

**UI:** `https://ctp-platform-api.azurewebsites.net` → React app loads in browser

**Swagger:** `https://ctp-platform-api.azurewebsites.net/docs` → API explorer with `x-tenant-id` header

**API via Claude Code:**
```bash
curl -s -H "x-tenant-id: demo-manufacturing" \
  "https://ctp-platform-api.azurewebsites.net/v1/ctp/state"
```
Expected: `{ "status": "ok", tasks: [...] }` with 29 tasks

---

## Giving a Beta Client Access

1. Add their tenant config folder to `config/tenants/<their-tenant-id>/`
2. Deploy
3. Give them the URL: `https://ctp-platform-api.azurewebsites.net`
4. Tell them their tenant ID to use in the app
5. No install, no setup, browser only

---

## Pending Tasks

- [ ] Add `CTP_ANTHROPIC_API_KEY` when ready to enable AI chat
- [ ] Fix custom exception filter properly for Fastify
- [ ] Update GitHub Actions to Node 24 before June 2026 (not urgent)
- [ ] Add proper auth before sharing with beta clients

---

## When You're Ready to Scale

| Trigger | Add |
|---|---|
| Beta clients needing auth | API keys via Azure API Management |
| Files change without restart | Add a `/reload` endpoint |
| Slow startup with large files | Redis landscape cache |
| Data persistence | PostgreSQL Flexible Server |
| High availability | Scale out App Service + Redis session |

---

*Last updated: March 2026 — first successful full-stack deployment*
