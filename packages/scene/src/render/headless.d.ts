import type {
  SceneRenderFrame,
  SceneRenderRequest,
  SceneRenderer,
  SCENE_RENDERER_CONTRACT,
} from '@modkit/sdk/renderer'

/** Deterministic DOM-free implementation of the portable scene-renderer contract. */
export declare function renderHeadless(request: SceneRenderRequest): Promise<SceneRenderFrame>

export declare const abiVersion: 1
export declare const provides: readonly [typeof SCENE_RENDERER_CONTRACT]

/** The provider factory the host's execution backend calls after resolution. */
export declare function createProvider(selection: {
  readonly contract: string
  readonly major: number
}): { readonly value: SceneRenderer; release(): Promise<void> }
