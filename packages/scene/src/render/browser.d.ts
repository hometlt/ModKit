import type {
  SceneRenderFrame,
  SceneRenderRequest,
  SceneRenderer,
  SCENE_RENDERER_CONTRACT,
} from '@modkit/sdk/renderer'

/** WebGL2 implementation of the portable scene-renderer contract. */
export declare function renderBrowser(request: SceneRenderRequest): Promise<SceneRenderFrame>

export declare const abiVersion: 1
export declare const provides: readonly [typeof SCENE_RENDERER_CONTRACT]

/**
 * The provider factory the host's execution backend calls after resolution.
 *
 * Declared so a first-party application that has already been *told by the host* which offer its
 * realm may use can instantiate that offer inside its own bundle. The selection remains the host's;
 * this is only the constructor at the end of it.
 */
export declare function createProvider(selection: {
  readonly contract: string
  readonly major: number
}): { readonly value: SceneRenderer; release(): Promise<void> }
