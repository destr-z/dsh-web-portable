#Requires -Version 5.1
<#
  BOM / 换行 一键修复
  ============================================================
  为什么需要它：Windows PowerShell 5.1 读**没有 BOM** 的 .ps1 时按系统 ANSI 代码页
  解码（中文 Windows 是 936/GBK）—— 中文全成乱码、解析直接失败。而脚本里
  Join-Path $root '插件' 这种中文是**参与逻辑**的，乱码就等于"找不到插件文件夹"。

  更麻烦的是：编辑器与 patch 工具会**静默**吃掉 BOM（本仓库的 edit 工具每次都吃），
  于是"改一行注释"就能让启动器在中文 Windows 上彻底跑不起来。所以每次动过 .ps1，
  跑一下这个脚本，再提交。

  顺带把 启动 DSH Web.cmd 钉成 CRLF：cmd.exe 按行读批处理，CRLF 最稳；
  它的**内容**必须保持纯 ASCII（这是 cmd.exe 的代码页限制，不是排版偏好）。

  用法（在仓库根目录）：
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fix-bom.ps1
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fix-bom.ps1 -Check
#>
[CmdletBinding()]
param(
  # 只报告、不修改（适合放进 CI）
  [switch]$Check
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$assets   = Join-Path $repoRoot 'assets'
$utf8Bom  = New-Object System.Text.UTF8Encoding($true)
$utf8None = New-Object System.Text.UTF8Encoding($false)

# 需要 BOM 的 .ps1（会被用户机上的 PowerShell 5.1 直接读取的那些）
$bomTargets = @(
  (Join-Path $assets 'start-dsh-web.ps1'),
  (Join-Path $assets '诊断.ps1'),
  (Join-Path $repoRoot 'build-portable.ps1'),
  (Join-Path $PSScriptRoot 'selfcheck.ps1'),
  (Join-Path $PSScriptRoot 'test-plugin-sync.ps1'),
  (Join-Path $PSScriptRoot 'fix-bom.ps1')
)

function Test-Bom([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }   # 不存在
  $b = [System.IO.File]::ReadAllBytes($Path)
  return ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
}

$fixed = 0
$bad = 0

Write-Host "仓库：$repoRoot"
Write-Host ''
Write-Host '--- .ps1 的 UTF-8 BOM ---'
foreach ($f in $bomTargets) {
  $name = $f.Substring($repoRoot.Length + 1)
  $has = Test-Bom $f
  if ($null -eq $has) { Write-Host "  [跳过] $name（不存在）" -ForegroundColor DarkGray; continue }
  if ($has) { Write-Host "  [OK]   $name" -ForegroundColor Green; continue }
  if ($Check) { Write-Host "  [缺BOM] $name" -ForegroundColor Red; $bad++; continue }
  $text = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
  [System.IO.File]::WriteAllText($f, $text, $utf8Bom)
  Write-Host "  [已修] $name（补上 UTF-8 BOM）" -ForegroundColor Yellow
  $fixed++
}

Write-Host ''
Write-Host '--- 启动 DSH Web.cmd（CRLF + 纯 ASCII）---'
$cmdPath = Join-Path $assets '启动 DSH Web.cmd'
if (-not (Test-Path -LiteralPath $cmdPath)) {
  Write-Host '  [跳过] 不存在' -ForegroundColor DarkGray
} else {
  $bytes = [System.IO.File]::ReadAllBytes($cmdPath)
  $nonAscii = @($bytes | Where-Object { $_ -gt 0x7f }).Count
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  $hasCrlf = $text -match "`r`n"

  if ($nonAscii -gt 0) {
    # 非 ASCII 不能自动"修" —— 那是内容问题，只能由人改写英文
    Write-Host "  [必须手改] 含 $nonAscii 个非 ASCII 字节：cmd.exe 按代码页读批处理内容，中文会乱码" -ForegroundColor Red
    $bad++
  } else {
    Write-Host '  [OK]   内容为纯 ASCII' -ForegroundColor Green
  }

  if ($hasCrlf) {
    Write-Host '  [OK]   换行为 CRLF' -ForegroundColor Green
  } elseif ($Check) {
    Write-Host '  [需修] 换行不是 CRLF' -ForegroundColor Red
    $bad++
  } else {
    $fixedText = $text -replace "`r`n", "`n" -replace "`n", "`r`n"
    [System.IO.File]::WriteAllText($cmdPath, $fixedText, $utf8None)
    Write-Host '  [已修] 换行改为 CRLF' -ForegroundColor Yellow
    $fixed++
  }
}

Write-Host ''
if ($Check) {
  Write-Host $(if ($bad -eq 0) { '检查：全部正常' } else { "检查：$bad 项需要修（去掉 -Check 即可自动修）" })
  exit $(if ($bad -eq 0) { 0 } else { 1 })
}
Write-Host $(if ($fixed -eq 0) { '无需修改，全部正常。' } else { "已修 $fixed 处。记得重新打包并提交。" })
exit 0
