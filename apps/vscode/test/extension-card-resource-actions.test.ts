import { describe, expect, it } from 'vitest'

import {
  isSafeExternalHttpUrl,
  openVsCodeExtensionCardResource,
  type VsCodeResourceActions,
} from '../src/extension-card-resource-actions.js'

function fakeVsCode(calls: {
  external: unknown[]
  commands: unknown[][]
  files: string[]
}): VsCodeResourceActions {
  return {
    Uri: {
      file: path => {
        calls.files.push(path)
        return { scheme: 'file', path }
      },
      parse: value => ({ scheme: new URL(value).protocol.slice(0, -1), value }),
    },
    env: {
      openExternal: async uri => {
        calls.external.push(uri)
        return true
      },
    },
    commands: {
      executeCommand: async (command, ...rest) => {
        calls.commands.push([command, ...rest])
      },
    },
  }
}

describe('VS Code extension-card resource adapter', () => {
  it('reveals source folders, opens license files, and sends only HTTP(S) URLs to openExternal', async () => {
    const calls = { external: [] as unknown[], commands: [] as unknown[][], files: [] as string[] }
    const vscode = fakeVsCode(calls)
    const root = process.platform === 'win32' ? 'C:/extensions/demo' : '/extensions/demo'
    const license = `${root}/licenses/MIT.txt`
    await openVsCodeExtensionCardResource(vscode, {
      id: 'source',
      role: 'source',
      kind: 'folder',
      target: root,
    })
    await openVsCodeExtensionCardResource(vscode, {
      id: 'license-0',
      role: 'license',
      kind: 'file',
      target: license,
    })
    await openVsCodeExtensionCardResource(vscode, {
      id: 'homepage',
      role: 'source',
      kind: 'url',
      target: 'https://example.test/modkit',
    })

    expect(calls.files).toEqual([root, license])
    expect(calls.commands.map(call => call[0])).toEqual(['revealInExplorer', 'vscode.open'])
    expect(calls.external).toEqual([{ scheme: 'https', value: 'https://example.test/modkit' }])
  })

  it('refuses non-HTTP URLs and non-absolute local paths before any VS Code action', async () => {
    const calls = { external: [] as unknown[], commands: [] as unknown[][], files: [] as string[] }
    const vscode = fakeVsCode(calls)
    expect(isSafeExternalHttpUrl('https://example.test/source')).toBe(true)
    expect(isSafeExternalHttpUrl('file:///C:/secret')).toBe(false)
    expect(isSafeExternalHttpUrl('https://user:secret@example.test/source')).toBe(false)
    await expect(
      openVsCodeExtensionCardResource(vscode, {
        id: 'source',
        role: 'source',
        kind: 'url',
        target: 'file:///C:/secret',
      }),
    ).rejects.toThrow(/HTTP\(S\)/u)
    await expect(
      openVsCodeExtensionCardResource(vscode, {
        id: 'license-0',
        role: 'license',
        kind: 'file',
        target: 'relative/LICENSE',
      }),
    ).rejects.toThrow(/absolute/u)
    expect(calls).toEqual({ external: [], commands: [], files: [] })
  })
})
