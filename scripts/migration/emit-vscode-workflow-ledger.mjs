#!/usr/bin/env node
// Block 14A: deterministic allocation of the complete legacy VS Code and CLI surfaces to
// semantic workflows. Source facts are read from source-inventory.json; the hand-authored input
// contains classification rules and owner-decision state, never copied inventory rows.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { format, resolveConfig } from 'prettier'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const check = args.includes('--check')
const quiet = args.includes('--quiet')
const inventoryPath = path.resolve(
  argValue('--inventory') ?? path.join(repoRoot, 'migration/generated/source-inventory.json'),
)
const decisionsPath = path.resolve(
  argValue('--decisions') ?? path.join(repoRoot, 'migration/vscode-workflows.json'),
)
const manifestPath = path.resolve(
  argValue('--manifest') ?? path.join(repoRoot, 'apps/modkit-vscode/package.json'),
)
const targetsPath = path.resolve(
  argValue('--targets') ??
    path.join(repoRoot, 'packages/host/src/commands/subject-command-targets.ts'),
)
const outputPath = path.resolve(
  argValue('--output') ?? path.join(repoRoot, 'migration/generated/vscode-workflow-ledger.json'),
)

const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))
const sorted = values => [...values].sort(compareUtf8)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const fail = message => {
  console.error(`migration:${check ? 'check' : 'emit'} workflow ledger: ${message}`)
  process.exit(1)
}

for (const input of [inventoryPath, decisionsPath, manifestPath, targetsPath]) {
  if (!existsSync(input)) fail(`missing input ${path.relative(repoRoot, input)}`)
}

const inventory = readJson(inventoryPath)
const decisions = readJson(decisionsPath)
const manifest = readJson(manifestPath)
const targetSource = readFileSync(targetsPath, 'utf8')

const EXPECTED_BY_KIND = Object.freeze({
  'cli-command': 5,
  'cli-subcommand': 3,
  'vscode-command': 64,
  'vscode-configuration-property': 67,
  'vscode-contribution': 18,
  'vscode-custom-editor': 11,
  'vscode-language': 8,
  'vscode-menu-item': 84,
  'vscode-view': 6,
})
const SCOPED_KINDS = new Set(Object.keys(EXPECTED_BY_KIND))
const scopedUnits = inventory.units.filter(unit => SCOPED_KINDS.has(unit.kind))
const actualByKind = Object.fromEntries(
  Object.keys(EXPECTED_BY_KIND).map(kind => [
    kind,
    scopedUnits.filter(unit => unit.kind === kind).length,
  ]),
)
for (const [kind, expected] of Object.entries(EXPECTED_BY_KIND)) {
  if (actualByKind[kind] !== expected) {
    fail(`${kind} count drifted: expected ${expected}, found ${actualByKind[kind]}`)
  }
}
const vscodeCount = scopedUnits.filter(unit => unit.kind.startsWith('vscode-')).length
const cliCount = scopedUnits.filter(unit => unit.kind.startsWith('cli-')).length
if (vscodeCount !== 258 || cliCount !== 8 || scopedUnits.length !== 266) {
  fail(`coverage must be exactly VS Code 258 + CLI 8 = 266; found ${vscodeCount} + ${cliCount}`)
}

if (decisions.schemaVersion !== 'vscode-workflow-decisions-1') {
  fail(`unsupported decisions schema ${String(decisions.schemaVersion)}`)
}
if (!Array.isArray(decisions.workflows) || decisions.workflows.length === 0) {
  fail('decisions.workflows must be a non-empty array')
}

const PENDING_CLASSIFICATION = Object.freeze({
  disposition: 'decision-required',
  migrationState: 'unknown',
  releaseTrack: 'decision-required',
  owner: 'modkit-program-owner',
  targetState: 'decision-required',
  replacementWorkflowId: null,
})
const CLASSIFICATION_KEYS = sorted([...Object.keys(PENDING_CLASSIFICATION), 'reason'])
const PLANNED_SLICES = new Set(['block-14b', 'block-14c', 'block-14d'])
const workflowById = new Map()
const commandWorkflow = new Map()
const cliWorkflow = new Map()
const kindWorkflow = new Map()
const currentCommandWorkflow = new Map()

const claim = (map, key, workflowId, label) => {
  if (map.has(key)) fail(`${label} ${key} is classified by both ${map.get(key)} and ${workflowId}`)
  map.set(key, workflowId)
}

