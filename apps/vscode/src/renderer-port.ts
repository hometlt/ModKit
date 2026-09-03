/**
 * The page's half of renderer resolution: instantiate what the extension host selected.
 *
 * The webview holds no host access, and that must not change — no inventory, no grant, no
 * extension root, no file handle. But it is the realm with the GPU, so it is the only place a
 * WebGL2 provider can produce a frame. Splitting the two is what this file is: the extension host
 * runs the standard resolver against the page realm's own target and facilities and puts the
 * decision in the page bootstrap as ids; this turns that decision into a `SceneRendererPort` by
 * looking the renderer id up in a table of providers that are **already inside this bundle**.
 *
 * Three properties follow from the table being closed and static, and all three are the point:
 *
 *  - the page can never be told to load code it does not already ship, because there is no loader
 *    here — only a lookup;
 *  - a host that selected a third-party provider gets a stated refusal rather than a silent
 *    fallback, because the id is simply absent from the table;
 *  - a machine whose realm resolved nothing gets `unresolved` with the reason, and the model stage
 *    keeps its 2D wireframe.
 *
 * The contract, the matcher, the resolver and the provider are all the shipped ones. Nothing here
 * is a second renderer stack; it is the last step of the first one, performed where the canvas is.
 */

import { createProvider as createBrowserRenderer } from '@modkit/scene/render/browser'
import type {
  SceneRenderer,
  SceneRendererAcquireRequest,
  SceneRendererAcquisition,
  SceneRendererPort,
} from '@modkit/sdk'

import type { PageBootstrap } from './page.js'

/** Renderer ids this bundle carries a provider for. */
const PAGE_RENDERERS: Readonly<
  Record<
    string,
    (selection: { contract: string; major: number }) => {
      readonly value: SceneRenderer
      release(): Promise<void>
    }
  >
> = Object.freeze({
  'modkit.browser-webgl': createBrowserRenderer,
})

const refusal = (code: string, message: string): SceneRendererAcquisition =>
  Object.freeze({
    state: 'unresolved',
    diagnostics: Object.freeze([
      Object.freeze({ severity: 'information' as const, code, message }),
    ]),
  })

/**
 * A port for the page, or `undefined` when the host selected nothing for this realm.
 *
 * `undefined` rather than a port that always refuses, so the model stage can distinguish «this
 * window offers no renderer at all» from «it offered one and it did not resolve» — the two land on
 * `data-model-renderer-status` as `unavailable` and `unresolved`, and an installed-product probe
 * needs them apart.
 */
export function createWebviewRendererPort(
  selection: PageBootstrap['renderer'],
): SceneRendererPort | undefined {
  if (selection === undefined) return undefined
  return Object.freeze({
    async acquire(request: SceneRendererAcquireRequest): Promise<SceneRendererAcquisition> {
      if (request.outputKind !== selection.outputKind) {
        return refusal(
          'x3.vscode/renderer-output-mismatch',
          `this page was granted ${selection.outputKind}, not ${request.outputKind}`,
        )
      }
      const rendererId =
        request.rendererId === undefined
          ? selection.rendererIds.find(id => PAGE_RENDERERS[id] !== undefined)
          : selection.rendererIds.includes(request.rendererId)
            ? request.rendererId
            : undefined
      if (rendererId === undefined) {
        return refusal(
          'x3.vscode/renderer-not-granted',
          `this page was granted ${selection.rendererIds.join(', ')} and cannot activate anything else`,
        )
      }
      const factory = PAGE_RENDERERS[rendererId]
      if (factory === undefined) {
        return refusal(
          'x3.vscode/renderer-not-bundled',
          `${selection.providerId} was selected for this realm and its provider is not in this page's bundle`,
        )
      }
      try {
        const provider = factory({ contract: 'common.render/scene-3d', major: 1 })
        return Object.freeze({
          state: 'resolved',
          diagnostics: Object.freeze([
            Object.freeze({
              severity: 'information' as const,
              code: 'x3.vscode/renderer-activated',
              message: `activated ${rendererId} selected by the extension host as ${selection.offerId}`,
            }),
          ]),
          lease: Object.freeze({
            renderer: provider.value,
            release: () => provider.release(),
          }),
        })
      } catch (error) {
        return refusal(
          'x3.vscode/renderer-activation-failed',
          error instanceof Error ? error.message : String(error),
        )
      }
    },
  })
}
