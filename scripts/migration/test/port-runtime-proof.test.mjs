import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { captureRuntimeProof, verifyRuntimeProof } from '../lib/port-runtime-proof.mjs'

test('runtime evidence detects changed, added and removed implementation files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modkit-runtime-proof-'))
  t.after(() => rm(root, {recursive:true,force:true}))
  const file = path.join(root,'runtime.mjs')
  await writeFile(file,'export const value=1')
  const selection = {roots:[root]}
  const original = await captureRuntimeProof(selection)
  await verifyRuntimeProof(original,selection)
  await writeFile(file,'export const value=2')
  await assert.rejects(verifyRuntimeProof(original,selection),/runtime changed/u)
  await writeFile(file,'export const value=1')
  await writeFile(path.join(root,'extra.mjs'),'export const other=1')
  await assert.rejects(verifyRuntimeProof(original,selection),/runtime changed/u)
  const added = await captureRuntimeProof(selection)
  await rm(file)
  await assert.rejects(verifyRuntimeProof(added,selection),/runtime changed/u)
})

test('runtime evidence follows actual installed dependencies and records absent optional peers', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modkit-runtime-packages-'))
  t.after(() => rm(root, {recursive:true,force:true}))
  for (const [name,dependencies] of [['parent',{leaf:'1'}],['leaf',{}]]) {
    const directory=path.join(root,'node_modules',name)
    await mkdir(directory,{recursive:true})
    await writeFile(path.join(directory,'package.json'),JSON.stringify({name,version:'1',main:'index.js',dependencies,
      ...(name==='parent'?{peerDependencies:{absent:'1'},peerDependenciesMeta:{absent:{optional:true}}}:{})}))
    await writeFile(path.join(directory,'index.js'),'module.exports=1')
  }
  const selection={roots:[],packages:[{name:'parent',from:path.join(root,'adapter.mjs')}]}
  const proof=await captureRuntimeProof(selection)
  assert.deepEqual(proof.packages.map(item=>item.name).sort(),['leaf','parent'])
  assert.equal(proof.files.length,4)
  assert.equal(proof.omittedOptional[0].name,'absent')
  await verifyRuntimeProof(proof,selection)
  await writeFile(path.join(root,'node_modules','leaf','index.js'),'module.exports=2')
  await assert.rejects(verifyRuntimeProof(proof,selection),/runtime changed/u)
})
