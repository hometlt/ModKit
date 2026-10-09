import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compressPortable } from '@modkit/codec-kit/compression/bounded'
import { compactRepositoryManifest, decodeRepositoryArtifact, normalizeRepositoryManifest } from '../dist/index.js'
import { createNodeArtifactAcquirer, createNodeArtifactStore, createNodeExtensionManager } from '../dist/node.js'

const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const encode = value => Buffer.from(value).toString('base64')
const document = (id='example/one',version='1.0.0',value='first') => ({schemaVersion:1,extensions:[{id,files:{
  'package.json':encode(JSON.stringify({name:`@${id}`,version,type:'module',modkit:{publisher:'example',id:id.split('/')[1]}})),
  'dist/value.js':encode(`export const value = ${JSON.stringify(value)}\n`),
}}]})
const plain = value => Buffer.from(JSON.stringify(value))
const request = (bytes,id='example/one',version='1.0.0') => ({
  entry:{id,displayName:id,publisher:'example',version,extensions:[id],remote:false,trusted:true,
    source:{kind:'bundle',uri:'memory:/package.json.gz',bytes:bytes.length,integrity:digest(bytes),trust:{mode:'local-user'}}},
  artifact:{kind:'portable-repository',bytes},integrity:digest(bytes),
})
async function temporary(t) {
  const root=await mkdtemp(join(tmpdir(),'modkit-repository-gzip-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  return root
}

test('plain and gzip transports preserve both repository formats within independent document bounds', async()=>{
  for(const value of [document(),compactRepositoryManifest(document())]){
    const bytes=plain(value),gzip=await compressPortable(bytes,'gzip')
    assert.strictEqual(await decodeRepositoryArtifact(bytes,{maxDocumentBytes:bytes.length}),bytes)
    assert.deepEqual(await decodeRepositoryArtifact(gzip,{maxDocumentBytes:bytes.length}),new Uint8Array(bytes))
    for(const transport of [bytes,gzip])await assert.rejects(decodeRepositoryArtifact(transport,{maxDocumentBytes:bytes.length-1}),{code:'extension-manager/artifact-document-limit'})
  }
})

test('gzip rejects malformed streams, invalid limits and cancelled reads without returning partial JSON',async()=>{
  const gzip=await compressPortable(plain(document()),'gzip')
  for(const bytes of [new Uint8Array([0x1f,0x8b]),gzip.slice(0,-8)])await assert.rejects(decodeRepositoryArtifact(bytes))
  for(const maximum of [0,-1,NaN,Infinity,1.5])await assert.rejects(decodeRepositoryArtifact(gzip,{maxDocumentBytes:maximum}),RangeError)
  const aborted=new AbortController();aborted.abort(new Error('cancelled before decode'))
  await assert.rejects(decodeRepositoryArtifact(gzip,{signal:aborted.signal}),/cancelled before decode/)
  const during=new AbortController()
  const pending=decodeRepositoryArtifact(gzip,{signal:during.signal});during.abort(new Error('cancelled during decode'))
  await assert.rejects(pending,/cancelled during decode/)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(await decodeRepositoryArtifact(gzip))),document())
})

test('managed gzip preserves transport integrity, exact roots and expanded file limits before publication',async t=>{
  const root=await temporary(t),json=plain(compactRepositoryManifest(document())),gzip=await compressPortable(json,'gzip')
  const store=createNodeArtifactStore({root,maxRepositoryDocumentBytes:json.length-1})
  await assert.rejects(store.install(request(gzip)),{code:'extension-manager/artifact-document-limit'})
  await assert.rejects(store.install({...request(new Uint8Array([0x1f,0x8b])),integrity:digest(gzip)}),{code:'extension-manager/integrity-mismatch'})
  assert.deepEqual(await store.list(),[])
  assert.deepEqual(await readdir(root),[])
  const bounded=createNodeArtifactStore({root,maxRepositoryDocumentBytes:json.length,maxMaterializedBytes:1})
  await assert.rejects(bounded.install(request(gzip)),{code:'extension-manager/artifact-byte-limit'})
  assert.deepEqual(await bounded.list(),[])
  assert.deepEqual(await readdir(join(root,'.staging')),[])
  const valid=createNodeArtifactStore({root,maxRepositoryDocumentBytes:json.length})
  const installed=await valid.install(request(gzip))
  assert.equal(await readFile(join(installed.roots[0].root,'dist/value.js'),'utf8'),'export const value = "first"\n')
  assert.deepEqual(await valid.install(request(gzip)),installed)
  const bad=structuredClone(document());bad.extensions[0].files['../outside.js']=encode('escaped')
  await assert.rejects(createNodeArtifactStore({root}).install(request(await compressPortable(plain(bad),'gzip'))),error=>/path/.test(error.code))
  assert.deepEqual(await valid.list(),[installed])
})

