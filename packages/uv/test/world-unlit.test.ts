import { expect,it } from 'vitest'
import { createWorldWebGlPlan } from '../../scene/src/world/webgl.js'
import { createUvwWorldSceneSource,materializeWorldToUvw,materializeWorldToUvpMap,openUvpMapBundle,parseUvwProfile,serializeUvwProfile,validateUvwProfile,type UvwProfileDocument,type UvwLightingLayer } from '../src/world/index.js'
const options={maxPageItems:8,maxTerrainItems:16,maxFacetItems:128,maxOutputBytes:1<<20,packageId:'test/unlit-world',packageVersion:'1.0.0',maxTextureBytes:128,maxMediaBytes:128}
function input(policy:Pick<UvwLightingLayer,'model'|'unlitColor'>={}):UvwProfileDocument {
 return {uv:{format:'UVW',version:'1.0',status:'profile'},connections:[],spaces:[{id:'main',topology:'heightfield',basis:{handedness:'right',upAxis:'y',forwardAxis:'+z',unit:'meter'},bounds:{min:[0,0,0],max:[1,0,1]},layers:[
  {kind:'heightfield',id:'ground',columns:2,rows:2,cellSize:1,origin:[0,0,0],samples:[[0,0],[0,0]]},
  {schemaVersion:1,kind:'lighting',id:'lighting',...policy,ambientColor:[0.2,0.3,0.4],ambientIntensity:0.3,directional:[{id:'sun',direction:[0,-1,0],color:[1,1,1],intensity:0.8,specularIntensity:0.9}]},
 ]}]}
}
it.each([{model:'unlit' as const,unlitColor:[2,0,0.5] as const},{model:'unlit' as const},{model:'lit' as const,unlitColor:[0,1,4] as const},{}])('retains the explicit lighting policy and HDR gain, with omitted defaults staying omitted: %j',async policy=>{
 const original=validateUvwProfile(input(policy)),bytes=serializeUvwProfile(original)
 expect(parseUvwProfile(bytes)).toEqual(original)
 const source=createUvwWorldSceneSource(original,{snapshotId:'unlit'}),info=await source.info(),facet=info.facets.find(facet=>facet.facet==='lighting')!
 const page=await source.page({facet:'lighting',layerId:facet.layerId,lod:'exact',limit:8}),light=page.items[0]!
 if(light.facet!=='lighting')throw new Error('no lighting environment')
 expect(Object.hasOwn(light,'model')).toBe(Object.hasOwn(policy,'model'))
 expect(Object.hasOwn(light,'unlitColor')).toBe(Object.hasOwn(policy,'unlitColor'))
 expect(light.model).toBe(policy.model);expect(light.unlitColor).toEqual(policy.unlitColor)
 const plan=createWorldWebGlPlan({items:page.items,models:new Map()})
 if(policy.model==='unlit'){
  expect(plan.light.ambient).toEqual(policy.unlitColor??[1,1,1]);expect(plan.light.ambientIntensity).toBe(1)
  expect(plan.light.intensity).toBe(0);expect(plan.light.specularIntensity).toBe(0);expect(plan.light.fills).toEqual([])
 }
 const packed=await materializeWorldToUvpMap(source,options)
 if(packed.state!=='materialized')throw new Error(JSON.stringify(packed.refusals))
 expect(packed.document).toEqual(original)
 const opened=await openUvpMapBundle(new Map([...packed.entries].map(([path,data])=>[path,data.slice()])),{snapshotId:'detached-unlit'}),again=await materializeWorldToUvw(opened.source,options)
 if(again.state!=='materialized')throw new Error(JSON.stringify(again.refusals))
 expect(serializeUvwProfile(again.document)).toEqual(bytes)
})
it('refuses unknown lighting models and invalid multipliers without clamping valid gains',()=>{
 for(const model of ['none','UNLIT',null,0]){
  const value=structuredClone(input()) as any;value.spaces[0].layers[1].model=model;expect(()=>validateUvwProfile(value)).toThrow()
 }
 for(const color of [[-1,1,1],[NaN,0,0],[Infinity,1,1],[1,1],['1',1,1]]){
  const value=structuredClone(input()) as any;value.spaces[0].layers[1].unlitColor=color;expect(()=>validateUvwProfile(value)).toThrow()
 }
})
