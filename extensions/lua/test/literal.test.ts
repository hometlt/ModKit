import { describe, expect, it } from 'vitest'
import {
  luaDecimalSpelling,
  luaStaticField,
  luaStaticToJson,
  readLuaModule,
} from '../src/literal.js'
import { luaSyntax } from '../src/syntax.js'

async function read(text: string) {
  const parse = (await luaSyntax()).parse(text, 'luau')
  expect(parse.errors).toEqual([])
  return readLuaModule(parse, text)
}

describe('static reading of Lua data modules', () => {
  it('builds the returned table from chunk-level assignments, keeping number spelling', async () => {
    const reading = await read(`
      local SMALL = 1
      local module = {}
      module.stat = {}
      module.stat[9] = { UnitSize = SMALL, Speed = 0.35, Health = 60, Cost = { 50, 20 }, Tag = "archer" }
      module.stat[7] = { Speed = 0.3 * 2, Health = -(-80) }
      module.typeName = { [7] = "footman", [9] = "archer" }
      return module
    `)
    expect(reading.unappliedWrites).toEqual([])
    const archer = luaStaticField(luaStaticField(reading.value, 'stat'), 9)
    expect(luaStaticField(archer, 'Speed')).toMatchObject({
      kind: 'number',
      raw: '0.35',
      value: 0.35,
    })
    expect(luaStaticField(archer, 'UnitSize')).toMatchObject({ kind: 'number', raw: '1' })
    expect(
      luaStaticToJson(luaStaticField(archer, 'Cost') ?? { kind: 'nil', range: [0, 0] }),
    ).toEqual([50, 20])
    const footman = luaStaticField(luaStaticField(reading.value, 'stat'), 7)
    expect(luaStaticField(footman, 'Speed')).toMatchObject({
      kind: 'number',
      raw: '0.3 * 2',
      derived: true,
    })
    expect(luaStaticField(footman, 'Health')).toMatchObject({
      kind: 'number',
      raw: '80',
      value: 80,
    })
    expect(
      luaStaticToJson(luaStaticField(reading.value, 'typeName') ?? { kind: 'nil', range: [0, 0] }),
    ).toEqual({
      7: 'footman',
      9: 'archer',
    })
  })

  it('marks what only running the code could decide', async () => {
    const reading = await read(`
      local util = require(script.Parent.Util)
      local module = {}
      module.a = util.scale(4)
      module.b = Enum.KeyCode.Q
      module.c = function() return 1 end
      local counter = 1
      counter = 2
      module.d = counter
      function module.helper() module.e = 5 end
      for i = 1, 3 do module[i] = i end
      setmetatable(module, {})
      return module
    `)
    const field = (name: string) => luaStaticField(reading.value, name)
    expect(field('a')).toMatchObject({ kind: 'unresolved', reason: 'call' })
    expect(field('b')).toMatchObject({ kind: 'symbol', path: 'Enum.KeyCode.Q' })
    expect(field('c')).toMatchObject({ kind: 'unresolved', reason: 'function' })
    expect(field('d')).toMatchObject({ kind: 'unresolved', reason: 'reassigned-local' })
    expect(field('helper')).toMatchObject({ kind: 'unresolved', reason: 'function' })
    expect(reading.unappliedWrites.map(write => write.reason).sort()).toEqual([
      'call-receives-table',
      'inside-control-flow',
      'inside-function',
    ])
  })

  it('picks `flag and a or b` by a known flag, whatever the other operand is', async () => {
    const reading = await read(`
      local newMenu = true
      local oldMenu = nil
      return { menu = newMenu and { "a" } or { "b" }, fallback = oldMenu or 5, gated = oldMenu and require("x") }
    `)
    expect(luaStaticToJson(reading.value)).toEqual({ menu: ['a'], fallback: 5, gated: null })
  })

  it('reads setmetatable(t, mt) as t, marked', async () => {
    const reading = await read(`
      local module = {}
      module.typeName = setmetatable({ [7] = "footman" }, { __index = function(_, k) return tostring(k) end })
      return module
    `)
    expect(luaStaticField(reading.value, 'typeName')).toMatchObject({
      kind: 'table',
      metatable: true,
    })
    expect(luaStaticToJson(reading.value)).toEqual({ typeName: { 7: 'footman' } })
    expect(reading.unappliedWrites).toEqual([])
  })

  it('follows table references like Lua does', async () => {
    const reading = await read(`
      local base = { hp = 10 }
      local alias = base
      alias.hp = 20
      return base
    `)
    expect(luaStaticToJson(reading.value)).toEqual({ hp: 20 })
  })

  it('spells Lua numbers as exact decimals', () => {
    expect(luaDecimalSpelling('1_000')).toBe('1000')
    expect(luaDecimalSpelling('0x1F')).toBe('31')
    expect(luaDecimalSpelling('-0b101')).toBe('-5')
    expect(luaDecimalSpelling('0.35')).toBe('0.35')
    expect(luaDecimalSpelling('3.25e2')).toBe('3.25e2')
    expect(luaDecimalSpelling('0x1p4')).toBeUndefined()
    expect(luaDecimalSpelling('12LL')).toBeUndefined()
  })
})
