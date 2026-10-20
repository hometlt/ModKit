import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { renderWorldHeadless, worldHeadlessScene } from '../src/world/headless.js'

const texture = { id: 'red.png', width: 1, height: 1, rgba: Uint8Array.of(255, 0, 0, 255) }
const material = {
  id: 'surface',
  layers: [{ slot: 'diffuse', resourceId: texture.id, uvSource: 0 }],
  shader: {
    id: 'modkit.render-material.v1',
    parameters: {
      renderModel: {
        version: 1,
        standard: {
          layers: {
            diffuse: {
              slot: 'diffuse',
              texturePath: texture.id,
              constantColor: { value: [1, 1, 1, 1] },
              uvSource: 0,
              channels: 0,
              op: 6,
              teamColorMode: 0,
              invert: false,
              clampResult: true,
              wrapX: true,
              wrapY: true,
            },
          },
          blendMode: 0,
          priority: 0,
          specularity: 10,
          specMult: 1,
          emisMult: 1,
          specMode: 0,
          alphaTestThreshold: 0,
          twoSided: true,
          unshaded: true,
          doubleLambert: false,
          clampOutput: false,
          usesVertexColor: false,
          usesVertexAlpha: false,
        },
      },
    },
  },
}
// a red quad standing a unit tall over the centre of a 4 x 4 ground
const model = {
  state: 'converted',
  sourceKey: 'post',
  complete: true,
  diagnostics: [],
  meshes: [],
  primitives: [
    {
      id: 'quad',
      topology: 'triangles',
      materialId: 'surface',
      positions: Float32Array.from([-1, 0, 0, 1, 0, 0, 1, 2, 0, -1, 2, 0]),
      indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
      textureCoordinates: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    },
  ],
  materials: [material],
  textures: [texture],
}
const terrain = Array.from({ length: 25 }, (_, index) => {
  const x = index % 5
  const y = Math.floor(index / 5)
  return {
    facet: 'terrain',
    id: `terrain:${index}`,
    layerId: 'terrain',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x,
    y,
    heightBase: 0,
    heightAdjustment: 0,
    mask: 0,
    uvwPosition: { x, y: 0, z: y },
  }
})
const object = {
  facet: 'objects',
  id: 'object-1',
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId: 1,
  position: { x: 2, y: 2, z: 0 },
  uvwPosition: { x: 2, y: 0, z: 2 },
  resourceId: 'post',
}

it('keeps complete geometry while opaque boundary fog hides exterior ground and models', async () => {
  for (const blendMode of [0,1,2]) {
  const variant={...model,materials:[{...material,shader:{...material.shader,parameters:{renderModel:{version:1,standard:{...material.shader.parameters.renderModel.standard,blendMode}}}}}]}
  const input={items:[...terrain,object],models:new Map([['post',variant]])}
  const plan=createWorldWebGlPlan(input)
  const options={width:64,height:48,clearColor:[1,1,1,1]}
  const before=await renderWorldHeadless(plan,options)
  const hidden=await renderWorldHeadless(plan,{...options,visibilityBounds:[10,10,20,20]})
  for(let p=0;p<hidden.rgba.length;p+=4)assert.deepEqual([...hidden.rgba.subarray(p,p+4)],[0,0,0,255])
  const partial=await renderWorldHeadless(plan,{...options,visibilityBounds:[0,0,1,4]})
  let ground=0
  for(let p=0;p<partial.rgba.length;p+=4){const[r,g,b,a]=partial.rgba.subarray(p,p+4);assert.equal(a,255);assert.ok(!(r-g>60&&r-b>60),'the transformed solid/blended/additive red model outside the rectangle must not leak');if(r+g+b>0)ground++}
  assert.ok(ground>0,'visible ground remains')
  assert.deepEqual((await renderWorldHeadless(plan,options)).rgba,before.rgba,'normal rendering is unchanged after a masked render')
  assert.ok(worldHeadlessScene(plan).scene.primitives.some(p=>p.id.startsWith('model-0/')),'visibility does not remove models from the plan')
  }
})

