/**
 * Block 12 slice 12-3 item 4 — the candidate UVW path, testkit-only by construction.
 *
 * This file does three separate jobs and the third is the one that keeps the other two honest.
 *
 *  1. It executes the pinned conformance vectors (`specs/conformance/uvw/vectors.json`) against the
 *     pinned validator, so the profile's rules are enforced *here*, not merely described in the
 *     specs repository. Two accept cases and seven rejects, each reject matching its named rule —
 *     a validator that refused for the wrong reason would pass a looser test and fail this one.
 *  2. It materializes a synthetic world projection into a UVW document, reopens that document with
 *     a reader that shares no state with the writer, and compares. Repeat materialization is
 *     byte-stable.
 *  3. It asserts that **no shipped contribution publishes UVW and no operation produces it**. That
 *     is the candidate boundary, and an assertion rather than an intention: the day someone wires a
 *     world materializer into an extension manifest before block 18's admission, this test goes red
 *     and says why.
 *
 * What the round trip proves is narrow and worth stating plainly: it is evidence about the
 * *format*, not about any game. Every input here was authored to match the schema, because no host
 * publishes a live world facet yet — map families arrive in blocks 15-16. A profile that has never
 * met a real disagreement has not been tested against one, and that is exactly why UVW is a
 * candidate and why `world-interchange-v1` stays a reserved scope rather than a minted one.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const specs = join(repoRoot, 'vendor', 'multiverse-specs', 'specs')
const fixtureDir = join(specs, 'world', 'fixtures')

interface UvwLayer {
  readonly id: string
  readonly kind: string
  readonly label?: string
  readonly columns: number
  readonly rows: number
  readonly cellSize: number
  readonly origin: readonly [number, number, number]
  readonly noDataValue?: number
  readonly samples: readonly (readonly number[])[]
}

interface UvwDocument {
  readonly uv: { readonly format: string; readonly version: string; readonly status?: string }
  readonly basis: Record<string, unknown>
  readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] }
  readonly layers: readonly UvwLayer[]
}

interface UvwProfileTool {
  assertUvwProfile(document: unknown): unknown
  UvwRuleError: new (rule: string, message: string) => Error & { rule: string }
  heightfieldElevationRange(layer: UvwLayer): { min: number; max: number } | undefined
}

const loadProfile = async (): Promise<UvwProfileTool> =>
  (await import(
    pathToFileURL(join(specs, 'tools', 'uvw-profile.mjs')).href
  )) as unknown as UvwProfileTool

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T

/** Apply one vector mutation. `path` is dot-separated with numeric segments indexing arrays. */
function setPath(target: unknown, path: string, value: unknown): void {
  const parts = path.split('.')
  let cursor = target as Record<string, unknown>
  for (const part of parts.slice(0, -1)) {
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts.at(-1) as string] = value
}

// ---------------------------------------------------------------------------------------------
// a synthetic world projection, and the testkit-only materializer over it

interface WorldProjectionPage {
  readonly items: readonly UvwLayer[]
  readonly cursor?: string
}

/**
 * A paged world source, drained the way a live projection would be.
 *
 * Paging is not decoration here: the materializer must produce the same document whichever page
 * boundary the source happens to use, and a source that hands over everything at once cannot show
 * that. Two layers over two pages is the smallest arrangement that can.
 */
function pagedWorldSource(layers: readonly UvwLayer[]) {
  return {
    async page(cursor?: string): Promise<WorldProjectionPage> {
      const start = cursor === undefined ? 0 : Number(cursor)
      const items = layers.slice(start, start + 1)
      const next = start + 1
      return next < layers.length ? { items, cursor: String(next) } : { items }
    },
  }
}

/**
 * Materialize a drained world projection into a UVW document.
 *
 * Testkit-only on purpose: until block 18 admits the profile there is no public operation and no
 * contribution that produces UVW, so this lives beside the test that exercises it rather than in
 * `extensions/`. It implements exactly the two canonical-ordering rules the profile states — layers
 * sorted by id, samples never reordered — and nothing else.
 */
async function materializeUvw(
  source: ReturnType<typeof pagedWorldSource>,
  frame: { basis: Record<string, unknown>; bounds: UvwDocument['bounds'] },
): Promise<UvwDocument> {
  const drained: UvwLayer[] = []
  let cursor: string | undefined
  do {
    const page: WorldProjectionPage = await source.page(cursor)
    drained.push(...page.items)
    cursor = page.cursor
  } while (cursor !== undefined)

  return {
    uv: { format: 'UVW', version: '1.0', status: 'candidate' },
    basis: frame.basis,
    bounds: frame.bounds,
    layers: [...drained].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
  }
}

const canonical = (value: unknown): string => JSON.stringify(value)

// ---------------------------------------------------------------------------------------------

