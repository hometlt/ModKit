import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  createVsCodeDesktopApp,
  createVsCodeDesktopTopology,
  VSCODE_DESKTOP_EXTENSION_REALM,
  VSCODE_DESKTOP_WORKER_REALM,
} from '../src/index.js'

describe('VS Code composition topology', () => {
  it('keeps native editor and process facilities outside the webview realm', async () => {
    const app = await createVsCodeDesktopApp()
    expect(app.extensionHost.profile.facilities).toContain('editor.host-native')
    expect(app.extensionHost.profile.facilities).toContain('process.launch')
    expect(app.webview.profile.facilities).not.toContain('editor.host-native')
    expect(app.webview.profile.facilities).not.toContain('process.launch')
  })

  it('carries a node-worker realm codecs can be activated for, with no facilities of its own', () => {
    const topology = createVsCodeDesktopTopology()
    const worker = topology.realms.find(realm => realm.realmId === VSCODE_DESKTOP_WORKER_REALM)
    expect(worker).toBeDefined()
    expect(worker?.target.environment).toBe('node-worker')
    // a worker owns no ambient facility; what it gets, it gets brokered from the host realm
    expect(worker?.facilities).toEqual([])
    const links = topology.links.filter(
      link =>
        (link.fromRealm === VSCODE_DESKTOP_EXTENSION_REALM &&
          link.toRealm === VSCODE_DESKTOP_WORKER_REALM) ||
        (link.fromRealm === VSCODE_DESKTOP_WORKER_REALM &&
          link.toRealm === VSCODE_DESKTOP_EXTENSION_REALM),
    )
    expect(links.length).toBe(2)
  })

  it('leaves the two-realm application shape the apps gate inspects unchanged', async () => {
    const app = await createVsCodeDesktopApp()
    expect(Object.keys(app).sort()).toEqual(['extensionHost', 'topology', 'webview'])
  })

  it('ships only generic static contribution points and no Monaco binding', async () => {
    const generated = await readFile(
      new URL('../contributes.generated.json', import.meta.url),
      'utf8',
    )
    expect(generated).toContain('modkit.genericAssetPreview')
    expect(generated.toLowerCase()).not.toContain('monaco')
  })
})
