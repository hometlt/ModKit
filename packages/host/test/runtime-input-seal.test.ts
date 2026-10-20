/** The canonical capture owner seals a finite plan; native completeness is a separate planner obligation. */
import {describe,expect,it} from 'vitest'
import type {ResourceBudget} from '@modkit/sdk'
import {sealRuntimeInputPlan, type RuntimeInputPlanLayer} from '../src/runtime/source-snapshot.js'

const text=new TextEncoder(),decode=(bytes:Uint8Array)=>new TextDecoder().decode(bytes)
const budget:ResourceBudget={maxInputBytes:4096n,maxNodes:128,maxDepth:8,maxScalarBytes:1024,maxDiagnostics:16}
/** Same closed prefixes in both layers, including an exact metadata file outside a data directory. */
const plan=()=>['base','patch'].map((id,index)=>({
 layer:{id,sourceId:'captured',sourcePath:id,displayName:id,role:index===0?'dependency' as const:'primary' as const,provenance:'declared' as const},
 scopes:['Data','GameData.xml','Empty.xml'],files:[
  {path:'Data/Unit.xml',bytes:text.encode(index===0?'base unit':'patch unit')},
  {path:'GameData.xml',bytes:text.encode('<Includes/>')},
 ],
})) satisfies RuntimeInputPlanLayer[]

