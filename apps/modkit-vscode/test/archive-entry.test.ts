/** Read-only extraction selection and deterministic text/hex entry previews. */
import { describe, expect, it } from 'vitest'

import { findArchiveExtractOperation, hexDump, previewText } from '../src/archive-entry.js'

describe('the VS Code archive entry pane', () => {
  it('selects only an available non-mutating extraction operation', () => {
    const selected = findArchiveExtractOperation([
      {
        id: 'container.extract',
        handlerId: 'mutating-lookalike',
        mutatesSource: true,
        state: 'available',
      },
      { id: 'container.extract', handlerId: 'disabled', mutatesSource: false, state: 'disabled' },
      {
        id: 'container.extract',
        handlerId: 'extract-entry',
        mutatesSource: false,
        state: 'available',
      },
    ])
    expect(selected?.handlerId).toBe('extract-entry')
  })

  it('rejects a codec-local operation that merely resembles the standard contract', () => {
    expect(
      findArchiveExtractOperation([
        {
          id: 'org.example/archive.extract-entry',
          handlerId: 'local-lookalike',
          mutatesSource: false,
          state: 'available',
        },
      ]),
    ).toBeUndefined()
  })

  it('shows valid UTF-8 as text and binary bytes as a bounded hex dump', () => {
    expect(previewText(new TextEncoder().encode('entry text'))).toBe('entry text')
    const binary = Uint8Array.of(0, 1, 0x41, 0xff)
    expect(previewText(binary)).toBeUndefined()
    expect(hexDump(binary)).toContain('00 01 41 ff')
    expect(hexDump(binary)).toContain('..A.')
  })
})
