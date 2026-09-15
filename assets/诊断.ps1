# ============================================================
#  DSH Web 便携版 —— 诊断脚本（只读，不启动服务、不改动任何数据）
#  ------------------------------------------------------------
#  用法：在便携版目录里执行
#      powershell -NoProfile -ExecutionPolicy Bypass -File 诊断.ps1
#  或直接双击本文件（关联到记事本时请改用上面的命令）。
#
#  它回答三个问题：
#    1) 程序文件齐不齐、编码对不对
#    2) 默认端口 3099（以及 3080）被谁占着
#    3) 数据目录里到底有没有对话记录
# ============================================================
[CmdletBinding()]
param(
  [int]$Port = 3099
)

$ErrorActionPreference = 'Continue'
$root       = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$programDir = Join-Path $root '程序'
$exe        = Join-Path $programDir 'deepseek-harness.exe'
$sidecar    = Join-Path $programDir 'deepseek-harness-rg.exe'
$payload    = Join-Path $root 'start-dsh-web.ps1'
$dataHome   = Join-Path $env:LOCALAPPDATA 'DSH-Web'

function Section($t) { Write-Host ''; Write-Host "=== $t" -ForegroundColor Cyan }
function Ok($t)      { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Bad($t)     { Write-Host "  [问题] $t" -ForegroundColor Red }
function Info($t)    { Write-Host "  $t" }

Write-Host 'DSH Web 便携版诊断' -ForegroundColor White
Info "程序目录：$root"
Info "当前时间：$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')"

# ---------- 1. 程序文件 ----------
Section '1. 程序文件'
foreach ($f in @($exe, $sidecar)) {
  if (Test-Path -LiteralPath $f) {
    Ok ("{0}  ({1:N1} MB)" -f (Split-Path -Leaf $f), ((Get-Item -LiteralPath $f).Length / 1MB))
  } else {
    Bad "缺少 $(Split-Path -Leaf $f) —— 压缩包没解压完整，请重新完整解压"
  }
}

# 启动脚本必须是 UTF-8 with BOM，否则 PowerShell 5.1 会按 GBK 解码中文而解析失败
if (Test-Path -LiteralPath $payload) {
  $b = [System.IO.File]::ReadAllBytes($payload)
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) {
    Ok 'start-dsh-web.ps1 编码正常（UTF-8 with BOM）'
  } else {
    Bad 'start-dsh-web.ps1 缺少 BOM —— 双击「启动 DSH Web.cmd」会自动修好它'
  }
  $errs = $null
  [System.Management.Automation.Language.Parser]::ParseFile($payload, [ref]$null, [ref]$errs) | Out-Null
  if ($errs -and $errs.Count -gt 0) {
    Bad "启动脚本有 $($errs.Count) 处语法错误"
    $errs | Select-Object -First 5 | ForEach-Object { Info ("  第 {0} 行：{1}" -f $_.Extent.StartLineNumber, $_.Message) }
  } else {
    Ok '启动脚本语法正常'
  }
} else {
  Bad '缺少 start-dsh-web.ps1'
}

# ---------- 2. 端口占用 ----------
Section "2. 端口占用（默认 $Port）"
foreach ($p in @($Port, 3080) | Select-Object -Unique) {
  $line = netstat -ano | Select-String -Pattern "^\s*TCP\s+\S+:$p\s+\S+\s+LISTENING" | Select-Object -First 1
  if (-not $line) { Ok "端口 $p 空闲"; continue }
  $owner = if ("$line" -match '(\d+)\s*$') { [int]$Matches[1] } else { 0 }
  $name  = if ($owner) { try { (Get-Process -Id $owner -ErrorAction Stop).ProcessName } catch { '未知' } } else { '未知' }
  # 指纹：不带 token 访问根路径，DSH 的认证层固定回 401 + 一句话
  $isDsh = $false
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$p/" -UseBasicParsing -TimeoutSec 3 -MaximumRedirection 0 -ErrorAction SilentlyContinue
    if ($resp.StatusCode -eq 200) { $isDsh = $true }
  } catch {
    $r = $_.Exception.Response
    if ($r -ne $null -and [int]$r.StatusCode -eq 401) {
      try {
        $body = (New-Object System.IO.StreamReader($r.GetResponseStream())).ReadToEnd()
        if ($body -like '*dsh web authentication required*') { $isDsh = $true }
      } catch { }
    }
  }
  if ($isDsh) {
    Ok "端口 $p 被 DSH Web 占用（PID $owner，进程 $name）—— 属于正常情况，双击启动器只会再打开一次界面"
  } else {
    Bad "端口 $p 被**别的程序**占用：$name（PID $owner）—— 启动器会拒绝启动；关掉它或用 --port 换端口"
  }
}

