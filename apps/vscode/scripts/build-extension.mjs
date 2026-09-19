/**
 * Bundle the VS Code extension into generated `dist-app/`.
 *
 *   node scripts/build-extension.mjs
 *
 * Two bundles with different rules:
 *   - `extension.cjs` runs in the extension host. VS Code loads extension entry points as
 *     CommonJS, and `vscode` is provided by the runtime, so it must stay external.
 *   - `webview.js` runs in the bridge realm. It is an ES module with no host access at all.
 *
 * The static `contributes` block is merged into the manifest from the generated catalog, which is
 * the deterministic artifact `contributes:check` guards. Nothing here authors contribution points.
 * `dist-app/` is deliberately not tracked: release and smoke build it from source, while `--check`
 * compares that generated output with two independent fresh builds.
 */
import { build } from 'esbuild'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { builtinModules } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  copyOfflineReleaseToDist,
  managedPackagesDirectory,
  verifyPackagedOfflineRelease,
} from './offline-release.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const publicationInventoryPath = join(appRoot, 'publication-artifact.v1.json')
const publicationInventory = JSON.parse(readFileSync(publicationInventoryPath, 'utf8'))
const bundledCatalog = JSON.parse(
  readFileSync(join(appRoot, 'generated', 'bundled-catalog.json'), 'utf8'),
)

if (
  publicationInventory.schemaVersion !== 1 ||
  publicationInventory.artifactKind !== 'deterministic-shell' ||
  !Array.isArray(publicationInventory.shellEntries) ||
  !Array.isArray(publicationInventory.managedPackageEntries) ||
  !Array.isArray(publicationInventory.packagedCodecRoots)
) {
  throw new TypeError('VS Code publication artifact inventory must be deterministic-shell v1')
}

function assertPublicationArtifact(output) {
  const shellEntries = [...publicationInventory.shellEntries].sort()
  const managedPackageEntries = [...publicationInventory.managedPackageEntries].sort()
  const packagedCodecRoots = [...publicationInventory.packagedCodecRoots].sort()
  if (
    shellEntries.some(
      (entry, index) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        (index > 0 && entry === shellEntries[index - 1]),
    ) ||
    managedPackageEntries.some(
      (entry, index) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        entry.includes('/') ||
        entry.includes('\\') ||
        (index > 0 && entry === managedPackageEntries[index - 1]),
    ) ||
    packagedCodecRoots.some(
      (entry, index) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        (index > 0 && entry === packagedCodecRoots[index - 1]),
    )
  ) {
    throw new TypeError('VS Code publication artifact entries must be unique non-empty strings')
  }
  const rootDirectories = new Map()
  for (const root of packagedCodecRoots) {
    const segments = root.split('/')
    if (
      segments.length !== 2 ||
      segments[0] !== 'extensions' ||
      segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
    ) {
      throw new TypeError(
        `VS Code packaged codec root must be an extensions/<root> path, found ${root}`,
      )
    }
    rootDirectories.set(root, segments[1])
  }
  if (managedPackageEntries.length !== 1 || managedPackageEntries[0] !== managedPackagesDirectory) {
    throw new TypeError(
      `VS Code publication artifact must name exactly ${managedPackagesDirectory}`,
    )
  }
  const expectedEntries = [
    ...new Set(
      [...shellEntries, ...managedPackageEntries, ...rootDirectories.keys()].map(
        entry => entry.split('/')[0],
      ),
    ),
  ].sort()
  const actualEntries = readdirSync(output).sort()
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(
      `VS Code publication artifact inventory drifted: expected ${expectedEntries.join(', ')}, found ${actualEntries.join(', ')}`,
    )
  }
  const extensionDirectory = join(output, 'extensions')
  const actualRoots = readdirSync(extensionDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'node_modules')
    .map(entry => entry.name)
    .sort()
  const expectedRoots = [...rootDirectories.values()].sort()
  if (JSON.stringify(actualRoots) !== JSON.stringify(expectedRoots)) {
    throw new Error(
      `VS Code packaged codec root inventory drifted: expected ${expectedRoots.join(', ')}, found ${actualRoots.join(', ')}`,
    )
  }
  for (const root of rootDirectories.keys()) {
    const path = join(output, ...root.split('/'))
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new Error(`VS Code packaged codec root is missing: ${root}`)
    }
  }
  verifyPackagedOfflineRelease(output)
}

function packageSegments(name) {
  const segments = name.split('/')
  if (
    (name.startsWith('@') && segments.length !== 2) ||
    (!name.startsWith('@') && segments.length !== 1) ||
    segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`invalid package name in production closure: ${name}`)
  }
  return segments
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith('@'))
    return packageSegments(specifier.split('/').slice(0, 2).join('/')).join('/')
  return packageSegments(specifier.split('/')[0]).join('/')
}

