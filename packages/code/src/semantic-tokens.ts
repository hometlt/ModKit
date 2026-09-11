/**
 * The contract's tokens, encoded the way an editor wants them.
 *
 * A codec that knows its own grammar publishes tokens through `analyze()`, and three surfaces want
 * them: the tree, the table and the code editor. This module is the third one's translation, and it
 * is deliberately free of any editor import — the encoding is a fact about the contract, not about
 * Monaco, and keeping it separate is what lets it be tested without a browser.
 */
import type { LanguageAnalysis, LanguageTokenKind } from '@modkit/sdk'

/**
 * The token kinds the contract has, in the order Monaco is told about them.
 *
 * Semantic tokens are sent as numbers: a token names its type by index into the legend, and the
 * legend is agreed once when the provider is registered. So this array is the wire format, and its
 * order matters — reordering it recolours every buffer without changing a line of a codec.
 */
export const SEMANTIC_TOKEN_TYPES: readonly LanguageTokenKind[] = Object.freeze([
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

const SEMANTIC_TOKEN_INDEX: ReadonlyMap<string, number> = new Map(
  SEMANTIC_TOKEN_TYPES.map((kind, index) => [kind, index]),
)

/**
 * Encode one analysis as Monaco's semantic-token array.
 *
 * The format is five numbers per token and every position is *relative*: line delta from the
 * previous token, character delta within the same line (absolute when the line changed), length,
 * type index, modifier bits. Getting the relative part wrong shifts every colour after the first
 * mistake, which looks like a broken tokenizer rather than a broken encoder — so the tokens are
 * sorted first, because a provider is free to return them in any order and several do.
 *
 * A token that spans lines is dropped rather than clamped: Monaco's encoding cannot express one,
 * and a clamped token would colour the wrong text.
 */
export function encodeSemanticTokens(analysis: LanguageAnalysis): Uint32Array {
  const usable = analysis.tokens
    .filter(token => token.range.start.line === token.range.end.line)
    .filter(token => token.range.end.character > token.range.start.character)
    .sort((left, right) =>
      left.range.start.line === right.range.start.line
        ? left.range.start.character - right.range.start.character
        : left.range.start.line - right.range.start.line,
    )
  const data = new Uint32Array(usable.length * 5)
  let previousLine = 0
  let previousCharacter = 0
  let cursor = 0
  for (const token of usable) {
    const line = token.range.start.line
    const character = token.range.start.character
    data[cursor] = line - previousLine
    data[cursor + 1] = line === previousLine ? character - previousCharacter : character
    data[cursor + 2] = token.range.end.character - character
    data[cursor + 3] = SEMANTIC_TOKEN_INDEX.get(token.kind) ?? 0
    data[cursor + 4] = 0
    previousLine = line
    previousCharacter = character
    cursor += 5
  }
  return data
}
