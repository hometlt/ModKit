import type { ServiceProviderContributionSpecV1 } from '@modkitx-x3/sdk/formats'
import type {
  SceneRenderer,
  SceneRendererProviderModule,
  SceneRendererRequestFacet,
} from '@modkitx-x3/sdk/renderer'
import type { TypedServiceContractRequest } from '@modkitx-x3/sdk/service-contracts'

export const softwareRendererRoute = {
  contract: 'common.render/scene-3d',
  major: 1,
  facet: { rendererId: 'reference.software', outputKind: 'rgba8' },
} satisfies TypedServiceContractRequest<'common.render/scene-3d', 1>

export const softwareRendererContribution = {
  provides: [
    {
      offerId: 'reference-software-renderer-v1',
      contract: 'common.render/scene-3d',
      major: 1,
      version: '1.0.0',
      facet: { rendererIds: ['reference.software'], outputKinds: ['rgba8'] },
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'common.render/scene-3d'>

export const invalidRendererRoute = {
  rendererId: 'reference.software',
  // @ts-expect-error Scene renderer v1 returns owned RGBA8 frames, not encoded PNG output.
  outputKind: 'png',
} satisfies SceneRendererRequestFacet

export declare const renderer: SceneRenderer
export declare const rendererModule: SceneRendererProviderModule
export const frame = renderer.render({
  scene: {
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles',
        positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ],
  },
  camera: {
    viewProjection: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  },
  viewport: { width: 64, height: 64 },
  outputKind: 'rgba8',
})