function copyPhysicalTree(source, destination) {
  const stat = lstatSync(source)
  if (stat.isSymbolicLink()) {
    throw new Error(`production package input must not be a symlink or junction: ${source}`)
  }
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true })
    for (const entry of readdirSync(source).sort()) {
      if (entry === 'node_modules') continue
      copyPhysicalTree(join(source, entry), join(destination, entry))
    }
    return
  }
  if (!stat.isFile()) throw new Error(`unsupported production package entry: ${source}`)
  cpSync(source, destination)
}

function copyWorkspacePackage(source, destination, manifest) {
  copyPhysicalTree(join(source, 'package.json'), join(destination, 'package.json'))
  if (!Array.isArray(manifest.files)) {
    throw new Error(`workspace production package has no files whitelist: ${manifest.name}`)
  }
  for (const entry of manifest.files) {
    if (
      typeof entry !== 'string' ||
      entry.length === 0 ||
      entry.includes('*') ||
      entry.includes('/') ||
      entry.includes('\\') ||
      entry === '.' ||
      entry === '..'
    ) {
      throw new Error(
        `workspace production files whitelist has an unsupported entry: ${manifest.name}/${entry}`,
      )
    }
    const input = join(source, entry)
    if (!existsSync(input)) {
      throw new Error(
        `workspace production files whitelist entry is missing: ${manifest.name}/${entry}`,
      )
    }
    copyPhysicalTree(input, join(destination, entry))
  }
}

function isWorkspacePackage(path) {
  const workspacePackages = join(repoRoot, 'packages')
  return (
    path === workspacePackages ||
    path.startsWith(`${workspacePackages}\\`) ||
    path.startsWith(`${workspacePackages}/`)
  )
}

function physicalDependencyDirectory(owner, dependency) {
  const segments = packageSegments(dependency)
  let current = realpathSync(owner)
  while (true) {
    const candidate = join(current, 'node_modules', ...segments)
    if (existsSync(candidate)) return realpathSync(candidate)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error(`cannot resolve production dependency ${dependency} from ${owner}`)
}

function runtimeDependencies(manifest) {
  return [
    ...new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      // An optional peer is optional for an installer, not proof that code never imports it. The
      // Common roots use @modkit/codec-kit's optional peers directly, so a bundled closure must
      // carry every declared peer and fail at build time if the physical package is unavailable.
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]),
  ].sort()
}

function assertNoLinks(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink())
    throw new Error(`production output contains a symlink or junction: ${path}`)
  if (!stat.isDirectory()) return
  for (const entry of readdirSync(path)) assertNoLinks(join(path, entry))
}

function allFiles(path) {
  const files = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const absolute = join(path, entry.name)
    if (entry.isDirectory()) files.push(...allFiles(absolute))
    else if (entry.isFile()) files.push(absolute)
  }
  return files
}

function assertRuntimeImportsResolve(extensionsOutput) {
  for (const dependency of ['@modkit/core', '@modkit/host', '@modkit/sdk', '@modkit/vfs']) {
    const path = join(extensionsOutput, 'node_modules', ...packageSegments(dependency))
    if (!existsSync(join(path, 'package.json'))) {
      throw new Error(`production closure is missing required ${dependency}`)
    }
  }
  const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)])
  const bareImports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\()(['"])([^'"./][^'"]*)\1/gu
  const roots = readdirSync(extensionsOutput, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'node_modules')
    .map(entry => join(extensionsOutput, entry.name))
  // Third-party packages are copied from their published pnpm-store payloads; scan the code we
  // control, where the closure is responsible for every workspace peer and direct bare import.
  const workspaceClosure = join(extensionsOutput, 'node_modules', '@modkit')
  for (const file of [...roots, workspaceClosure]
    .flatMap(allFiles)
    .filter(path => path.endsWith('.js'))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(bareImports)) {
      const specifier = match[2]
      // Comments and diagnostics can contain prose such as “import …”; only Node package-shaped
      // specifiers participate in this closure check.
      if (!/^(?:@[-a-zA-Z0-9_.]+\/)?[-a-zA-Z0-9_.]+(?:\/[-a-zA-Z0-9_.]+)*$/u.test(specifier))
        continue
      if (builtins.has(specifier)) continue
      const dependency = packageNameFromSpecifier(specifier)
      try {
        physicalDependencyDirectory(dirname(file), dependency)
      } catch (error) {
        throw new Error(
          `production bare import ${specifier} from ${file} cannot resolve in staged closure: ${String(error)}`,
        )
      }
    }
  }
}

