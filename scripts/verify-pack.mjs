/**
 * DSH Web 便携包 —— 分发产物校验（在 build-portable.ps1 之后跑）
 * ============================================================
 * 校验对象是**构建产物**，不是仓库源码：
 *   <OutputRoot>\DSH-Web.zip   ← 分发给别人的那个包
 *   <OutputRoot>\DSH-Web\      ← 装配出来的目录
 *
 * 用法（在仓库根目录）：
 *   node scripts/verify-pack.mjs
 *   node scripts/verify-pack.mjs --output D:\some\where   # 指定产物目录
 *   node scripts/verify-pack.mjs --archive                # 校验通过后归档到 版本记录\
 *
 * 全部路径都由脚本自身位置推出，不含任何开发机绝对路径。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

/** 解析 --key value / --key=value，其余为位置参数。 */
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const eq = a.indexOf('=')
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue }
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++ } else { out[key] = true }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const outputRoot = resolve(args.output ?? join(dirname(repoRoot), 'portable'))
const zip = join(outputRoot, 'DSH-Web.zip')
const root = join(outputRoot, 'DSH-Web')
const assetsPlugins = join(repoRoot, 'assets', '插件')
const archiveDir = join(outputRoot, 'dsh便携版版本记录')
const version = String(args.version ?? 'v1.3.0')
const expectVersionSection = `【${version}】`

if (!existsSync(zip)) {
  console.error(`找不到分发包：${zip}\n  先跑 build-portable.ps1，或用 --output 指定产物目录。`)
  process.exit(2)
}
if (!existsSync(root)) {
  console.error(`找不到装配目录：${root}`)
  process.exit(2)
}

const sha = (b) => createHash('sha256').update(b).digest('hex').toUpperCase()
const shaFile = (p) => sha(readFileSync(p))

