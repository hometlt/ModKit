import { readdir, readFile } from 'node:fs/promises'
import { delimiter, extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bindLuaChunk } from '../src/binder.js'
import { luaDocumentState } from '../src/provider.js'

/**
 * Real Lua/Luau sources, parsed and bound through the same path the language provider uses.
 * `MODKIT_LUA_CORPUS` lists directories (path-delimiter separated), for example a Rojo project's
 * `src`, Roblox Studio's `ExtraContent/LuaPackages`, or unpacked game scripts.
 */
const roots = (process.env['MODKIT_LUA_CORPUS'] ?? '').split(delimiter).filter(Boolean)

async function* luaFiles(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* luaFiles(path)
    else if (['.lua', '.luau'].includes(extname(entry.name).toLowerCase())) yield path
  }
}

describe.skipIf(roots.length === 0)('Lua corpus', () => {
  it('parses and binds every file', { timeout: 600_000 }, async () => {
    let files = 0
    let bytes = 0
    const failures: string[] = []
    const dialects = new Map<string, number>()
    const started = performance.now()
    for (const root of roots) {
      for await (const path of luaFiles(root)) {
        const text = await readFile(path, 'utf8')
        const languageId = path.toLowerCase().endsWith('.luau') ? 'luau' : 'lua'
        const state = await luaDocumentState({
          uri: `file:///${path}`,
          languageId,
          version: 1,
          text,
        })
        bindLuaChunk(state.parse.chunk)
        files += 1
        bytes += text.length
        dialects.set(state.dialect, (dialects.get(state.dialect) ?? 0) + 1)
        if (state.parse.errors.length > 0)
          failures.push(`${path}: ${state.parse.errors[0]?.message}`)
      }
    }
    const seconds = (performance.now() - started) / 1000
    console.log(
      `lua corpus: ${files} files, ${(bytes / 1e6).toFixed(1)} MB in ${seconds.toFixed(1)} s; dialects ${JSON.stringify(Object.fromEntries(dialects))}; ${failures.length} with errors`,
    )
    for (const failure of failures.slice(0, 20)) console.log(`  ${failure}`)
    expect(files).toBeGreaterThan(0)
    expect(failures.length / files).toBeLessThan(0.01)
  })
})
