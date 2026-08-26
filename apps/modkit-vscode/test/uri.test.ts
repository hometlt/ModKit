/**
 * What the host will open, and what it refuses — asserted without a `vscode` module, because the
 * rule is a pure function over the two `Uri` fields it reads.
 */
import { describe, expect, it } from 'vitest'
import { containerUriText, CONTAINER_SCHEME } from '../src/container-uri.js'
import { describeOpenTarget, refusalFor, type UriLike } from '../src/uri.js'

const uri = (scheme: string, fsPath = '', text?: string): UriLike => ({
  scheme,
  fsPath,
  toString: () => text ?? `${scheme}://${fsPath}`,
})

describe('open target', () => {
  it('accepts a file URI and hands back the path the opener will confine', () => {
    const target = describeOpenTarget(uri('file', '/work/mod/assets/unit.dds'))
    expect(target).toEqual({ state: 'accepted', path: '/work/mod/assets/unit.dds', kind: 'file' })
    expect(refusalFor(uri('file', '/work/mod/assets/unit.dds'))).toBeUndefined()
  })

  it('accepts a container member and hands back the URI, not a path', () => {
    const text = containerUriText('C:\\games\\Misc.big', 'art/w3d/bowl.w3d')
    // `fsPath` on this scheme is meaningless, so the fixture gives it a wrong value on purpose:
    // accepting the URI text is the whole point, and reading `fsPath` here would be the bug.
    const target = describeOpenTarget(uri(CONTAINER_SCHEME, '/not/a/real/path', text))
    expect(target).toEqual({ state: 'accepted', path: text, kind: 'container-entry' })
  })

  it('refuses a container URI that names the container itself, and a malformed one', () => {
    const root = containerUriText('C:\\games\\Misc.big')
    expect(refusalFor(uri(CONTAINER_SCHEME, '', root))).toContain('open the container file')
    expect(refusalFor(uri(CONTAINER_SCHEME, '', `${CONTAINER_SCHEME}:/zz/x.w3d`))).toContain(
      'names no container',
    )
  })

  it('refuses an unsaved buffer, naming the scheme and the reason', () => {
    const target = describeOpenTarget(uri('untitled', '', 'untitled:Untitled-1'))
    expect(target.state).toBe('refused')
    if (target.state !== 'refused') return
    expect(target.reason).toContain('untitled:')
    expect(target.reason).toContain('never been written to disk')
  })

  it.each([
    ['vscode-remote', 'remote machine'],
    ['git', 'source control'],
    ['vscode-userdata', 'editor storage'],
    ['https', 'network resource'],
  ])('refuses %s with a sentence a user can act on', (scheme, expected) => {
    const reason = refusalFor(uri(scheme, '/whatever'))
    expect(reason).toBeDefined()
    expect(reason).toContain(scheme)
    expect(reason).toContain(expected)
  })

  it('refuses a scheme it has never heard of rather than guessing a path', () => {
    const reason = refusalFor(uri('some-vendor-fs', '/looks/like/a/path'))
    expect(reason).toContain('not a local file scheme')
  })

  it('refuses a file URI with no path instead of opening the process working directory', () => {
    expect(refusalFor(uri('file', ''))).toContain('empty path')
  })
})
