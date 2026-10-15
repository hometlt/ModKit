import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeLatticeRunRows } from '../dist/maps/lattice-overview.js'

test('RLE owner encodes and validates finite row-major runs without losing scalar transitions',()=>{
 assert.deepEqual(encodeLatticeRunRows(3,2,(x,y)=>y+x%2),[[[1,0],[1,1],[1,0]],[[1,1],[1,2],[1,1]]])
 assert.throws(()=>encodeLatticeRunRows(3,2,()=>NaN),/Nonfinite/)
 assert.throws(()=>encodeLatticeRunRows(4_194_305,1,()=>0),/budget/)
})
