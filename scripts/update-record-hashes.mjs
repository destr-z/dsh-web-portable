/**
 * 版本更新记录.txt —— 指纹回填 / 校验
 * ============================================================
 * 记录里手抄的 SHA256 有个老毛病：改了随包文件就全部作废，而人肉重算
 * 34 个 64 位十六进制字符串必然出错。所以改成"占位符 + 自动回填"：
 *
 *   记录里要写指纹的地方写成占位符：
 *     __SHA256:start-dsh-web.ps1__
 *     __SHA256:程序/deepseek-harness.exe__
 *     __SHA256:插件/@dsh-external/dsh-novel-script/lib/index.js__
 *
 * 用法（在仓库根目录）：
 *   node scripts/update-record-hashes.mjs --output ..\portable   # 回填（写 assets\版本更新记录.txt）
 *   node scripts/update-record-hashes.mjs --output ..\portable --check   # 只校验，不改文件
 *
 * 注意：这是**发布步骤**，不是提交步骤 —— 它读的是装配好的产物目录，
 * 产物需要 exe，而 exe 不进仓库。所以仓库里的记录可能带着未回填的占位符，
 * 这是正常的；`--check` 会明确告诉你还剩几个没填。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const recordPath = join(repoRoot, 'assets', '版本更新记录.txt')

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
const pkgRoot = join(outputRoot, 'DSH-Web')
const checkOnly = Boolean(args.check)

if (!existsSync(recordPath)) {
  console.error(`找不到记录文件：${recordPath}`)
  process.exit(2)
}
if (!existsSync(pkgRoot)) {
  console.error(`找不到装配目录：${pkgRoot}\n  回填指纹需要先跑 build-portable.ps1，或用 --output 指定产物目录。`)
  process.exit(2)
}

const shaFile = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase()
const record = readFileSync(recordPath, 'utf8')
const slotPattern = /__SHA256:([^_]+?)__/g
const slots = [...record.matchAll(slotPattern)].map((m) => m[1])

if (slots.length === 0) {
  console.log('记录里没有占位符，无需回填。')
  process.exit(0)
}

const resolved = new Map()
const missing = []
for (const rel of [...new Set(slots)]) {
  const p = join(pkgRoot, ...rel.split('/'))
  if (!existsSync(p)) { missing.push(rel); continue }
  resolved.set(rel, shaFile(p))
}

console.log(`记录文件：${recordPath}`)
console.log(`产物目录：${pkgRoot}`)
console.log(`占位符：${slots.length} 处 / 去重后 ${new Set(slots).size} 个文件`)

if (missing.length > 0) {
  console.error('\n产物里找不到这些文件，无法回填：')
  for (const m of missing) console.error(`  · ${m}`)
  console.error('\n（exe 那类文件只有在真正打包过之后才存在 —— 先跑 build-portable.ps1）')
  process.exit(1)
}

for (const [rel, hash] of resolved) console.log(`  ${hash.slice(0, 16)}…  ${rel}`)

if (checkOnly) {
  const stillThere = record.match(slotPattern)
  console.log(`\n--check：${stillThere ? `${stillThere.length} 处占位符尚未回填（这是仓库内的正常状态，发布前记得回填）` : '已全部回填'}`)
  process.exit(0)
}

let filled = 0
const updated = record.replace(slotPattern, (whole, rel) => {
  const hash = resolved.get(rel)
  if (!hash) return whole
  filled++
  return hash
})
writeFileSync(recordPath, updated, 'utf8')
console.log(`\n已回填 ${filled} 处指纹到 ${recordPath}`)

// 坑：记录文件本身也在包里，回填会改它的内容 —— 而产物里那份还是旧内容。
// 提交前把"产物里的记录"和"回填后的源记录"对一下，不一致就明确提醒，
// 免得带着旧记录发出去（别人一核对指纹就对不上）。
const packagedRecord = join(pkgRoot, '版本更新记录.txt')
if (existsSync(packagedRecord)) {
  const same = readFileSync(packagedRecord, 'utf8') === updated
  if (same) {
    console.log('产物里的记录已与源记录一致。')
  } else {
    console.log('注意：产物里的 版本更新记录.txt 与回填后的源记录**不一致**。')
    console.log('      重新打包（build-portable.ps1 -ReuseExe）后，再跑一次本脚本与 verify-pack.mjs。')
  }
}
