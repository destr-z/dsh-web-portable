<#
  启动器「插件同步」离线测试
  ============================================================
  为什么需要它：启动器的插件同步是"装进 profile / 摘掉已经不在包里的"这类
  会**删东西**的逻辑。改坏了的后果不是报错，而是删掉不该删的、或者把整个界面
  弄得起不来 —— 而这两件事在开发机上都不容易复现（数据目录里没有用户自己装的包）。

  这个测试用一个临时数据目录 + 假的 exe，把启动器当黑盒跑一遍，验证：
    1. 首次启动：4 个插件都挂上、都登记进 bundles、记账文件写出 4 个名字
    2. 从 插件\ 删掉一个：它的 junction 和 bundles 条目都被摘掉
    3. 用户自己装的（清单里有、node_modules 里是**真目录**）：一个字节都不许动
    4. 把 插件\ 全删掉：随包条目全清干净，用户那条依然在
    5. 手工删掉记账文件后重启：靠 junction 形态仍能认领（记账丢了也不能变砖）

  用法（在仓库根目录）：
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-plugin-sync.ps1
      pwsh -File scripts/test-plugin-sync.ps1

  全部通过 = 退出码 0。测试只碰 %TEMP% 下的临时目录，不动真实数据目录。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$assets   = Join-Path $repoRoot 'assets'
$srcLauncher = Join-Path $assets 'start-dsh-web.ps1'
$srcPlugins  = Join-Path $assets '插件'

if (-not (Test-Path -LiteralPath $srcLauncher)) { throw "找不到启动器：$srcLauncher" }
if (-not (Test-Path -LiteralPath $srcPlugins)) { throw "找不到插件源：$srcPlugins" }

