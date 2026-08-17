/**
 * Browser entry point for the PWA.
 *
 * The composition root (`./index.js`) stays free of DOM and bootstrap concerns so it can be unit
 * tested and reused by a different shell; this file is the part that only makes sense in a page.
 */
import { createWebApp, mountWebWorkbench, probeWebFacilities } from './index.js'

function requireRoot(): Element {
  const node = document.querySelector('#root')
  if (node === null) throw new Error('missing #root')
  return node
}

/** The browser does not report OS/arch portably; a real host adapter supplies this. */
function identity(): { operatingSystem: 'windows' | 'darwin' | 'linux'; architecture: 'x64' } {
  const agent = navigator.userAgent
  // `darwin`, not `macos`: the wire vocabulary is the platform name, not the product name.
  const operatingSystem = agent.includes('Windows')
    ? 'windows'
    : agent.includes('Mac')
      ? 'darwin'
      : 'linux'
  return { operatingSystem, architecture: 'x64' }
}

async function boot(): Promise<void> {
  const probe = probeWebFacilities()
  const app = await createWebApp(identity(), [], probe)
  const workbench = mountWebWorkbench(document, requireRoot(), app, 'Modkit MK3')

  const summary = document.createElement('div')
  summary.className = 'boot-summary'
  const errors = app.main.inventory.diagnostics.filter(item => item.severity === 'error')
  summary.textContent =
    `${app.topology.realms.length} realms · ` +
    `main ${app.main.profile.facilities.length} facilities · ` +
    `worker ${app.worker.profile.facilities.length} facilities · ` +
    `${app.main.inventory.extensions.length} extensions · ` +
    `${errors.length} errors · shared memory ${probe.sharedMemory ? 'yes' : 'no'}`

  const facilities = document.createElement('ul')
  facilities.className = 'facility-list'
  for (const facility of app.main.profile.facilities) {
    const item = document.createElement('li')
    item.textContent = facility
    facilities.append(item)
  }

  const panel = document.createElement('div')
  panel.className = 'boot-panel'
  panel.append(summary, facilities)
  workbench.setSidebar(panel)

  const empty = document.createElement('p')
  empty.className = 'placeholder'
  empty.textContent =
    'No extensions installed. An empty catalog is a valid state — open a subject once a codec ' +
    'extension is contributed to this host.'
  workbench.setMain(empty)
}

// Registered after boot so a service-worker failure can never block the app from starting.
async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('./service-worker.js', { scope: './' })
  } catch (error) {
    console.warn('service worker registration failed', error)
  }
}

boot()
  .then(registerServiceWorker)
  .catch((error: unknown) => {
    const node = requireRoot()
    node.replaceChildren()
    const failure = document.createElement('p')
    failure.className = 'booting'
    failure.textContent = `Boot failed: ${error instanceof Error ? error.message : String(error)}`
    node.append(failure)
  })
