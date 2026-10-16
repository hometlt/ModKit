import { expect, it } from 'vitest'
import { unretainedWorldFields } from '../src/world/index.js'
it('reports present zero, false and empty collections while omission stays absent', () => {
 const input=Object.freeze({zero:0,flag:false,empty:[],missing:undefined})
 expect(unretainedWorldFields(input,()=>false)).toEqual(['zero','flag','empty'])
 expect(input).toEqual({zero:0,flag:false,empty:[],missing:undefined})
})
it('lets each target retain exact values without changing the source record', () => {
 const input={a:0,b:false,c:[1,2]}
 expect(unretainedWorldFields(input,(key,value)=>key==='a'&&value===0||key==='b'&&value===false)).toEqual(['c'])
 expect(unretainedWorldFields(input,()=>true)).toEqual([])
})
