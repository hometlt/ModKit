import path from 'node:path'
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import { createPinnedSource, MK2_PIN, sha256, digestManifest } from './legacy-oracle.mjs'
import {
  SC2_M3_REFREEZE_PIN,
  SC2_M3_SELECTOR_VERSION,
  sc2M3FamilyPlanDigest,
} from './sc2-m3-refreeze.mjs'

// Both families share one MK2 checkout/oracle commit; each keeps its own declaration/ledger file
// and 'family'-named scope semantics (SC2_M3_REFREEZE_PIN etc.) stay exclusive to 'sc2'.
export const PINNED_DECLARATION_FAMILIES = new Set(['sc2', 'ea'])

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
    'sc2-m1-libs-2026-10-02',
    {
      family: 'sc2',
      scopeName: 'm1-libs',
      oracleCommit: MK2_PIN,
      scopeDigest: '2f8200d15d6aa78fac6b11a09aebd27bfc72c5ad43adf1ddd381ed357dc909f6',
      legacyDeclarationDigest: '2f8200d15d6aa78fac6b11a09aebd27bfc72c5ad43adf1ddd381ed357dc909f6',
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
      const originalDeclarations = occurrences.map(match =>
        originalAst.statements.find(node => node.getStart(originalAst) === match.index),
      )
      if (
        replacementAst.parseDiagnostics.length ||
        replacementAst.statements.length !== 1 ||
        !ts.isImportDeclaration(replacement) ||
        !replacement.importClause ||
        !originalDeclarations.every(node => node && ts.isImportDeclaration(node))
      )
        throw new Error(`Invalid import-type rewrite: ${filename}`)
      if (originalDeclarations.some(node => node?.getText(originalAst) !== from))
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
    } else if (kind === 'export-type') {
      if (rewrite.count !== undefined && rewrite.count !== occurrences.length)
        throw new Error(`Rewrite occurrence mismatch: ${filename}: ${from}`)
      const parse = input =>
        ts.createSourceFile(filename, input, ts.ScriptTarget.Latest, true).statements[0]
      const originalExport = parse(from)
      const replacementExport = parse(to)
      const named = node =>
        node &&
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements
          : null
      const beforeElements = named(originalExport)
      const afterElements = named(replacementExport)
      if (
        !beforeElements ||
        !afterElements ||
        originalExport.moduleSpecifier.text !== replacementExport.moduleSpecifier.text ||
        beforeElements.length !== afterElements.length ||
        !beforeElements.every(
          (element, index) =>
            element.name.text === afterElements[index].name.text &&
            element.propertyName?.text === afterElements[index].propertyName?.text &&
            (!element.isTypeOnly || afterElements[index].isTypeOnly),
        ) ||
        !afterElements.some(
          (element, index) => element.isTypeOnly && !beforeElements[index].isTypeOnly,
        )
      )
        throw new Error(`Invalid export-type rewrite: ${filename}`)
      if (
        occurrences.some(
          match =>
            !ts
              .createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
              .statements.some(
                node =>
                  ts.isExportDeclaration(node) &&
                  node.getStart() === match.index &&
                  node.getText() === from,
              ),
        )
      )
        throw new Error(`Type rewrite must cover an exact export declaration: ${filename}`)
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

const declarationRewriteKeys = [
  'from',
  'mode',
  'proof',
  'reason',
  'targetExceptions',
  'to',
  'typeElisions',
]
const declarationBindingKeys = ['form', 'imported', 'local', 'typeOnly']
const declarationTargetKeys = [
  'destinationSpecifier',
  'form',
  'imported',
  'kind',
  'local',
  'sourceSpecifier',
  'typeOnly',
]
const declarationElisionKeys = declarationTargetKeys.filter(key => key !== 'destinationSpecifier')

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw new Error(`Invalid ${label}`)
}

function declarationComments(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  const comments = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan())
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    )
      comments.push({
        start: scanner.getTokenPos(),
        end: scanner.getTextPos(),
      })
  return comments
}

function declarationBinding(form, imported, local, typeOnly) {
  return { form, imported, local, typeOnly }
}

function importDeclarationBindings(node) {
  const clause = node.importClause
  if (!clause) throw new Error('Side-effect import is not declaration-bound')
  const bindings = []
  if (clause.name)
    bindings.push(declarationBinding('default', 'default', clause.name.text, clause.isTypeOnly))
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
    bindings.push(
      declarationBinding('namespace', '*', clause.namedBindings.name.text, clause.isTypeOnly),
    )
  else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
    for (const item of clause.namedBindings.elements)
      bindings.push(
        declarationBinding(
          'named',
          item.propertyName?.text ?? item.name.text,
          item.name.text,
          clause.isTypeOnly || item.isTypeOnly,
        ),
      )
  if (!bindings.length) throw new Error('Import declaration has no explicit bindings')
  return bindings
}

