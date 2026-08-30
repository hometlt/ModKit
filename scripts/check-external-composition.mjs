import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const BANNED =
  /(?:blizzard|warzone|starcraft|\bspring\b|modkit-(?:blizzard|warzone)|MODKIT_(?:BLIZZARD|WARZONE)|extensions\/(?:ea|mk2|opensource)\/)/iu

export function externalCompositionViolations(files, read = path => readFileSync(path, 'utf8')) {
  return files.filter(path => BANNED.test(read(path))).sort()
}

export function checkExternalComposition(root = repoRoot) {
  const candidates = [
    'scripts/app-extension-sets.mjs',
    'scripts/debug/app-runner.mjs',
    'scripts/debug/pwa-server.mjs',
    'scripts/release/rc.mjs',
    'scripts/release/INSTALL.md',
    'config/build-composition.json',
    'vitest.config.ts',
    'vitest.fast.config.ts',
    'apps/mcp/README.md',
    'apps/vscode/PACKAGING.md',
  ].map(path => resolve(root, path))
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
