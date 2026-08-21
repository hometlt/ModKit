#!/usr/bin/env node

import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { extensionDirectory, extensionSet } from '../app-extension-sets.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? fallback : process.argv[index + 1]
}

const application = option('app', process.env['MODKIT_APP'] ?? 'headless')
const setName = option('set', process.env['MODKIT_EXTENSION_SET'] ?? 'full-codecs')
const stayOpen = process.argv.includes('--stay-open')

const [{ loadExtensionDirectory }, { offersFromInventory }] = await Promise.all([
  import('../../packages/host/dist/node/index.js'),
  import('../../packages/host/dist/index.js'),
])

const extensions = await Promise.all(
  extensionSet(setName).map(directory =>
    loadExtensionDirectory(join(root, 'extensions', ...extensionDirectory(directory))),
  ),
)

async function createApplication(name) {
  switch (name) {
    case 'headless': {
      const { createAutomationHost } = await import('../../apps/automation-host/dist/index.js')
      const host = await createAutomationHost(extensions)
      return { application: host, realms: { main: host.composition } }
    }
    case 'electron': {
      const { createElectronApp } = await import('../../apps/electron/dist/index.js')
      const app = await createElectronApp(extensions)
      return { application: app, realms: { main: app.main, renderer: app.renderer } }
    }
    case 'vscode': {
      const { createVsCodeDesktopApp } = await import('../../apps/modkit-vscode/dist/index.js')
      const app = await createVsCodeDesktopApp(extensions)
      return {
        application: app,
        realms: { extensionHost: app.extensionHost, webview: app.webview },
      }
    }
    case 'web': {
      const { createWebApp } = await import('../../apps/web/dist/index.js')
      const app = await createWebApp(
        { operatingSystem: 'linux', architecture: 'x64' },
        extensions,
        {
          main: ['editor.monaco', 'worker.module'],
          worker: [],
          sharedMemory: false,
        },
      )
      return { application: app, realms: { main: app.main, worker: app.worker } }
    }
    default:
      throw new Error(`unknown debug application: ${name}`)
  }
}

const debugApplication = await createApplication(application)
const rows = Object.entries(debugApplication.realms).map(([realm, composition]) => ({
  application,
  realm,
  environment: composition.target.environment,
  extensions: composition.inventory.extensions.length,
  contributions: composition.inventory.extensions.reduce(
    (count, extension) => count + extension.contributions.length,
    0,
  ),
  offers: offersFromInventory(composition.inventory).length,
  diagnostics:
    composition.inventory.diagnostics.length +
    composition.inventory.extensions.reduce(
      (count, extension) =>
        count +
        extension.contributions.reduce(
          (local, contribution) => local + contribution.diagnostics.length,
          0,
        ),
      0,
    ),
}))

Object.defineProperty(globalThis, 'modkitDebug', {
  configurable: false,
  enumerable: true,
  value: Object.freeze({
    application,
    extensionSet: setName,
    extensions,
    ...debugApplication,
  }),
})

console.table(rows)
console.log(
  `modkit-debug: ${application}/${setName} ready; inspect globalThis.modkitDebug in the debug console`,
)
if (application === 'electron' || application === 'vscode') {
  console.log(
    `modkit-debug: ${application} currently runs its X3 composition adapter, not a packaged executable process`,
  )
}

if (stayOpen) {
  console.log('modkit-debug: waiting for debugger; stop the VS Code debug session to exit')
  await new Promise(resolve => {
    const finish = () => resolve()
    process.once('SIGINT', finish)
    process.once('SIGTERM', finish)
  })
}
