import { canonicalJsonStringify } from '@modkit/core'
import { describe, expect, it } from 'vitest'
import { languageWorkspaceContextToken } from '../src/language/context.js'

// The original arithmetic is an independent oracle for the persisted v1 identities.
function originalToken(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalJsonStringify(value))
  const hash = (seed: bigint, reverse: boolean): string => {
    let result = seed
    for (let index = 0; index < bytes.length; index += 1) {
      result ^= BigInt(bytes[reverse ? bytes.length - index - 1 : index] as number)
      result = BigInt.asUintN(64, result * 0x100000001b3n)
    }
    return result.toString(16).padStart(16, '0')
  }
  return `language-context-v1:${hash(0xcbf29ce484222325n, false)}${hash(0x84222325cbf29ce4n, true)}`
}

describe('language context token compatibility', () => {
  it.each([
    null,
    true,
    false,
    0,
    -1,
    4294967295,
    '',
    '\u0000\u007f\u00ff',
    'Русский 日本語 😀 \ud800 \udfff',
    { z: ['Marine', 1], a: { value: 60 } },
    Array.from({ length: 2048 }, (_, i) => String.fromCharCode((i * 31) % 65536)),
  ])('preserves the v1 forward and reverse FNV digest for %j', value => {
    expect(languageWorkspaceContextToken(value)).toBe(originalToken(value))
  })

  it('keeps identities sensitive to document content, locale and dependency revision', () => {
    const context = { text: '<Catalog/>', locale: 'enUS', revision: 'Liberty:1' }
    const token = languageWorkspaceContextToken(context)
    for (const change of [
      { text: '<Catalog><CUnit/></Catalog>' },
      { locale: 'ruRU' },
      { revision: 'Liberty:2' },
    ]) {
      expect(languageWorkspaceContextToken({ ...context, ...change })).not.toBe(token)
    }
    expect(
      languageWorkspaceContextToken({ revision: 'Liberty:1', locale: 'enUS', text: '<Catalog/>' }),
    ).toBe(token)
  })
})
