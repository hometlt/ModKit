import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createContentIndexBuilder, openContentIndex } from '../src/content-index.js'
import {
  listIndexCaches,
  openCachedContentIndex,
  removeIndexCache,
} from '../src/node/index-caches.js'

const text = (value: string) => new TextEncoder().encode(value)
const work = await mkdtemp(join(tmpdir(), 'modkit-content-index-'))
afterAll(() => rm(work, { recursive: true, force: true }))

describe('content index', () => {
  it('names every file that may contain a query and none that cannot', async () => {
    const builder = createContentIndexBuilder()
    builder.add('Units/Marine.xml', text('<CUnit id="Marine"><LifeMax value="45"/></CUnit>'))
    builder.add('Units/Zealot.xml', text('<CUnit id="Zealot"><ShieldsMax value="50"/></CUnit>'))
    builder.add('Strings.txt', text('Unit/Name/Marine=Морпех'))
    expect(builder.add('Model.m3', Uint8Array.of(77, 0, 51, 51, 0))).toBe(false)
    const stored = builder.encode()
    const index = await openContentIndex(async (offset, length) =>
      stored.slice(offset, offset + length),
    )
    expect(index.fileCount).toBe(3)
    expect(await index.candidates('marine')).toEqual(['Units/Marine.xml', 'Strings.txt'])
    expect(await index.candidates('ShieldsMax')).toEqual(['Units/Zealot.xml'])
    expect(await index.candidates('Hydralisk')).toEqual([])
    // too short to prune: every indexed file is a candidate, the caller matches itself
    expect(await index.candidates('Ma')).toHaveLength(3)
  })

  it('is stored per root revision in the shared cache directory, listed and cleared', async () => {
    const directory = join(work, 'caches')
    // another owner's cache in the same directory (CASC names) is listed beside ours
    await mkdir(join(directory, 'casc-names'), { recursive: true })
    await writeFile(
      join(directory, 'casc-names', 'cache.json'),
      JSON.stringify({ game: 'starcraft2', product: 's2', kind: 'names', installation: 'C:/SC2' }),
    )
    let reads = 0
    const request = (revision: string) => ({
      directory,
      manifest: { game: 'starcraft2', product: 's2', installation: 'C:/SC2' },
      root: 'local:casc/root',
      revision,
      async *files() {
        reads += 1
        yield { path: 'a.galaxy', bytes: text('void InitMap () {}') }
        yield { path: 'b.xml', bytes: text('<Catalog/>') }
      },
    })
    const first = await openCachedContentIndex(request('96000'))
    expect(await first.candidates('InitMap')).toEqual(['a.galaxy'])
    await first.close()
    const again = await openCachedContentIndex(request('96000'))
    await again.close()
    expect(reads).toBe(1)
    const next = await openCachedContentIndex(request('97000'))
    await next.close()
    expect(reads).toBe(2)

    const caches = await listIndexCaches(directory)
    expect(caches.map(cache => cache.manifest.kind)).toEqual(['names', 'content'])
    const content = caches.find(cache => cache.manifest.kind === 'content')!
    expect(content.bytes).toBeGreaterThan(0)
    // only the current revision's index stays
    expect(
      (await readdir(join(directory, content.folder))).filter(name => name.endsWith('.mkci')),
    ).toHaveLength(1)
    await removeIndexCache(directory, content.folder)
    expect((await listIndexCaches(directory)).map(cache => cache.folder)).toEqual(['casc-names'])
    await expect(removeIndexCache(directory, '../outside')).rejects.toThrow(TypeError)
  })
})
