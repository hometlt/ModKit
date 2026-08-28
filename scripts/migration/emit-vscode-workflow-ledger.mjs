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
const extensionSourcePath = path.resolve(
  argValue('--extension-source') ?? path.join(repoRoot, 'apps/modkit-vscode/src/extension.ts'),
)
const vscodeCatalogPath = path.resolve(
  argValue('--vscode-catalog') ??
    path.join(repoRoot, 'apps/modkit-vscode/generated/bundled-catalog.json'),
)
const publicationInventoryPath = path.resolve(
  argValue('--publication-inventory') ??
    path.join(repoRoot, 'apps/modkit-vscode/publication-artifact.v1.json'),
)
const targetsPath = path.resolve(
  argValue('--targets') ??
    path.join(repoRoot, 'packages/host/src/commands/subject-command-targets.ts'),
)
const pwaCommandProofPaths = Object.freeze({
  commands: path.resolve(
    argValue('--pwa-commands') ?? path.join(repoRoot, 'apps/web/src/commands.ts'),
  ),
  subjects: path.resolve(
    argValue('--pwa-subjects') ?? path.join(repoRoot, 'apps/web/src/subjects.ts'),
  ),
  shell: path.resolve(argValue('--pwa-shell') ?? path.join(repoRoot, 'apps/web/src/shell.ts')),
  embed: path.resolve(argValue('--pwa-embed') ?? path.join(repoRoot, 'apps/web/src/embed.ts')),
})
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

for (const input of [
  inventoryPath,
  decisionsPath,
  manifestPath,
  extensionSourcePath,
  vscodeCatalogPath,
  publicationInventoryPath,
  targetsPath,
  ...Object.values(pwaCommandProofPaths),
]) {
  if (!existsSync(input)) fail(`missing input ${path.relative(repoRoot, input)}`)
}

const inventory = readJson(inventoryPath)
const decisions = readJson(decisionsPath)
const manifest = readJson(manifestPath)
const extensionSource = readFileSync(extensionSourcePath, 'utf8')
const vscodeCatalog = readJson(vscodeCatalogPath)
const publicationInventory = readJson(publicationInventoryPath)
const targetSource = readFileSync(targetsPath, 'utf8')

