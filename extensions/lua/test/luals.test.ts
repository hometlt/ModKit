import { describe, expect, it } from 'vitest'
import type { LanguageDocument, LanguageWorkspaceContext } from '@modkit/sdk'
import { LUA_ENVIRONMENT_FILE } from '../src/environment.js'
import { LuaLineIndex } from '../src/line-index.js'
import { luaEnvironmentFromAnnotations, readLuaAnnotationType } from '../src/luals.js'
import { luaHover } from '../src/provider.js'

/** A LuaLS `---@meta` library in the shape a game's API extractor writes it. */
const LIBRARY = [
  { path: 'library/spring.lua', text: '---@meta\n\nSpring = {}\n' },
  {
    path: 'library/generated/luasyncedread.lua',
    text: `---@meta

---[<a href="https://example.test/LuaSyncedRead.cpp#L1" target="_blank">source</a>]
---
---@return number t1 frameNum % dayFrames
---@return number t2
function Spring.GetGameFrame() end

---Position of a unit.
---
---@param unitID integer
---@param midPos boolean? return the middle of the unit
---@return number? x
---@return number y
---@return number z
function Spring.GetUnitPosition(unitID, midPos) end

---@deprecated Use GetGameFrame.
function Spring.GetFrame() end

---@param unitID integer
function Spring.MoveCtrl.Enable(unitID) end

---@param ... any
function Echo(...) end
`,
  },
  {
    path: 'library/generated/luahandle.lua',
    text: `---@meta

---Call-ins every Lua handle receives.
---@class Callins
---@field UnitCreated fun(self, unitID: integer, unitDefID: integer)?

---Called once when the handle loads.
function Callins:Initialize() end

---@class UnsyncedCallins
---@field DrawScreen fun(self)?

---@class KeyModifiers
---@field alt boolean
---@field ctrl boolean Whether ctrl is held.
---@field [string] any
`,
  },
  {
    path: 'library/widget.lua',
    text: `---@meta

---@class Widget : Callins, UnsyncedCallins
---
---Widgets receive only unsynced call-ins.

---@type Widget
widget = nil
`,
  },
  {
    path: 'library/generated/luaconstcmd.lua',
    text: `---@meta

---Command constants.
---@enum CMD
CMD = {
	---[<a href="https://example.test/LuaConstCMD.cpp#L19" target="_blank">source</a>]
	OPT_ALT = 128,

	---Stop the unit.
	---@type integer
	STOP = nil,
}

---@alias CommandOption
---| "alt"
---| "ctrl"
`,
  },
] as const

