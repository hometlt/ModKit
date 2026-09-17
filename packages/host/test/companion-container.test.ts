/**
 * `enclosing-container` on disk: a loose folder named like an archive format is that archive,
 * unpacked, so a companion is spelled relative to it exactly as it is inside the packed archive.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemCompanionOrigin } from '../src/node/companion-origin.js'

const temporaries: string[] = []
afterEach(async () => {
  for (const directory of temporaries.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('unexpected cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})

async function mod(): Promise<{ root: string; primary: string }> {
  const root = await mkdtemp(join(tmpdir(), 'x3-container-'))
  temporaries.push(root)
  for (const locale of ['enUS', 'ruRU']) {
    const directory = join(root, 'Test.SC2Mod', `${locale}.SC2Data`, 'LocalizedData')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'GameStrings.txt'), `A=${locale}`)
  }
  return {
    root,
    primary: join(root, 'Test.SC2Mod', 'enUS.SC2Data', 'LocalizedData', 'GameStrings.txt'),
  }
}

async function ids(iterable: AsyncIterable<{ logicalId: string }>): Promise<string[]> {
  const out: string[] = []
  for await (const item of iterable) out.push(item.logicalId)
  return out
}

describe('filesystem enclosing-container scope', () => {
  it('serves container-relative ids, skips the primary and opens from the container', async () => {
    const { root, primary } = await mod()
    const origin = createFilesystemCompanionOrigin({
      primaryPath: primary,
      roots: [root],
      containerExtensions: ['sc2mod'],
    })
    expect(origin.scopes).toEqual(['sibling-directory', 'enclosing-container'])
    const other = 'ruRU.SC2Data/LocalizedData/GameStrings.txt'
    expect(await ids(origin.enumerate('enclosing-container', { prefix: other }))).toEqual([other])
    const self = 'enUS.SC2Data/LocalizedData/GameStrings.txt'
    expect(await ids(origin.enumerate('enclosing-container', { prefix: self }))).toEqual([])
    const lease = await origin.open(other)
    if (lease.value.kind !== 'bytes') throw new Error('expected a byte source')
    expect(new TextDecoder().decode(await lease.value.read(0n, 6))).toBe('A=ruRU')
    await lease.release()
    // The sibling scope is unchanged: ids stay relative to the primary's own directory (the
    // resolver, not the origin, drops the primary there).
    expect(await ids(origin.enumerate('sibling-directory', { prefix: 'Game' }))).toEqual([
      'GameStrings.txt',
    ])
  })

  it('offers no container without a matching ancestor inside the granted roots', async () => {
    const { root, primary } = await mod()
    expect(createFilesystemCompanionOrigin({ primaryPath: primary, roots: [root] }).scopes).toEqual(
      ['sibling-directory'],
    )
    // The container folder itself is outside this root, so it is not a container here.
    const narrow = join(root, 'Test.SC2Mod', 'enUS.SC2Data')
    expect(
      createFilesystemCompanionOrigin({
        primaryPath: primary,
        roots: [narrow],
        containerExtensions: ['sc2mod'],
      }).scopes,
    ).toEqual(['sibling-directory'])
  })

  it('refuses traversal and does not follow a symlinked directory', async () => {
    const { root, primary } = await mod()
    const origin = createFilesystemCompanionOrigin({
      primaryPath: primary,
      roots: [root],
      containerExtensions: ['sc2mod'],
    })
    await expect(origin.open('../outside.txt')).rejects.toThrow()
    const outside = await mkdtemp(join(tmpdir(), 'x3-container-out-'))
    temporaries.push(outside)
    await writeFile(join(outside, 'GameStrings.txt'), 'secret')
    try {
      await symlink(outside, join(root, 'Test.SC2Mod', 'deDE.SC2Data'), 'junction')
    } catch {
      return // symlinks need a privilege this machine may not grant
    }
    expect(
      await ids(
        origin.enumerate('enclosing-container', { prefix: 'deDE.SC2Data/GameStrings.txt' }),
      ),
    ).toEqual([])
  })
})
