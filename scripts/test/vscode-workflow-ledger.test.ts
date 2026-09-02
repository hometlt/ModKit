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
const manifest = join(repoRoot, 'apps', 'vscode', 'package.json')
const extensionSource = join(repoRoot, 'apps', 'vscode', 'src', 'extension.ts')
const publicationInventory = join(repoRoot, 'apps', 'vscode', 'publication-artifact.v1.json')
const targets = join(repoRoot, 'packages', 'host', 'src', 'commands', 'subject-command-targets.ts')
const pwaCommands = join(repoRoot, 'apps', 'web', 'src', 'commands.ts')
const committedLedger = join(repoRoot, 'migration', 'generated', 'vscode-workflow-ledger.json')
const generatedShortlist = join(
  repoRoot,
  'migration',
  'generated',
  'vscode-workflow-shortlist.json',
)
const generatedBacklog = join(repoRoot, 'migration', 'generated', 'vscode-workflow-backlog.json')
const generatedStatus = join(repoRoot, 'migration', 'generated', 'status.md')

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [emitter, ...args], { encoding: 'utf8' })
}

function tempPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'modkit-workflow-ledger-')), name)
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

describe('Block 20 VS Code + CLI workflow ledger', () => {
  it('covers all 266 facts in three explicit baskets and derives relational units', () => {
    const result = run(['--check'])
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('266 facts in three baskets')

    const ledger = JSON.parse(readFileSync(committedLedger, 'utf8'))
    expect(ledger.counts).toMatchObject({
      total: 266,
      legacyVsCode: 258,
      legacyCli: 8,
      byDisposition: {
        'already-equivalent': 204,
        'release-candidate': 0,
        'post-release': 62,
      },
      decisionRequired: 0,
      releaseCandidateGaps: 0,
      // Wave 2B added three custom editors, two commands and three settings.
      currentX3ObservedFacts: 67,
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
            releaseTrack: string
            targetState: string
          }
        }) =>
          ['block-14b', 'block-14c', 'block-14d'].includes(row.plannedSlice) &&
          ['already-equivalent', 'release-candidate', 'post-release'].includes(
            row.classification.disposition,
          ) &&
          row.classification.migrationState !== 'unknown' &&
          row.classification.releaseTrack !== 'decision-required' &&
          row.classification.targetState !== 'decision-required',
      ),
    ).toBe(true)
    expect(
      Object.values(ledger.counts.byDisposition).reduce(
        (sum: number, count) => sum + Number(count),
        0,
      ),
    ).toBe(266)

    const workflowDisposition = Object.fromEntries(
      ledger.workflows.map(
        (row: { workflowId: string; classification: { disposition: string } }) => [
          row.workflowId,
          row.classification.disposition,
        ],
      ),
    )
    expect(workflowDisposition['vscode/shared-command-shell']).toBe('already-equivalent')
    expect(workflowDisposition['cli/install']).toBe('post-release')
    expect(workflowDisposition['cli/lsp']).toBe('post-release')
  })

  it('classifies mixed workflows fact by fact instead of promoting the whole group', () => {
    const ledger = JSON.parse(readFileSync(committedLedger, 'utf8'))
    const disposition = (sourceUnitId: string): string =>
      ledger.units.find((row: { sourceUnitId: string }) => row.sourceUnitId === sourceUnitId)
        ?.classification.disposition

    expect(disposition('legacy/vscode/command/modkit.explainResolution')).toBe('already-equivalent')
    expect(disposition('legacy/vscode/command/modkit.showLog')).toBe('already-equivalent')
    expect(disposition('legacy/vscode/custom-editor/modkit.replayPlayer')).toBe('post-release')
    expect(disposition('legacy/vscode/command/modkit.inspectModel')).toBe('already-equivalent')
  })

  it('emits a complete Product GA shortlist and explicit post-release backlog', () => {
    const shortlist = JSON.parse(readFileSync(generatedShortlist, 'utf8'))
    const backlog = JSON.parse(readFileSync(generatedBacklog, 'utf8'))
    expect(shortlist.counts).toEqual({ gaps: 0, facts: 0 })
    expect(shortlist.gaps).toEqual([])
    expect(
      shortlist.gaps.every(
        (gap: { exactSourceUnitIds: string[]; factCount: number; evidence: string[] }) =>
          gap.exactSourceUnitIds.length > 0 && gap.factCount > 0 && gap.evidence.length > 0,
      ),
    ).toBe(true)
    expect(backlog.counts).toEqual({ workflows: 6, facts: 62 })
    expect(
      backlog.workflows.flatMap((row: { sourceUnitIds: string[] }) => row.sourceUnitIds),
    ).toHaveLength(62)
  })

  it('records the factual 64→37, 11→4, 8→0 and 6→2 surface change', () => {
    const ledger = JSON.parse(readFileSync(committedLedger, 'utf8'))
    expect(ledger.surfaceComparison).toEqual({
      legacyVsCode: { commands: 64, customEditors: 11, languages: 8, views: 6 },
      currentX3VsCode: {
        // Wave 2B: two association commands, three settings, three stage-specific editors.
        commands: 37,
        configurationProperties: 7,
        customEditors: 4,
        fileSystemSchemes: 1,
        keybindings: 0,
        languages: 0,
        menus: 12,
        runtimeOnlyCommands: 3,
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
    const status = readFileSync(generatedStatus, 'utf8')
    expect(status).toContain(
      'Доказанные callers: Automation, CLI, Electron, PWA, `server`, VS Code.',
    )
    expect(status).not.toContain('PWA не заявлен')
    expect(ledger.currentX3Facts).toHaveLength(67)
    expect(
      ledger.currentX3Facts.every((row: { state: string }) => row.state === 'observed-only'),
    ).toBe(true)
    expect(
      ledger.currentX3Facts
        .filter(
          (row: { key: string }) =>
            row.key.startsWith('modkit.extensions.') || row.key === 'modkit.extensionRegistry',
        )
        .map((row: { key: string; kind: string; source: string; workflowId: string }) => ({
          key: row.key,
          kind: row.kind,
          source: row.source.replace(/\[\d+\]$/, '[index]'),
          workflowId: row.workflowId,
        })),
    ).toEqual([
      {
        key: 'modkit.extensions.completeGameSupport',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.disable',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.disableAllCodecs',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.disableContribution',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.enable',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.enableAllCodecs',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.enableContribution',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.install',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.installAll',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.installGameSupport',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.openContribution',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/views-workbench',
      },
      {
        key: 'modkit.extensions.openExtension',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/views-workbench',
      },
      {
        key: 'modkit.extensions.refresh',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.remove',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.removeGameSupport',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.removeVendorSupport',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.update',
        kind: 'vscode-command',
        source: 'contributes.commands[index]',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensionRegistry',
        kind: 'vscode-configuration-property',
        source: 'contributes.configuration.modkit.extensionRegistry',
        workflowId: 'vscode/manifest-settings',
      },
      {
        key: 'modkit.extensions.openGame',
        kind: 'vscode-runtime-only-command',
        source: 'VS Code runtime registration',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
      {
        key: 'modkit.extensions.openVendor',
        kind: 'vscode-runtime-only-command',
        source: 'VS Code runtime registration',
        workflowId: 'vscode/source-workspace-lifecycle',
      },
    ])
    expect(ledger.deadCommandRatchet).toEqual({
      publicContributedCommands: [
        'modkit.addExtensionFolder',
        'modkit.browseContainer',
        'modkit.explainResolution',
        'modkit.exportDiagnostics',
        'modkit.extensions.completeGameSupport',
        'modkit.extensions.disable',
        'modkit.extensions.disableAllCodecs',
        'modkit.extensions.disableContribution',
        'modkit.extensions.enable',
        'modkit.extensions.enableAllCodecs',
        'modkit.extensions.enableContribution',
        'modkit.extensions.install',
        'modkit.extensions.installAll',
        'modkit.extensions.installGameSupport',
        'modkit.extensions.openContribution',
        'modkit.extensions.openExtension',
        'modkit.extensions.refresh',
        'modkit.extensions.remove',
        'modkit.extensions.removeGameSupport',
        'modkit.extensions.removeVendorSupport',
        'modkit.extensions.update',
        'modkit.game.launchActiveMap',
        'modkit.materializeContainerEntry',
        'modkit.navigateResource',
        'modkit.openArchiveEntry',
        'modkit.openWith',
        'modkit.refreshContainer',
        'modkit.refreshRelations',
        'modkit.runCommand',
        'modkit.runtime.control',
        'modkit.searchContainer',
        'modkit.selectGameInstallation',
        'modkit.setCodecDefaultEditor',
        'modkit.showDiagnostics',
        'modkit.showHostProfile',
        'modkit.syncEditorAssociations',
        'modkit.unloadSource',
      ],
      registeredRuntimeCommands: [
        'modkit.addExtensionFolder',
        'modkit.browseContainer',
        'modkit.explainResolution',
        'modkit.exportDiagnostics',
        'modkit.extensions.completeGameSupport',
        'modkit.extensions.disable',
        'modkit.extensions.disableAllCodecs',
        'modkit.extensions.disableContribution',
        'modkit.extensions.enable',
        'modkit.extensions.enableAllCodecs',
        'modkit.extensions.enableContribution',
        'modkit.extensions.install',
        'modkit.extensions.installAll',
        'modkit.extensions.installGameSupport',
        'modkit.extensions.openContribution',
        'modkit.extensions.openExtension',
        'modkit.extensions.openGame',
        'modkit.extensions.openVendor',
        'modkit.extensions.refresh',
        'modkit.extensions.remove',
        'modkit.extensions.removeGameSupport',
        'modkit.extensions.removeVendorSupport',
        'modkit.extensions.update',
        'modkit.game.launchActiveMap',
        'modkit.materializeContainerEntry',
        'modkit.navigateResource',
        'modkit.openArchiveEntry',
        'modkit.openResource',
        'modkit.openWith',
        'modkit.refreshContainer',
        'modkit.refreshRelations',
        'modkit.runCommand',
        'modkit.runtime.control',
        'modkit.searchContainer',
        'modkit.selectGameInstallation',
        'modkit.setCodecDefaultEditor',
        'modkit.showDiagnostics',
        'modkit.showHostProfile',
        'modkit.syncEditorAssociations',
        'modkit.unloadSource',
      ],
      internalRuntimeCommands: [
        'modkit.extensions.openGame',
        'modkit.extensions.openVendor',
        'modkit.openResource',
      ],
      externalOrBuiltinCommands: [],
      legacyKeybindings: 0,
      currentX3Menus: 12,
      currentX3Keybindings: 0,
    })
    expect(ledger.ownerBlockers).toEqual([])
    expect(ledger.packagingBoundary).toMatchObject({
      state: 'already-equivalent',
      ownerBlockerId: null,
      cataloguedCommonRoots: 8,
      packagedCodecRoots: 8,
      deterministicShellArtifact: true,
      provenVsixCodecArtifact: true,
      publicationArtifactKind: 'deterministic-shell',
      publicationShellEntryCount: 6,
    })
  })

  it('refuses already-equivalent facts without exact evidence', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    const decision = brokenDecisions.factDecisions.find(
      (row: { disposition: string }) => row.disposition === 'already-equivalent',
    )
    decision.evidence = []
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))
    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('exact evidence is required')
  })

  it('refuses duplicate fact decisions for one source unit', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    brokenDecisions.factDecisions[1].sourceUnitIds.push(
      brokenDecisions.factDecisions[0].sourceUnitIds[0],
    )
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))
    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('fact decision appears in both')
  })

  it('refuses a fact decision for an unknown source unit', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    brokenDecisions.factDecisions[0].sourceUnitIds[0] = 'legacy/vscode/command/modkit.missing'
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))
    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unknown source unit legacy/vscode/command/modkit.missing')
  })

  it('refuses a release-candidate fact without a known gap', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    const decision = brokenDecisions.factDecisions.find(
      (row: { disposition: string }) => row.disposition === 'already-equivalent',
    )
    decision.disposition = 'release-candidate'
    decision.gapId = 'missing-gap'
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))
    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('release-candidate requires a known gapId')
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

  it('derives the complete packaged-codec boundary from the publication inventory', () => {
    const brokenInventory = JSON.parse(readFileSync(publicationInventory, 'utf8'))
    brokenInventory.packagedCodecRoots.pop()
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
      'packagingBoundary must record the accepted deterministic shell with every catalogued Common root in the proven codec-bearing VSIX',
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

  it('refuses a workflow summary that disagrees with its exact fact aggregate', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    brokenDecisions.workflows[0].classification = {
      disposition: 'post-release',
      migrationState: 'deferred-post-ga',
      releaseTrack: 'post-ga',
      owner: 'apps/vscode',
      targetState: 'deferred-post-ga',
      replacementWorkflowId: 'platform/apps/priority-workflows',
      reason: 'This deliberately disagrees with exact already-equivalent facts in the test input.',
    }
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))
    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('does not match fact aggregate already-equivalent')
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