# ---------- 3. 数据目录 ----------
Section '3. 数据目录与对话记录'
Info "数据目录：$dataHome"
if (-not (Test-Path -LiteralPath $dataHome)) {
  Bad '数据目录还不存在 —— 第一次成功启动后才会创建'
} else {
  $sessions = Join-Path $dataHome 'sessions'
  if (Test-Path -LiteralPath $sessions) {
    $dirs = Get-ChildItem -Force -Directory $sessions -ErrorAction SilentlyContinue
    if ($dirs -and $dirs.Count -gt 0) {
      $total = 0
      foreach ($d in $dirs) {
        $files = Get-ChildItem -Force -Recurse -File $d.FullName -ErrorAction SilentlyContinue
        $total += ($files | Measure-Object).Count
        Info ("  {0}  （{1} 个会话文件，最后改动 {2}）" -f $d.Name, ($files | Measure-Object).Count, $d.LastWriteTime)
      }
      Ok "共找到 $($dirs.Count) 个工作目录 / $total 个会话文件"
    } else {
      Bad 'sessions 目录是空的 —— 还没有任何对话记录'
    }
  } else {
    Bad '没有 sessions 目录 —— 还没有任何对话记录（或数据目录被清理过）'
  }
  $w = Join-Path $dataHome 'workspace'
  Info "固定工作目录：$w $(if (Test-Path -LiteralPath $w) { '(存在)' } else { '(不存在)' })"
  $log = Join-Path $dataHome 'logs\launcher.log'
  if (Test-Path -LiteralPath $log) {
    Info "上次启动日志：$log（最后改动 $((Get-Item -LiteralPath $log).LastWriteTime)）"
  }
}

# ---------- 4. 插件 ----------
# 这一节回答"插件装了但界面里没反应"：先看包内插件本身合不合格，
# 再和当前 profile 的登记情况对一遍。
Section '4. 插件'

$pluginRoot      = Join-Path $root '插件'
$profileDir      = Join-Path $dataHome 'profiles\web'
$profileManifest = Join-Path $profileDir 'package.json'
$nodeModulesDir  = Join-Path $profileDir 'node_modules'
# 启动器的记账文件：它装过哪些包（清理逻辑据此认领，不再靠包名前缀猜）
$recordsPath     = Join-Path $dataHome 'managed-plugins.json'
$pluginNames     = @()

