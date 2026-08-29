#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_EXTENSION_SETS,
  READY_APP_EXTENSIONS,
  expectedContributionIds,
  expectedExtensionCoordinates,
  extensionLocation,
  extensionSet,
} from './app-extension-sets.mjs'
import { checkAppContractMatrix } from './check-app-contract-matrix.mjs'
import { resolveExternalExtensionDirectory } from './lib/external-extension-roots.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

const extensionPath = name => {
  const location = extensionLocation(name)
  return location.kind === 'internal'
    ? join(root, 'extensions', ...location.path)
    : resolveExternalExtensionDirectory(root, location)
}

const [{ createServerApp }, { createAutomationHost }, electron, vscode, web, cli] =
  await Promise.all([
    import('../apps/server/dist/index.js'),
    import('../apps/automation-host/dist/index.js'),
    import('../apps/electron/dist/index.js'),
    import('../apps/modkit-vscode/dist/index.js'),
    import('../apps/web/dist/index.js'),
    import('../apps/modkit-cli/dist/profile.js'),
  ])
const [{ loadExtensionDirectory }, { inventoryHasErrors, offersFromInventory, resolveProvider }] =
  await Promise.all([
    import('../packages/host/dist/node/index.js'),
    import('../packages/host/dist/index.js'),
  ])

const coordinate = extension => `${extension.manifest.publisher}/${extension.manifest.id}`
const contributionIds = inventory =>
  inventory.extensions
    .flatMap(extension =>
      extension.contributions.flatMap(contribution =>
        contribution.manifest === undefined ? [] : [contribution.manifest.id],
      ),
    )
    .toSorted()

function assertExactInventory(label, setName, composition) {
  const inventory = composition.inventory
  const actualCoordinates = inventory.extensions.map(coordinate).toSorted()
  const expectedCoordinates = expectedExtensionCoordinates(setName)
  if (JSON.stringify(actualCoordinates) !== JSON.stringify(expectedCoordinates)) {
    throw new Error(
      `apps:check: ${label}/${setName} extension isolation failed: ${JSON.stringify(actualCoordinates)}`,
    )
  }
  const actualContributions = contributionIds(inventory)
  const expectedContributions = expectedContributionIds(setName)
  if (JSON.stringify(actualContributions) !== JSON.stringify(expectedContributions)) {
    throw new Error(
      `apps:check: ${label}/${setName} contribution isolation failed: ${JSON.stringify(actualContributions)}`,
    )
  }
  if (inventoryHasErrors(inventory)) {
    throw new Error(`apps:check: ${label}/${setName} inventory contains errors`)
  }
  const ineligible = inventory.extensions.flatMap(extension =>
    extension.contributions.filter(contribution => !contribution.inventoryEligible),
  )
  if (ineligible.length > 0) {
    throw new Error(`apps:check: ${label}/${setName} contains ineligible contributions`)
  }
  return Object.freeze({
    extensions: actualCoordinates.length,
    contributions: actualContributions.length,
    offers: offersFromInventory(inventory).length,
  })
}

function offerResolvesForTarget(offer, target) {
  return offer.provides.some(contract => {
    const result = resolveProvider(
      {
        contract: {
          contract: contract.contract,
          major: contract.major,
          range: contract.version,
        },
        target: { ...target, grantedPermissions: offer.requiredPermissions },
        requiredOutputs: [],
        preferredOutputs: [],
        pin: {
          providerId: offer.providerId,
          runtimeVariant: offer.runtimeVariant,
          offerId: contract.offerId,
        },
      },
      [offer],
    )
    return result.state === 'resolved'
  })
}

function compatibleOfferCount(composition) {
  return offersFromInventory(composition.inventory).filter(offer =>
    offerResolvesForTarget(offer, composition.target),
  ).length
}

const includesAll = (required = [], actual = []) => required.every(value => actual.includes(value))

