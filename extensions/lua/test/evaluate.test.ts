import { describe, expect, it } from 'vitest'
import type { LuaDialect } from '../src/ast.js'
import {
  evaluateLuaChunk,
  LuaFunction,
  LuaTable,
  luaValueToStatic,
  type LuaEvaluationOptions,
  type LuaValue,
} from '../src/evaluate.js'
import { luaStaticField } from '../src/literal.js'
import { luaSyntax } from '../src/syntax.js'

async function run(
  text: string,
  options: Partial<LuaEvaluationOptions> = {},
  dialect: LuaDialect = 'lua51',
) {
  const parse = (await luaSyntax()).parse(text, dialect)
  expect(parse.errors).toEqual([])
  return evaluateLuaChunk(parse, { maxSteps: 1_000_000, ...options })
}

async function values(text: string, dialect: LuaDialect = 'lua51'): Promise<readonly LuaValue[]> {
  const result = await run(text, {}, dialect)
  if (result.state !== 'returned') throw new Error(`${result.state}: ${result.message}`)
  return result.values
}

const field = (table: LuaValue, key: LuaValue) => (table as LuaTable).get(key)

describe('a bounded evaluator of Lua data scripts (decision 30 (b))', () => {
  it('builds tables in loops, as feature definition files do', async () => {
    // BAR-style: sixteen tree types and a rock per size, from one template
    const [features] = await values(`
      local features = {}
      local function tree(i)
        return { description = "Tree", footprintX = 1 + i % 2, object = string.format("treetype%d.s3o", i) }
      end
      for i = 0, 15 do features["treetype" .. i] = tree(i) end
      for _, size in ipairs({ 30, 60 }) do
        features["rocks" .. size] = { metal = size / 10, reclaimable = true }
      end
      return features
    `)
    expect(field(field(features, 'treetype3'), 'object')).toBe('treetype3.s3o')
    expect(field(field(features, 'treetype3'), 'footprintX')).toBe(2)
    expect(field(field(features, 'rocks60'), 'metal')).toBe(6)
    // the static reader's tree, for consumers of static readings
    const tree = luaValueToStatic(features)
    expect(luaStaticField(luaStaticField(tree, 'treetype15'), 'object')).toMatchObject({
      kind: 'string',
      value: 'treetype15.s3o',
    })
  })

  it('runs closures, recursion, varargs and multiple results', async () => {
    expect(
      await values(`
        local function counter() local n = 0 return function() n = n + 1 return n end end
        local c = counter(); c(); c()
        local function fact(n) if n <= 1 then return 1 end return n * fact(n - 1) end
        local function pack(...) return select('#', ...), { ... } end
        local count, packed = pack(1, nil, 3)
        local a, b = (function() return 'x', 'y' end)()
        return c(), fact(10), count, #packed, a .. b
      `),
    ).toEqual([3, 3628800, 3, 3, 'xy'])
  })

  it('looks fields up through metatables, calls tables and adds by metamethod', async () => {
    const [unit, label, sum] = await values(`
      local base = { health = 100, speed = 2 }
      local unit = setmetatable({ speed = 3 }, { __index = base })
      local vector = setmetatable({}, {
        __add = function(a, b) return 'added' end,
        __call = function(self, x) return x * 2 end,
        __tostring = function() return 'vector' end,
      })
      return { health = unit.health, speed = unit.speed, doubled = vector(21) }, tostring(vector), vector + 1
    `)
    expect([field(unit, 'health'), field(unit, 'speed'), field(unit, 'doubled')]).toEqual([
      100, 3, 42,
    ])
    expect([label, sum]).toEqual(['vector', 'added'])
  })

  it('formats, finds, matches and substitutes as the string library does', async () => {
    // only a list's last call gives all its results; the others give their first
    expect(
      await values(`
        local words = {}
        for word in string.gmatch("one two  three", "%a+") do words[#words + 1] = word end
        local replaced, count = string.gsub("hello world", "o", "0")
        local key, value = ("key=value"):match("(%w+)=(%w+)")
        local plainStart, plainEnd = string.find("a.b.c", ".", 1, true)
        local digitStart, digitEnd = string.find("abc123", "%d+")
        local open, close, inner = ("THE (quick) fox"):find("%((%a+)%)")
        return
          string.format("%d|%5.2f|%-4s|%x|%03d|%g|%g", 42, 3.14159, "ab", 255, 7, 0.1, 1e20),
          replaced, count, key, value, plainStart, plainEnd, digitStart, digitEnd,
          (string.gsub("$name is $age", "%$(%w+)", { name = "Ana", age = 7 })),
          (string.gsub("abc", "%w", function(c) return c:upper() .. "." end)),
          table.concat(words, ","), open, close, inner,
          string.rep("ab", 3, "-"), ("hello"):sub(-3), string.byte("A"), string.char(72, 105),
          ("[a]b[c]"):gsub("%b[]", "x"), ("THE (quick) fox"):match("%f[%a]%a+", 5)
      `),
    ).toEqual([
      '42| 3.14|ab  |ff|007|0.1|1e+20',
      'hell0 w0rld',
      2,
      'key',
      'value',
      2,
      2,
      4,
      6,
      'Ana is 7',
      'A.B.C.',
      'one,two,three',
      5,
      11,
      'quick',
      'ab-ab-ab',
      'llo',
      65,
      'Hi',
      'xbx',
      'quick',
    ])
  })

  it('prints numbers as Lua 5.1 does and runs table, math and bitwise operations', async () => {
    expect(
      await values(
        `
        local t = { 5, 2, 9 }
        table.sort(t, function(a, b) return a > b end)
        table.insert(t, 1, 0)
        local removed = table.remove(t)
        return tostring(1e15), tostring(0.1), 10 / 2, 7 // 2, -7 % 3, 5 & 3, 1 << 4,
          table.concat(t, " "), removed, math.max(3, 8, 1), math.floor(-2.5)
      `,
        'lua53',
      ),
    ).toEqual(['1e+15', '0.1', 5, 3, 2, 1, 16, '0 9 5', 2, 8, -3])
  })

  it('catches errors with pcall and reports one nobody catches with its place', async () => {
    expect(
      await values(`
        local ok, message = pcall(function() error("broken", 0) end)
        local ok2, message2 = pcall(function() local x = nil; return x.field end)
        return ok, message, ok2, message2
      `),
    ).toEqual([false, 'broken', false, "attempt to index a nil value (field 'field')"])
    const failed = await run(`local t = nil\nreturn t.x`)
    expect(failed).toMatchObject({ state: 'failed', code: 'runtime-error' })
    expect(failed.state === 'failed' && failed.range !== undefined).toBe(true)
  })

  it('refuses a script past its limits instead of cutting it short', async () => {
    expect(await run('while true do end', { maxSteps: 1000 })).toMatchObject({
      state: 'refused',
      code: 'step-limit',
    })
    expect(await run('local function f() return f() + 1 end return f()')).toMatchObject({
      state: 'refused',
      code: 'depth-limit',
    })
    expect(
      await run('local t = {} for i = 1, 1e9 do t[i] = i end', { maxTableEntries: 100 }),
    ).toMatchObject({
      state: 'refused',
      code: 'table-limit',
    })
    expect(await run('return string.rep("x", 1e9)')).toMatchObject({
      state: 'refused',
      code: 'string-limit',
    })
    // a limit is no Lua error: pcall does not swallow it
    expect(await run('pcall(function() while true do end end)', { maxSteps: 1000 })).toMatchObject({
      state: 'refused',
      code: 'step-limit',
    })
    expect(await run('goto skip ::skip::', {}, 'lua52')).toMatchObject({
      state: 'refused',
      code: 'unsupported',
    })
  })

  it('takes the host its globals, and says when a script drew a random number', async () => {
    // Supreme Commander declares records by calling a global with a table
    const blueprints: LuaValue[] = []
    const result = await run(
      `
        UnitBlueprint { Description = "Tank", Economy = { BuildCostMass = 50 * 2 } }
        UnitBlueprint { Description = "Scout" }
        Variant = math.random(1, 3)
      `,
      {
        globals: {
          UnitBlueprint: new LuaFunction('UnitBlueprint', args => {
            blueprints.push(args[0])
            return []
          }),
        },
        randomSeed: 7,
      },
    )
    expect(result.state).toBe('returned')
    if (result.state !== 'returned') return
    expect(blueprints.map(blueprint => field(blueprint, 'Description'))).toEqual(['Tank', 'Scout'])
    expect(field(field(blueprints[0], 'Economy'), 'BuildCostMass')).toBe(100)
    expect(result.usedRandom).toBe(true)
    const variant = result.globals.get('Variant')
    expect([1, 2, 3]).toContain(variant)
    // the same seed draws the same number
    const again = await run('return math.random(1, 3)', { randomSeed: 7 })
    expect(again.state === 'returned' && again.values[0]).toBe(variant)
  })
})
