import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const emitter = join(repoRoot, 'scripts', 'migration', 'emit-vscode-workflow-ledger.mjs')
const inventory = join(repoRoot, 'migration', 'generated', 'source-inventory.json')
const decisions = join(repoRoot, 'migration', 'vscode-workflows.json')
const manifest = join(repoRoot, 'apps', 'modkit-vscode', 'package.json')
const extensionSource = join(repoRoot, 'apps', 'modkit-vscode', 'src', 'extension.ts')
const publicationInventory = join(repoRoot, 'apps', 'modkit-vscode', 'publication-artifact.v1.json')
const targets = join(repoRoot, 'packages', 'host', 'src', 'commands', 'subject-command-targets.ts')
const pwaCommands = join(repoRoot, 'apps', 'web', 'src', 'commands.ts')
const committedLedger = join(repoRoot, 'migration', 'generated', 'vscode-workflow-ledger.json')

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [emitter, ...args], { encoding: 'utf8' })
}

function tempPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'modkitx-workflow-ledger-')), name)
}

interface InventoryUnit {
  readonly sourceUnitId: string
  readonly kind: string
  readonly extracted: Record<string, unknown>
}

interface InventoryDocument {
  readonly units: InventoryUnit[]
}

const readInventory = (): InventoryDocument => JSON.parse(readFileSync(inventory, 'utf8'))

function requireUnit(
  document: InventoryDocument,
  predicate: (unit: InventoryUnit) => boolean,
  label: string,
): InventoryUnit {
  const unit = document.units.find(predicate)
  if (unit === undefined) throw new Error(`test inventory has no ${label}`)
  return unit
}

function stringField(unit: InventoryUnit, key: string): string {
  const value = unit.extracted[key]
  if (typeof value !== 'string') throw new Error(`${unit.sourceUnitId}.${key} is not a string`)
  return value
}

const ambiguousRelationKeyCases = [
  { label: 'VS Code command', kind: 'vscode-command', key: 'command' },
  { label: 'VS Code view', kind: 'vscode-view', key: 'id' },
  { label: 'VS Code language', kind: 'vscode-language', key: 'id' },
  { label: 'CLI command', kind: 'cli-command', key: 'command' },
] as const

const wrongKindRelationCases = [
  {
    label: 'viewsWelcome → view',
    mutate(document: InventoryDocument): string {
      const welcome = requireUnit(
        document,
        unit =>
          unit.kind === 'vscode-contribution' && unit.extracted.contributionType === 'viewsWelcome',
        'viewsWelcome contribution',
      )
      const language = requireUnit(
        document,
        unit => unit.kind === 'vscode-language',
        'VS Code language',
      )
      const wrongKindKey = stringField(language, 'id')
      welcome.extracted.key = wrongKindKey
      return `${welcome.sourceUnitId}: viewsWelcome references unknown view ${wrongKindKey}`
    },
  },
  {
    label: 'language contribution → language',
    mutate(document: InventoryDocument): string {
      const grammar = requireUnit(
        document,
        unit =>
          unit.kind === 'vscode-contribution' && unit.extracted.contributionType === 'grammars',
        'grammar contribution',
      )
      const view = requireUnit(document, unit => unit.kind === 'vscode-view', 'VS Code view')
      const wrongKindKey = stringField(view, 'id')
      grammar.extracted.key = wrongKindKey
      return `${grammar.sourceUnitId}: language contribution references unknown language ${wrongKindKey}`
    },
  },
  {
    label: 'CLI subcommand → CLI parent',
    mutate(document: InventoryDocument): string {
      const subcommand = requireUnit(
        document,
        unit => unit.kind === 'cli-subcommand',
        'CLI subcommand',
      )
      const vscodeCommand = requireUnit(
        document,
        unit => unit.kind === 'vscode-command',
        'VS Code command',
      )
      const wrongKindKey = stringField(vscodeCommand, 'command')
      subcommand.extracted.command = wrongKindKey
      return `${subcommand.sourceUnitId}: subcommand references unknown CLI command ${wrongKindKey}`
    },
  },
] as const

