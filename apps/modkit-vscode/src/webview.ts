/**
 * Webview bundle — the bridge realm's UI.
 *
 * It has no host access and imports no composition root: the extension host serialises the realm
 * snapshot into the page, and this renders it with the shipped workbench. That asymmetry is the
 * point — if this file could compose a host, the webview would have become an extension host.
 */
import { createWorkbench } from '@modkitx-x3/ui/workbench'

interface RealmSnapshot {
  readonly realmId: string
  readonly facilities: readonly string[]
}

interface Snapshot {
  readonly extensionHost: RealmSnapshot
  readonly webview: RealmSnapshot
  readonly topologyId: string
  readonly diagnostics: number
  readonly extensions: number
}

const snapshot = (globalThis as { __MODKIT_SNAPSHOT__?: Snapshot }).__MODKIT_SNAPSHOT__
const root = document.querySelector('#root')
if (root === null) throw new Error('missing #root')

if (snapshot === undefined) {
  root.textContent = 'No host snapshot was provided by the extension host.'
} else {
  const workbench = createWorkbench(document, {
    title: 'Modkit host profile',
    host: {
      label: snapshot.webview.realmId,
      facilities: snapshot.webview.facilities,
    },
  })
  root.replaceChildren(workbench.root)

  const table = document.createElement('table')
  table.className = 'realm-table'
  const header = document.createElement('tr')
  for (const label of ['Realm', 'Facilities', 'Detail']) {
    const cell = document.createElement('th')
    cell.textContent = label
    header.append(cell)
  }
  table.append(header)

  for (const [label, realm] of [
    ['extension host', snapshot.extensionHost],
    ['webview (this page)', snapshot.webview],
  ] as const) {
    const row = document.createElement('tr')
    const name = document.createElement('td')
    name.textContent = label
    const count = document.createElement('td')
    count.textContent = String(realm.facilities.length)
    const detail = document.createElement('td')
    detail.textContent = realm.facilities.join(', ') || '—'
    row.append(name, count, detail)
    table.append(row)
  }

  const summary = document.createElement('p')
  summary.textContent = `${snapshot.topologyId} · ${snapshot.extensions} extensions · ${snapshot.diagnostics} diagnostics`

  const isolated = !snapshot.webview.facilities.includes('editor.host-native')
  const claim = document.createElement('p')
  claim.textContent = isolated
    ? '✓ The webview realm holds no extension-host facility.'
    : '✗ The webview realm was granted an extension-host facility.'

  const panel = document.createElement('div')
  panel.append(summary, table, claim)
  workbench.setMain(panel)
}
