import { describe, expect, it } from 'vitest'
import { chooseContentSource, type SourcePickerHost, type SourceSnapshot } from '../src/content-sources/index.js'

const snapshot: SourceSnapshot = { label: 'Battle.net', regions: [{ id: 'us', label: 'NA' }, { id: 'eu', label: 'EU' }],
  connections: [{ id: 'a-us', accountId: 'a', label: 'Account A', region: 'us' }],
  roots: [{ id: 'mine:a-us', label: 'Mine', kind: 'mine', region: 'us' }, { id: 'public:us', label: 'Public', kind: 'public', region: 'us' }] }
function fixture(selections: (string | undefined)[]) {
  const calls: [string, readonly unknown[]][] = []
  const opened: string[] = []
  const host: SourcePickerHost = {
    choose: async (_title, items) => {
      const choice = selections.shift()
      if (choice !== undefined) expect(items.some(item => item.id === choice)).toBe(true)
      return choice
    }, input: async () => ' Direct Strike ',
    call: async (method, args) => { calls.push([method, args]); return method === 'snapshot' ? snapshot :
      method === 'search' ? [{ id: 'found-revision', label: 'Direct Strike' }] : undefined },
    open: async root => { opened.push(root.id) }, openLocal: async () => { opened.push('local') },
  }
  return { host, calls, opened }
}
describe('shared source selection', () => {
  for (const action of ['$cancel', '$delete']) it(`deletion ${action} uses only a selected own-publication token`, async () => {
    const f = fixture(['$deletePublication', 'a-us', 'own-choice', action, ...(action === '$delete' ? ['$ok'] : []), undefined])
    f.host.call = async (method, args) => {
      f.calls.push([method, args])
      if (method === 'snapshot') return { ...snapshot, deletion: true }
      if (method === 'deletionCandidates') return [{ id: 'own-choice', label: 'Owned mod', description: '#19 · 1.1 · US' }]
      if (method === 'deletePublication') return { status: 'unlinked' }
      throw new Error(`Unexpected method ${method}`)
    }
    await chooseContentSource(f.host)
    expect(f.calls).toContainEqual(['deletionCandidates', ['a-us']])
    expect(f.calls.filter(([method]) => method === 'deletePublication')).toEqual(action === '$delete' ? [['deletePublication', ['own-choice']]] : [])
  })
  for (const action of ['$cancel', '$send']) it(`prepared publication ${action} stays bound to the reviewed token`, async () => {
    const f = fixture(['$publish', 'a-us', action, ...(action === '$send' ? ['$ok'] : []), undefined])
    const inputs = ['C:/test.SC2Mod', 'C:/test.modkit-publish.json']
    f.host.input = async () => inputs.shift()
    f.host.call = async (method, args) => {
      f.calls.push([method, args])
      if (method === 'snapshot') return { ...snapshot, publishing: true }
      if (method === 'preparePublish') return { id: 'review-token', name: 'Test', account: 'Account A', region: 'us',
        bytes: 100, sha256: 'a'.repeat(64), target: { mode: 'update', id: 19, expectedVersion: 65537 }, visibility: 'private', locked: true }
      if (method === 'publish') return { publication: { id: 19, version: 65538, name: 'Test' } }
      throw new Error(`Unexpected call ${method}`)
    }
    await chooseContentSource(f.host)
    expect(f.calls).toContainEqual(['preparePublish', ['a-us', 'C:/test.SC2Mod', 'C:/test.modkit-publish.json']])
    expect(f.calls.filter(([method]) => method === 'publish')).toEqual(action === '$send' ? [['publish', ['review-token']]] : [])
  })
  it('adds a server to an explicit account, then mounts that account source', async () => {
    const f = fixture(['$connect', 'eu', 'a', 'mine:a-us'])
    await chooseContentSource(f.host)
    expect(f.calls).toContainEqual(['connect', ['eu', 'a']])
    expect(f.calls).toContainEqual(['refresh', ['mine:a-us']])
    expect(f.opened).toEqual(['mine:a-us'])
  })
  it('public search uses the selected regional connection and adds only the selected result', async () => {
    const f = fixture(['$search', 'a-us', 'found-revision', 'public:us'])
    await chooseContentSource(f.host)
    expect(f.calls).toContainEqual(['search', ['a-us', 'Direct Strike']])
    expect(f.calls).toContainEqual(['add', ['found-revision']])
    expect(f.opened).toEqual(['public:us'])
  })
  it('cancelling account choice never logs in or changes the catalogue', async () => {
    const f = fixture(['$connect', 'us', undefined, undefined])
    await chooseContentSource(f.host)
    expect(f.calls.every(([method]) => method === 'snapshot')).toBe(true)
    expect(f.opened).toEqual([])
  })
  it('local storage remains available when Battle.net is not configured', async () => {
    const f = fixture(['$local'])
    f.host.call = async () => { throw new Error('Backend is not configured') }
    await chooseContentSource(f.host)
    expect(f.opened).toEqual(['local'])
  })
  it('mounts a local provider through the shared tree workflow without an account', async () => {
    const f = fixture(['local:cache'])
    f.host.call = async (method, args) => {
      f.calls.push([method, args])
      return method === 'snapshot' ? { regions: [], connections: [], roots: [
        { id: 'local:cache', label: 'Cache', region: 'local', kind: 'local' },
      ] } : undefined
    }
    await chooseContentSource(f.host)
    expect(f.calls).toContainEqual(['refresh', ['local:cache']])
    expect(f.opened).toEqual(['local:cache'])
  })
})
