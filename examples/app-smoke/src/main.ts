/**
 * Browser-side application smoke.
 *
 * The Node roots (server, automation host, Electron main, VS Code extension host, CLI) are booted
 * by `scripts/verify-apps.mjs`; they import `@modkitx-x3/host/node` and have no meaning here.
 * This page covers the one application type whose facilities are decided by the browser itself:
 * `apps/web`. It boots the real root, so the numbers shown are this browser's actual capabilities.
 *
 * The root is imported by path rather than by package name: `examples/*` are not workspace members,
 * so only the packages linked at the repo root resolve by name. Same pattern the gallery uses.
 */
import { createWebApp, mountWebWorkbench, probeWebFacilities } from '../../../apps/web/src/index.js'
import { applyTheme } from '@modkitx-x3/ui/tokens'

const $ = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector)
  if (node === null) throw new Error(`missing element: ${selector}`)
  return node
}

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** The identity a real host adapter would supply; the browser does not report it portably. */
const identity = {
  operatingSystem: navigator.userAgent.includes('Windows') ? 'windows' : 'linux',
  architecture: 'x64',
} as const

async function boot(): Promise<void> {
  const probe = probeWebFacilities()
  const app = await createWebApp(identity, [], probe)

  // ------------------------------------------------------------ workbench
  mountWebWorkbench(document, $('#workbench'), app, 'Modkit MK3 — Web')

  const errors = app.main.inventory.diagnostics.filter(item => item.severity === 'error')
  $('#web-summary').textContent =
    `Booted ${app.topology.realms.length} realms from ${app.topology.topologyId} · ` +
    `${app.main.profile.facilities.length} main facilities · ` +
    `${app.worker.profile.facilities.length} worker facilities · ` +
    `${errors.length} error diagnostics · shared memory ${probe.sharedMemory ? 'yes' : 'no'}`

  // ------------------------------------------------------------ realm table
  const body = $('#realms')
  for (const [label, composition] of [
    ['main', app.main],
    ['worker', app.worker],
  ] as const) {
    const row = el('tr')
    const failures = composition.inventory.diagnostics.filter(item => item.severity === 'error')
    row.append(
      el('td', undefined, `${label} — ${composition.profile.realmId}`),
      el('td', undefined, composition.profile.target.environment),
      el('td', undefined, String(composition.profile.facilities.length)),
      el('td', undefined, String(composition.inventory.extensions.length)),
      el('td', failures.length === 0 ? 'ok' : 'bad', String(failures.length)),
    )
    body.append(row)
  }

  // ------------------------------------------------------------ facilities
  const facilities = $('#facilities')
  const all = [...new Set([...probe.main, ...probe.worker])].sort()
  if (all.length === 0) facilities.append(el('span', 'muted', 'No facilities probed as available.'))
  for (const facility of all) {
    const realms = [
      probe.main.includes(facility) ? 'main' : '',
      probe.worker.includes(facility) ? 'worker' : '',
    ]
      .filter(Boolean)
      .join(' + ')
    facilities.append(el('span', 'pill', `${facility} · ${realms}`))
  }

  // ------------------------------------------------------------ isolation
  const has = (composition: typeof app.main, facility: string): boolean =>
    (composition.profile.facilities as readonly string[]).includes(facility)

  const claims: readonly (readonly [string, boolean])[] = [
    ['browser main realm never loads native code', !has(app.main, 'native.load')],
    ['browser main realm never launches a process', !has(app.main, 'process.launch')],
    ['browser main realm never gets the native editor', !has(app.main, 'editor.host-native')],
    ['worker realm never gets a file picker', !has(app.worker, 'dialog.file-picker')],
    ['worker realm never spawns further workers', app.worker.profile.budgets.maxWorkerCount === 0],
    ['both realms boot with an empty catalog', app.main.inventory.extensions.length === 0],
    ['main and worker are linked in both directions', app.topology.links.length === 2],
  ]
  const list = $('#claims')
  for (const [claim, held] of claims) {
    list.append(el('li', held ? 'ok' : 'bad', `${held ? '✓' : '✗'} ${claim}`))
  }
}

$('#theme').addEventListener('change', event => {
  applyTheme(document.documentElement, (event.target as HTMLSelectElement).value as never)
})

boot().catch((error: unknown) => {
  $('#web-summary').textContent =
    `Boot FAILED: ${error instanceof Error ? error.message : String(error)}`
  $('#web-summary').className = 'bad'
})