it('renders a world plan without a GPU: its ground and its models as the plan places them', async () => {
  const plan = createWorldWebGlPlan({
    items: [...terrain, object],
    models: new Map([['post', model]]),
  })
  const { scene } = worldHeadlessScene(plan)
  assert.ok(scene.primitives.some(primitive => primitive.id === 'world/ground'))
  assert.ok(scene.primitives.some(primitive => primitive.id.startsWith('model-0/')))
  // every material a primitive names is in the scene, every texture a material names too
  const materials = new Map(scene.materials.map(item => [item.id, item]))
  const textures = new Set(scene.textures.map(item => item.id))
  for (const primitive of scene.primitives)
    assert.ok(materials.has(primitive.materialId), primitive.id)
  for (const item of scene.materials)
    for (const binding of item.textureBindings ?? []) assert.ok(textures.has(binding.textureId))
  // the world viewer's default camera: the whole world in view, its centre in the middle
  const frame = await renderWorldHeadless(plan, { width: 64, height: 48, clearColor: [0, 0, 0, 1] })
  assert.equal(frame.width, 64)
  let ground = 0
  let red = 0
  let redX = 0
  for (let index = 0; index < frame.rgba.length; index += 4) {
    const [r, g, b] = frame.rgba.subarray(index, index + 3)
    if (r > 150 && g < 60 && b < 60) {
      red += 1
      redX += (index / 4) % 64
    } else if (r + g + b > 0) ground += 1
  }
  assert.ok(ground > 64 * 48 * 0.05, `ground drawn on ${ground} pixels`)
  assert.ok(red > 0, 'the red model is drawn')
  // the model stands where the plan placed it, over the centre of the ground
  assert.ok(Math.abs(redX / red - 32) < 6, `the model drawn around x ${redX / red}`)
})

it('isolates objects after preparing the world, preserving placement and the default render', async () => {
  const plan = createWorldWebGlPlan({ items: [...terrain, object], models: new Map([['post', model]]) })
  const options = { width: 64, height: 48 }
  const full = await renderWorldHeadless(plan, options)
  const isolated = await renderWorldHeadless(plan, { ...options, content: 'objects' })
  let red = 0, removed = 0
  for (let i = 0; i < full.rgba.length; i += 4) {
    if (full.rgba[i] > 150 && full.rgba[i+1] < 60 && full.rgba[i+2] < 60) {
      assert.deepEqual(isolated.rgba.subarray(i,i+4),full.rgba.subarray(i,i+4))
      red++
    } else if (full.rgba[i]+full.rgba[i+1]+full.rgba[i+2] > 0) {
      assert.deepEqual([...isolated.rgba.subarray(i,i+4)],[0,0,0,255])
      removed++
    }
  }
  assert.ok(red > 0 && removed > 0)
  assert.deepEqual((await renderWorldHeadless(plan,options)).rgba,full.rgba)
})

it('paints receiver-coincident terrain decals without hiding models or changing ground depth', async () => {
  const width=64,height=48
  const plan = createWorldWebGlPlan({items: [...terrain, object],models:new Map([['post',model]])})
  const ground = plan.opaqueTriangles
  const positions = ground.positions.slice(0,plan.terrainOpaqueVertices*3)
  const overlay = {...ground,positions,normals:ground.normals.slice(0,positions.length),
    colors:Float32Array.from({length:positions.length/3*4},(_,i)=>i%4===3?1:1),
    textureCoordinates:new Float32Array(positions.length/3*2),
    texture:{id:'green-road',width:1,height:1,rgba:Uint8Array.of(0,255,0,255)}}
  const painter = {...plan,terrainDecalTriangles:[overlay]}
  const base=await renderWorldHeadless(plan,{width,height})
  const frame=await renderWorldHeadless(painter,{width,height})
  let green=0,red=0,baseRed=0
  for(let i=0;i<frame.rgba.length;i+=4){
    if(frame.rgba[i+1]>frame.rgba[i]*2&&frame.rgba[i+1]>frame.rgba[i+2]*2)green++
    if(frame.rgba[i]>150&&frame.rgba[i+1]<60&&frame.rgba[i+2]<60)red++
    if(base.rgba[i]>150&&base.rgba[i+1]<60&&base.rgba[i+2]<60)baseRed++
  }
  assert.ok(green>width*height*.05,'clipped decal wins against terrain depth')
  assert.ok(baseRed>0,'model occlusion oracle is nonempty')
  assert.equal(red,baseRed,'ordinary model occlusion remains intact')
  assert.equal(worldHeadlessScene(painter).scene.primitives.find(p=>p.id==='world/decal-0').depthBias,undefined)
})

