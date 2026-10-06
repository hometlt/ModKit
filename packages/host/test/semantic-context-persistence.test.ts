import { describe, expect, it } from 'vitest'
import type { LanguageDocument, LanguageWorkspaceDocumentOrigin } from '@modkit/sdk/language'
import {
  persistentRootsInclude,
  prepareResolvedDataSemanticContext,
  semanticInputLayers,
  validatedLanguageSemanticContextRequirements,
} from '../src/language/semantic-context.js'

const [requirement] = validatedLanguageSemanticContextRequirements([
  { kind: 'resolved-data-snapshot', gameId: 'blizzard/starcraft-2', languageIds: ['sc2-data'] },
])
if (requirement?.kind !== 'resolved-data-snapshot') throw new Error('expected a Data requirement')

const closure = semanticInputLayers([
  {
    kind: 'dependency-closure',
    id: 'blizzard/starcraft-2:ctx',
    revision: 'r1',
    payload: {
      schemaVersion: 1,
      layers: [
        { layerId: 'ctx:0:core', sourceId: 'local:casc', sourcePath: 'Mods/Core.SC2Mod' },
        { layerId: 'ctx:1:liberty', sourceId: 'local:casc', sourcePath: 'Mods/Liberty.SC2Mod' },
        { sourcePath: 'a layer without an id is skipped' },
      ],
    },
  },
])

interface Placed {
  readonly uri: string
  readonly layerId: string
  readonly logicalId: string
  readonly precedence: number
  readonly text: string
}

/** One Core, one Liberty and one folder-mod document, as an editor or a source names them. */
const chain = (
  edit: Partial<Record<'core' | 'liberty' | 'mod', Partial<Placed>>> = {},
  editor: { readonly version?: number; readonly scheme?: string; readonly overlay?: boolean } = {},
): { documents: LanguageDocument[]; origins: Map<string, LanguageWorkspaceDocumentOrigin> } => {
  const scheme = editor.scheme ?? 'content-source://local%3Acasc'
  const placed: Placed[] = [
    {
      uri: `${scheme}/Mods/Core.SC2Mod/base.sc2data/gamedata/unitdata.xml`,
      layerId: 'ctx:0:core',
      logicalId: 'base.sc2data/gamedata/unitdata.xml',
      precedence: 0,
      text: '<Catalog><CUnit id="Core"/></Catalog>',
      ...edit.core,
    },
    {
      uri: `${scheme}/Mods/Liberty.SC2Mod/base.sc2data/gamedata/unitdata.xml`,
      layerId: 'ctx:1:liberty',
      logicalId: 'base.sc2data/gamedata/unitdata.xml',
      precedence: 1,
      text: '<Catalog><CUnit id="Marine"/></Catalog>',
      ...edit.liberty,
    },
    {
      uri: 'file:///C:/Mods/My.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
      layerId: 'mod:subject',
      logicalId: 'Base.SC2Data/GameData/UnitData.xml',
      precedence: 2,
      text: '<Catalog><CUnit id="MyMarine" parent="Marine"/></Catalog>',
      ...edit.mod,
    },
  ]
  return {
    documents: placed.map(item => ({
      uri: item.uri,
      languageId: 'sc2-data',
      version: editor.version ?? 1,
      text: item.text,
    })),
    origins: new Map(
      placed.map(item => [
        item.uri,
        {
          uri: item.uri,
          layerId: item.layerId,
          logicalId: item.logicalId,
          precedence: item.precedence,
          sourceRevision: `revision-${String(editor.version ?? 1)}`,
          readOnly: editor.overlay !== true,
          ...(editor.overlay === true ? { overlay: true } : {}),
        },
      ]),
    ),
  }
}

const prepare = (
  documents: ReturnType<typeof chain>,
  options: { readonly locales?: readonly string[]; readonly complete?: boolean } = {},
) =>
  prepareResolvedDataSemanticContext({
    requirement,
    documents: documents.documents,
    origins: documents.origins,
    complete: options.complete ?? true,
    locales: options.locales ?? ['enUS'],
    layers: closure,
  })