describe('block 14A VS Code + CLI workflow ledger', () => {
  it('covers exactly 258 VS Code and 8 CLI facts and derives relational units', () => {
    const result = run(['--check'])
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('258 VS Code + 8 CLI')

    const ledger = JSON.parse(readFileSync(committedLedger, 'utf8'))
    expect(ledger.counts).toMatchObject({
      total: 266,
      legacyVsCode: 258,
      legacyCli: 8,
      decisionRequired: 266,
      currentX3ObservedFacts: 15,
    })
    expect(ledger.counts.byKind).toEqual({
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
    expect(
      Object.fromEntries(
        ['cli-parent', 'language-contribution', 'menu-command', 'view-welcome'].map(kind => [
          kind,
          ledger.units.filter(
            (row: { derivation: { kind: string } }) => row.derivation.kind === kind,
          ).length,
        ]),
      ),
    ).toEqual({
      'cli-parent': 3,
      'language-contribution': 7,
      'menu-command': 84,
      'view-welcome': 5,
    })
    expect(
      ledger.units.every(
        (row: {
          plannedSlice: string
          classification: {
            disposition: string
            migrationState: string
            owner: string
            releaseTrack: string
            replacementWorkflowId: null
            targetState: string
          }
        }) =>
          ['block-14b', 'block-14c', 'block-14d'].includes(row.plannedSlice) &&
          row.classification.disposition === 'decision-required' &&
          row.classification.migrationState === 'unknown' &&
          row.classification.owner === 'modkit-program-owner' &&
          row.classification.releaseTrack === 'decision-required' &&
          row.classification.replacementWorkflowId === null &&
          row.classification.targetState === 'decision-required',
      ),
    ).toBe(true)
    expect(
      ledger.units.every(
        (row: {
          classification: {
            migrationState: string
            releaseTrack: string
            replacementWorkflowId: null
          }
        }) =>
          row.classification.migrationState === 'unknown' &&
          row.classification.releaseTrack === 'decision-required' &&
          row.classification.replacementWorkflowId === null,
      ),
    ).toBe(true)
  })

  it('records the factual 64→7, 11→1, 8→0 and 6→2 surface change', () => {
    const ledger = JSON.parse(readFileSync(committedLedger, 'utf8'))
    expect(ledger.surfaceComparison).toEqual({
      legacyVsCode: { commands: 64, customEditors: 11, languages: 8, views: 6 },
      currentX3VsCode: {
        commands: 7,
        configurationProperties: 2,
        customEditors: 1,
        fileSystemSchemes: 1,
        keybindings: 0,
        languages: 0,
        menus: 0,
        runtimeOnlyCommands: 1,
        viewContainers: 1,
        views: 2,
      },
    })
    expect(ledger.sharedCommandTargets.map((row: { commandId: string }) => row.commandId)).toEqual([
      'subject.convert',
      'subject.extract',
      'subject.inspect',
      'subject.open',
      'subject.preview',
      'subject.validate',
    ])
    expect(
      ledger.sharedCommandTargets.every(
        (row: { hostCallers: string[] }) =>
          row.hostCallers.includes('automation') && row.hostCallers.includes('pwa'),
      ),
    ).toBe(true)
    expect(ledger.currentX3Facts).toHaveLength(15)
    expect(
      ledger.currentX3Facts.every((row: { state: string }) => row.state === 'observed-only'),
    ).toBe(true)
    expect(ledger.deadCommandRatchet).toEqual({
      publicContributedCommands: [
        'modkit.addExtensionFolder',
        'modkit.browseContainer',
        'modkit.explainResolution',
        'modkit.openArchiveEntry',
        'modkit.openWith',
        'modkit.runCommand',
        'modkit.showHostProfile',
      ],
      registeredRuntimeCommands: [
        'modkit.addExtensionFolder',
        'modkit.browseContainer',
        'modkit.explainResolution',
        'modkit.openArchiveEntry',
        'modkit.openResource',
        'modkit.openWith',
        'modkit.runCommand',
        'modkit.showHostProfile',
      ],
      internalRuntimeCommands: ['modkit.openResource'],
      externalOrBuiltinCommands: [],
      legacyKeybindings: 0,
      currentX3Menus: 0,
      currentX3Keybindings: 0,
    })
    expect(ledger.ownerBlockers.map((row: { blockerId: string }) => row.blockerId)).toEqual([
      'owner/block-14-legacy-workflow-classification',
      'owner/block-14d-release-inclusion',
      'owner/block-14d-vscode-packaging-b-plus-c',
    ])
    expect(ledger.packagingBoundary).toMatchObject({
      state: 'owner-blocked',
      cataloguedCommonRoots: 18,
      packagedCodecRoots: 0,
      deterministicShellArtifact: true,
      provenVsixCodecArtifact: false,
      publicationArtifactKind: 'deterministic-shell',
      publicationShellEntryCount: 5,
    })
  })

  it('refuses to promote an unknown workflow to mk3-priority', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    brokenDecisions.workflows[0].classification.releaseTrack = 'mk3-priority'
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))
    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('mk3-priority cannot remain unknown')
  })

  it('refuses an unclassified inventory fact', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    brokenDecisions.workflows[0].legacyCommandIds.shift()
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))
    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('referenced command is not classified')
  })

  it.each(ambiguousRelationKeyCases)(
    'refuses an ambiguous $label relation key while counts stay fixed',
    ({ kind, key }) => {
      const brokenInventory = readInventory()
      const candidates = brokenInventory.units.filter(unit => unit.kind === kind)
      expect(candidates.length).toBeGreaterThan(1)
      const first = candidates[0]
      const second = candidates[1]
      if (first === undefined || second === undefined) {
        throw new Error(`expected at least two ${kind} candidates`)
      }
      const duplicate = stringField(first, key)
      second.extracted[key] = duplicate
      const inventoryPath = tempPath('inventory.json')
      writeFileSync(inventoryPath, JSON.stringify(brokenInventory))

      const result = run(['--inventory', inventoryPath, '--output', tempPath('ledger.json')])

      expect(result.status).toBe(1)
      expect(result.stderr.trim()).toBe(
        `migration:emit workflow ledger: ${kind} relation key ${duplicate} is not unique`,
      )
    },
  )

  it.each(wrongKindRelationCases)(
    'refuses a wrong-kind $label relation while counts stay fixed',
    ({ mutate }) => {
      const brokenInventory = readInventory()
      const diagnostic = mutate(brokenInventory)
      const inventoryPath = tempPath('inventory.json')
      writeFileSync(inventoryPath, JSON.stringify(brokenInventory))

      const result = run(['--inventory', inventoryPath, '--output', tempPath('ledger.json')])

      expect(result.status).toBe(1)
      expect(result.stderr.trim()).toBe(`migration:emit workflow ledger: ${diagnostic}`)
    },
  )

  it('refuses duplicate classification rules for the same legacy fact', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    brokenDecisions.workflows[1].legacyCommandIds.push(
      brokenDecisions.workflows[0].legacyCommandIds[0],
    )
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))
    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is classified by both')
  })

  it('refuses a dangling menu-to-command relation in the inventory', () => {
    const brokenInventory = JSON.parse(readFileSync(inventory, 'utf8'))
    const menu = brokenInventory.units.find(
      (unit: { kind: string }) => unit.kind === 'vscode-menu-item',
    )
    menu.extracted.command = 'modkit.commandThatDoesNotExist'
    const inventoryPath = tempPath('inventory.json')
    writeFileSync(inventoryPath, JSON.stringify(brokenInventory))
    const result = run(['--inventory', inventoryPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'menu references unknown command modkit.commandThatDoesNotExist',
    )
  })

  it('refuses an allocation that names an unknown current X3 fact', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    brokenDecisions.currentX3Facts[0].key = 'modkit.commandThatDoesNotExist'
    brokenDecisions.currentX3Facts[0].factId = 'x3:vscode-command:modkit.commandThatDoesNotExist'
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))
    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'allocation names unknown current X3 fact x3:vscode-command:modkit.commandThatDoesNotExist',
    )
  })

  it('refuses duplicate allocation of one current X3 fact', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    brokenDecisions.currentX3Facts.push({ ...brokenDecisions.currentX3Facts[0] })
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))

    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('current X3 fact is allocated more than once')
  })

  it('derives the zero packaged-codec boundary from the publication inventory', () => {
    const brokenInventory = JSON.parse(readFileSync(publicationInventory, 'utf8'))
    brokenInventory.packagedCodecRoots.push('extensions/common/images')
    const inventoryPath = tempPath('publication-artifact.v1.json')
    writeFileSync(inventoryPath, JSON.stringify(brokenInventory))

    const result = run([
      '--publication-inventory',
      inventoryPath,
      '--output',
      tempPath('ledger.json'),
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'packagingBoundary must record 18 catalogued common roots, 0 packaged codec roots',
    )
  })

  it('refuses a new unallocated manifest fact', () => {
    const brokenManifest = JSON.parse(readFileSync(manifest, 'utf8'))
    brokenManifest.contributes.configuration.properties['modkit.unallocatedSetting'] = {
      type: 'boolean',
    }
    const manifestPath = tempPath('package.json')
    writeFileSync(manifestPath, JSON.stringify(brokenManifest))

    const result = run(['--manifest', manifestPath, '--output', tempPath('ledger.json')])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'current X3 fact x3:vscode-configuration-property:modkit.unallocatedSetting is unallocated',
    )
  })

  it('refuses a contributed command without a runtime registration', () => {
    const source = readFileSync(extensionSource, 'utf8')
    const brokenSource = source.replace(
      "vscode.commands.registerCommand('modkit.showHostProfile'",
      "vscode.commands.registerCommand('modkit.renamedAtRuntime'",
    )
    expect(brokenSource).not.toBe(source)
    const sourcePath = tempPath('extension.ts')
    writeFileSync(sourcePath, brokenSource)

    const result = run(['--extension-source', sourcePath, '--output', tempPath('ledger.json')])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('contributed command modkit.showHostProfile is not registered')
  })

  it('refuses a hidden runtime modkit command outside the exact internal allowlist', () => {
    const sourcePath = tempPath('extension.ts')
    writeFileSync(
      sourcePath,
      `${readFileSync(extensionSource, 'utf8')}\nvscode.commands.registerCommand('modkit.hiddenCommand', () => {})\n`,
    )

    const result = run(['--extension-source', sourcePath, '--output', tempPath('ledger.json')])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'hidden runtime command modkit.hiddenCommand is not allowlisted',
    )
  })

  it.each([
    { surface: 'menu', command: '-modkit.danglingMenu' },
    { surface: 'keybinding', command: '-modkit.danglingKeybinding' },
  ] as const)('refuses a dangling normalized $surface command', ({ surface, command }) => {
    const brokenManifest = JSON.parse(readFileSync(manifest, 'utf8'))
    if (surface === 'menu') {
      brokenManifest.contributes.menus = { commandPalette: [{ command }] }
    } else {
      brokenManifest.contributes.keybindings = [{ command, key: 'ctrl+alt+m' }]
    }
    const manifestPath = tempPath('package.json')
    writeFileSync(manifestPath, JSON.stringify(brokenManifest))

    const result = run(['--manifest', manifestPath, '--output', tempPath('ledger.json')])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `dangling command ${surface === 'menu' ? 'modkit.danglingMenu' : 'modkit.danglingKeybinding'}`,
    )
  })

  it('refuses a dangling normalized alternate menu command', () => {
    const brokenManifest = JSON.parse(readFileSync(manifest, 'utf8'))
    brokenManifest.contributes.menus = {
      commandPalette: [{ command: 'modkit.openWith', alt: '-modkit.danglingAlt' }],
    }
    const manifestPath = tempPath('package.json')
    writeFileSync(manifestPath, JSON.stringify(brokenManifest))

    const result = run(['--manifest', manifestPath, '--output', tempPath('ledger.json')])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('dangling command modkit.danglingAlt')
  })

  it('keeps vscode-workflow-decisions-1 pending-only', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    brokenDecisions.workflows[0].classification.migrationState = 'implemented'
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))
    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'vscode-workflow-decisions-1 is pending-only; migrationState must be "unknown"',
    )
  })

  it('refuses to claim PWA as a caller without runtime wiring evidence', () => {
    const source = readFileSync(pwaCommands, 'utf8')
    const brokenCommands = source.replace(
      'createSubjectCommandEndpoint({',
      'createSubjectCommandEndpointWithoutProductionWiring({',
    )
    expect(brokenCommands).not.toBe(source)
    const commandsPath = tempPath('commands.ts')
    writeFileSync(commandsPath, brokenCommands)
    const result = run(['--pwa-commands', commandsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('PWA command caller proof is missing commands wiring')
  })

  it('rejects executable syntax inside the TypeScript target catalog instead of evaluating it', () => {
    const brokenTargets = readFileSync(targets, 'utf8').replace(
      'operationIds: [],',
      'operationIds: [resolveOperationAtRuntime()],',
    )
    const targetsPath = tempPath('subject-command-targets.ts')
    writeFileSync(targetsPath, brokenTargets)
    const result = run(['--targets', targetsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('executable or non-literal syntax CallExpression is forbidden')
  })

  it('rejects additional executable top-level statements in the target catalog', () => {
    const brokenTargets = `${readFileSync(targets, 'utf8')}\nregisterTargetsAtRuntime()\n`
    const targetsPath = tempPath('subject-command-targets.ts')
    writeFileSync(targetsPath, brokenTargets)
    const result = run(['--targets', targetsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('contains executable top-level ExpressionStatement')
  })

  it('treats an inventory fact mutation as stale without rewriting the checked output', () => {
    const changedInventory = JSON.parse(readFileSync(inventory, 'utf8'))
    const setting = changedInventory.units.find(
      (unit: { kind: string }) => unit.kind === 'vscode-configuration-property',
    )
    setting.extracted.hasDefault = !setting.extracted.hasDefault
    const inventoryPath = tempPath('inventory.json')
    writeFileSync(inventoryPath, JSON.stringify(changedInventory))
    const output = tempPath('ledger.json')
    writeFileSync(output, readFileSync(committedLedger, 'utf8'))
    const before = readFileSync(output, 'utf8')
    const result = run(['--check', '--inventory', inventoryPath, '--output', output])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is stale')
    expect(readFileSync(output, 'utf8')).toBe(before)
  })

  it('checks drift without rewriting a stale artifact', () => {
    const output = tempPath('ledger.json')
    writeFileSync(output, '{}\n')
    const before = readFileSync(output, 'utf8')
    const result = run(['--check', '--output', output])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is stale')
    expect(readFileSync(output, 'utf8')).toBe(before)
  })
})
