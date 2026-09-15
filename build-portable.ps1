<#
  DSH Web 便携包 —— 一键重新打包
  ============================================================
  做什么：
    1. 构建单文件 exe（含 web 前端与全部内置插件）
    2. 用 vfs-gap-check 扫描运行时树，确认没有被落下的包
    3. 组装便携目录（程序 + 启动器 + 使用说明 + 插件）
    4. 压成可分发的 zip

  用法：在本仓库里运行
      pwsh -File build-portable.ps1 -Repo D:\path\to\deepseek-harness
      pwsh -File build-portable.ps1 -SkipBuild     # lib/ 已是最新时跳过全量构建
      pwsh -File build-portable.ps1 -ReuseExe      # 直接复用 dist-exe 里已构建好的 exe

  关于 -Repo（必须是一个 deepseek-harness 源码仓库）：
      单文件 exe 只能从官方源码仓库构建。所以重新打包 ≠ 只 clone 本仓库，
      还需要一份 deepseek-harness 源码（git clone + pnpm install）。
      优先级：命令行 -Repo > 环境变量 DSH_HARNESS_REPO > 上一级目录的 ..\deepseek-harness。
      只想改启动器/说明/插件这类随包文件？用 -ReuseExe，它会直接复用
      <Repo>\dist-exe 里已有的 exe —— 不需要重新构建。

  -ReuseExe 什么时候用（很重要）：
      SEA 打包**不是逐字节可复现的**（exe 里嵌了构建时间戳等元数据），所以
      同样源码重新跑一次打包，得到的是哈希不同的 exe。而版本记录里必须写死
      exe 的 SHA256（否则没法核对别人手上那份是哪版）—— 这两个事实放在一起
      就意味着：**只改启动器/说明/插件这类随包文件时，必须用 -ReuseExe**，
      否则每打一次包 exe 哈希都变，版本记录永远对不上。

  产物：<OutputRoot>\DSH-Web\  （目录）与 <OutputRoot>\DSH-Web.zip（分发用）
#>
[CmdletBinding()]
param(
  [string]$Repo = '',
  [string]$OutputRoot = '',
  [switch]$SkipBuild,
  [switch]$ReuseExe
)

$ErrorActionPreference = 'Stop'

# 默认路径一律由脚本自身位置推出来，不写死开发机盘符
if (-not $Repo) {
  if ($env:DSH_HARNESS_REPO) { $Repo = $env:DSH_HARNESS_REPO }
  else { $Repo = Join-Path (Split-Path -Parent $PSScriptRoot) 'deepseek-harness' }
}
if (-not $OutputRoot) { $OutputRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'portable' }
# 解析成绝对路径；这一步刻意不用 ?. / ?? —— 那是 PowerShell 7 语法，
# 而本脚本必须能在 Windows 自带的 PowerShell 5.1 下直接跑。
$resolved = Resolve-Path -LiteralPath $Repo -ErrorAction SilentlyContinue
if ($resolved) { $Repo = $resolved.Path }

$exeName    = 'deepseek-harness.exe'
$sidecarStem = 'deepseek-harness-rg'

function Step($text) { Write-Host ''; Write-Host "=== $text" -ForegroundColor Cyan }

# 原生程序（pnpm/node/tar）往 stderr 写东西是正常的（进度、warning），
# 但 PS 5.1 在"输出被重定向到下游管道"时会把 stderr 包成 ErrorRecord，
# 配合上面 $ErrorActionPreference='Stop' 就会直接把脚本掐断 —— 明明命令是成功的。
# 所以统一走这个包装：临时放开 ErrorActionPreference，按字符串透传输出，
# 只认真正的退出码。
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments, [switch]$Capture)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($Capture) { $script:NativeOutput = @(& $Exe @Arguments 2>&1 | ForEach-Object { "$_" }) }
    else { & $Exe @Arguments 2>&1 | ForEach-Object { "$_" } }
    $script:NativeExit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
}

