import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUBJECT_COMMAND_TARGETS } from '@modkitx-x3/host'
import { describe, expect, it } from 'vitest'

import {
  FOCUSED_SC2_AUTHORING_REPLACEMENTS,
  FOCUSED_SC2_LANGUAGE_CONTRIBUTIONS,
  focusedSc2AuthoringReplacement,
} from '../src/sc2-authoring-workflows.js'
import { STAGE_ORDER } from '../src/view-policy.js'

const appRoot = join(import.meta.dirname, '..')
const repoRoot = join(appRoot, '..', '..')

describe('focused SC2 authoring workflow replacements', () => {
  it('maps every exact 42-fact accepted decision once in lexical order', () => {
    const ledger = JSON.parse(
      readFileSync(join(repoRoot, 'migration', 'generated', 'vscode-workflow-ledger.json'), 'utf8'),
    ) as {
      readonly units: readonly {
        readonly sourceUnitId: string
        readonly classification: {
          readonly decisionId: string
          readonly disposition: string
        }
      }[]
    }
    const accepted = ledger.units.filter(
      row => row.classification.decisionId === 'candidate-vscode-authoring',
    )
    expect(accepted.every(row => row.classification.disposition === 'already-equivalent')).toBe(
      true,
    )
    const expected = accepted.map(row => row.sourceUnitId).sort()
    const actual = FOCUSED_SC2_AUTHORING_REPLACEMENTS.map(row => row.legacySourceUnitId)

    expect(actual).toEqual(expected)
    expect(actual).toHaveLength(42)
    expect(new Set(actual).size).toBe(actual.length)
    expect(Object.isFrozen(FOCUSED_SC2_AUTHORING_REPLACEMENTS)).toBe(true)
  })

  it('keeps all non-launch behavior on shared contracts, commands and presentation stages', () => {
    const nativeCommands = new Set([
      'modkit.navigateResource',
      'modkit.openWith',
      'modkit.runCommand',
    ])
    const sharedCommands = new Set<string>(
      Object.values(SUBJECT_COMMAND_TARGETS).map(target => target.commandId),
    )

    for (const row of FOCUSED_SC2_AUTHORING_REPLACEMENTS) {
      expect(Object.isFrozen(row)).toBe(true)
      expect(Object.isFrozen(row.targets)).toBe(true)
      expect(row.reason.length).toBeGreaterThan(30)
      if (row.owner === 'game-launch-integration') continue
      for (const target of row.targets) {
        if (target.startsWith('presentation:')) {
          expect(STAGE_ORDER).toContain(target.slice('presentation:'.length))
          continue
        }
        expect(
          nativeCommands.has(target) ||
            sharedCommands.has(target) ||
            target.startsWith('contributes.languages:') ||
            target.startsWith('language-session.') ||
            target === 'common.language/document-analysis@1' ||
            target === 'common.edit/writer@1' ||
            target === 'vscode.nativeTextEditor',
        ).toBe(true)
      }
    }
    expect(SUBJECT_COMMAND_TARGETS.validate).toMatchObject({
      commandId: 'subject.validate',
      operationIds: ['asset.validate'],
      hostCallers: expect.arrayContaining(['vscode']),
    })
  })

  it('declares six honest native file associations without app-owned grammars or snippets', () => {
    const manifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
      readonly contributes: {
        readonly languages?: readonly Record<string, unknown>[]
        readonly grammars?: readonly unknown[]
        readonly snippets?: readonly unknown[]
      }
    }
    const authority = JSON.parse(
      readFileSync(join(appRoot, 'bundled-contributes.v1.json'), 'utf8'),
    ) as { readonly languages: readonly Record<string, unknown>[] }
    const declared = FOCUSED_SC2_LANGUAGE_CONTRIBUTIONS.map(row =>
      Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'analysis')),
    )

    expect(manifest.contributes.languages).toEqual(authority.languages)
    expect(manifest.contributes.languages).toEqual(declared)
    expect(manifest.contributes.grammars).toBeUndefined()
    expect(manifest.contributes.snippets).toBeUndefined()
    expect(FOCUSED_SC2_LANGUAGE_CONTRIBUTIONS.map(row => row.id)).toEqual([
      'galaxy',
      'ini',
      'sc2layout',
      'sc2strings',
      'sc2style',
      'xml',
    ])
    expect(FOCUSED_SC2_LANGUAGE_CONTRIBUTIONS.find(row => row.id === 'galaxy')).toMatchObject({
      analysis: 'shared-provider',
    })
    expect(
      FOCUSED_SC2_LANGUAGE_CONTRIBUTIONS.filter(row => row.id !== 'galaxy').every(
        row => row.analysis === 'subject-workbench',
      ),
    ).toBe(true)
  })

  it('isolates the five launch-owned facts for the explicit game-service integration', () => {
    const launch = FOCUSED_SC2_AUTHORING_REPLACEMENTS.filter(
      row => row.owner === 'game-launch-integration',
    )
    expect(launch).toHaveLength(5)
    expect(launch.flatMap(row => row.targets)).toEqual(
      expect.arrayContaining(['modkit.game.launchActiveMap']),
    )
    expect(focusedSc2AuthoringReplacement('legacy/vscode/command/modkit.launchMap')).toMatchObject({
      owner: 'game-launch-integration',
      targets: ['modkit.game.launchActiveMap'],
    })
    expect(focusedSc2AuthoringReplacement('legacy/vscode/command/not-in-scope')).toBeUndefined()
  })
})
