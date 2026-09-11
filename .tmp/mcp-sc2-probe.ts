import { resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { createHostMcpPort, createModkitMcpServer } from '../apps/mcp/src/index.js'
const workspace=resolve('..','modkit-extensions-blizzard'); const map='C:/Apps/StarCraft II/Maps/all-races-coop-maps/02-CradleOfDeath.SC2Map'
const host=await createHostMcpPort({roots:[resolve(map,'..')],extensions:[resolve(workspace,'mpq'),resolve(workspace,'starcraft2')]}, d=>console.error('DIAG',d.code,d.message))
const app=createModkitMcpServer(host); const [ct,st]=InMemoryTransport.createLinkedPair(); const client=new Client({name:'probe',version:'1'}); await Promise.all([app.server.connect(st),client.connect(ct)])
const call=async(name,args)=>{const r=await client.callTool({name,arguments:args}); console.log(name,JSON.stringify(r.structuredContent)?.slice(0,4000)); return r.structuredContent}
const opened=await call('modkit.open_subject',{path:map}); const data=opened.data; let handle=data.handle; if(data.selectionCandidates?.length){const candidate=data.selectionCandidates.find(x=>String(x.codecId).includes('sc2-map'))??data.selectionCandidates[0]; const selected=await call('modkit.open_selection',{handle,selectionId:candidate.candidateId}); handle=selected.data.handle}
await call('modkit.inspect',{handle}); await call('modkit.invoke_readonly',{handle,operationId:'blizzard/sc2-map.world',input:{}}); await call('modkit.subject_facts',{handle,view:'summary',limit:10}); await call('modkit.relation_graph',{handle,view:'summary',limit:10}); await client.close(); await app.dispose(); await host.close()
