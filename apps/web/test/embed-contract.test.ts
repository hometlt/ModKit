/**
 * The parts of the embedding contract that are decided before a browser is involved.
 *
 * `embed.test.ts` proves the element works in Chromium; this proves the rules it works *by*, in
 * Node, where they can be stated one at a time: where an asset base resolves to, when an origin is
 * refused, which name a file is detected under, how a preferred stage becomes the mounted one, and
 * what the shipped stylesheet has to be rewritten into before a shadow root can use it.
 *
 * The stylesheet case is checked against the real `packages/ui/styles/modkit-ui.css` rather than a
 * sample: the rewrite is a small regex over somebody else's generated file, and the only honest
 * test of it is the file itself.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PreviewStage } from '@modkitx-x3/ui'

import {
  crossOriginRefusal,
  defineModkitElements,
  displayNameFor,
  EMBED_CHROME_CSS,
  EMBED_EXTENSION_ORIGINS,
  extensionCatalogRefusal,
  fileLikeFrom,
  MODKIT_VIEWER_TAG,
  parseWebExtensionCatalog,
  preferStage,
  resolveAssetBase,
  resolveExtensionCatalogUrl,
  shareByAssetBase,
} from '../src/embed.js'
import { repositoryRoot } from './browser-harness.js'

const DOCUMENT = 'https://example.test/notes/october/index.html'
const SCRIPT = 'https://example.test/vendor/modkit/embed.js'

describe('asset base resolution', () => {
  it('defaults to the directory embed.js was loaded from', () => {
    expect(resolveAssetBase(undefined, SCRIPT, DOCUMENT)).toBe(
      'https://example.test/vendor/modkit/',
    )
  })

  it('resolves an attribute against the document, not against the script', () => {
    // `./assets/` next to the *page*, which is what an author writing HTML means by it
    expect(resolveAssetBase('./assets/modkit', SCRIPT, DOCUMENT)).toBe(
      'https://example.test/notes/october/assets/modkit/',
    )
    expect(resolveAssetBase('/modkit', SCRIPT, DOCUMENT)).toBe('https://example.test/modkit/')
    expect(resolveAssetBase('https://cdn.test/mk/', SCRIPT, DOCUMENT)).toBe('https://cdn.test/mk/')
  })

  it('normalises every spelling of one base to one string, which is the shared-host key', () => {
    /*
     * Two elements written differently must share a host, so the key has to be the *resolved*
     * base and not the attribute text. All four of these are the same directory.
     */
    const spellings = [
      './assets/modkit',
      './assets/modkit/',
      'assets/modkit',
      '../october/assets/modkit/',
    ]
    const resolved = spellings.map(value => resolveAssetBase(value, SCRIPT, DOCUMENT))
    expect(new Set(resolved).size).toBe(1)
    expect(resolved[0]).toBe('https://example.test/notes/october/assets/modkit/')
  })
})

describe('origin refusal', () => {
  it('admits a same-origin asset base', () => {
    expect(crossOriginRefusal('https://example.test/mk/', 'https://example.test')).toBeUndefined()
  })

  it('refuses a cross-origin one, naming both origins and why no header fixes it', () => {
    const reason = crossOriginRefusal('https://cdn.test/mk/', 'https://example.test')
    expect(reason).toContain('https://cdn.test')
    expect(reason).toContain('https://example.test')
    expect(reason).toContain('same-origin mode')
  })

  it('treats a different port as a different origin, because the browser does', () => {
    expect(crossOriginRefusal('http://127.0.0.1:8081/', 'http://127.0.0.1:8080')).toBeDefined()
  })

  it('refuses an asset base that is not a URL at all', () => {
    expect(crossOriginRefusal('not a url', 'https://example.test')).toContain('not a URL')
  })
})

describe('build-pinned extension catalog origins', () => {
  it('fails closed in an unconfigured source build and ignores page globals', () => {
    ;(globalThis as Record<string, unknown>)['MODKIT_EMBED_EXTENSION_ORIGINS'] = [
      'https://extensions.test',
    ]
    expect(EMBED_EXTENSION_ORIGINS).toEqual([])
    expect(Object.isFrozen(EMBED_EXTENSION_ORIGINS)).toBe(true)
    expect(extensionCatalogRefusal('https://extensions.test/catalog.json')).toContain(
      'build-time allowlist',
    )
    delete (globalThis as Record<string, unknown>)['MODKIT_EMBED_EXTENSION_ORIGINS']
  })

  it('admits exactly an approved origin, not a sibling subdomain or port', () => {
    const allowed = ['https://extensions.test']
    expect(
      extensionCatalogRefusal('https://extensions.test/catalogs/stable.json', allowed),
    ).toBeUndefined()
    expect(extensionCatalogRefusal('https://cdn.extensions.test/catalog.json', allowed)).toContain(
      'not in this embed.js build-time allowlist',
    )
    expect(extensionCatalogRefusal('https://extensions.test:444/catalog.json', allowed)).toContain(
      'not in this embed.js build-time allowlist',
    )
  })

  it('resolves a relative catalog against the page and refuses non-network schemes', () => {
    expect(resolveExtensionCatalogUrl('./catalog.json', DOCUMENT)).toBe(
      'https://example.test/notes/october/catalog.json',
    )
    expect(extensionCatalogRefusal('data:application/json,{}', ['null'])).toContain(
      'must use http or https',
    )
  })

  it('accepts the catalog envelope and rejects malformed digest coordinates', () => {
    expect(parseWebExtensionCatalog({ schemaVersion: 1, extensions: [], excluded: [] })).toEqual({
      schemaVersion: 1,
      extensions: [],
      excluded: [],
    })
    expect(() =>
      parseWebExtensionCatalog({
        schemaVersion: 1,
        excluded: [],
        extensions: [
          {
            name: 'bad',
            source: 'bad',
            artifactRoot: './bad/',
            containers: {},
            files: ['index.js'],
            documents: [],
            documentDigests: [],
            artifact: {
              inventoryRecordId: 'bad',
              artifactDigest: 'chosen-by-the-page',
              fileDigests: { 'index.js': 'also-chosen-by-the-page' },
            },
          },
        ],
      }),
    ).toThrow('malformed extension entry')
  })
})

