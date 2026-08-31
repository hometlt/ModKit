import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const BANNED =
  /(?:productExtensionDirectory|externalRepositoryRoot|starcraft|warzone|blizzard|sc2|\bspring\b|\bcnc3?\b|tiberium|red[ -]alert|modkit-(?:blizzard|warzone|extensions-(?:ea|spring|other))|MODKIT_(?:BLIZZARD|WARZONE)|extensions(?:[\\/]|['"]\s*,\s*['"])(?:ea|mk2|opensource)(?:[\\/]|['"]))/iu

const SOURCE_SUFFIX = /\.(?:[cm]?[jt]s|json|ya?ml)$/iu
const normalized = path => path.replaceAll('\\', '/')
const isCurrentExecutable = path => {
  const portable = normalized(path)
  if (!SOURCE_SUFFIX.test(portable)) return false
  if (/\/(?:node_modules|dist|dist-app|coverage|migration\/history)\//u.test(portable)) return false
  // Compatibility fixtures and assertions may name the historical/external values they prove.
  // They are evidence, not knowledge used by the current runtime or product composition.
  if (/\/(?:test|tests|__tests__)\//u.test(portable)) return false
  if (/\.(?:spec|test)\.[cm]?[jt]s$/u.test(portable)) return false
  if (/\/scripts\/migration\//u.test(portable)) return false
  if (/\/scripts\/test\/fixtures\/migration-registry\//u.test(portable)) return false
  if (portable.endsWith('/scripts/test/migration-registry.test.ts')) return false
  if (portable.endsWith('/scripts/convert-mk2.mjs')) return false
  // This isolated SDK seam only canonicalizes persisted pre-rename identifiers. New extension
  // discovery and capability selection remain entirely manifest/VFS driven.
  if (portable.endsWith('/packages/sdk/src/identity.ts')) return false
  // The policy implementation and its deliberate negative fixture spell the tokens they reject.
  if (portable.endsWith('/scripts/check-external-composition.mjs')) return false
  if (portable.endsWith('/scripts/test/external-composition-boundary.test.ts')) return false
  return true
}

function currentFiles(root) {
  const files = []
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'dist-app', 'coverage'].includes(entry.name)) continue
        walk(path)
      } else if (isCurrentExecutable(path)) files.push(path)
    }
  }
  for (const directory of ['apps', 'packages', 'scripts', 'config']) walk(resolve(root, directory))
  return files.sort()
}

export function externalCompositionViolations(files, read = path => readFileSync(path, 'utf8')) {
  return files.filter(path => BANNED.test(read(path))).sort()
}

export function checkExternalComposition(root = repoRoot) {
  const candidates = currentFiles(root)
  const violations = externalCompositionViolations(candidates)
  if (violations.length > 0) {
    throw new Error(
      `core runtime/config/release contains concrete external knowledge:\n${violations.join('\n')}`,
    )
  }
  return { checked: candidates.length }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkExternalComposition()
  console.log(`external composition boundary ok (${result.checked} files)`)
}
