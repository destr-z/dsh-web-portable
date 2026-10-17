/**
 * Scan the staged exe runtime tree for @deepseek-ai imports that cannot resolve
 * inside that tree — i.e. packages missing from the single-file executable VFS.
 *
 * 用法：node scripts/vfs-gap-check.mjs <staged runtime 目录>
 *   staged 目录 = <deepseek-harness>/python/sdk-runtime/src/deepseek_harness_runtime/runtime/node
 *   build-portable.ps1 会自己算好这个路径并传进来；这里刻意**不留硬编码默认值** ——
 *   否则换台机器跑会去扫一个不存在的目录，"扫描通过"就成了假阳性。
 *
 * 判定规则（0.2.x 起）：
 *   · **按文件真实解析**：从引用方所在目录逐级向上找 `node_modules/<包名>/package.json`。
 *     只判"整棵树的某个角落有没有这个包"是不够的 —— 0.2.1 就出现过
 *     `dsh-api-workspace-controller` 引 `dsh-host-directory-picker`，包只存在于两个
 *     picker 后端各自的 node_modules 里，从 workspace-controller 那里**解析不到**，
 *     运行时表现是 `workspace-controller: failed to import`（选不了工作区）。
 *   · 跳过浏览器半边：`lib/client.js`、`lib/types/**` 里的 import 是给浏览器/类型检查的，
 *     由前端 bundle 提供，不经过 Node 解析。
 *   · 故意不分发的官方运行时（LibreOffice）进豁免名单：office-to-pdf 的缺失是已知边界，
 *     见包内「版本更新记录」。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const stage = process.argv[2]
if (!stage) {
  console.error('用法：node scripts/vfs-gap-check.mjs <staged runtime 目录>')
  process.exit(2)
}
if (!existsSync(stage)) {
  console.error(`staged 运行时目录不存在：${stage}`)
  process.exit(2)
}
const modules = join(stage, 'node_modules')

/**
 * 已知不随包分发的运行时依赖（缺了是预期行为，不算缺口）。
 * 只放"官方资源目录、体积过大、故意不带"这一类；真正的漏包不要往这里加。
 */
const EXPECTED_ABSENT = new Set([
  '@deepseek-ai/libreoffice-kit',
])

/** Collect every runtime .js/.cjs/.mjs under a directory, skipping deep test fixtures. */
function collectFiles(dir, out, depth = 0) {
  if (depth > 12) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(path, out, depth + 1)
    else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) out.push(path)
  }
}

/** 浏览器半边 / 类型声明：不参与 Node 解析。 */
function isBrowserSide(file) {
  const p = file.replace(/\\/g, '/')
  return /\/lib\/types\//.test(p) || /\/client\.js$/.test(p) || /\/lib\/client\.[^/]*\.js$/.test(p)
}

/** Node 风格解析：从引用文件所在目录向上找 node_modules。 */
function resolvePackage(fromFile, name) {
  let cur = dirname(fromFile)
  for (;;) {
    const candidate = join(cur, 'node_modules', ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(cur)
    if (parent === cur) return undefined
    cur = parent
  }
}

const specifierPattern = /(?:from\s*|require\(\s*|import\(\s*)["'](@deepseek-ai\/[^"']+)["']/g

const files = []
collectFiles(join(modules, '@deepseek-ai'), files)
const runtimeFiles = files.filter((file) => !isBrowserSide(file))
console.log('scanning runtime js files:', runtimeFiles.length, `/ ${files.length} total`)

/** packageName -> Set(files referencing it) */
const missing = new Map()
const allowed = new Map()

for (const file of runtimeFiles) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  if (!text.includes('@deepseek-ai/')) continue
  for (const match of text.matchAll(specifierPattern)) {
    const parts = match[1].split('/')
    const name = `${parts[0]}/${parts[1]}`
    if (resolvePackage(file, name) !== undefined) continue
    const bucket = EXPECTED_ABSENT.has(name) ? allowed : missing
    if (!bucket.has(name)) bucket.set(name, new Set())
    bucket.get(name).add(file.replace(stage, '').replace(/\\/g, '/'))
  }
}

console.log('\n=== MISSING PACKAGES ===')
if (missing.size === 0) console.log('(none)')
for (const [name, refs] of [...missing].sort()) {
  const list = [...refs]
  console.log(`\n${name}   (${list.length} file(s) reference it)`)
  for (const ref of list.slice(0, 4)) console.log('   ', ref)
}
if (allowed.size > 0) {
  console.log('\n=== EXPECTED (not shipped on purpose) ===')
  for (const name of [...allowed].sort()) console.log('  ', name)
}
console.log('\nTOTAL MISSING =', missing.size)
