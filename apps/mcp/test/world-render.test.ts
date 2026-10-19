import { dirname, resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { expect, it } from 'vitest'
import { decodePngSamples } from '@modkit/codec-kit/raster'
import { createHostMcpPort, createModkitMcpServer, type McpEnvelope } from '../src/index.js'

const fixture = resolve(
  import.meta.dirname,
  '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-renderable-world.uvw.json',
)

it('renders the world a subject publishes as its viewer shows it, from the camera asked for', async () => {
  const host = await createHostMcpPort({ roots: [dirname(fixture)], extensions: [] })
  const app = createModkitMcpServer(host)
  const client = new Client({ name: 'world-render', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([client.connect(clientTransport), app.server.connect(serverTransport)])
    const opened = await client.callTool({
      name: 'modkit.open_subject',
      arguments: { path: fixture },
    })
    const handle = ((opened.structuredContent as McpEnvelope).data as { handle: string }).handle
    const render = async (camera: Readonly<Record<string, unknown>>) => {
      const drawn = await client.callTool({
        name: 'modkit.world_scene',
        arguments: { handle, view: 'render', width: 96, height: 64, ...camera },
      })
      if (drawn.isError === true) throw new Error(JSON.stringify(drawn.structuredContent))
      const picture = (drawn.content as { type: string; mimeType?: string; data?: string }[]).find(
        item => item.type === 'image',
      )
      expect(picture).toMatchObject({ mimeType: 'image/png' })
      const decoded = await decodePngSamples(Buffer.from(picture!.data!, 'base64'))
      return {
        data: (drawn.structuredContent as McpEnvelope).data as Record<string, unknown>,
        decoded,
      }
    }
    const shown = await render({})
    expect(shown.data).toMatchObject({ width: 96, height: 64, camera: { zoom: 1 } })
    expect([shown.decoded.width, shown.decoded.height]).toEqual([96, 64])
    // something of the world is drawn over the black clear colour
    const { samples, channels } = shown.decoded
    let lit = 0
    for (let index = 0; index < samples.length; index += channels)
      if (samples[index]! + samples[index + 1]! + samples[index + 2]! > 0) lit += 1
    expect(lit).toBeGreaterThan(0)
    // The existing per-fragment world mask hides all geometry outside the requested rectangle.
    const visibilityBounds = [100000, 100000, 100001, 100001]
    const masked = await render({ visibilityBounds })
    expect(masked.data['visibilityBounds']).toEqual(visibilityBounds)
    for (let offset = 0; offset < masked.decoded.samples.length; offset += masked.decoded.channels) {
      expect(Array.from(masked.decoded.samples.slice(offset, offset + 3))).toEqual([0, 0, 0])
      if (masked.decoded.channels === 4) expect(masked.decoded.samples[offset + 3]).toBe(255)
    }
    expect((await render({})).decoded.samples).toEqual(shown.decoded.samples)
    const invalidBounds = await client.callTool({ name: 'modkit.world_scene', arguments: {
      handle, view: 'render', width: 96, height: 64, visibilityBounds: [1, 0, 0, 1],
    } })
    expect(invalidBounds.isError).toBe(true)
    // another camera draws another picture of the same world
    const explicitAll = await render({ resourceIds: ['uvw-resource:main/model-a', 'uvw-resource:main/model-b'] })
    expect(explicitAll.decoded.samples).toEqual(shown.decoded.samples)
    expect(explicitAll.data['models']).toEqual(shown.data['models'])
    const subset = await render({ resourceIds: ['uvw-resource:main/model-a'] })
    // The subset counts only the selected advertised resource; the resolved-model test below verifies loading.
    expect(subset.data['models']).toMatchObject({ total: 1 })
    const invalidSubset = await client.callTool({ name: 'modkit.world_scene',
      arguments: { handle, view: 'render', width: 96, height: 64, resourceIds: [] } })
    expect(invalidSubset.isError).toBe(true)
    const turned = await render({ azimuth: 0.4, elevation: 1.2, zoom: 2 })
    expect(turned.data['camera']).toMatchObject({ azimuth: 0.4, elevation: 1.2, zoom: 2 })
    expect(turned.decoded.samples.some((value, index) => value !== samples[index])).toBe(true)
  } finally {
    await Promise.allSettled([client.close(), app.dispose()])
    await host.close()
  }
}, 120000)





it('loads only selected public world resources and hides the other model instances', async () => {
  const realHost=await createHostMcpPort({roots:[dirname(fixture)],extensions:[]})
  const requests:string[]=[]
  const host={...realHost,async open(...args:Parameters<typeof realHost.open>) {
    const opened=await realHost.open(...args)
    if(opened.session===undefined)return opened
    const session=opened.session
    return {...opened,session:{...session,descriptor:()=>session.descriptor(),async dataSource(...sourceArgs:Parameters<typeof session.dataSource>){
      const lease=await session.dataSource(...sourceArgs)
      if(sourceArgs[0]!=='common.view/world-scene-source')return lease
      const source=lease.value as import('@modkit/sdk/maps').WorldSceneSource
      return {...lease,value:{...source,async page(request:import('@modkit/sdk/maps').WorldScenePageRequest,signal?:AbortSignal){
        const page=await source.page(request,signal)
        return {...page,items:page.items.map(item=>item.facet==='resources' && item.kind==='uvm'?{...item,resolved:true,modelResource:{id:item.id,logicalId:item.id,role:'model',scopes:['current-mount']}}:item)}
      },async model(id:string){requests.push(id);return {state:'converted' as const,sourceKey:id,complete:true,diagnostics:[],meshes:[],primitives:[{
        id:'triangle',topology:'triangles' as const,positions:Float32Array.of(-0.5,0,0,0.5,0,0,0,1,0),materialId:'mat'}],materials:[{id:'mat',baseColor:[1,0,0,1] as const}]}}
    }}},dispose:()=>session.dispose?.()} as unknown as typeof session}
  }}
  const app=createModkitMcpServer(host),client=new Client({name:'world-subset',version:'1'})
  const [a,b]=InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([client.connect(a),app.server.connect(b)])
    const opened=await client.callTool({name:'modkit.open_subject',arguments:{path:fixture}})
    const handle=((opened.structuredContent as McpEnvelope).data as {handle:string}).handle
    const draw=async(resourceIds?:string[])=>{
      const result=await client.callTool({name:'modkit.world_scene',arguments:{handle,view:'render',width:96,height:64,...(resourceIds===undefined?{}:{resourceIds})}})
      if(result.isError)throw Error(JSON.stringify(result.structuredContent))
      const picture=result.content.find(item=>item.type==='image')!
      if(picture.type!=='image')throw Error('missing picture')
      return {data:(result.structuredContent as McpEnvelope).data as Record<string,unknown>,image:picture.data}
    }
    const full=await draw();expect([...requests].sort()).toEqual(['uvw-resource:main/model-a','uvw-resource:main/model-b'])
    requests.length=0
    const subset=await draw(['uvw-resource:main/model-a'])
    expect(requests).toEqual(['uvw-resource:main/model-a'])
    expect(subset.image).not.toBe(full.image)
    expect(subset.data['models']).toMatchObject({total:1,converted:1})
  } finally {await Promise.allSettled([client.close(),app.dispose()]);await realHost.close()}
},120000)

it('samples export frames once and loads the union of their models, including a late actor', async () => {
  const realHost = await createHostMcpPort({ roots: [dirname(fixture)], extensions: [], outputArtifacts: true })
  const acquisitions: string[] = [], samples: number[] = []
  const host = { ...realHost, async open(...args: Parameters<typeof realHost.open>) {
    const opened = await realHost.open(...args)
    if (opened.session === undefined) return opened
    const session = opened.session
    return { ...opened, session: { ...session, descriptor: () => session.descriptor(),
      async dataSource(...sourceArgs: Parameters<typeof session.dataSource>) {
        const lease = await session.dataSource(...sourceArgs)
        if (sourceArgs[0] !== 'common.view/world-scene-source') return lease
        const source = lease.value as import('@modkit/sdk/maps').WorldSceneSource
        return { ...lease, value: { ...source, snapshotId: undefined,
          async page(request: import('@modkit/sdk/maps').WorldScenePageRequest, signal?: AbortSignal) {
            const page = await source.page(request, signal)
            return { ...page, items: page.items.map(item => item.facet === 'resources' && item.kind === 'uvm'
              ? { ...item, resolved: true, modelResource: { id: item.id, logicalId: item.id, role: 'model', scopes: ['current-mount'] } } : item) }
          },
          async frame(timeMs: number) {
            samples.push(timeMs)
            return { snapshotId: source.snapshotId, timeMs, complete: true, diagnostics: [],
              camera: { eye: [0, 1, 3], target: [0, 0.5, 0], up: [0, 1, 0], near: 0.1, far: 10, verticalFieldOfView: 0.8 },
              objects: [{ facet: 'objects', id: 'actor', layerId: 'objects', coordinateSpaceId: 'main', kind: 'doodad',
                objectId: 1, typeId: 'Actor', position: { x: 0, y: 0, z: 0 }, uvwPosition: { x: 0, y: 0, z: 0 },
                resourceId: `uvw-resource:main/model-${timeMs === 0 ? 'a' : 'b'}` }] }
          },
          async model(id: string) {
            acquisitions.push(id)
            return { state: 'converted', sourceKey: id, complete: true, diagnostics: [], meshes: [],
              primitives: [{ id: 'triangle', topology: 'triangles', positions: Float32Array.of(-0.5,0,0,0.5,0,0,0,1,0), materialId: 'mat' }],
              materials: [{ id: 'mat', baseColor: id.endsWith('a') ? [1,0,0,1] : [0,1,0,1] }] }
          },
        } }
      }, dispose: () => session.dispose?.() } as unknown as typeof session }
  } }
  const app = createModkitMcpServer(host), client = new Client({ name: 'world-frame-union', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([client.connect(a), app.server.connect(b)])
    const opened = await client.callTool({ name: 'modkit.open_subject', arguments: { path: fixture } })
    const handle = ((opened.structuredContent as McpEnvelope).data as { handle: string }).handle
    const render = await client.callTool({ name: 'modkit.world_scene', arguments: { handle, view: 'render', timeMs: 0, camera: 'source', width: 96, height: 64 } })
    expect(render.isError, JSON.stringify(render.structuredContent)).not.toBe(true)
    expect(acquisitions).toEqual(['uvw-resource:main/model-a'])
    acquisitions.length = 0; samples.length = 0
    const animation = await client.callTool({ name: 'modkit.world_scene', arguments: { handle, view: 'animation', format: 'webp', startMs: 0, durationMs: 1000, fps: 2, camera: 'source', width: 96, height: 64, visibilityBounds: [-1, -1, 1, 1] } })
    expect(animation.isError, JSON.stringify(animation.structuredContent)).not.toBe(true)
    expect(samples).toEqual([0, 500])
    expect([...acquisitions].sort()).toEqual(['uvw-resource:main/model-a', 'uvw-resource:main/model-b'])
    const data = (animation.structuredContent as McpEnvelope).data as { outputArtifact: { firstChunkUri: string } }
    expect(data).toMatchObject({ frameCount: 2, mediaType: 'image/webp', models: { total: 2, converted: 2 }, visibilityBounds: [-1, -1, 1, 1] })
    const resource = await client.readResource({ uri: data.outputArtifact.firstChunkUri })
    const chunk = resource.contents[0] as { blob: string }
    expect(Buffer.from(chunk.blob, 'base64').subarray(8, 12).toString()).toBe('WEBP')
  } finally { await Promise.allSettled([client.close(), app.dispose()]); await realHost.close() }
}, 120000)






