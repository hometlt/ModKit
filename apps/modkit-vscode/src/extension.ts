/**
 * VS Code extension host entry.
 *
 * This file is the only place allowed to import `vscode`. The composition root (`./index.js`) stays
 * host-neutral so it can be unit tested and reused; everything here is the adapter that turns VS
 * Code's API into the facilities the root already describes.
 *
 * The webview never receives extension-host power. It gets a bridge realm profile and a strict CSP
 * with a per-load nonce, which is what keeps doc 19's rule — a webview is not an extension host —
 * true in the running product and not only in the topology.
 */
import * as vscode from 'vscode'

import { createVsCodeDesktopApp, type VsCodeApp } from './index.js'

const VIEW_TYPE = 'modkit.hostProfile'

/** Nonce for the webview CSP. A fresh one per load, so a cached script cannot be replayed. */
function nonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, app: VsCodeApp): string {
  const asset = (...parts: string[]): vscode.Uri =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...parts))
  const script = asset('dist-app', 'webview.js')
  const styles = asset('dist-app', 'modkit-ui.css')
  const value = nonce()

  // The realm snapshot is serialised into the page rather than fetched: the webview has no host
  // access, and this is exactly the data a bridge realm is allowed to see.
  const snapshot = JSON.stringify({
    extensionHost: {
      realmId: app.extensionHost.profile.realmId,
      facilities: app.extensionHost.profile.facilities,
    },
    webview: {
      realmId: app.webview.profile.realmId,
      facilities: app.webview.profile.facilities,
    },
    topologyId: app.topology.topologyId,
    diagnostics: app.extensionHost.inventory.diagnostics.length,
    extensions: app.extensionHost.inventory.extensions.length,
  }).replace(/</gu, '\\u003c')

  return `<!doctype html>
<html lang="en" data-mk-theme="modkit-dark" data-mk-density="compact">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${value}'; img-src ${webview.cspSource} data:;"
    />
    <link rel="stylesheet" href="${styles}" />
    <title>Modkit host profile</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${value}">globalThis.__MODKIT_SNAPSHOT__ = ${snapshot}</script>
    <script nonce="${value}" type="module" src="${script}"></script>
  </body>
</html>`
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Composed once at activation: the profile revision keys resolution caches, so recomposing per
  // command would silently invalidate them.
  const app = await createVsCodeDesktopApp()

  context.subscriptions.push(
    vscode.commands.registerCommand('modkit.showHostProfile', () => {
      const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'Modkit host profile',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          // Without this the webview may only load from the extension root; the bundle lives deeper.
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist-app')],
        },
      )
      panel.webview.html = webviewHtml(panel.webview, context.extensionUri, app)
    }),

    vscode.commands.registerCommand('modkit.explainResolution', () => {
      const lines = [
        `topology: ${app.topology.topologyId}`,
        `extension host: ${app.extensionHost.profile.realmId} — ${app.extensionHost.profile.facilities.length} facilities`,
        `webview: ${app.webview.profile.realmId} — ${app.webview.profile.facilities.length} facilities`,
        `extensions: ${app.extensionHost.inventory.extensions.length}`,
        `diagnostics: ${app.extensionHost.inventory.diagnostics.length}`,
      ]
      void vscode.window.showInformationMessage(lines.join(' · '), { modal: false })
    }),

    vscode.commands.registerCommand('modkit.openWith', () => {
      void vscode.window.showInformationMessage(
        'No codec extensions are installed in this host yet, so there is nothing to open with. ' +
          'An empty catalog is a valid state.',
      )
    }),
  )

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  status.text = `$(package) Modkit ${app.extensionHost.profile.facilities.length}`
  status.tooltip = `${app.extensionHost.profile.realmId} · ${app.extensionHost.inventory.extensions.length} extensions`
  status.command = 'modkit.showHostProfile'
  status.show()
  context.subscriptions.push(status)
}

export function deactivate(): void {
  // Nothing to tear down: every disposable is registered on the extension context.
}
