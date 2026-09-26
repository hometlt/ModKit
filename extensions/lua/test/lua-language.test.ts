import { describe, expect, it } from 'vitest'
import type { LanguageDocument, LanguageFeatureRequest } from '@modkit/sdk'
import type {
  AstStatLocal,
  AstExprConstantNumber,
  AstExprConstantString,
  LuaDialect,
} from '../src/ast.js'
import { bindLuaChunk } from '../src/binder.js'
import { LuaLineIndex } from '../src/line-index.js'
import { analyzeLua, createLuaLanguageProvider, luaDocumentState } from '../src/provider.js'
import { luaSyntax } from '../src/syntax.js'

let version = 0
function doc(
  text: string,
  languageId = 'lua',
  uri = `file:///t${(version += 1)}.lua`,
): LanguageDocument {
  return { uri, languageId, version: 1, text }
}

function request(document: LanguageDocument, extra: Partial<LanguageFeatureRequest> = {}) {
  return {
    document,
    workspaceDocuments: [document],
    workspaceIncomplete: false,
    maxResults: 100,
    maxDocuments: 100,
    ...extra,
  }
}

const at = (document: LanguageDocument, needle: string, occurrence = 0) => {
  let offset = -1
  for (let index = 0; index <= occurrence; index += 1)
    offset = document.text.indexOf(needle, offset + 1)
  if (offset < 0) throw new Error(`${needle} not found`)
  return new LuaLineIndex(document.text).position(offset)
}

describe('Lua-family syntax', () => {
  it('parses each dialect into the v1 tree and keeps literal spelling', async () => {
    const syntax = await luaSyntax()
    const lua54 = syntax.parse('local x <const> = 0.35 goto done ::done::', 'lua54')
    expect(lua54.errors).toEqual([])
    const local = lua54.chunk.body[0] as AstStatLocal
    expect(local.vars[0]).toMatchObject({ name: 'x', attribute: 'const' })
    expect(local.values[0]).toMatchObject({
      type: 'AstExprConstantNumber',
      raw: '0.35',
      value: 0.35,
    })
    expect(lua54.chunk.body.map(stat => stat.type)).toEqual([
      'AstStatLocal',
      'AstStatGoto',
      'AstStatLabel',
    ])

    const luau = syntax.parse('local s: string = `v{1 + 2}` x += 1', 'luau')
    expect(luau.errors).toEqual([])
    expect(luau.chunk.body.map(stat => stat.type)).toEqual([
      'AstStatLocal',
      'AstStatCompoundAssign',
    ])

    const strings = syntax.parse('return "a\\z   b", [[\nl1\r\nl2]], "\\255"', 'lua54')
    const values = (strings.chunk.body[0] as { list: AstExprConstantString[] }).list
    expect(values.map(value => value.value)).toEqual(['ab', 'l1\nl2', '�'])
    expect(values[2]?.bytesHex).toBe('ff')

    const number = syntax.parse('return 1_000', 'luau').chunk.body[0] as {
      list: AstExprConstantNumber[]
    }
    expect(number.list[0]).toMatchObject({ raw: '1_000', value: 1000 })
  })

  it('reports errors without losing the recovered tree, and ranges are UTF-16', async () => {
    const syntax = await luaSyntax()
    const broken = syntax.parse('local x = ', 'lua54')
    expect(broken.errors.length).toBeGreaterThan(0)
    expect(broken.chunk.type).toBe('AstStatBlock')
    const text = 'local s = "ё😀" x = 1'
    const parsed = syntax.parse(text, 'luau')
    const assign = parsed.chunk.body[1]
    expect(assign && text.slice(assign.range[0], assign.range[1])).toBe('x = 1')
  })

  it('survives hostile nesting', async () => {
    const syntax = await luaSyntax()
    const deep = `x = ${'('.repeat(2000)}1${')'.repeat(2000)}`
    const parsed = syntax.parse(deep, 'lua51')
    expect(parsed.chunk.type).toBe('AstStatBlock')
    // The next parse still works, whatever happened to the previous instance.
    expect(syntax.parse('return 1', 'lua51').errors).toEqual([])
  })
})

