/**
 * Emit `packages/extensions-linked` — the first-party extensions as statically importable modules.
 *
 *   node scripts/emit-linked-extensions.mjs           regenerate
 *   node scripts/emit-linked-extensions.mjs --check   fail if the committed output is stale
 *
 * The dynamic lane loads extension *directories* at runtime (verified, worker-executed). This
 * package is the static lane the owner asked for: `import { images } from '@modkitx-x3/extensions'`
 * hands an application the same contributions as data plus the entrypoint modules as real ESM
 * imports, so a bundler follows them and the whole extension lands inside the application bundle.
 * Trust model and execution rules live in `packages/host/src/linked.ts`; this script only
 * transcribes what the authored extensions declare:
 *
 *  - a contribution keeps exactly its `trusted-in-process` variants (linked code runs in-process
 *    by definition — the import was the trust decision);
 *  - a contribution with variants but no trusted one is EXCLUDED with its reason, verbatim in the
 *    generated module, so `images.excluded` says "png-encoder-writer: no trusted-in-process
 *    variant" instead of the writer silently vanishing;
 *  - data-only contributions (no variants) pass through unchanged.
 *
 * Digests are computed here, over the canonical JSON of exactly what is inlined, so the generated
 * data carries real digests without the runtime needing a hash function.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageDir = join(root, 'packages', 'extensions-linked')
const outDir = join(packageDir, 'generated')
const check = process.argv.includes('--check')

/** Key-sorted JSON — stable across runs, which is all these digests promise. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const sha256 = text => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`

const identifier = id =>
  id
    .replace(/-([a-z0-9])/gu, (_match, letter) => letter.toUpperCase())
    .replace(/[^A-Za-z0-9_]/gu, '')

function readExtension(dir) {
  const packageJson = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const modkit = packageJson.modkit
  if (modkit === undefined) return undefined
  const contributionsDir = join(dir, 'contributions')
  const paths = existsSync(contributionsDir)
    ? readdirSync(contributionsDir)
        .filter(name => name.endsWith('.json'))
        .sort()
    : []
  const contributions = []
  const excluded = []
  const entrypoints = new Set()
  for (const name of paths) {
    const path = `contributions/${name}`
    const manifest = JSON.parse(readFileSync(join(dir, path), 'utf8'))
    const variants = Array.isArray(manifest.runtimeVariants) ? manifest.runtimeVariants : undefined
    if (variants === undefined) {
      contributions.push({ path, manifest }) // data-only: verbatim
      continue
    }
    const trusted = variants.filter(variant => variant.executionProfile === 'trusted-in-process')
    if (trusted.length === 0) {
      excluded.push({
        path,
        reason: `${manifest.id ?? name} declares no trusted-in-process variant, and linked code runs in-process by definition`,
      })
      continue
    }
    for (const variant of trusted) entrypoints.add(variant.entrypoint)
    contributions.push({ path, manifest: { ...manifest, runtimeVariants: trusted } })
  }
  /*
   * An extension whose every variant targets only browser environments cannot be evaluated in
   * Node — its entrypoint touches window/document at import time. Such extensions are emitted as
   * subpath imports only: an ESM barrel evaluates its whole graph, so one eager re-export of
   * monaco would crash every Node consumer of the root import.
   */
  const BROWSER_ENVIRONMENTS = new Set([
    'browser-main',
    'browser-worker',
    'electron-renderer',
    'webview',
  ])
  const environments = contributions.flatMap(item =>
    Array.isArray(item.manifest.runtimeVariants)
      ? item.manifest.runtimeVariants.flatMap(variant => variant.target?.environments ?? [])
      : [],
  )
  const browserOnly =
    environments.length > 0 &&
    environments.every(environment => BROWSER_ENVIRONMENTS.has(environment))
  return {
    dir,
    packageJson,
    modkit,
    contributions,
    excluded,
    browserOnly,
    entrypoints: [...entrypoints].sort(),
  }
}

