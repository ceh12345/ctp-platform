# UI Sprint: App Versioning

**What it does:** Displays the application version in a UI footer and a Settings/About page. Version is pulled automatically from `package.json` + git commit hash at build time.

**Size:** ~30 min CC work  
**Depends on:** Nothing

---

## Part 1: Build-Time Version Generation

### 1a. Create a version script

Create `scripts/generate-version.js` (or `.ts`) that runs at build time:

```javascript
const { execSync } = require('child_process');
const pkg = require('../package.json');
const fs = require('fs');

const gitHash = execSync('git rev-parse --short HEAD').toString().trim();
const gitBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
const buildDate = new Date().toISOString();
const version = pkg.version;

const versionInfo = {
  version,
  gitHash,
  gitBranch,
  buildDate,
  fullVersion: `${version}-${gitHash}`,
};

fs.writeFileSync(
  'src/version.json',
  JSON.stringify(versionInfo, null, 2)
);

console.log(`Version: ${versionInfo.fullVersion}`);
```

### 1b. Add to build scripts in `package.json`

```json
{
  "scripts": {
    "prebuild": "node scripts/generate-version.js",
    "build": "...",
    "prestart:dev": "node scripts/generate-version.js"
  }
}
```

This runs automatically before every build and dev start, so `version.json` is always current.

### 1c. Set initial version in `package.json`

```json
{
  "version": "1.0.0"
}
```

---

## Part 2: API Version Endpoint

### 2a. Add `GET /version` endpoint

Add to the existing controller (or a new `health.controller.ts`):

```typescript
@Get('version')
@ApiOperation({ summary: 'Get application version and build info' })
getVersion() {
  const versionInfo = require('../../../src/version.json');
  return {
    version: versionInfo.version,
    fullVersion: versionInfo.fullVersion,
    gitHash: versionInfo.gitHash,
    gitBranch: versionInfo.gitBranch,
    buildDate: versionInfo.buildDate,
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime()),
  };
}
```

### 2b. Add version to API response headers (optional but useful)

In a NestJS interceptor or middleware:

```typescript
response.setHeader('X-App-Version', versionInfo.fullVersion);
```

This way every API response carries the version — visible in browser dev tools network tab without hitting a separate endpoint.

---

## Part 3: UI Footer

### 3a. Load version on app startup

In `App.tsx`, fetch the version info during initial data load:

```typescript
const [versionInfo, setVersionInfo] = useState<any>(null);

// In loadData():
const version = await api('/version').catch(() => null);
if (version) setVersionInfo(version);
```

### 3b. Display in footer

Add a footer bar at the very bottom of the app, below all other content:

```tsx
{versionInfo && (
  <div style={{
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    height: 24,
    background: C.bg,
    borderTop: `1px solid ${C.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    fontFamily: FONT,
    fontSize: 11,
    color: C.textDim,
    zIndex: 100,
  }}>
    <span>v{versionInfo.fullVersion}</span>
    <span>{tenantId}</span>
  </div>
)}
```

Shows: `v1.0.0-abc1234` on the left, tenant name on the right. Subtle, always visible.

Add 24px bottom padding to the main content area so the footer doesn't overlap content.

---

## Part 4: Settings / About Page

### 4a. Add About section to Settings

If a Settings tab or panel already exists, add an "About" section. If not, add a small gear icon (⚙) in the top bar that opens a settings slide-over, with About as a section.

### 4b. About page content

```
┌─────────────────────────────────────────────────┐
│  About                                          │
│                                                 │
│  CTP Scheduling Engine                          │
│  Version 1.0.0-abc1234                          │
│                                                 │
│  ┌───────────────────┬────────────────────────┐ │
│  │ Version           │ 1.0.0                  │ │
│  │ Build             │ abc1234                 │ │
│  │ Branch            │ main                   │ │
│  │ Built             │ Mar 8, 2026 2:30 PM    │ │
│  │ Node              │ v20.11.0               │ │
│  │ Uptime            │ 4h 23m                 │ │
│  ├───────────────────┼────────────────────────┤ │
│  │ Tenant            │ acme-outpatient        │ │
│  │ Resources         │ 14                     │ │
│  │ Tasks             │ 39                     │ │
│  │ Orders            │ 13                     │ │
│  │ Strategy          │ Chain                  │ │
│  │ Experience Level  │ Standard               │ │
│  ├───────────────────┼────────────────────────┤ │
│  │ Last Solve        │ Mar 8, 2:28 PM         │ │
│  │ Solve Time        │ 1.2s                   │ │
│  │ Feasibility       │ 92%                    │ │
│  └───────────────────┴────────────────────────┘ │
│                                                 │
│  © 2026 CTP Platform                            │
└─────────────────────────────────────────────────┘
```

Three sections:

**Build Info** — version, git hash, branch, build date, Node version, uptime. From the `/version` endpoint.

**Tenant Info** — tenant ID, resource/task/order counts, current strategy, experience level. From existing `solveResult` state.

**Last Solve** — when, how long, feasibility rate. From existing `solveResult.stats`.

### 4c. Implementation

```tsx
const AboutPanel = ({ versionInfo, solveResult, tenantId, solverStrategy, experienceLevel, onClose }) => {
  const summary = solveResult?.summary;
  const stats = solveResult?.stats;

  const rows = [
    // Build info
    { label: 'Version', value: versionInfo?.version },
    { label: 'Build', value: versionInfo?.gitHash },
    { label: 'Branch', value: versionInfo?.gitBranch },
    { label: 'Built', value: versionInfo?.buildDate ? fmtDate(versionInfo.buildDate) : '—' },
    { label: 'Node', value: versionInfo?.nodeVersion },
    { label: 'Uptime', value: versionInfo?.uptime ? formatUptime(versionInfo.uptime) : '—' },
    { label: 'divider' },
    // Tenant info
    { label: 'Tenant', value: tenantId },
    { label: t('resource', 'Resources'), value: solveResult?.resourceUtilization?.length ?? '—' },
    { label: t('task', 'Tasks'), value: summary?.totalTasks ?? '—' },
    { label: t('order', 'Orders'), value: solveResult?.orders?.length ?? '—' },
    { label: 'Strategy', value: stats?.strategy ?? solverStrategy },
    { label: 'Experience', value: experienceLevel },
    { label: 'divider' },
    // Last solve
    { label: 'Last Solve', value: stats?.totalTimeMs ? `${(stats.totalTimeMs / 1000).toFixed(1)}s` : '—' },
    { label: 'Feasibility', value: summary?.feasibilityRate != null ? `${(summary.feasibilityRate * 100).toFixed(0)}%` : '—' },
    { label: 'Scheduled', value: summary ? `${summary.scheduledTasks} / ${summary.includedTasks}` : '—' },
  ];

  return (
    // Slide-over panel or modal with the rows rendered as a two-column table
    // Use the same styling pattern as the task detail panel
  );
};

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
```

---

## Part 5: Verification

After implementing:

- [ ] `GET /api/v1/version` returns version, gitHash, branch, buildDate
- [ ] Footer visible at bottom of app: `v1.0.0-abc1234` left, tenant name right
- [ ] Footer doesn't overlap content (bottom padding added)
- [ ] About page opens from settings/gear icon
- [ ] About page shows build info, tenant info, last solve stats
- [ ] Version updates automatically after a new commit and rebuild
- [ ] Works when `git` is not available (graceful fallback — hash shows "unknown")
- [ ] All three tenants display correct tenant name in footer and About
- [ ] API response headers include `X-App-Version` (check in browser dev tools)

---

## Versioning Convention Going Forward

- **Major** (1.x.x → 2.0.0): Breaking API changes, major architecture shifts
- **Minor** (x.1.x → x.2.0): New features, new sprint completions
- **Patch** (x.x.1 → x.x.2): Bug fixes, small adjustments
- **Hash**: Always appended automatically from git

Bump `version` in `package.json` when you want to mark a release. The git hash handles everything in between.

Commit: "feat: app versioning — footer, About page, /version endpoint, auto git hash"