for (const workflow of decisions.workflows) {
  const id = workflow.workflowId
  if (typeof id !== 'string' || id === '') fail('every workflow needs a workflowId')
  if (workflowById.has(id)) fail(`duplicate workflowId ${id}`)
  workflowById.set(id, workflow)
  if (!PLANNED_SLICES.has(workflow.plannedSlice)) {
    fail(`${id}: plannedSlice must name block-14b, block-14c or block-14d`)
  }
  const classification = workflow.classification ?? {}
  const classificationKeys = sorted(Object.keys(classification))
  if (classificationKeys.join('|') !== CLASSIFICATION_KEYS.join('|')) {
    fail(`${id}: classification must contain only ${CLASSIFICATION_KEYS.join(', ')}`)
  }
  if (typeof classification.reason !== 'string' || classification.reason.length < 20) {
    fail(`${id}: classification reason is required`)
  }
  if (
    classification.releaseTrack === 'mk3-priority' &&
    classification.migrationState === 'unknown'
  ) {
    fail(`${id}: mk3-priority cannot remain unknown; the owner must resolve it before promotion`)
  }
  for (const [field, expected] of Object.entries(PENDING_CLASSIFICATION)) {
    if (classification[field] !== expected) {
      fail(
        `${id}: vscode-workflow-decisions-1 is pending-only; ${field} must be ${JSON.stringify(expected)}, found ${JSON.stringify(classification[field])}`,
      )
    }
  }

  for (const command of workflow.legacyCommandIds ?? [])
    claim(commandWorkflow, command, id, 'legacy command')
  for (const command of workflow.legacyCliCommands ?? [])
    claim(cliWorkflow, command, id, 'legacy CLI command')
  for (const kind of workflow.unitKinds ?? []) claim(kindWorkflow, kind, id, 'unit kind')
  for (const command of workflow.currentX3CommandIds ?? [])
    claim(currentCommandWorkflow, command, id, 'current X3 command')
}

const findByKindAndKey = (kind, pick) => {
  const map = new Map()
  for (const unit of scopedUnits.filter(item => item.kind === kind)) {
    const key = pick(unit)
    if (map.has(key)) fail(`${kind} relation key ${key} is not unique`)
    map.set(key, unit)
  }
  return map
}
const vscodeCommandById = findByKindAndKey('vscode-command', unit => unit.extracted.command)
const vscodeViewById = findByKindAndKey('vscode-view', unit => unit.extracted.id)
const vscodeLanguageById = findByKindAndKey('vscode-language', unit => unit.extracted.id)
const cliCommandById = findByKindAndKey('cli-command', unit => unit.extracted.command)

for (const command of commandWorkflow.keys()) {
  if (!vscodeCommandById.has(command))
    fail(`classification names unknown legacy command ${command}`)
}
for (const command of cliWorkflow.keys()) {
  if (!cliCommandById.has(command))
    fail(`classification names unknown legacy CLI command ${command}`)
}

const allocationBySourceId = new Map()
const allocate = (unit, workflowId, derivation) => {
  if (!workflowById.has(workflowId)) fail(`${unit.sourceUnitId}: unknown workflow ${workflowId}`)
  if (allocationBySourceId.has(unit.sourceUnitId)) {
    fail(`${unit.sourceUnitId}: classified more than once`)
  }
  allocationBySourceId.set(unit.sourceUnitId, { unit, workflowId, derivation })
}

for (const unit of scopedUnits) {
  if (unit.kind === 'vscode-command') {
    const workflowId = commandWorkflow.get(unit.extracted.command)
    if (workflowId !== undefined) allocate(unit, workflowId, { kind: 'direct-rule' })
  } else if (unit.kind === 'cli-command') {
    const workflowId = cliWorkflow.get(unit.extracted.command)
    if (workflowId !== undefined) allocate(unit, workflowId, { kind: 'direct-rule' })
  } else if (
    unit.kind !== 'vscode-menu-item' &&
    unit.kind !== 'vscode-contribution' &&
    unit.kind !== 'cli-subcommand'
  ) {
    const workflowId = kindWorkflow.get(unit.kind)
    if (workflowId !== undefined) allocate(unit, workflowId, { kind: 'direct-rule' })
  }
}

