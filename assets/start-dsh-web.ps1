<#
  DSH Web —— 双击「启动 DSH Web.cmd」即可
  ------------------------------------------------------------
  说明：
   · 程序在 程序\ 子目录里，不要单独把 exe 拎出去（它需要旁边的 -rg 边车）
   · 聊天记录/设置存在 %LOCALAPPDATA%\DSH-Web（和程序分开），
     所以以后升级只需替换程序文件夹，记录不会丢
   · 关闭本窗口 = 停止服务

  端口策略（重要）：
   · 默认 3099，与开发仓库实例常用的 3080 错开；
     可用 --port N / --port=N 覆盖。
   · **默认端口必须显式传给 exe**：exe 自己的内置默认是 3080，
     只在本脚本里"心里想着 3099"是没用的，它照样会去绑 3080。
   · 端口被占用时不会偷偷换端口，而是先判断占用者是谁：
       - 是 DSH Web  → 直接打开它
       - 不是 DSH    → 拒绝启动，打印占用进程名，让用户自己决定
     盲扫端口的做法会带来两类问题：探测与绑定之间的竞态（照样启动失败），
     以及把别的东西要用的端口先占住（把故障转嫁给别人）。
#>
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$WebArgs
)

$root       = $PSScriptRoot
$programDir = Join-Path $root '程序'
$exe        = Join-Path $programDir 'deepseek-harness.exe'
$sidecar    = Join-Path $programDir 'deepseek-harness-rg.exe'
# 数据目录默认在 %LOCALAPPDATA%\DSH-Web。
# DSH_WEB_HOME 可以覆盖它 —— 给自动化测试用（让测试在临时目录里跑插件同步，
# 不碰真实数据目录），也方便想把数据放到别处的高级用户。
$dataHome   = if ($env:DSH_WEB_HOME) { $env:DSH_WEB_HOME } else { Join-Path $env:LOCALAPPDATA 'DSH-Web' }
$workspace  = Join-Path $dataHome 'workspace'
$logDir     = Join-Path $dataHome 'logs'
$logFile    = Join-Path $logDir 'launcher.log'

# ---------- 解析端口（必须在"是否已在运行"检查之前） ----------
$defaultPort = 3099
$port    = $defaultPort
# 注意：$WebArgs 为 $null 时 @($WebArgs) 得到的是**含一个 $null 元素的数组**（count=1），
# 并不是空数组 —— 必须显式滤掉，否则 runArgs 会带着 null，-ArgumentList 直接绑定失败。
$argList   = @($WebArgs | Where-Object { $_ -ne $null })
$portGiven = $false
for ($i = 0; $i -lt $argList.Count; $i++) {
  $a = $argList[$i]
  if ($a -eq '--port' -and ($i + 1) -lt $argList.Count) { $port = $argList[$i + 1]; $portGiven = $true }
  elseif ($a -like '--port=*') { $port = $a.Substring(7); $portGiven = $true }
}
if ("$port" -notmatch '^\d+$') { $port = $defaultPort; $portGiven = $false }
$port = [int]$port
if (-not $portGiven) { $effectiveArgs = @('--port', "$port") } else { $effectiveArgs = @() }
# --port 0 = 让系统随机挑端口，此时地址无法预知，交给 dsh 自己处理
$unknownPort = ($port -eq 0)
$url = if ($unknownPort) { $null } else { "http://127.0.0.1:$port/" }

try { $Host.UI.RawUI.WindowTitle = 'DSH Web' } catch { }

# ---------- 辅助函数 ----------

function Test-PortBusy {
  param([int]$Port)
  try {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop) { return $true }
  } catch { }
  # Get-NetTCPConnection 在受限/低权限环境下会直接"拒绝访问"，所以必须能退回 netstat。
  # 这里锚定的是本机端口列（"  TCP    127.0.0.1:3099    0.0.0.0:0    LISTENING    <pid>"），
  # 不会把"连到该端口"的客户端行（对端地址列里才有 :3099）误判成占用。
  return [bool](netstat -ano | Select-String -Pattern "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING")
}

# 端口占用者的 PID（Windows 原生 Get-NetTCPConnection 失败时退回 netstat）
function Get-PortOwnerId {
  param([int]$Port)
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
  } catch { }
  $line = netstat -ano | Select-String -Pattern "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING" | Select-Object -First 1
  if ($line -and "$line" -match '(\d+)\s*$') { return [int]$Matches[1] }
  return $null
}