const provePwaCommandCaller = () => {
  const sources = Object.fromEntries(
    Object.entries(pwaCommandProofPaths).map(([name, file]) => [name, readFileSync(file, 'utf8')]),
  )
  const requiredProductionWiring = Object.freeze({
    commands: [
      'createSubjectCommandEndpoint({',
      'openSubject: async',
      'async dispose(): Promise<void>',
    ],
    subjects: ['const commands = createWebCommandProtocol(services)', 'commands.dispose()'],
    shell: [
      'services.commands.authorize({',
      "window.addEventListener('pagehide', () => void services.dispose(), { once: true })",
    ],
    embed: ['disposeEmbedHosts()', 'installEmbedHostLifecycle()'],
  })
  for (const [surface, needles] of Object.entries(requiredProductionWiring)) {
    for (const needle of needles) {
      if (!sources[surface].includes(needle)) {
        fail(`PWA command caller proof is missing ${surface} wiring: ${needle}`)
      }
    }
  }
}

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
const normalizeCommandId = (value, at) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${at}: command id must be non-empty`)
  const normalized = value.startsWith('-') ? value.slice(1) : value
  if (normalized.length === 0) fail(`${at}: command id must remain non-empty after normalization`)
  return normalized
}
const stablePart = value => encodeURIComponent(value)
const currentManifestFacts = new Map()
const addCurrentFact = (kind, key, source) => {
  if (typeof key !== 'string' || key.length === 0) fail(`${source}: current X3 fact key is empty`)
  const factId = `x3:${kind}:${key}`
  if (currentManifestFacts.has(factId)) fail(`duplicate current X3 fact ${factId}`)
  currentManifestFacts.set(factId, { factId, kind, key, source })
}

const currentCommands = (contributes.commands ?? []).map((row, index) => {
  const command = normalizeCommandId(row?.command, `contributes.commands[${index}]`)
  addCurrentFact('vscode-command', command, `contributes.commands[${index}]`)
  return command
})
for (const key of Object.keys(contributes.configuration?.properties ?? {})) {
  addCurrentFact('vscode-configuration-property', key, `contributes.configuration.${key}`)
}
for (const [index, row] of (contributes.customEditors ?? []).entries()) {
  if (typeof row?.viewType !== 'string' || row.viewType.length === 0) {
    fail(`contributes.customEditors[${index}]: viewType must be non-empty`)
  }
  addCurrentFact('vscode-custom-editor', row.viewType, `contributes.customEditors[${index}]`)
}
for (const [container, rows] of Object.entries(contributes.views ?? {})) {
  for (const [index, row] of rows.entries()) {
    if (typeof row?.id !== 'string' || row.id.length === 0) {
      fail(`contributes.views.${container}[${index}]: id must be non-empty`)
    }
    addCurrentFact('vscode-view', row.id, `contributes.views.${container}[${index}]`)
  }
}
for (const [location, rows] of Object.entries(contributes.viewsContainers ?? {})) {
  for (const [index, row] of rows.entries()) {
    if (typeof row?.id !== 'string' || row.id.length === 0) {
      fail(`contributes.viewsContainers.${location}[${index}]: id must be non-empty`)
    }
    addCurrentFact(
      'vscode-view-container',
      `${location}/${row.id}`,
      `contributes.viewsContainers.${location}[${index}]`,
    )
  }
}
for (const [index, row] of (contributes.languages ?? []).entries()) {
  if (typeof row?.id !== 'string' || row.id.length === 0) {
    fail(`contributes.languages[${index}]: id must be non-empty`)
  }
  addCurrentFact('vscode-language', row.id, `contributes.languages[${index}]`)
}

const menuCommands = []
for (const [location, rows] of Object.entries(contributes.menus ?? {})) {
  for (const [index, row] of rows.entries()) {
    const at = `contributes.menus.${location}[${index}]`
    const command = normalizeCommandId(row?.command, at)
    const alt = row?.alt === undefined ? '' : normalizeCommandId(row.alt, `${at}.alt`)
    const when = typeof row?.when === 'string' ? row.when : ''
    const group = typeof row?.group === 'string' ? row.group : ''
    const key = [location, command, alt, when, group].map(stablePart).join('/')
    addCurrentFact('vscode-menu-item', key, at)
    menuCommands.push({ command, alt, at })
  }
}

const keybindingCommands = []
for (const [index, row] of (contributes.keybindings ?? []).entries()) {
  const at = `contributes.keybindings[${index}]`
  const command = normalizeCommandId(row?.command, at)
  const key = [
    command,
    typeof row?.key === 'string' ? row.key : '',
    typeof row?.mac === 'string' ? row.mac : '',
    typeof row?.linux === 'string' ? row.linux : '',
    typeof row?.win === 'string' ? row.win : '',
    typeof row?.when === 'string' ? row.when : '',
  ]
    .map(stablePart)
    .join('/')
  addCurrentFact('vscode-keybinding', key, at)
  keybindingCommands.push({ command, at })
}

const activationEvents = manifest.activationEvents ?? []
if (!Array.isArray(activationEvents)) fail('activationEvents must be an array')
for (const [index, event] of activationEvents.entries()) {
  if (typeof event !== 'string' || event.length === 0) {
    fail(`activationEvents[${index}] must be non-empty`)
  }
  if (event.startsWith('onFileSystem:')) {
    const scheme = event.slice('onFileSystem:'.length)
    addCurrentFact('vscode-filesystem-scheme', scheme, `activationEvents[${index}]`)
  }
}

function readRegisteredCommands(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  if (sourceFile.parseDiagnostics.length > 0) fail('VS Code extension source has syntax errors')
  const commands = new Map()
  const visit = node => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'registerCommand'
    ) {
      const argument = node.arguments[0]
      if (argument === undefined || !ts.isStringLiteral(argument)) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        fail(
          `runtime command registration must use a string literal at ${position.line + 1}:${position.character + 1}`,
        )
      }
      const command = normalizeCommandId(argument.text, 'runtime command registration')
      if (commands.has(command)) fail(`runtime command ${command} is registered more than once`)
      commands.set(command, argument.getStart(sourceFile))
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return commands
}

const registeredCommands = readRegisteredCommands(extensionSource, extensionSourcePath)
for (const command of currentCommands) {
  if (!registeredCommands.has(command)) fail(`contributed command ${command} is not registered`)
}
const contributedCommandSet = new Set(currentCommands)
const runtimeModkitCommands = sorted(
  [...registeredCommands.keys()].filter(command => command.startsWith('modkit.')),
)
const runtimeOnlyCommands = runtimeModkitCommands.filter(
  command => !contributedCommandSet.has(command),
)

const commandAllowlists = decisions.commandAllowlists ?? {}
const internalAllowlist = commandAllowlists.internalRuntimeCommands
const externalAllowlist = commandAllowlists.externalOrBuiltinCommands
if (!Array.isArray(internalAllowlist) || !Array.isArray(externalAllowlist)) {
  fail(
    'commandAllowlists must contain internalRuntimeCommands and externalOrBuiltinCommands arrays',
  )
}
const validateAllowlist = (rows, label) => {
  const map = new Map()
  for (const [index, row] of rows.entries()) {
    const command = normalizeCommandId(row?.commandId, `${label}[${index}]`)
    if (typeof row?.reason !== 'string' || row.reason.length < 20) {
      fail(`${label}[${index}]: reason is required`)
    }
    if (map.has(command)) fail(`${label}: duplicate command ${command}`)
    map.set(command, row.reason)
  }
  return map
}
const internalCommands = validateAllowlist(internalAllowlist, 'internalRuntimeCommands')
const externalCommands = validateAllowlist(externalAllowlist, 'externalOrBuiltinCommands')
if (
  internalCommands.size !== 1 ||
  !internalCommands.has('modkit.openResource') ||
  [...internalCommands.keys()][0] !== 'modkit.openResource'
) {
  fail('internal runtime command allowlist must contain exactly modkit.openResource')
}
for (const command of runtimeOnlyCommands) {
  if (!internalCommands.has(command)) fail(`hidden runtime command ${command} is not allowlisted`)
}
for (const command of internalCommands.keys()) {
  if (!runtimeOnlyCommands.includes(command)) {
    fail(`internal runtime command allowlist contains stale command ${command}`)
  }
}
const resolveManifestCommand = ({ command, at }) => {
  if (!contributedCommandSet.has(command) && !externalCommands.has(command)) {
    fail(`${at}: dangling command ${command}`)
  }
}
for (const row of menuCommands) {
  resolveManifestCommand(row)
  if (row.alt !== '') resolveManifestCommand({ command: row.alt, at: `${row.at}.alt` })
}
for (const row of keybindingCommands) resolveManifestCommand(row)

for (const command of runtimeOnlyCommands) {
  addCurrentFact('vscode-runtime-only-command', command, 'VS Code runtime registration')
}

const legacyKeybindings = inventory.units.filter(unit => unit.kind === 'vscode-keybinding').length
if (legacyKeybindings !== 0) {
  fail(`legacy VS Code keybinding ratchet drifted: expected 0, found ${legacyKeybindings}`)
}
if (menuCommands.length !== 0) {
  fail(`current X3 menu ratchet drifted: expected 0, found ${menuCommands.length}`)
}
if (keybindingCommands.length !== 0) {
  fail(`current X3 keybinding ratchet drifted: expected 0, found ${keybindingCommands.length}`)
}

if (!Array.isArray(decisions.currentX3Facts) || decisions.currentX3Facts.length === 0) {
  fail('currentX3Facts must be a non-empty observed-only allocation')
}
const CURRENT_FACT_KEYS = ['factId', 'key', 'kind', 'state', 'workflowId']
const currentFactAllocations = new Map()
for (const [index, allocation] of decisions.currentX3Facts.entries()) {
  if (sorted(Object.keys(allocation)).join('|') !== CURRENT_FACT_KEYS.join('|')) {
    fail(`currentX3Facts[${index}] must contain only ${CURRENT_FACT_KEYS.join(', ')}`)
  }
  const expectedFactId = `x3:${allocation.kind}:${allocation.key}`
  if (allocation.factId !== expectedFactId) {
    fail(`${allocation.factId}: stable factId must be ${expectedFactId}`)
  }
  if (allocation.state !== 'observed-only') {
    fail(`${allocation.factId}: current fact state must be observed-only`)
  }
  if (!workflowById.has(allocation.workflowId)) {
    fail(`${allocation.factId}: unknown workflow ${String(allocation.workflowId)}`)
  }
  if (currentFactAllocations.has(allocation.factId)) {
    fail(`${allocation.factId}: current X3 fact is allocated more than once`)
  }
  const observed = currentManifestFacts.get(allocation.factId)
  if (observed === undefined) fail(`allocation names unknown current X3 fact ${allocation.factId}`)
  if (observed.kind !== allocation.kind || observed.key !== allocation.key) {
    fail(`${allocation.factId}: current X3 fact kind/key mismatch`)
  }
  currentFactAllocations.set(allocation.factId, allocation)
}
const unallocatedCurrentFacts = [...currentManifestFacts.keys()].filter(
  factId => !currentFactAllocations.has(factId),
)
if (unallocatedCurrentFacts.length > 0) {
  fail(`current X3 fact ${sorted(unallocatedCurrentFacts)[0]} is unallocated`)
}
if (currentFactAllocations.size !== currentManifestFacts.size) {
  fail(
    `current X3 factual join size mismatch: observed ${currentManifestFacts.size}, allocated ${currentFactAllocations.size}`,
  )
}

const currentCounts = {
  commands: currentCommands.length,
  configurationProperties: Object.keys(contributes.configuration?.properties ?? {}).length,
  customEditors: (contributes.customEditors ?? []).length,
  fileSystemSchemes: activationEvents.filter(event => event.startsWith('onFileSystem:')).length,
  keybindings: keybindingCommands.length,
  languages: (contributes.languages ?? []).length,
  menus: menuCommands.length,
  runtimeOnlyCommands: runtimeOnlyCommands.length,
  viewContainers: Object.values(contributes.viewsContainers ?? {}).flat().length,
  views: Object.values(contributes.views ?? {}).flat().length,
}

const EXPECTED_OWNER_BLOCKERS = [
  'owner/block-14-legacy-workflow-classification',
  'owner/block-14d-release-inclusion',
  'owner/block-14d-vscode-packaging-b-plus-c',
]
if (!Array.isArray(decisions.ownerBlockers)) fail('ownerBlockers must be an array')
const ownerBlockerById = new Map()
for (const blocker of decisions.ownerBlockers) {
  if (typeof blocker?.blockerId !== 'string' || blocker.blockerId.length === 0) {
    fail('every owner blocker needs a blockerId')
  }
  if (ownerBlockerById.has(blocker.blockerId)) fail(`duplicate owner blocker ${blocker.blockerId}`)
  if (blocker.state !== 'owner-blocked') fail(`${blocker.blockerId}: state must be owner-blocked`)
  if (blocker.owner !== 'modkit-program-owner') {
    fail(`${blocker.blockerId}: owner must be modkit-program-owner`)
  }
  if (typeof blocker.reason !== 'string' || blocker.reason.length < 20) {
    fail(`${blocker.blockerId}: reason is required`)
  }
  if (!Array.isArray(blocker.workflowIds) || blocker.workflowIds.length === 0) {
    fail(`${blocker.blockerId}: workflowIds must be non-empty`)
  }
  const uniqueWorkflows = new Set()
  for (const workflowId of blocker.workflowIds) {
    if (!workflowById.has(workflowId)) {
      fail(`${blocker.blockerId}: unknown workflow ${String(workflowId)}`)
    }
    if (uniqueWorkflows.has(workflowId)) {
      fail(`${blocker.blockerId}: duplicate workflow reference ${workflowId}`)
    }
    uniqueWorkflows.add(workflowId)
  }
  ownerBlockerById.set(blocker.blockerId, blocker)
}
if (sorted(ownerBlockerById.keys()).join('|') !== EXPECTED_OWNER_BLOCKERS.join('|')) {
  fail(`owner blockers must be exactly ${EXPECTED_OWNER_BLOCKERS.join(', ')}`)
}

const packagingBoundary = decisions.packagingBoundary ?? {}
const cataloguedCommonRoots = (vscodeCatalog.roots ?? []).filter(
  root => typeof root?.directory === 'string' && root.directory.startsWith('common/'),
).length
if (
  publicationInventory.schemaVersion !== 1 ||
  publicationInventory.artifactKind !== 'deterministic-shell' ||
  !Array.isArray(publicationInventory.shellEntries) ||
  !Array.isArray(publicationInventory.packagedCodecRoots)
) {
  fail('VS Code publication inventory must be deterministic-shell v1')
}
const publicationEntries = [
  ...publicationInventory.shellEntries,
  ...publicationInventory.packagedCodecRoots,
]
if (
  publicationEntries.some(entry => typeof entry !== 'string' || entry.length === 0) ||
  new Set(publicationEntries).size !== publicationEntries.length
) {
  fail('VS Code publication inventory entries must be unique non-empty strings')
}
const packagedCodecRoots = publicationInventory.packagedCodecRoots.length
if (
  vscodeCatalog.schemaVersion !== 1 ||
  vscodeCatalog.rootCount !== cataloguedCommonRoots ||
  cataloguedCommonRoots !== 18
) {
  fail(
    `VS Code catalog boundary must contain exactly 18 common roots; found ${String(vscodeCatalog.rootCount)}/${cataloguedCommonRoots}`,
  )
}
if (
  packagingBoundary.state !== 'owner-blocked' ||
  packagingBoundary.ownerBlockerId !== 'owner/block-14d-vscode-packaging-b-plus-c' ||
  packagingBoundary.cataloguedCommonRoots !== cataloguedCommonRoots ||
  packagingBoundary.packagedCodecRoots !== packagedCodecRoots ||
  packagedCodecRoots !== 0 ||
  packagingBoundary.deterministicShellArtifact !== true ||
  packagingBoundary.provenVsixCodecArtifact !== false ||
  typeof packagingBoundary.reason !== 'string' ||
  packagingBoundary.reason.length < 20
) {
  fail(
    'packagingBoundary must record 18 catalogued common roots, 0 packaged codec roots, an owner-blocked B+C decision, and no proven codec-bearing VSIX',
  )
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
if (targets.some(target => target.hostCallers?.includes('pwa'))) provePwaCommandCaller()
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
  for (const caller of target.hostCallers) {
    if (!['automation', 'cli', 'electron', 'pwa', 'server', 'vscode'].includes(caller)) {
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
const currentFactRows = sorted([...currentManifestFacts.keys()]).map(factId => {
  const observed = currentManifestFacts.get(factId)
  const allocation = currentFactAllocations.get(factId)
  return {
    factId,
    sourceFactSha256: sha256(
      JSON.stringify({
        factId: observed.factId,
        kind: observed.kind,
        key: observed.key,
        source: observed.source,
      }),
    ),
    kind: observed.kind,
    key: observed.key,
    source: observed.source,
    workflowId: allocation.workflowId,
    state: allocation.state,
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
    currentX3CommandIds: currentFactRows
      .filter(row => row.kind === 'vscode-command' && row.workflowId === workflowId)
      .map(row => row.key),
  }
})

const document = {
  $comment:
    'Generated by scripts/migration/emit-vscode-workflow-ledger.mjs. Legacy source facts come only from source-inventory.json and remain owner-pending; current X3 facts are an observed-only join and do not classify or replace legacy units.',
  schemaVersion: 'vscode-workflow-ledger-1',
  generator: 'scripts/migration/emit-vscode-workflow-ledger.mjs',
  inputs: {
    sourceInventorySha256: inputHash(inventoryPath),
    decisionsSha256: inputHash(decisionsPath),
    vscodeManifestSha256: inputHash(manifestPath),
    vscodeExtensionSourceSha256: inputHash(extensionSourcePath),
    vscodeCatalogSha256: inputHash(vscodeCatalogPath),
    vscodePublicationInventorySha256: inputHash(publicationInventoryPath),
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
    currentX3ObservedFacts: currentFactRows.length,
  },
  surfaceComparison: {
    legacyVsCode: { commands: 64, customEditors: 11, languages: 8, views: 6 },
    currentX3VsCode: currentCounts,
  },
  currentX3Commands: sorted(currentCommands).map(commandId => ({
    commandId,
    workflowId: currentFactAllocations.get(`x3:vscode-command:${commandId}`).workflowId,
  })),
  currentX3Facts: currentFactRows,
  deadCommandRatchet: {
    publicContributedCommands: sorted(currentCommands),
    registeredRuntimeCommands: runtimeModkitCommands,
    internalRuntimeCommands: sorted(internalCommands.keys()),
    externalOrBuiltinCommands: sorted(externalCommands.keys()),
    legacyKeybindings,
    currentX3Menus: menuCommands.length,
    currentX3Keybindings: keybindingCommands.length,
  },
  ownerBlockers: sorted(ownerBlockerById.keys()).map(blockerId => ownerBlockerById.get(blockerId)),
  packagingBoundary: {
    ...packagingBoundary,
    publicationArtifactKind: publicationInventory.artifactKind,
    publicationShellEntryCount: publicationInventory.shellEntries.length,
  },
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
  if (!quiet)
    console.log(
      `migration:check workflow ledger: 258 VS Code + 8 CLI units and ${currentFactRows.length} observed X3 facts up to date`,
    )
} else {
  await mkdir(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, rendered)
  if (!quiet)
    console.log(
      `migration:emit workflow ledger: wrote 258 VS Code + 8 CLI units and ${currentFactRows.length} observed X3 facts`,
    )
}
