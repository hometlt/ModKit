/** The webview page: its document, its CSP nonce and the snapshot cut from the composed host. */
import * as vscode from 'vscode'
import { type UiCatalogDocument, type UiLocale } from '@modkit/ui/localization'

import { type ModkitAcceptanceReceipt } from './acceptance.js'
import {
  VSCODE_SUBJECT_CONTRIBUTION_ID,
  VSCODE_SUBJECT_SERVICES_URL,
  type VsCodeSubjectHost,
} from './host.js'
import { pageHtml, type WebviewLike } from './page.js'

/** Nonce for the webview CSP. A fresh one per load, so a cached script cannot be replayed. */
export function nonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------------------------
// the page

export interface PanelPageOptions {
  readonly webview: vscode.Webview
  readonly extensionUri: vscode.Uri
  readonly host: VsCodeSubjectHost
  readonly session: string
  readonly locale: UiLocale
  readonly localizationCatalogs: readonly UiCatalogDocument[]
  readonly acceptance: ModkitAcceptanceReceipt
  readonly openPath?: string
  /** The one stage a stage-specific native editor raised this page for. */
  readonly forcedStage?: string
  readonly extensionCard?: import('./extension-cards.js').ExtensionCardBundle
  /** Lower-case extensions the explorer's gallery draws, from the enabled image codecs. */
  readonly galleryExtensions?: readonly string[]
  /** Raised as a Modkit Explorer over one folder rather than for a subject. */
  readonly explorer?: { readonly label: string }
}

/**
 * Build the page. The document, its policy and its nonce live in `./page.ts`; what this adds is
 * the editor's own URI rewriting and the snapshot cut from the composed host.
 */
export function panelHtml(options: PanelPageOptions): string {
  const { webview, extensionUri } = options
  const asset: WebviewLike = {
    cspSource: webview.cspSource,
    asWebviewUri: name => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist-app', name)),
  }
  return pageHtml({
    webview: asset,
    nonce: nonce(),
    /*
     * Inert data a bridge realm is allowed to see, serialised into the page rather than fetched:
     * the webview has no host access, and this is exactly what it may know about the realms it
     * sits between.
     */
    bootstrap: {
      locale: options.locale,
      localizationCatalogs: options.localizationCatalogs,
      extensionHost: {
        realmId: options.host.services.host.profile.realmId,
        facilities: options.host.services.host.profile.facilities,
      },
      webview: {
        realmId: options.host.webview.profile.realmId,
        facilities: options.host.webview.profile.facilities,
      },
      ...(options.host.webviewRenderer === undefined
        ? {}
        : { renderer: options.host.webviewRenderer }),
      topologyId: options.host.services.host.topology.topologyId,
      session: options.session,
      moduleUrl: VSCODE_SUBJECT_SERVICES_URL,
      contributionId: VSCODE_SUBJECT_CONTRIBUTION_ID,
      supportedExtensions: options.host.supportedExtensions,
      extensions: options.host.extensions,
      diagnostics: options.host.services.host.inventory.diagnostics.length,
      acceptance: options.acceptance,
      ...(options.openPath === undefined ? {} : { openPath: options.openPath }),
      ...(options.forcedStage === undefined ? {} : { forcedStage: options.forcedStage }),
      ...(options.extensionCard === undefined ? {} : { extensionCard: options.extensionCard }),
      ...(options.galleryExtensions === undefined
        ? {}
        : { galleryExtensions: options.galleryExtensions }),
      ...(options.explorer === undefined ? {} : { explorer: options.explorer }),
      showHiddenEntries:
        vscode.workspace.getConfiguration('modkit').get<boolean>('showHiddenEntries') === true,
    },
  })
}