test('gzip acquisition checks original size and digest before decode, including offline memory sources',async t=>{
  const gzip=await compressPortable(plain(document()),'gzip')
  const input=request(gzip)
  const acquirer=createNodeArtifactAcquirer({vfsOptions:{memoryEntries:{'package.json.gz':gzip}}})
  t.after(()=>acquirer.dispose())
  const acquired=await acquirer.acquire(input.entry)
  assert.equal(acquired.integrity,digest(gzip))
  assert.deepEqual(acquired.artifact.bytes,new Uint8Array(gzip))
  await assert.rejects(acquirer.acquire({...input.entry,source:{...input.entry.source,bytes:gzip.length+1}}),{code:'extension-manager/artifact-size-mismatch'})
  await assert.rejects(acquirer.acquire({...input.entry,source:{...input.entry.source,integrity:digest(plain(document()))}}),{code:'extension-manager/integrity-mismatch'})
})

test('managed decode pins verified bytes when caller storage changes at an async boundary',async t=>{
  for(const compressed of [false,true]){
    const bytes=compressed?await compressPortable(plain(document()),'gzip'):new Uint8Array(plain(document()))
    const input=request(bytes)
    const borrowed={kind:'portable-repository',get bytes(){queueMicrotask(()=>bytes.fill(0));return bytes}}
    const store=createNodeArtifactStore({root:await temporary(t)})
    const installed=await store.install({...input,artifact:borrowed})
    assert.match(await readFile(join(installed.roots[0].root,'dist/value.js'),'utf8'),/first/)
    assert(bytes.every(value=>value===0))
  }
})

test('public Node manager forwards the decoded ceiling independently of compressed acquisition',async t=>{
  const gzip=await compressPortable(plain(document()),'gzip'),input=request(gzip)
  const catalog={schemaVersion:1,registryId:'example/test',generatedAt:'2026-10-09T00:00:00.000Z',packages:[{
    id:'example/one',publisher:'example',displayName:'one',summary:'Decoded document ceiling fixture.',versions:[{version:'1.0.0',channel:'development',source:input.entry.source,extensions:['example/one']}],
  }]}
  const cached=async()=>({catalog,source:'memory:/catalog.json',signatureVerified:false})
  const manager=createNodeExtensionManager({root:await temporary(t),catalogSource:{cached,refresh:cached},
    vfsOptions:{memoryEntries:{'package.json.gz':gzip}},maxRepositoryDocumentBytes:1})
  t.after(()=>manager.dispose())
  await manager.refresh()
  await assert.rejects(manager.install('example/one'),{code:'extension-manager/artifact-document-limit'})
  assert.deepEqual(await manager.installedRoots(),[])
})

test('gzip upgrade, retained-artifact rollback and uninstall preserve a sibling package',async t=>{
  const store=createNodeArtifactStore({root:await temporary(t)})
  const first=request(await compressPortable(plain(document()),'gzip'))
  const saved=await store.install(first)
  const siblingRequest=request(await compressPortable(plain(document('example/two')),'gzip'),'example/two')
  const sibling=await store.install(siblingRequest)
  const next=request(await compressPortable(plain(document('example/one','2.0.0','second')),'gzip'),'example/one','2.0.0')
  const updated=await store.install(next)
  assert.notEqual(updated.roots[0].root,saved.roots[0].root)
  assert.match(await readFile(join(saved.roots[0].root,'dist/value.js'),'utf8'),/first/)
  assert.match(await readFile(join(updated.roots[0].root,'dist/value.js'),'utf8'),/second/)
  assert.deepEqual(await store.install(first),saved)
  await store.remove('example/one')
  assert.deepEqual(await store.list(),[sibling])
  assert.match(await readFile(join(sibling.roots[0].root,'dist/value.js'),'utf8'),/first/)
})

test('compact CLI gzip selection and gzip input preserve schemas, exclusive output and old JSON default',async t=>{
  const root=await temporary(t),input=join(root,'input.json'),gzipPath=join(root,'output.gz'),jsonPath=join(root,'output.json')
  await writeFile(input,plain(document()))
  const run=args=>spawnSync(process.execPath,[join(import.meta.dirname,'../dist/cli.js'),'compact',...args],{encoding:'utf8'})
  const args=['--input',input,'--out',gzipPath,'--extension','example/one','--compression','gzip']
  const result=run(args);assert.equal(result.status,0,result.stderr)
  const gzip=await readFile(gzipPath);assert.equal(gzip[0],0x1f)
  const decoded=JSON.parse(new TextDecoder().decode(await decodeRepositoryArtifact(gzip)))
  assert.deepEqual(normalizeRepositoryManifest(decoded),normalizeRepositoryManifest(document()))
  assert.notEqual(run(args).status,0);assert.deepEqual(await readFile(gzipPath),gzip)
  const legacy=run(['--input',gzipPath,'--out',jsonPath]);assert.equal(legacy.status,0,legacy.stderr)
  assert.deepEqual(JSON.parse(await readFile(jsonPath,'utf8')),decoded)
  assert.notEqual(run(['--input',gzipPath,'--out',join(root,'too-small.json'),'--max-document-bytes','1']).status,0)
  const explicit=run(['--input',gzipPath,'--out',join(root,'explicit.json'),'--max-document-bytes',String(JSON.stringify(decoded).length+1)])
  assert.equal(explicit.status,0,explicit.stderr)
  assert.notEqual(run(['--input',input,'--out',join(root,'bad'),'--compression','zip']).status,0)
})
