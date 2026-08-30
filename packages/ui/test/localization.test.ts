import { describe, expect, it } from 'vitest'

import {
  contributionContractLabel,
  createUiLocalizer,
  parseUiCatalogDocument,
  resolveUiLocale,
  UI_CATALOG_MAXIMUM_DECODED_CODE_UNITS,
  UI_CATALOG_MAXIMUM_KEY_LENGTH,
  UI_CATALOG_MAXIMUM_MESSAGE_LENGTH,
  UI_CATALOG_RECOMMENDED_MAXIMUM_JSON_BYTES,
  UI_CATALOG_SCHEMA,
  UI_MESSAGES,
} from '../src/localization/index.js'
import * as fallbackCatalogs from '../src/localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../src/localization/fallback.js'

describe('UI localization', () => {
  it('resolves BCP-47 preferences deterministically and falls back to English', () => {
    expect(resolveUiLocale(['uk-UA', 'ru-RU', 'en-US'])).toBe('ru')
    expect(resolveUiLocale('en-GB')).toBe('en')
    expect(resolveUiLocale(['de-DE'])).toBe('en')
    expect(resolveUiLocale('auto', { systemLocales: ['ru-RU'] })).toBe('ru')
    expect(
      resolveUiLocale(['pt-BR', 'en'], {
        availableLocales: ['en', 'pt-BR'],
      }),
    ).toBe('pt-BR')
  })

  it('ships complete English and Russian catalogs over one typed key set', () => {
    expect(Object.keys(UI_MESSAGES.ru).sort()).toEqual(Object.keys(UI_MESSAGES.en).sort())
    expect(createUiLocalizer('ru').text('action.openFile')).toBe('Открыть файл…')
  })

  it('keeps every surface fallback aligned with the aggregate English catalog', () => {
    for (const catalog of Object.values(fallbackCatalogs)) {
      for (const [key, message] of Object.entries(catalog)) {
        expect(message, key).toBe(UI_MESSAGES.en[key])
      }
    }
  })

  it('layers a small English surface fallback underneath host translations', () => {
    const partialRussian = createUiLocalizer('ru', {
      'viewer.image': 'Изображение из приложения',
    })
    const localizer = withEnglishUiFallback(partialRussian, {
      'viewer.image': 'Image viewer',
      'example.surfaceOnly': 'Surface value {count}',
    })
    expect(localizer.text('viewer.image')).toBe('Изображение из приложения')
    expect(localizer.text('example.surfaceOnly', { count: 3 })).toBe('Surface value 3')
  })

  it('keeps interpolation placeholders identical in every built-in catalog', () => {
    const placeholders = (message: string): string[] =>
      [...message.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu)].map(match => match[1] as string).sort()
    for (const [key, english] of Object.entries(UI_MESSAGES.en)) {
      expect(placeholders(UI_MESSAGES.ru[key] as string), key).toEqual(placeholders(english))
    }
  })

  it('substitutes named values without interpreting message text as markup', () => {
    expect(
      createUiLocalizer('ru').text('status.ready', { extensions: 42, notices: '<script>' }),
    ).toBe('Готово · расширений: 42 · сообщений запуска: <script>')
  })

  it('allows a host-owned catalog override without changing another host', () => {
    const custom = createUiLocalizer('en', { 'activity.files': 'Assets' })
    expect(custom.text('activity.files')).toBe('Assets')
    expect(createUiLocalizer('en').text('activity.files')).toBe('Files')
  })

  it('loads a validated data-only catalog with regional and English fallback', () => {
    const catalog = parseUiCatalogDocument(
      JSON.parse(`{
        "schema": "${UI_CATALOG_SCHEMA}",
        "locale": "de",
        "namespace": "org.example/example-ui",
        "messages": {
          "activity.files": "Dateien",
          "example.greeting": "Hallo {name}"
        }
      }`),
      { authorizedMessagePrefixes: ['activity.', 'example.'] },
    )
    const localizer = createUiLocalizer('de-DE', { catalogs: [catalog] })
    expect(localizer.text('activity.files')).toBe('Dateien')
    expect(localizer.text('example.greeting', { name: 'Ada' })).toBe('Hallo Ada')
    expect(localizer.text('activity.settings')).toBe('Settings')
  })

  it('rejects executable accessors and non-namespaced message keys', () => {
    const messages = Object.defineProperty({}, 'example.title', {
      enumerable: true,
      get() {
        throw new Error('must not execute')
      },
    })
    expect(() =>
      parseUiCatalogDocument({
        schema: UI_CATALOG_SCHEMA,
        locale: 'en',
        namespace: 'org.example/example-ui',
        messages,
      }),
    ).toThrow(/data property/u)
    expect(() =>
      parseUiCatalogDocument({
        schema: UI_CATALOG_SCHEMA,
        locale: 'en',
        namespace: 'org.example/example-ui',
        messages: { title: 'Missing namespace' },
      }),
    ).toThrow(/namespaced/u)
  })

  it('restricts catalogs to their namespace-owned prefix unless the host grants another prefix', () => {
    const document = {
      schema: UI_CATALOG_SCHEMA,
      locale: 'ru',
      namespace: 'org.example/example-ui',
      messages: { 'activity.files': 'Файлы пакета' },
    }
    expect(() => parseUiCatalogDocument(document)).toThrow(/not authorised/u)
    expect(
      parseUiCatalogDocument(document, { authorizedMessagePrefixes: ['activity.'] }).messages[
        'activity.files'
      ],
    ).toBe('Файлы пакета')
    expect(
      parseUiCatalogDocument({
        ...document,
        messages: { 'example.title': 'Пакет' },
      }).messages['example.title'],
    ).toBe('Пакет')
  })

  it('rejects core overrides that change interpolation placeholder names', () => {
    expect(() =>
      parseUiCatalogDocument(
        {
          schema: UI_CATALOG_SCHEMA,
          locale: 'ru',
          namespace: 'org.example/example-ui',
          messages: { 'status.ready': 'Готово: {extensions}' },
        },
        { authorizedMessagePrefixes: ['status.'] },
      ),
    ).toThrow(/changes interpolation placeholders/u)
  })

  it('rejects OOM-shaped decoded catalogs and overlong keys before copying them', () => {
    expect(UI_CATALOG_RECOMMENDED_MAXIMUM_JSON_BYTES).toBeGreaterThan(
      UI_CATALOG_MAXIMUM_DECODED_CODE_UNITS,
    )
    const sharedMaximumMessage = 'x'.repeat(UI_CATALOG_MAXIMUM_MESSAGE_LENGTH)
    const count =
      Math.floor(UI_CATALOG_MAXIMUM_DECODED_CODE_UNITS / sharedMaximumMessage.length) + 1
    const messages = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`example.large.${index}`, sharedMaximumMessage]),
    )
    expect(() =>
      parseUiCatalogDocument({
        schema: UI_CATALOG_SCHEMA,
        locale: 'en',
        namespace: 'org.example/example-ui',
        messages,
      }),
    ).toThrow(/size budget/u)

    const longKey = `example.${'k'.repeat(UI_CATALOG_MAXIMUM_KEY_LENGTH)}`
    expect(() =>
      parseUiCatalogDocument({
        schema: UI_CATALOG_SCHEMA,
        locale: 'en',
        namespace: 'org.example/example-ui',
        messages: { [longKey]: 'value' },
      }),
    ).toThrow(/key is too long/u)
  })

  it('uses readable contract labels while preserving unknown kinds', () => {
    const en = createUiLocalizer('en')
    const ru = createUiLocalizer('ru')
    expect(contributionContractLabel(en, 'org.modkitx/codec-contribution@2')).toBe(
      'Codec Contributions',
    )
    expect(contributionContractLabel(ru, 'org.modkitx/editor-contribution@1')).toBe('Редакторы')
    expect(contributionContractLabel(ru, 'org.modkitx/service-provider-contribution@1')).toBe(
      'Сервисы',
    )
    expect(contributionContractLabel(ru, 'org.modkitx/viewer-contribution@1')).toBe(
      'Средства просмотра',
    )
    expect(contributionContractLabel(en, 'org.example/terrain-tool-contribution@1')).toBe(
      'Terrain Tool Contributions',
    )
  })
})