function exportDeclarationBindings(node) {
  if (!node.exportClause || !ts.isNamedExports(node.exportClause))
    throw new Error('Only named re-export declarations are declaration-bound')
  const bindings = node.exportClause.elements.map(item =>
    declarationBinding(
      'named',
      item.propertyName?.text ?? item.name.text,
      item.name.text,
      Boolean(node.isTypeOnly || item.isTypeOnly),
    ),
  )
  if (!bindings.length) throw new Error('Re-export declaration has no explicit bindings')
  return bindings
}

function parsedDeclarationBlock(text, filename, allowEmpty = false) {
  if (!text.length) {
    if (allowEmpty) return { manifest: [], nodes: [] }
    throw new Error(`Empty declaration block: ${filename}`)
  }
  const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
  if (ast.parseDiagnostics.length) throw new Error(`Cannot parse declaration block: ${filename}`)
  if (!ast.statements.length) {
    if (allowEmpty && !text.trim()) return { manifest: [], nodes: [] }
    throw new Error(`Empty declaration block: ${filename}`)
  }
  const manifest = []
  for (const node of ast.statements) {
    if (
      (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
      !node.moduleSpecifier ||
      !ts.isStringLiteralLike(node.moduleSpecifier) ||
      node.attributes ||
      node.assertClause
    )
      throw new Error(`Declaration block contains non-static import/export: ${filename}`)
    manifest.push({
      kind: ts.isImportDeclaration(node) ? 'import' : 'reexport',
      moduleSpecifier: node.moduleSpecifier.text,
      bindings: ts.isImportDeclaration(node)
        ? importDeclarationBindings(node)
        : exportDeclarationBindings(node),
    })
  }
  return { manifest, nodes: [...ast.statements] }
}

export function importDeclarationManifest(text, filename = 'source.ts', allowEmpty = false) {
  return parsedDeclarationBlock(text, filename, allowEmpty).manifest
}

function validateDeclarationBinding(value, label) {
  exactObject(value, declarationBindingKeys, label)
  if (!['default', 'named', 'namespace'].includes(value.form)) throw new Error(`Invalid ${label}`)
  if (
    typeof value.imported !== 'string' ||
    !value.imported ||
    typeof value.local !== 'string' ||
    !value.local ||
    typeof value.typeOnly !== 'boolean'
  )
    throw new Error(`Invalid ${label}`)
}

function validateDeclaration(value, label) {
  exactObject(value, ['bindings', 'kind', 'moduleSpecifier'], label)
  if (
    !['import', 'reexport'].includes(value.kind) ||
    typeof value.moduleSpecifier !== 'string' ||
    !value.moduleSpecifier ||
    value.moduleSpecifier.includes('*') ||
    !Array.isArray(value.bindings) ||
    !value.bindings.length
  )
    throw new Error(`Invalid ${label}`)
  value.bindings.forEach((binding, index) =>
    validateDeclarationBinding(binding, `${label} binding ${index}`),
  )
}

function validateDeclarationTarget(value, label, elision = false) {
  exactObject(value, elision ? declarationElisionKeys : declarationTargetKeys, label)
  if (
    (value.kind !== 'import' && value.kind !== 'reexport') ||
    (elision && value.kind !== 'import') ||
    !['default', 'named', 'namespace'].includes(value.form) ||
    typeof value.sourceSpecifier !== 'string' ||
    !value.sourceSpecifier ||
    value.sourceSpecifier.includes('*') ||
    (!elision &&
      (typeof value.destinationSpecifier !== 'string' ||
        !value.destinationSpecifier ||
        value.destinationSpecifier.includes('*'))) ||
    typeof value.imported !== 'string' ||
    !value.imported ||
    typeof value.local !== 'string' ||
    !value.local ||
    typeof value.typeOnly !== 'boolean' ||
    (elision && !value.typeOnly)
  )
    throw new Error(`Invalid ${label}`)
}

function validateDeclarationRewriteShape(rewrite, filename) {
  exactObject(rewrite, declarationRewriteKeys, `declaration rewrite: ${filename}`)
  if (
    !['binding-preserving', 'type-only-elision'].includes(rewrite.mode) ||
    typeof rewrite.reason !== 'string' ||
    !rewrite.reason.trim() ||
    !Array.isArray(rewrite.proof) ||
    !rewrite.proof.length
  )
    throw new Error(`Invalid declaration rewrite: ${filename}`)
  for (const proof of rewrite.proof) {
    exactObject(proof, ['path', 'sha256'], `declaration rewrite proof: ${filename}`)
    safeRelative(proof.path)
    if (!/^[a-f0-9]{64}$/u.test(proof.sha256 ?? ''))
      throw new Error(`Invalid declaration rewrite proof: ${filename}`)
  }
  exactObject(rewrite.from, ['count', 'declarations', 'sha256Before', 'text'], 'declaration from')
  exactObject(rewrite.to, ['declarations', 'sha256After', 'text'], 'declaration to')
  if (
    typeof rewrite.from.text !== 'string' ||
    !rewrite.from.text ||
    rewrite.from.count !== 1 ||
    !/^[a-f0-9]{64}$/u.test(rewrite.from.sha256Before ?? '') ||
    !Array.isArray(rewrite.from.declarations) ||
    !rewrite.from.declarations.length ||
    typeof rewrite.to.text !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(rewrite.to.sha256After ?? '') ||
    !Array.isArray(rewrite.to.declarations) ||
    !Array.isArray(rewrite.targetExceptions) ||
    !Array.isArray(rewrite.typeElisions)
  )
    throw new Error(`Invalid declaration rewrite: ${filename}`)
  rewrite.from.declarations.forEach((item, index) =>
    validateDeclaration(item, `source declaration ${index}`),
  )
  rewrite.to.declarations.forEach((item, index) =>
    validateDeclaration(item, `destination declaration ${index}`),
  )
  rewrite.targetExceptions.forEach((item, index) =>
    validateDeclarationTarget(item, `target exception ${index}`),
  )
  rewrite.typeElisions.forEach((item, index) =>
    validateDeclarationTarget(item, `type elision ${index}`, true),
  )
  if (
    (rewrite.mode === 'binding-preserving' && rewrite.typeElisions.length) ||
    (rewrite.mode === 'type-only-elision' && !rewrite.typeElisions.length)
  )
    throw new Error(`Invalid declaration rewrite mode: ${filename}`)
}

const declarationIdentity = (declaration, binding) =>
  JSON.stringify({
    kind: declaration.kind,
    form: binding.form,
    imported: binding.imported,
    local: binding.local,
    typeOnly: binding.typeOnly,
  })

function declarationCommentBindings(text, parsed, filename) {
  const comments = declarationComments(text)
  const claimed = new Set()
  const bindings = []
  parsed.nodes.forEach((node, index) => {
    const start = node.getStart()
    const leadingStart = index ? parsed.nodes[index - 1].end : 0
    const leading = comments.filter((comment, commentIndex) => {
      if (comment.start < leadingStart || comment.end > start) return false
      claimed.add(commentIndex)
      return true
    })
    if (leading.length)
      bindings.push({
        atBlockStart: index === 0,
        declaration: parsed.manifest[index].bindings.map(binding =>
          declarationIdentity(parsed.manifest[index], binding),
        ),
        trivia: text.slice(leadingStart, start),
      })
  })
  if (claimed.size !== comments.length)
    throw new Error(`Declaration rewrite has unbound comment trivia: ${filename}`)
  return bindings
}

function indexedDeclarationBindings(declarations, label) {
  const bindings = new Map()
  declarations.forEach((declaration, declarationIndex) => {
    for (const binding of declaration.bindings) {
      const key = declarationIdentity(declaration, binding)
      if (bindings.has(key)) throw new Error(`Duplicate declaration binding in ${label}`)
      bindings.set(key, { ...binding, ...declaration, declarationIndex, bindings: undefined })
      delete bindings.get(key).bindings
    }
  })
  return bindings
}

function canonicalDeclarationList(rows) {
  return [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

function exactDeclarationList(actual, expected, label) {
  const keys = actual.map(item => JSON.stringify(item))
  if (new Set(keys).size !== keys.length) throw new Error(`Duplicate declaration rewrite ${label}`)
  if (
    JSON.stringify(canonicalDeclarationList(actual)) !==
    JSON.stringify(canonicalDeclarationList(expected))
  )
    throw new Error(`Declaration rewrite ${label} mismatch`)
}

function declarationException(source, destination) {
  return {
    kind: source.kind,
    form: source.form,
    sourceSpecifier: source.moduleSpecifier,
    destinationSpecifier: destination.moduleSpecifier,
    imported: source.imported,
    local: source.local,
    typeOnly: source.typeOnly,
  }
}

function declarationElision(source) {
  return {
    kind: source.kind,
    form: source.form,
    sourceSpecifier: source.moduleSpecifier,
    imported: source.imported,
    local: source.local,
    typeOnly: source.typeOnly,
  }
}

function declarationEmit(text) {
  return ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      verbatimModuleSyntax: false,
    },
  }).outputText
}

