/**
 * Scan the staged exe runtime tree for @deepseek-ai imports that cannot resolve
 * inside that tree — i.e. packages missing from the single-file executable VFS.
 *
 * 用法：node scripts/vfs-gap-check.mjs <staged runtime 目录>
 *   staged 目录 = <deepseek-harness>/python/sdk-runtime/src/deepseek_harness_runtime/runtime/node
 *   build-portable.ps1 会自己算好这个路径并传进来；这里刻意**不留硬编码默认值** ——
 *   否则换台机器跑会去扫一个不存在的目录，"扫描通过"就成了假阳性。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

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

/** Collect every .js/.cjs/.mjs under a directory, skipping deep test fixtures. */
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

/** Every @deepseek-ai package name that exists in the staged tree. */
function installedPackages() {
  const names = new Set()
  const scope = join(modules, '@deepseek-ai')
  if (existsSync(scope)) {
    for (const entry of readdirSync(scope, { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isSymbolicLink()) names.add(entry.name)
    }
  }
  return names
}

const specifierPattern = /(?:from\s*|require\(\s*|import\(\s*)["'](@deepseek-ai\/[^"']+)["']/g

const available = installedPackages()
console.log('staged @deepseek-ai packages:', available.size)

const files = []
collectFiles(join(modules, '@deepseek-ai'), files)
console.log('scanning js files:', files.length)

/** packageName -> Set(files referencing it) */
const missing = new Map()

for (const file of files) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  if (!text.includes('@deepseek-ai/')) continue
  for (const match of text.matchAll(specifierPattern)) {
    const parts = match[1].split('/')
    const name = `${parts[0]}/${parts[1]}`
    if (available.has(parts[1])) continue
    if (!missing.has(name)) missing.set(name, new Set())
    missing.get(name).add(file.replace(stage, '').replace(/\\/g, '/'))
  }
}

console.log('\n=== MISSING PACKAGES ===')
if (missing.size === 0) console.log('(none)')
for (const [name, refs] of [...missing].sort()) {
  const list = [...refs]
  console.log(`\n${name}   (${list.length} file(s) reference it)`)
  for (const ref of list.slice(0, 4)) console.log('   ', ref)
}
console.log('\nTOTAL MISSING =', missing.size)
