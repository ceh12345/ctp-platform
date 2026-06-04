# CTP Platform — Claude Code Notes

## Quick Start

### Build
```bash
# Engine first (always clean-build to avoid stale .js artifacts)
rm -rf packages/engine/dist && npm run build --workspace=@ctp/engine

# API
npm run build --workspace=@ctp/api
```

### Test
```bash
npx vitest run
```

### Start Dev Servers
```bash
# API (port 3000) — must build first; run from packages/api (config paths are relative to cwd)
(cd packages/api && node dist/src/main.js >> /tmp/api.log 2>&1) &

# Web UI (port 3001)
npm run dev --workspace=@ctp/web

# Interactive mode (in your own terminal, with hot reload):
npm run start:dev --workspace=@ctp/api
```

Open http://localhost:3001/?tenant=acme-outpatient in browser.

### Stop Dev Servers
- **In terminal**: Ctrl+C
- **From Claude Code bash** (taskkill needs cmd.exe wrapper on MSYS2):
  ```bash
  # Find server PIDs (exclude Claude Code host PID)
  netstat -ano | grep ":3000 " | grep LISTEN   # API PID
  netstat -ano | grep ":3001 " | grep LISTEN   # Web PID
  cmd //c "taskkill /F /PID <pid>"              # kill specific process
  ```

## Backup to USB Stick (D: drive)
Run `backup.bat` from the project root. It does two things:
1. Mirrors the project to `D:\ctp-platform` (excludes node_modules, .git, dist, *.log)
2. Writes `GIT_COMMIT.txt` to the stick with the current commit hash, branch, date, and message

## Sprint Docs — Always Track New Specs
When committing any sprint work, always stage new files in `docs/sprints/`:
```bash
git add docs/sprints/
```
New spec files are untracked by default — this ensures they're never left out of the commit.

## Sprint Code Complete — Regression Tests
After every sprint's code is complete, run the full regression test suite before committing:
1. Clean-build the engine: `rm -rf packages/engine/dist && npm run build --workspace=@ctp/engine`
2. Build the API: `npm run build --workspace=@ctp/api`
3. **Strict type-check (matches CI):** `npx tsc --noEmit -p packages/api/tsconfig.json`
4. Run all tests: `npx vitest run`
5. All tests must pass (or failures must be confirmed pre-existing) before the sprint commit

### Why step 3 matters
`nest build` (used by `npm run build --workspace=@ctp/api`) skips test files, and `vitest`'s transform is lenient at runtime — both will accept payloads missing required fields. GitHub Actions runs `npx tsc --noEmit -p packages/api/tsconfig.json` as a final strict type-check over everything including tests, and will reject what the local build chain accepted. Run step 3 locally to catch those before pushing. (See fix commit `2e1e78b` for the class of bug this catches — `IRawDataPayload` has 10 required fields, test builders supplied 3.)

# Agent Constraints for Usage Efficiency

## Context & Token Management
- **Strict Scoping**: Do not use recursive searches (e.g., `ls -R`). Only read files explicitly requested or directly related to the current task.
- **Spec Authority**: Always treat documentation in `/docs` (created in Desktop) as the Single Source of Truth. Do not "re-plan" or hallucinate requirements.
- **Compaction**: Automatically run `/compact` if the session usage exceeds 50% or after finishing a major implementation task.
- **Verification**: Use a single `cat` command to verify changes. Avoid multiple incremental reads of the same file.

## Execution Rules
- **No Vibe-Coding**: Before any edit, state the target file and the specific lines to be changed. Wait for confirmation if changing >3 files.
- **Minimal Diffs**: Prioritize the smallest possible code change to satisfy the spec. Avoid unnecessary refactors of adjacent code.
- **Tool Discipline**: Use `grep` for specific string searches instead of broad agentic search tools that consume excess context.

## gstack (recommended)

This project uses [gstack](https://github.com/garrytan/gstack) for AI-assisted workflows.
Install it for the best experience:

```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

Skills like /qa, /ship, /review, /investigate, and /browse become available after install.
Use /browse for all web browsing. Use ~/.claude/skills/gstack/... for gstack file paths.
