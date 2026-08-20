/**
 * What the host will open, and what it refuses — asserted without a `vscode` module, because the
 * rule is a pure function over the two `Uri` fields it reads.
 */
import { describe, expect, it } from 'vitest'
import { describeOpenTarget, refusalFor, type UriLike } from '../src/uri.js'

const uri = (scheme: string, fsPath = '', text?: string): UriLike => ({
  scheme,
  fsPath,
  toString: () => text ?? `${scheme}://${fsPath}`,
})

describe('open target', () => {
  it('accepts a file URI and hands back the path the opener will confine', () => {
    const target = describeOpenTarget(uri('file', '/work/mod/assets/unit.dds'))
    expect(target).toEqual({ state: 'accepted', path: '/work/mod/assets/unit.dds' })
    expect(refusalFor(uri('file', '/work/mod/assets/unit.dds'))).toBeUndefined()
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