if (-not (Test-Path -LiteralPath $pluginRoot)) {
  Info '程序目录里没有「插件」文件夹 —— 本包不含任何插件'
} else {
  $candidates = @()
  foreach ($child in (Get-ChildItem -LiteralPath $pluginRoot -Directory -Force -ErrorAction SilentlyContinue)) {
    if ($child.Name -like '@*') {
      $candidates += @(Get-ChildItem -LiteralPath $child.FullName -Directory -Force -ErrorAction SilentlyContinue)
    } else {
      $candidates += @($child)
    }
  }
  if ($candidates.Count -eq 0) { Info '「插件」文件夹是空的（没有任何子文件夹）' }

  foreach ($p in $candidates) {
    $mp = Join-Path $p.FullName 'package.json'
    if (-not (Test-Path -LiteralPath $mp)) { Bad "$($p.Name)：没有 package.json，启动时会被跳过"; continue }
    $m = $null
    try { $m = Get-Content -LiteralPath $mp -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    if ($null -eq $m) { Bad "$($p.Name)：package.json 不是合法 JSON，启动时会被跳过"; continue }
    $nm = if ($m.name) { [string]$m.name } else { $p.Name }
    if (-not $m.dsh -or -not $m.dsh.bundle -or -not $m.dsh.bundle.patch) {
      Bad "$nm ：未声明 dsh.bundle.patch，不会被装配（多半不是插件包）"
      continue
    }
    $notes = @()
    if ($m.dsh.client) {
      if (Test-Path -LiteralPath (Join-Path $p.FullName 'lib\client.js')) { $notes += '含界面部分' }
      else { $notes += '声明了界面部分，但缺 lib\client.js' }
    }
    $depCount = 0
    if ($m.dependencies) { $depCount = @($m.dependencies.PSObject.Properties.Name).Count }
    if ($depCount -gt 0) { $notes += '声明了 $depCount 个依赖（便携版不联网装依赖，可能不生效）' }
    Ok ("{0}    {1}" -f $nm, ($(if ($notes.Count -gt 0) { $notes -join '；' } else { '形态正常' })))
    $pluginNames += $nm
  }

  # 与当前 profile 的登记情况对账
  if (-not (Test-Path -LiteralPath $profileManifest)) {
    Info '还没生成 profile 清单 —— 先成功启动一次，再看这一节'
  } else {
    $listed = @()
    $mm = [regex]::Match((Get-Content -LiteralPath $profileManifest -Raw), '"bundles"\s*:\s*\[(?<body>[^\]]*)\]')
    if ($mm.Success) {
      foreach ($hit in [regex]::Matches($mm.Groups['body'].Value, '"([^"]+)"')) { $listed += $hit.Groups[1].Value }
    }
    # 名字可能带作用域（@scope/name，装在 node_modules\@scope\ 下），也可能不带
    # （装在 node_modules\ 顶层）—— 落点由包名决定，这里必须按同样的规则回推，
    # 否则不带作用域的插件（例如 dsh-whale-widget）会被误报成"已登记但文件不在"。
    #
    # 哪些条目算"随包插件"：包内插件名 + 启动器记账文件里的名字。刻意**不按
    # @dsh-external/ 前缀判定** —— 那是名字，不是所有权，用户自己装的包也可能用
    # 这个作用域，按前缀判定会把它误报成"随包插件"。
    $recordedNames = @()
    if (Test-Path -LiteralPath $recordsPath) {
      try {
        $rec = Get-Content -LiteralPath $recordsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($rec -and $rec.plugins) { $recordedNames = @($rec.plugins | Where-Object { $_ -is [string] -and $_ -ne '' }) }
      } catch { }
      if ($recordedNames.Count -eq 0) { Info "记账文件读取不到内容：$recordsPath（重启一次会自动重建）" }
    } else {
      Info '还没有插件记账文件（managed-plugins.json）—— 成功启动一次后才会生成'
    }
    $registered = @($listed | Where-Object { $pluginNames -contains $_ -or $recordedNames -contains $_ })
    if ($registered.Count -eq 0) {
      Info 'profile 清单里没有随包插件条目 —— 启动器还没登记过（成功启动一次即可）'
    }
    foreach ($n in $registered) {
      $parts = $n.Split('/')
      $link = if ($parts.Count -eq 2 -and $parts[0] -like '@*') { Join-Path $nodeModulesDir ($parts[0] + '\' + $parts[1]) } else { Join-Path $nodeModulesDir $n }
      if (Test-Path -LiteralPath (Join-Path $link 'package.json')) {
        $it = Get-Item -LiteralPath $link -Force
        $how = if ($it.LinkType) { $it.LinkType } else { '已复制' }
        Ok "$n 已装入 profile（$how）"
      } else {
        Bad "$n 已登记但文件不在 —— 这会让界面起不来。处理：删除 profile 清单里该条目，或重启一次让启动器自动清理"
      }
    }
    # 把"用户自己装的"和"随包的"分开列，避免以后又靠名字猜
    $others = @($listed | Where-Object { $pluginNames -notcontains $_ -and $recordedNames -notcontains $_ })
    if ($others.Count -gt 0) {
      Info ("非随包条目（你自己的 dsh plugin add 装的，启动器不会动它）：{0}" -f ($others -join '、'))
    }
  }
}

Write-Host ''
Write-Host '诊断结束。以上没有 [问题] 就说明程序侧是好的；' -ForegroundColor White
Write-Host '若界面仍打不开，请把本窗口内容连同 logs\launcher.log 一起发出来。' -ForegroundColor White
Write-Host ''