for (const unit of scopedUnits.filter(item => item.kind === 'vscode-menu-item')) {
  const commandUnit = vscodeCommandById.get(unit.extracted.command)
  if (commandUnit === undefined) {
    fail(`${unit.sourceUnitId}: menu references unknown command ${unit.extracted.command}`)
  }
  const parent = allocationBySourceId.get(commandUnit.sourceUnitId)
  if (parent === undefined) fail(`${unit.sourceUnitId}: referenced command is not classified`)
  allocate(unit, parent.workflowId, {
    kind: 'menu-command',
    viaSourceUnitId: commandUnit.sourceUnitId,
  })
}

for (const unit of scopedUnits.filter(item => item.kind === 'vscode-contribution')) {
  const { contributionType, key } = unit.extracted
  if (contributionType === 'viewsWelcome') {
    const viewUnit = vscodeViewById.get(key)
    if (viewUnit === undefined)
      fail(`${unit.sourceUnitId}: viewsWelcome references unknown view ${key}`)
    const parent = allocationBySourceId.get(viewUnit.sourceUnitId)
    if (parent === undefined) fail(`${unit.sourceUnitId}: referenced view is not classified`)
    allocate(unit, parent.workflowId, {
      kind: 'view-welcome',
      viaSourceUnitId: viewUnit.sourceUnitId,
    })
    continue
  }
  let languageId
  if (contributionType === 'grammars' || contributionType === 'snippets') languageId = key
  if (contributionType === 'configurationDefaults' && /^\[[^\]]+\]$/.test(key)) {
    languageId = key.slice(1, -1)
  }
  if (languageId !== undefined) {
    const languageUnit = vscodeLanguageById.get(languageId)
    if (languageUnit === undefined) {
      fail(`${unit.sourceUnitId}: language contribution references unknown language ${languageId}`)
    }
    const parent = allocationBySourceId.get(languageUnit.sourceUnitId)
    if (parent === undefined) fail(`${unit.sourceUnitId}: referenced language is not classified`)
    allocate(unit, parent.workflowId, {
      kind: 'language-contribution',
      viaSourceUnitId: languageUnit.sourceUnitId,
    })
    continue
  }
  const workflowId = kindWorkflow.get(unit.kind)
  if (workflowId !== undefined) allocate(unit, workflowId, { kind: 'direct-rule' })
}

for (const unit of scopedUnits.filter(item => item.kind === 'cli-subcommand')) {
  const commandUnit = cliCommandById.get(unit.extracted.command)
  if (commandUnit === undefined) {
    fail(
      `${unit.sourceUnitId}: subcommand references unknown CLI command ${unit.extracted.command}`,
    )
  }
  const parent = allocationBySourceId.get(commandUnit.sourceUnitId)
  if (parent === undefined) fail(`${unit.sourceUnitId}: referenced CLI command is not classified`)
  allocate(unit, parent.workflowId, {
    kind: 'cli-parent',
    viaSourceUnitId: commandUnit.sourceUnitId,
  })
}

const unclassified = scopedUnits.filter(unit => !allocationBySourceId.has(unit.sourceUnitId))
if (unclassified.length > 0) {
  fail(
    `${unclassified.length} scoped unit(s) are unclassified; first: ${unclassified
      .slice(0, 3)
      .map(unit => unit.sourceUnitId)
      .join(', ')}`,
  )
}
if (allocationBySourceId.size !== 266)
  fail(`expected 266 allocated units, found ${allocationBySourceId.size}`)

const contributes = manifest.contributes ?? {}
const currentCommands = (contributes.commands ?? []).map(row => row.command)
for (const command of currentCommands) {
  if (!currentCommandWorkflow.has(command)) fail(`current X3 command ${command} is unclassified`)
}
for (const command of currentCommandWorkflow.keys()) {
  if (!currentCommands.includes(command))
    fail(`classification names unknown current X3 command ${command}`)
}
const currentCounts = {
  commands: currentCommands.length,
  customEditors: (contributes.customEditors ?? []).length,
  languages: (contributes.languages ?? []).length,
  views: Object.values(contributes.views ?? {}).flat().length,
}
const EXPECTED_CURRENT = { commands: 7, customEditors: 1, languages: 0, views: 2 }
for (const [surface, expected] of Object.entries(EXPECTED_CURRENT)) {
  if (currentCounts[surface] !== expected) {
    fail(
      `current X3 ${surface} count drifted: expected ${expected}, found ${currentCounts[surface]}`,
    )
  }
}

