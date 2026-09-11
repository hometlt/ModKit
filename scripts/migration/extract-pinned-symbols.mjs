import path from 'node:path'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createPinnedSource, MK2_PIN, sha256 } from './lib/legacy-oracle.mjs'

const repository = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const args = process.argv.slice(2)
const check = args.includes('--check')
const configIndex = args.indexOf('--config')
if (configIndex < 0 || !args[configIndex + 1])
  throw new Error(
    'usage: extract-pinned-symbols --config <file> [--destination-root <package-repository>] [--check]',
  )
const configPath = path.resolve(args[configIndex + 1])
const config = JSON.parse(await readFile(configPath, 'utf8'))
const destinationIndex = args.indexOf('--destination-root')
if (destinationIndex >= 0 && !args[destinationIndex + 1])
  throw new Error('--destination-root requires an explicit package repository directory')
const destinationRoot = destinationIndex < 0 ? repository : path.resolve(args[destinationIndex + 1])
if (!(await stat(path.join(destinationRoot, 'package.json'))).isFile())
  throw new Error('the extraction destination must be a package repository')
if (config.schemaVersion !== 1 || config.commit !== MK2_PIN)
  throw new Error('symbol extraction requires the declared immutable MK2 pin')

function destination(relative) {
  const target = path.resolve(destinationRoot, relative)
  const rel = path.relative(destinationRoot, target)
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    throw new Error(
      destinationIndex < 0
        ? 'symbol extraction target must remain inside this repository'
        : 'symbol extraction target must remain inside the destination repository',
    )
  return target
}
function namedDeclarations(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
  if (file.parseDiagnostics.length) throw new Error(`cannot parse pinned ${filename}`)
  const found = new Map()
  for (const statement of file.statements) {
    let names = []
    if (statement.name && ts.isIdentifier(statement.name)) names = [statement.name.text]
    else if (ts.isVariableStatement(statement))
      names = statement.declarationList.declarations.map(item =>
        ts.isIdentifier(item.name) ? item.name.text : undefined,
      )
    for (const name of names) {
      if (name === undefined) continue
      const declarations = found.get(name) ?? []
      declarations.push(statement.getText(file))
      found.set(name, declarations)
    }
  }
  return found
}

const pinned = await createPinnedSource({
  repoRoot: path.resolve(repository, '../references/modkitmk2'),
  commit: config.commit,
  observeWorkingTree: false,
})
const pieces = []
const sources = []
const allNames = new Set()
for (const selection of config.sources) {
  const blob = await pinned.read(selection.path)
  const declarations = namedDeclarations(blob.bytes.toString('utf8'), selection.path)
  const symbols = []
  for (const name of selection.symbols) {
    if (allNames.has(name)) throw new Error(`duplicate selected symbol ${name}`)
    allNames.add(name)
    const selected = declarations.get(name)
    if (selected === undefined) throw new Error(`missing pinned ${selection.path}:${name}`)
    const declaration = selected.join('\n')
    pieces.push(declaration)
    symbols.push({ name, sha256: sha256(declaration) })
  }
  sources.push({ path: selection.path, sha256: sha256(blob.bytes), symbols })
}
const output = [
  '// Generated from immutable MK2 declarations. Change the strict adapter, not these algorithms.',
  `// Source selection: ${path.relative(destinationRoot, configPath).replaceAll('\\', '/')}`,
  ...config.imports,
  '',
  ...pieces.flatMap(piece => [piece, '']),
  `export { ${config.exports.join(', ')} }`,
  '',
].join('\n')
const receipt =
  JSON.stringify(
    {
      schemaVersion: 1,
      commit: config.commit,
      transformation:
        'exact top-level declaration extraction; explicit import bindings and export list only',
      sources,
      imports: config.imports,
      exports: config.exports,
      output: { path: config.output, sha256: sha256(output) },
    },
    null,
    2,
  ) + '\n'
const outputs = [
  [config.output, output],
  [config.provenance, receipt],
].map(([relative, content]) => ({ relative, content, target: destination(relative) }))
for (const { relative, content, target } of outputs) {
  if (check) {
    if ((await readFile(target, 'utf8')) !== content)
      throw new Error(`pinned extraction differs: ${relative}`)
  } else {
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}
console.log(
  `${check ? 'verified' : 'extracted'} ${allNames.size} pinned declarations: ${config.output}`,
)