# ---------- 1. 构建 exe ----------
Step '构建单文件 exe'
if (-not (Test-Path (Join-Path $Repo 'package.json'))) {
  throw "找不到 deepseek-harness 源码仓库: $Repo`n  · 用 -Repo <路径> 指定，或设环境变量 DSH_HARNESS_REPO；`n  · 只改随包文件时用 -ReuseExe 复用已有的 exe。"
}
if (-not (Test-Path (Join-Path $Repo 'dist-exe')) -and $ReuseExe) {
  throw "-ReuseExe 需要 $Repo\dist-exe 里已构建好的 exe，但该目录不存在。"
}
if ($ReuseExe) {
  Write-Host '  -ReuseExe：复用 dist-exe 里已有的 exe（不重新打包，保证哈希与版本记录一致）'
} else {
  Push-Location $Repo
  try {
    $env:LEFTHOOK = '0'
    $buildArgs = @('exec', 'tsx', 'scripts/build-exe-for-python-sdk.ts', '--targets=node24-win-x64')
    if ($SkipBuild) { $buildArgs += '--skip-build' }
    Invoke-Native 'pnpm' $buildArgs
    if ($script:NativeExit -ne 0) { throw "exe 构建失败（退出码 $script:NativeExit）" }
  } finally { Pop-Location }
}

$dist = Join-Path $Repo 'dist-exe'
$builtExe     = Join-Path $dist 'deepseek-harness-sdk-runtime-win-x64.exe'
$builtSidecar = Join-Path $dist 'deepseek-harness-sdk-runtime-win-x64-rg.exe'
foreach ($f in @($builtExe, $builtSidecar)) { if (-not (Test-Path $f)) { throw "构建产物缺失: $f" } }

# ---------- 2. 运行时树缺口扫描 ----------
Step '扫描运行时树的缺失包'
$stage = Join-Path $Repo 'python/sdk-runtime/src/deepseek_harness_runtime/runtime/node'
Invoke-Native 'node' @((Join-Path $PSScriptRoot 'scripts\vfs-gap-check.mjs'), $stage) -Capture
$gap = $script:NativeOutput
$gap | Select-Object -Last 3 | ForEach-Object { "  $_" }
if ("$gap" -match 'TOTAL MISSING = [1-9]') {
  throw '运行时树里仍有无法解析的包 —— 把缺失项加入 python/sdk-runtime/package.json 后重打'
}

# ---------- 3. 组装便携目录 ----------
Step '组装便携目录'
$pkg = Join-Path $OutputRoot 'DSH-Web'
$progDir = Join-Path $pkg '程序'

# 清掉旧的 DSH-Web。注意：不能直接 Remove-Item -Recurse —— PowerShell 5.1 在
# **跨卷** junction 上会顺着链接把目标删掉。开发机上很常见的做法是把
# DSH-Web\插件\<名字> 做成指向仓库的 junction 来调试，那样一打包就会把
# 仓库里的插件源码删了。所以先把链接逐个摘掉，再删整棵树。
function Remove-TreeSafely {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  foreach ($entry in (Get-ChildItem -LiteralPath $Path -Recurse -Force -Directory -ErrorAction SilentlyContinue)) {
    if ($entry.LinkType) { & cmd.exe /c rmdir "$($entry.FullName)" 2>&1 | Out-Null }
  }
  Remove-Item -LiteralPath $Path -Recurse -Force
}

Remove-TreeSafely $pkg
New-Item -ItemType Directory -Force -Path $progDir | Out-Null

Copy-Item $builtExe     (Join-Path $progDir $exeName) -Force
# 边车名必须与 exe 名一致：运行时按 <exe 基名>-rg.exe 查找它
Copy-Item $builtSidecar (Join-Path $progDir "$sidecarStem.exe") -Force

# .cmd 内容必须保持纯 ASCII：cmd.exe 按系统代码页解析批处理内容，中文会乱码
# 导致载荷路径找不到（实测 CP936/CP437 直接启动失败，只有 CP65001 能过）。
# 因此载荷脚本用 ASCII 名 start-dsh-web.ps1，只有 .cmd 的文件名是中文。
foreach ($asset in @('启动 DSH Web.cmd', 'start-dsh-web.ps1', '使用说明.txt', '诊断.ps1', '版本更新记录.txt')) {
  $source = Join-Path $PSScriptRoot "assets\$asset"
  if (Test-Path $source) { Copy-Item $source (Join-Path $pkg $asset) -Force }
  else { Write-Host "  警告：缺少 $asset" -ForegroundColor Yellow }
}