/**
 * Copy the generated Common roots and the exact runtime package closure they need.
 * `generated/bundled-catalog.json` is the authority for which roots ship; the build never hardcodes it.
 *
 * This intentionally does not copy any source `node_modules` directory. pnpm represents most
 * dependencies there as junctions, which are neither portable in a VSIX nor a production closure.
 * Instead each declared runtime dependency is resolved to its physical package and copied once to
 * the shared `extensions/node_modules` lookup point. A root can therefore resolve `@modkit/*` as a
 * normal Node package without a checkout, a workspace link, a junction, or an absolute path.
 */
function copyBundledCodecRoots(output) {
  if (
    bundledCatalog.schemaVersion !== 1 ||
    !Array.isArray(bundledCatalog.roots) ||
    bundledCatalog.rootCount !== bundledCatalog.roots.length ||
    bundledCatalog.rootCount < 1
  ) {
    throw new TypeError(
      'VS Code bundled catalog must name its generated Common roots and count them',
    )
  }
  const roots = [...bundledCatalog.roots].sort((left, right) =>
    left.directory.localeCompare(right.directory),
  )
  const rootDirectories = roots.map(root => root.directory)
  if (
    rootDirectories.some(
      (directory, index) =>
        typeof directory !== 'string' ||
        directory.length === 0 ||
        directory.includes('/') ||
        directory.includes('\\') ||
        (index > 0 && directory === rootDirectories[index - 1]),
    )
  ) {
    throw new TypeError('VS Code bundled catalog root directories must be unique direct children')
  }

  const extensionsOutput = join(output, 'extensions')
  const dependenciesOutput = join(extensionsOutput, 'node_modules')
  mkdirSync(dependenciesOutput, { recursive: true })
  const copiedPackages = new Map()

  const copyDependency = (owner, dependency) => {
    const source = physicalDependencyDirectory(owner, dependency)
    const manifestPath = join(source, 'package.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`production dependency ${dependency} has no package.json at ${source}`)
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.name !== dependency) {
      throw new Error(
        `production dependency identity drift: expected ${dependency}, found ${manifest.name}`,
      )
    }
    const previous = copiedPackages.get(dependency)
    if (previous !== undefined) {
      if (previous.source !== source || previous.version !== manifest.version) {
        throw new Error(
          `production dependency version conflict for ${dependency}: ` +
            `${previous.version} at ${previous.source}, ${manifest.version} at ${source}`,
        )
      }
      return
    }
    copiedPackages.set(dependency, { source, version: manifest.version })
    const destination = join(dependenciesOutput, ...packageSegments(dependency))
    if (isWorkspacePackage(source)) copyWorkspacePackage(source, destination, manifest)
    else copyPhysicalTree(source, destination)
    for (const nested of runtimeDependencies(manifest)) copyDependency(source, nested)
  }

  for (const root of roots) {
    const source = join(repoRoot, 'extensions', root.directory)
    if (!existsSync(join(source, 'package.json'))) {
      throw new Error(`generated bundled root is missing from the repository: ${root.directory}`)
    }
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    copyWorkspacePackage(source, join(extensionsOutput, root.directory), manifest)
    for (const dependency of runtimeDependencies(manifest)) copyDependency(source, dependency)
  }

  const actualRoots = readdirSync(extensionsOutput, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'node_modules')
    .map(entry => entry.name)
    .sort()
  if (JSON.stringify(actualRoots) !== JSON.stringify(rootDirectories)) {
    throw new Error(
      `bundled codec root drift: expected ${rootDirectories.join(', ')}, found ${actualRoots.join(', ')}`,
    )
  }
  assertNoLinks(extensionsOutput)
  assertRuntimeImportsResolve(extensionsOutput)
}

/*
 * Where the bundle lands.
 *
 * `--check` builds twice into throwaway directories and compares both results with the generated
 * `dist-app/`. This catches both source drift (the checkout was not rebuilt) and non-deterministic
 * output without keeping tens of thousands of generated lines under version control.
 */
const check = process.argv.includes('--check')
const outFlag = process.argv.indexOf('--out')
const generated = join(appRoot, 'dist-app')
if (check && outFlag > 0) {
  console.error('dist-app --check cannot be combined with --out')
  process.exit(1)
}
const dist = outFlag > 0 ? resolve(process.argv[outFlag + 1]) : generated