describe('display and detection name', () => {
  it('prefers the name attribute', () => {
    expect(displayNameFor('./data/x.bin', 'roster.csv', DOCUMENT)).toBe('roster.csv')
  })

  it('falls back to the basename of src, without the query or the fragment', () => {
    expect(displayNameFor('./data/roster.csv?v=3#top', undefined, DOCUMENT)).toBe('roster.csv')
    expect(displayNameFor('/a/b/table.tsv', undefined, DOCUMENT)).toBe('table.tsv')
  })

  it('decodes a percent-escaped basename, because detection reads the extension', () => {
    expect(displayNameFor('./data/field%20notes.csv', undefined, DOCUMENT)).toBe('field notes.csv')
  })

  it('answers something rather than nothing when there is neither', () => {
    expect(displayNameFor(undefined, undefined, DOCUMENT)).toBe('file')
    expect(displayNameFor('./data/', undefined, DOCUMENT)).toBe('file')
  })
})

describe('preferred stage', () => {
  const stages = [
    { id: 'image', label: 'Image', contract: 'a' },
    { id: 'table', label: 'Table', contract: 'b' },
    { label: 'Hex', contract: 'common.view/byte-range-source' },
  ] as unknown as readonly PreviewStage[]
  const ids = (list: readonly PreviewStage[]): readonly string[] =>
    list.map(stage => stage.id ?? stage.contract ?? stage.operation ?? 'invalid-stage')

  it('moves the named stage to the front and keeps the rest in order', () => {
    expect(ids(preferStage(stages, 'table'))).toEqual([
      'table',
      'image',
      'common.view/byte-range-source',
    ])
  })

  it('reorders rather than filters, so the picker still offers everything', () => {
    expect(preferStage(stages, 'table')).toHaveLength(stages.length)
  })

  it('falls back to the resolver order for an id no stage carries', () => {
    expect(preferStage(stages, 'not-a-stage')).toBe(stages)
    expect(preferStage(stages, undefined)).toBe(stages)
    expect(preferStage(stages, '')).toBe(stages)
  })

  it('accepts a stage that names no id, by its contract', () => {
    expect(ids(preferStage(stages, 'common.view/byte-range-source'))[0]).toBe(
      'common.view/byte-range-source',
    )
  })
})

describe('the shipped stylesheet is shadow-capable as shipped', () => {
  const source = readFileSync(
    join(repositoryRoot, 'packages', 'ui', 'styles', 'modkit-ui.css'),
    'utf8',
  )

  /*
   * The element used to regex-rewrite ":root" to ":host" at load time; the generator now emits
   * both, so the element adopts the fetched bytes untouched. This is the test that keeps it true:
   * if the generator regresses to bare :root, the embedded element silently loses every token —
   * exactly the failure the rewrite existed to prevent — and this goes red instead.
   */
  it('defines its tokens for :host, not only :root', () => {
    expect(source).toContain(':host {')
    expect(source).toContain(":host([data-mk-theme='modkit-dark'])")
    expect(source).toContain(":host([data-mk-theme='modkit-light'])")
    expect(source).toContain(":host([data-mk-theme='modkit-high-contrast'])")
    expect(source).toContain(':host(:not([data-mk-theme]))')
  })

  it('lets density sit on the embedded element itself', () => {
    expect(source).toContain(":host([data-mk-density='compact'])")
    expect(source).toContain(":host([data-mk-density='comfortable'])")
  })
})

describe('the element chrome stylesheet', () => {
  it('resets the inherited text properties a host page could otherwise push through', () => {
    for (const property of [
      'color',
      'font',
      'letter-spacing',
      'word-spacing',
      'text-align',
      'text-transform',
      'white-space',
    ]) {
      expect(EMBED_CHROME_CSS).toContain(`${property}: initial`)
    }
  })

  it('leaves visibility and direction to the page, because those are not leaks', () => {
    expect(EMBED_CHROME_CSS).not.toContain('visibility: initial')
    expect(EMBED_CHROME_CSS).not.toContain('direction: initial')
    expect(EMBED_CHROME_CSS).not.toContain('writing-mode: initial')
  })
})

