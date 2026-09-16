/**
 * The machine-translation contract as the host registers it.
 *
 * Without a registered definition the contract exists only as a type: a codec that resolves it
 * across an execution boundary — which is every codec in the editor, the CLI and the browser — is
 * told its arguments do not name a registered surface.
 */
import { describe, expect, it } from 'vitest'
import { TRANSLATION_CONTRACT } from '@modkit/sdk'
import {
  createBundledServiceDefinitionRegistry,
  registerStandardLanguageDefinitions,
  STANDARD_LANGUAGE_OWNER,
  TRANSLATION_CONTRACT_DEFINITION,
  TRANSLATION_MATCHER,
} from '@modkit/host'
import { createStandardSurfaceRegistry } from '@modkit/host/execution'

const offer = { backends: ['google', 'openai'] } as const
const context = { contract: TRANSLATION_CONTRACT, major: 1 } as const

describe('standard machine-translation definition', () => {
  it('routes a named backend and holds a provider to the languages it lists', () => {
    const match = (offerFacet: unknown, requestFacet: unknown) =>
      (
        TRANSLATION_MATCHER.match(
          { ...context, offerFacet, requestFacet } as never,
          undefined,
        ) as { readonly state: string }
      ).state
    expect(match(offer, {})).toBe('match')
    expect(match(offer, undefined)).toBe('match')
    expect(match(offer, { backend: 'openai' })).toBe('match')
    expect(match(offer, { backend: 'gemini' })).toBe('no-match')
    expect(match({ ...offer, languages: ['en', 'ru'] }, { sourceLanguage: 'en', targetLanguage: 'ru' })).toBe('match')
    expect(match({ ...offer, languages: ['en'] }, { sourceLanguage: 'en', targetLanguage: 'ru' })).toBe('no-match')
    // a provider with no language list accepts any pair, which is what a general model does
    expect(match(offer, { sourceLanguage: 'en', targetLanguage: 'ru' })).toBe('match')
    expect(match({ backends: [] }, {})).toBe('invalid')
    expect(match(offer, { backend: 'openai', unexpected: 1 })).toBe('invalid')
  })

  it('is registered with a surface, so a worker-brokered codec can resolve it', async () => {
    const definitions = createBundledServiceDefinitionRegistry()
    await registerStandardLanguageDefinitions(definitions)
    const registered = definitions
      .list()
      .filter(entry => entry.contract === TRANSLATION_CONTRACT && entry.major === 1)
    expect(registered).toHaveLength(1)
    expect(registered[0]?.provenance.ownerExtensionId).toBe(STANDARD_LANGUAGE_OWNER)
    expect(registered[0]?.surface).toBeDefined()

    const surfaces = createStandardSurfaceRegistry({
      definitions: [
        {
          contract: TRANSLATION_CONTRACT,
          major: 1,
          surface: TRANSLATION_CONTRACT_DEFINITION.surface,
        },
      ],
    })
    const surface = surfaces.surfaceFor(TRANSLATION_CONTRACT, 1)
    expect(Object.keys(surface?.methods ?? {}).sort()).toEqual(['backends', 'translate'])
  })
})