function emitExtension(extension, relDirPosix) {
  const name = identifier(extension.modkit.id)
  const imports = extension.entrypoints.map(
    (entry, index) =>
      `import * as m${index} from '../../../${relDirPosix}/${entry.replace(/^\.\//u, '')}'`,
  )
  const withDigests = extension.contributions.map(item => ({
    ...item,
    digest: sha256(canonicalJson(item.manifest)),
  }))
  const files = [
    'package.json',
    ...withDigests.map(item => item.path),
    ...extension.entrypoints.map(entry => entry.replace(/^\.\//u, '')),
  ]
  const artifactDigest = sha256(canonicalJson([files, withDigests.map(item => item.digest)]))
  const moduleMap = extension.entrypoints
    .map((entry, index) => `    ${JSON.stringify(entry)}: m${index},`)
    .join('\n')
  const body = `/** Generated by scripts/emit-linked-extensions.mjs — do not edit. */
import { defineLinkedExtension } from '@modkitx-x3/host'
${imports.join('\n')}

export const ${name} = defineLinkedExtension({
  source: ${JSON.stringify(`linked:${relDirPosix}`)},
  packageJson: ${JSON.stringify(extension.packageJson, null, 2)},
  files: ${JSON.stringify(files, null, 2)},
  contributions: ${JSON.stringify(withDigests, null, 2)},
  excluded: ${JSON.stringify(extension.excluded, null, 2)},
  artifactDigest: ${JSON.stringify(artifactDigest)},
  modules: {
${moduleMap}
  },
})
`
  const types = `/** Generated by scripts/emit-linked-extensions.mjs — do not edit. */
import type { LinkedExtension } from '@modkitx-x3/host'
export declare const ${name}: LinkedExtension
`
  return { name, file: `${extension.modkit.id}.mjs`, body, types }
}

// ---------------------------------------------------------------------------------------------
const commonDir = join(root, 'extensions', 'common')
const extensions = readdirSync(commonDir)
  .sort()
  .map(name => readExtension(join(commonDir, name)))
  .filter(extension => extension !== undefined && extension.contributions.length > 0)

const emitted = extensions.map(extension =>
  emitExtension(extension, `extensions/common/${extension.modkit.id}`),
)

/**
 * Curated sets, so a site can say "all image viewing and nothing else". Owner-decided groupings;
 * `everything` exists because a kitchen-sink host is a legitimate host.
 */
const nodeSafe = extensions.filter(extension => !extension.browserOnly)
const SETS = {
  imagesOnly: ['images', 'vector'],
  modelsOnly: ['models'],
  media: ['images', 'vector', 'audio', 'video', 'models'],
  structuredText: ['text-delimited', 'text-ini', 'text-json', 'text-toml', 'text-xml', 'text-yaml'],
  archivesOnly: ['archives'],
  documentsOnly: ['documents'],
  everything: nodeSafe.map(extension => extension.modkit.id),
}

const byId = new Map(emitted.map(item => [item.file.replace(/\.mjs$/u, ''), item.name]))
const nodeSafeFiles = new Set(nodeSafe.map(extension => `${extension.modkit.id}.mjs`))
const setsBody = `/** Generated by scripts/emit-linked-extensions.mjs — do not edit. */
${emitted
  .filter(item => nodeSafeFiles.has(item.file))
  .map(item => `import { ${item.name} } from './${item.file}'`)
  .join('\n')}

${Object.entries(SETS)
  .map(
    ([setName, ids]) =>
      `export const ${setName} = Object.freeze([${ids
        .map(id => byId.get(id))
        .filter(value => value !== undefined)
        .join(', ')}])`,
  )
  .join('\n')}
`
const setsTypes = `/** Generated by scripts/emit-linked-extensions.mjs — do not edit. */
import type { LinkedExtension } from '@modkitx-x3/host'
${Object.keys(SETS)
  .map(setName => `export declare const ${setName}: readonly LinkedExtension[]`)
  .join('\n')}
`

const browserOnlyNames = emitted
  .filter(item => !nodeSafeFiles.has(item.file))
  .map(item => item.name)
  .join(', ')
const indexBody = `/** Generated by scripts/emit-linked-extensions.mjs — do not edit. */
// Browser-only extensions (${browserOnlyNames || 'none'}) are subpath imports only: a barrel evaluates its whole graph.
${emitted
  .filter(item => nodeSafeFiles.has(item.file))
  .map(item => `export { ${item.name} } from './${item.file}'`)
  .join('\n')}
export * as sets from './sets.mjs'
`
const indexTypes = `/** Generated by scripts/emit-linked-extensions.mjs — do not edit. */
${emitted
  .filter(item => nodeSafeFiles.has(item.file))
  .map(item => `export { ${item.name} } from './${item.file.replace(/\.mjs$/u, '.d.mts')}'`)
  .join('\n')}
export * as sets from './sets.d.mts'
`

const packageJson = {
  name: '@modkitx-x3/extensions',
  version: '0.1.0',
  private: true,
  type: 'module',
  description:
    'First-party modkit extensions as statically importable modules (generated; the dynamic lane is loadExtensionRoots).',
  exports: {
    '.': { types: './generated/index.d.mts', default: './generated/index.mjs' },
    './sets': { types: './generated/sets.d.mts', default: './generated/sets.mjs' },
    ...Object.fromEntries(
      emitted.map(item => [
        `./${item.file.replace(/\.mjs$/u, '')}`,
        {
          types: `./generated/${item.file.replace(/\.mjs$/u, '.d.mts')}`,
          default: `./generated/${item.file}`,
        },
      ]),
    ),
    './package.json': './package.json',
  },
  files: ['generated'],
  dependencies: { '@modkitx-x3/host': 'workspace:*' },
}

const outputs = new Map()
outputs.set(join(packageDir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n')
outputs.set(join(outDir, 'index.mjs'), indexBody)
outputs.set(join(outDir, 'index.d.mts'), indexTypes)
outputs.set(join(outDir, 'sets.mjs'), setsBody)
outputs.set(join(outDir, 'sets.d.mts'), setsTypes)
for (const item of emitted) {
  outputs.set(join(outDir, item.file), item.body)
  outputs.set(join(outDir, item.file.replace(/\.mjs$/u, '.d.mts')), item.types)
}

function prettify(paths) {
  const result = spawnSync('pnpm', ['exec', 'prettier', '--write', ...paths], {
    cwd: root,
    shell: true,
    stdio: 'pipe',
  })
  if (result.status !== 0) {
    throw new Error(`prettier failed: ${String(result.stderr ?? result.stdout)}`)
  }
}

if (check) {
  // regenerate to a scratch tree, prettify, byte-compare with what is committed
  const scratch = join(packageDir, '.check-tmp')
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(join(scratch, 'generated'), { recursive: true })
  const rewritten = []
  for (const [path, body] of outputs) {
    const target = path.replace(packageDir, scratch)
    writeFileSync(target, body)
    rewritten.push(target)
  }
  prettify(rewritten)
  let stale = 0
  for (const [path] of outputs) {
    const target = path.replace(packageDir, scratch)
    const fresh = readFileSync(target, 'utf8')
    const committed = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (fresh !== committed) {
      stale += 1
      console.error(`linked extensions stale: ${path.slice(root.length + 1)}`)
    }
  }
  rmSync(scratch, { recursive: true, force: true })
  if (stale > 0) {
    console.error(
      `linked:check — ${stale} file(s) drifted; run: node scripts/emit-linked-extensions.mjs`,
    )
    process.exit(1)
  }
  console.log(
    `linked:check — ${outputs.size} generated file(s) up to date (${emitted.length} extensions)`,
  )
} else {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  for (const [path, body] of outputs) writeFileSync(path, body)
  prettify([...outputs.keys()])
  console.log(
    `linked extensions emitted: ${emitted.length} extensions, ${outputs.size} files → packages/extensions-linked`,
  )
}