function validateElisionEmit(text, rewrite, parsed, sourceBindings, filename) {
  const elided = new Set(
    rewrite.typeElisions.map(item => declarationIdentity({ kind: item.kind }, item)),
  )
  for (const declaration of parsed.manifest) {
    const keys = declaration.bindings.map(binding => declarationIdentity(declaration, binding))
    const removed = keys.filter(key => elided.has(key))
    if (removed.length && removed.length !== keys.length)
      throw new Error(`Partial declaration binding removal: ${filename}`)
  }
  let block = rewrite.from.text
  for (let index = parsed.nodes.length - 1; index >= 0; index--) {
    const declaration = parsed.manifest[index]
    if (
      declaration.bindings.every(binding => elided.has(declarationIdentity(declaration, binding)))
    ) {
      const node = parsed.nodes[index]
      block = `${block.slice(0, node.getStart())}${block.slice(node.end)}`
    }
  }
  const start = text.indexOf(rewrite.from.text)
  const withoutElision = `${text.slice(0, start)}${block}${text.slice(start + rewrite.from.text.length)}`
  if (declarationEmit(text) !== declarationEmit(withoutElision))
    throw new Error(`Type-only elision changes emitted runtime: ${filename}`)
  return [...sourceBindings.entries()]
    .filter(([key]) => elided.has(key))
    .map(([, binding]) => declarationElision(binding))
}

