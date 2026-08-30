# CTP Platform — Windows Server Installation Guide

---

# Client Deployment — Docker (QA)

This section covers deploying the CTP Platform to a client's Windows Server via Docker for QA review. The client machine only needs Docker Desktop installed — no Node.js, no Git, no build steps.

The UI and the API run as **one service on one port (3000)**. The API serves the built web UI as static assets, so there is no separate web container.

---

## Prerequisites

| Software | Download |
|---|---|
| **Docker Desktop for Windows** | https://www.docker.com/products/docker-desktop/ |

Install Docker Desktop and ensure it is running (whale icon in system tray).

---

## 1. VPN Into the Client Server

Connect via your VPN client before proceeding. All commands below run on the client machine over the VPN session (e.g., RDP terminal or PowerShell remoting).

---

## 2. Load the CTP Image

**Option A — Pull from a private registry (when available):**
```bash
docker pull <registry>/ctp-platform:latest
```

**Option B — Load from a saved image file (offline/air-gapped):**
```bash
# Transfer ctp-platform.tar to the server first, then:
docker load -i ctp-platform.tar
```

---

## 3. Tenant Data

The image itself ships **no tenant data** — it is tenant-agnostic, and data is
mounted into the container at `/data/config` from the host.

Client sites have no ingest pipeline yet, so **the tenant data travels with the
release**: the bundle produced by `build-image.yml` already contains it, and
unzipping gives the layout below. Nothing to assemble by hand.

```
C:\ctp\
├── ctp-platform.tar        the image
├── docker-compose.yml
├── README.md
└── config\
    └── tenants\
        └── <tenant-id>\    data, shipped in the bundle
```

Because the data sits on the host rather than inside the image, it survives
upgrades, and it can later be replaced by a pipeline without rebuilding or
reshipping the image.

> **The mount must be writable.** Snapshot promotion writes into
> `config/tenants/<tenant-id>/data/current` at runtime. A read-only mount will
> start cleanly and then fail on the first solve.

---

## 4. Start the Application

```bash
docker compose up -d
```

One container, `ctp-platform`, listening on port 3000. Check it reached a healthy state:

```bash
docker compose ps
```

---

## 5. Verify

Open a browser on the client machine:
```
http://localhost:3000/?tenant=<tenant-id>
```

API health check — note the tenant header is **required**; without it the
endpoint returns 404:

```powershell
curl.exe -H "X-Tenant-Id: <tenant-id>" http://localhost:3000/v1/health
curl.exe -H "X-Tenant-Id: <tenant-id>" http://localhost:3000/v1/state/summary
```

Swagger docs: `http://localhost:3000/docs`

---

## 6. Updating Tenant Data

To update tenant data (tasks, resources, orders, etc.), edit the JSON files under
the mounted `config\tenants\` directory on the host, then reload:

```bash
docker compose restart
```

---

## 7. Updating the Application

```bash
docker compose down
docker pull <registry>/ctp-platform:latest   # or docker load for offline
docker compose up -d
```

Tenant data and logs survive the upgrade — they live in the host mount and a
named volume, not in the image.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Tenant '<id>' not found` | `config\tenants\<id>\` missing from the host mount, or the id is misspelled |
| Container healthy, UI blank | Wrong port — the UI is on **3000**, not 3001 |
| Solve fails after clean start | Config mount is read-only; snapshot promotion needs write access |
| AI chat unavailable | `CTP_ANTHROPIC_API_KEY` not set — optional, nothing else is affected |

---

## Building & Shipping the Image (maintainer)

The build context excludes `.git` and `config/`, so no tenant data ever lands in
the image and the version stamp must be passed in explicitly:

```bash
docker build   --build-arg GIT_HASH=$(git rev-parse --short HEAD)   --build-arg GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)   -t ctp-platform:latest .
```

Confirm the stamp took (should not say `unknown`):

```bash
docker run --rm ctp-platform:latest node -e "console.log(require('./dist/src/version.json'))"
```

Save it for offline transfer:

```bash
docker save -o ctp-platform.tar ctp-platform:latest
```

---


# Dev Setup — Local / Windows Server

## Prerequisites — Downloads

| Software | Version | Download |
|---|---|---|
| **Node.js** | v22.x LTS | https://nodejs.org/en/download (Windows Installer .msi) |
| **Git** | Latest | https://git-scm.com/download/win |

No other runtime dependencies. No database. No Docker required.

---

## 1. Install Node.js

Run the `.msi` installer. Accept defaults. This installs both `node` and `npm`.

Verify:
```bash
node --version   # should be v22.x
npm --version    # should be 10.x or 11.x
```

---

## 2. Install Git

Run the Git for Windows installer. Accept defaults.

Verify:
```bash
git --version
```

---

## 3. Clone the Repository

```bash
git clone https://github.com/ceh12345/ctp-platform.git
cd ctp-platform
```

If the repo is private, Git will prompt for GitHub credentials. Use a Personal Access Token if password auth is disabled.

---

## 4. Install Dependencies

From the project root (installs all three packages in one step):

```bash
npm install
```

---

## 5. Build

Engine must be built before API:

```bash
# Engine (always clean-build to avoid stale artifacts)
rmdir /s /q packages\engine\dist
npm run build --workspace=@ctp/engine

# API
npm run build --workspace=@ctp/api
```

The web UI does not need a build step for dev — Vite compiles on the fly.

---

## 6. Start the Servers

**API** (port 3000) — open a terminal:
```bash
cd packages\api
node dist\src\main.js
```

**Web UI** (port 3001) — open a second terminal:
```bash
cd ctp-platform
npm run dev --workspace=@ctp/web
```

---

## 7. Verify

Open a browser:
```
http://localhost:3001/?tenant=acme-outpatient
```

API health check:
```
http://localhost:3000/v1/ctp/state
```

---

## Running as a Background Service (Production)

Use [NSSM](https://nssm.cc/download) (Non-Sucking Service Manager) to wrap the API as a Windows Service:

```bash
nssm install ctp-api "C:\Program Files\nodejs\node.exe" "C:\path\to\ctp-platform\packages\api\dist\src\main.js"
nssm set ctp-api AppDirectory "C:\path\to\ctp-platform\packages\api"
nssm start ctp-api
```

For the web UI in production, build a static bundle and serve with IIS or nginx:
```bash
npm run build --workspace=@ctp/web
# Static output: packages/web/dist
```

---

## Tenant Configuration

Tenant data lives in `config/tenants/<tenant-id>/data/`. Each tenant has:

| File | Purpose |
|---|---|
| `tenant.json` | Tenant name, timezone, terminology |
| `horizon.json` | Scheduling window (start date, max days) |
| `tasks.json` | Task definitions |
| `resources.json` | Resource definitions |
| `orders.json` | Work orders |
| `calendars.json` | Shift calendars |
| `products.json` | Product catalog |
| `materials.json` | Material inventory |
| `state-changes.json` | Resource state change rules |
| `uom-conversions.json` | Unit of measure overrides (optional) |

To add a new tenant, copy an existing tenant folder and update the data files. Load it via:
```
http://localhost:3001/?tenant=<tenant-id>
```

---

## Updating (Pulling New Code)

```bash
git pull
npm install
rmdir /s /q packages\engine\dist
npm run build --workspace=@ctp/engine
npm run build --workspace=@ctp/api
# restart the API process
```

---

## Ports

| Service | Port | URL |
|---|---|---|
| API | 3000 | http://localhost:3000 |
| Web UI | 3001 | http://localhost:3001 |