# 许可证与第三方声明必须随包分发（DSH 主程序是 MIT，再分发须附版权与许可声明）。
# 实测这些文件**没有**被嵌进 exe，所以要作为随包文件单独放进包根目录。
$noticeSource = Join-Path $PSScriptRoot 'notices'
if (Test-Path -LiteralPath $noticeSource) {
  Copy-Item $noticeSource $pkg -Recurse -Force
  Write-Host '  已随包附上许可证与第三方声明（notices\）'
} else {
  Write-Host '  警告：缺少 notices\ —— 再分发 exe 时缺少必需的许可证与第三方声明' -ForegroundColor Red
}

# 遗留副本提醒：早期的版本把随包文件直接放在仓库根下（而不是 assets\）。
# 那些**根下的同名文件不参与打包**，却和 assets\ 里的同名文件长得一模一样，
# 很容易打开旧的那份、以为记录没更新。
# 不自动删（删除要人点头），但每次打包都提醒一次，别再让它悄悄回来。
foreach ($asset in @('启动 DSH Web.cmd', 'start-dsh-web.ps1', '使用说明.txt', '诊断.ps1', '版本更新记录.txt')) {
  $legacy = Join-Path $PSScriptRoot $asset
  if (Test-Path -LiteralPath $legacy) {
    Write-Host "  注意：仓库根下的 $asset 是一份**不参与打包**的遗留副本（真相源在 assets\），建议删掉，免得看错。" -ForegroundColor Yellow
  }
}

# ---------- 3a-2. 脚本编码校验（BOM） ----------
# Windows PowerShell 5.1 读**没有 BOM** 的 .ps1 时按系统 ANSI 代码页解码（中文 Windows
# 是 936/GBK）：中文全成乱码 —— 而脚本里 Join-Path $root '插件' 这种中文是**参与逻辑**的，
# 乱码就等于"找不到插件文件夹"，插件一个都装不上，界面还可能起不来。
# 编辑器/补丁工具会静默吃掉 BOM（实测本仓库的 edit 工具每次都吃），所以每包必查。
$bomProblems = @()
foreach ($f in @('start-dsh-web.ps1', '诊断.ps1')) {
  $p = Join-Path $pkg $f
  if (-not (Test-Path -LiteralPath $p)) { continue }
  $bytes = [System.IO.File]::ReadAllBytes($p)
  if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
    $bomProblems += $f
  }
}
if ($bomProblems.Count -gt 0) {
  Write-Host ("  缺少 UTF-8 BOM：{0}" -f ($bomProblems -join '、')) -ForegroundColor Red
  throw '脚本缺少 UTF-8 BOM —— 补上 BOM 再打包（否则用户机上是乱码脚本）'
}
Write-Host '  载荷脚本的 UTF-8 BOM 检查通过' -ForegroundColor Green

# ---------- 3a-3. 源头也查一遍（改文件的人看这里，别等打包才发现） ----------
# 编辑器/patch 工具会静默吃掉 BOM，而 BOM 是"中文 Windows 上能不能跑"的开关。
# 包内那份是从 assets\ 直接拷过来的，所以源头缺 BOM 时包内必然也缺 —— 提前拦。
$srcBomProblems = @()
foreach ($f in @('start-dsh-web.ps1', '诊断.ps1')) {
  $p = Join-Path $PSScriptRoot "assets\$f"
  if (-not (Test-Path -LiteralPath $p)) { continue }
  $bytes = [System.IO.File]::ReadAllBytes($p)
  if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
    $srcBomProblems += $f
  }
}
if ($srcBomProblems.Count -gt 0) {
  Write-Host ("  assets\ 里缺少 UTF-8 BOM：{0}" -f ($srcBomProblems -join '、')) -ForegroundColor Red
  throw 'assets\ 下的 .ps1 缺少 UTF-8 BOM —— 补上再打包'
}