function readLiteral(node, sourceFile, at) {
  if (ts.isAsExpression(node)) {
    if (node.type.getText(sourceFile) !== 'const') {
      fail(`${at}: target catalog permits only "as const" assertions`)
    }
    return readLiteral(node.expression, sourceFile, at)
  }
  if (ts.isParenthesizedExpression(node)) return readLiteral(node.expression, sourceFile, at)
  if (ts.isStringLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element, index) => {
      if (ts.isSpreadElement(element)) fail(`${at}[${index}]: spread is executable and forbidden`)
      return readLiteral(element, sourceFile, `${at}[${index}]`)
    })
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value = Object.create(null)
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        fail(`${at}: only literal property assignments are allowed in the target catalog`)
      }
      if (ts.isComputedPropertyName(property.name)) {
        fail(`${at}: computed properties are executable and forbidden`)
      }
      const key = property.name.text
      if (Object.hasOwn(value, key)) fail(`${at}: duplicate property ${key}`)
      value[key] = readLiteral(property.initializer, sourceFile, `${at}.${key}`)
    }
    return value
  }
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  fail(
    `${at}: executable or non-literal syntax ${ts.SyntaxKind[node.kind]} is forbidden at ${position.line + 1}:${position.character + 1}`,
  )
}

function readTargetCatalog(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  if (sourceFile.parseDiagnostics.length > 0) {
    fail(`shared command target catalog has TypeScript syntax errors`)
  }
  let targetDeclaration
  let constructorImport = false
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings
      const importsOnlyConstructor =
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === './immutable-command-targets.js' &&
        statement.importClause?.isTypeOnly !== true &&
        statement.importClause?.name === undefined &&
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length === 1 &&
        bindings.elements[0].propertyName === undefined &&
        bindings.elements[0].name.text === 'defineSubjectCommandTargets'
      if (!importsOnlyConstructor || constructorImport) {
        fail(
          'shared command target catalog permits only the defineSubjectCommandTargets constructor import',
        )
      }
      constructorImport = true
      continue
    }
    if (!ts.isVariableStatement(statement)) {
      fail(
        `shared command target catalog contains executable top-level ${ts.SyntaxKind[statement.kind]}`,
      )
    }
    if (
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
      statement.declarationList.declarations.length !== 1
    ) {
      fail('shared command target catalog permits one exported const declaration only')
    }
    const declaration = statement.declarationList.declarations[0]
    if (
      !ts.isIdentifier(declaration.name) ||
      declaration.name.text !== 'SUBJECT_COMMAND_TARGETS' ||
      targetDeclaration !== undefined
    ) {
      fail('shared command target catalog permits only SUBJECT_COMMAND_TARGETS at runtime')
    }
    const exported = statement.modifiers?.some(
      modifier => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
    if (!exported) fail('SUBJECT_COMMAND_TARGETS must be exported')
    targetDeclaration = declaration
  }
  if (targetDeclaration?.initializer === undefined) {
    fail('shared command target catalog has no SUBJECT_COMMAND_TARGETS initializer')
  }
  if (!constructorImport) {
    fail('shared command target catalog must import defineSubjectCommandTargets')
  }
  const initializer = targetDeclaration.initializer
  if (
    !ts.isCallExpression(initializer) ||
    initializer.arguments.length !== 1 ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.expression.text !== 'defineSubjectCommandTargets'
  ) {
    fail(
      'SUBJECT_COMMAND_TARGETS must be one defineSubjectCommandTargets(<literal> as const) initializer',
    )
  }
  const catalog = readLiteral(initializer.arguments[0], sourceFile, 'SUBJECT_COMMAND_TARGETS')
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) {
    fail('SUBJECT_COMMAND_TARGETS must contain an object literal')
  }
  return catalog
}

const targets = Object.values(readTargetCatalog(targetSource, targetsPath))
const expectedTargetIds = [
  'subject.convert',
  'subject.extract',
  'subject.inspect',
  'subject.open',
  'subject.preview',
  'subject.validate',
]
if (sorted(targets.map(target => target.commandId)).join('|') !== expectedTargetIds.join('|')) {
  fail('shared command target catalog must contain exactly the six live subject commands')
}
for (const target of targets) {
  if (!Array.isArray(target.operationIds) || !Array.isArray(target.dataSourceContracts)) {
    fail(`${target.commandId}: target operations and data-source contracts must be arrays`)
  }
  if (target.needsSubject !== true || target.mutatesSource !== false) {
    fail(`${target.commandId}: shared subject commands must be subject-bound and non-mutating`)
  }
  if (!Array.isArray(target.hostCallers) || target.hostCallers.length === 0) {
    fail(`${target.commandId}: hostCallers must name proved callers`)
  }
  if (target.hostCallers.includes('pwa'))
    fail(`${target.commandId}: PWA is not a proved runtime caller`)
  for (const caller of target.hostCallers) {
    if (!['automation', 'cli', 'electron', 'vscode'].includes(caller)) {
      fail(`${target.commandId}: unknown or unproved host caller ${caller}`)
    }
  }
}

