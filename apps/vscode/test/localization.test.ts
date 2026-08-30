import { describe, expect, it } from 'vitest'
import { parseUiCatalogDocument } from '@modkitx-x3/ui/localization'

import { createVscodeLocalizer, VSCODE_UI_CATALOGS } from '../src/localization.js'

describe('VS Code UI localization', () => {
  it('keeps the English and Russian application catalogs in exact key parity', () => {
    const [english, russian] = VSCODE_UI_CATALOGS
    expect(english?.locale).toBe('en')
    expect(russian?.locale).toBe('ru')
    expect(Object.keys(russian?.messages ?? {}).sort()).toEqual(
      Object.keys(english?.messages ?? {}).sort(),
    )
  })

  it('keeps interpolation placeholders in English and Russian messages aligned', () => {
    const [english, russian] = VSCODE_UI_CATALOGS
    const placeholders = (message: string): readonly string[] =>
      [...message.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu)].map(match => match[1] as string).sort()
    for (const [key, message] of Object.entries(english?.messages ?? {})) {
      expect(placeholders(russian?.messages[key] ?? ''), key).toEqual(placeholders(message))
    }
  })

  it('falls back by BCP-47 language and retains the core catalog underneath', () => {
    const russian = createVscodeLocalizer('ru-RU')
    expect(russian.locale).toBe('ru')
    expect(russian.text('vscode.runtime.action.pause')).toBe('Пауза')
    expect(russian.text('extensions.group.available')).toBe('Доступные')
    expect(createVscodeLocalizer('de-DE').text('stage.model')).toBe('Model')
  })

  it('interpolates dynamic text without treating it as a translation key', () => {
    expect(
      createVscodeLocalizer('ru').text('vscode.game.launched', {
        game: 'StarCraft II',
        map: 'mission.SC2Map',
      }),
    ).toBe('StarCraft II запущена с картой mission.SC2Map.')
  })

  it('accepts a data-only third-language catalog without changing the VS Code adapter', () => {
    const english = VSCODE_UI_CATALOGS[0]
    if (english === undefined) throw new Error('missing English VS Code catalog')
    const french = parseUiCatalogDocument(
      {
        schema: 'org.modkitx/ui-message-catalog@1',
        locale: 'fr',
        namespace: 'org.example/vscode-language-pack',
        messages: {
          'vscode.runtime.action.pause': 'Pause du runtime',
        },
      },
      {
        authorizedMessagePrefixes: ['vscode.'],
        fallbackCatalog: english.messages,
      },
    )
    const localizer = createVscodeLocalizer('fr-FR', [french])
    expect(localizer.locale).toBe('fr')
    expect(localizer.text('vscode.runtime.action.pause')).toBe('Pause du runtime')
    expect(localizer.text('vscode.runtime.action.continue')).toBe('Continue to tick or limit')
  })
})