# ---------- 3b. 插件目录 ----------
Step '同步插件目录'

# 就地展开一棵目录树：遇到链接就换成它的真实内容，其余原样复制。
# 刻意不用 Copy-Item -Recurse —— PS 5.1 会跟着链接递归，遇到环就无限展开。
function Copy-Tree {
  param([string]$Source, [string]$Destination, [string[]]$Chain)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  foreach ($entry in (Get-ChildItem -LiteralPath $Source -Force)) {
    if ($entry.Name -eq '.git') { continue }
    $to = Join-Path $Destination $entry.Name
    if ($entry.PSIsContainer) {
      # 链接解引用：开发机上插件常是 junction（省得维护两份），
      # 但链接本身不能进包 —— 用户机上没有那个目标，插件会变成死链接。
      $real = $entry.FullName
      if ($entry.LinkType) {
        $target = @($entry.Target)[0]
        if (-not [System.IO.Path]::IsPathRooted($target)) { $target = Join-Path $entry.Parent.FullName $target }
        $real = (Get-Item -LiteralPath $target -Force).FullName
      }
      if ($Chain -contains $real) { throw "插件目录存在链接环：$real" }
      Copy-Tree $real $to ($Chain + $real)
    } else {
      Copy-Item -LiteralPath $entry.FullName -Destination $to -Force
    }
  }
}

$pluginSourceRoot = Join-Path $PSScriptRoot 'assets\插件'
if (-not (Test-Path -LiteralPath $pluginSourceRoot)) { $pluginSourceRoot = Join-Path $PSScriptRoot '插件' }
$pluginTargetRoot = Join-Path $pkg '插件'
$pluginProblems = @()
$pluginCount = 0

if (-not (Test-Path -LiteralPath $pluginSourceRoot)) {
  Write-Host '  警告：没有 插件\ 目录，包内将不含任何插件' -ForegroundColor Yellow
} else {
  Copy-Tree (Get-Item -LiteralPath $pluginSourceRoot -Force).FullName $pluginTargetRoot @()

  # 打包前校验：在打包机上发现，比在用户机上启动失败便宜得多
  foreach ($scopeDir in (Get-ChildItem -LiteralPath $pluginTargetRoot -Directory -Force)) {
    $candidates = @()
    if ($scopeDir.Name -like '@*') { $candidates = @(Get-ChildItem -LiteralPath $scopeDir.FullName -Directory -Force -ErrorAction SilentlyContinue) }
    else { $candidates = @($scopeDir) }
    foreach ($candidate in $candidates) {
      $manifestPath = Join-Path $candidate.FullName 'package.json'
      if (-not (Test-Path -LiteralPath $manifestPath)) { $pluginProblems += "$($candidate.Name)：没有 package.json"; continue }
      try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json }
      catch { $pluginProblems += "$($candidate.Name)：package.json 解析失败"; continue }
      $label = if ($manifest.name) { [string]$manifest.name } else { $candidate.Name }

      # 0) 包名不能长到让安装路径冲破 MAX_PATH：启动器按**包名**决定落点
      #    （@scope/name → node_modules\@scope\name，name → node_modules\name），
      #    短名过长时挂载"看起来成功"，但加载器读不到 → 整个界面起不来。
      #    实测 254 字符的包名就是这个下场，所以打包时直接拦掉。
      $shortName = $label.Split('/')[-1]
      if ($shortName.Length -gt 64) {
        $pluginProblems += "$label：包名短名 $($shortName.Length) 字符，过长（上限 64）—— 会让安装路径超长导致启动失败"
      }

      # 1) 必须声明 dsh.bundle.patch，否则 loader 根本不装配它
      if (-not $manifest.dsh -or -not $manifest.dsh.bundle -or -not $manifest.dsh.bundle.patch) {
        $pluginProblems += "$label：未声明 dsh.bundle.patch（不会被装配）"
        continue
      }
      $patchRel = ([string]$manifest.dsh.bundle.patch) -replace '^\./', ''
      if (-not (Test-Path -LiteralPath (Join-Path $candidate.FullName $patchRel))) {
        $pluginProblems += "$label：dsh.bundle.patch 指向的文件不存在（$patchRel）"
      }

      # 2) 不能有未打包的运行时依赖：便携包不做安装，缺依赖=运行时才炸
      $deps = @()
      if ($manifest.dependencies) { $deps = @($manifest.dependencies.PSObject.Properties.Name) }
      if ($deps.Count -gt 0) { $pluginProblems += "$label：声明了依赖（$($deps -join ', ')），便携包不安装依赖" }

      # 3) 声明了 dsh.client 就必须有浏览器半边，否则界面加载时 404
      if ($manifest.dsh.client) {
        $clientRel = 'lib/client.js'
        if ($manifest.exports -and $manifest.exports.'./client') {
          $c = $manifest.exports.'./client'
          if ($c -is [string]) { $clientRel = [string]$c }
          elseif ($c.import) { $clientRel = [string]$c.import }
        }
        $clientRel = $clientRel -replace '^\./', ''
        if (-not (Test-Path -LiteralPath (Join-Path $candidate.FullName $clientRel))) {
          $pluginProblems += "$label：声明了 dsh.client 但找不到 $clientRel"
        }
      }
      $pluginCount += 1
      Write-Host "  + $label"
    }
  }
}

