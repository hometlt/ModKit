/** Read-only extraction selection and deterministic text/hex entry previews. */
import { describe, expect, it } from 'vitest'

import { findArchiveExtractOperation, hexDump, previewText } from '../src/archive-entry.js'

describe('the VS Code archive entry pane', () => {
  it('selects only an available non-mutating extraction operation', () => {
    const selected = findArchiveExtractOperation([
      {
        id: 'codec.extract-entry',
        handlerId: 'mutating-lookalike',
        mutatesSource: true,
        state: 'available',
      },
      { id: 'codec.extract-entry', handlerId: 'disabled', mutatesSource: false, state: 'disabled' },
      {
        id: 'zip.extract-entry',
        handlerId: 'extract-entry',
        mutatesSource: false,
        state: 'available',
      },
    ])
    expect(selected?.handlerId).toBe('extract-entry')
  })

  it('shows valid UTF-8 as text and binary bytes as a bounded hex dump', () => {
    expect(previewText(new TextEncoder().encode('entry text'))).toBe('entry text')
    const binary = Uint8Array.of(0, 1, 0x41, 0xff)
    expect(previewText(binary)).toBeUndefined()
    expect(hexDump(binary)).toContain('00 01 41 ff')
    expect(hexDump(binary)).toContain('..A.')
  })
})
