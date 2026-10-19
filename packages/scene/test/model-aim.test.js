import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyModelAimConstraints } from '../src/model/aim.js'
import { createModelSceneSampler } from '../src/model/sampler.js'
import { createModelSkeletonNodes } from '@modkit/codec-kit/model/skeleton'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer } from '@modkit/uv/model/container'
import { readUvmModel } from '../src/uvm/model.js'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
const translate = x => [...identity.slice(0, 12),x,0,0,1]
const close = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value-expected[i]) < 1e-5, `${actual} != ${expected}`))
const bones = [0,1,2].map(index => ({ partId:'body', hierarchyId:'rig', boneIndex:index,
  sourceBoneIndex: index === 0 ? 10 : index === 1 ? 42 : 77,
  boneName:'joint'+index, nodeId:'joint'+index, provenance:'direct', parentBoneIndex:index===0?null:index-1,
  inverseBindMatrix:translate(-index), localPose:{translation:[index===0?0:1,0,0],rotation:[0,0,0,1],scale:[1,1,1]} }))
const pose = bones.map((bone,index)=>({boneIndex:index,nodeId:bone.nodeId,worldMatrix:translate(index),skinningMatrix:identity}))
const constraint = extra => ({ nodeId:'joint1', forwardMatrix:identity, yaw:{weight:1},pitch:{weight:1},target:[1,1,0],weight:1,...extra })

test('aims a joint and descendants about their pivot without turning the actor or mutating source poses', () => {
  const before=structuredClone(pose)
  const result=applyModelAimConstraints(pose,bones,[constraint()],Float32Array.from(identity),1<<20)
  assert.equal(result[0],pose[0])
  close(result[1].worldMatrix.slice(12,15),[1,0,0])
  close(result[2].worldMatrix.slice(12,15),[1,1,0])
  close(result[1].worldMatrix.slice(0,3),[0,1,0])
  assert.deepEqual(pose,before)
  const restored=applyModelAimConstraints(pose,bones,[],Float32Array.from(identity),1<<20)
  assert.equal(restored,pose)
})

test('honors axis limits and both authored weights, and refuses malformed or over-budget aim data', () => {
  const limited=constraint({yaw:{weight:0.5,limits:[-Math.PI/4,Math.PI/4]},weight:0.5})
  const result=applyModelAimConstraints(pose,bones,[limited],Float32Array.from(identity),1<<20)
  close(result[1].worldMatrix.slice(0,3),[Math.cos(Math.PI/16),Math.sin(Math.PI/16),0])
  assert.throws(()=>applyModelAimConstraints(pose,bones,[constraint({target:[NaN,0,0]})],Float32Array.from(identity),1<<20),/invalid/)
  assert.throws(()=>applyModelAimConstraints(pose,bones,[constraint()],Float32Array.from(identity),0),/budget/)
  assert.throws(()=>applyModelAimConstraints(pose,bones,[constraint()],Float32Array.from(identity),1<<20,AbortSignal.abort()),/abort/i)
})

test('the common scene sampler applies aiming to its joint transforms and restores animation on seek', () => {
  const projection={nodes:createModelSkeletonNodes(bones,'rig'),meshes:[],primitives:[],skeleton:bones}
  for(const skinning of ['cpu','gpu']){
    const sampler=createModelSceneSampler(projection,{skinning})
    const aimed=sampler.sample(0,undefined,undefined,undefined,[constraint()])
    close([...aimed.nodeTransforms.get('joint2')].slice(12,15),[1,1,0])
    close([...sampler.sample(0).nodeTransforms.get('joint2')].slice(12,15),[2,0,0])
  }
})

test('UVM preserves original joint ordinals independently of reordered dense skin slots', () => {
  const nodes=createModelSkeletonNodes(bones,'rig')
  const exported=materializeUvmCore({info:{scenes:1,nodes:3,meshes:0,primitives:0,materials:0,textures:0,animations:0,geometryAccess:'decoded'},
    nodes,meshes:[],primitives:[],skeleton:bones},
    {scope:{scopeId:'model-interchange-v1',version:'1.0.0'},profile:'UVM/core@1.0',subjectRevision:'provider-token:aim',options:{assetId:'fixture/aim',sourceFormat:'test'}})
  const container=readUvmContainer(exported.bytes)
  assert.deepEqual(container.document.skins[0].extensions.UV_game_skeleton.sourceOrder,[10,42,77])
  const model=readUvmModel(container.document,container.binary,{maxScalarBytes:1<<20})
  assert.deepEqual(model.rig.bindings.map(bone=>[bone.boneIndex,bone.sourceBoneIndex]),[[0,10],[1,42],[2,77]])
  const invalid=structuredClone(container.document)
  invalid.skins[0].extensions.UV_game_skeleton.sourceOrder=[10,10,77]
  assert.throws(()=>readUvmModel(invalid,container.binary,{maxScalarBytes:1<<20}),/sourceOrder/)
  assert.throws(()=>materializeUvmCore({info:{scenes:1,nodes:3,meshes:0,primitives:0,materials:0,textures:0,animations:0,geometryAccess:'decoded'},
    nodes,meshes:[],primitives:[],skeleton:bones.map(bone=>({...bone,sourceBoneIndex:10}))},
    {scope:{scopeId:'model-interchange-v1',version:'1.0.0'},profile:'UVM/core@1.0',subjectRevision:'provider-token:aim',options:{assetId:'fixture/aim',sourceFormat:'test'}}),/ordinals/)
})

test('world instances resolve canonical targets through their placement and keep independent aimed poses', () => {
  const nodes=createModelSkeletonNodes(bones,'rig')
  const indices=new Uint16Array([2,0,0,0,2,0,0,0,2,0,0,0])
  const weights=new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0])
  const model={state:'converted',nodes,meshes:[{id:'mesh',primitiveIds:['tri']}],skeleton:bones,
    primitives:[{id:'tri',meshId:'mesh',partId:'body',hierarchyId:'rig',topology:'triangles',
      positions:Float32Array.of(2,0,0,2,0.1,0,2,0,0.1),indices:Uint32Array.of(0,1,2),boneIndices:indices,boneWeights:weights,boneInfluences:4}],
    nodeBehaviours:[{id:'head',name:'Head',kind:'aim',aim:{parts:[constraint()]}}]}
  const object=(id,x,y)=>({facet:'objects',id:String(id),objectId:id,layerId:'objects',coordinateSpaceId:'uvw',kind:'doodad',resourceId:'model',
    position:{x,y:0,z:0},uvwPosition:{x,y:0,z:0},uvwScale:{x:2,y:2,z:2},
    presentationAim:[{group:'Head',target:[x+2,y,0],weight:1}]})
  const plan=createWorldWebGlPlan({items:[object(1,10,2),object(2,20,-2)],models:new Map([['model',model]])})
  const positions=[...plan.opaqueTriangles.positions]
  assert.equal(positions.length,18)
  close(positions.slice(0,3),[12,2,0])
  close(positions.slice(9,12),[22,-2,0])
})
