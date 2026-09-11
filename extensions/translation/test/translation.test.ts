/**
 * The translation provider: the transports MK2 carried, separated from the format they served.
 *
 * What is tested is the boundary, because the transports themselves are MK2's and unchanged. Three
 * things a caller depends on: that a backend it cannot run is refused before the request rather than
 * after, that a credential never has to travel through an operation input, and that "the service
 * returned the text unchanged" is reported rather than left to be inferred.
 */
import { describe, expect, it } from 'vitest'
import { createProvider } from '../src/provider.js'
import { BACKENDS, isChatBackend } from '../src/backends.js'

const CONTRACT = 'common.language/translation'
const selection = { contract: CONTRACT, major: 1 } as const

/** A Google endpoint that upper-cases whatever it is asked to translate. */
function shouting(): typeof fetch {
  return (async (url: unknown) => {
    const query = new URL(String(url)).searchParams.get('q') ?? ''
    return { ok: true, async json() { return [[[query.toUpperCase(), query]]] } }
  }) as unknown as typeof fetch
}

/** An endpoint that returns the request unchanged, the way a service with nothing to do does. */
function echo(): typeof fetch {
  return (async (url: unknown) => {
    const query = new URL(String(url)).searchParams.get('q') ?? ''
    return { ok: true, async json() { return [[[query, query]]] } }
  }) as unknown as typeof fetch
}

function provider(context: Record<string, unknown> = {}) {
  return createProvider(selection, { fetchImpl: shouting(), ...context }).value as {
    backends(): Promise<readonly { id: string; available: boolean }[]>
    translate(request: Record<string, unknown>): Promise<{
      text: string
      changed: boolean
      backend: string
    }>
  }
}

describe('translation provider', () => {
  it('refuses a selection that is not its contract', () => {
    expect(() => createProvider({ contract: 'common.view/tree-data-source', major: 1 } as never)).toThrow(
      /Unsupported translation selection/u,
    )
  })

  /*
   * Google's keyless endpoint is why MK2's feature worked with no configuration at all, and why this
   * one backend reports available without credentials. Every other one is a setting to fix, and a
   * reader should learn that before clicking rather than from a failure afterwards.
   */
  it('reports which backends can actually run', async () => {
    const withoutKeys = await provider().backends()
    expect(withoutKeys.find(item => item.id === 'google')?.available).toBe(true)
    expect(withoutKeys.find(item => item.id === 'anthropic')?.available).toBe(false)

    const withKey = await provider({ credentials: { anthropic: { apiKey: 'k', model: 'm' } } }).backends()
    expect(withKey.find(item => item.id === 'anthropic')?.available).toBe(true)
  })

  it('translates through the default backend', async () => {
    const result = await provider().translate({
      text: 'Trained at the barracks',
      sourceLanguage: 'en',
      targetLanguage: 'ru',
    })
    expect(result.text).toBe('TRAINED AT THE BARRACKS')
    expect(result.changed).toBe(true)
    expect(result.backend).toBe('google')
  })

  it('reports an unchanged result rather than leaving it to be inferred', async () => {
    const result = await provider({ fetchImpl: echo() }).translate({
      text: 'Marine',
      sourceLanguage: 'en',
      targetLanguage: 'ru',
    })
    expect(result.text).toBe('Marine')
    expect(result.changed).toBe(false)
  })

  it('refuses a backend with no credentials before it sends anything', async () => {
    await expect(
      provider().translate({
        text: 'Marine',
        sourceLanguage: 'en',
        targetLanguage: 'ru',
        backend: 'anthropic',
      }),
    ).rejects.toThrow(/no credentials configured/u)
  })

  it('refuses a request that names no languages, and an unknown backend', async () => {
    await expect(provider().translate({ text: 'Marine' })).rejects.toThrow(
      /sourceLanguage and targetLanguage/u,
    )
    await expect(
      provider().translate({
        text: 'Marine',
        sourceLanguage: 'en',
        targetLanguage: 'ru',
        backend: 'deepl',
      }),
    ).rejects.toThrow(/unknown translation backend/u)
  })

  /*
   * A caller masks its own markup and hands over placeholders. The provider passes them through
   * untouched — it has no idea what they mean, which is exactly why it can serve any format.
   */
  it('carries placeholders through without interpreting them', async () => {
    const result = await provider().translate({
      text: 'Trained at the [[MK0]] for [[MK1]] minerals',
      sourceLanguage: 'en',
      targetLanguage: 'ru',
    })
    expect(result.text).toContain('[[MK0]]')
    expect(result.text).toContain('[[MK1]]')
  })

  it('knows which backends are chat models, because their answers need unwrapping', () => {
    expect(isChatBackend('google')).toBe(false)
    expect(isChatBackend('anthropic')).toBe(true)
    expect(BACKENDS.map(item => item.id)).toContain('openai-compatible')
  })
})