$bad = 0
function Check($ok, $label, $extra = '') {
  if (-not $ok) { $script:bad++ }
  Write-Host ("  {0}  {1}{2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $label, $(if ($extra) { "  $extra" } else { '' }))
}
function Section($t) { Write-Host ''; Write-Host "--- $t ---" }

# ---------- 搭测试沙箱 ----------
$sandbox = Join-Path $env:TEMP ("dsh-web-portable-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$pkg     = Join-Path $sandbox 'DSH-Web'
$data    = Join-Path $sandbox 'data'
$profileDir = Join-Path $data 'profiles\web'
$nodeModules = Join-Path $profileDir 'node_modules'

try {
  Write-Host "沙箱：$sandbox"
  New-Item -ItemType Directory -Force -Path (Join-Path $pkg '程序'), $profileDir, $nodeModules | Out-Null
  # 让启动器把数据目录放在沙箱里（这正是 DSH_WEB_HOME 这个逃生口存在的理由）
  $env:DSH_WEB_HOME = $data
  $env:LOCALAPPDATA = Join-Path $sandbox 'fake-localappdata'   # 双保险：万一覆盖没生效也别碰真实目录

  # 启动器用 $PSScriptRoot 定位「程序\」「插件\」，所以必须**从沙箱里运行它**。
  # 直接跑仓库里那份的话，它会去找 assets\程序\deepseek-harness.exe（不存在），
  # 在插件同步之前就退出 —— 测试会变成假通过。
  $launcher = Join-Path $pkg 'start-dsh-web.ps1'
  Copy-Item -LiteralPath $srcLauncher -Destination $launcher -Force
  Copy-Item -LiteralPath (Join-Path $assets '启动 DSH Web.cmd') -Destination (Join-Path $pkg '启动 DSH Web.cmd') -Force

  # 假 exe：启动器会真的 Start-Process 它（然后拿不到界面地址、干净退出），
  # 这样插件同步那一段会真实执行，而我们不需要真的起服务。
  $fakeExe = Join-Path $pkg '程序\deepseek-harness.exe'
  Set-Content -LiteralPath $fakeExe -Value '@echo off' -Encoding ASCII
  # 端口检查会在 exe 存在性检查之前，先确认 3099 空着；占用就直接跳过测试
  $busy = [bool](netstat -ano | Select-String -Pattern '^\s*TCP\s+\S+:3099\s+\S+\s+LISTENING')
  if ($busy) {
    Write-Host '  警告：端口 3099 正被占用，启动器会在插件同步之前就退出 —— 本次跳过。' -ForegroundColor Yellow
    exit 0
  }

  # 把插件源拷进沙箱的 插件\（不直接用仓库 assets，因为测试要删插件）
  Copy-Item -LiteralPath $srcPlugins -Destination (Join-Path $pkg '插件') -Recurse -Force

  # 用户自己"装"的包：清单里有 + node_modules 里是真目录（不是 junction）。
  # 名字刻意也用 @dsh-external 作用域 —— 旧逻辑正是被这个名字骗到才去删它。
  $userPkgName = '@dsh-external/user-own-plugin'
  $userPkgDir  = Join-Path $nodeModules '@dsh-external\user-own-plugin'
  New-Item -ItemType Directory -Force -Path $userPkgDir | Out-Null
  Set-Content -LiteralPath (Join-Path $userPkgDir 'package.json') -Value '{"name":"@dsh-external/user-own-plugin","version":"9.9.9"}' -Encoding UTF8

  $manifestPath = Join-Path $profileDir 'package.json'
  function Write-Manifest($names) {
    $body = ($names | ForEach-Object { '      "' + $_ + '"' }) -join ",`r`n"
    $json = "{`r`n  `"name`": `"dsh-profile-web`",`r`n  `"version`": `"0.0.0`",`r`n  `"dsh`": {`r`n    `"profile`": {`r`n      `"bundles`": [`r`n$body`r`n      ],`r`n      `"patchReload`": `"live`"`r`n    }`r`n  }`r`n}`r`n"
    [System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  }
  function Read-Manifest { [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) }
  function Get-Bundles {
    $raw = Read-Manifest
    $m = [regex]::Match($raw, '"bundles"\s*:\s*\[(?<body>[^\]]*)\]')
    if (-not $m.Success) { return @() }
    return @([regex]::Matches($m.Groups['body'].Value, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
  }
  function Get-Records {
    $p = Join-Path $data 'managed-plugins.json'
    if (-not (Test-Path -LiteralPath $p)) { return @() }
    try { $j = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json } catch { return @() }
    if (-not $j.plugins) { return @() }
    return @($j.plugins)
  }
  $script:lastOutput = ''
  function Invoke-Launcher {
    # 启动器最后会 Read-Host 等回车；喂一个空行让它走完
    $script:lastOutput = ('' | & powershell -NoProfile -ExecutionPolicy Bypass -File $launcher 2>&1 | Out-String)
    return $LASTEXITCODE
  }
  function Show-LauncherOutput($title) {
    Write-Host "  ── 启动器输出（$title）──" -ForegroundColor DarkGray
    foreach ($line in ($script:lastOutput -split "`r?`n")) {
      if ($line.Trim() -ne '') { Write-Host "     $line" -ForegroundColor DarkGray }
    }
  }

  # ---------- 场景 1：首次启动 ----------
  Section '1) 首次启动：装齐 4 个插件'
  Write-Manifest @($userPkgName)
  $null = Invoke-Launcher
  $bundles = Get-Bundles
  $records = Get-Records
  foreach ($n in @('@dsh-external/dsh-novel-script', '@dsh-external/dsh-persona-switcher', '@dsh-external/dsh-prompt-compare', 'dsh-whale-widget')) {
    Check ($bundles -contains $n) "bundles 里有 $n"
    Check ($records -contains $n) "记账文件里有 $n"
  }
  Check ((Test-Path -LiteralPath (Join-Path $nodeModules 'dsh-whale-widget\package.json'))) 'dsh-whale-widget 已挂到 node_modules 顶层'
  Check ((Test-Path -LiteralPath (Join-Path $nodeModules '@dsh-external\dsh-novel-script\package.json'))) 'dsh-novel-script 已挂到 @dsh-external\'
  Check ($records.Count -eq 4) "记账文件正好 4 条（实际 $($records.Count)）"
  Check ($bundles -contains $userPkgName) '用户自己的包仍留在 bundles 里'
  Check ((Test-Path -LiteralPath (Join-Path $userPkgDir 'package.json'))) '用户自己的包目录还在'

  # ---------- 场景 2：从 插件\ 删掉一个 ----------
  Section '2) 从 插件\ 删掉 prompt-compare：它该被清干净'
  Remove-Item -LiteralPath (Join-Path $pkg '插件\@dsh-external\dsh-prompt-compare') -Recurse -Force
  $null = Invoke-Launcher
  $bundles = Get-Bundles
  $records = Get-Records
  Check ($bundles -notcontains '@dsh-external/dsh-prompt-compare') 'bundles 里的条目被摘掉'
  Check ($records -notcontains '@dsh-external/dsh-prompt-compare') '记账文件里的名字被摘掉'
  Check (-not (Test-Path -LiteralPath (Join-Path $nodeModules '@dsh-external\dsh-prompt-compare'))) 'node_modules 里的条目被摘掉'
  Check ((Test-Path -LiteralPath (Join-Path $pkg '插件\@dsh-external\dsh-novel-script\package.json'))) '没被删的插件源目录完好（junction 没有反噬源）'
  Check ((Test-Path -LiteralPath (Join-Path $nodeModules '@dsh-external\dsh-novel-script\package.json'))) '其余插件仍在'

  # ---------- 场景 3：用户自己的包必须一个字节都不动 ----------
  Section '3) 用户自己装的包：不许被碰'
  Check ($bundles -contains $userPkgName) 'bundles 里仍在'
  Check ((Test-Path -LiteralPath (Join-Path $userPkgDir 'package.json'))) 'node_modules 里的真目录仍在'
  $rec3 = Get-Records
  Check (-not ($rec3 -contains $userPkgName)) '记账文件里没有它（不认领别人的包）'

  # ---------- 场景 4：清空 插件\ ----------
  Section '4) 清空 插件\：随包条目全清，用户那条留着'
  Get-ChildItem -LiteralPath (Join-Path $pkg '插件') -Force | Remove-Item -Recurse -Force
  $null = Invoke-Launcher
  $bundles = Get-Bundles
  $records = Get-Records
  foreach ($n in @('@dsh-external/dsh-novel-script', '@dsh-external/dsh-persona-switcher', 'dsh-whale-widget')) {
    Check ($bundles -notcontains $n) "bundles 里没有 $n"
  }
  Check ($records.Count -eq 0) "记账文件清空（实际 $($records.Count) 条）"
  Check ($bundles -contains $userPkgName) '用户自己的包仍在 bundles 里'
  Check ((Test-Path -LiteralPath (Join-Path $userPkgDir 'package.json'))) '用户自己的包目录仍在'
  Check (-not (Test-Path -LiteralPath (Join-Path $nodeModules '@dsh-external\dsh-novel-script'))) '随包插件的 node_modules 条目已清'

  # ---------- 场景 5：记账文件丢了也不能变砖 ----------
  Section '5) 记账文件被删后重启：靠 junction 形态仍能认领'
  Copy-Item -LiteralPath $srcPlugins -Destination (Join-Path $pkg '插件') -Recurse -Force
  $null = Invoke-Launcher   # 先装回来
  Write-Manifest (@(Get-Bundles))
  Get-ChildItem -LiteralPath (Join-Path $pkg '插件') -Force | Remove-Item -Recurse -Force   # 再从包里删掉
  Remove-Item -LiteralPath (Join-Path $data 'managed-plugins.json') -Force -ErrorAction SilentlyContinue
  Check (-not (Test-Path -LiteralPath (Join-Path $data 'managed-plugins.json'))) '记账文件已删除（模拟用户手工清理）'
  $null = Invoke-Launcher
  $bundles = Get-Bundles
  Check ($bundles -notcontains '@dsh-external/dsh-novel-script') '靠 junction 形态仍认领并摘掉了条目'
  Check (-not (Test-Path -LiteralPath (Join-Path $nodeModules '@dsh-external\dsh-novel-script'))) 'node_modules 条目也摘掉了'
  Check ($bundles -contains $userPkgName) '用户自己的包依然没被碰'
  Check ((Test-Path -LiteralPath (Join-Path $data 'managed-plugins.json'))) '记账文件已重建'

  Write-Host ''
  if ($bad -ne 0) { Show-LauncherOutput '最后一次启动器运行' }
  Write-Host $(if ($bad -eq 0) { '测试：全部通过' } else { "测试：$bad 项未通过" })
  exit $(if ($bad -eq 0) { 0 } else { 1 })
} finally {
  # 沙箱里有 junction，必须先摘链接再删树（PS 5.1 会顺着链接删目标）
  if (Test-Path -LiteralPath $sandbox) {
    foreach ($entry in (Get-ChildItem -LiteralPath $sandbox -Recurse -Force -Directory -ErrorAction SilentlyContinue)) {
      if ($entry.LinkType) { & cmd.exe /c rmdir "$($entry.FullName)" 2>&1 | Out-Null }
    }
    Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "`n已清理沙箱：$sandbox"
  }
}
