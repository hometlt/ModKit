/**
 * The webview document and its content-security policy.
 *
 * Asserted here rather than by launching an editor, because a policy nobody can check is a policy
 * that drifts. What this cannot prove is that VS Code's own webview then honours it — that needs a
 * real editor.
 */
import { describe, expect, it } from 'vitest'
import {
  contentSecurityPolicy,
  pageHtml,
  refusalHtml,
  serializeBootstrap,
  type PageBootstrap,
  type WebviewLike,
} from '../src/page.js'
import { VIEWER_CSP } from '@modkitx-x3/ui'
import { createVscodeLocalizer } from '../src/localization.js'

const webview: WebviewLike = {
  cspSource: 'vscode-resource://modkitx.modkit',
  asWebviewUri: name => ({ toString: () => `vscode-resource://modkitx.modkit/dist-app/${name}` }),
}

const bootstrap: PageBootstrap = {
  locale: 'en',
  extensionHost: {
    realmId: 'org.modkitx.app.vscode/desktop-extension',
    facilities: ['native.load'],
  },
  webview: { realmId: 'org.modkitx.app.vscode/webview', facilities: ['gpu.webgl2'] },
  topologyId: 'org.modkitx.app/vscode-desktop',
  session: 'vscode-abc',
  moduleUrl: 'x3-app://vscode/subject-services',
  contributionId: 'org.modkitx.app.vscode/subject-services',
  supportedExtensions: ['json'],
  extensions: { bundled: [], installed: [], failures: [], problems: [] },
  diagnostics: 0,
}

describe('webview content-security policy', () => {
  it('runs scripts only under this load nonce and forbids everything by default', () => {
    const directives = contentSecurityPolicy(webview.cspSource, 'deadbeef')
    expect(directives).toContain("default-src 'none'")
    expect(directives).toContain("script-src 'nonce-deadbeef'")
    expect(directives).not.toContain("script-src 'self'")
    expect(directives.some(directive => directive.includes('unsafe-inline'))).toBe(false)
    expect(directives.some(directive => directive.includes('unsafe-eval'))).toBe(false)
  })

  it('adds exactly the two allowances the shipped viewers need, and nothing else', () => {
    const directives = contentSecurityPolicy(webview.cspSource, 'n')
    // the vector stage renders through an <img> blob url; a thumbnail may be a data uri
    expect(directives).toContain(`img-src ${webview.cspSource} data: blob:`)
    // the audio and video stages hand the platform player a blob
    expect(directives).toContain(`media-src ${webview.cspSource} blob:`)
    // and the same two relaxations `VIEWER_CSP` already carries, so nothing was invented here
    expect(VIEWER_CSP.imgSrc).toContain('blob:')
    expect(VIEWER_CSP.mediaSrc).toContain('blob:')
    // nothing beyond: no network, no frames, no worker origin of its own
    const names = directives.map(directive => directive.split(' ')[0])
    expect(names).toEqual([
      'default-src',
      'style-src',
      'style-src-attr',
      'script-src',
      'img-src',
      'media-src',
    ])
  })

  it('keeps the style attribute banned, which is the rule the ui components rely on', () => {
    expect(contentSecurityPolicy('x', 'n')).toContain("style-src-attr 'none'")
    expect(VIEWER_CSP.styleSrcAttr).toBe("'none'")
  })
})

describe('webview page', () => {
  it('carries the nonce on both script elements and on nothing else', () => {
    const html = pageHtml({ webview, bootstrap, nonce: 'abc123' })
    expect([...html.matchAll(/nonce="abc123"/gu)].length).toBe(2)
    expect(html).toContain('<script nonce="abc123" type="module"')
    expect(html).toContain('vscode-resource://modkitx.modkit/dist-app/webview.js')
    expect(html).toContain('vscode-resource://modkitx.modkit/dist-app/modkit-ui.css')
    expect(html).toContain('vscode-resource://modkitx.modkit/dist-app/app.css')
  })

  it('uses the host-resolved locale for the webview document', () => {
    expect(pageHtml({ webview, bootstrap: { ...bootstrap, locale: 'ru' }, nonce: 'n' })).toContain(
      '<html lang="ru"',
    )
  })

  it('does not allow a malformed locale to create an HTML attribute', () => {
    const html = pageHtml({
      webview,
      bootstrap: { ...bootstrap, locale: 'ru\" data-hostile=\"yes' },
      nonce: 'n',
    })
    expect(html).not.toContain('lang="ru" data-hostile="yes"')
    expect(html).toContain('lang="ru&quot; data-hostile=&quot;yes"')
  })

  it('escapes the snapshot so nothing in it can close the script element', () => {
    const hostile: PageBootstrap = {
      ...bootstrap,
      extensions: {
        failures: [{ root: '</script><script>fetch("//evil")</script>', code: 'x', message: 'y' }],
      },
    }
    const serialized = serializeBootstrap(hostile)
    expect(serialized).not.toContain('</script>')
    expect(serialized).toContain('\\u003c/script>')
    const html = pageHtml({ webview, bootstrap: hostile, nonce: 'n' })
    // exactly the two script elements the page authored, and no third one
    expect([...html.matchAll(/<script/gu)].length).toBe(2)
  })

  it('round-trips the snapshot the page reads back out of the document', () => {
    const html = pageHtml({ webview, bootstrap, nonce: 'n' })
    const match = /globalThis\.__MODKIT_BOOTSTRAP__ = (.*)<\/script>/u.exec(html)
    expect(match).not.toBeNull()
    const parsed: unknown = JSON.parse(match?.[1]?.replaceAll('\\u003c', '<') ?? 'null')
    expect(parsed).toEqual(bootstrap)
  })

  it('hands the page no path when the panel was not raised from a file', () => {
    expect(pageHtml({ webview, bootstrap, nonce: 'n' })).not.toContain('openPath')
    expect(
      pageHtml({ webview, bootstrap: { ...bootstrap, openPath: '/w/a.json' }, nonce: 'n' }),
    ).toContain('"openPath":"/w/a.json"')
  })
})

describe('refusal page', () => {
  it('loads nothing at all and escapes the reason it prints', () => {
    const html = refusalHtml('«git:» is a revision <b>out</b> of source control')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<link')
    expect(html).toContain('&lt;b&gt;out&lt;/b&gt;')
  })

  it('uses the selected language for its document and visible refusal', () => {
    const html = refusalHtml('нет доступа', createVscodeLocalizer('ru'))
    expect(html).toContain('<html lang="ru">')
    expect(html).toContain('Modkit не может открыть этот объект: нет доступа')
  })
})
