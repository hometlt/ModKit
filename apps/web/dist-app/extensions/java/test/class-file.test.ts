import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classListing, decodeInstructions } from '../src/bytecode.js'
import { ConstantPool, isClassFile, parseClassFile, type ClassFile } from '../src/class-file.js'
import { interpretMethod, type JvmValue } from '../src/interpreter.js'

// javac 26.0.1 --release 17 of fixtures/Sample.java
const bytes = new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'Sample.class')))

const method = (file: ClassFile, name: string) => {
  const found = file.methods.find(item => item.name === name)
  if (found === undefined) throw new Error(`no method ${name}`)
  return found
}

describe('JVM class files', () => {
  it('reads the header, pool, fields with constant values and methods', () => {
    expect(isClassFile(bytes)).toBe(true)
    const file = parseClassFile(bytes)
    expect(file.majorVersion).toBe(61)
    expect(file.thisClass).toBe('fixture/Sample')
    expect(file.superClass).toBe('java/lang/Object')
    expect(file.fields.map(field => `${field.name}:${field.descriptor}`)).toEqual([
      'SIZE:I',
      'NAME:Ljava/lang/String;',
      'parts:Ljava/util/List;',
    ])
    const pool = new ConstantPool(file.constantPool)
    const size = file.fields[0]?.constantValueIndex ?? 0
    expect(pool.entry(size)).toEqual({ tag: 'Integer', value: 64 })
    expect(file.methods.map(item => item.name)).toContain('<init>')
    // every method decodes to its end, switches and invokedynamic included
    for (const item of file.methods)
      expect(decodeInstructions(item.code!.code).length).toBeGreaterThan(0)
    const pick = decodeInstructions(method(file, 'pick').code!.code).find(
      i => i.mnemonic === 'lookupswitch',
    )
    expect(pick?.keys).toEqual([1, 5, 100])
    const dense = decodeInstructions(method(file, 'dense').code!.code).find(
      i => i.mnemonic === 'tableswitch',
    )
    expect(dense?.keys).toEqual([0, 1, 2])
  })

  it('lists the class as javap -c does, constants resolved', () => {
    const listing = classListing(parseClassFile(bytes))
    expect(listing).toContain('public class fixture/Sample {')
    expect(listing).toContain('ConstantValue: int 64')
    expect(listing).toContain('invokestatic #23 // Method fixture/Sample.create:()Lfixture/Sample;')
    expect(listing).toContain('ldc #27 // float -3f')
    expect(listing).toContain('makeConcatWithConstants')
    expect(listing).toMatch(/lookupswitch \{ 1: \d+, 5: \d+, 100: \d+, default: \d+ \}/u)
    expect(listing).toContain('catch java/lang/NumberFormatException')
  })

  it('refuses a truncated file, trailing bytes and a pool index out of range', () => {
    expect(() => parseClassFile(bytes.subarray(0, bytes.byteLength - 1))).toThrow(RangeError)
    expect(() => parseClassFile(Uint8Array.from([...bytes, 0]))).toThrow(/trailing/u)
    const pool = new ConstantPool(parseClassFile(bytes).constantPool)
    expect(() => pool.utf8(pool.entries.length)).toThrow(RangeError)
    expect(() => pool.utf8(0)).toThrow(RangeError)
    // a declared pool larger than the file
    const lying = bytes.slice()
    new DataView(lying.buffer).setUint16(8, 0xffff)
    expect(() => parseClassFile(lying)).toThrow()
  })
})

