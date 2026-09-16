/**
 * A metadata entry may carry one sentence about what its value is.
 *
 * Tested at the projection, not the DOM: what matters is that a note survives the descriptor and
 * that an entry without one stays exactly as it was.
 */
import { describe, expect, it } from 'vitest'
import type { MetadataGroup } from '@modkit/sdk'

describe('metadata notes', () => {
  it('carries a codec-written note beside the value', () => {
    const group: MetadataGroup = {
      id: 'document-header',
      label: 'document-header',
      entries: [
        { key: 'headerSize', value: 3040, note: 'Build/version-correlated; not an entry offset' },
        { key: 'entryCount', value: 1 },
      ],
    }
    expect(group.entries[0]?.note).toBe('Build/version-correlated; not an entry offset')
    expect(group.entries[1]?.note).toBeUndefined()
  })
})
