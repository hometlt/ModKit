/**
 * The webview document: its content-security policy, its per-load nonce, and the inert snapshot
 * the page is allowed to see.
 *
 * Kept out of `./extension.ts` and free of the `vscode` module — the two things it needs from a
 * `Webview` (`cspSource` and `asWebviewUri`) are declared structurally — so the policy can be
 * asserted in Node. A CSP that is only exercised by launching an editor is a CSP nobody checks.
 *
 * The policy is the strict one this panel always had, plus exactly the two allowances the shipped
 * viewers need and `VIEWER_CSP` in `packages/ui` already carries: `blob:` in `img-src`, because the
 * vector stage renders its sanitised SVG through an `<img>` blob URL, and `blob:` in `media-src`,
 * because the audio and video stages hand the codec-owned encoded representation to the platform
 * player the same way. `data:` in `img-src` is what an embedded thumbnail needs. Nothing else is
 * relaxed: no remote origin, no `connect-src`, no inline style, no `style-src-attr`, and scripts
 * run only under this load's nonce.
 */

/** The two things this module needs from `vscode.Webview`. */
import type { UiCatalogDocument, UiLocale, UiLocalizer } from '@modkit/ui/localization'

import { createVscodeLocalizer } from './localization.js'

export interface WebviewLike {
  /** Origin the webview will load local resources from. */
  readonly cspSource: string
  /** Rewrites an extension-local path into a URI the page may fetch. */
  asWebviewUri(path: string): { toString(): string }
}

/** Everything the page is told, and nothing else. Inert data a bridge realm may hold. */
export interface PageBootstrap {
  /** Locale resolved by the extension host from VS Code's UI language. */
  readonly locale: UiLocale
  /** Validated, function-free catalogs loaded by the extension host through Extension Manager VFS. */
  readonly localizationCatalogs: readonly UiCatalogDocument[]
  readonly extensionHost: { readonly realmId: string; readonly facilities: readonly string[] }
  readonly webview: { readonly realmId: string; readonly facilities: readonly string[] }
  readonly topologyId: string
  readonly session: string
  readonly moduleUrl: string
  readonly contributionId: string
  readonly supportedExtensions: readonly string[]
  readonly extensions: unknown
  readonly diagnostics: number
  readonly openPath?: string
  /** Function-free extension/contribution subject cards for the generic subject-card renderer. */
  readonly extensionCard?: import('./extension-cards.js').ExtensionCardBundle
}

export interface PageOptions {
  readonly webview: WebviewLike
  readonly bootstrap: PageBootstrap
  /** A fresh nonce per load, so a cached script cannot be replayed. */
  readonly nonce: string
}

/** The policy as directives, so a test can read them one at a time. */
export function contentSecurityPolicy(cspSource: string, nonce: string): readonly string[] {
  return Object.freeze([
    "default-src 'none'",
    `style-src ${cspSource}`,
    "style-src-attr 'none'",
    `script-src 'nonce-${nonce}'`,
    `img-src ${cspSource} data: blob:`,
    `media-src ${cspSource} blob:`,
  ])
}

/**
 * `</script>` inside the serialised snapshot would close the element early, and an extension
 * coordinate or a failure message is attacker-influenced text. Escaping every `<` is the blunt
 * rule that cannot be got round; `&` and the ampersand-entity problem do not arise because the
 * value is read by the JavaScript parser, not the HTML entity parser.
 */
export function serializeBootstrap(bootstrap: PageBootstrap): string {
  return JSON.stringify(bootstrap).replace(/</gu, '\\u003c')
}

const escapeAttribute = (value: string): string =>
  value.replace(/[&<>"]/gu, character => {
    if (character === '&') return '&amp;'
    if (character === '<') return '&lt;'
    if (character === '>') return '&gt;'
    return '&quot;'
  })

export function pageHtml(options: PageOptions): string {
  const { webview, nonce } = options
  const script = webview.asWebviewUri('webview.js').toString()
  const shipped = webview.asWebviewUri('modkit-ui.css').toString()
  const chrome = webview.asWebviewUri('app.css').toString()
  const policy = contentSecurityPolicy(webview.cspSource, nonce).join('; ')

  return `<!doctype html>
<html lang="${escapeAttribute(options.bootstrap.locale)}" data-mk-theme="modkit-dark" data-mk-density="compact">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy};" />
    <link rel="stylesheet" href="${shipped}" />
    <link rel="stylesheet" href="${chrome}" />
    <title>Modkit</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">globalThis.__MODKIT_BOOTSTRAP__ = ${serializeBootstrap(options.bootstrap)}</script>
    <script nonce="${nonce}" type="module" src="${script}"></script>
  </body>
</html>`
}

const escapeText = (value: string): string =>
  value.replace(/[&<>]/gu, character =>
    character === '&' ? '&amp;' : character === '<' ? '&lt;' : '&gt;',
  )

/**
 * A page that will never work, said plainly, instead of an empty panel.
 *
 * It loads no script and no stylesheet at all, so it needs neither a nonce nor an origin — the
 * refusal is one sentence of text under `default-src 'none'`.
 */
export function refusalHtml(
  reason: string,
  localizer: UiLocalizer = createVscodeLocalizer('en'),
): string {
  return `<!doctype html>
<html lang="${escapeAttribute(localizer.locale)}">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none';" />
    <title>Modkit</title>
  </head>
  <body>
    <p>${escapeText(localizer.text('vscode.shell.cannotOpen', { reason }))}</p>
  </body>
</html>`
}
