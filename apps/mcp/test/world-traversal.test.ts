import {mkdir,writeFile,unlink,rmdir} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {Client,InMemoryTransport} from '@modelcontextprotocol/client'
import {expect,it} from 'vitest'
import {createHostMcpPort,createModkitMcpServer,type McpEnvelope} from '../src/index.js'

it('pages published traversal through the public MCP world tool and retains ramp provenance',async()=>{
  const directory=`C:/MKTEMP/modkit-mcp-traversal-${randomUUID()}`
  await mkdir(directory,{recursive:true})
  const path=directory+'/fixture.uvw'
  await writeFile(path,JSON.stringify({uv:{format:'UVW',version:'1.0',status:'profile'},connections:[],spaces:[{
    id:'main',topology:'heightfield',basis:{handedness:'right',upAxis:'y',forwardAxis:'+z',unit:'meter'},
    bounds:{min:[0,0,0],max:[1,1,1]},layers:[{
      id:'ground',kind:'heightfield',columns:2,rows:2,cellSize:1,origin:[0,0,0],samples:[[0,0],[1,1]],
      latticeRamps:{method:'fixture-two-bank',quality:'derived',polygons:[[[0,0],[1,0],[1,1],[0,1]]]},
    },{id:'ground-movement',kind:'traversal',schemaVersion:1,classId:'ground',columns:1,rows:1,
      cellSize:1,origin:[0,0,0],walkable:[[false]],exits:[[0]]}],
  }]}))
  const host=await createHostMcpPort({roots:[directory],extensions:[]})
  const app=createModkitMcpServer(host),client=new Client({name:'world-traversal',version:'1'})
  const [a,b]=InMemoryTransport.createLinkedPair()
  try{
    await Promise.all([client.connect(a),app.server.connect(b)])
    const opened=await client.callTool({name:'modkit.open_subject',arguments:{path}})
    expect(opened.isError).not.toBe(true)
    const handle=((opened.structuredContent as McpEnvelope).data as {handle:string}).handle
    const call=async(facet:string,layerId?:string)=>{
      const response=await client.callTool({name:'modkit.world_scene',arguments:{handle,view:'page',facet,limit:32,...(layerId===undefined?{}:{layerId})}})
      expect(response.isError,JSON.stringify(response.structuredContent)).not.toBe(true)
      return (response.structuredContent as McpEnvelope).data as {items:Record<string,unknown>[]}
    }
    const layers=await call('layers')
    expect(layers.items.find(l=>l['kind']==='terrain')?.['latticeRamps']).toMatchObject({method:'fixture-two-bank',quality:'derived'})
    const movement=layers.items.find(l=>l['kind']==='traversal')!
    const cells=await call('traversal',movement['layerId'] as string)
    expect(cells.items).toHaveLength(1)
    expect(cells.items[0]).toMatchObject({facet:'traversal',x:0,y:0,walkable:false,exits:0})
  }finally{
    await Promise.allSettled([client.close(),app.dispose()]);await host.close()
    await unlink(path);await rmdir(directory)
  }
},60000)