# 占用者是不是 DSH Web 本体？
# 不带 token 请求根路径：DSH 的认证层会回 401 + 固定文案，这是最省事也最可靠的指纹。
function Test-DshEndpoint {
  param([int]$Port)
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3 `
      -MaximumRedirection 0 -ErrorAction SilentlyContinue
    if ($resp.StatusCode -eq 200) { return $true }
  } catch {
    $r = $_.Exception.Response
    if ($r -ne $null -and [int]$r.StatusCode -eq 401) {
      try {
        $body = (New-Object System.IO.StreamReader($r.GetResponseStream())).ReadToEnd()
        if ($body -like '*dsh web authentication required*') { return $true }
      } catch { }
    }
  }
  return $false
}

function Show-PortOwner {
  param([int]$Port)
  $ownerId = Get-PortOwnerId -Port $Port
  if ($null -eq $ownerId) { $ownerId = 0 }
  if ($ownerId -gt 0) {
    $name = $null
    try { $name = (Get-Process -Id $ownerId -ErrorAction Stop).ProcessName } catch { }
    Write-Host ("  占用进程：{0}（PID {1}）" -f $(if ($name) { $name } else { '未知' }), $ownerId) -ForegroundColor Yellow
  }
}

# ---------- 已经在运行：只开界面，不重复启动 ----------
if (-not $unknownPort -and (Test-PortBusy -Port $port)) {
  Write-Host ''
  if (Test-DshEndpoint -Port $port) {
    Write-Host "  DSH Web 已经在运行（端口 $port），正在为你打开界面……" -ForegroundColor Yellow
    Write-Host ''
    Write-Host "  如果浏览器没有打开，手动访问：$url" -ForegroundColor Gray
    Write-Host '  （该实例此前运行过时，浏览器里应留有登录 cookie；若被提示 authentication required，' -ForegroundColor DarkGray
    Write-Host '    说明 cookie 已过期或换了浏览器 —— 到那个实例的窗口里关掉它，再重新启动本程序。）' -ForegroundColor DarkGray
    Write-Host ''
    try { Start-Process $url } catch { }
    Start-Sleep -Seconds 3
    exit 0
  }

  Write-Host "  端口 $port 被别的程序占用了，本程序不会去抢它的端口，所以无法启动。" -ForegroundColor Red
  Show-PortOwner -Port $port
  Write-Host ''
  Write-Host '  两个办法：'
  Write-Host '    1) 关掉上面那个程序，再重新双击本启动器；'
  Write-Host '    2) 换一个端口启动，例如在 cmd 里执行：'
  Write-Host '         启动 DSH Web.cmd --port 3199' -ForegroundColor White
  Write-Host ''
  Write-Host '  注意：端口被占时本程序不会自动改用别的端口 —— 盲扫会先占住别人的端口，' -ForegroundColor DarkGray
  Write-Host '        也可能探到空闲后又被抢占，导致启动仍然失败。' -ForegroundColor DarkGray
  Write-Host ''
  Read-Host '  按回车关闭'
  exit 1
}

# ---------- 检查程序文件 ----------
if (-not (Test-Path -LiteralPath $exe)) {
  Write-Host ''
  Write-Host "  找不到主程序：$exe" -ForegroundColor Red
  Write-Host '  请确认整个文件夹是完整解压出来的（不要只复制其中一部分）。'
  Write-Host ''
  Read-Host '  按回车关闭'
  exit 1
}
if (-not (Test-Path -LiteralPath $sidecar)) {
  Write-Host ''
  Write-Host '  警告：缺少配套文件 deepseek-harness-rg.exe' -ForegroundColor Yellow
  Write-Host '  程序仍会启动，但"搜索文件内容"功能会不可用。'
  Write-Host '  请重新完整解压一次压缩包。'
  Write-Host ''
  Start-Sleep -Seconds 3
}

# ---------- 准备数据目录（在包外，升级不丢记录） ----------
try {
  New-Item -ItemType Directory -Force -Path $workspace | Out-Null
} catch {
  Write-Host ''
  Write-Host "  无法创建数据目录：$workspace" -ForegroundColor Red
  Read-Host '  按回车关闭'
  exit 1
}
# 日志只是排错用的，写不了就退回临时目录 —— 绝不能因为它起不来
try {
  New-Item -ItemType Directory -Force -Path $logDir -ErrorAction Stop | Out-Null
} catch {
  $logDir  = Join-Path $env:TEMP 'DSH-Web'
  New-Item -ItemType Directory -Force -Path $logDir -ErrorAction SilentlyContinue | Out-Null
  $logFile = Join-Path $logDir 'launcher.log'
}

$env:DSH_HOME = $dataHome

# ---------- 预置 profile：修掉单文件 exe 里原生目录对话框不可用的问题 ----------
# 背景：原生目录选择器靠 spawn(process.execPath, [worker.cjs]) 起子进程去开 Win32
# 模态对话框。便携版里 process.execPath 就是本程序的 exe（引导只跑 CLI、不认脚本
# 参数），且 import.meta.url 指向打包快照 /snapshot 的虚拟路径，磁盘上不存在 ——
# 子进程必然立刻退出，界面报 "win32 folder dialog worker exited before reporting a
# result"，后果是选不了工作区、也就无法开始对话。
# 修法：关掉自动选择器（它在 win32+127.0.0.1+非 SSH 时必然选原生），直接钉死网页版
# browse —— 纯 Node 实现，无子进程、无原生模块。directory-picker 是单例服务，两个
# 后端并存会冲突，所以必须先 disable 再 insert。
#
# 这份 patch 必须**整份重写**，不能追加：它是一份 YAML 文档，顶层只有一个数组。
# 若在程序生成的模板（结尾是 `[]`，已结束整个文档）之后再追加一段 `- id: ...`，
# 文件里就出现两段顶层数组，YAML 解析直接失败：
#   YAMLException: end of the stream or a document separator is expected
# 而启动器先写、程序后生成模板的顺序（全新设备就是这种）正好会踩到。整份重写
# 既消除了这个风险，也让重复启动天然幂等。
$profileDir   = Join-Path $dataHome 'profiles\web'
$profilePatch = Join-Path $profileDir 'cordis.patch.yml'
$profilePatchContent = @'
# dsh profile 补丁层：在全部 bundle 层之后应用。
# 顶层是一个 YAML 数组，元素为 loader patch 条目（按 id 定向改配置、禁用、插入新行）。
# 本文件由「启动 DSH Web.cmd / start-dsh-web.ps1」在每次启动时整体重写，请勿手工编辑：
# 你的改动会在下次启动时被覆盖。

# 单文件 exe 里原生目录对话框不可用，钉死网页版（browse）。
# 原生后端靠 spawn(process.execPath, [.../worker.cjs]) 起子进程去开 Win32 模态对话框；
# 但在便携版里 process.execPath 就是这个 exe（引导只跑 CLI、不认脚本路径参数），
# 且它指向的路径在打包快照 /snapshot 里、磁盘上并不存在 —— 子进程必然立刻退出，
# 界面报 "win32 folder dialog worker exited before reporting a result"，
# 后果是选不了工作区、也就无法开始对话。
# 网页版是纯 Node 实现（只用 node:path / node:os / node:fs/promises），无子进程、
# 无原生模块。directory-picker 是单例服务，两个后端并存会冲突，故先 disable 再 insert。
- id: directory-picker
  disabled: true

- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: directory-picker-browse-surface
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
'@

# 关掉**树内**那条皮肤。
#
# 背景：官方源码/自制 fork 构建的 exe 里，web-app bundle 自带一条 id=ui-skin 的
# 皮肤（packages/client/ui-skin，编进 exe、不在 插件\ 里）。而本便携包自带的
# @dsh-external/dsh-ui-skin 是同一功能的独立插件版本。两者互不相干，但都往
# 「设置 ▸ 通用」的同一个槽位注册 —— 结果是两个「皮肤」标题、且树内那份盖住插件
# 那份（树内那份没有素材目录输入框，用户会以为新功能没做出来）。
#
# 为什么敢无条件写：**实测过** disable 一个不存在的 id 不会让 loader 报错
# （在隔离实例里拿 this-id-does-not-exist-xyz 试过，实例照常启动）。所以这里
# 不需要"先探测 exe 里有没有那条" —— 官方源码构建的 exe（没有树内皮肤）不受影响。
$profilePatchContent += @'

# 关掉树内那条同名皮肤（原因见启动器注释）：它与随包插件抢同一个设置槽位。
# disable 一个不存在的 id 是无害的，所以这一条对没有树内皮肤的 exe 也安全。
- id: ui-skin
  disabled: true
'@

try {
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  # 内容不同才写，避免每次启动都改文件（不改就不会触发无谓的热加载）
  $needPatchWrite = $true
  if (Test-Path -LiteralPath $profilePatch) {
    $current = [System.IO.File]::ReadAllText($profilePatch, (New-Object System.Text.UTF8Encoding($false)))
    $needPatchWrite = ($current.Trim() -ne $profilePatchContent.Trim())
  }
  if ($needPatchWrite) {
    [System.IO.File]::WriteAllText($profilePatch, $profilePatchContent, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host '  已写入 profile 配置（目录选择器改为网页版）。'
  }

  # package.json 必须有 version 字段，否则 profile 的 live 热加载会校验失败
  # （上游注释明确写了这条前置条件）。首次启动时该文件还不存在（由程序自己生成），
  # 所以两条路都要走：缺失就补一份模板，存在但缺字段就就地插一行。
  $profileManifest = Join-Path $profileDir 'package.json'
  $manifestTemplate = @'
{
  "name": "dsh-profile-web",
  "version": "0.0.0",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app"
      ],
      "patchReload": "live"
    }
  }
}
'@
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  if (-not (Test-Path -LiteralPath $profileManifest)) {
    [System.IO.File]::WriteAllText($profileManifest, $manifestTemplate, $utf8NoBom)
    Write-Host '  已预置 profile 清单（含热加载所需的 version 字段）。'
  } else {
    $raw = [System.IO.File]::ReadAllText($profileManifest, $utf8NoBom)
    if ($raw -notmatch '"version"\s*:') {
      $fixed = [regex]::Replace($raw, '^(\s*\{)', "`$1`r`n  `"version`": `"0.0.0`",", 1)
      [System.IO.File]::WriteAllText($profileManifest, $fixed, $utf8NoBom)
      Write-Host '  已为 profile 补上 version 字段（热加载前置条件）。'
    }
  }
} catch {
  # 预置失败不该拦住启动：程序自己仍能生成 profile，只是多一个目录选择器问题
  Write-Host "  警告：profile 预置未完成（$($_.Exception.Message)）" -ForegroundColor Yellow
}

# ---------- 插件同步：把便携包内的 插件\ 挂进 profile ----------
# 设计：便携包内的 插件\ 目录是唯一真相源，随包一起分发/升级；启动时把它同步进
# profile 的 node_modules，并把插件包名登记进 profile 清单的 bundles 列表。
#
# 为什么只要这两步就够（等价于官方 `dsh plugin add` 的收尾动作）：
#   · bundles 列表决定哪些包参与 profile 装配；
#   · 插件包自带的 cordis.patch.yml 由 loader 自己读，挂哪一行是插件自己声明的，
#     启动器不需要理解任何插件的内部结构；
#   · 浏览器半边由客户端模块系统按包扫描 dsh.client 声明发现，也不需要额外登记。
#
# 安装形态用 junction 指向 插件\：插件只存一份，升级插件=替换那个文件夹，
# 不会出现"复制的那份忘了更新"的版本漂移。（junction 可以跨盘 —— 实测 profile 在
# C 盘、插件目录在 D 盘照样成立。退回复制是给"目标盘不是 NTFS"兜底的，
# 比如把便携包放在 FAT32/exFAT 的 U 盘上。）
$pluginsRoot  = Join-Path $root '插件'
$nodeModules  = Join-Path $profileDir 'node_modules'

# 记账文件：本启动器**实际装过**哪些包。
#
# 为什么需要它：清理逻辑必须能回答"这个 node_modules 条目是我装的，还是用户自己
# 装的？"。早期版本靠包名前缀猜（凡 @dsh-external\ 下的都算我的）—— 那会把用户
# 自己用 `dsh plugin add` 装在同一个作用域下的包当成"我以前装过、现在包里没了"
# 给删掉。名字前缀不是所有权证明，所以改成显式记账：
#   · 每次成功安装后，把包名写进这个文件；
#   · 清理时只认这个文件里的名字（外加"指向 插件\ 的 junction"这条形态证据）。
# 文件放在数据目录（不是程序目录），所以升级/移动便携包不会丢记账。
$recordsPath  = Join-Path $dataHome 'managed-plugins.json'

# 插件装到 profile 里的哪个位置，**由包名决定**，不是一律塞进 @dsh-external\：
#     包名 @scope/name  →  node_modules\@scope\name
#     包名 name         →  node_modules\name
# 必须这样：bundles 里的名字是 node 按包名解析的（带作用域的走 @scope\ 子目录，
# 不带作用域的走 node_modules\ 顶层）。落点对不上就是"登记了却解析不到包"，
# 结果是整个界面起不来 —— 而本包自带的 dsh-whale-widget 正是不带作用域的。
function Get-PluginLinkPath {
  param([string]$Name)
  $parts = $Name.Split('/')
  if ($parts.Count -eq 2 -and $parts[0] -like '@*') { return (Join-Path $nodeModules ($parts[0] + '\' + $parts[1])) }
  return (Join-Path $nodeModules $Name)
}

# 删除 profile 里的一个插件条目。
#
# 为什么不能用 Remove-Item -Recurse（这是本启动器最危险的一个坑）：
# 条目是 junction，而 PowerShell 5.1 的 Remove-Item -Recurse 在**跨卷** junction 上
# 会顺着链接把**目标整个删掉** —— 也就是"清理 profile"会把 插件\ 里的真文件删干净。
# 实测（C: 上的 junction → D: 上的插件目录）：
#     Remove-Item -Recurse <junction>      → 目标目录里的文件全没了
#     Remove-Item -Recurse <junction 的父目录> → 同样全没了
#     cmd /c rmdir <junction>              → 只摘链接，目标完好
# 同卷时 Remove-Item -Recurse 不会这样，所以这个坑在开发机上（数据目录和程序
# 文件夹同盘）根本测不出来 —— 而便携包恰恰就是"数据在 C:、程序在 D:/U 盘"的组合。
#
# 所以：链接一律用 rmdir 摘掉；只有真目录才用 Remove-Item -Recurse。
function Remove-PluginEntry {
  param([string]$Path)
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return }
  if ($item.LinkType) {
    & cmd.exe /c rmdir "$Path" 2>&1 | Out-Null
    if (Test-Path -LiteralPath $Path) {
      # 兜底：非递归删除对 reparse point 也只摘链接本身（已验证跨卷安全）
      try { [System.IO.Directory]::Delete($Path, $false) } catch { }
    }
  } else {
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# 读取一个 JSON 文件（宽容失败，读取方自行判断 $null）
function Read-JsonFile {
  param([string]$Path)
  try {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return ([System.IO.File]::ReadAllText($Path, (New-Object System.Text.UTF8Encoding($false))) | ConvertFrom-Json)
  } catch {
    return $null
  }
}

# 读一个清单文本里的 bundles 条目（按文件里的顺序）
function Get-ListedBundles {
  param([string]$Raw)
  $listed = @()
  $m = [regex]::Match($Raw, '"bundles"\s*:\s*\[(?<body>[^\]]*)\]')
  if ($m.Success) {
    foreach ($hit in [regex]::Matches($m.Groups['body'].Value, '"([^"]+)"')) { $listed += $hit.Groups[1].Value }
  }
  return , $listed
}

# 把 profile 清单的 bundles 列表同步成"现有条目去掉 $DropNames 再补上 $AddNames"。
# 无变化时一个字节都不写（保持幂等）；有变化时只重写 "bundles": [ ... ] 这一段，
# 文件其它字节原样保留。写完前先解析校验一遍 —— profile 清单坏掉就等于起不来，
# 所以宁可什么都不改，也不写一份半成品出去。
function Sync-Bundles {
  param([string]$ManifestPath, [string]$Raw, [string[]]$DropNames, [string[]]$AddNames)
  $m = [regex]::Match($Raw, '(?<head>"bundles"\s*:\s*\[)(?<body>[^\]]*)(?<tail>\])')
  if (-not $m.Success) { return $false }

  # 沿用文件里 bundles 那一行的缩进，别把用户/上游写的排版搅乱
  $indent = '      '
  $lineStart = $Raw.LastIndexOf("`n", $m.Index)
  if ($lineStart -ge 0) {
    $prefix = $Raw.Substring($lineStart + 1, $m.Index - ($lineStart + 1))
    if ($prefix.Trim() -eq '') { $indent = $prefix }
  }

  $items = @()
  foreach ($hit in [regex]::Matches($m.Groups['body'].Value, '"([^"]+)"')) { $items += $hit.Groups[1].Value }
  $kept = @()
  foreach ($it in $items) { if ($DropNames -notcontains $it) { $kept += $it } }
  foreach ($it in $AddNames) { if ($kept -notcontains $it) { $kept += $it } }
  if (($kept -join "`n") -ceq ($items -join "`n")) { return $false }

  $itemIndent = $indent + '  '
  $body = ''
  if ($kept.Count -gt 0) {
    $lines = @()
    for ($i = 0; $i -lt $kept.Count; $i++) {
      $comma = if ($i -lt $kept.Count - 1) { ',' } else { '' }
      $lines += ($itemIndent + '"' + $kept[$i] + '"' + $comma)
    }
    $body = "`r`n" + ($lines -join "`r`n") + "`r`n" + $indent
  }
  $updated = $Raw.Substring(0, $m.Index) + $m.Groups['head'].Value + $body + ']' + $Raw.Substring($m.Index + $m.Length)
  try { $null = $updated | ConvertFrom-Json } catch { return $false }
  [System.IO.File]::WriteAllText($ManifestPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
  return $true
}

# 读记账文件：返回本启动器"装过哪些包"的名字数组。读不到/坏掉一律当空数组 ——
# 退化成"只靠 junction 形态认领"，比因为一个记账文件读不了就拒绝启动好得多。
function Get-ManagedPluginRecords {
  param([string]$Path)
  $data = Read-JsonFile $Path
  if ($null -eq $data -or $null -eq $data.plugins) { return @() }
  return @($data.plugins | Where-Object { $_ -is [string] -and $_ -ne '' })
}

# 写记账文件。刻意不做成"失败就报错"：记账写不进去只是下次少一条清理依据，
# 不该拦住启动，也不该在用户界面上刷红字。
function Save-ManagedPluginRecords {
  param([string]$Path, [string[]]$Names)
  try {
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $payload = [ordered]@{ version = 1; updated = (Get-Date).ToString('s'); plugins = @($Names | Sort-Object -Unique) }
    $json = $payload | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
}

try {
  $profileManifest = Join-Path $profileDir 'package.json'
  # 本启动器以前装过、现在还在管着的包名（清理逻辑的唯一"所有权"依据）
  $recorded = Get-ManagedPluginRecords $recordsPath
  # A) 读取 插件\ 下每个插件的包名与来源目录；只接受声明了 dsh.bundle.patch 的
  $pluginSources = @{}
  if (Test-Path -LiteralPath $pluginsRoot) {
    foreach ($scopeDir in (Get-ChildItem -LiteralPath $pluginsRoot -Directory -Force -ErrorAction SilentlyContinue)) {
      $candidates = @()
      if ($scopeDir.Name -like '@*') {
        $candidates = Get-ChildItem -LiteralPath $scopeDir.FullName -Directory -Force -ErrorAction SilentlyContinue
      } else {
        $candidates = @($scopeDir)
      }
      foreach ($candidate in $candidates) {
        $manifest = Read-JsonFile (Join-Path $candidate.FullName 'package.json')
        if ($null -eq $manifest -or -not $manifest.name) {
          Write-Host "  警告：跳过 $($candidate.Name)（没有可解析的 package.json）" -ForegroundColor Yellow
          continue
        }
        if (-not $manifest.dsh -or -not $manifest.dsh.bundle -or -not $manifest.dsh.bundle.patch) {
          Write-Host "  警告：跳过 $($candidate.Name)（未声明 dsh.bundle.patch，不参与 profile 装配）" -ForegroundColor Yellow
          continue
        }
        $pluginSources[[string]$manifest.name] = $candidate.FullName
      }
    }
  }

  # B) 同步 node_modules：为每个插件建 junction（失败退回复制），清掉已不在 插件\ 的条目
  if (-not (Test-Path -LiteralPath $nodeModules)) {
    New-Item -ItemType Directory -Force -Path $nodeModules | Out-Null
  }
  $failedPlugins = @()
  foreach ($name in $pluginSources.Keys) {
    $shortName = $name.Split('/')[-1]
    $link = Get-PluginLinkPath $name
    $linkDir = Split-Path -Parent $link
    if (-not (Test-Path -LiteralPath $linkDir)) { New-Item -ItemType Directory -Force -Path $linkDir | Out-Null }
    $source = $pluginSources[$name]
    $already = $false
    if (Test-Path -LiteralPath $link) {
      $existing = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
      if ($existing -and $existing.LinkType) {
        $already = ((($existing.Target -join '') -replace '/', '\').TrimEnd('\') -ieq $source.TrimEnd('\'))
      }
    }
    if ($already) { continue }
    if (Test-Path -LiteralPath $link) { Remove-PluginEntry $link }
    $linked = $false
    try {
      New-Item -ItemType Junction -Path $link -Target $source -ErrorAction Stop | Out-Null
      $linked = $true
    } catch {
      $linked = $false
    }
    if (-not $linked) {
      Copy-Item -LiteralPath $source -Destination $link -Recurse -Force -ErrorAction SilentlyContinue
      # 复制也可能失败（权限、路径过长、源目录已不可读）。别把失败报成成功 ——
      # 那样用户看到"已装"，实际什么都没装，最难查。
      if (Test-Path -LiteralPath (Join-Path $link 'package.json')) {
        Write-Host "  已复制插件：$shortName（无法建立 junction，通常是跨盘）"
      } else {
        Write-Host "  警告：插件 $shortName 既挂不上也没复制成功，本次不生效（请检查 插件\ 目录）" -ForegroundColor Yellow
        $failedPlugins += $name
      }
    } else {
      Write-Host "  已挂载插件：$shortName"
    }
  }
  # 清掉"以前随包装过、现在 插件\ 里已经没有"的条目。
  # 认领依据有两条，**都不靠包名前缀**：
  #   · 名字在本启动器的记账文件里（$recorded）—— 这是我们装过的直接证据；
  #   · 指向 插件\ 的 junction —— 这是我们的安装形态，即使记账丢了也能认出来
  #     （比如用户手工删过数据目录里的记账文件）。
  # 其余一律不碰：用户自己 dsh plugin add 装的包、第一方包都不该被这套逻辑删掉。
  $managedDirs = @()
  foreach ($top in (Get-ChildItem -LiteralPath $nodeModules -Directory -Force -ErrorAction SilentlyContinue)) {
    if ($top.Name -like '@*') {
      $managedDirs += @(Get-ChildItem -LiteralPath $top.FullName -Directory -Force -ErrorAction SilentlyContinue)
    } elseif ($top.Name -notlike '.*') {
      $managedDirs += @($top)
    }
  }
  $staleNames = @()
  foreach ($entry in $managedDirs) {
    $manifest = Read-JsonFile (Join-Path $entry.FullName 'package.json')
    $entryName = if ($manifest -and $manifest.name) { [string]$manifest.name } else { '' }
    # 读不到 package.json 也必须认出它是谁：插件目录被删掉之后，这里剩下的是**断链**
    # （junction 目标已经不存在），manifest 必然读不到 —— 而"名字还留在 bundles 里"
    # 恰恰会让下一次启动整个失败。所以按落点把名字拼回来：
    #   @scope\name → @scope/name      顶层 name → name
    if (-not $entryName) {
      $entryName = if ($entry.Parent.Name -like '@*') { $entry.Parent.Name + '/' + $entry.Name } else { $entry.Name }
    }
    if ($pluginSources.ContainsKey($entryName)) { continue }
    $isOurs = ($recorded -contains $entryName)
    if (-not $isOurs) {
      # 记账文件可能被用户删掉/损坏；这时退回形态证据：是不是我们 插件\ 的 junction
      $item = Get-Item -LiteralPath $entry.FullName -Force -ErrorAction SilentlyContinue
      if ($item -and $item.LinkType) {
        $target = ((($item.Target -join '') -replace '/', '\')).TrimEnd('\')
        if ($target -and $target.ToLower().StartsWith(($pluginsRoot.TrimEnd('\') + '\').ToLower())) { $isOurs = $true }
      }
    }
    if (-not $isOurs) { continue }
    Remove-PluginEntry $entry.FullName
    $staleNames += $entryName
    Write-Host "  已移除不再随包的插件：$($entry.Name)"
  }
  # 没装成功的插件必须从"可用清单"里划掉：否则下面会把它登记进 bundles，
  # 而 loader 解析不到那个包 —— 结果就是整个界面起不来。宁可不装，不可登记。
  foreach ($name in $failedPlugins) {
    if ($pluginSources.ContainsKey($name)) { $pluginSources.Remove($name) }
  }

  # C) 同步 profile 清单的 bundles 列表：以 插件\ 为唯一事实来源，缺的补上、
  #    已经不存在的摘掉。
  #    摘掉这步是**必须**的，不是清理洁癖：残留的名字会让 loader 去解析一个不存在
  #    的包，结果是整个界面起不来（实测：删掉插件文件夹后不摘名字，启动直接失败）。
  #    判定范围限定在"本启动器装过的东西"：记账文件里的名字，以及这一轮确实清理掉的
  #    那些条目（$staleNames）—— 其余 bundle（第一方包、用户自己 dsh plugin add
  #    装的包）一律不碰。
  if (Test-Path -LiteralPath $profileManifest) {
    $rawManifest = [System.IO.File]::ReadAllText($profileManifest, (New-Object System.Text.UTF8Encoding($false)))
    $listed = Get-ListedBundles $rawManifest
    $add = @()
    foreach ($name in ($pluginSources.Keys | Sort-Object)) {
      if ($listed -notcontains $name) { $add += $name }
    }
    $drop = @()
    foreach ($name in $listed) {
      if ($pluginSources.ContainsKey($name)) { continue }
      if ($recorded -contains $name) { $drop += $name; continue }
      if ($staleNames -contains $name) { $drop += $name; continue }
      # 兼容：早期版本用 @dsh-external\ 前缀判定，并在**没有记账**的情况下登记过条目。
      # 只对"清单里写着、但 node_modules 里已经没有实体"的孤儿条目生效 ——
      # 用户自己装的包在 node_modules 里是有实体的，不会被这条误伤。
      if ($name -like '@dsh-external/*') {
        if (-not (Test-Path -LiteralPath (Get-PluginLinkPath $name))) { $drop += $name }
      }
    }
    if ($add.Count -gt 0 -or $drop.Count -gt 0) {
      if (Sync-Bundles -ManifestPath $profileManifest -Raw $rawManifest -DropNames $drop -AddNames $add) {
        if ($add.Count -gt 0) { Write-Host "  已登记 $($add.Count) 个插件到 profile 清单。" }
        if ($drop.Count -gt 0) { Write-Host "  已从 profile 清单移除：$($drop -join '、')" }
      } else {
        Write-Host '  警告：profile 清单未能更新，插件可能不生效。' -ForegroundColor Yellow
      }
    }
  }

  # D) 更新记账：记下"本启动器现在管着哪些包"。放在最后一步 —— 只有前面的安装/
  #    清理都跑完了，这份记录才如实反映现状。写入失败只是下次清理少一条依据，不报错。
  Save-ManagedPluginRecords -Path $recordsPath -Names @($pluginSources.Keys)
} catch {
  # 插件同步失败不该拦住启动：程序仍能起来，只是插件不生效
  Write-Host "  警告：插件同步未完成（$($_.Exception.Message)）" -ForegroundColor Yellow
}

# 固定工作目录，保证升级/移动文件夹后对话记录仍能对上
Set-Location -LiteralPath $workspace

Write-Host ''
Write-Host '  DSH Web 启动中，请稍候……' -ForegroundColor Cyan
Write-Host "  数据目录：$dataHome"

# ---------- 启动子进程：输出落盘 + 实时回显 ----------
# 为什么要绕这一圈：exe 只在**它自己那行 stdout** 里打印带 ?token= 的真实地址。
# 直接把输出留在这个窗口里，脚本就拿不到那行地址，用户也就没有一个可点的 URL；
# 而一旦用管道捕获，实时输出又消失了。所以：落盘 + 后台 tail，两者都要。
$liveTail = $null
$runArgs  = @('web') + $effectiveArgs + $argList
$proc = $null
$code = 0
$urlLine = $null
try {
  Remove-Item -LiteralPath $logFile -Force -ErrorAction SilentlyContinue
  # ArgumentList 用 $runArgs（含 web 子命令与默认端口），永远非空
  $startArgs = @{
    FilePath               = $exe
    NoNewWindow            = $true
    PassThru               = $true
    RedirectStandardOutput = $logFile
    RedirectStandardError  = "$logFile.err"
  }
  $startArgs['ArgumentList'] = @($runArgs)
  $proc = Start-Process @startArgs

  $liveTail = Start-Job -ArgumentList $logFile -ScriptBlock {
    param($path)
    if (-not (Test-Path -LiteralPath $path)) {
      for ($i = 0; $i -lt 100 -and -not (Test-Path -LiteralPath $path); $i++) { Start-Sleep -Milliseconds 100 }
    }
    Get-Content -LiteralPath $path -Wait -Encoding UTF8 -ErrorAction SilentlyContinue
  }

  Write-Host '  浏览器会自动打开；关闭本窗口即停止服务。'
  Write-Host ''

  # 阶段 1：等就绪行（或等它失败退出）。拿到地址就不再干等 —— 服务要一直跑到用户关窗口。
  $deadline = (Get-Date).AddSeconds(120)
  while ($true) {
    if ($liveTail) {
      Receive-Job -Job $liveTail -ErrorAction SilentlyContinue |
        ForEach-Object { if ("$_" -ne '') { Write-Host "  $_" } }
    }
    if (-not $urlLine -and (Test-Path -LiteralPath $logFile)) {
      $hit = Select-String -LiteralPath $logFile -Pattern 'dsh web:\s*(http://\S+)' -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($hit) { $urlLine = $hit.Matches[0].Groups[1].Value }
    }
    if ($proc.HasExited) { break }
    if ($urlLine) { break }
    if ((Get-Date) -gt $deadline) { break }
    Start-Sleep -Milliseconds 300
  }

  # 阶段 2：拿到地址就立刻摆到用户面前 —— 不依赖"浏览器有没有自动打开"。
  if ($urlLine) {
    $bootLog = ''
    foreach ($f in @($logFile, "$logFile.err")) {
      if (Test-Path -LiteralPath $f) { $bootLog += (Get-Content -LiteralPath $f -Raw -ErrorAction SilentlyContinue) }
    }
    if ($bootLog -match 'could not open the default browser') {
      Write-Host ''
      Write-Host '  自动打开浏览器失败（被系统拦截），改为手动打开。' -ForegroundColor Yellow
      try { Start-Process $urlLine } catch { }
    }
    Write-Host ''
    Write-Host '  ────────────────────────────────────────────────────────────' -ForegroundColor DarkCyan
    Write-Host '  界面地址（浏览器没自动打开，就手动复制下面这一整行）：' -ForegroundColor Cyan
    Write-Host "  $urlLine" -ForegroundColor White
    Write-Host '  ────────────────────────────────────────────────────────────' -ForegroundColor DarkCyan
    Write-Host ''
    if (-not $proc.HasExited) {
      Write-Host '  服务运行中……关闭本窗口即停止。' -ForegroundColor Green
      # 阶段 3：守着子进程，顺便继续回显它的输出。
      while (-not $proc.HasExited) {
        if ($liveTail) {
          Receive-Job -Job $liveTail -ErrorAction SilentlyContinue |
            ForEach-Object { if ("$_" -ne '') { Write-Host "  $_" } }
        }
        Start-Sleep -Milliseconds 300
      }
    }
  }

  $proc.WaitForExit()
  $code = $proc.ExitCode
  if ($liveTail) {
    Receive-Job -Job $liveTail -ErrorAction SilentlyContinue |
      ForEach-Object { if ("$_" -ne '') { Write-Host "  $_" } }
  }
} catch {
  Write-Host ''
  Write-Host "  启动失败：$($_.Exception.Message)" -ForegroundColor Red
  $code = 1
} finally {
  if ($liveTail) { Stop-Job -Job $liveTail -ErrorAction SilentlyContinue; Remove-Job -Job $liveTail -Force -ErrorAction SilentlyContinue }
  # 没起来就把子进程收掉，别把半死不活的东西留在后台占着端口
  if ($null -ne $proc -and -not $proc.HasExited -and -not $urlLine) {
    try { $proc.Kill() } catch { }
  }
}

Write-Host ''
if ($code -ne 0 -or -not $urlLine) {
  Write-Host "  启动失败（错误码 $code）。" -ForegroundColor Red
  if (Test-Path -LiteralPath $logFile) {
    Write-Host '  下面是程序输出的最后几行：' -ForegroundColor Yellow
    Get-Content -LiteralPath $logFile -Tail 12 -ErrorAction SilentlyContinue |
      ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
  }
  if (Test-Path -LiteralPath "$logFile.err") {
    Write-Host '  错误输出：' -ForegroundColor Yellow
    Get-Content -LiteralPath "$logFile.err" -Tail 8 -ErrorAction SilentlyContinue |
      ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
  }
  Write-Host "  完整日志：$logFile"
  Write-Host '  常见原因：端口被别的程序占用 / 程序文件被杀毒软件拦截。'
  # 插件是启动时唯一"可变"的输入：加载器解析任何一个插件失败，都会让整个界面起不来。
  # 这时给一条能自己走下去的退路，比让用户盯着一串 loadProfileDirectory 调用栈强。
  if (Test-Path -LiteralPath (Join-Path $root '插件')) {
    $bootText = ''
    foreach ($f in @($logFile, "$logFile.err")) {
      if (Test-Path -LiteralPath $f) { $bootText += (Get-Content -LiteralPath $f -Raw -ErrorAction SilentlyContinue) }
    }
    if ($bootText -match 'loadProfileDirectory|loadProfile|failed to parse overlay|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED') {
      Write-Host ''
      Write-Host '  ⚠ 看日志像是加载插件时失败的。' -ForegroundColor Yellow
      Write-Host '    退路一：把「插件」整个文件夹改名为「插件_停用」，再启动一次；' -ForegroundColor Yellow
      Write-Host '            能起来就说明问题出在插件上，然后把里面的插件逐个放回来定位。' -ForegroundColor Yellow
      Write-Host '    退路二：运行「诊断.ps1」，看第 4 节 —— 它会指出哪个插件形态不对。' -ForegroundColor Yellow
      Write-Host '    （本版自带「人设」「剧本批注」「提示词对照」「小鲸鱼余额挂件」四个' -ForegroundColor Yellow
      Write-Host '      插件；从别处拿来的插件如果不带 lib 文件夹、或者声明了要联网下载的' -ForegroundColor Yellow
      Write-Host '      依赖，就是这种情况。）' -ForegroundColor Yellow
    }
  }
} else {
  Write-Host '  DSH Web 已停止。'
}
Read-Host '  按回车关闭窗口'