describe('12-3 UVW candidate — the pinned vectors run here, not only in the specs repo', () => {
  it('accepts and rejects exactly what the vectors say, each rejection by its named rule', async () => {
    const { assertUvwProfile, UvwRuleError } = await loadProfile()
    const vectors = await readJson<{
      vectors: readonly {
        id: string
        expect: 'accept' | 'reject'
        fixture: string
        rule?: string
        mutations: readonly { op: string; path: string; value: unknown }[]
      }[]
    }>(join(specs, 'conformance', 'uvw', 'vectors.json'))

    expect(vectors.vectors.length).toBeGreaterThanOrEqual(9)
    const seen: string[] = []
    for (const vector of vectors.vectors) {
      const document = await readJson<UvwDocument>(join(fixtureDir, vector.fixture))
      for (const mutation of vector.mutations) {
        expect(mutation.op).toBe('set')
        setPath(document, mutation.path, mutation.value)
      }
      let outcome: 'accept' | 'reject' = 'accept'
      let rule: string | undefined
      try {
        assertUvwProfile(document)
      } catch (error) {
        if (!(error instanceof UvwRuleError)) throw error
        outcome = 'reject'
        rule = (error as { rule: string }).rule
      }
      expect(outcome, vector.id).toBe(vector.expect)
      if (vector.expect === 'reject') expect(rule, vector.id).toBe(vector.rule)
      seen.push(vector.id)
    }
    // the rejects are the substance; an all-accept suite would prove only that nothing is checked
    expect(vectors.vectors.filter(item => item.expect === 'reject').length).toBeGreaterThanOrEqual(
      7,
    )
    expect(new Set(seen).size).toBe(seen.length)
  }, 60_000)

  it('every shipped fixture is valid under the pinned validator', async () => {
    const { assertUvwProfile } = await loadProfile()
    const names = (await readdir(fixtureDir)).filter(name => name.endsWith('.uvw.json'))
    expect(names.length).toBeGreaterThanOrEqual(2)
    for (const name of names) {
      const document = await readJson<UvwDocument>(join(fixtureDir, name))
      expect(() => assertUvwProfile(document), name).not.toThrow()
    }
  }, 60_000)
})

describe('12-3 UVW candidate — materialize a synthetic projection and reopen it', () => {
  const frame = {
    basis: {
      handedness: 'right',
      upAxis: 'y',
      forwardAxis: '+z',
      unit: 'source-unit',
      sourceUnit: 'sc2-game-unit',
      unitsPerCell: 1,
    },
    bounds: { min: [0, -1, 0], max: [8, 5, 8] },
  } as const

  /** Two layers handed over out of order, so the canonical sort has something to do. */
  const layers: readonly UvwLayer[] = [
    {
      id: 'water',
      kind: 'heightfield',
      label: 'Water plane',
      columns: 2,
      rows: 2,
      cellSize: 8,
      origin: [0, 0, 0],
      samples: [
        [0.5, 0.5],
        [0.5, 0.5],
      ],
    },
    {
      id: 'cliffs',
      kind: 'heightfield',
      label: 'Cliff level',
      columns: 3,
      rows: 3,
      cellSize: 4,
      origin: [0, 0, 0],
      noDataValue: -9999,
      samples: [
        [0, 0, 1],
        [0, -9999, 1],
        [2, 2, 3],
      ],
    },
  ]

  it('round-trips through a reader that shares nothing with the writer', async () => {
    const { assertUvwProfile, heightfieldElevationRange } = await loadProfile()
    const document = await materializeUvw(pagedWorldSource(layers), {
      basis: { ...frame.basis },
      bounds: { min: [...frame.bounds.min], max: [...frame.bounds.max] },
    })

    // the writer's own claim is checked by the profile, not taken on trust
    expect(() => assertUvwProfile(document)).not.toThrow()
    expect(document.layers.map(layer => layer.id)).toEqual(['cliffs', 'water'])

    // reopen: parse the serialized bytes back, exactly as an unrelated reader would
    const reopened = JSON.parse(JSON.stringify(document)) as UvwDocument
    expect(() => assertUvwProfile(reopened)).not.toThrow()
    expect(canonical(reopened)).toBe(canonical(document))

    /*
     * And a semantic check, not just a structural one: the no-data sample must not be read as an
     * elevation. Encoding a hole as a very low number makes a wall instead of a hole, and a
     * round-trip that only compared bytes would never notice.
     */
    const cliffs = reopened.layers.find(layer => layer.id === 'cliffs') as UvwLayer
    expect(heightfieldElevationRange(cliffs)).toEqual({ min: 0, max: 3 })
  }, 60_000)

  it('is byte-stable across a second, independent materialization', async () => {
    const first = await materializeUvw(pagedWorldSource(layers), {
      basis: { ...frame.basis },
      bounds: { min: [...frame.bounds.min], max: [...frame.bounds.max] },
    })
    const second = await materializeUvw(pagedWorldSource([...layers].reverse()), {
      basis: { ...frame.basis },
      bounds: { min: [...frame.bounds.min], max: [...frame.bounds.max] },
    })
    // the source handed the layers over in the opposite order; the document must not notice
    expect(canonical(second)).toBe(canonical(first))
  }, 60_000)
})

describe('12-3 UVW stays a candidate: nothing ships it', () => {
  it('no extension manifest declares a UVW contribution or operation', async () => {
    /*
     * The boundary, asserted rather than intended. Admission is block 18; until then UVW exists as
     * a schema, a validator and this harness, and a world materializer wired into a shipped
     * manifest would turn an admission-only artifact into a product promise. If that happens, this
     * is the test that says so.
     */
    const extensionsRoot = join(repoRoot, 'extensions')
    const offenders: string[] = []
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue
          await walk(path)
        } else if (entry.name.endsWith('.json') && directory.includes('contributions')) {
          const text = await readFile(path, 'utf8')
          if (/\buvw\b/iu.test(text)) offenders.push(path)
        }
      }
    }
    await walk(extensionsRoot)
    expect(offenders).toEqual([])
  }, 120_000)
})
