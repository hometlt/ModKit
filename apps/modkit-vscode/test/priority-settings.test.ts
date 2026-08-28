import { describe, expect, it } from 'vitest'

import {
  FOCUSED_PRIORITY_SETTING_REPLACEMENTS,
  focusedPrioritySettingReplacement,
} from '../src/priority-settings.js'

const EXPECTED_KEYS = [
  'modkit.autoDetectInstall',
  'modkit.builtinMods',
  'modkit.casc.autoLoadForProjects',
  'modkit.casc.installations',
  'modkit.dataPath',
  'modkit.disabledMods',
  'modkit.documentDiagnosticsDelay',
  'modkit.documentUpdateDelay',
  'modkit.enable',
  'modkit.gameInstallations',
  'modkit.gamedata.useLsp',
  'modkit.games.codecOverrides',
  'modkit.launch.gameLogsPath',
  'modkit.launch.installDir',
  'modkit.launch.mapPath',
  'modkit.launch.warnIfRunning',
  'modkit.locale',
  'modkit.log.categories',
  'modkit.log.level',
  'modkit.maxGraphHops',
  'modkit.modelPreview.renderer',
  'modkit.s2mod.sources',
  'modkit.sources',
  'modkit.treeview.visible',
  'modkit.xsdPath',
] as const

describe('focused VS Code setting replacements', () => {
  it('maps every exact Product GA setting once and in stable lexical order', () => {
    const keys = FOCUSED_PRIORITY_SETTING_REPLACEMENTS.map(item => item.legacyKey)
    expect(keys).toEqual(EXPECTED_KEYS)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses the portable model, provider options, host policy or shared workflows only', () => {
    const acceptedKinds = new Set([
      'portable-setting',
      'provider-option',
      'automatic-policy',
      'shared-workflow',
    ])
    for (const row of FOCUSED_PRIORITY_SETTING_REPLACEMENTS) {
      expect(acceptedKinds.has(row.kind)).toBe(true)
      expect(row.target).not.toMatch(/^modkit\.(?:autoDetectInstall|builtinMods|casc\.)/u)
      expect(row.reason.length).toBeGreaterThan(20)
      expect(Object.isFrozen(row)).toBe(true)
    }
  })

  it('maps installation, launch, diagnostics and renderer choices to generic ownership', () => {
    expect(focusedPrioritySettingReplacement('modkit.gameInstallations')).toMatchObject({
      kind: 'portable-setting',
      target: 'SettingsDocument.gameInstallations',
    })
    expect(focusedPrioritySettingReplacement('modkit.launch.mapPath')).toMatchObject({
      kind: 'shared-workflow',
      target: 'modkit.game.launchActiveMap',
    })
    expect(focusedPrioritySettingReplacement('modkit.log.level')).toMatchObject({
      kind: 'shared-workflow',
      target: 'modkit.exportDiagnostics',
    })
    expect(focusedPrioritySettingReplacement('modkit.modelPreview.renderer')).toMatchObject({
      kind: 'automatic-policy',
      target: 'PresentationPlan.viewer-eligibility',
    })
    expect(focusedPrioritySettingReplacement('modkit.not-in-focused-closure')).toBeUndefined()
  })
})