describe('finite Runtime input namespace',()=>{
 it('owns caller bytes, metadata and layer order before its first await',async()=>{
  const supplied=plan(),opening=sealRuntimeInputPlan('test/game','capture',supplied,budget)
  supplied[1]!.files[0]!.bytes.fill(0);supplied.reverse();supplied[0]!.files.length=0
  const capture=await opening
  try{
   expect(capture.layers.map(layer=>layer.id)).toEqual(['base','patch'])
   expect(await capture.locate('data/UNIT.xml')).toEqual({layerId:'patch',path:'Data/Unit.xml'})
   const bytes=await capture.read('patch','Data/Unit.xml',64);expect(decode(bytes)).toBe('patch unit');bytes.fill(0)
   expect(decode(await capture.read('patch','Data/Unit.xml',64))).toBe('patch unit')
   expect(decode(await capture.read('patch','Data\\Unit.xml',64))).toBe('patch unit')
   expect((await capture.files('base',{prefix:'Data/',limit:8})).items).toEqual(['Data/Unit.xml'])
   expect(capture.overlay).toBeUndefined();expect(capture.query).toBeUndefined()
  }finally{await capture.dispose()}
 })

 it('retains and reads an exact scope root through every existing context path',async()=>{
  const capture=await sealRuntimeInputPlan('test/game','capture',plan(),budget)
  try{
   expect((await capture.files('base',{prefix:'GameData.xml',limit:8})).items).toEqual(['GameData.xml'])
   expect(await capture.locate('GAMEDATA.XML')).toEqual({layerId:'patch',path:'GameData.xml'})
   expect(decode(await capture.read('base','GameData.xml',64))).toBe('<Includes/>')
   expect(decode((await capture.readWithContext!('base','GameData.xml',64)).bytes)).toBe('<Includes/>')
   const range=await capture.openRangeWithContext!('base','GameData.xml')
   expect(range).toBeDefined()
   try{expect(decode(await range!.source.readAt(0,11))).toBe('<Includes/>')}finally{await range!.source.dispose()}
  }finally{await capture.dispose()}
 })

 it('keeps scoped absence and paging fixed while refusing sibling and late inputs',async()=>{
  const capture=await sealRuntimeInputPlan('test/game','capture',plan(),budget)
  try{
   const first=await capture.files('base',{limit:1})
   expect(first.items).toEqual(['Data/Unit.xml']);expect(first.nextCursor).toBeDefined()
   expect((await capture.files('base',{limit:1,cursor:first.nextCursor!})).items).toEqual(['GameData.xml'])
   expect(await capture.locate('Empty.xml')).toBeUndefined()
   await expect(capture.read('base','Empty.xml',64)).rejects.toThrow()
   for(const path of ['GameData.xml.other','Database/Unit.xml','Late/Native.galaxy','../Data/Unit.xml']){
    await expect(capture.locate(path)).rejects.toThrow()
    await expect(capture.read('base',path,64)).rejects.toThrow()
    await expect(capture.files('base',{prefix:path,limit:8})).rejects.toThrow()
   }
  }finally{await capture.dispose()}
 })

 it('retires independent range leases and unpulled streams on capture disposal',async()=>{
  const capture=await sealRuntimeInputPlan('test/game','capture',plan(),budget)
  const first=await capture.openRangeWithContext!('patch','Data/Unit.xml')
  const second=await capture.openRangeWithContext!('patch','Data/Unit.xml')
  const stream=second!.source.stream().getReader()
  await first!.source.dispose()
  expect(decode(await second!.source.readAt(0,5))).toBe('patch')
  await expect(second!.source.readAt(0.5,1)).rejects.toThrow('integer')
  await capture.dispose();await capture.dispose()
  await expect(stream.read()).rejects.toThrow()
  await expect(second!.source.readAt(0,1)).rejects.toThrow()
  await expect(capture.locate('Data/Unit.xml')).rejects.toThrow()
 })

 it('cancels sealing and retires already acquired leases',async()=>{
  await expect(sealRuntimeInputPlan('test/game','capture',plan(),budget,AbortSignal.abort())).rejects.toThrow()
  const during=new AbortController(),opening=sealRuntimeInputPlan('test/game','capture',plan(),budget,during.signal)
  during.abort();await expect(opening).rejects.toThrow()
  const after=new AbortController(),capture=await sealRuntimeInputPlan('test/game','capture',plan(),budget,after.signal)
  const range=await capture.openRangeWithContext!('base','Data/Unit.xml')
  after.abort();await expect(range!.source.readAt(0,1)).rejects.toThrow();await capture.dispose()
 })

 it('rejects ambiguous members, mixed coverage, physical roots and missing payloads',async()=>{
  const duplicate=plan();duplicate[0]!.files.push({path:'data/UNIT.xml',bytes:text.encode('duplicate')})
  await expect(sealRuntimeInputPlan('test/game','capture',duplicate,budget)).rejects.toThrow('Duplicate')
  const outside=plan();outside[0]!.files.push({path:'Other.xml',bytes:text.encode('outside')})
  await expect(sealRuntimeInputPlan('test/game','capture',outside,budget)).rejects.toThrow('scope')
  const partial=plan();partial[1]!.scopes=['Data']
  await expect(sealRuntimeInputPlan('test/game','capture',partial,budget)).rejects.toThrow('same closed scopes')
  const physical=plan();physical[0]!.layer={...physical[0]!.layer,sourceId:'host'}
  await expect(sealRuntimeInputPlan('test/game','capture',physical,budget)).rejects.toThrow('case-insensitive')
  const missing=plan();Reflect.deleteProperty(missing[0]!.files[0]!,'bytes')
  await expect(sealRuntimeInputPlan('test/game','capture',missing,budget)).rejects.toThrow()
 })

 it('enforces shared byte/name/node budgets and includes order and content in identity',async()=>{
  await expect(sealRuntimeInputPlan('test/game','capture',plan(),{...budget,maxInputBytes:1n})).rejects.toThrow('byte')
  await expect(sealRuntimeInputPlan('test/game','capture',plan(),{...budget,maxNodes:1})).rejects.toThrow('node')
  await expect(sealRuntimeInputPlan('test/game','x'.repeat(1025),plan(),budget)).rejects.toThrow('bounded string')
  const first=await sealRuntimeInputPlan('test/game','capture',plan(),budget)
  const reversed=await sealRuntimeInputPlan('test/game','capture',plan().reverse(),budget)
  const changed=plan();changed[1]!.files[0]!.bytes[0]=0
  const third=await sealRuntimeInputPlan('test/game','capture',changed,budget)
  try{expect(first.revision).toMatch(/^sha256:[a-f0-9]{64}$/u);expect(first.revision).not.toBe(reversed.revision);expect(first.revision).not.toBe(third.revision)}
  finally{await first.dispose();await reversed.dispose();await third.dispose()}
 })
})