describe('a resolved Data context key', () => {
  it('names what the provider analyses, not editor uris, versions or overlays', () => {
    const read = prepare(chain())
    const opened = prepare(chain({}, { version: 7, scheme: 'modkit-source://casc', overlay: true }))
    expect(opened.key).toBe(read.key)
    // the stale-while-editing scope still follows the editor's documents
    expect(opened.scopeKey).not.toBe(read.scopeKey)
    expect(opened.documents).toEqual(read.documents)
  })

  it('changes with any analysed text, logical path or layer', () => {
    const base = prepare(chain()).key
    expect(prepare(chain({ mod: { text: '<Catalog/>' } })).key).not.toBe(base)
    expect(prepare(chain({ mod: { logicalId: 'Base.SC2Data/GameData/Other.xml' } })).key).not.toBe(
      base,
    )
    expect(prepare(chain({ liberty: { layerId: 'ctx:1:swarm' } })).key).not.toBe(base)
    expect(prepare(chain(), { locales: ['ruRU'] }).key).not.toBe(base)
  })
})

describe('the persistence of a resolved Data context', () => {
  it('names its chain from the closure layers and the folder the mod was read from', () => {
    const prepared = prepare(chain())
    expect(prepared.persistence?.label).toBe(
      'Mods/Core.SC2Mod → Mods/Liberty.SC2Mod → C:/Mods/My.SC2Mod · enUS',
    )
    expect(prepared.persistence?.top).toEqual({ directory: 'C:/Mods/My.SC2Mod' })
  })

  it('keeps one slot per chain: an edit replaces, other locales or layers do not', () => {
    const slot = prepare(chain()).persistence?.slot
    expect(slot).toBeDefined()
    expect(prepare(chain({ mod: { text: '<Catalog/>' } })).persistence?.slot).toBe(slot)
    expect(prepare(chain(), { locales: ['ruRU'] }).persistence?.slot).not.toBe(slot)
    expect(prepare(chain({ mod: { layerId: 'other:subject' } })).persistence?.slot).not.toBe(slot)
  })

  it('names a stock package whose own documents are the strongest layer by its source path', () => {
    const stock = chain()
    const liberty = {
      documents: stock.documents.slice(0, 2),
      origins: new Map([...stock.origins].slice(0, 2)),
    }
    const prepared = prepare(liberty)
    expect(prepared.persistence?.top).toEqual({ sourcePath: 'Mods/Liberty.SC2Mod' })
    expect(prepared.persistence?.label).toBe('Mods/Core.SC2Mod → Mods/Liberty.SC2Mod · enUS')
  })

  it('is absent for an incomplete context', () => {
    expect(prepare(chain(), { complete: false }).persistence).toBeUndefined()
  })
})

describe('persistent roots', () => {
  it('match a source path or a folder whatever the case and slashes', () => {
    expect(
      persistentRootsInclude([{ sourcePath: 'mods/liberty.sc2mod/' }], {
        sourcePath: 'Mods/Liberty.SC2Mod',
      }),
    ).toBe(true)
    expect(
      persistentRootsInclude([{ path: 'c:\\Mods\\My.SC2Mod\\' }], {
        directory: 'C:/Mods/My.SC2Mod',
      }),
    ).toBe(true)
    // a user folder loaded as a dependency layer names its folder as the source path
    expect(
      persistentRootsInclude([{ path: 'C:/Mods/Base.SC2Mod' }], {
        sourcePath: 'C:/Mods/Base.SC2Mod',
      }),
    ).toBe(true)
  })

  it('match nothing else', () => {
    expect(
      persistentRootsInclude([{ sourcePath: 'Mods/Void.SC2Mod' }], {
        sourcePath: 'Mods/Liberty.SC2Mod',
      }),
    ).toBe(false)
    expect(persistentRootsInclude([], { sourcePath: 'Mods/Liberty.SC2Mod' })).toBe(false)
    expect(persistentRootsInclude([{ path: 'C:/Mods/My.SC2Mod' }], {})).toBe(false)
  })
})
