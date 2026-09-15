<#
  仓库离线自检（PowerShell 侧）
  ============================================================
  补上 selfcheck.mjs 做不到的两件事：
    1. 用 PowerShell 自己的解析器做**语法检查**（比"看起来对"可靠）；
    2. 检查启动器里有没有引用已删除的变量、或还留着按名字猜的老逻辑。

  为什么这个非要有：.ps1 少个括号、引用个不存在的变量，在本机跑得起来、
  在用户机上直接黑窗一闪。语法检查是最便宜的一道闸。

  用法（在仓库根目录）：
      pwsh -File scripts/selfcheck.ps1
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts/selfcheck.ps1

  通过 = 退出码 0。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $PSScriptRoot
$assets   = Join-Path $repoRoot 'assets'

$bad = 0
function Check($ok, $label, $extra = '') {
  if (-not $ok) { $script:bad++ }
  Write-Host ("  {0}  {1}{2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $label, $(if ($extra) { "  $extra" } else { '' }))
}
function Section($t) { Write-Host ''; Write-Host "--- $t ---" }

Write-Host "仓库根目录：$repoRoot"
Write-Host "PowerShell：$($PSVersionTable.PSVersion)"

# ---------- 1) 语法检查 ----------
Section '1) 脚本语法（PowerShell 解析器）'
$psFiles = @(
  (Join-Path $assets 'start-dsh-web.ps1'),
  (Join-Path $assets '诊断.ps1'),
  (Join-Path $repoRoot 'build-portable.ps1'),
  (Join-Path $PSScriptRoot 'selfcheck.ps1'),
  (Join-Path $PSScriptRoot 'test-plugin-sync.ps1')
)
foreach ($f in $psFiles) {
  if (-not (Test-Path -LiteralPath $f)) { Check $false "$(Split-Path -Leaf $f) 存在"; continue }
  $errs = $null
  [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$errs) | Out-Null
  if ($errs -and $errs.Count -gt 0) {
    Check $false "$(Split-Path -Leaf $f) 语法" "$($errs.Count) 处错误"
    $errs | Select-Object -First 5 | ForEach-Object {
      Write-Host ("        第 {0} 行：{1}" -f $_.Extent.StartLineNumber, $_.Message) -ForegroundColor Red
    }
  } else {
    Check $true "$(Split-Path -Leaf $f) 语法"
  }
}

# ---------- 2) 启动器不得引用已删除的变量 ----------
Section '2) 启动器未引用已删除的变量'
$launcherPath = Join-Path $assets 'start-dsh-web.ps1'
if (Test-Path -LiteralPath $launcherPath) {
  $launcher = [System.IO.File]::ReadAllText($launcherPath, [System.Text.Encoding]::UTF8)
  # $profileScope 在改为"记账式认领"时删掉了：再出现就是漏改
  Check ($launcher -notmatch '\$profileScope') '没有残留 $profileScope'
  # 记账机制的两个函数必须都在
  Check ($launcher -match 'function Get-ManagedPluginRecords') '有 Get-ManagedPluginRecords'
  Check ($launcher -match 'function Save-ManagedPluginRecords') '有 Save-ManagedPluginRecords'
  Check ($launcher -match 'managed-plugins\.json') '引用了 managed-plugins.json'
  # 清理逻辑里不该再出现"按 @dsh-external 前缀一路删"的写法
  Check ($launcher -notmatch '\$entry\.Parent\.Name -eq ''@dsh-external''') '清理逻辑不再按 @dsh-external 前缀认领'
}

# ---------- 3) 构建脚本的路径必须可移植 ----------
Section '3) 构建/校验脚本可移植'
# 模式拼出来，别让本文件里的字面量把自己判成命中（自检脚本的自指问题）
$devPattern = 'D' + ':' + '\' + '001' + '\'
$builderPath = Join-Path $repoRoot 'build-portable.ps1'
if (Test-Path -LiteralPath $builderPath) {
  $builder = [System.IO.File]::ReadAllText($builderPath, [System.Text.Encoding]::UTF8)
  Check ($builder -notmatch [regex]::Escape($devPattern)) 'build-portable.ps1 无开发机盘符硬编码'
  Check ($builder -match 'scripts\\vfs-gap-check\.mjs') '调用的 vfs-gap-check 路径正确（scripts\）'
  Check (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'vfs-gap-check.mjs')) 'scripts\vfs-gap-check.mjs 存在'
}
foreach ($mjs in @('verify-pack.mjs', 'vfs-gap-check.mjs', 'selfcheck.mjs', 'update-record-hashes.mjs')) {
  $p = Join-Path $PSScriptRoot $mjs
  Check (Test-Path -LiteralPath $p) "scripts\$mjs 存在"
  if (Test-Path -LiteralPath $p) {
    $text = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
    Check ($text -notmatch [regex]::Escape($devPattern)) "scripts\$mjs 无开发机盘符硬编码"
  }
}
Check (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'test-plugin-sync.ps1')) 'scripts\test-plugin-sync.ps1 存在'

# ---------- 4) 仓库里不该有构建产物 ----------
Section '4) 仓库里不该有构建产物'
Check (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'DSH-Web'))) '仓库内没有装配产物 DSH-Web\（那是 build 的输出，不该提交）'
Check (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'DSH-Web.zip'))) '仓库内没有 DSH-Web.zip'

Write-Host ''
Write-Host $(if ($bad -eq 0) { '自检：全部通过' } else { "自检：$bad 项未通过" })
if ($bad -eq 0) { Write-Host '提示：仓库侧再跑一次  node scripts/selfcheck.mjs' }
exit $(if ($bad -eq 0) { 0 } else { 1 })