function validateFinalTypeElisions(elisions, text, filename) {
  if (!elisions.length) return
  const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
  if (ast.parseDiagnostics.length) throw new Error(`Cannot parse type elision result: ${filename}`)
  const names = new Set(elisions.map(item => item.local))
  const localTypes = new Set(
    ast.statements
      .filter(node => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
      .map(node => node.name.text),
  )
  for (const name of names)
    if (!localTypes.has(name))
      throw new Error(`Elided type lacks same-name local declaration: ${filename}: ${name}`)
  const visit = node => {
    if (ts.isIdentifier(node) && names.has(node.text)) {
      const declarationName =
        (ts.isInterfaceDeclaration(node.parent) || ts.isTypeAliasDeclaration(node.parent)) &&
        node.parent.name === node
      let typePosition = declarationName
      for (let parent = node.parent; parent && !typePosition; parent = parent.parent) {
        if (ts.isTypeQueryNode(parent)) break
        if (ts.isTypeNode(parent)) typePosition = true
      }
      if (!typePosition)
        throw new Error(`Elided type has value-position reference: ${filename}: ${node.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
}

/** Exact declaration-only topology changes. Proof, hashes and binding targets are mandatory. */
export async function applyImportDeclarationRewrites(original, rewrites, filename, root) {
  if (!Array.isArray(rewrites)) throw new Error(`Invalid declaration rewrites: ${filename}`)
  let text = original
  let closureGroups = importsOf(original, filename).map((_, sourceImportIndex) => ({
    mappings: [{ sourceImportIndex, binding: null, targetException: null }],
  }))
  const evidence = []
  const typeElisions = []
  for (const rewrite of rewrites) {
    validateDeclarationRewriteShape(rewrite, filename)
    if (sha256(text) !== rewrite.from.sha256Before)
      throw new Error(`Declaration rewrite before hash mismatch: ${filename}`)
    for (const proof of rewrite.proof) {
      const bytes = await readFile(await safeTarget(root, proof.path))
      if (!bytes.length || sha256(bytes) !== proof.sha256)
        throw new Error(`Declaration rewrite proof hash mismatch: ${proof.path}`)
    }
    const source = parsedDeclarationBlock(rewrite.from.text, filename)
    const destination = parsedDeclarationBlock(rewrite.to.text, filename, true)
    if (JSON.stringify(source.manifest) !== JSON.stringify(rewrite.from.declarations))
      throw new Error(`Source declaration manifest mismatch: ${filename}`)
    if (JSON.stringify(destination.manifest) !== JSON.stringify(rewrite.to.declarations))
      throw new Error(`Destination declaration manifest mismatch: ${filename}`)
    if (
      JSON.stringify(declarationCommentBindings(rewrite.from.text, source, filename)) !==
      JSON.stringify(declarationCommentBindings(rewrite.to.text, destination, filename))
    )
      throw new Error(`Declaration rewrite changed comment binding: ${filename}`)
    const blockStart = text.indexOf(rewrite.from.text)
    if (blockStart < 0 || text.split(rewrite.from.text).length - 1 !== 1)
      throw new Error(`Declaration rewrite occurrence mismatch: ${filename}`)
    const beforeImports = importsOf(text, filename)
    if (beforeImports.length !== closureGroups.length)
      throw new Error(`Declaration rewrite closure state mismatch: ${filename}`)
    const blockEnd = blockStart + rewrite.from.text.length
    const sourceIndexes = beforeImports
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.start >= blockStart && item.end <= blockEnd)
      .map(({ index }) => index)
    if (
      sourceIndexes.length !== source.manifest.length ||
      sourceIndexes.some((value, index) => value !== sourceIndexes[0] + index)
    )
      throw new Error(`Declaration rewrite import range mismatch: ${filename}`)
    const sourceBindings = indexedDeclarationBindings(source.manifest, 'source')
    const destinationBindings = indexedDeclarationBindings(destination.manifest, 'destination')
    const added = [...destinationBindings.keys()].filter(key => !sourceBindings.has(key))
    if (added.length) throw new Error(`Declaration rewrite added or changed a binding: ${filename}`)
    const missing = [...sourceBindings.keys()].filter(key => !destinationBindings.has(key))
    if (missing.some(key => !sourceBindings.get(key).typeOnly))
      throw new Error(`Runtime import removal rejected: ${filename}`)
    const expectedExceptions = []
    for (const [key, sourceBinding] of sourceBindings) {
      const destinationBinding = destinationBindings.get(key)
      if (
        destinationBinding &&
        sourceBinding.moduleSpecifier !== destinationBinding.moduleSpecifier
      )
        expectedExceptions.push(declarationException(sourceBinding, destinationBinding))
    }
    const expectedElisions = missing.map(key => declarationElision(sourceBindings.get(key)))
    exactDeclarationList(rewrite.targetExceptions, expectedExceptions, 'target exceptions')
    exactDeclarationList(rewrite.typeElisions, expectedElisions, 'type elisions')
    if (
      (rewrite.mode === 'binding-preserving' && missing.length) ||
      (rewrite.mode === 'type-only-elision' && !missing.length)
    )
      throw new Error(`Declaration rewrite mode mismatch: ${filename}`)

    const sourceByBinding = new Map()
    for (const [key, binding] of sourceBindings) {
      const group = closureGroups[sourceIndexes[binding.declarationIndex]]
      if (!group || group.mappings.length !== 1 || group.mappings[0].binding !== null)
        throw new Error(`Overlapping declaration rewrite: ${filename}`)
      sourceByBinding.set(key, { binding, sourceImportIndex: group.mappings[0].sourceImportIndex })
    }
    const exceptionMap = new Map(
      rewrite.targetExceptions.map(item => [declarationIdentity({ kind: item.kind }, item), item]),
    )
    const destinationGroups = destination.manifest.map(declaration => ({
      mappings: declaration.bindings.map(binding => {
        const key = declarationIdentity(declaration, binding)
        const sourceEntry = sourceByBinding.get(key)
        if (!sourceEntry) throw new Error(`Unmapped destination binding: ${filename}`)
        return {
          sourceImportIndex: sourceEntry.sourceImportIndex,
          binding: { ...binding, kind: declaration.kind },
          sourceSpecifier: sourceEntry.binding.moduleSpecifier,
          destinationSpecifier: declaration.moduleSpecifier,
          targetException: exceptionMap.get(key) ?? null,
        }
      }),
    }))
    const pendingElisions = validateElisionEmit(
      text,
      rewrite,
      source,
      sourceBindings,
      filename,
    ).map(item => {
      const key = declarationIdentity({ kind: item.kind }, item)
      return {
        ...item,
        sourceImportIndex: sourceByBinding.get(key).sourceImportIndex,
      }
    })
    typeElisions.push(...pendingElisions)
    text = `${text.slice(0, blockStart)}${rewrite.to.text}${text.slice(blockEnd)}`
    if (sha256(text) !== rewrite.to.sha256After)
      throw new Error(`Declaration rewrite result hash mismatch: ${filename}`)
    closureGroups = [
      ...closureGroups.slice(0, sourceIndexes[0]),
      ...destinationGroups,
      ...closureGroups.slice(sourceIndexes.at(-1) + 1),
    ]
    if (closureGroups.length !== importsOf(text, filename).length)
      throw new Error(`Declaration rewrite destination range mismatch: ${filename}`)
    evidence.push({ ...rewrite, proof: rewrite.proof.map(proof => ({ ...proof })) })
  }
  return { text, evidence, closureGroups, typeElisions }
}

export function validateImportDeclarationRewriteFinal(rewritten, finalText, filename) {
  if (
    rewritten.evidence.length &&
    JSON.stringify(importsOf(rewritten.text, filename).map(item => item.specifier)) !==
      JSON.stringify(importsOf(finalText, filename).map(item => item.specifier))
  )
    throw new Error(`Divergence changed declaration-rewrite import topology: ${filename}`)
  validateFinalTypeElisions(rewritten.typeElisions, finalText, filename)
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

export async function applyDivergence(text, divergence, root) {
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
async function canonicalPackageExport(
  dependency,
  sourceTarget,
  bySource,
  adapterSourceDestinations,
  workspaceRoot,
) {
  if (
    !Array.isArray(dependency.canonicalSources) ||
    !dependency.canonicalSources.includes(sourceTarget)
  )
    throw new Error(`Canonical copied source replaced by bare dependency: ${sourceTarget}`)
  const destination =
    bySource.get(sourceTarget)?.destination ?? adapterSourceDestinations.get(sourceTarget)
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
    !PINNED_DECLARATION_FAMILIES.has(declaration.family) ||
    declaration.oracleCommit !== MK2_PIN
  )
    throw new Error('Invalid pinned declaration family')
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
    suppliedSource ??
    (await createPinnedSource({
      repoRoot,
      commit: declaration.oracleCommit,
      observeWorkingTree: false,
    }))
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
  const bySource = new Map(declaration.copies.map(row => [row.source, row]))
  const rows = []
  for (const file of required) {
    safeRelative(file)
    const row = bySource.get(file)
    if (!row) throw new Error(`Incomplete declared closure: ${file}`)
    rows.push(row)
  }
  const declarationDigest = compatibleDeclarationDigest(declaration, scope, rows)
  if (scope === 'family') {
    if (
      selected.selectorVersion !== SC2_M3_SELECTOR_VERSION ||
      selected.refreezePin !== SC2_M3_REFREEZE_PIN
    )
      throw new Error('Family scope requires the canonical tracked M3 refreeze pin')
    const pin = JSON.parse(
      await readFile(await safeTarget(workspaceRoot, selected.refreezePin), 'utf8'),
    )
    const planDigest = sc2M3FamilyPlanDigest(declaration, scope, rows)
    if (
      pin.schemaVersion !== 1 ||
      pin.family !== declaration.family ||
      pin.scope !== scope ||
      pin.oracleCommit !== declaration.oracleCommit ||
      pin.selectorVersion !== SC2_M3_SELECTOR_VERSION ||
      pin.planDigest !== planDigest
    )
      throw new Error('Family refreeze pin mismatch')
  }
  source.prefetch?.([...required])
  if (selected.status !== 'ready' && !(allowPending && selected.status === 'pending-m3'))
    throw new Error(
      `Scope ${scope} remains ${selected.status}; copied family acceptance is pending`,
    )
  const adapters = selected.adapters ?? []
  unique(adapters, 'destination', 'adapter')
  const copiedDestinations = new Set(declaration.copies.map(row => row.destination))
  const adapterMap = new Map()
  const adapterSourceDestinations = new Map()
  for (const adapter of adapters) {
    if (copiedDestinations.has(adapter.destination) || !adapter.reason?.trim())
      throw new Error(`Invalid canonical adapter: ${adapter.destination}`)
    const bytes = await readFile(await safeTarget(workspaceRoot, adapter.destination))
    if (sha256(bytes) !== adapter.sha256)
      throw new Error(`Adapter hash mismatch: ${adapter.destination}`)
    adapterMap.set(adapter.destination, adapter)
    for (const sourcePath of adapter.replacesSources ?? []) {
      safeRelative(sourcePath)
      if (
        required.has(sourcePath) ||
        !source.has(sourcePath) ||
        adapterSourceDestinations.has(sourcePath)
      )
        throw new Error(`Invalid adapter source replacement: ${sourcePath}`)
      adapterSourceDestinations.set(sourcePath, adapter.destination)
    }
  }
  const records = []
  for (const row of rows) {
    const pinned = await source.read(row.source)
    if (row.sha256Mk2 !== pinned.sha256)
      throw new Error(`Pinned source hash mismatch: ${row.source}`)
    const rewritten = rewriteSource(pinned.bytes.toString('utf8'), row.rewrites ?? [], row.source)
    if (
      importsOf(pinned.bytes.toString('utf8'), row.source).length !==
      importsOf(rewritten.text, row.source).length
    )
      throw new Error(`Ordinary rewrite changed import topology: ${row.source}`)
    const declarationRewritten = await applyImportDeclarationRewrites(
      rewritten.text,
      row.importDeclarationRewrites ?? [],
      row.source,
      workspaceRoot,
    )
    const divergence = divergences.entries.find(entry => entry.file === row.destination)
    const adapted = await applyDivergence(declarationRewritten.text, divergence, workspaceRoot)
    validateImportDeclarationRewriteFinal(declarationRewritten, adapted.text, row.destination)
    const bytes =
      !row.rewrites?.length && !row.importDeclarationRewrites?.length && !divergence
        ? pinned.bytes
        : Buffer.from(adapted.text)
    if (row.sha256Mk3 !== sha256(bytes))
      throw new Error(`Declared destination hash mismatch: ${row.destination}`)
    let algorithmDisposition
    if (row.algorithmDisposition !== undefined) {
      const candidate = row.algorithmDisposition
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate) ||
        Object.keys(candidate).sort().join(',') !== 'exit,kind,reason,symbol' ||
        candidate.kind !== 'copied-unwired-copy' ||
        !['canonicalize-before-activation', 'classify-delegate-before-activation'].includes(
          candidate.exit,
        ) ||
        typeof candidate.symbol !== 'string' ||
        !candidate.symbol.trim() ||
        typeof candidate.reason !== 'string' ||
        !candidate.reason.trim()
      )
        throw new Error(`Invalid algorithm disposition: ${row.destination}`)
      algorithmDisposition = candidate
    }
    records.push({
      mk2Path: row.source,
      destination: row.destination,
      sha256Mk2: pinned.sha256,
      sha256Mk3: sha256(bytes),
      gitBlob: pinned.gitBlob,
      rewrites: rewritten.evidence,
      importDeclarationRewrites: declarationRewritten.evidence,
      divergence: adapted.evidence,
      text: adapted.text,
      bytes,
      original: pinned.bytes.toString('utf8'),
      closureGroups: declarationRewritten.closureGroups,
      typeElisions: declarationRewritten.typeElisions,
      ...(algorithmDisposition ? { algorithmDisposition } : {}),
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
      if (!selected.acceptancePin && !/^[a-f0-9]{64}$/u.test(dependency.manifestSha256 ?? ''))
        throw new Error(`Unpinned dependency manifest: ${dependency.specifier}`)
      const manifestBytes = await readFile(await safeTarget(workspaceRoot, dependency.manifest))
      if (
        dependency.manifestSha256 !== undefined &&
        sha256(manifestBytes) !== dependency.manifestSha256
      )
        throw new Error(`Dependency manifest hash mismatch: ${dependency.specifier}`)
      const manifest = JSON.parse(manifestBytes.toString('utf8'))
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
    if (row.closureGroups.length !== after.length)
      throw new Error(`Unmapped declaration rewrite import: ${row.destination}`)
    const accountedSourceImports = new Set()
    const countedDispositions = new Set()
    const validateEdge = async (sourceImportIndex, destinationImport, mapping, typeElision) => {
      const originalImport = before[sourceImportIndex]
      if (!originalImport)
        throw new Error(`Invalid declaration rewrite source import: ${row.destination}`)
      accountedSourceImports.add(sourceImportIndex)
      const oldDispositionTarget =
        originalImport.specifier ?? `expression:${originalImport.expression}`
      const oldImport = resolveDynamic(originalImport, row)
      const newImport = destinationImport ? resolveDynamic(destinationImport, row) : null
      if (mapping?.destinationSpecifier !== undefined && mapping.destinationSpecifier !== newImport)
        throw new Error(`Declaration rewrite destination binding mismatch: ${row.destination}`)
      const dispositionKey = `${row.mk2Path}\0${oldDispositionTarget}`
      const disposition = dispositionMap.get(dispositionKey) ?? null
      const dispositionUse = `${dispositionKey}\0${sourceImportIndex}`
      if (disposition && !countedDispositions.has(dispositionUse)) {
        countedDispositions.add(dispositionUse)
        dispositionUses.set(dispositionKey, dispositionUses.get(dispositionKey) + 1)
      }
      const declaredDispositionTarget =
        mapping?.targetException?.destinationSpecifier ??
        disposition?.destinationSpecifier ??
        oldImport
      if (disposition && newImport !== null && newImport !== declaredDispositionTarget)
        throw new Error(`Import disposition destination mismatch: ${row.mk2Path} -> ${newImport}`)
      let sourceTarget = null
      if (oldImport.startsWith('.')) {
        sourceTarget = candidates(row.mk2Path, oldImport).find(file => source.has(file)) ?? null
        if (!sourceTarget && !disposition)
          throw new Error(`Unresolved pinned relative import: ${row.mk2Path} -> ${oldImport}`)
        if (
          sourceTarget &&
          !required.has(sourceTarget) &&
          !disposition &&
          (newImport === null ||
            newImport === oldImport ||
            !adapterSourceDestinations.has(sourceTarget))
        )
          throw new Error(
            `Incomplete type/runtime import closure: ${row.mk2Path} -> ${sourceTarget}`,
          )
      }
      let destinationTarget = null
      if (newImport === null) {
        if (!typeElision)
          throw new Error(`Missing declaration rewrite destination: ${row.destination}`)
        destinationTarget = `local-type:${typeElision.local}`
      } else if (newImport.startsWith('.')) {
        destinationTarget = candidates(row.destination, newImport).find(
          file => destinations.has(file) || adapterMap.has(file),
        )
        if (!destinationTarget && disposition) destinationTarget = `copied-unwired:${newImport}`
        else if (!destinationTarget)
          throw new Error(`Unresolved copied relative import: ${row.destination} -> ${newImport}`)
        if (
          sourceTarget &&
          required.has(sourceTarget) &&
          bySource.get(sourceTarget)?.destination !== destinationTarget &&
          !mapping?.targetException &&
          !(disposition && row.divergence)
        )
          throw new Error(`Noncanonical import relocation: ${row.destination} -> ${newImport}`)
      } else {
        if (!dependencyMap.has(newImport)) {
          if (!disposition)
            throw new Error(`Undeclared bare module: ${row.destination} -> ${newImport}`)
          destinationTarget = `copied-unwired:${newImport}`
        } else {
          destinationTarget = `dependency:${newImport}`
          if (sourceTarget && disposition) destinationTarget = `copied-unwired:${newImport}`
          else if (sourceTarget && !mapping?.targetException)
            destinationTarget = await canonicalPackageExport(
              dependencyMap.get(newImport),
              sourceTarget,
              bySource,
              adapterSourceDestinations,
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
        ...(mapping?.binding ? { binding: mapping.binding } : {}),
        ...(mapping?.targetException ? { targetException: mapping.targetException } : {}),
        ...(typeElision ? { typeElision } : {}),
        ...(disposition ? { disposition } : {}),
      })
    }
    for (let index = 0; index < row.closureGroups.length; index++) {
      const group = row.closureGroups[index]
      if (!group.mappings.length)
        throw new Error(`Empty declaration rewrite destination group: ${row.destination}`)
      for (const mapping of group.mappings)
        await validateEdge(mapping.sourceImportIndex, after[index], mapping, null)
    }
    for (const typeElision of row.typeElisions)
      await validateEdge(typeElision.sourceImportIndex, null, null, typeElision)
    if (
      accountedSourceImports.size !== before.length ||
      before.some((_, index) => !accountedSourceImports.has(index))
    )
      throw new Error(`Unmapped pinned import after declaration rewrite: ${row.destination}`)
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
      ...(record.importDeclarationRewrites.length
        ? { importDeclarationRewrites: record.importDeclarationRewrites }
        : {}),
      divergence: record.divergence,
      ...(record.algorithmDisposition ? { algorithmDisposition: record.algorithmDisposition } : {}),
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
  if (!PINNED_DECLARATION_FAMILIES.has(values.get('--family')))
    throw new Error('Explicit --family sc2|ea required')
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

/**
 * Stage H (mechanical port of non-SC2 Blizzard/publisher code): a lighter sibling of
 * prepareCopy/copyCli for families outside the SC2 receipt-parity pipeline above. A row is
 * copied byte-for-byte from the pinned MK2 commit — no rewrites, no import-declaration
 * rewriting, no dependency-closure verification. Stage G's closure checks assume every import
 * is meant to resolve today; that is false for a copy that is deliberately left unwired pending
 * a later thin adapter ("перенести весь код, ничего не потеряв; дорабатывать его будем позже").
 * The ledger this writes uses the same {source, destination, sha256Mk2, sha256Mk3} row shape as
 * migration/mk2-copy/sc2.json so it reads the same way.
 */
export async function prepareMechanicalCopy({ declaration, workspaceRoot, repoRoot, source: suppliedSource }) {
  if (
    declaration.schemaVersion !== 1 ||
    !declaration.family ||
    declaration.family === 'sc2' ||
    declaration.oracleCommit !== MK2_PIN
  )
    throw new Error('Invalid mechanical pinned declaration')
  unique(declaration.copies, 'source', 'source')
  unique(declaration.copies, 'destination', 'destination')
  const source =
    suppliedSource ??
    (await createPinnedSource({
      repoRoot,
      commit: declaration.oracleCommit,
      observeWorkingTree: false,
    }))
  if (source.commit !== declaration.oracleCommit) throw new Error('Pinned source commit mismatch')
  const records = []
  for (const row of declaration.copies) {
    safeRelative(row.source)
    safeRelative(row.destination)
    const pinned = await source.read(row.source)
    if (row.sha256Mk2 !== pinned.sha256) throw new Error(`Pinned source hash mismatch: ${row.source}`)
    if (row.sha256Mk3 !== pinned.sha256)
      throw new Error(`Mechanical copy must be byte-identical: ${row.destination}`)
    records.push({
      mk2Path: row.source,
      destination: row.destination,
      sha256Mk2: pinned.sha256,
      sha256Mk3: pinned.sha256,
      gitBlob: pinned.gitBlob,
      bytes: pinned.bytes,
    })
  }
  return { records, declaration, workspaceRoot }
}

export async function writeMechanicalCopies(prepared) {
  for (const record of prepared.records) {
    const target = await safeTarget(prepared.workspaceRoot, record.destination)
    try {
      if (sha256(await readFile(target)) !== record.sha256Mk3)
        throw new Error(`Refusing to overwrite divergent destination: ${record.destination}`)
      continue
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, record.bytes, { flag: 'wx' })
  }
  return checkMechanicalCopies(prepared)
}

export async function checkMechanicalCopies(prepared) {
  for (const record of prepared.records) {
    const target = await safeTarget(prepared.workspaceRoot, record.destination)
    if (sha256(await readFile(target)) !== record.sha256Mk3)
      throw new Error(`Missing/tampered mechanical copy: ${record.destination}`)
  }
  return { family: prepared.declaration.family, files: prepared.records.length }
}

export async function mechanicalCopyCli(mode, argv = process.argv.slice(2)) {
  const values = new Map()
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]
    if (
      !['--family', '--root', '--source-root', '--declaration'].includes(key) ||
      values.has(key)
    )
      throw new Error(`Unknown/duplicate option: ${key}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing ${key} value`)
    values.set(key, value)
  }
  const family = values.get('--family')
  if (!family || family === 'sc2') throw new Error('Explicit non-sc2 --family required')
  const workspaceRoot = path.resolve(
    values.get('--root') ?? fileURLToPath(new URL('../../../..', import.meta.url)),
  )
  const declarationPath =
    values.get('--declaration') ??
    path.join(workspaceRoot, `modkit-core/migration/mk2-copy/${family}.json`)
  const declaration = JSON.parse(await readFile(declarationPath, 'utf8'))
  if (declaration.family !== family) throw new Error('Declaration family mismatch')
  const prepared = await prepareMechanicalCopy({
    declaration,
    workspaceRoot,
    repoRoot: values.get('--source-root') ?? path.join(workspaceRoot, 'references/modkitmk2'),
  })
  const result =
    mode === 'check' ? await checkMechanicalCopies(prepared) : await writeMechanicalCopies(prepared)
  console.log(JSON.stringify(result))
}
