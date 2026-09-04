import path from 'node:path'
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import { createPinnedSource, MK2_PIN, sha256, digestManifest } from './legacy-oracle.mjs'

const acceptedScopePins = new Map([
  [
    'sc2-m1-libs-2026-09-04',
    {
      family: 'sc2',
      scopeName: 'm1-libs',
      oracleCommit: MK2_PIN,
      scopeDigest: '1a48d645dedbd3f5e057e2c1c8c7e5d6f1bf54dfb8b8740323b5987793b6ec4e',
      legacyDeclarationDigest: '31029f8d7333d3d676ad2e8b58be5e80e9f28f64658c640eeea84519d3fa6875',
    },
  ],
  [
    'sc2-bank-2026-09-04',
    {
      family: 'sc2',
      scopeName: 'sc2-bank',
      oracleCommit: MK2_PIN,
      scopeDigest: 'f10e67644357ca4fc3b6aee5d0b82bcacb411d0cd35861e00501fcf6104de35d',
      legacyDeclarationDigest: '31029f8d7333d3d676ad2e8b58be5e80e9f28f64658c640eeea84519d3fa6875',
    },
  ],
])

export function scopeDeclarationDigest(declaration, scopeName, copies) {
  const scope = { ...declaration.scopes[scopeName] }
  delete scope.acceptancePin
  return digestManifest({
    schemaVersion: declaration.schemaVersion,
    family: declaration.family,
    oracleCommit: declaration.oracleCommit,
    scopeName,
    scope,
    copies,
  })
}

function compatibleDeclarationDigest(declaration, scopeName, copies) {
  const digest = scopeDeclarationDigest(declaration, scopeName, copies)
  const pinName = declaration.scopes[scopeName].acceptancePin
  if (!pinName) return digest
  const pin = acceptedScopePins.get(pinName)
  if (
    !pin ||
    pin.family !== declaration.family ||
    pin.scopeName !== scopeName ||
    pin.oracleCommit !== declaration.oracleCommit ||
    pin.scopeDigest !== digest
  )
    throw new Error(`Accepted scope pin mismatch: ${scopeName}`)
  return pin.legacyDeclarationDigest
}

export function safeRelative(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    /[:\0]/u.test(value) ||
    value
      .split('/')
      .some(
        part =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/u.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  )
    throw new Error(`Unsafe canonical path: ${value}`)
  return value
}

async function safeTarget(root, relative) {
  const absolute = path.resolve(root, safeRelative(relative))
  const actualRoot = await realpath(root)
  let current = path.dirname(absolute)
  while (true) {
    try {
      const actual = await realpath(current)
      const inside = path.relative(actualRoot, actual)
      if (inside.startsWith('..') || path.isAbsolute(inside))
        throw new Error(`Destination escapes root: ${relative}`)
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      current = path.dirname(current)
    }
  }
  try {
    if ((await lstat(absolute)).isSymbolicLink())
      throw new Error(`Symlink destination: ${relative}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return absolute
}

/** AST traversal includes erased imports, export-from, import types, require and references. */
export function importsOf(text, filename = 'source.ts') {
  if (!/\.[cm]?[jt]sx?$/u.test(filename)) return []
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
  if (file.parseDiagnostics.length) throw new Error(`Cannot parse imports: ${filename}`)
  const imports = []
  const add = node => {
    if (!node) throw new Error(`Missing import argument: ${filename}`)
    if (!ts.isStringLiteralLike(node)) {
      imports.push({
        specifier: null,
        expression: node.getText(file),
        start: node.getStart(file),
        end: node.end,
        literal: null,
      })
      return
    }
    imports.push({
      specifier: node.text,
      start: node.getStart(file),
      end: node.end,
      literal: node.getText(file),
    })
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      add(node.moduleReference.expression)
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal)
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      add(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(file)
  for (const ref of file.referencedFiles)
    imports.push({
      specifier: ref.fileName.startsWith('.') ? ref.fileName : `./${ref.fileName}`,
      start: ref.pos,
      end: ref.end,
      literal: text.slice(ref.pos, ref.end),
    })
  for (const ref of file.typeReferenceDirectives)
    imports.push({
      specifier: ref.fileName,
      start: ref.pos,
      end: ref.end,
      literal: text.slice(ref.pos, ref.end),
    })
  return imports
}

function candidates(importer, specifier) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier))
  if (base.startsWith('../')) throw new Error(`Import escapes source root: ${specifier}`)
  return [
    ...new Set([
      base
        .replace(/\.mjs$/u, '.mts')
        .replace(/\.cjs$/u, '.cts')
        .replace(/\.js$/u, '.ts'),
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.d.ts`,
      `${base}/index.ts`,
      `${base}/index.d.ts`,
      base.replace(/\.js$/u, '.d.ts'),
    ]),
  ]
}