it("carries a batch's team colour and additive blending into the headless scene", async () => {
  const plan = createWorldWebGlPlan({ items: terrain })
  // a texture and a mask that share an id and not their texels
  const white = { id: 'surface', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
  const mask = { id: 'surface', width: 1, height: 1, rgba: Uint8Array.of(255, 0, 0, 255) }
  // a quad over the middle of the ground, facing up
  const quad = height => ({
    positions: Float32Array.from([
      1,
      height,
      1,
      3,
      height,
      3,
      3,
      height,
      1,
      1,
      height,
      1,
      1,
      height,
      3,
      3,
      height,
      3,
    ]),
    normals: Float32Array.from(Array.from({ length: 6 }, () => [0, 1, 0]).flat()),
    colors: new Float32Array(24).fill(1),
    textureCoordinates: new Float32Array(12),
  })
  const team = {
    mask,
    channel: 0,
    blend: 2,
    strength: 1,
    color: [0, 0, 1],
    rule: { mode: 'data', channel: 0 },
  }
  const teamed = { ...plan, texturedTriangles: [{ ...quad(0.5), texture: white, team }] }
  const { scene } = worldHeadlessScene({
    ...teamed,
    transparentTexturedTriangles: [
      { ...quad(0.6), texture: white, blendMode: 'additive', receiveShadows: false },
    ],
  })
  const material = scene.materials.find(item => item.id === 'world/textured-0')
  assert.notEqual(material.baseColorTexture, material.teamColor.mask.texture)
  assert.deepEqual(material.teamColor, {
    mask: { texture: material.teamColor.mask.texture, channel: 'r' },
    blend: 'replace',
    strength: 1,
    defaultColor: [0, 0, 1],
  })
  const glow = scene.materials.find(item => item.id === 'world/transparent-textured-0')
  assert.equal(glow.simpleEffect.blend, 'additive')
  // the masked white quad takes the batch's blue, seen from above
  const frame = await renderWorldHeadless(teamed, {
    width: 32,
    height: 32,
    camera: { azimuth: Math.PI / 2, elevation: 1.5, zoom: 1, target: [0, 0, 0] },
  })
  const [r, g, b] = frame.rgba.subarray((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 3)
  assert.ok(b > 100 && r < 60 && g < 60, `the middle is ${[r, g, b]}`)
})

it('CPU object lighting affects program and fallback models while terrain stays on its own rig', async () => {
  const white = { ...texture, rgba: Uint8Array.of(255, 255, 255, 255) }
  const lit = structuredClone(material)
  lit.shader.parameters.renderModel.standard.unshaded = false
  const lighting = {
    facet: 'lighting',
    id: 'light',
    layerId: 'lighting',
    coordinateSpaceId: 'uvw',
    ambientColor: [1, 0, 0],
    ambientIntensity: 1,
    directional: [{ id: 'terrain-key', direction: [0, -1, 0], color: [0, 0, 0], intensity: 0 }],
    objects: {
      ambientColor: [0, 0, 1],
      ambientIntensity: 1,
      directional: [{ id: 'object-key', direction: [0, -1, 0], color: [0, 0, 0], intensity: 0 }],
    },
  }
  for (const program of [true, false]) {
    const m = program
      ? lit
      : {
          id: 'surface',
          layers: [{ slot: 'diffuse', resourceId: white.id }],
          baseColorFactor: [1, 1, 1, 1],
        }
    const plan = createWorldWebGlPlan({
      items: [
        ...terrain,
        ...terrain.map(t => ({
          facet: 'terrain-materials',
          id: 'm:' + t.id,
          layerId: 'materials',
          coordinateSpaceId: 'height-grid',
          x: t.x,
          y: t.y,
          weights: [{ materialId: 'white', weight: 1 }],
        })),
        object,
        lighting,
      ],
      terrainMaterials: [{ materialId: 'white', baseColorFactor: [1, 1, 1, 1] }],
      models: new Map([['post', { ...model, materials: [m], textures: [white] }]]),
    })
    const scene = worldHeadlessScene(plan)
    assert.deepEqual(scene.scene.ambientLight, [1, 0, 0])
    assert.ok(scene.materialLighting.size > 0)
    assert.ok([...scene.materialLighting.keys()].some(id => id.startsWith('model-')))
    assert.equal(scene.materialLighting.has('world/ground'), false)
    const { renderHeadless } = await import('../src/render/headless.ts')
    const { createWorldWebGlCameraFrame } = await import('../src/world/webgl.ts')
    // Ground uses the world rig; the raw fallback model below opts into that same lighting.
    const litScene = {
      ...scene.scene,
      materials: scene.scene.materials.map(m =>
        !program && m.id.startsWith('model-')
          ? { ...m, shading: 'lambert' }
          : m,
      ),
    }
    const image = await renderHeadless(
      {
        scene: litScene,
        camera: createWorldWebGlCameraFrame(plan, 64, 64),
        viewport: { width: 64, height: 64 },
        outputKind: 'rgba8',
      },
      scene.splats,
      scene.water,
      scene.terrain,
      scene.materialLighting,
    )
    let blue = 0,
      red = 0
    for (let i = 0; i < image.rgba.length; i += 4) {
      if (image.rgba[i + 2] > 50 && image.rgba[i] < 20) blue++
      if (image.rgba[i] > 50 && image.rgba[i + 2] < 20) red++
    }
    assert.ok(blue > 3, 'object is blue, including fallback material')
    assert.ok(red > 3, 'terrain remains red')
  }
})

it('assigns the object rig to raw CPU fallback batches as well as prefixed model materials', () => {
  const raw = {
    ...model,
    materials: [],
    primitives: model.primitives.map(p => ({ ...p, materialId: undefined })),
  }
  const plan = createWorldWebGlPlan({
    items: [
      ...terrain,
      object,
      {
        facet: 'lighting',
        id: 'l',
        layerId: 'light',
        coordinateSpaceId: 'uvw',
        ambientColor: [1, 0, 0],
        ambientIntensity: 1,
        directional: [],
        objects: { ambientColor: [0, 0, 1], ambientIntensity: 1, directional: [] },
      },
    ],
    models: new Map([['post', raw]]),
  })
  const scene = worldHeadlessScene(plan)
  assert.deepEqual(scene.materialLighting.get('world/opaque-models').ambientLight, [0, 0, 1])
  assert.equal(scene.materialLighting.has('world/ground'), false)
})

it('keeps clipped cell layers in order and hides distant layers behind foreground terrain', async () => {
  // A native cell layer has material and clipping coordinates, with no authored elevation.
  function receiverInput(ridge) {
    const items=[]
    for(let z=0;z<5;z++)for(let x=0;x<5;x++){
      const height=ridge&&z===3?2:0
      items.push({...terrain[0],id:`receiver:${x}:${z}`,x,y:z,heightBase:height,
        uvwPosition:{x,y:height,z}})
    }
    for(let z=0;z<4;z++)for(let x=0;x<4;x++)items.push({
      facet:'terrain-materials',id:`layers:${x}:${z}`,layerId:'materials',
      coordinateSpaceId:'height-grid',x,y:z,layers:[
        {materialId:'green',tile:{column:0,row:0}},
        ...(x===2&&z===(ridge?1:2)?[
          {materialId:'blue',tile:{column:0,row:0},cornerAlpha:[1,1,1,1],
            clipPolygon:[[.15,.15],[.85,.15],[.85,.85],[.15,.85]]},
          {materialId:'yellow',tile:{column:0,row:0},cornerAlpha:[1,1,1,1],
            clipPolygon:[[.3,.3],[.7,.3],[.7,.7],[.3,.7]]},
        ]:[]),
      ],
    })
    const texels={green:[20,170,40,255],blue:[25,45,220,255],yellow:[245,220,20,255]}
    return {items,terrainMaterials:Object.keys(texels).map(materialId=>({
      materialId,baseColorResourceId:materialId,atlas:{rows:1},
    })),terrainTextures:new Map(Object.entries(texels).map(([id,rgba])=>[
      id,{id,width:1,height:1,rgba:Uint8Array.from(rgba)},
    ]))}
  }
  // Both layer colours must be visible; the later yellow layer occupies the blue layer's centre.
  function layerPixels(frame) {
    const counts={blue:0,yellow:0}
    for(let i=0;i<frame.rgba.length;i+=4){
      const [r,g,b]=frame.rgba.subarray(i,i+3)
      if(b>100&&b>r*2&&b>g*2)counts.blue++
      if(r>100&&g>100&&b<80)counts.yellow++
    }
    return counts
  }
  const camera=(elevation,ridge)=>({azimuth:Math.PI/2,elevation,zoom:1.5,target:[0,0,0],
    frame:{center:[2,ridge?1:0,2],radius:3}})
  const flat=createWorldWebGlPlan(receiverInput(false))
  assert.equal(flat.terrainDecalTriangles.length,2,'both authored clipped layers were generated')
  const visible=layerPixels(await renderWorldHeadless(flat,{width:128,height:96,camera:camera(1.1,false)}))
  assert.ok(visible.blue>10&&visible.yellow>5,'clipped coincident layers and their order remain visible')
  const ridge=createWorldWebGlPlan(receiverInput(true))
  assert.equal(ridge.terrainDecalTriangles.length,2,'hidden-layer oracle is not empty')
  const low=layerPixels(await renderWorldHeadless(ridge,{width:128,height:96,camera:camera(.3,true)}))
  assert.deepEqual(low,{blue:0,yellow:0},'near terrain occludes the distant cell layers')
  const high=layerPixels(await renderWorldHeadless(ridge,{width:128,height:96,camera:camera(.9,true)}))
  assert.ok(high.blue>0&&high.yellow>0,'the distant layers remain visible from above the ridge')
})


it('spatial supersampling retains output dimensions and actually shades four subpixel samples',async()=>{
  const plan=createWorldWebGlPlan({items:terrain})
  const base=await renderWorldHeadless(plan,{width:96,height:72})
  const smooth=await renderWorldHeadless(plan,{width:96,height:72,supersample:2})
  assert.equal(smooth.width,96);assert.equal(smooth.height,72)
  assert.equal(smooth.rgba.length,96*72*4)
  assert.ok(smooth.statistics.fragments>base.statistics.fragments*3)
  await assert.rejects(()=>renderWorldHeadless(plan,{width:96,height:72,supersample:3}),/supersample/)
})
