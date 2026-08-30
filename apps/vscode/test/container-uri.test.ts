/**
 * The address of a container member, and the directory index the Explorer reads through it.
 *
 * Both are pure, and both are the kind of thing that is only ever wrong in one direction: a URI
 * that does not round-trip addresses a different file, and a listing that invents or loses a
 * directory shows a tree the archive does not have. The cases below are the ones a real container
 * produces — Windows paths with a drive letter and backslashes, deep entry paths a BIG stores as a
 * flat list, an entry naming `..`, two members whose paths differ only in case.
 */
import { describe, expect, it } from 'vitest'
import {
  buildContainerIndex,
  containerUriPath,
  containerUriText,
  CONTAINER_SCHEME,
  isContainerUriText,
  listContainerDirectory,
  normalizeEntryPath,
  parseContainerUriText,
  statContainerEntry,
  type ContainerEntryLike,
} from '../src/container-uri.js'

const entry = (path: string, size?: number): ContainerEntryLike => ({
  id: `id:${path}`,
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  kind: 'file',
  ...(size === undefined ? {} : { size: BigInt(size) }),
})

describe('a container member has an address', () => {
  it('round-trips a Windows path and a deep entry', () => {
    const container = 'C:\\apps\\CnC3KW\\Core\\1.0\\Misc.big'
    const text = containerUriText(container, 'data/editor/molds/bowl.w3d')
    expect(text.startsWith(`${CONTAINER_SCHEME}:/`)).toBe(true)
    expect(parseContainerUriText(text)).toEqual({
      container,
      entry: 'data/editor/molds/bowl.w3d',
    })
  })

  it('round-trips a POSIX path and a non-ASCII entry name', () => {
    const text = containerUriText('/srv/games/Основной.big', 'art/модель.w3d')
    expect(parseContainerUriText(text)).toEqual({
      container: '/srv/games/Основной.big',
      entry: 'art/модель.w3d',
    })
  })

  it('addresses the container itself with an empty entry', () => {
    const text = containerUriText('/srv/a.big')
    expect(parseContainerUriText(text)).toEqual({ container: '/srv/a.big', entry: '' })
  })

  it('is stable: the same container is always the same folder', () => {
    expect(containerUriPath('/srv/a.big')).toBe(containerUriPath('/srv/a.big'))
    expect(containerUriPath('/srv/a.big')).not.toBe(containerUriPath('/srv/b.big'))
  })

  it('accepts the authority-less spellings an editor may hand back', () => {
    const token = containerUriPath('/srv/a.big', 'x/y.w3d')
    for (const text of [
      `${CONTAINER_SCHEME}:${token}`,
      `${CONTAINER_SCHEME}://${token.slice(1)}`,
      `${CONTAINER_SCHEME}:///${token.slice(1)}`,
    ]) {
      expect(parseContainerUriText(text)).toEqual({ container: '/srv/a.big', entry: 'x/y.w3d' })
    }
  })

  it('refuses anything that is not one of these', () => {
    expect(parseContainerUriText('file:///c:/a.big')).toBeUndefined()
    expect(parseContainerUriText(`${CONTAINER_SCHEME}:/`)).toBeUndefined()
    // a token that is not hex names no container, rather than decoding to mojibake
    expect(parseContainerUriText(`${CONTAINER_SCHEME}:/zzzz/a.w3d`)).toBeUndefined()
    expect(isContainerUriText('C:\\apps\\a.big')).toBe(false)
  })

  it('drops the segments an archive must not be able to climb with', () => {
    expect(normalizeEntryPath('../../etc/passwd')).toBe('etc/passwd')
    expect(normalizeEntryPath('a//b/./c')).toBe('a/b/c')
    expect(parseContainerUriText(containerUriText('/srv/a.big', '../secret'))).toEqual({
      container: '/srv/a.big',
      entry: 'secret',
    })
  })
})

describe('a flat listing becomes a tree', () => {
  const index = buildContainerIndex([
    entry('data/editor/molds/bowl.w3d', 1024),
    entry('data/editor/molds/cup.w3d'),
    entry('data/ini/gamedata.ini', 12),
    entry('readme.txt', 3),
  ])

  it('synthesises the directories the container never listed', () => {
    expect(listContainerDirectory(index, '')?.map(node => [node.name, node.kind])).toEqual([
      ['data', 'directory'],
      ['readme.txt', 'file'],
    ])
    expect(listContainerDirectory(index, 'data')?.map(node => node.name)).toEqual(['editor', 'ini'])
    expect(listContainerDirectory(index, 'data/editor/molds')?.map(node => node.name)).toEqual([
      'bowl.w3d',
      'cup.w3d',
    ])
  })

  it('answers nothing for a directory the container does not hold', () => {
    expect(listContainerDirectory(index, 'data/audio')).toBeUndefined()
  })

  it('stats a member, a synthesised directory and the root', () => {
    expect(statContainerEntry(index, 'data/editor/molds/bowl.w3d')).toEqual({
      name: 'bowl.w3d',
      kind: 'file',
      size: 1024,
      entryId: 'id:data/editor/molds/bowl.w3d',
    })
    expect(statContainerEntry(index, 'data/editor')?.kind).toBe('directory')
    expect(statContainerEntry(index, '')?.kind).toBe('directory')
    expect(statContainerEntry(index, 'data/editor/molds/nothing.w3d')).toBeUndefined()
  })

  it('keeps two members that differ only in case apart', () => {
    const cased = buildContainerIndex([entry('art/Body.w3d'), entry('art/body.w3d')])
    expect(
      listContainerDirectory(cased, 'art')
        ?.map(node => node.name)
        .sort(),
    ).toEqual(['Body.w3d', 'body.w3d'])
  })

  it('keeps the first of two identical paths, so pagination cannot change the answer', () => {
    const duplicated = buildContainerIndex([
      { ...entry('art/a.w3d', 1), id: 'first' },
      { ...entry('art/a.w3d', 2), id: 'second' },
    ])
    expect(statContainerEntry(duplicated, 'art/a.w3d')?.entryId).toBe('first')
  })

  it('keeps a directory the container declared for itself', () => {
    const declared = buildContainerIndex([
      { id: 'd', path: 'empty', name: 'empty', kind: 'directory' },
    ])
    expect(listContainerDirectory(declared, 'empty')).toEqual([])
    expect(statContainerEntry(declared, 'empty')?.kind).toBe('directory')
  })
})