describe('binding', () => {
  const bind = async (text: string, dialect: LuaDialect = 'lua54') => {
    const parsed = (await luaSyntax()).parse(text, dialect)
    expect(parsed.errors).toEqual([])
    return { text, bound: bindLuaChunk(parsed.chunk) }
  }
  /** Binding of the n-th whole-word occurrence of `word`. */
  const bindingAt = (
    text: string,
    bound: ReturnType<typeof bindLuaChunk>,
    word: string,
    occurrence = 0,
  ) => {
    const matches = [...text.matchAll(new RegExp(String.raw`\b${word}\b`, 'gu'))]
    const offset = matches[occurrence]?.index
    if (offset === undefined) throw new Error(`${word} #${occurrence} not found`)
    const found = bound.occurrenceAt(offset)
    return found === undefined ? undefined : bound.bindings[found.binding]
  }

  it('applies Lua visibility rules', async () => {
    const { text, bound } = await bind(
      'local a = 1 local a = a + 1 local function f() return f end repeat local r = 1 until r > 0 for i = 1, 2 do print(i) end',
    )
    // `local a = a` reads the outer a.
    const first = bindingAt(text, bound, 'a', 0)
    const second = bindingAt(text, bound, 'a', 1)
    const readInSecond = bindingAt(text, bound, 'a', 2)
    expect(first?.kind).toBe('local')
    expect(second?.id).not.toBe(first?.id)
    expect(readInSecond?.id).toBe(first?.id)
    // Recursive local function.
    expect(bindingAt(text, bound, 'f', 1)?.kind).toBe('function')
    // repeat … until sees the body local.
    expect(bindingAt(text, bound, 'r', 1)?.kind).toBe('local')
    expect(bindingAt(text, bound, 'print')?.kind).toBe('global')
    expect(bindingAt(text, bound, 'i', 1)?.kind).toBe('for')
  })

  it('gives methods an implicit self and resolves labels per function', async () => {
    const { text, bound } = await bind('function t.m:go() return self end goto x ::x::')
    expect(bindingAt(text, bound, 'self')?.kind).toBe('self')
    expect(bindingAt(text, bound, 'x', 0)?.kind).toBe('label')
  })
})

describe('language provider', () => {
  it('detects Luau written in .lua files and analyses it', async () => {
    const document = doc('local n: number = 1\nn += 1\nfor _, v in pairs({}) do continue end\n')
    const state = await luaDocumentState(document)
    expect(state.dialect).toBe('luau')
    const analysis = await analyzeLua({ document })
    expect(analysis.diagnostics).toEqual([])
    expect(analysis.tokens.some(token => token.kind === 'type')).toBe(true)
  })

  it('outlines functions, renames locals and finds references', async () => {
    const document = doc(
      'local M = {}\nfunction M.go(a)\n  local b = a\n  return b\nend\nlocal function helper() end\nreturn M\n',
    )
    const provider = createLuaLanguageProvider()
    const outline = await provider.documentSymbols?.(request(document))
    expect(outline?.symbols.map(symbol => symbol.name)).toEqual(['M', 'M.go', 'helper'])
    const rename = await provider.rename?.({
      ...request(document),
      position: at(document, 'b ='),
      newName: 'value',
      maxEdits: 10,
    })
    expect(rename?.documentChanges[0]?.edits).toHaveLength(2)
    const references = await provider.references?.({
      ...request(document),
      position: at(document, 'a)'),
    })
    expect(references?.locations).toHaveLength(2)
    const hover = await provider.hover?.({ ...request(document), position: at(document, 'helper') })
    expect(hover?.markdown).toContain('local function helper()')
  })

  it('follows globals across the workspace snapshot', async () => {
    const a = doc('Shared = {}\nfunction Shared.run() end\n', 'lua', 'file:///a.lua')
    const b = doc('Shared.run()\n', 'lua', 'file:///b.lua')
    const provider = createLuaLanguageProvider()
    const definition = await provider.definition?.({
      ...request(b, { workspaceDocuments: [a, b] }),
      position: at(b, 'Shared'),
    })
    expect(definition?.locations.map(location => location.uri)).toEqual(['file:///a.lua'])
    const refused = await provider.prepareRename?.({
      ...request(b, { workspaceDocuments: [a, b], workspaceIncomplete: true }),
      position: at(b, 'Shared'),
    })
    expect(refused).toBeUndefined()
  })
})

describe('dialect a game declares', () => {
  it('reads the file as the declared dialect, and warns about one it does not know', async () => {
    const scar = { ...doc('local goto = 1; return goto', 'lua', 'file:///m.scar'), dialect: 'lua51' }
    const state = await luaDocumentState(scar)
    expect([state.dialect, state.parse.errors]).toEqual(['lua51', []])

    const unknown = await luaDocumentState({ ...doc('return 1', 'lua', 'file:///m.scar'), dialect: 'lua50' })
    expect(unknown.dialect).toBe('lua54')
    const provider = createLuaLanguageProvider()
    const diagnostics = await provider.diagnostics!(request({ ...doc('return 1', 'lua', 'file:///n.scar'), dialect: 'lua50' }))
    expect(diagnostics.diagnostics.map(item => [item.code, item.severity])).toEqual([['unknown-dialect', 'warning']])
  })
})