describe('one host per asset base', () => {
  it('creates once per key and hands the same promise to every caller', async () => {
    const cache = new Map<string, Promise<string>>()
    const created: string[] = []
    const create = async (base: string): Promise<string> => {
      created.push(base)
      return `host:${base}`
    }
    const first = shareByAssetBase(cache, 'https://a.test/mk/', create)
    const second = shareByAssetBase(cache, 'https://a.test/mk/', create)
    expect(second).toBe(first)
    expect(await first).toBe('host:https://a.test/mk/')
    expect(created).toEqual(['https://a.test/mk/'])
  })

  it('keys by the base, so two bases are two hosts', async () => {
    const cache = new Map<string, Promise<string>>()
    const created: string[] = []
    const create = async (base: string): Promise<string> => {
      created.push(base)
      return base
    }
    await shareByAssetBase(cache, 'https://a.test/mk/', create)
    await shareByAssetBase(cache, 'https://b.test/mk/', create)
    expect(created).toEqual(['https://a.test/mk/', 'https://b.test/mk/'])
    expect(cache.size).toBe(2)
  })

  it('does not cache a failure as the answer for the rest of the page', async () => {
    const cache = new Map<string, Promise<string>>()
    let attempts = 0
    const create = async (base: string): Promise<string> => {
      attempts += 1
      if (attempts === 1) throw new Error('the network was down')
      return base
    }
    await expect(shareByAssetBase(cache, 'https://a.test/mk/', create)).rejects.toThrow(
      'the network was down',
    )
    expect(await shareByAssetBase(cache, 'https://a.test/mk/', create)).toBe('https://a.test/mk/')
    expect(attempts).toBe(2)
  })
})

describe('bytes handed in directly', () => {
  const blob = {
    size: 7,
    slice: (start: number, end: number) => ({
      async arrayBuffer(): Promise<ArrayBuffer> {
        return new ArrayBuffer(end - start)
      },
    }),
  }

  it('uses the blob’s own name when it has one', () => {
    expect(fileLikeFrom({ ...blob, name: 'inline.csv' }, 'fallback.bin').name).toBe('inline.csv')
  })

  it('uses the element’s name when the blob has none', () => {
    expect(fileLikeFrom(blob, 'fallback.bin').name).toBe('fallback.bin')
    expect(fileLikeFrom({ ...blob, name: '' }, 'fallback.bin').name).toBe('fallback.bin')
  })

  it('carries the size and a modification time even for a plain blob', async () => {
    const file = fileLikeFrom(blob, 'fallback.bin')
    expect(file.size).toBe(7)
    expect(file.lastModified).toBe(0)
    expect((await file.slice(0, 4).arrayBuffer()).byteLength).toBe(4)
  })
})

describe('registration', () => {
  /** The registry a page would supply, reduced to what `defineModkitElements` touches. */
  function fakeRegistry(): {
    readonly defined: Map<string, CustomElementConstructor>
    readonly registry: CustomElementRegistry
  } {
    const defined = new Map<string, CustomElementConstructor>()
    const registry = {
      define: (name: string, constructor: CustomElementConstructor) =>
        void defined.set(name, constructor),
      get: (name: string) => defined.get(name),
    } as unknown as CustomElementRegistry
    return { defined, registry }
  }

  /** Node has no `HTMLElement`; the element class only needs a constructor to extend. */
  function withStubElement<Value>(run: () => Value): Value {
    const scope = globalThis as unknown as { HTMLElement?: unknown }
    const previous = scope.HTMLElement
    const had = 'HTMLElement' in scope
    scope.HTMLElement = class {
      /** Never read. It exists because a base class with no members at all is a lint error. */
      readonly platform = 'stub'
    }
    try {
      return run()
    } finally {
      if (had) scope.HTMLElement = previous
      else delete scope.HTMLElement
    }
  }

  it('refuses to register where there is no DOM, rather than half-defining something', () => {
    expect(() => defineModkitElements({ registry: fakeRegistry().registry })).toThrow(
      /customElements and HTMLElement/u,
    )
  })

  it('defines modkit-viewer, and is idempotent for a page that loads the entry twice', () => {
    withStubElement(() => {
      const { defined, registry } = fakeRegistry()
      expect(defineModkitElements({ registry })).toBe(MODKIT_VIEWER_TAG)
      const first = defined.get(MODKIT_VIEWER_TAG)
      expect(defineModkitElements({ registry })).toBe(MODKIT_VIEWER_TAG)
      expect(defined.get(MODKIT_VIEWER_TAG)).toBe(first)
      expect(defined.size).toBe(1)
    })
  })

  it('registers under another name for a page that already owns this one', () => {
    withStubElement(() => {
      const { defined, registry } = fakeRegistry()
      expect(defineModkitElements({ registry, tagName: 'survey-viewer' })).toBe('survey-viewer')
      expect([...defined.keys()]).toEqual(['survey-viewer'])
    })
  })
})
