import { expect, it } from 'vitest'
import { renderHeadless } from '../src/render/headless.js'
import type { SceneRendererScene } from '@modkit/sdk/renderer'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const scene: SceneRendererScene = {
  materialContext: { sceneLighting: true },
  textures: [{ id: 'white', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }],
  materials: [
    {
      id: 'surface',
      baseColor: [1, 1, 1, 1],
      textureBindings: [{ resourceId: 'white', textureId: 'white' }],
      shader: {
        id: 'modkit.render-material.v1',
        parameters: {
          renderModel: {
            version: 1,
            standard: {
              layers: {
                diffuse: {
                  slot: 'diffuse',
                  texturePath: 'white',
                  channels: 0,
                  op: 2,
                  teamColorMode: 0,
                  uvSource: 0,
                  invert: false,
                  clampResult: true,
                  wrapX: true,
                  wrapY: true,
                },
              },
              blendMode: 0,
              priority: 0,
              specularity: 10,
              specMult: 0,
              emisMult: 1,
              specMode: 0,
              alphaTestThreshold: 0,
              twoSided: true,
              unshaded: false,
              doubleLambert: false,
              clampOutput: false,
              usesVertexColor: false,
              usesVertexAlpha: false,
            },
          },
        },
      },
    },
  ],
  primitives: [
    {
      id: 'quad',
      materialId: 'surface',
      topology: 'triangles',
      positions: Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0),
      normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1),
      textureCoordinates: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
      indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
    },
  ],
}
const draw = async (lighting: Partial<SceneRendererScene>) =>
  (
    await renderHeadless({
      outputKind: 'rgba8',
      viewport: { width: 2, height: 2 },
      camera: { viewProjection: identity },
      scene: { ...scene, ...lighting },
    })
  ).rgba

it.each([{ direction: [0, 0, 1] }, { direction: [1, 0, 0] }, { direction: [0, 0, -1] }] as const)(
  'shares key direction and colours across legacy and modern rigs $direction',
  async ({ direction }) => {
    const legacy = { direction, ambient: 0.2, color: [0.3, 0.5, 0.7, 1] as const }
    const modern = {
      lights: [{ type: 'directional' as const, direction, color: [0.3, 0.5, 0.7] as const }],
      ambientLight: [0.2, 0.2, 0.2] as const,
    }
    expect(await draw(modern)).toEqual(await draw({ light: legacy }))
    expect(await draw({ ...modern, light: legacy })).toEqual(await draw({ light: legacy }))
  },
)

it('keeps ambient-only rigs lit without inventing a directional light', async () => {
  const pixels = await draw({ lights: [], ambientLight: [0.2, 0.4, 0.6] })
  expect(Array.from(pixels.slice(0, 4))).toEqual([51, 102, 153, 255])
})

/** A plain tangent normal material: no environment or signed-detail policy supplies its basis. */
function normalScene(normal: readonly number[], materialOffset = 0): SceneRendererScene {
  const cloned = structuredClone(scene)
  const surface = cloned.materials![0]!
  const parameters = surface.shader!.parameters as {
    renderModel: {standard: {layers: Record<string, unknown>; normalMapFormat?: string};worldToMaterial?:number[]}
  }
  parameters.renderModel.standard.layers['normal'] = {
    slot:'normal',texturePath:'normal',uvSource:0,channels:0,op:2,teamColorMode:0,
    invert:false,clampResult:false,wrapX:true,wrapY:true,
  }
  parameters.renderModel.standard.normalMapFormat = 'rgb8'
  const worldToMaterial = [...identity]
  worldToMaterial[12] = materialOffset
  parameters.renderModel.worldToMaterial = worldToMaterial
  return {...cloned,
    textures:[...cloned.textures!,{id:'normal',width:1,height:1,rgba:Uint8Array.from(normal)}],
    materials:[{...surface,textureBindings:[...surface.textureBindings!,{resourceId:'normal',textureId:'normal'}]}],
  }
}

it('lights a plain tangent normal from a point and leaves its back dark without a preview floor',async()=>{
  const surface = normalScene([255,128,128,255])
  const render = async(x:number)=> (await renderHeadless({outputKind:'rgba8',viewport:{width:4,height:4},
    camera:{viewProjection:identity},scene:{...surface,ambientLight:[0,0,0],lights:[{
      type:'point',position:[x,0,0],direction:[0,0,1],color:[0.5,0.25,0.125],range:5,
    }]},})).rgba
  const front = await render(2), back = await render(-2)
  expect(front[0]).toBeGreaterThan(100)
  expect(front[1]).toBeGreaterThan(front[2]!)
  expect(Array.from(back).filter((_,i)=>i%4!==3).every(v=>v===0)).toBe(true)
})

it('evaluates point range in scene world independently of the material UV transform',async()=>{
  const render = async(offset:number)=> (await renderHeadless({outputKind:'rgba8',viewport:{width:4,height:4},
    camera:{viewProjection:identity},scene:{...normalScene([128,128,255,255],offset),ambientLight:[0,0,0],
      lights:[{type:'point',position:[0,0,2],direction:[0,0,1],color:[0.5,0.25,0.125],
        range:3,attenuationStart:0,attenuationEnd:4,decayExponent:2}]},})).rgba
  expect(await render(100)).toEqual(await render(0))
})

it('honors spot cones with the normal map instead of adding scene ambient or a diffuse floor',async()=>{
  const render = async(z:number)=> (await renderHeadless({outputKind:'rgba8',viewport:{width:4,height:4},
    camera:{viewProjection:identity},scene:{...normalScene([128,128,255,255]),ambientLight:[0,0,0],
      lights:[{type:'spot',position:[0,0,2],direction:[0,0,z],color:[1,0.5,0.25],
        innerConeAngle:0.8,outerConeAngle:1.6}]},})).rgba
  expect((await render(-1))[0]).toBeGreaterThan(50)
  expect(Array.from(await render(1)).filter((_,i)=>i%4!==3).every(v=>v===0)).toBe(true)
})
