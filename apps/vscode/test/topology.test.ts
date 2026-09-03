import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { sceneModule } from '@modkit/scene/module'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
} from '@modkit/host'
import { selectSceneRenderer } from '@modkit/host/renderer'
import {
  createVsCodeDesktopApp,
  createVsCodeDesktopTopology,
  VSCODE_DESKTOP_EXTENSION_REALM,
  VSCODE_DESKTOP_WORKER_REALM,
  VSCODE_WEBVIEW_REALM,
  VSCODE_WORKER_POLICY,
} from '../src/index.js'
import { createWebviewRendererPort } from '../src/renderer-port.js'

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

  /**
   * The renderer decision the page is told about, taken on the side that holds the inventory.
   *
   * This is the whole reason the webview realm is composed at all: it declares `gpu.webgl2`, so
   * the standard resolver selects the WebGL provider *for that realm* while running inside Node,
   * where that provider could never draw. The page is then handed the id and instantiates the
   * provider out of its own bundle.
   */
  it('selects the WebGL2 scene renderer for the webview realm without activating it', async () => {
    const topology = createVsCodeDesktopTopology()
    const linked = linkedExtensionInputs([sceneModule])
    const executionBackends = createExecutionBackendRegistry([
      linkedInProcessBackend(linked.modules),
    ])
    const webview = await createHostComposition({
      topology,
      realmId: VSCODE_WEBVIEW_REALM,
      extensions: linked.inputs,
      executionBackends,
    })
    const definitions = createBundledServiceDefinitionRegistry()
    await registerServiceDefinitionsOrThrow(webview.inventory, definitions)
    const selection = await selectSceneRenderer({
      services: {
        inventory: webview.inventory,
        target: webview.target,
        executionBackends,
        serviceDefinitions: definitions,
      },
      outputKind: 'rgba8',
      grant: { id: 'vscode-webview-renderer-test', classes: [] },
    })
    expect(selection.state, JSON.stringify(selection.diagnostics)).toBe('selected')
    if (selection.state !== 'selected') throw new Error('webview realm selected no renderer')
    expect(selection.selection.rendererIds).toContain('modkit.browser-webgl')
    expect(selection.selection.runtimeVariant).toBe('trusted-browser-main')
    // the id the page's closed provider table is keyed by
    expect(createWebviewRendererPort(selection.selection)).toBeDefined()
  })

  it('keeps the CASC operational worker allowance explicitly bounded', () => {
    // This is an execution resource ceiling for the already-existing node-worker realm, not a
    // facility or capability grant. It accommodates the measured SC2 immutable name index while
    // staying below the platform worker-policy ceiling (4 GiB old / 512 MiB young).
    expect(VSCODE_WORKER_POLICY.resourceLimits).toMatchObject({
      maxOldGenerationSizeMb: 896,
      maxYoungGenerationSizeMb: 112,
    })
    expect(VSCODE_WORKER_POLICY.resourceLimits.maxOldGenerationSizeMb).toBeLessThanOrEqual(4096)
    expect(VSCODE_WORKER_POLICY.resourceLimits.maxYoungGenerationSizeMb).toBeLessThanOrEqual(512)
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
