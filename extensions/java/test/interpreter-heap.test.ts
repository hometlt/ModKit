import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseClassFile } from '../src/class-file.js'
import { interpretMethod, type JvmHeap, type JvmValue } from '../src/interpreter.js'

// javac 26.0.1 --release 17 of fixtures/Heap.java
const file = parseClassFile(
  new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'Heap.class'))),
)
const method = (name: string) => file.methods.find(item => item.name === name)!
const part = (id: number): JvmValue => ({ kind: 'object', className: 'fixture/Heap$Part', id })

// the static table, as the class's own initializer stores it
const clinit = interpretMethod(file, method('<clinit>'))
if (clinit.state !== 'ok') throw new Error(clinit.reason)
const angles = clinit.stores.find(store => store.name === 'ANGLES')!.value

const self: JvmValue = { kind: 'parameter', index: 0 }
const heap: JvmHeap = {
  getStatic: field => (field.name === 'ANGLES' ? angles : undefined),
  getField: (target, field) =>
    target === self && field.name === 'age' ? { kind: 'float', value: 2 } : undefined,
  // `this.parts` stays symbolic; its length and elements are answered, a fresh value each time
  arrayLength: array => (array.kind === 'field' && array.name === 'parts' ? 3 : undefined),
  arrayElement: (array, index) =>
    array.kind === 'field' && array.name === 'parts' ? part(100 + index) : undefined,
}

describe('interpreter with the caller heap', () => {
  it('folds branches and loops over answered fields, arrays and a static table', () => {
    const result = interpretMethod(file, method('animate'), {
      args: [self],
      heap,
      firstObjectId: 1000,
    })
    if (result.state !== 'ok') throw new Error(result.reason)
    const events = [...result.calls, ...result.stores]
      .sort((left, right) => left.step - right.step)
      .map(event =>
        'invoke' in event
          ? ['turn', (event.receiver as { id: number }).id, event.args[0]]
          : ['rotation', (event.target as { id: number }).id, event.value],
      )
    const time = { kind: 'parameter', index: 1 }
    const angle = (value: number) => ({ kind: 'float', value })
    const times = (value: number) => ({ kind: 'operation', op: 'fmul', operands: [angle(value), time] })
    expect(events).toEqual([
      ['turn', 100, time],
      ['rotation', 100, times(0.5)],
      ['turn', 100, angle(0.5)],
      ['rotation', 101, times(1.5)],
      ['turn', 101, angle(1.5)],
      ['rotation', 102, times(2.5)],
      ['turn', 102, angle(2.5)],
    ])
  })

  it('compares the caller objects by id and refuses what it does not answer', () => {
    const same = interpretMethod(file, method('first'), { args: [self, part(100)], heap })
    expect(same.state === 'ok' && same.calls.map(call => call.name)).toEqual(['turn'])
    const other = interpretMethod(file, method('first'), { args: [self, part(7)], heap })
    expect(other.state === 'ok' && other.calls).toEqual([])
    expect(interpretMethod(file, method('animate'), { args: [self] })).toMatchObject({
      state: 'refused',
      reason: 'ifle tests a value that is not a constant',
    })
  })
})
