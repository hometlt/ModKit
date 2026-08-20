/** The committed subject is closed before its replacement revision is opened. */
import { describe, expect, it } from 'vitest'

import { reopenCommittedEntry } from '../src/edit-reopen.js'

const ENTRY = { id: '/workspace/a.png', name: 'a.png', directory: false }

describe('the VS Code committed-tab reopen', () => {
  it('uses close(entryId) and then opens the same explorer entry', async () => {
    const calls: string[] = []
    const reopened = await reopenCommittedEntry(
      {
        async close(entryId) {
          calls.push(`close:${entryId}`)
          return true
        },
        async open(entry) {
          calls.push(`open:${entry.id}`)
        },
      },
      ENTRY,
    )
    expect(reopened).toBe(true)
    expect(calls).toEqual(['close:/workspace/a.png', 'open:/workspace/a.png'])
  })

  it('does not open a replacement when close was cancelled', async () => {
    let opened = false
    expect(
      await reopenCommittedEntry(
        {
          close: async () => false,
          open: async () => {
            opened = true
          },
        },
        ENTRY,
      ),
    ).toBe(false)
    expect(opened).toBe(false)
  })
})
