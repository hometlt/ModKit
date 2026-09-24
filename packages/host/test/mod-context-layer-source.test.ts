import { describe, expect, it } from 'vitest'
import type { AssetNamespace, ArtifactSource } from '@modkit/sdk'
import type { ModContext } from '@modkit/vfs/content-sources'

import { openModContextLayerSource } from '../src/mod-context-layer-source.js'

const FILES: Readonly<Record<string, string>> = {
  'ComponentList.SC2Components': '<Components/>',
  'Base.SC2Data/GameData/UnitData.xml': '<Catalog><CUnit id="Marine"/></Catalog>',
  'Base.SC2Data/GameData/AbilData.xml': '<Catalog/>',
  'enUS.SC2Data/LocalizedData/GameStrings.txt': 'Unit/Name/Marine=Marine',
}

function context(): ModContext {
  const paths = Object.keys(FILES)
  return {
    schemaVersion: 1,
    gameId: 'test',
    contextId: 'ctx',
    layers: [
      {
        id: 'liberty',
        displayName: 'Liberty',
        sourceId: 'casc',
        sourcePath: 'Mods/Liberty.SC2Mod',
        role: 'dependency',
        provenance: 'implicit',
      },
    ],
    unresolved: [],
    diagnostics: [],
    // Two items a page: the source must follow the cursor to the end.
    async files(_layerId, page) {
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      const items = paths.slice(start, start + 2)
      return start + 2 < paths.length ? { items, nextCursor: String(start + 2) } : { items }
    },
    async read(_layerId, path) {
      const text = FILES[path]
      if (text === undefined) throw new Error(`not listed: ${path}`)
      return new TextEncoder().encode(text)
    },
    async locate() {
      return undefined
    },
    async dispose() {},
  }
}

async function names(namespace: AssetNamespace, prefix = ''): Promise<string[]> {
  const found: string[] = []
  for await (const entry of namespace.list(prefix)) found.push(`${entry.kind}:${entry.path}`)
  return found
}

async function text(source: ArtifactSource): Promise<string> {
  if (source.kind !== 'bytes') throw new Error('expected a file')
  const chunks: Uint8Array[] = []
  for await (const chunk of source.stream()) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

describe('a mod context layer as a namespace subject', () => {
  it('lists folders and files from the loader listing and reads through the loader', async () => {
    const source = await openModContextLayerSource({
      context: context(),
      layerId: 'liberty',
      ref: {
        id: 'modkit-source://battlenet/casc/mods/liberty.sc2mod',
        uri: 'modkit-source://battlenet/casc/mods/liberty.sc2mod',
      },
    })
    const namespace = (await source.openNamespace()).value
    expect(await names(namespace)).toEqual([
      'file:ComponentList.SC2Components',
      'directory:Base.SC2Data',
      'directory:enUS.SC2Data',
    ])
    expect(await names(namespace, 'Base.SC2Data/GameData')).toEqual([
      'file:Base.SC2Data/GameData/UnitData.xml',
      'file:Base.SC2Data/GameData/AbilData.xml',
    ])
    const unit = (await namespace.open('Base.SC2Data/GameData/UnitData.xml')).value
    expect(unit.ref.uri).toBe(
      'modkit-source://battlenet/casc/mods/liberty.sc2mod?vfs-path=Base.SC2Data%2FGameData%2FUnitData.xml',
    )
    expect(await text(unit)).toContain('Marine')
    // Readers size their buffers from the source; SC2's refuses an unsized file.
    expect(unit.kind === 'bytes' && unit.size).toBe(BigInt(FILES['Base.SC2Data/GameData/UnitData.xml']!.length))

    // A folder opens as a namespace whose listing is relative to it.
    const data = (await namespace.open('Base.SC2Data')).value
    if (data.kind !== 'namespace') throw new Error('expected a folder')
    expect(await names((await data.openNamespace()).value, 'GameData')).toEqual([
      'file:GameData/UnitData.xml',
      'file:GameData/AbilData.xml',
    ])
    await expect(namespace.open('Base.SC2Data/Missing.xml')).rejects.toThrow(/lists no/u)
  })
})
