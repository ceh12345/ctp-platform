# CTP Platform — Claude Code Notes

## Backup to USB Stick (D: drive)
Run `backup.bat` from the project root. It does two things:
1. Mirrors the project to `D:\ctp-platform` (excludes node_modules, .git, dist, *.log)
2. Writes `GIT_COMMIT.txt` to the stick with the current commit hash, branch, date, and message
