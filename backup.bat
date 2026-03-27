@echo off
echo === CTP Platform Backup to USB (D:\ctp-platform) ===
echo.

robocopy "C:\Users\ussbo\FAST\VS 2022\CTP\Typescript\ctp-platform" "D:\ctp-platform" /MIR /XD node_modules .git dist /XF *.log

echo.
echo Writing git commit marker...
git log --format="commit: %%H%%nbranch: %%D%%ndate: %%ci%%nmessage: %%s" -1 > "D:\ctp-platform\GIT_COMMIT.txt"
type "D:\ctp-platform\GIT_COMMIT.txt"

echo.
echo === Backup complete ===