async function buildInto(output, syncManifest) {
  mkdirSync(output, { recursive: true })
  // The closure is a complete generated subtree. Remove only that owned subtree before copying so
  // a root's production files whitelist cannot leave stale tests or migration notes in dist-app.
  rmSync(join(output, 'extensions'), { recursive: true, force: true })

  await build({
    entryPoints: [join(appRoot, 'src', 'extension.ts')],
    outfile: join(output, 'extension.cjs'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['node20'],
    // Prefer dependency ESM entry points. `jsonc-parser` publishes both an ESM `module` and an AMD/
    // CommonJS `main`; selecting the latter leaves its relative `require('./impl/format')` calls in
    // the single-file bundle, where those sibling files do not exist in an Extension Host.
    mainFields: ['module', 'main'],
    // Supplied by the VS Code runtime; bundling it would shadow the real API.
    external: ['vscode'],
    /*
     * No rewrite of `import.meta.url` here any more. The extension names the bootstrap it shipped
     * through `bootstrapUrl`, which the Node factories now thread through — a host saying where its
     * own file is, rather than a build making one expression mean something other than it says.
     */
    absWorkingDir: repoRoot,
    logLevel: 'warning',
    // `@modkit/host` keeps an ESM default that resolves its worker bootstrap through
    // `import.meta.url`. This CommonJS host always supplies the shipped bootstrap explicitly (see
    // `apps/vscode/src/extension.ts`), and the host has a named refusal if another CommonJS
    // consumer omits it. esbuild still warns while lowering that guarded fallback, so silence only
    // this expected diagnostic rather than hiding other build warnings.
    logOverride: { 'empty-import-meta': 'silent' },
  })

  const bootstrapEntry = join(repoRoot, 'packages', 'host', 'dist', 'node', 'worker-bootstrap.js')
  if (!existsSync(bootstrapEntry)) {
    console.error(
      `missing ${bootstrapEntry} — run pnpm build (tsc -b) before bundling the extension`,
    )
    process.exit(1)
  }
  // Its own self-contained ES module: a worker thread is its own entry point, and the bootstrap
  // verifies artifact bytes against the inventory's digests, so it must not be reached through a
  // bundle that could have rewritten it.
  await build({
    entryPoints: [bootstrapEntry],
    outfile: join(output, 'worker-bootstrap.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    absWorkingDir: repoRoot,
    logLevel: 'warning',
  })

  await build({
    entryPoints: {
      webview: join(appRoot, 'src', 'webview.ts'),
      'gallery-webview': join(appRoot, 'src', 'gallery-webview.ts'),
    },
    outdir: output,
    bundle: true,
    format: 'esm',
    /*
     * Split at every dynamic import. What a page needs to draw its first view is loaded up front;
     * what only some subjects need — the precompiled schema validators (~4 MB, consulted the first
     * time something is validated), the world renderer and three.js (only a map) — comes as its
     * own chunk when it is first asked for. The chunks sit in one directory next to the page and
     * are fetched from the same origin; a module's imports inherit its script nonce, so the page's
     * content-security policy stays exactly as strict.
     */
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    platform: 'browser',
    target: ['chrome120'],
    absWorkingDir: repoRoot,
    logLevel: 'warning',
    /*
     * The page is what a person waits on, and a cold webview fetches, parses and evaluates this
     * whole file before it can draw anything. Minified it is a fraction of the size. Names are
     * kept: error messages, diagnostics and a few `instanceof`-free checks read `.name`, and a
     * renamed class would turn a readable report into a letter.
     */
    minify: true,
    keepNames: true,
  })

  const stylesheet = join(repoRoot, 'packages', 'ui', 'styles', 'modkit-ui.css')
  if (!existsSync(stylesheet)) {
    console.error(
      'missing packages/ui/styles/modkit-ui.css — run pnpm --filter @modkit/ui tokens:emit',
    )
    process.exit(1)
  }
  cpSync(stylesheet, join(output, 'modkit-ui.css'))
  // The icon font the viewers draw with (MK2's codicons), next to the page that links it.
  cpSync(join(repoRoot, 'packages', 'ui', 'assets', 'codicons'), join(output, 'codicons'), {
    recursive: true,
  })

  // Shell chrome only: the shipped stylesheet has no layout for the `workbench` parts on purpose, so
  // the host places them. Everything else the page draws comes from `modkit-ui.css`.
  cpSync(join(appRoot, 'app.css'), join(output, 'app.css'))
  cpSync(join(appRoot, 'generated', 'format-smoke.v1.json'), join(output, 'format-smoke.v1.json'))
  copyBundledCodecRoots(output)
  copyOfflineReleaseToDist({ output })

  // ---------------------------------------------------------------- manifest
  // Only the real output owns the manifest: a check build must not write the package it is checking.
  if (syncManifest) {
    const manifestPath = join(appRoot, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const contributes = JSON.parse(
      readFileSync(join(appRoot, 'contributes.generated.json'), 'utf8'),
    )
    /*
     * Filesystem schemes are an activation point with no `contributes` entry of their own — a
     * provider is registered in code — so they are declared in the authority document rather than in
     * this script: a saved workspace holding a `modkit-container:` folder has to start this extension
     * before the Explorer can ask anything of it, and a scheme spelled in two places would drift.
     */
    const authority = JSON.parse(readFileSync(join(appRoot, 'bundled-contributes.v1.json'), 'utf8'))
    const fileSystemSchemes = [...(authority.fileSystemSchemes ?? [])].sort()

    const previous = JSON.stringify([
      manifest.contributes ?? null,
      manifest.activationEvents ?? null,
    ])
    manifest.contributes = contributes
    // Every command and every custom editor in the generated catalog is an activation point; VS Code
    // 1.75+ infers the commands, but a custom editor still has to be declared or the provider is never
    // registered and "Reopen Editor With… → Modkit Asset Preview" opens an editor nothing resolves.
    manifest.activationEvents = [
      ...contributes.commands.map(command => `onCommand:${command.command}`),
      ...contributes.customEditors.map(editor => `onCustomEditor:${editor.viewType}`),
      // The tree views are the other way in: opening the Modkit container has to start the host.
      ...Object.values(contributes.views)
        .flat()
        .map(view => `onView:${view.id}`),
      ...fileSystemSchemes.map(scheme => `onFileSystem:${scheme}`),
      /*
       * Language routes come from the configured extension directories at runtime, so no static
       * `onLanguage` event can name them. Without this the editor starts the host only when a panel
       * or a command asks for it, and opening an SC2 file gives no diagnostics, navigation or
       * tokens. `generate-contributes.mjs` derives the same list; leaving it out here made every
       * build undo that script's own check.
       */
      'onStartupFinished',
    ]

    if (JSON.stringify([manifest.contributes, manifest.activationEvents]) !== previous) {
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      console.log(
        'manifest contributes and activation events synced from contributes.generated.json',
      )
    }
  }
  assertPublicationArtifact(output)
}

function differingFiles(left, right) {
  const paths = directory => {
    const entries = []
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = join(directory, entry.name)
      if (entry.isSymbolicLink())
        throw new Error(`generated output contains a symlink or junction: ${absolute}`)
      entries.push(entry.name)
      if (entry.isDirectory()) {
        for (const child of paths(absolute)) entries.push(join(entry.name, child))
      }
    }
    return entries
  }
  const names = [...new Set([...paths(left), ...paths(right)])].sort()
  return names.filter(name => {
    const leftPath = join(left, name)
    const rightPath = join(right, name)
    if (!existsSync(leftPath) || !existsSync(rightPath)) return true
    const leftStat = statSync(leftPath)
    const rightStat = statSync(rightPath)
    if (leftStat.isDirectory() || rightStat.isDirectory())
      return leftStat.isDirectory() !== rightStat.isDirectory()
    return !readFileSync(leftPath).equals(readFileSync(rightPath))
  })
}

if (!check) {
  await buildInto(dist, dist === generated)
  console.log(`built ${dist}`)
} else {
  if (!existsSync(generated)) {
    console.error('dist-app --check: generated dist-app is missing; run ext:build first')
    process.exit(1)
  }
  const freshA = mkdtempSync(join(tmpdir(), 'x3-dist-app-a-'))
  const freshB = mkdtempSync(join(tmpdir(), 'x3-dist-app-b-'))
  try {
    await buildInto(freshA, false)
    await buildInto(freshB, false)
    const nonDeterministic = differingFiles(freshA, freshB)
    const stale = differingFiles(freshA, generated)
    if (nonDeterministic.length > 0) {
      console.error(
        `dist-app --check: non-deterministic output in ${nonDeterministic.length} file(s): ` +
          nonDeterministic.join(', '),
      )
      process.exitCode = 1
    }
    if (stale.length > 0) {
      console.error(
        `dist-app --check: generated output is stale in ${stale.length} file(s): ${stale.join(', ')}`,
      )
      console.error('Run `pnpm --filter @modkit/modkit-vscode ext:build`.')
      process.exitCode = 1
    }
    if (process.exitCode !== 1) {
      console.log(
        `dist-app --check: ${readdirSync(freshA).length} generated file(s) are fresh and ` +
          'byte-deterministic across two clean builds',
      )
    }
  } finally {
    rmSync(freshA, { recursive: true, force: true })
    rmSync(freshB, { recursive: true, force: true })
  }
}
