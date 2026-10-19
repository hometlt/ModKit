import { expect, it } from 'vitest'
import type { ModelAnimationClip } from '@modkit/sdk'
import {
  chooseByWeight,
  createModelAnimationSampler,
  layeredClip,
  sampleModelAnimationLayers,
} from '../src/model/animation.js'

// a linear 0 → 1 move of one target over `seconds`
const move = (target: string, seconds: number) => ({
  target,
  kind: 'translation',
  firstFrame: 0,
  lastFrame: 1,
  interpolation: 'linear' as const,
  samples: [
    { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
    { frame: 1, timeSeconds: seconds, value: [1, 0, 0] },
  ],
})
const clip = (id: string, extra: Partial<ModelAnimationClip>): ModelAnimationClip => ({
  id,
  name: id,
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  channels: [],
  ...extra,
})
const at = (layered: ModelAnimationClip, time: number) =>
  Object.fromEntries(
    createModelAnimationSampler(layered)
      .sample(time)
      .map(value => [value.target, value.value[0]]),
  )

it('does not wrap the independent concurrent clock with its parent layer duration', () => {
  const source = clip('clock', { durationSeconds: 1, channels: [
    { ...move('arms', 2), concurrent: true, wrapSeconds: 2 }, move('legs', 1),
  ] })
  const layer = { clip: source, timeSeconds: 1.25, loop: true, priority: 0 }
  expect(at(sampleModelAnimationLayers([{ ...layer, globalTimeSeconds: 2.75 }]), 0))
    .toEqual({ arms: 0.375, legs: 0.25 })
  expect(at(sampleModelAnimationLayers([layer]), 0)).toEqual({ arms: 0.125, legs: 0.25 })
  expect(() => sampleModelAnimationLayers([{ ...layer, globalTimeSeconds: NaN }])).toThrow(/clock/)
})

it('layers clips by priority per target, each on its own clock', () => {
  // a run moves the legs and the arms; a carry, on top, moves the arms only
  const run = clip('run', {
    durationSeconds: 0.8,
    looping: true,
    channels: [move('legs', 0.8), move('arms', 0.8)],
  })
  const carry = clip('carry', {
    durationSeconds: 1.2,
    loop: 'loop',
    priority: 10,
    channels: [move('arms', 1.2)],
  })
  const layered = layeredClip([carry, run])
  // the arms are the carry's, the legs the run's, each wrapping by its own length
  expect(at(layered, 0.4)).toEqual({ legs: 0.5, arms: expect.closeTo(1 / 3, 6) })
  expect(at(layered, 1.0)).toEqual({
    legs: expect.closeTo(0.25, 6),
    arms: expect.closeTo(5 / 6, 6),
  })
  // the set loops when both line up again: 2.4 s
  expect(layered.durationSeconds).toBeCloseTo(2.4, 9)
  expect(layered.looping).toBe(true)
})

it('plays a clip at its speed', () => {
  const fast = clip('fast', { durationSeconds: 1, channels: [move('arms', 1)], speedScale: 2 })
  const layered = layeredClip([
    fast,
    clip('idle', { durationSeconds: 1, channels: [move('legs', 1)] }),
  ])
  expect(at(layered, 0.25)['arms']).toBeCloseTo(0.5, 6)
})

it('chooses by weight, the same way for the same seed', () => {
  const candidates = [
    { value: 'stand 1', weight: 1 },
    { value: 'stand 2', weight: 3 },
  ]
  const chosen = Array.from({ length: 400 }, (_, index) =>
    chooseByWeight(candidates, `unit-${index}`),
  )
  expect(chooseByWeight(candidates, 'unit-7')).toBe(chosen[7])
  const second = chosen.filter(value => value === 'stand 2').length
  expect(second).toBeGreaterThan(250)
  expect(second).toBeLessThan(350)
  expect(() => chooseByWeight([{ value: 'x', weight: 0 }], 'seed')).toThrow()
})

it('samples sparse overrides on independent clocks, loops and last-wins equal-priority ties', () => {
  const run = clip('run', { durationSeconds: 1, channels: [move('arms', 1), move('legs', 1)] })
  const carry = clip('carry', { durationSeconds: 2, channels: [move('arms', 2)] })
  const result = sampleModelAnimationLayers([
    { clip: run, timeSeconds: 1.25, loop: true, priority: 0 },
    { clip: carry, timeSeconds: 1, loop: false, priority: 5 },
    { clip: run, timeSeconds: 0.9, loop: false, priority: 5 },
  ])
  expect(result.kind).toBe('rest-pose')
  expect(at(result, 0)).toEqual({ arms: 0.9, legs: 0.9 })
  // Sparse carry does not suppress the lower-priority legs channel.
  expect(
    at(
      sampleModelAnimationLayers([
        { clip: run, timeSeconds: 1.25, loop: true, priority: 0 },
        { clip: carry, timeSeconds: 1, loop: false, priority: 5 },
      ]),
      0,
    ),
  ).toEqual({ arms: 0.5, legs: 0.25 })
  expect(() => sampleModelAnimationLayers([])).toThrow(/1..32/)
  expect(() =>
    sampleModelAnimationLayers([{ clip: run, timeSeconds: -1, loop: false, priority: 0 }]),
  ).toThrow(/clock/)
  expect(() =>
    sampleModelAnimationLayers([{ clip: run, timeSeconds: 0, loop: false, priority: NaN }]),
  ).toThrow(/priority/)
  expect(() =>
    sampleModelAnimationLayers(
      [{ clip: run, timeSeconds: 0, loop: false, priority: 0 }],
      undefined,
      AbortSignal.abort(),
    ),
  ).toThrow()
})

it('uses the later authored layer for equal-priority channel collisions', () => {
  const first = clip('first', { channels: [move('arms', 1), move('legs', 1)] })
  const last = clip('last', { channels: [move('arms', 2)] })
  const result = sampleModelAnimationLayers([
    { clip: first, timeSeconds: 0.5, loop: false, priority: 4 },
    { clip: last, timeSeconds: 1.5, loop: false, priority: 4 },
  ])
  expect(at(result, 0)).toEqual({ arms: 0.75, legs: 0.5 })
})

it('lets each layer override source looping for both clamping and wrapping', () => {
  const sourceLoop = clip('loop', { durationSeconds: 1, loop: 'loop', channels: [move('arms', 1)] })
  const sourceClamp = clip('clamp', {
    durationSeconds: 1,
    loop: 'once',
    channels: [move('arms', 1)],
  })
  const sampled = (source: ModelAnimationClip, loop: boolean) =>
    at(sampleModelAnimationLayers([{ clip: source, timeSeconds: 1.25, loop, priority: 0 }]), 0)
  expect(sampled(sourceLoop, false)).toEqual({ arms: 1 })
  expect(sampled(sourceClamp, true)).toEqual({ arms: 0.25 })
  const derived = clip('derived', { loop: 'once', channels: [move('arms', 2)] })
  expect(
    at(
      sampleModelAnimationLayers([{ clip: derived, timeSeconds: 2.5, loop: true, priority: 0 }]),
      0,
    ),
  ).toEqual({ arms: 0.25 })
  expect(sampled({ ...sourceClamp, durationSeconds: 0 }, true)).toEqual({ arms: 1 })
  expect(sampled(clip('empty', {}), true)).toEqual({})
})

it('retains lower-body channels under a half-weight sparse upper layer', () => {
  const body=clip('body',{durationSeconds:1,channels:[move('arms',1),move('legs',1)]})
  const upper=clip('upper',{durationSeconds:1,channels:[move('arms',1)]})
  expect(at(sampleModelAnimationLayers([
    {clip:upper,timeSeconds:1,loop:false,priority:4,weight:.5},
    {clip:body,timeSeconds:.2,loop:false,priority:3},
  ]),0)).toEqual({arms:expect.closeTo(.6,10),legs:.2})
})
it('retains authored ordering for equal-priority fractional overlays',()=>{
 const a=clip('a',{channels:[move('arms',1)]}), b=clip('b',{channels:[move('arms',1)]})
 expect(at(sampleModelAnimationLayers([
  {clip:a,timeSeconds:.2,loop:false,priority:3},
  {clip:b,timeSeconds:1,loop:false,priority:3,weight:.5},
 ]),0)['arms']).toBeCloseTo(.6,10)
})
it('zero weight covers no channel and one weight remains a hard override',()=>{
 const a=clip('a',{channels:[move('arms',1)]})
 const low={clip:a,timeSeconds:.2,loop:false,priority:0}
 expect(at(sampleModelAnimationLayers([low,{...low,timeSeconds:1,priority:10,weight:0}]),0)['arms']).toBe(.2)
 expect(at(sampleModelAnimationLayers([low,{...low,timeSeconds:1,priority:10,weight:1}]),0)['arms']).toBe(1)
})
it('requires an explicit lower channel and lets a full higher override prune an unresolved fractional layer',()=>{
 const a=clip('a',{channels:[move('arms',1)]}), layer={clip:a,timeSeconds:1,loop:false,priority:0,weight:.5}
 expect(()=>sampleModelAnimationLayers([layer])).toThrow(/explicit lower layer/)
 expect(at(sampleModelAnimationLayers([layer,{...layer,priority:1,weight:1}]),0)['arms']).toBe(1)
})
it('does not interpolate discrete visibility or scalar-axis channels',()=>{
 const make=(kind:string,axis?:string)=>clip('x',{channels:[{target:'n',kind,...(axis===undefined?{}:{axis}),firstFrame:0,lastFrame:0,interpolation:'step',samples:[{frame:0,timeSeconds:0,value:[1]}]}]})
 for(const c of[make('visibility'),make('translation','X')]) expect(()=>sampleModelAnimationLayers([
  {clip:c,timeSeconds:0,loop:false,priority:0},
  {clip:c,timeSeconds:0,loop:false,priority:1,weight:.5},
 ])).toThrow(/whole-TRS/)
})
it('uses the existing shortest-arc quaternion interpolation for sparse weighted rotations',()=>{
 const q=(id:string,v:number[])=>clip(id,{channels:[{target:'head',kind:'rotation',firstFrame:0,lastFrame:0,interpolation:'step',samples:[{frame:0,timeSeconds:0,value:v}]}]})
 const a=q('a',[0,0,0,1]), b=q('b',[0,0,Math.SQRT1_2,Math.SQRT1_2])
 const sample=(v:ModelAnimationClip)=>createModelAnimationSampler(sampleModelAnimationLayers([
  {clip:a,timeSeconds:0,loop:false,priority:0},
  {clip:v,timeSeconds:0,loop:false,priority:1,weight:.5},
 ])).sample(0)[0]!.value
 expect(sample(b)[2]).toBeCloseTo(Math.sin(Math.PI/8),8)
 expect(sample(b)[3]).toBeCloseTo(Math.cos(Math.PI/8),8)
 expect(sample(q('neg',[0,0,-Math.SQRT1_2,-Math.SQRT1_2]))).toEqual(sample(b))
})
it.each([-1,1.01,NaN,Infinity])('refuses nonrepresentable layer weight %s',(weight)=>{
 const c=clip('c',{channels:[move('arms',1)]})
 expect(()=>sampleModelAnimationLayers([{clip:c,timeSeconds:0,loop:false,priority:0,weight}])).toThrow(/weight/)
})
it('produces the same weighted frame after random seeks without retaining sampler history',()=>{
 const c=clip('c',{channels:[move('arms',1)]})
 const sample=(timeSeconds:number)=>sampleModelAnimationLayers([
  {clip:c,timeSeconds:.2,loop:false,priority:0},
  {clip:c,timeSeconds,loop:false,priority:1,weight:.5},
 ])
 const first=sample(.8);sample(.1);sample(1);expect(sample(.8)).toEqual(first)
})

it('bounds the aggregate weighted working set, while pruning 32 complete overrides',()=>{
 const c=clip('x',{channels:[move('a',1)]}), budget={maxDepth:64,maxNodes:5000,maxBytes:1600}
 const layers=Array.from({length:32},(_,priority)=>({clip:c,timeSeconds:1,loop:false,priority,weight:1}))
 expect(at(sampleModelAnimationLayers(layers,budget),0)['a']).toBe(1)
 expect(()=>sampleModelAnimationLayers(layers.map((l,i)=>({...l,weight:i===0?1:.5})),budget)).toThrow(/aggregate/)
 expect(()=>sampleModelAnimationLayers(layers.map((l,i)=>({...l,weight:i===0?1:.5})),{...budget,maxBytes:100000,maxNodes:120})).toThrow(/aggregate/)
 const omitted=layers.map(({weight,...l})=>l)
 expect(at(sampleModelAnimationLayers(omitted,budget),0)['a']).toBe(1)
})
it('charges UTF-8 bytes for retained non-ASCII targets',()=>{
 const c=clip('x',{channels:[move('骨'.repeat(200),1)]})
 expect(()=>sampleModelAnimationLayers([
  {clip:c,timeSeconds:1,loop:false,priority:0,weight:1},
  {clip:c,timeSeconds:1,loop:false,priority:1,weight:.5},
 ],{maxDepth:64,maxNodes:5000,maxBytes:2000})).toThrow(/aggregate/)
})
