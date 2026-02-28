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
