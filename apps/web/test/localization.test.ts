import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseUiCatalogDocument } from '@modkitx-x3/ui/localization'

import { createWebLocalizer, WEB_UI_CATALOGS } from '../src/localization.js'

describe('Web UI localization', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the English and Russian application catalogs in exact key parity', () => {
    const [english, russian] = WEB_UI_CATALOGS
    expect(english?.locale).toBe('en')
    expect(russian?.locale).toBe('ru')
    expect(Object.keys(russian?.messages ?? {}).sort()).toEqual(
      Object.keys(english?.messages ?? {}).sort(),
    )
  })

  it('keeps interpolation placeholders in English and Russian messages aligned', () => {
    const [english, russian] = WEB_UI_CATALOGS
    const placeholders = (message: string): readonly string[] =>
      [...message.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu)].map(match => match[1] as string).sort()
    for (const [key, message] of Object.entries(english?.messages ?? {})) {
      expect(placeholders(russian?.messages[key] ?? ''), key).toEqual(placeholders(message))
    }
  })

  it('falls back by BCP-47 language and retains the shared catalog underneath', () => {
    const russian = createWebLocalizer('ru-RU')
    expect(russian.locale).toBe('ru')
    expect(russian.text('web.embed.view')).toBe('Режим просмотра')
    expect(russian.text('extensions.group.available')).toBe('Доступные')
    expect(createWebLocalizer('de-DE').text('app.title')).toBe('Modkit MK3')
  })

  it('resolves auto through browser language preferences', () => {
    vi.stubGlobal('navigator', { languages: ['ru-RU', 'en-US'] })
    expect(createWebLocalizer('auto').locale).toBe('ru')
  })

  it('interpolates user data without treating it as a translation key', () => {
    expect(
      createWebLocalizer('ru').text('web.status.noCodec', {
        name: 'mission.SC2Map',
        reason: 'unknown-format',
      }),
    ).toBe('mission.SC2Map — кодек не найден (unknown-format); показаны исходные байты.')
  })

  it('accepts a data-only third-language catalog without changing the Web UI model', () => {
    const english = WEB_UI_CATALOGS[0]
    if (english === undefined) throw new Error('missing English Web catalog')
    const french = parseUiCatalogDocument(
      {
        schema: 'org.modkitx/ui-message-catalog@1',
        locale: 'fr',
        namespace: 'org.example/web-language-pack',
        messages: {
          'web.extensions.cardFailed': 'Impossible d’ouvrir la fiche d’extension : {reason}',
        },
      },
      {
        authorizedMessagePrefixes: ['web.'],
        fallbackCatalog: english.messages,
      },
    )
    const localizer = createWebLocalizer('fr-FR', [french])
    expect(localizer.locale).toBe('fr')
    expect(localizer.text('web.extensions.cardFailed', { reason: 'fixture' })).toBe(
      'Impossible d’ouvrir la fiche d’extension : fixture',
    )
    expect(localizer.text('web.extensions.trusted')).toBe('Trusted')
  })
})
