import { describe, expect, it } from 'vitest'
import { luaStaticField, luaStaticToJson, readLuaModule } from '../src/literal.js'
import { gpgAsLua51, luaSyntax } from '../src/syntax.js'

/** A Supreme Commander prop blueprint in the shape the game ships, with GPG Lua's two extensions. */
const BLUEPRINT = `# Aeon bus prop
PropBlueprint {
    Description = "Aeon bus", # shown in the editor
    Display = {
        Mesh = {
            LODs = {
                { AlbedoName = 'aeon_bus_Albedo.dds', LODCutoff = 150, ShaderName = 'Aeon' },
                { AlbedoName = 'aeon_bus_lod1_Albedo.dds', LODCutoff = 300 },
            },
        },
        UniformScale = .05,
    },
    Audio = { Destroyed = Sound { Bank = 'Explosions', Cue = 'Prop_Destroyed' } },
    Economy = { ReclaimMassMax = 0 },
    Hidden = 1 != 1,
}
UnitBlueprint { BlueprintId = "second", Tag = "a # inside a string" }
`

describe('GPG Lua blueprints', () => {
  it('rewrites # comments and != in place, leaving strings alone', () => {
    const text = `a = 1 # note\nb = x != y\nc = "# not a comment"\nd = '!='\n#\ne = 2 --[[ # ]] f = 3`
    const rewritten = gpgAsLua51(text)
    expect(rewritten).toHaveLength(text.length)
    expect(rewritten).toBe(`a = 1 --note\nb = x ~= y\nc = "# not a comment"\nd = '!='\n \ne = 2 --[[ # ]] f = 3`)
  })

  it('reads top-level blueprint calls as data, with ranges into the original text', async () => {
    const parse = (await luaSyntax()).parse(BLUEPRINT, 'gpg')
    expect(parse.errors).toEqual([])
    expect(parse.dialect).toBe('gpg')
    const reading = readLuaModule(parse, BLUEPRINT)
    expect(reading.calls.map(call => call.callee)).toEqual(['PropBlueprint', 'UnitBlueprint'])
    const prop = reading.calls[0]!.arguments[0]!
    const lods = luaStaticField(luaStaticField(luaStaticField(prop, 'Display'), 'Mesh'), 'LODs')
    expect(luaStaticToJson(lods!)).toEqual([
      { AlbedoName: 'aeon_bus_Albedo.dds', LODCutoff: 150, ShaderName: 'Aeon' },
      { AlbedoName: 'aeon_bus_lod1_Albedo.dds', LODCutoff: 300 },
    ])
    expect(luaStaticField(luaStaticField(prop, 'Display'), 'UniformScale')).toMatchObject({ kind: 'number', raw: '.05', value: 0.05 })
    // A nested constructor call is not run: it stays unresolved, with its source.
    expect(luaStaticField(luaStaticField(prop, 'Audio'), 'Destroyed')).toMatchObject({ kind: 'unresolved', reason: 'call' })
    const tag = luaStaticField(reading.calls[1]!.arguments[0]!, 'Tag')
    expect(tag).toMatchObject({ kind: 'string', value: 'a # inside a string' })
    // Ranges point into the text as written.
    expect(BLUEPRINT.slice(tag!.range[0], tag!.range[1])).toBe('"a # inside a string"')
  })

  it('does not list calls of locals or of computed callees', async () => {
    const text = 'local f = print\nf { 1 }\nt[1] { 2 }\nRegister.Unit { 3 }'
    const reading = readLuaModule((await luaSyntax()).parse(text, 'lua51'), text)
    expect(reading.calls.map(call => call.callee)).toEqual(['Register.Unit'])
  })
})
