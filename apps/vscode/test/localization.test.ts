import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseUiCatalogDocument } from '@modkit/ui/localization'

import {
  createVscodeLocalizer,
  createVscodeLocalizerFromCatalogLoader,
  VSCODE_UI_CATALOGS,
} from '../src/localization.js'

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

  it('loads a third language through the Extension Manager/VFS boundary', async () => {
    const english = VSCODE_UI_CATALOGS[0]
    if (english === undefined) throw new Error('missing English VS Code catalog')
    const french = parseUiCatalogDocument(
      {
        schema: 'modkit/ui-message-catalog@1',
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
    const loadCatalogs = vi.fn(async () => ({ catalogs: [french] }))
    const localizer = await createVscodeLocalizerFromCatalogLoader('fr-FR', loadCatalogs)
    expect(loadCatalogs).toHaveBeenCalledOnce()
    expect(localizer.locale).toBe('fr')
    expect(localizer.text('vscode.runtime.action.pause')).toBe('Pause du runtime')
    expect(localizer.text('vscode.runtime.action.continue')).toBe('Continue to tick or limit')
  })

  it('loads catalogs in the extension host and forwards them into the webview snapshot', () => {
    const extension = readFileSync(resolve(import.meta.dirname, '../src/extension.ts'), 'utf8')
    const webview = readFileSync(resolve(import.meta.dirname, '../src/webview.ts'), 'utf8')
    expect(extension).toContain('loadLocalizationCatalogs(host.services.host.inventory')
    expect(extension).toContain('localizationCatalogs,')
    expect(webview).toContain('snapshot.localizationCatalogs')
  })
})
