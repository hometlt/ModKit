import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import ts from 'typescript'
import { sha256 } from './legacy-oracle.mjs'

export const algorithmPattern =
  /^(?:crc32|adler32|inflate\w*|mpqHash|parseXml\w*|boundsOf|decodeBc\w*|decodeAdpcm\w*|sha1\w*|md5\w*)$/iu
export const algorithmRepositories = [
  'modkit-core',
  'modkit-extensions-blizzard',
  'modkit-extensions-ea',
  'modkit-extensions-other',
  'modkit-extensions-spring',
  'modkit-extensions-warzone',
]
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-app',
  'build',
  'out',
  'coverage',
  'vendor',
  'test',
  'tests',
  '__tests__',
  'fixtures',
  'artifacts',
  'reports', // Versioned evidence snapshots are not product implementations.
  '.cache',
  '.turbo',
])

/** Definitions only: calls, comments, strings and imported declarations are not implementations. */
export function algorithmDefinitions(text, filename) {
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
  if (file.parseDiagnostics.length) throw new Error(`Cannot parse algorithm source: ${filename}`)
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
  const definitions = []
  const counts = new Map()
  function visit(node, parents) {
    let name
    let body
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      node.body
    ) {
      name = node.name.getText(file).replace(/^['"]|['"]$/gu, '')
      body = node.body
    } else if (
      (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name.getText(file).replace(/^['"]|['"]$/gu, '')
      body = node.initializer.body
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isArrowFunction(node.right) || ts.isFunctionExpression(node.right))
    ) {
      name = ts.isPropertyAccessExpression(node.left)
        ? node.left.name.text
        : ts.isElementAccessExpression(node.left) &&
            ts.isStringLiteral(node.left.argumentExpression)
          ? node.left.argumentExpression.text
          : node.left.getText(file)
      body = node.right.body
    }
    if (name && body && algorithmPattern.test(name)) {
      const symbol = [...parents, name].join('.')
      const ordinal = counts.get(symbol) ?? 0
      counts.set(symbol, ordinal + 1)
      definitions.push({
        symbol: `${symbol}#${ordinal}`,
        name,
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        implementationSha256: sha256(printer.printNode(ts.EmitHint.Unspecified, node, file)),
      })
    }
    const container =
      (ts.isClassDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isModuleDeclaration(node)) &&
      node.name
        ? node.name.getText(file)
        : null
    ts.forEachChild(node, child => visit(child, container ? [...parents, container] : parents))
  }
  visit(file, [])
  return definitions
}

export async function scanAlgorithms({
  workspaceRoot,
  repositories = algorithmRepositories,
  canonicalFiles = [],
}) {
  const canonical = new Map()
  const sourceDestinations = new Map()
  for (const record of canonicalFiles) {
    if (canonical.has(record.destination))
      throw new Error(`Duplicate canonical algorithm destination: ${record.destination}`)
    if (sourceDestinations.has(record.mk2Path))
      throw new Error(`Multiple canonical paths for source: ${record.mk2Path}`)
    canonical.set(record.destination, record)
    sourceDestinations.set(record.mk2Path, record.destination)
  }
  const implementations = []
  const scanned = []
  for (const repository of repositories) {
    let sourceFiles = 0
    async function visit(relative) {
      const entries = await readdir(path.join(workspaceRoot, relative), { withFileTypes: true })
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const file = `${relative}/${entry.name}`
        // Archived pre-externalization fixtures are historical evidence, not active repository code.
        if (
          file.startsWith(`${repository}/migration/history/`) ||
          file === `${repository}/migration/history`
        )
          continue
        if (entry.isDirectory()) {
          if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith('.')) await visit(file)
        } else if (
          /\.[cm]?[jt]sx?$/u.test(entry.name) &&
          !/\.d\.[cm]?ts$/u.test(entry.name) &&
          !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)
        ) {
          sourceFiles++
          const bytes = await readFile(path.join(workspaceRoot, file))
          const known = canonical.get(file)
          if (known && sha256(bytes) !== known.sha256Mk3)
            throw new Error(`Canonical algorithm copy hash mismatch: ${file}`)
          for (const definition of algorithmDefinitions(bytes.toString('utf8'), file))
            implementations.push({
              id: `${file}:${definition.symbol}`,
              repository,
              path: file,
              ...definition,
              disposition: known ? 'canonical-copy' : 'existing-debt',
              ...(known ? { mk2Path: known.mk2Path } : {}),
            })
        }
      }
    }
    await visit(repository)
    if (!sourceFiles) throw new Error(`Empty repository algorithm scan: ${repository}`)
    scanned.push({ repository, sourceFiles })
  }
  implementations.sort((a, b) => a.id.localeCompare(b.id))
  return { schemaVersion: 1, scanned, implementations }
}

export function checkAlgorithmDebt(current, baseline) {
  if (
    baseline.schemaVersion !== 1 ||
    !Array.isArray(baseline.implementations) ||
    !baseline.implementations.length
  )
    throw new Error('Empty/invalid algorithm baseline')
  if (
    JSON.stringify(current.scanned.map(row => row.repository)) !==
    JSON.stringify(baseline.scanned.map(row => row.repository))
  )
    throw new Error('Algorithm repository scope differs from baseline')
  const previous = new Map()
  for (const row of baseline.implementations) {
    if (previous.has(row.id)) throw new Error(`Duplicate baseline algorithm: ${row.id}`)
    previous.set(row.id, row)
  }
  const failures = []
  for (const row of current.implementations) {
    if (row.disposition === 'canonical-copy') continue
    const old = previous.get(row.id)
    if (!old || old.disposition !== 'existing-debt')
      failures.push(`New undeclared algorithm implementation: ${row.id}`)
    else if (old.implementationSha256 !== row.implementationSha256)
      failures.push(`Existing algorithm debt changed without migration: ${row.id}`)
  }
  return {
    failures,
    debt: current.implementations.filter(row => row.disposition === 'existing-debt').length,
    canonical: current.implementations.filter(row => row.disposition === 'canonical-copy').length,
    retired: baseline.implementations
      .filter(
        row =>
          row.disposition === 'existing-debt' &&
          !current.implementations.some(
            item => item.id === row.id && item.disposition === 'existing-debt',
          ),
      )
      .map(row => row.id),
  }
}

/** A checked-in debt allowance can only shrink; editing its JSON cannot bless a new peer. */
export function checkBaselineRatchet(baseline, previous) {
  const oldDebt = new Map(
    previous.implementations
      .filter(row => row.disposition === 'existing-debt')
      .map(row => [row.id, row]),
  )
  const failures = []
  for (const row of baseline.implementations.filter(item => item.disposition === 'existing-debt')) {
    const old = oldDebt.get(row.id)
    if (!old) failures.push(`Baseline introduces algorithm debt: ${row.id}`)
    else if (old.implementationSha256 !== row.implementationSha256)
      failures.push(`Baseline changes existing algorithm allowance: ${row.id}`)
  }
  return failures
}