function variantMatchesTarget(variant, target) {
  const constraint = variant.target
  return (
    (constraint.environments === undefined ||
      constraint.environments.includes(target.environment)) &&
    (constraint.operatingSystems === undefined ||
      constraint.operatingSystems.includes('any') ||
      constraint.operatingSystems.includes(target.operatingSystem)) &&
    (constraint.architectures === undefined ||
      constraint.architectures.includes('any') ||
      constraint.architectures.includes(target.architecture)) &&
    includesAll(constraint.requiredHostCapabilities, target.hostCapabilities) &&
    includesAll(constraint.requiredWebApis, target.webApis) &&
    includesAll(constraint.externalTools, target.externalTools)
  )
}

function compatibleContributionCount(composition) {
  return composition.inventory.extensions.reduce(
    (count, extension) =>
      count +
      extension.contributions.filter(
        contribution =>
          contribution.activationEligible &&
          contribution.manifest?.runtimeVariants.some(variant =>
            variantMatchesTarget(variant, composition.target),
          ),
      ).length,
    0,
  )
}

const inputByDirectory = new Map(
  await Promise.all(
    Object.keys(READY_APP_EXTENSIONS).map(async directory => [
      directory,
      await loadExtensionDirectory(extensionPath(directory)),
    ]),
  ),
)
const inputsFor = name => extensionSet(name).map(directory => inputByDirectory.get(directory))
const matrixRows = []

async function checkApplicationSet(application, setName, create, realmExpectations) {
  const realms = await create(inputsFor(setName))
  for (const [realm, composition] of Object.entries(realms)) {
    const inventory = assertExactInventory(`${application}/${realm}`, setName, composition)
    const compatible = compatibleOfferCount(composition)
    const active = compatibleContributionCount(composition)
    const expectation = realmExpectations[realm]
    const expectedOffers = expectation?.offers
    const expectedActive = expectation?.active
    if (expectedOffers === 'all' && compatible !== inventory.offers) {
      throw new Error(
        `apps:check: ${application}/${realm}/${setName} resolves ${compatible}/${inventory.offers} offers`,
      )
    }
    if (expectedOffers === 'none' && compatible !== 0) {
      throw new Error(
        `apps:check: ${application}/${realm}/${setName} unexpectedly resolves ${compatible} offers`,
      )
    }
    if (typeof expectedOffers === 'number' && compatible !== expectedOffers) {
      throw new Error(
        `apps:check: ${application}/${realm}/${setName} resolves ${compatible} offers; expected ${expectedOffers}`,
      )
    }
    if (expectedActive === 'all' && active !== inventory.contributions) {
      throw new Error(
        `apps:check: ${application}/${realm}/${setName} activates ${active}/${inventory.contributions} contributions`,
      )
    }
    if (expectedActive === 'none' && active !== 0) {
      throw new Error(
        `apps:check: ${application}/${realm}/${setName} unexpectedly activates ${active} contributions`,
      )
    }
    if (typeof expectedActive === 'number' && active !== expectedActive) {
      throw new Error(
        `apps:check: ${application}/${realm}/${setName} activates ${active} contributions; expected ${expectedActive}`,
      )
    }
    matrixRows.push({
      application,
      realm,
      set: setName,
      ...inventory,
      compatible,
      active,
    })
  }
}

const server = await createServerApp()
if (server.health().status !== 'ok' || server.composition.inventory.extensions.length !== 0) {
  throw new Error('apps:check: empty server composition did not start cleanly')
}

const automation = await createAutomationHost()
if (automation.describeHost().contributions.length !== 0) {
  throw new Error('apps:check: empty automation host unexpectedly contains contributions')
}

