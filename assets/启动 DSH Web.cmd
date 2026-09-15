@echo off
rem DSH Web launcher - just double-click this file.
rem
rem Keep this file ASCII-only. cmd.exe reads batch-file *contents* using the
rem system code page (936/437/...), so a non-ASCII literal here would be
rem mis-decoded and the payload path would not resolve. Non-ASCII is fine in
rem the file NAME (Explorer passes names as Unicode) and inside the .ps1
rem payload (which must stay UTF-8 *WITH* BOM).
rem
rem Why the BOM self-heal below: Windows PowerShell 5.1 decodes a BOM-less
rem script as the ANSI code page (936 here), which mangles every Chinese
rem string and makes the parser fail with bogus "Unexpected token" errors.
rem Editors and patch tools silently drop the BOM, so verify it on every
rem launch and rewrite the file once when it is missing. Every .ps1 line is
rem pure ASCII, so the UTF-8 round trip is byte-exact for the code.
setlocal
set "PS=pwsh"
where pwsh >nul 2>nul || set "PS=powershell"
set "PAYLOAD=%~dp0start-dsh-web.ps1"
if exist "%PAYLOAD%" (
  %PS% -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:PAYLOAD; $b=[IO.File]::ReadAllBytes($p); if ($b.Length -lt 3 -or $b[0] -ne 0xEF -or $b[1] -ne 0xBB -or $b[2] -ne 0xBF) { $t=[Text.Encoding]::UTF8.GetString($b); [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding($true))) }"
)
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%PAYLOAD%" %*
