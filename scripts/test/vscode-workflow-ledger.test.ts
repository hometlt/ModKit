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
  })

  it('records the factual 64→7, 11→1, 8→0 and 6→2 surface change', () => {
    const ledger = JSON.parse(readFileSync(committedLedger, 'utf8'))
    expect(ledger.surfaceComparison).toEqual({
      legacyVsCode: { commands: 64, customEditors: 11, languages: 8, views: 6 },
      currentX3VsCode: { commands: 7, customEditors: 1, languages: 0, views: 2 },
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

  it('refuses a decisions rule that names an unknown current X3 command', () => {
    const brokenDecisions = JSON.parse(readFileSync(decisions, 'utf8'))
    brokenDecisions.workflows[0].currentX3CommandIds.push('modkit.commandThatDoesNotExist')
    const decisionsPath = tempPath('decisions.json')
    writeFileSync(decisionsPath, JSON.stringify(brokenDecisions))
    const result = run(['--decisions', decisionsPath, '--output', tempPath('ledger.json')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'classification names unknown current X3 command modkit.commandThatDoesNotExist',
    )
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
