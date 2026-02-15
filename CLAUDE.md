# CTP Platform — Claude Code Notes

## Backup to USB Stick (D: drive)
```
robocopy "C:\Users\ussbo\FAST\VS 2022\CTP\Typescript\ctp-platform" D:\ctp-platform /MIR /XD node_modules .git dist /XF *.log
```
Or just run `backup.bat` from the project root.
