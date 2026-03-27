# CTP Platform — Claude Code Notes

## Backup to USB Stick (D: drive)
Run `backup.bat` from the project root. It does two things:
1. Mirrors the project to `D:\ctp-platform` (excludes node_modules, .git, dist, *.log)
2. Writes `GIT_COMMIT.txt` to the stick with the current commit hash, branch, date, and message

## Sprint Code Complete — Regression Tests
After every sprint's code is complete, run the full regression test suite before committing:
1. Clean-build the engine: `rm -rf packages/engine/dist && npm run build --workspace=@ctp/engine`
2. Build the API: `npm run build --workspace=@ctp/api`
3. Run all tests: `npx vitest run`
4. All tests must pass (or failures must be confirmed pre-existing) before the sprint commit

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