describe('LuaLS annotations as a game environment', () => {
  it('reads type expressions with spaces inside brackets, unions and function types', () => {
    expect(readLuaAnnotationType('number t1 frameNum % dayFrames')).toEqual([
      'number',
      't1 frameNum % dayFrames',
    ])
    expect(readLuaAnnotationType('table<string, number> scores')).toEqual([
      'table<string, number>',
      'scores',
    ])
    expect(readLuaAnnotationType('fun(self, a: integer): boolean? desc')).toEqual([
      'fun(self, a: integer): boolean?',
      'desc',
    ])
    expect(readLuaAnnotationType('integer | nil the id')).toEqual(['integer | nil', 'the id'])
  })

  it('turns functions, methods, classes, enums, aliases and typed globals into the environment', async () => {
    const environment = await luaEnvironmentFromAnnotations('Recoil', LIBRARY)
    expect(environment.globals).toMatchObject({
      Spring: { type: 'Spring' },
      widget: { type: 'Widget' },
      CMD: { type: 'CMD', doc: 'Command constants.' },
      Echo: { type: 'function(...: any)' },
    })
    const spring = environment.types?.['Spring']?.members
    expect(spring?.['GetGameFrame']).toEqual({
      kind: 'function',
      params: [],
      returns: ['number', 'number'],
      doc: [
        '[source](https://example.test/LuaSyncedRead.cpp#L1)',
        '',
        '- returns `t1`: number — frameNum % dayFrames',
        '- returns `t2`: number',
      ].join(String.fromCharCode(10)),
    })
    expect(spring?.['GetUnitPosition']).toMatchObject({
      params: [
        { name: 'unitID', type: 'integer' },
        { name: 'midPos', type: 'boolean', optional: true },
      ],
      returns: ['number?', 'number', 'number'],
    })
    // Parameter descriptions and return names, which the member fields cannot hold, are in the doc.
    expect(spring?.['GetUnitPosition']?.doc?.split(String.fromCharCode(10))).toEqual([
      'Position of a unit.',
      '',
      '- `midPos` — return the middle of the unit',
      '- returns `x`: number?',
      '- returns `y`: number',
      '- returns `z`: number',
    ])
    expect(spring?.['GetFrame']?.deprecated).toBe(true)
    expect(spring?.['MoveCtrl']).toEqual({ kind: 'property', type: 'Spring.MoveCtrl' })
    expect(environment.types?.['Spring.MoveCtrl']?.members?.['Enable']).toMatchObject({
      kind: 'function',
    })
    // One supertype chains; the members of the others are copied in.
    expect(environment.types?.['Widget']).toMatchObject({
      extends: 'Callins',
      members: { DrawScreen: { kind: 'callback', type: 'fun(self)?' } },
    })
    expect(environment.types?.['Callins']?.members?.['Initialize']).toMatchObject({
      kind: 'method',
      doc: 'Called once when the handle loads.',
    })
    expect(environment.types?.['KeyModifiers']?.members).toEqual({
      alt: { kind: 'property', type: 'boolean' },
      ctrl: { kind: 'property', type: 'boolean', doc: 'Whether ctrl is held.' },
    })
    expect(environment.types?.['CMD']?.members).toEqual({
      OPT_ALT: {
        kind: 'property',
        type: 'number',
        doc: '[source](https://example.test/LuaConstCMD.cpp#L19)',
      },
      STOP: { kind: 'property', type: 'integer', doc: 'Stop the unit.' },
    })
    expect(environment.types?.['CommandOption']?.doc).toBe('Alias of `| "alt" | "ctrl"`.')
    expect(environment.globals?.['Spring']).not.toHaveProperty('doc')
  })

  it('answers hover through the Lua language, as a game hands it the environment', async () => {
    const environment = await luaEnvironmentFromAnnotations('Recoil', LIBRARY)
    const text =
      'local x = Spring.GetUnitPosition(1)\nlocal alt = CMD.OPT_ALT\nSpring.MoveCtrl.Enable(1)\n'
    const document: LanguageDocument = {
      uri: 'file:///game/luaui/widgets/w.lua',
      languageId: 'lua',
      version: 1,
      text,
    }
    const context: LanguageWorkspaceContext = {
      id: 'ctx',
      revision: '1',
      semanticComplete: true,
      documentOrigins: [],
      semanticInputs: [
        {
          kind: 'language-knowledge',
          id: 'game/modkit.lua-environment.json',
          revision: '1',
          payload: {
            fileName: LUA_ENVIRONMENT_FILE,
            layerId: 'game',
            text: JSON.stringify(environment),
          },
        },
      ],
    }
    const hover = async (needle: string) =>
      (
        await luaHover({
          document,
          workspaceDocuments: [document],
          workspaceContext: context,
          workspaceIncomplete: false,
          maxResults: 100,
          maxDocuments: 100,
          position: new LuaLineIndex(text).position(text.indexOf(needle)),
        })
      )?.markdown
    expect(await hover('GetUnitPosition')).toContain(
      '(function) Spring.GetUnitPosition(unitID: integer, midPos: boolean?): number?, number, number',
    )
    expect(await hover('OPT_ALT')).toContain('(property) CMD.OPT_ALT: number')
    expect(await hover('Enable')).toContain('(function) Spring.MoveCtrl.Enable(unitID: integer)')
  })
})