let bad = 0
const check = (ok, label, extra = '') => {
  if (!ok) bad++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `  ${extra}`}`)
}

/** tar 列表/解包：Windows 自带 tar 输出中文名用系统代码页（GBK），必须按 GBK 解。 */
const tarOut = (a) => execFileSync('tar', a, { maxBuffer: 256 * 1024 * 1024 })
const tarText = (a) => new TextDecoder('gbk').decode(tarOut(a)).split(/\r?\n/).filter(Boolean)

const names = tarText(['-tf', zip])
// tar 的列表里目录项带结尾斜杠；只保留文件项，否则会被当成"清单外的多余文件"
const posix = names.map((n) => n.replace(/\\/g, '/')).filter((n) => n !== '' && !n.endsWith('/'))
const entryOf = (suffix) => posix.find((n) => n.endsWith(suffix))
const readEntry = (suffix) => {
  const e = entryOf(suffix)
  if (!e) return null
  return tarOut(['-xOf', zip, e])
}

console.log(`仓库：${repoRoot}`)
console.log(`产物：${outputRoot}`)
console.log(`zip ：${names.length} 条目 / ${(statSync(zip).size / 1048576).toFixed(1)} MB`)

// ---------- 1) 随包文件齐全 ----------
console.log('\n--- 1) 随包文件齐全 ---')
for (const f of ['启动 DSH Web.cmd', 'start-dsh-web.ps1', '使用说明.txt', '诊断.ps1', '版本更新记录.txt']) {
  check(Boolean(entryOf(`/${f}`)) || Boolean(entryOf(f)), `包内有 ${f}`)
}
for (const f of ['notices/LICENSE-deepseek-harness.txt', 'notices/THIRD_PARTY_NOTICES.md']) {
  check(Boolean(entryOf(f)), `包内有 ${f}（再分发必需的许可声明）`)
}
check(Boolean(entryOf('程序/deepseek-harness.exe')), '包内有 程序/deepseek-harness.exe')
check(Boolean(entryOf('程序/deepseek-harness-rg.exe')), '包内有 程序/deepseek-harness-rg.exe')

// ---------- 2) 载荷脚本带 BOM ----------
console.log('\n--- 2) 载荷脚本带 UTF-8 BOM ---')
const hasBom = (p) => {
  if (!existsSync(p)) return false
  const b = readFileSync(p)
  return b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
}
for (const f of ['start-dsh-web.ps1', '诊断.ps1']) {
  check(hasBom(join(root, f)), `DSH-Web\\${f} 带 BOM`)
  check(hasBom(join(repoRoot, 'assets', f)), `assets\\${f} 带 BOM（源头）`)
}

// ---------- 3) 插件：以 assets\插件 为完整清单，逐个核对 ----------
console.log('\n--- 3) 包内插件 == assets\\插件（逐个文件哈希） ---')
const listFiles = (dir, base = dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, base, out)
    else out.push(full.slice(base.length + 1).replace(/\\/g, '/'))
  }
  return out
}
if (!existsSync(assetsPlugins)) {
  check(false, 'assets\\插件 存在')
} else {
  const expect = listFiles(assetsPlugins).sort()
  const inZip = posix.filter((n) => n.includes('/插件/')).map((n) => n.slice(n.indexOf('/插件/') + '/插件/'.length)).sort()
  const missing = expect.filter((f) => !inZip.includes(f))
  const extra = inZip.filter((f) => !expect.includes(f))
  check(missing.length === 0, `${expect.length} 个插件文件都在包里`, missing.length ? `缺：${missing.join(', ')}` : '')
  check(extra.length === 0, '包里没有清单外的插件文件', extra.length ? `多：${extra.join(', ')}` : '')
  for (const rel of expect) {
    const a = readEntry(`/插件/${rel}`)
    if (a === null) continue
    const b = readFileSync(join(assetsPlugins, rel))
    check(Buffer.compare(a, b) === 0, `插件/${rel} 逐字节一致（${b.length} B）`)
  }
}

// ---------- 4) 包内记录与实际文件对得上 ----------
console.log('\n--- 4) 版本更新记录 与实际文件对得上 ---')
const recordRaw = readEntry('/版本更新记录.txt')
if (!recordRaw) {
  check(false, '包内有 版本更新记录.txt')
} else {
  const record = recordRaw.toString('utf8')
  check(record.includes(expectVersionSection), `记录里有 ${expectVersionSection} 一节`)
  check(record.includes('dsh-prompt-compare'), '记录里写了「提示词对照」插件包名')
  check(record.includes('「提示词对照」'), '记录里写了中文名「提示词对照」')
  // 未回填的指纹占位符：产物里出现就说明忘了跑 update-record-hashes.mjs
  const unfilled = record.match(/__SHA256:[^_]+?__/g)
  check(!unfilled, '记录里的指纹都已回填（没有 __SHA256:…__ 占位符）', unfilled ? `剩 ${unfilled.length} 处` : '')
  const recorded = new Set(record.toUpperCase().match(/\b[0-9A-F]{64}\b/g) ?? [])
  // 注意：这里刻意**不校验 版本更新记录.txt 自己的哈希** —— 记录里写着所有文件的
  // 指纹，包括它自己，那是自指、算不出来。记录的完整性由 build-portable.ps1 的
  // "回填后不得残留占位符" 那一步来守。
  for (const rel of ['start-dsh-web.ps1', '诊断.ps1', '使用说明.txt', '启动 DSH Web.cmd', '程序/deepseek-harness.exe']) {
    const p = join(root, ...rel.split('/'))
    if (!existsSync(p)) continue
    const h = shaFile(p)
    check(recorded.has(h), `记录里有 ${rel} 的 SHA256（${h.slice(0, 12)}…）`)
  }
}

// ---------- 5) 包内文档口径一致 ----------
console.log('\n--- 5) 文档口径一致 ---')
const manual = readEntry('/使用说明.txt')?.toString('utf8') ?? ''
for (const w of ['人设', '剧本批注', '提示词对照', '小鲸鱼余额挂件']) check(manual.includes(w), `使用说明提到「${w}」`)
check(manual.includes('自带四个插件'), '使用说明写的是"自带四个插件"')
const launcher = readEntry('/start-dsh-web.ps1')?.toString('utf8') ?? ''
check(launcher.includes('四个'), '启动器失败提示也写了四个插件')

// ---------- 6) zip 内与装配目录逐字节一致 ----------
console.log('\n--- 6) zip 内 == DSH-Web\\ ---')
for (const f of ['start-dsh-web.ps1', '诊断.ps1', '使用说明.txt', '版本更新记录.txt', '启动 DSH Web.cmd']) {
  const a = readEntry(`/${f}`)
  const p = join(root, f)
  if (a === null || !existsSync(p)) { check(false, f); continue }
  check(Buffer.compare(a, readFileSync(p)) === 0, f)
}

console.log(`\n${bad === 0 ? '校验：全部通过' : `校验：${bad} 项未通过`}`)
if (bad !== 0) process.exit(1)

// ---------- 7) 归档 ----------
if (!args.archive) {
  console.log(`\n（未归档。加 --archive 可复制一份到 ${archiveDir}\\DSH-Web-${version}.zip）`)
  process.exit(0)
}
console.log(`\n--- 7) 归档到 dsh便携版版本记录\\ ---`)
// 先记下源的大小与哈希，复制后再和副本比 —— 直接比源副本会把"复制到自身"也判成通过
const srcSize = statSync(zip).size
const srcHash = shaFile(zip)
const target = join(archiveDir, `DSH-Web-${version}.zip`)
copyFileSync(zip, target)
check(statSync(target).size === srcSize, `副本大小与源一致（${(srcSize / 1048576).toFixed(1)} MB）`)
check(shaFile(target) === srcHash, '副本 SHA256 与源一致')
console.log('  该目录现有（旧包一律保留）：')
for (const f of readdirSync(archiveDir).sort()) {
  console.log(`    ${String((statSync(join(archiveDir, f)).size / 1048576).toFixed(1)).padStart(6)} MB  ${f}`)
}
process.exit(bad === 0 ? 0 : 1)
