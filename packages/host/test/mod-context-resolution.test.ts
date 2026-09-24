/**
 * Which layers of a mod context a host reads through its content sources. The opened package on
 * the host's disk is the host's to serve; one inside a content source (a CASC mod) has no other
 * server, so a document of Liberty sees Liberty's other files — the references to `Marine`.
 */
import { describe, expect, it } from 'vitest'
import {
  HOST_LAYER_SOURCE_ID,
  type ModContext,
  type ModContextLayer,
} from '@modkit/vfs/content-sources'

import { modContextResolution } from '../src/content-dependency-operations.js'

const core: ModContextLayer = {
  id: 'l0',
  displayName: 'Core',
  sourceId: 'local:casc',
  sourcePath: 'Mods/Core.SC2Mod',
  role: 'dependency',
  provenance: 'implicit',
}

function contextOf(primary: ModContextLayer): ModContext {
  return {
    schemaVersion: 1,
    gameId: 'blizzard/starcraft-2',
    contextId: 'ctx',
    layers: [core, primary],
    unresolved: [],
    diagnostics: [],
    files: async () => ({ items: [] }),
    read: async () => new Uint8Array(),
    locate: async () => undefined,
    dispose: async () => undefined,
  }
}

describe('mod context resolution', () => {
  it('keeps an opened package that lives in a content source', () => {
    const resolution = modContextResolution(
      contextOf({
        id: 'l1',
        displayName: 'Liberty',
        sourceId: 'local:casc',
        sourcePath: 'mods/liberty.sc2mod',
        role: 'primary',
        provenance: 'opened',
      }),
    )
    expect(resolution.mounts.map(mount => mount.displayName)).toEqual(['Core', 'Liberty'])
  })

  it('leaves the opened package on the host disk to the host', () => {
    const resolution = modContextResolution(
      contextOf({
        id: 'l1',
        displayName: 'Mine',
        sourceId: HOST_LAYER_SOURCE_ID,
        sourcePath: 'C:/Work/Mine.SC2Mod',
        role: 'primary',
        provenance: 'opened',
      }),
    )
    expect(resolution.mounts.map(mount => mount.displayName)).toEqual(['Core'])
  })
})
