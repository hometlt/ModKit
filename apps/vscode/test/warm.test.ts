import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const previews = vi.hoisted(() => ({ calls: 0 }))
vi.mock('../src/map-preview.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/map-preview.js')>()
  return {
    ...original,
    prepareVsCodeMapPreview: (async (...args) => {
      previews.calls += 1
      return original.prepareVsCodeMapPreview(...args)
    }) as typeof original.prepareVsCodeMapPreview,
  }
})

import type { WebviewChannel } from '../src/bridge.js'
import { createVsCodeSubjectHost } from '../src/host.js'

const commonExtensions = join(import.meta.dirname, '..', '..', '..', 'extensions')
const silentChannel = (): WebviewChannel => ({
  post: () => undefined,
  onMessage: () => () => undefined,
})

describe('warming a codec realm before the page asks', () => {
  it('opens the codec alone, not a map world the page prepares again beside it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'modkit-vscode-warm-'))
    const path = join(directory, 'table.csv')
    writeFileSync(path, 'a,b\n1,2\n')
    const host = await createVsCodeSubjectHost({ catalogCandidates: [commonExtensions] })
    const marks: string[] = []
    const served = host.serve({
      channel: silentChannel(),
      session: 'warm-test',
      roots: () => [directory],
      timing: {
        phase: () => () => undefined,
        step: (_name, work) => work(),
        mark: name => void marks.push(name),
      },
    })
    try {
      served.warm(path)
      await vi.waitFor(() => expect(marks.some(mark => mark.startsWith('warm '))).toBe(true), {
        timeout: 60_000,
      })
      // a map's world is prepared once, by the page's own open (v82: Amphion's took 104 s twice)
      expect(previews.calls).toBe(0)
    } finally {
      await served.close('test over')
    }
  }, 120_000)
})