export function rewriteSource(original, rewrites, filename) {
  let text = original
  const evidence = []
  for (const rewrite of rewrites) {
    const { from, to } = rewrite
    if (!from || typeof to !== 'string' || from === to)
      throw new Error(`Invalid exact rewrite: ${filename}`)
    let occurrences = [
      ...text.matchAll(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu')),
    ]
    if (!occurrences.length) throw new Error(`Rewrite occurrence mismatch: ${filename}: ${from}`)
    const kind = rewrite.kind ?? 'import'
    if (kind === 'import') {
      const imports = importsOf(text, filename)
      occurrences = imports
        .filter(item => item.literal === from)
        .map(item => ({ index: item.start }))
      if (!occurrences.length)
        throw new Error(`Rewrite is not exclusively an import specifier: ${filename}: ${from}`)
      if (rewrite.count !== undefined && rewrite.count !== occurrences.length)
        throw new Error(`Rewrite import occurrence mismatch: ${filename}: ${from}`)
      if (!/^(['"])[^'"\r\n]+\1$/u.test(to))
        throw new Error(`Invalid rewritten import literal: ${to}`)
    } else if (kind === 'import-type') {
      if (rewrite.count !== undefined && rewrite.count !== occurrences.length)
        throw new Error(`Rewrite occurrence mismatch: ${filename}: ${from}`)
      const originalAst = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
      const replacementAst = ts.createSourceFile(filename, to, ts.ScriptTarget.Latest, true)
      const replacement = replacementAst.statements[0]
      if (
        replacementAst.parseDiagnostics.length ||
        replacementAst.statements.length !== 1 ||
        !ts.isImportDeclaration(replacement) ||
        !replacement.importClause
      )
        throw new Error(`Invalid import-type rewrite: ${filename}`)
      if (
        occurrences.some(
          match =>
            !originalAst.statements.some(
              node =>
                ts.isImportDeclaration(node) &&
                node.getStart(originalAst) === match.index &&
                node.getText(originalAst) === from,
            ),
        )
      )
        throw new Error(`Type rewrite must cover an exact import declaration: ${filename}`)
      const emit = input =>
        ts.transpileModule(input, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            removeComments: true,
            verbatimModuleSyntax: false,
          },
        }).outputText
      if (emit(text) !== emit(text.replaceAll(from, to)))
        throw new Error(`Type rewrite changes emitted runtime: ${filename}`)
      if (
        JSON.stringify(importsOf(from, filename).map(item => item.specifier)) !==
        JSON.stringify(importsOf(to, filename).map(item => item.specifier))
      )
        throw new Error(`Type rewrite changes import target: ${filename}`)
    } else throw new Error(`Unsupported rewrite kind: ${kind}`)
    const before = sha256(text)
    if (kind === 'import')
      for (const occurrence of occurrences.toReversed())
        text = `${text.slice(0, occurrence.index)}${to}${text.slice(occurrence.index + from.length)}`
    else text = text.replaceAll(from, to)
    evidence.push({
      kind,
      from,
      to,
      count: occurrences.length,
      sha256Before: before,
      sha256After: sha256(text),
    })
  }
  return { text, evidence }
}

function unique(rows, key, label) {
  const seen = new Set()
  for (const row of rows) {
    const value = safeRelative(row[key])
    const canonical = value.toLowerCase()
    if (seen.has(canonical)) throw new Error(`Duplicate canonical ${label}: ${value}`)
    seen.add(canonical)
  }
}

function codecOwner(sourcePath) {
  return sourcePath.match(/^extensions\/blizzard\/starcraft-2\/codecs\/([^/]+)\//u)?.[1]
}

async function applyDivergence(text, divergence, root) {
  if (!divergence) return { text, evidence: null }
  if (
    !divergence.reason?.trim() ||
    !divergence.mk3Contract?.trim() ||
    !divergence.proof?.length ||
    !divergence.edits?.length
  )
    throw new Error(`Unbounded divergence: ${divergence.file}`)
  if (divergence.semantic && !divergence.ownerDecision?.trim())
    throw new Error(`Semantic divergence requires owner decision: ${divergence.file}`)
  const proofs = []
  for (const proof of divergence.proof) {
    const bytes = await readFile(await safeTarget(root, proof.path))
    if (!bytes.length || sha256(bytes) !== proof.sha256)
      throw new Error(`Divergence proof hash mismatch: ${proof.path}`)
    proofs.push(proof)
  }
  for (const edit of divergence.edits) {
    if (
      !edit.from ||
      typeof edit.to !== 'string' ||
      !Number.isInteger(edit.count) ||
      edit.count < 1 ||
      sha256(text) !== edit.sha256Before
    )
      throw new Error(`Unbounded divergence edit: ${divergence.file}`)
    if (text.split(edit.from).length - 1 !== edit.count)
      throw new Error(`Divergence count mismatch: ${divergence.file}`)
    text = text.replaceAll(edit.from, edit.to)
    if (sha256(text) !== edit.sha256After)
      throw new Error(`Divergence result hash mismatch: ${divergence.file}`)
  }
  return { text, evidence: { ...divergence, proof: proofs } }
}

// A relative import may cross a package boundary only through a direct public export of
// that same canonical source. Barrels, fallback targets and arbitrary replacements refuse.
async function canonicalPackageExport(dependency, sourceTarget, bySource, workspaceRoot) {
  if (
    !Array.isArray(dependency.canonicalSources) ||
    !dependency.canonicalSources.includes(sourceTarget)
  )
    throw new Error(`Canonical copied source replaced by bare dependency: ${sourceTarget}`)
  const destination = bySource.get(sourceTarget)?.destination
  if (!destination || dependency.kind === 'node-builtin')
    throw new Error(`Invalid canonical package source: ${sourceTarget}`)
  const manifestPath = await safeTarget(workspaceRoot, dependency.manifest)
  const packageRoot = path.dirname(manifestPath)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const configPath = path.join(packageRoot, 'tsconfig.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(`Cannot read canonical package tsconfig: ${configPath}`)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot)
  if (parsed.errors.some(error => error.code !== 18003))
    throw new Error(`Invalid canonical package tsconfig: ${configPath}`)
  const { rootDir, outDir } = parsed.options
  const within = (parent, child) => {
    const relative = path.relative(parent, child)
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  }
  if (!rootDir || !outDir || !within(packageRoot, rootDir) || !within(packageRoot, outDir))
    throw new Error(`Unbounded canonical package emit directories: ${dependency.package}`)
  const sourcePath = await safeTarget(workspaceRoot, destination)
  if (!within(rootDir, sourcePath) || !sourcePath.endsWith('.ts') || sourcePath.endsWith('.d.ts'))
    throw new Error(`Canonical source is outside package emit scope: ${destination}`)
  const subpath =
    dependency.specifier === dependency.package
      ? '.'
      : `.${dependency.specifier.slice(dependency.package.length)}`
  if (
    dependency.specifier !== dependency.package &&
    !dependency.specifier.startsWith(`${dependency.package}/`)
  )
    throw new Error(`Canonical dependency package mismatch: ${dependency.specifier}`)
  const stem = path.relative(rootDir, sourcePath).slice(0, -3)
  const target = extension =>
    `./${path
      .relative(packageRoot, path.join(outDir, stem + extension))
      .split(path.sep)
      .join('/')}`
  const exported = manifest.exports?.[subpath]
  if (
    !exported ||
    typeof exported !== 'object' ||
    Array.isArray(exported) ||
    exported.types !== target('.d.ts')
  )
    throw new Error(`Canonical package needs a direct typed export: ${dependency.specifier}`)
  let runtimeTargets = 0
  const check = (value, key) => {
    if (typeof value === 'string') {
      if (value !== target(key === 'types' ? '.d.ts' : '.js'))
        throw new Error(`Noncanonical package export target: ${dependency.specifier}`)
      if (key !== 'types') runtimeTargets++
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [condition, child] of Object.entries(value)) check(child, condition)
    } else throw new Error(`Unsupported canonical package export: ${dependency.specifier}`)
  }
  check(exported, '')
  if (!runtimeTargets)
    throw new Error(`Canonical package has no runtime export: ${dependency.specifier}`)
  return destination
}

/** Validate the declaration independently of existing destination/provenance files. */
export async function prepareCopy({
  declaration,
  divergences,
  scope,
  workspaceRoot,
  repoRoot,
  source: suppliedSource,
  allowPending = false,
}) {
  if (!scope) throw new Error('Explicit --scope required (m1-libs, sc2-bank, family)')
  if (
    declaration.schemaVersion !== 1 ||
    declaration.family !== 'sc2' ||
    declaration.oracleCommit !== MK2_PIN
  )
    throw new Error('Invalid SC2 pinned declaration')
  const selected = declaration.scopes?.[scope]
  if (!selected) throw new Error(`Unknown copy scope: ${scope}`)
  if (!selected.requiredSources?.length && !selected.sourcePrefixes?.length)
    throw new Error(`Empty required closure: ${scope}`)
  unique(declaration.copies, 'source', 'source')
  unique(declaration.copies, 'destination', 'destination')
  unique(declaration.plannedCopies ?? [], 'source', 'planned source')
  unique(declaration.plannedCopies ?? [], 'destination', 'planned destination')
  const plannedSources = new Map(
    (declaration.plannedCopies ?? []).map(row => [row.source, row.destination]),
  )
  for (const row of declaration.copies) {
    if (plannedSources.has(row.source) && plannedSources.get(row.source) !== row.destination)
      throw new Error(`Planned source has a second canonical destination: ${row.source}`)
    const otherPlan = (declaration.plannedCopies ?? []).find(
      item => item.destination === row.destination && item.source !== row.source,
    )
    if (otherPlan)
      throw new Error(`Planned destination belongs to another source: ${row.destination}`)
  }
  if (
    divergences.schemaVersion !== 1 ||
    divergences.family !== declaration.family ||
    !Array.isArray(divergences.entries)
  )
    throw new Error('Invalid divergence register')
  unique(divergences.entries, 'file', 'divergence')
  const source =
    suppliedSource ?? (await createPinnedSource({ repoRoot, commit: declaration.oracleCommit }))
  if (source.commit !== declaration.oracleCommit) throw new Error('Pinned source commit mismatch')
  const required = new Set(selected.requiredSources ?? [])
  for (const prefix of selected.sourcePrefixes ?? []) {
    safeRelative(prefix)
    const files = source
      .listFiles()
      .filter(
        file =>
          file.startsWith(`${prefix}/`) &&
          !/(^|\/)(dist|node_modules|\.git)(\/|$)/u.test(file) &&
          !file.endsWith('/.npmignore'),
      )
    if (!files.length) throw new Error(`Empty pinned source prefix: ${prefix}`)
    for (const file of files) required.add(file)
  }
  if (!required.size) throw new Error(`Empty required closure: ${scope}`)
  source.prefetch?.([...required])
  const bySource = new Map(declaration.copies.map(row => [row.source, row]))
  const rows = []
  for (const file of required) {
    safeRelative(file)
    const row = bySource.get(file)
    if (!row) throw new Error(`Incomplete declared closure: ${file}`)
    rows.push(row)
  }
  const declarationDigest = compatibleDeclarationDigest(declaration, scope, rows)
  if (selected.status !== 'ready' && !(allowPending && selected.status === 'pending-m3'))
    throw new Error(
      `Scope ${scope} remains ${selected.status}; copied family acceptance is pending`,
    )
  const adapters = selected.adapters ?? []
  unique(adapters, 'destination', 'adapter')
  const copiedDestinations = new Set(declaration.copies.map(row => row.destination))
  const adapterMap = new Map()
  for (const adapter of adapters) {
    if (copiedDestinations.has(adapter.destination) || !adapter.reason?.trim())
      throw new Error(`Invalid canonical adapter: ${adapter.destination}`)
    const bytes = await readFile(await safeTarget(workspaceRoot, adapter.destination))
    if (sha256(bytes) !== adapter.sha256)
      throw new Error(`Adapter hash mismatch: ${adapter.destination}`)
    adapterMap.set(adapter.destination, adapter)
  }
  const records = []
  for (const row of rows) {
    const pinned = await source.read(row.source)
    if (row.sha256Mk2 !== pinned.sha256)
      throw new Error(`Pinned source hash mismatch: ${row.source}`)
    const rewritten = rewriteSource(pinned.bytes.toString('utf8'), row.rewrites ?? [], row.source)
    const divergence = divergences.entries.find(entry => entry.file === row.destination)
    const adapted = await applyDivergence(rewritten.text, divergence, workspaceRoot)
    const bytes = !row.rewrites?.length && !divergence ? pinned.bytes : Buffer.from(adapted.text)
    if (row.sha256Mk3 !== sha256(bytes))
      throw new Error(`Declared destination hash mismatch: ${row.destination}`)
    records.push({
      mk2Path: row.source,
      destination: row.destination,
      sha256Mk2: pinned.sha256,
      sha256Mk3: sha256(bytes),
      gitBlob: pinned.gitBlob,
      rewrites: rewritten.evidence,
      divergence: adapted.evidence,
      text: adapted.text,
      bytes,
      original: pinned.bytes.toString('utf8'),
    })
  }
  for (const divergence of divergences.entries)
    if (!copiedDestinations.has(divergence.file))
      throw new Error(`Divergence has no canonical copy: ${divergence.file}`)
  const destinations = new Map(records.map(row => [row.destination, row]))
  const dependencies = selected.dependencies ?? []
  const dependencyMap = new Map()
  for (const dependency of dependencies) {
    if (
      !dependency.specifier ||
      dependencyMap.has(dependency.specifier) ||
      !dependency.reason?.trim()
    )
      throw new Error('Invalid/duplicate declared bare dependency')
    if (dependency.kind === 'node-builtin') {
      if (!builtinModules.includes(dependency.specifier.replace(/^node:/u, '')))
        throw new Error(`Unknown declared builtin: ${dependency.specifier}`)
    } else {
      if (!dependency.manifest || !dependency.version)
        throw new Error('Declared dependency needs manifest and version')
      const manifest = JSON.parse(
        await readFile(await safeTarget(workspaceRoot, dependency.manifest), 'utf8'),
      )
      if (manifest.version !== dependency.version || manifest.name !== dependency.package)
        throw new Error(`Dependency identity mismatch: ${dependency.specifier}`)
    }
    dependencyMap.set(dependency.specifier, dependency)
    for (const asset of dependency.assets ?? []) {
      if (sha256(await readFile(await safeTarget(workspaceRoot, asset.path))) !== asset.sha256)
        throw new Error(`Dependency asset hash mismatch: ${asset.path}`)
    }
  }
  const importDispositions = selected.importDispositions ?? []
  const dispositionMap = new Map()
  const dispositionUses = new Map()
  for (const disposition of importDispositions) {
    safeRelative(disposition.source)
    const hasSpecifier =
      typeof disposition.specifier === 'string' && disposition.specifier.length > 0
    const hasExpression =
      typeof disposition.expression === 'string' && disposition.expression.length > 0
    if (
      disposition.kind !== 'copied-unwired' ||
      hasSpecifier === hasExpression ||
      (hasExpression && disposition.destinationSpecifier !== undefined) ||
      (disposition.destinationSpecifier !== undefined &&
        (typeof disposition.destinationSpecifier !== 'string' ||
          !disposition.destinationSpecifier.length)) ||
      !disposition.reason?.trim() ||
      !Number.isInteger(disposition.count) ||
      disposition.count < 1
    )
      throw new Error('Invalid import disposition')
    const target = hasSpecifier ? disposition.specifier : `expression:${disposition.expression}`
    const key = `${disposition.source}\0${target}`
    if (dispositionMap.has(key)) throw new Error(`Duplicate import disposition: ${key}`)
    dispositionMap.set(key, disposition)
    dispositionUses.set(key, 0)
  }
  const closure = []
  const dynamicImports = selected.dynamicImports ?? []
  const resolveDynamic = (item, row) => {
    if (item.specifier !== null) return item.specifier
    const dispositionToken = `expression:${item.expression}`
    if (dispositionMap.has(`${row.mk2Path}\0${dispositionToken}`)) return dispositionToken
    const bindings = dynamicImports.filter(
      binding => binding.source === row.mk2Path && binding.expression === item.expression,
    )
    if (
      bindings.length !== 1 ||
      !bindings[0].reason?.trim() ||
      !dependencyMap.has(bindings[0].specifier)
    )
      throw new Error(`Undeclared computed import: ${row.mk2Path} -> ${item.expression}`)
    return bindings[0].specifier
  }
  for (const row of records) {
    const before = importsOf(row.original, row.mk2Path)
    const after = importsOf(row.text, row.destination)
    if (before.length !== after.length)
      throw new Error(
        `Divergence changed import topology without a declared adapter: ${row.destination}`,
      )
    for (let index = 0; index < before.length; index++) {
      const oldDispositionTarget =
        before[index].specifier ?? `expression:${before[index].expression}`
      const oldImport = resolveDynamic(before[index], row)
      const newImport = resolveDynamic(after[index], row)
      const dispositionKey = `${row.mk2Path}\0${oldDispositionTarget}`
      const disposition = dispositionMap.get(dispositionKey) ?? null
      if (disposition) dispositionUses.set(dispositionKey, dispositionUses.get(dispositionKey) + 1)
      if (disposition && newImport !== (disposition.destinationSpecifier ?? oldImport))
        throw new Error(`Import disposition destination mismatch: ${row.mk2Path} -> ${newImport}`)
      let sourceTarget = null
      if (oldImport.startsWith('.')) {
        sourceTarget = candidates(row.mk2Path, oldImport).find(file => source.has(file)) ?? null
        if (!sourceTarget && !disposition)
          throw new Error(`Unresolved pinned relative import: ${row.mk2Path} -> ${oldImport}`)
        if (sourceTarget && !required.has(sourceTarget) && !disposition)
          throw new Error(
            `Incomplete type/runtime import closure: ${row.mk2Path} -> ${sourceTarget}`,
          )
      }
      let destinationTarget
      if (newImport.startsWith('.')) {
        destinationTarget = candidates(row.destination, newImport).find(
          file => destinations.has(file) || adapterMap.has(file),
        )
        if (!destinationTarget && disposition) destinationTarget = `copied-unwired:${newImport}`
        else if (!destinationTarget)
          throw new Error(`Unresolved copied relative import: ${row.destination} -> ${newImport}`)
        if (
          sourceTarget &&
          required.has(sourceTarget) &&
          bySource.get(sourceTarget)?.destination !== destinationTarget
        )
          throw new Error(`Noncanonical import relocation: ${row.destination} -> ${newImport}`)
      } else {
        if (!dependencyMap.has(newImport)) {
          if (!disposition)
            throw new Error(`Undeclared bare module: ${row.destination} -> ${newImport}`)
          destinationTarget = `copied-unwired:${newImport}`
        } else {
          destinationTarget = `dependency:${newImport}`
          if (sourceTarget)
            destinationTarget = await canonicalPackageExport(
              dependencyMap.get(newImport),
              sourceTarget,
              bySource,
              workspaceRoot,
            )
        }
      }
      const sourceCodec = codecOwner(row.mk2Path)
      const targetCodec = sourceTarget ? codecOwner(sourceTarget) : null
      if (sourceCodec && targetCodec && sourceCodec !== targetCodec && !disposition)
        throw new Error(
          `Cross-codec import needs copied-unwired disposition: ${row.mk2Path} -> ${sourceTarget}`,
        )
      closure.push({
        importer: row.mk2Path,
        sourceSpecifier: oldImport,
        destinationSpecifier: newImport,
        sourceTarget,
        destinationTarget,
        ...(disposition ? { disposition } : {}),
      })
    }
  }
  for (const [key, disposition] of dispositionMap) {
    if (!records.some(record => record.mk2Path === disposition.source))
      throw new Error(`Stale import disposition source: ${disposition.source}`)
    if (dispositionUses.get(key) !== disposition.count)
      throw new Error(
        `Import disposition count mismatch: ${disposition.source} -> ${disposition.specifier ?? disposition.expression}`,
      )
  }
  for (const binding of dynamicImports) {
    const row = records.find(record => record.mk2Path === binding.source)
    if (
      !row ||
      !importsOf(row.original, row.mk2Path).some(
        item => item.specifier === null && item.expression === binding.expression,
      )
    )
      throw new Error(`Stale dynamic import binding: ${binding.source}`)
  }
  for (const adapter of adapters) {
    const text = await readFile(await safeTarget(workspaceRoot, adapter.destination), 'utf8')
    for (const item of importsOf(text, adapter.destination)) {
      if (item.specifier === null)
        throw new Error(`Undeclared adapter computed import: ${adapter.destination}`)
      if (item.specifier.startsWith('.')) {
        if (
          !candidates(adapter.destination, item.specifier).some(
            file => destinations.has(file) || adapterMap.has(file),
          )
        )
          throw new Error(
            `Unresolved adapter relative import: ${adapter.destination} -> ${item.specifier}`,
          )
      } else if (!dependencyMap.has(item.specifier))
        throw new Error(
          `Undeclared adapter dependency: ${adapter.destination} -> ${item.specifier}`,
        )
    }
  }
  const provenance = {
    schemaVersion: 1,
    family: declaration.family,
    scope,
    oracleCommit: declaration.oracleCommit,
    declarationDigest,
    divergenceDigest: digestManifest(divergences),
    copiedAt: selected.copiedAt,
    adapters,
    dependencies,
    dynamicImports,
    ...(importDispositions.length ? { importDispositions } : {}),
    closure,
    files: records.map(record => ({
      mk2Path: record.mk2Path,
      destination: record.destination,
      sha256Mk2: record.sha256Mk2,
      sha256Mk3: record.sha256Mk3,
      gitBlob: record.gitBlob,
      rewrites: record.rewrites,
      divergence: record.divergence,
    })),
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(provenance.copiedAt ?? ''))
    throw new Error('Explicit provenance copy date required')
  return { records, provenance, provenancePath: safeRelative(selected.provenance), workspaceRoot }
}

export async function checkCopies(prepared, { checkProvenance = true } = {}) {
  for (const record of prepared.records) {
    const target = await safeTarget(prepared.workspaceRoot, record.destination)
    if (sha256(await readFile(target)) !== record.sha256Mk3)
      throw new Error(`Missing/tampered canonical copy: ${record.destination}`)
  }
  if (checkProvenance) {
    const actual = JSON.parse(
      await readFile(await safeTarget(prepared.workspaceRoot, prepared.provenancePath), 'utf8'),
    )
    if (digestManifest(actual) !== digestManifest(prepared.provenance))
      throw new Error('Provenance differs from reconstructed pinned closure')
  }
  return {
    scope: prepared.provenance.scope,
    files: prepared.records.length,
    imports: prepared.provenance.closure.length,
  }
}

export async function writeCopies(prepared, { provenanceOnly = false } = {}) {
  if (provenanceOnly) await checkCopies(prepared, { checkProvenance: false })
  else {
    // Preflight every existing target before the first write; refuse silent replacement.
    for (const record of prepared.records) {
      const target = await safeTarget(prepared.workspaceRoot, record.destination)
      try {
        if (sha256(await readFile(target)) !== record.sha256Mk3)
          throw new Error(`Refusing to overwrite divergent destination: ${record.destination}`)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    for (const record of prepared.records) {
      const target = await safeTarget(prepared.workspaceRoot, record.destination)
      await mkdir(path.dirname(target), { recursive: true })
      try {
        await writeFile(target, record.bytes, { flag: 'wx' })
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
    }
  }
  const target = await safeTarget(prepared.workspaceRoot, prepared.provenancePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(prepared.provenance, null, 2)}\n`)
  return checkCopies(prepared)
}

export async function copyCli(mode, argv = process.argv.slice(2)) {
  const values = new Map()
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]
    if (
      ![
        '--family',
        '--scope',
        '--root',
        '--source-root',
        '--declaration',
        '--divergences',
        '--provenance-only',
        '--dry-run',
      ].includes(key) ||
      values.has(key)
    )
      throw new Error(`Unknown/duplicate option: ${key}`)
    if (key === '--provenance-only' || key === '--dry-run') values.set(key, true)
    else {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing ${key} value`)
      values.set(key, value)
    }
  }
  if (values.get('--family') !== 'sc2') throw new Error('Explicit --family sc2 required')
  if (mode === 'check' && (values.has('--dry-run') || values.has('--provenance-only')))
    throw new Error('Check requires actual copies and provenance; copy-only flags are invalid')
  const workspaceRoot = path.resolve(
    values.get('--root') ?? fileURLToPath(new URL('../../../..', import.meta.url)),
  )
  const declaration = JSON.parse(
    await readFile(
      values.get('--declaration') ??
        path.join(workspaceRoot, 'modkit-core/migration/mk2-copy/sc2.json'),
      'utf8',
    ),
  )
  const divergences = JSON.parse(
    await readFile(
      values.get('--divergences') ??
        path.join(workspaceRoot, 'modkit-core/migration/mk2-divergence/sc2.json'),
      'utf8',
    ),
  )
  const prepared = await prepareCopy({
    declaration,
    divergences,
    scope: values.get('--scope'),
    workspaceRoot,
    repoRoot: values.get('--source-root') ?? path.join(workspaceRoot, 'references/modkitmk2'),
    allowPending: values.has('--dry-run'),
  })
  const result = values.has('--dry-run')
    ? { scope: prepared.provenance.scope, files: prepared.records.length, dryRun: true }
    : mode === 'check'
      ? await checkCopies(prepared)
      : await writeCopies(prepared, { provenanceOnly: values.has('--provenance-only') })
  console.log(JSON.stringify(result))
}
