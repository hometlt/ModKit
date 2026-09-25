import { LUA_AST_VERSION, type LuaDialect, type LuaParseResult } from './ast.js'

/**
 * The Lua-family parser: full-moon compiled to WebAssembly (`native/`, built by
 * `scripts/build-wasm.mjs` into `wasm/modkit-lua-syntax.wasm`). One module instance serves every
 * parse; a trap (for example an exhausted stack) discards that instance and the next call starts a
 * fresh one, so one hostile document cannot poison later ones.
 */

const ABI_VERSION = 1

/** An instance whose linear memory grew past this is dropped after the parse. */
const RETAINED_MEMORY_LIMIT = 256 * 1024 * 1024

const DIALECT_CODES: Readonly<Record<LuaDialect, number>> = Object.freeze({
  lua51: 0,
  lua52: 1,
  lua53: 2,
  lua54: 3,
  luajit: 4,
  luau: 5,
  cfxlua: 6,
})

interface SyntaxExports {
  readonly memory: WebAssembly.Memory
  lua_abi_version(): number
  lua_alloc(length: number): number
  lua_dealloc(pointer: number, length: number): void
  lua_parse(pointer: number, length: number, dialect: number): number
}

export interface LuaSyntax {
  parse(text: string, dialect: LuaDialect): LuaParseResult
}

const WASM_URL = new URL('../wasm/modkit-lua-syntax.wasm', import.meta.url)

async function wasmBytes(): Promise<BufferSource> {
  if (WASM_URL.protocol === 'file:') {
    // A computed specifier keeps browser bundlers from resolving a Node built-in.
    const fsModule = 'node:fs/promises'
    const { readFile } = (await import(fsModule)) as {
      readFile(path: URL): Promise<Uint8Array>
    }
    return new Uint8Array(await readFile(WASM_URL))
  }
  const response = await fetch(WASM_URL)
  if (!response.ok) {
    throw new Error(`Lua syntax module is unavailable: ${response.status} ${WASM_URL.href}`)
  }
  return response.arrayBuffer()
}

let compiled: Promise<WebAssembly.Module> | undefined

function compileOnce(): Promise<WebAssembly.Module> {
  compiled ??= wasmBytes().then(bytes => WebAssembly.compile(bytes))
  compiled.catch(() => {
    compiled = undefined
  })
  return compiled
}

async function instantiate(module: WebAssembly.Module): Promise<SyntaxExports> {
  const instance = await WebAssembly.instantiate(module, {})
  const exports = instance.exports as unknown as SyntaxExports
  const abi = exports.lua_abi_version()
  if (abi !== ABI_VERSION) {
    throw new Error(`Lua syntax module ABI ${abi} does not match the loader (${ABI_VERSION})`)
  }
  return exports
}

function failedParse(dialect: LuaDialect, text: string, message: string): LuaParseResult {
  return {
    version: LUA_AST_VERSION,
    dialect,
    chunk: { type: 'AstStatBlock', range: [0, text.length], body: [] },
    comments: [],
    tokens: [],
    errors: [{ message, range: [0, 0] }],
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

/**
 * Loads the parser. Instantiation needs a microtask boundary; parsing itself is synchronous so
 * language requests do not interleave with other work on the same document.
 */
export async function loadLuaSyntax(): Promise<LuaSyntax> {
  const module = await compileOnce()
  let current: SyntaxExports | undefined = await instantiate(module)
  const replacement = (): SyntaxExports => {
    const instance = new WebAssembly.Instance(module, {})
    return instance.exports as unknown as SyntaxExports
  }
  return Object.freeze({
    parse(text: string, dialect: LuaDialect): LuaParseResult {
      const code = DIALECT_CODES[dialect]
      if (code === undefined) throw new TypeError(`Unknown Lua dialect: ${String(dialect)}`)
      const exports = (current ??= replacement())
      const source = encoder.encode(text)
      let input = 0
      let output = 0
      let outputLength = 0
      try {
        input = exports.lua_alloc(Math.max(1, source.byteLength))
        new Uint8Array(exports.memory.buffer, input, source.byteLength).set(source)
        output = exports.lua_parse(input, source.byteLength, code)
        const view = new DataView(exports.memory.buffer)
        outputLength = view.getUint32(output, true)
        const json = decoder.decode(new Uint8Array(exports.memory.buffer, output + 4, outputLength))
        const result = JSON.parse(json) as LuaParseResult
        if (result.version !== LUA_AST_VERSION) {
          throw new Error(`Lua syntax module produced AST version ${String(result.version)}`)
        }
        return result
      } catch (error) {
        if (error instanceof WebAssembly.RuntimeError) {
          current = undefined
          return failedParse(dialect, text, `The Lua parser stopped: ${error.message}`)
        }
        throw error
      } finally {
        if (current !== undefined) {
          if (input !== 0) exports.lua_dealloc(input, Math.max(1, source.byteLength))
          if (output !== 0) exports.lua_dealloc(output, outputLength + 4)
          // Linear memory never shrinks; after a huge document let the collector take the whole
          // instance instead of keeping hundreds of MiB for the next small one.
          if (exports.memory.buffer.byteLength > RETAINED_MEMORY_LIMIT) current = undefined
        }
      }
    },
  })
}

let shared: Promise<LuaSyntax> | undefined

/** Process-wide parser; concurrent callers share one instance. */
export function luaSyntax(): Promise<LuaSyntax> {
  shared ??= loadLuaSyntax()
  shared.catch(() => {
    shared = undefined
  })
  return shared
}
