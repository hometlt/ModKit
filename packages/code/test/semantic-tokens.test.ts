/**
 * The semantic-token encoder: how a codec's own tokenizer reaches the editor.
 *
 * A format like GameStrings has no Monaco grammar, so before this the buffer opened as `ini` and
 * rendered in a single colour. Writing a Monarch grammar would have meant a second tokenizer beside
 * the one the provider already runs, and two of them disagree eventually — the visible symptom being
 * text coloured one way in the editor and another in the tree. The provider's own tokens are fed to
 * Monaco instead.
 *
 * The encoding is what is pinned here, because it is the part that fails silently. Every position is
 * relative to the previous token, so one wrong delta shifts every colour after it, and the result
 * looks like a broken tokenizer rather than a broken encoder.
 */
import { describe, expect, it } from 'vitest'
import { encodeSemanticTokens, SEMANTIC_TOKEN_TYPES } from '../src/semantic-tokens.js'
import type { LanguageAnalysis, LanguageToken } from '@modkit/sdk'

function analysis(tokens: readonly LanguageToken[]): LanguageAnalysis {
  return {
    documentUri: 'memory://probe',
    documentVersion: 1,
    tokens,
    diagnostics: [],
    symbols: [],
  }
}

function token(
  line: number,
  from: number,
  to: number,
  kind: LanguageToken['kind'],
): LanguageToken {
  return { range: { start: { line, character: from }, end: { line, character: to } }, kind }
}

describe('semantic token encoding', () => {
  it('encodes the first token absolutely and the rest as deltas', () => {
    const data = encodeSemanticTokens(
      analysis([
        token(0, 0, 2, 'variable'),
        // Same line: the character delta is measured from the previous token's start.
        token(0, 3, 7, 'property'),
        // New line: the line delta is one and the character becomes absolute again.
        token(2, 4, 9, 'comment'),
      ]),
    )
    expect([...data]).toEqual([
      0, 0, 2, SEMANTIC_TOKEN_TYPES.indexOf('variable'), 0,
      0, 3, 4, SEMANTIC_TOKEN_TYPES.indexOf('property'), 0,
      2, 4, 5, SEMANTIC_TOKEN_TYPES.indexOf('comment'), 0,
    ])
  })

  /*
   * Providers are free to return tokens in any order and several do — the strings provider walks
   * keys and values separately. Encoding them unsorted produces negative deltas, which Monaco reads
   * as enormous positive ones and paints far outside the document.
   */
  it('sorts tokens before encoding, because a provider may return them out of order', () => {
    const ordered = encodeSemanticTokens(
      analysis([token(0, 0, 2, 'keyword'), token(1, 0, 3, 'string')]),
    )
    const shuffled = encodeSemanticTokens(
      analysis([token(1, 0, 3, 'string'), token(0, 0, 2, 'keyword')]),
    )
    expect([...shuffled]).toEqual([...ordered])
  })

  /*
   * Monaco's encoding has no way to express a token that spans lines. Clamping one would colour
   * text the codec never claimed, so it is dropped instead.
   */
  it('drops a token that spans lines rather than colouring the wrong text', () => {
    const data = encodeSemanticTokens(
      analysis([
        token(0, 0, 4, 'string'),
        { range: { start: { line: 0, character: 5 }, end: { line: 3, character: 2 } }, kind: 'comment' },
      ]),
    )
    expect(data).toHaveLength(5)
    expect(data[3]).toBe(SEMANTIC_TOKEN_TYPES.indexOf('string'))
  })

  it('drops an empty token, which would be an invisible zero-length colour', () => {
    expect(encodeSemanticTokens(analysis([token(0, 4, 4, 'keyword')]))).toHaveLength(0)
  })

  /*
   * The legend is the wire format: a token names its type by index into this array, agreed once at
   * registration. Reordering it recolours every buffer without changing a line of any codec, so the
   * order is asserted rather than left to chance.
   */
  it('keeps the legend in the order the contract declares its kinds', () => {
    expect([...SEMANTIC_TOKEN_TYPES]).toEqual([
      'comment',
      'function',
      'keyword',
      'number',
      'operator',
      'parameter',
      'property',
      'string',
      'type',
      'variable',
    ])
  })
})
