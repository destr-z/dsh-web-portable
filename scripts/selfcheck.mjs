/**
 * 仓库离线自检（不需要 exe，不需要 harness 源码）
 * ============================================================
 * 检查那些"改坏了要等用户机上才炸"的东西：
 *   1. 插件清单可解析、声明齐、文件在、不带运行时依赖
 *   2. 载荷 .ps1 带 UTF-8 BOM（少了它，中文 Windows 上启动器必挂）
 *   3. 启动 .cmd 保持纯 ASCII（cmd.exe 按代码页读批处理内容）
 *   4. 仓库里没有开发机绝对路径
 *   5. 随包文件齐全、许可声明齐全
 *
 * 用法（在仓库根目录）：
 *   node scripts/selfcheck.mjs
 *   pwsh -File scripts/selfcheck.ps1     # 另加 AST 语法检查（更彻底，需要 PowerShell）
 *
 * 通过 = 退出码 0。语法层面请配合 scripts/selfcheck.ps1。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const assets = join(repoRoot, 'assets')
const pluginsRoot = join(assets, '插件')

let bad = 0
const check = (ok, label, extra = '') => {
  if (!ok) bad++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `  ${extra}`}`)
}
const section = (t) => console.log(`\n--- ${t} ---`)

const read = (p) => readFileSync(p, 'utf8')
const hasBom = (p) => {
  const b = readFileSync(p)
  return b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
}

console.log(`仓库根目录：${repoRoot}`)

// ---------- 1) 随包文件 ----------
section('1) 随包文件')
const assetsExpected = ['启动 DSH Web.cmd', 'start-dsh-web.ps1', '使用说明.txt', '诊断.ps1', '版本更新记录.txt']
for (const f of assetsExpected) check(existsSync(join(assets, f)), `assets/${f}`)
for (const f of ['notices/LICENSE-deepseek-harness.txt', 'notices/THIRD_PARTY_NOTICES.md']) {
  check(existsSync(join(repoRoot, f)), f, '（再分发 exe 必需的许可声明）')
}

// ---------- 2) .ps1 必须带 BOM ----------
section('2) 载荷脚本带 UTF-8 BOM')
for (const f of ['start-dsh-web.ps1', '诊断.ps1']) {
  const p = join(assets, f)
  if (!existsSync(p)) { check(false, `assets/${f}`); continue }
  check(hasBom(p), `assets/${f} 带 BOM`, hasBom(p) ? '' : '← 少了它，中文 Windows 上启动器必挂')
}

// ---------- 3) .cmd 必须纯 ASCII ----------
section('3) 启动 .cmd 保持纯 ASCII')
const cmdPath = join(assets, '启动 DSH Web.cmd')
if (existsSync(cmdPath)) {
  const buf = readFileSync(cmdPath)
  const nonAscii = [...buf].filter((b) => b > 0x7f).length
  check(nonAscii === 0, '启动 DSH Web.cmd 全为 ASCII', nonAscii ? `含 ${nonAscii} 个非 ASCII 字节` : '')
} else {
  check(false, '启动 DSH Web.cmd 存在')
}

// ---------- 4) 插件清单 ----------
section('4) 插件清单')
if (!existsSync(pluginsRoot)) {
  check(false, 'assets/插件 存在')
} else {
  const candidates = []
  for (const top of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!top.isDirectory()) continue
    if (top.name.startsWith('@')) {
      for (const sub of readdirSync(join(pluginsRoot, top.name), { withFileTypes: true })) {
        if (sub.isDirectory()) candidates.push(join(pluginsRoot, top.name, sub.name))
      }
    } else {
      candidates.push(join(pluginsRoot, top.name))
    }
  }
  check(candidates.length > 0, `找到插件目录 ${candidates.length} 个`)
  for (const dir of candidates) {
    const label = dir.slice(pluginsRoot.length + 1).replace(/\\/g, '/')
    const mf = join(dir, 'package.json')
    if (!existsSync(mf)) { check(false, `${label}：有 package.json`); continue }
    let m
    try { m = JSON.parse(read(mf)) } catch (e) { check(false, `${label}：package.json 可解析`, e.message); continue }
    check(true, `${label}：package.json 可解析（${m.name ?? '无 name'}）`)
    check(Boolean(m.name), `${label}：声明了 name`)
    check(Boolean(m.dsh?.bundle?.patch), `${label}：声明了 dsh.bundle.patch`)
    const patchRel = String(m.dsh?.bundle?.patch ?? '').replace(/^\.\//, '')
    check(patchRel !== '' && existsSync(join(dir, ...patchRel.split('/'))), `${label}：patch 文件存在（${patchRel}）`)
    const deps = Object.keys(m.dependencies ?? {})
    check(deps.length === 0, `${label}：没有运行时 dependencies（便携包不装依赖）`, deps.join(', '))
    if (m.description) {
      check(!/对照原文与剧本/.test(m.description) || /novel-script/.test(m.name), `${label}：description 与包名相符`, m.description)
    }
    if (m.dsh?.client) {
      const clientRel = typeof m.exports?.['./client'] === 'string'
        ? m.exports['./client']
        : (m.exports?.['./client']?.import ?? 'lib/client.js')
      check(existsSync(join(dir, ...String(clientRel).replace(/^\.\//, '').split('/'))), `${label}：dsh.client 的浏览器半边存在`)
    }
    // files 字段是否覆盖实际存在的 lib 子目录（漏了会导致 npm 打包缺文件）
    if (Array.isArray(m.files) && existsSync(join(dir, 'lib'))) {
      const shared = join(dir, 'lib', 'shared')
      if (existsSync(shared)) {
        const covered = m.files.some((g) => g.startsWith('lib/shared'))
        check(covered, `${label}：files 覆盖 lib/shared（实际存在该目录）`)
      }
    }
    check(existsSync(join(dir, 'LICENSE')), `${label}：有 LICENSE 文件`)
  }
}

// ---------- 5) 不得残留开发机绝对路径 ----------
section('5) 无开发机绝对路径')
// 模式本身拼出来，别让本文件里的字面量把自己判成命中（自检脚本的自指问题）
const drive = 'D' + ':' + '\\' + '001' + '\\'
const suspicious = [
  new RegExp(drive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  /\/001\/ai\//i,
  /C:\\Users\\[A-Za-z0-9._-]+/i,
]
// 自检脚本自己要写这些模式，跳过它们
const selfFiles = new Set(['selfcheck.mjs', 'selfcheck.ps1'])
const scanTargets = []
const walk = (dir, filter, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, filter, out)
    else if (filter(p)) out.push(p)
  }
  return out
}
scanTargets.push(...walk(repoRoot, (p) => /\.(?:ps1|mjs|js|json|md|txt|cmd|yml|yaml)$/i.test(p)))
let hits = 0
let scanned = 0
for (const p of scanTargets) {
  if (selfFiles.has(p.slice(repoRoot.length + 1).split(/[\\/]/).pop())) continue
  scanned++
  const text = read(p)
  for (const re of suspicious) {
    const m = text.match(re)
    if (m) {
      hits++
      console.log(`  FAIL  ${p.slice(repoRoot.length + 1)}：命中 ${re} → ${m[0]}`)
    }
  }
}
check(hits === 0, `仓库内脚本/文档无开发机绝对路径（扫了 ${scanned} 个文件）`)

// ---------- 6) .cmd / .ps1 换行与体积 ----------
section('6) 换行与体积')
const cmdBuf = existsSync(cmdPath) ? readFileSync(cmdPath, 'utf8') : ''
check(cmdBuf.includes('\r\n'), '启动 DSH Web.cmd 使用 CRLF 换行', cmdBuf.includes('\r\n') ? '' : '← cmd.exe 上建议 CRLF')
const totalBytes = walk(repoRoot, () => true).filter((p) => !p.includes('.git')).reduce((n, p) => n + statSync(p).size, 0)
check(totalBytes < 20 * 1024 * 1024, `仓库文本总量 ${(totalBytes / 1048576).toFixed(2)} MB（应远小于 exe）`)

console.log(`\n${bad === 0 ? '自检：全部通过' : `自检：${bad} 项未通过`}`)
if (bad === 0) console.log('提示：语法层面再跑一次  pwsh -File scripts/selfcheck.ps1')
process.exit(bad === 0 ? 0 : 1)