const electronApp = await electron.createElectronApp()
if (
  electronApp.renderer.profile.facilities.includes('process.launch') ||
  electronApp.renderer.profile.facilities.includes('native.load')
) {
  throw new Error('apps:check: Electron renderer leaked main-process facilities')
}
if (
  electron.ELECTRON_SECURE_WEB_PREFERENCES.nodeIntegration !== false ||
  electron.ELECTRON_SECURE_WEB_PREFERENCES.contextIsolation !== true ||
  electron.ELECTRON_SECURE_WEB_PREFERENCES.sandbox !== true
) {
  throw new Error('apps:check: Electron security defaults regressed')
}

const vscodeApp = await vscode.createVsCodeDesktopApp()
if (
  vscodeApp.webview.profile.facilities.includes('editor.host-native') ||
  vscodeApp.webview.profile.facilities.includes('process.launch')
) {
  throw new Error('apps:check: VS Code webview leaked extension-host facilities')
}

const webTopology = web.createWebTopology(
  { operatingSystem: 'linux', architecture: 'x64' },
  { main: ['worker.module'], worker: [], sharedMemory: false },
)
if (webTopology.realms.some(realm => realm.facilities.includes('process.launch'))) {
  throw new Error('apps:check: web profile claims native process access')
}

await checkApplicationSet(
  'headless',
  'structured-text',
  async extensions => ({ main: (await createAutomationHost(extensions)).composition }),
  { main: { offers: 16, active: 16 } },
)
await checkApplicationSet(
  'cli',
  'mk2-extended',
  async extensions => ({ main: await cli.createModkitCliComposition(extensions) }),
  { main: { offers: 97, active: 97 } },
)
await checkApplicationSet(
  'headless',
  'full-codecs',
  async extensions => ({ main: (await createAutomationHost(extensions)).composition }),
  { main: { offers: 85, active: 85 } },
)
await checkApplicationSet(
  'headless',
  'blizzard-models',
  async extensions => ({ main: (await createAutomationHost(extensions)).composition }),
  { main: { offers: 2, active: 2 } },
)
await checkApplicationSet(
  'headless',
  'mk2-extended',
  async extensions => ({ main: (await createAutomationHost(extensions)).composition }),
  { main: { offers: 97, active: 97 } },
)
await checkApplicationSet(
  'pwa',
  'structured-text',
  async extensions => {
    const app = await web.createWebApp(
      { operatingSystem: 'linux', architecture: 'x64' },
      extensions,
      { main: ['worker.module'], worker: [], sharedMemory: false },
    )
    return { main: app.main, worker: app.worker }
  },
  {
    main: { offers: 'none', active: 'none' },
    // 16 codecs and syntax providers + the six text writers (A6, one per extension)
    worker: { offers: 22, active: 22 },
  },
)
await checkApplicationSet(
  'pwa',
  'media',
  async extensions => {
    const app = await web.createWebApp(
      { operatingSystem: 'linux', architecture: 'x64' },
      extensions,
      { main: ['worker.module'], worker: [], sharedMemory: false },
    )
    return { main: app.main, worker: app.worker }
  },
  {
    main: { offers: 'none', active: 'none' },
    // 7 codecs + the PNG encoder writer provider (A5, browser-worker variant)
    worker: { offers: 38, active: 38 },
  },
)
await checkApplicationSet(
  'pwa',
  'mk2-extended',
  async extensions => {
    const app = await web.createWebApp(
      { operatingSystem: 'linux', architecture: 'x64' },
      extensions,
      { main: ['worker.module'], worker: [], sharedMemory: false },
    )
    return { main: app.main, worker: app.worker }
  },
  {
    main: { offers: 'none', active: 'none' },
    // The Warzone WZ writer is worker-brokered; the SC2 playable runtime remains trusted-node.
    worker: { offers: 98, active: 98 },
  },
)
await checkApplicationSet(
  'pwa',
  'editor-and-documents',
  async extensions => {
    const app = await web.createWebApp(
      { operatingSystem: 'linux', architecture: 'x64' },
      extensions,
      { main: ['editor.monaco', 'worker.module'], worker: [], sharedMemory: false },
    )
    return { main: app.main, worker: app.worker }
  },
  {
    main: { offers: 'none', active: 1 },
    // + the text-json writer (A6)
    worker: { offers: 11, active: 11 },
  },
)
await checkApplicationSet(
  'vscode',
  'documents',
  async extensions => {
    const app = await vscode.createVsCodeDesktopApp(extensions)
    return { extensionHost: app.extensionHost, webview: app.webview }
  },
  {
    extensionHost: { offers: 6, active: 6 },
    webview: { offers: 'none', active: 'none' },
  },
)
await checkApplicationSet(
  'vscode',
  'media',
  async extensions => {
    const app = await vscode.createVsCodeDesktopApp(extensions)
    return { extensionHost: app.extensionHost, webview: app.webview }
  },
  {
    extensionHost: { offers: 37, active: 37 },
    webview: { offers: 'none', active: 'none' },
  },
)
await checkApplicationSet(
  'vscode',
  'mk2-extended',
  async extensions => {
    const app = await vscode.createVsCodeDesktopApp(extensions)
    return { extensionHost: app.extensionHost, webview: app.webview }
  },
  {
    extensionHost: { offers: 97, active: 97 },
    webview: { offers: 'none', active: 'none' },
  },
)
await checkApplicationSet(
  'electron',
  'models-and-archives',
  async extensions => {
    const app = await electron.createElectronApp(extensions)
    return { main: app.main, renderer: app.renderer }
  },
  {
    main: { offers: 22, active: 22 },
    renderer: { offers: 'none', active: 'none' },
  },
)
await checkApplicationSet(
  'electron',
  'full-codecs',
  async extensions => {
    const app = await electron.createElectronApp(extensions)
    return { main: app.main, renderer: app.renderer }
  },
  {
    main: { offers: 85, active: 85 },
    renderer: { offers: 'none', active: 'none' },
  },
)
await checkApplicationSet(
  'electron',
  'mk2-extended',
  async extensions => {
    const app = await electron.createElectronApp(extensions)
    return { main: app.main, renderer: app.renderer }
  },
  {
    main: { offers: 97, active: 97 },
    renderer: { offers: 'none', active: 'none' },
  },
)

