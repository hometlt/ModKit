import { describe, expect, it } from 'vitest'
import type { LanguageDocument, LanguageFeatureRequest, LanguageWorkspaceContext } from '@modkit/sdk'
import { LUA_ENVIRONMENT_FILE, LUA_ENVIRONMENT_FORMAT, type LuaEnvironment } from '../src/environment.js'
import { LuaLineIndex } from '../src/line-index.js'
import { luaCompletion, luaDefinition, luaHover } from '../src/provider.js'

/** A small game environment: an object tree with services and modules, and two classes. */
const ENVIRONMENT: LuaEnvironment = {
  format: LUA_ENVIRONMENT_FORMAT,
  name: 'test game',
  globals: {
    game: { type: 'DataModel' },
    workspace: { type: 'Workspace', instancePath: ['Workspace'], doc: 'The 3D world.' },
  },
  types: {
    Instance: {
      members: {
        Name: { kind: 'property', type: 'string' },
        Parent: { kind: 'property', type: 'Instance' },
        FindFirstChild: { kind: 'method', params: [{ name: 'name', type: 'string' }, { name: 'recursive', type: 'bool', optional: true }], returns: ['Instance'] },
        Destroy: { kind: 'method' },
        remove: { kind: 'method', deprecated: true },
      },
    },
    DataModel: { extends: 'Instance', members: { GetService: { kind: 'method', params: [{ name: 'className', type: 'string' }], returns: ['Instance'] } } },
    Workspace: { extends: 'Instance', members: { Gravity: { kind: 'property', type: 'number', doc: 'Studs per second squared.' } } },
    ModuleScript: { extends: 'Instance' },
    ReplicatedStorage: { extends: 'Instance' },
    Folder: { extends: 'Instance' },
  },
  instances: {
    global: 'game',
    self: 'script',
    parent: 'Parent',
    childMethods: ['WaitForChild', 'FindFirstChild'],
    serviceMethods: ['GetService'],
    loader: 'require',
    root: {
      name: 'Game',
      className: 'DataModel',
      children: [
        { name: 'Workspace', className: 'Workspace' },
        {
          name: 'ReplicatedStorage',
          className: 'ReplicatedStorage',
          children: [
            {
              name: 'Shared',
              className: 'Folder',
              children: [
                { name: 'Util', className: 'ModuleScript', filePaths: ['src/shared/Util.luau'] },
                { name: 'Main', className: 'ModuleScript', filePaths: ['src/shared/Main.luau'] },
              ],
            },
          ],
        },
      ],
    },
  },
}

const context = (environment: unknown = ENVIRONMENT): LanguageWorkspaceContext => ({
  id: 'ctx',
  revision: '1',
  semanticComplete: true,
  documentOrigins: [
    { uri: 'file:///p/src/shared/Main.luau', layerId: 'project', logicalId: 'src/shared/Main.luau', precedence: 1, sourceRevision: '1', readOnly: false },
    { uri: 'file:///p/src/shared/Util.luau', layerId: 'project', logicalId: 'src/shared/Util.luau', precedence: 1, sourceRevision: '1', readOnly: false },
  ],
  semanticInputs: [
    { kind: 'language-knowledge', id: 'environment/modkit.lua-environment.json', revision: JSON.stringify(environment).length.toString(), payload: { fileName: LUA_ENVIRONMENT_FILE, layerId: 'environment', text: JSON.stringify(environment) } },
  ],
})

const MAIN = `local RS = game:GetService("ReplicatedStorage")
local Util = require(RS.Shared.Util)
local Sibling = require(script.Parent.Util)
print(workspace.Gravity, game.ReplicatedStorage.Shared)
`
const main: LanguageDocument = { uri: 'file:///p/src/shared/Main.luau', languageId: 'luau', version: 1, text: MAIN }
const util: LanguageDocument = { uri: 'file:///p/src/shared/Util.luau', languageId: 'luau', version: 1, text: 'return {}\n' }

function request(document: LanguageDocument, needle: string, extra: Partial<LanguageFeatureRequest> = {}, occurrence = 0) {
  let offset = -1
  for (let index = 0; index <= occurrence; index += 1) offset = document.text.indexOf(needle, offset + 1)
  if (offset < 0) throw new Error(`${needle} not found`)
  return {
    document,
    workspaceDocuments: [document, util],
    workspaceContext: context(),
    workspaceIncomplete: false,
    maxResults: 100,
    maxDocuments: 100,
    position: new LuaLineIndex(document.text).position(offset),
    ...extra,
  }
}

describe('Lua game environment', () => {
  it('hovers members, instances and globals the environment knows', async () => {
    expect((await luaHover(request(main, 'Gravity')))?.markdown).toContain('(property) Workspace.Gravity: number')
    expect((await luaHover(request(main, 'Gravity')))?.markdown).toContain('Studs per second squared.')
    const shared = await luaHover(request(main, 'Shared', {}, 1))
    expect(shared?.markdown).toContain('(instance) ReplicatedStorage.Shared: Folder')
    expect((await luaHover(request(main, 'Util)')))?.markdown).toContain('`src/shared/Util.luau`')
    expect((await luaHover(request(main, 'workspace')))?.markdown).toContain('(global) workspace: Workspace (Workspace)')
    // Without an environment the provider answers as before.
    expect((await luaHover(request(main, 'workspace', { workspaceContext: { ...context(), semanticInputs: [] } })))?.markdown).toContain('global workspace')
  })

  it('goes to the module a require names, through a local, a service and script.Parent', async () => {
    const util1 = await luaDefinition(request(main, 'require(RS'))
    expect(util1.locations).toEqual([{ uri: util.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }])
    const util2 = await luaDefinition(request(main, 'Parent.Util'))
    expect(util2.locations.map(location => location.uri)).toEqual([util.uri])
  })

  it('completes children and members after a dot, methods after a colon, globals elsewhere', async () => {
    const typed = (text: string) => ({ uri: main.uri, languageId: 'luau', version: 2, text })
    const dot = typed(`${MAIN}local x = game.ReplicatedStorage.Shared.`)
    const members = await luaCompletion({ ...request(dot, 'Shared.'), position: new LuaLineIndex(dot.text).position(dot.text.length) })
    const labels = members.items.map(item => item.label)
    expect(labels).toEqual(expect.arrayContaining(['Util', 'Main', 'Name', 'Parent']))
    expect(labels).not.toContain('FindFirstChild')

    const colon = typed(`${MAIN}RS:Fi`)
    const methods = await luaCompletion({ ...request(colon, 'RS:Fi'), position: new LuaLineIndex(colon.text).position(colon.text.length) })
    expect(methods.items.map(item => item.label)).toEqual(expect.arrayContaining(['FindFirstChild', 'Destroy', 'remove']))
    expect(methods.items.find(item => item.label === 'FindFirstChild')?.detail).toBe(
      '(method) Instance:FindFirstChild(name: string, recursive: bool?): Instance',
    )
    expect(methods.items.find(item => item.label === 'Name')).toBeUndefined()

    const bare = typed(`${MAIN}wo`)
    const globals = await luaCompletion({ ...request(bare, 'wo', {}, 1), position: new LuaLineIndex(bare.text).position(bare.text.length) })
    expect(globals.items.map(item => item.label)).toEqual(expect.arrayContaining(['workspace', 'game', 'RS', 'Util', 'Sibling']))
  })

  it('ignores knowledge files that are not an environment', async () => {
    const hover = await luaHover(request(main, 'Gravity', { workspaceContext: context({ format: 'something-else' }) }))
    expect(hover?.markdown ?? '').not.toContain('Workspace.Gravity')
  })
})