const inputHash = file => sha256(readFileSync(file))
const unitRows = sorted([...allocationBySourceId.keys()]).map(sourceUnitId => {
  const { unit, workflowId, derivation } = allocationBySourceId.get(sourceUnitId)
  const workflow = workflowById.get(workflowId)
  return {
    sourceUnitId,
    sourceFactSha256: sha256(
      JSON.stringify({
        sourceUnitId: unit.sourceUnitId,
        kind: unit.kind,
        path: unit.path,
        depth: unit.depth,
        extracted: unit.extracted,
      }),
    ),
    kind: unit.kind,
    workflowId,
    derivation,
    plannedSlice: workflow.plannedSlice,
    classification: workflow.classification,
  }
})
const workflowRows = sorted([...workflowById.keys()]).map(workflowId => {
  const workflow = workflowById.get(workflowId)
  const members = unitRows.filter(row => row.workflowId === workflowId)
  return {
    workflowId,
    title: workflow.title,
    plannedSlice: workflow.plannedSlice,
    classification: workflow.classification,
    legacyUnitCount: members.length,
    legacyCountsByKind: Object.fromEntries(
      Object.keys(EXPECTED_BY_KIND)
        .map(kind => [kind, members.filter(row => row.kind === kind).length])
        .filter(([, count]) => count > 0),
    ),
    currentX3CommandIds: sorted(workflow.currentX3CommandIds ?? []),
  }
})

const document = {
  $comment:
    'Generated by scripts/migration/emit-vscode-workflow-ledger.mjs. Source facts come only from source-inventory.json; classifications remain owner-pending until an explicit block-14 decision.',
  schemaVersion: 'vscode-workflow-ledger-1',
  generator: 'scripts/migration/emit-vscode-workflow-ledger.mjs',
  inputs: {
    sourceInventorySha256: inputHash(inventoryPath),
    decisionsSha256: inputHash(decisionsPath),
    vscodeManifestSha256: inputHash(manifestPath),
    sharedCommandTargetsSha256: inputHash(targetsPath),
  },
  counts: {
    total: unitRows.length,
    legacyVsCode: vscodeCount,
    legacyCli: cliCount,
    byKind: actualByKind,
    workflows: workflowRows.length,
    decisionRequired: unitRows.filter(row => row.classification.disposition === 'decision-required')
      .length,
  },
  surfaceComparison: {
    legacyVsCode: { commands: 64, customEditors: 11, languages: 8, views: 6 },
    currentX3VsCode: currentCounts,
  },
  currentX3Commands: sorted(currentCommands).map(commandId => ({
    commandId,
    workflowId: currentCommandWorkflow.get(commandId),
  })),
  sharedCommandTargets: targets
    .map(target => ({
      commandId: target.commandId,
      needsSubject: target.needsSubject,
      mutatesSource: target.mutatesSource,
      operationIds: [...target.operationIds],
      dataSourceContracts: [...target.dataSourceContracts],
      hostCallers: [...target.hostCallers],
    }))
    .sort((left, right) => compareUtf8(left.commandId, right.commandId)),
  workflows: workflowRows,
  units: unitRows,
}

const prettierOptions = await resolveConfig(outputPath)
const rendered = await format(JSON.stringify(document), { ...prettierOptions, parser: 'json' })
if (check) {
  if (!existsSync(outputPath))
    fail(`missing ${path.relative(repoRoot, outputPath)}; run pnpm migration:emit`)
  if (readFileSync(outputPath, 'utf8') !== rendered) {
    fail(`${path.relative(repoRoot, outputPath)} is stale; run pnpm migration:emit`)
  }
  if (!quiet) console.log('migration:check workflow ledger: 258 VS Code + 8 CLI units up to date')
} else {
  await mkdir(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, rendered)
  if (!quiet) console.log('migration:emit workflow ledger: wrote 258 VS Code + 8 CLI units')
}
