import { describe, expect, it } from 'vitest'
import {
  createGrantedRoots,
  type PathTools,
  ELECTRON_SECURE_WEB_PREFERENCES,
  assertElectronBrokerRequest,
  createElectronApp,
  isAllowedElectronNavigation,
} from '../src/index.js'

describe('Electron composition security', () => {
  it('does not leak main-process facilities into the renderer profile', async () => {
    const app = await createElectronApp()
    expect(app.main.profile.facilities).toContain('process.launch')
    expect(app.renderer.profile.facilities).not.toContain('process.launch')
    expect(ELECTRON_SECURE_WEB_PREFERENCES).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    })
  })

  it('rejects unknown channels and malformed range requests', () => {
    expect(() => assertElectronBrokerRequest({ channel: 'shell.exec', payload: {} })).toThrow(
      /non-allowlisted/,
    )
    expect(() =>
      assertElectronBrokerRequest({
        channel: 'filesystem.read-range',
        payload: { handleId: 'a', offset: -1, length: 4 },
      }),
    ).toThrow(/malformed/)
  })

  it('allows navigation only inside the exact application origin', () => {
    expect(isAllowedElectronNavigation('app://modkit/index.html', 'app://modkit/')).toBe(true)
    expect(isAllowedElectronNavigation('https://example.com/', 'app://modkit/')).toBe(false)
  })
})

const SEPARATOR = String.fromCharCode(92)
/** Join Windows-style path parts without writing escape-prone literals in the test source. */
const win = (...parts: readonly string[]): string => parts.join(SEPARATOR)

const windowsTools = (): PathTools => ({
  resolve: path => {
    const out: string[] = []
    for (const part of path.split(/[\\/]/u)) {
      if (part === '..') out.pop()
      else if (part !== '.' && part !== '') out.push(part)
    }
    return out.join(SEPARATOR)
  },
  separator: SEPARATOR,
  caseSensitive: false,
})

describe('granted-root confinement', () => {
  it('refuses every path until the user grants a root', () => {
    const roots = createGrantedRoots(windowsTools())
    expect(roots.list()).toEqual([])
    expect(roots.allows(win('C:', 'data', 'file.json'))).toBe(false)
    expect(() => roots.require(win('C:', 'data', 'file.json'))).toThrow(
      /outside every granted root/u,
    )
  })

  it('allows the root itself and anything under it', () => {
    const roots = createGrantedRoots(windowsTools())
    roots.grant(win('C:', 'data'))
    expect(roots.allows(win('C:', 'data'))).toBe(true)
    expect(roots.allows(win('C:', 'data', 'nested', 'file.json'))).toBe(true)
  })

  it('does not let a sibling directory pass on a shared prefix', () => {
    // `C:\data-private` starts with `C:\data` as a string but is not inside it.
    const roots = createGrantedRoots(windowsTools())
    roots.grant(win('C:', 'data'))
    expect(roots.allows(win('C:', 'data-private', 'secret.json'))).toBe(false)
  })

  it('collapses traversal before testing containment', () => {
    const roots = createGrantedRoots(windowsTools())
    roots.grant(win('C:', 'data'))
    expect(roots.allows(win('C:', 'data', '..', '..', 'Windows', 'System32', 'config'))).toBe(false)
    expect(roots.allows(win('C:', 'data', 'sub', '..', 'file.json'))).toBe(true)
  })

  it('treats Windows paths case-insensitively and POSIX paths case-sensitively', () => {
    const upper = createGrantedRoots(windowsTools())
    upper.grant(win('C:', 'Data'))
    expect(upper.allows(win('c:', 'data', 'file.json'))).toBe(true)

    const posix = createGrantedRoots({
      resolve: path => path.replace(/\/+$/u, ''),
      separator: '/',
      caseSensitive: true,
    })
    posix.grant('/home/user/data')
    expect(posix.allows('/home/user/data/file.json')).toBe(true)
    expect(posix.allows('/home/user/DATA/file.json')).toBe(false)
  })
})

describe('extended broker channels', () => {
  it('accepts the file-browsing channels with well-formed payloads', () => {
    expect(() =>
      assertElectronBrokerRequest({
        channel: 'directory.list',
        payload: { path: win('C:', 'data') },
      }),
    ).not.toThrow()
    expect(() =>
      assertElectronBrokerRequest({
        channel: 'filesystem.read-file',
        payload: { path: win('C:', 'data', 'a.json'), maxBytes: 1024 },
      }),
    ).not.toThrow()
    expect(() =>
      assertElectronBrokerRequest({
        channel: 'dialog.open-directory',
        payload: { requestId: 'r1' },
      }),
    ).not.toThrow()
  })

  it('rejects malformed payloads on those channels', () => {
    expect(() =>
      assertElectronBrokerRequest({ channel: 'directory.list', payload: { path: '' } }),
    ).toThrow()
    expect(() =>
      assertElectronBrokerRequest({
        channel: 'filesystem.read-file',
        payload: { path: win('C:', 'a'), maxBytes: 0 },
      }),
    ).toThrow()
    expect(() =>
      assertElectronBrokerRequest({
        channel: 'directory.delete',
        payload: { path: win('C:', 'data') },
      }),
    ).toThrow()
  })
})