describe('the bounded constant interpreter', () => {
  const file = parseClassFile(bytes)
  const floats = (values: readonly JvmValue[]) =>
    values.map(value =>
      value.kind === 'float' ? value.value : value.kind === 'string' ? value.value : value.kind,
    )

  it('reads builder code back as calls with constant arguments', () => {
    const result = interpretMethod(file, method(file, 'body'))
    if (result.state !== 'ok') throw new Error(result.reason)
    const parts = result.calls.filter(
      call => call.name === '<init>' && call.owner === 'fixture/Sample$Part',
    )
    expect(parts.map(call => floats(call.args))).toEqual([
      ['head', -4, -8, -4, 8, 8, 8],
      ['body', -4, 0, -2, 8, 12, 4],
      // `offset + 1.0F` over a local folds to its constant
      ['arm', -2, -2, -2, 4, 16, 4],
    ])
    const adds = result.calls.filter(call => call.name === 'add')
    expect(adds.map(call => call.receiver?.kind)).toEqual(['result', 'result', 'result'])
    // the third add is chained on the second's result
    expect(adds[2]?.receiver).toEqual({ kind: 'result', call: result.calls.indexOf(adds[1]!) })
    expect(result.returned).toEqual({ kind: 'result', call: 0 })
  })

  it('keeps parameters symbolic and records call sites with their bootstrap arguments', () => {
    const wide = interpretMethod(file, method(file, 'wide'))
    if (wide.state !== 'ok') throw new Error(wide.reason)
    expect(wide.returned?.kind).toBe('operation')
    const greet = interpretMethod(file, method(file, 'greet'))
    if (greet.state !== 'ok') throw new Error(greet.reason)
    expect(greet.calls[0]).toMatchObject({
      invoke: 'invokedynamic',
      owner: 'java/lang/invoke/StringConcatFactory',
      name: 'makeConcatWithConstants',
      bootstrap: { name: 'makeConcatWithConstants' },
    })
    expect(greet.calls[0]?.args).toEqual([{ kind: 'parameter', index: 0 }])
    // the recipe: constant text with one argument slot
    expect(greet.calls[0]?.bootstrap?.args[0]).toEqual({
      kind: 'string',
      value: `hello ${String.fromCharCode(1)}`,
    })
    const task = interpretMethod(file, method(file, 'task'))
    if (task.state !== 'ok') throw new Error(task.reason)
    expect(task.calls[0]).toMatchObject({
      owner: 'java/lang/invoke/LambdaMetafactory',
      name: 'run',
      bootstrap: { name: 'metafactory' },
    })
    expect(task.calls[0]?.bootstrap?.args[1]).toMatchObject({
      kind: 'methodHandle',
      owner: 'fixture/Sample',
      name: 'lambda$task$0',
      descriptor: '()V',
    })
  })

  it('follows branches whose condition folds, within the instruction budget', () => {
    const rows = interpretMethod(file, method(file, 'rows'))
    if (rows.state !== 'ok') throw new Error(rows.reason)
    const parts = rows.calls.filter(call => call.name === '<init>')
    expect(parts.map(call => floats(call.args))).toEqual([
      ['row', 0, 0, 0, 1, 1, 1],
      ['row', 1, 0, 0, 1, 1, 1],
      ['row', 2, 0, 0, 1, 1, 1],
    ])
    expect(interpretMethod(file, method(file, 'rows'), { maxInstructions: 20 })).toMatchObject({
      state: 'refused',
      reason: 'the instruction budget of 20 is spent',
    })
    const five = { kind: 'int', value: 5 } as const
    expect(interpretMethod(file, method(file, 'loop'), { args: [five] })).toMatchObject({
      state: 'ok',
      returned: { kind: 'int', value: 10 },
    })
    expect(interpretMethod(file, method(file, 'pick'), { args: [five] })).toMatchObject({
      returned: { kind: 'int', value: 50 },
    })
    expect(
      interpretMethod(file, method(file, 'dense'), { args: [{ kind: 'int', value: 7 }] }),
    ).toMatchObject({ returned: { kind: 'int', value: 0 } })
  })

  it('refuses a condition over a symbol and exception handlers, keeping what it recorded', () => {
    expect(interpretMethod(file, method(file, 'loop'))).toMatchObject({
      state: 'refused',
      reason: 'if_icmpge tests a value that is not a constant',
    })
    expect(interpretMethod(file, method(file, 'pick'))).toMatchObject({
      state: 'refused',
      reason: 'lookupswitch tests a value that is not a constant',
    })
    expect(interpretMethod(file, method(file, 'guarded'))).toMatchObject({
      state: 'refused',
      reason: 'the method handles exceptions',
    })
    // a caller that knows nothing throws walks the protected code straight through
    const guarded = interpretMethod(file, method(file, 'guarded'), { exceptions: 'never-thrown' })
    expect(guarded).toMatchObject({ state: 'ok', returned: { kind: 'result', call: 0 } })
    expect(guarded.calls.map(call => call.name)).toEqual(['parseInt'])
    // a walk stopped by its budget hands back the parts made before
    const stopped = interpretMethod(file, method(file, 'rows'), { maxInstructions: 40 })
    expect(stopped.state).toBe('refused')
    expect(stopped.calls.filter(call => call.name === '<init>').length).toBe(2)
  })
})
