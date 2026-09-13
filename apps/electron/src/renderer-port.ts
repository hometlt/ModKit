/**
 * The Electron renderer owns the browser graphics realm, so it instantiates the browser provider
 * already bundled with the application and exposes only the standard consumer port to viewers.
 * No inventory, filesystem authority, or dynamic module URL crosses into the page.
 */
import { createProvider as createBrowserRenderer } from '@modkit/scene/render/browser'
import type {
  SceneRendererAcquireRequest,
  SceneRendererAcquisition,
  SceneRendererPort,
} from '@modkit/sdk'

const RENDERER_ID = 'modkit.browser-webgl'

const refusal = (code: string, message: string): SceneRendererAcquisition =>
  Object.freeze({
    state: 'unresolved',
    diagnostics: Object.freeze([
      Object.freeze({ severity: 'information' as const, code, message }),
    ]),
  })

/** The fixed first-party WebGL2 renderer carried by the Electron renderer bundle. */
export function createElectronRendererPort(): SceneRendererPort {
  return Object.freeze({
    async acquire(request: SceneRendererAcquireRequest): Promise<SceneRendererAcquisition> {
      request.signal?.throwIfAborted()
      if (request.outputKind !== 'rgba8') {
        return refusal(
          'x3.electron/renderer-output-unsupported',
          `the bundled Electron renderer does not produce ${request.outputKind}`,
        )
      }
      if (request.rendererId !== undefined && request.rendererId !== RENDERER_ID) {
        return refusal(
          'x3.electron/renderer-not-bundled',
          `renderer ${request.rendererId} is not bundled in this Electron graphics realm`,
        )
      }
      try {
        const provider = createBrowserRenderer({
          contract: 'common.render/scene-3d',
          major: 1,
        })
        return Object.freeze({
          state: 'resolved',
          diagnostics: Object.freeze([
            Object.freeze({
              severity: 'information' as const,
              code: 'x3.electron/renderer-activated',
              message: `activated ${RENDERER_ID} in the Electron graphics realm`,
            }),
          ]),
          lease: Object.freeze({
            renderer: provider.value,
            release: () => provider.release(),
          }),
        })
      } catch (error) {
        return refusal(
          'x3.electron/renderer-activation-failed',
          error instanceof Error ? error.message : String(error),
        )
      }
    },
  })
}