if ($pluginProblems.Count -gt 0) {
  $pluginProblems | ForEach-Object { Write-Host "  插件问题：$_" -ForegroundColor Red }
  throw '插件目录未通过打包前校验（见上）—— 修好再打包，否则用户机上会启动失败'
}
Write-Host ("  插件 {0} 个，全部通过打包前校验" -f $pluginCount) -ForegroundColor Green

# ---------- 3c. 包内必须带许可证与第三方声明 ----------
# exe 是 MIT 许可的 DSH 主程序的再分发副本，不带这两份文件就是不合规的分发。
Step '校验随包许可文件'
$requiredNotices = @('notices\LICENSE-deepseek-harness.txt', 'notices\THIRD_PARTY_NOTICES.md')
$missingNotices = @()
foreach ($rel in $requiredNotices) {
  if (-not (Test-Path -LiteralPath (Join-Path $pkg $rel))) { $missingNotices += $rel }
}
if ($missingNotices.Count -gt 0) {
  Write-Host ("  包内缺少：{0}" -f ($missingNotices -join '、')) -ForegroundColor Red
  throw '包内缺少许可证/第三方声明 —— 不允许分发这样的包'
}
Write-Host '  许可证与第三方声明已随包' -ForegroundColor Green

Get-ChildItem $pkg -Recurse -File | ForEach-Object {
  '  {0,8:N2} MB  {1}' -f ($_.Length / 1MB), $_.FullName.Replace($pkg, '')
}

# ---------- 4. 打包 ----------
Step '压缩'
$zip = Join-Path $OutputRoot 'DSH-Web.zip'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
# tar -a 按扩展名自动挑压缩器，.zip 走 zip
Invoke-Native 'tar' @('-a', '-c', '-f', $zip, '-C', $OutputRoot, 'DSH-Web')
if ($script:NativeExit -ne 0) { throw '压缩失败' }
$z = Get-Item $zip
Write-Host ("  {0}  ({1:N1} MB)" -f $z.FullName, ($z.Length / 1MB)) -ForegroundColor Green

# 顺手写出分发包的 SHA256（release note 直接抄这个，别再手工算）
$zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
$exeHash = (Get-FileHash -LiteralPath (Join-Path $pkg "程序\$exeName") -Algorithm SHA256).Hash
Write-Host ''
Write-Host '  分发包校验值：'
Write-Host ("    DSH-Web.zip            SHA256  {0}" -f $zipHash)
Write-Host ("    程序\$exeName  SHA256  {0}" -f $exeHash)
Write-Host ''
Write-Host '完成。把上面那个 zip 发给别人，解压后双击「启动 DSH Web.cmd」即可。' -ForegroundColor Green
