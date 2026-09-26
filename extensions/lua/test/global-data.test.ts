import { describe, expect, it } from 'vitest'
import { luaStaticField, luaStaticToJson, readLuaModule } from '../src/literal.js'
import { luaSyntax } from '../src/syntax.js'

/** A Dawn of War attribute file in the shape the game ships: a global over the file it inherits. */
const ATTRIB = `GameData = Inherit([[sbps\\races\\chaos\\troops\\chaos_marine.lua]])
GameData["health_ext"]["hitpoints"] = 350
GameData["health_ext"]["armour"] = 1.5 * 2
GameData["ui_ext"] = Reference([[ebpextensions\\ui_ext.lua]])
GameData["cost_ext"] = { time_seconds = 25, cost = { power = 0, requisition = 100 } }
GameData.speed_ext.speed_max = 6.5
Squad = { size = 4 }
Squad.leader = true
Version = 3
`

async function read(text: string, dialect: 'lua51' | 'luau' = 'lua51') {
  const parse = (await luaSyntax()).parse(text, dialect)
  expect(parse.errors).toEqual([])
  return readLuaModule(parse, text)
}

describe('globals set at the top level', () => {
  it('reads a global built over an inherited file as the call plus the fields written over it', async () => {
    const reading = await read(ATTRIB)
    expect(reading.globals.map(global => global.name)).toEqual(['GameData', 'Squad', 'Version'])
    const data = reading.globals[0]!.value
    expect(data).toMatchObject({ kind: 'table', extends: { callee: 'Inherit', arguments: [{ kind: 'string', value: 'sbps\\races\\chaos\\troops\\chaos_marine.lua' }] } })
    // Written below the inherited table: overlays that hold only the written keys.
    const health = luaStaticField(data, 'health_ext')
    expect(health).toMatchObject({ kind: 'table', overlay: true })
    expect(luaStaticField(health, 'hitpoints')).toMatchObject({ kind: 'number', raw: '350', value: 350 })
    expect(luaStaticField(health, 'armour')).toMatchObject({ kind: 'number', value: 3, derived: true })
    // A reference is a call not run, kept with its literal argument.
    expect(luaStaticField(data, 'ui_ext')).toMatchObject({
      kind: 'unresolved',
      reason: 'call',
      call: { callee: 'Reference', arguments: [{ kind: 'string', value: 'ebpextensions\\ui_ext.lua' }] },
    })
    expect(luaStaticToJson(luaStaticField(data, 'cost_ext')!)).toEqual({ time_seconds: 25, cost: { power: 0, requisition: 100 } })
    expect(luaStaticToJson(luaStaticField(data, 'speed_ext')!)).toEqual({ $overlay: true, speed_max: 6.5 })
    // Plain globals: a table written after it is made, and a scalar.
    expect(luaStaticToJson(reading.globals[1]!.value)).toEqual({ size: 4, leader: true })
    expect(reading.globals[2]!.value).toMatchObject({ kind: 'number', value: 3 })
    expect(reading.unappliedWrites).toEqual([])
  })

  it('reads later uses of a global by its value, and an inherited field as not known here', async () => {
    const reading = await read(`Base = Inherit([[a.lua]])\nBase.x = 1\nCopy = { x = Base.x, y = Base.y, keys = Enum.KeyCode.Q }\n`)
    const copy = reading.globals.find(global => global.name === 'Copy')!.value
    expect(luaStaticField(copy, 'x')).toMatchObject({ kind: 'number', value: 1 })
    expect(luaStaticField(copy, 'y')).toMatchObject({ kind: 'unresolved', reason: 'inherited' })
    expect(luaStaticField(copy, 'keys')).toMatchObject({ kind: 'symbol', path: 'Enum.KeyCode.Q' })
  })

  it('evaluates every value before assigning, and marks results a call may add', async () => {
    const reading = await read('A = 1\nB = 2\nA, B = B, A\nC, D = f()\n')
    const value = (name: string) => reading.globals.find(global => global.name === name)!.value
    expect([value('A'), value('B')]).toMatchObject([{ value: 2 }, { value: 1 }])
    expect(value('C')).toMatchObject({ kind: 'unresolved', reason: 'call', call: { callee: 'f', arguments: [] } })
    expect(value('D')).toMatchObject({ kind: 'unresolved', reason: 'call' })
  })

  it('lists a global a function may set again, and leaves locals alone', async () => {
    const reading = await read('Config = { a = 1 }\nfunction Reset() Config = {} end\nlocal x = 1\nx = 2\n', 'luau')
    expect(reading.globals.map(global => global.name)).toEqual(['Config'])
    expect(reading.unappliedWrites.map(write => write.reason)).toEqual(['inside-function'])
  })
})