if (
  new Set(Object.values(APP_EXTENSION_SETS).flat()).size !==
  Object.keys(READY_APP_EXTENSIONS).length
) {
  throw new Error('apps:check: ready extension catalog is not fully covered by the matrix')
}

const pwaManifest = JSON.parse(
  await readFile(new URL('../apps/web/public/manifest.webmanifest', import.meta.url), 'utf8'),
)
const serviceWorkerSource = await readFile(
  new URL('../apps/web/public/service-worker.js', import.meta.url),
  'utf8',
)
if (
  pwaManifest.display !== 'standalone' ||
  typeof pwaManifest.start_url !== 'string' ||
  !['install', 'activate', 'fetch'].every(event =>
    serviceWorkerSource.includes(`addEventListener('${event}'`),
  )
) {
  throw new Error('apps:check: PWA manifest/service-worker contract is incomplete')
}

const serverSource = await readFile(new URL('../apps/server/src/index.ts', import.meta.url), 'utf8')
const automationSource = await readFile(
  new URL('../apps/automation-host/src/index.ts', import.meta.url),
  'utf8',
)
if (/\@modkitx-x3\/ui|\bDocument\b|\bHTMLElement\b/.test(`${serverSource}\n${automationSource}`)) {
  throw new Error('apps:check: headless composition imports viewer/workbench concerns')
}

execFileSync(process.execPath, ['apps/modkit-vscode/scripts/generate-contributes.mjs', '--check'], {
  cwd: root,
  stdio: 'inherit',
})

await checkAppContractMatrix()

console.table(matrixRows)
console.log(
  `apps:check: ${matrixRows.length} extension-set/realm cases conform across CLI, headless, PWA, Electron and VS Code adapters`,
)
