#!/usr/bin/env node
// Smoke test for the Modkit Lua/Luau syntax WASM emitter (native/). Node ESM, no dependencies.
//
// Instantiates modkit-lua-syntax.wasm directly (no wasm-bindgen, no imports expected), drives
// the lua_alloc/lua_parse/lua_dealloc ABI, and checks a battery of hand-picked cases against the
// ast.ts contract. Also parses two real-world Luau corpora and reports aggregate stats.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const wasmPath = path.join(__dirname, '..', 'wasm', 'modkit-lua-syntax.wasm')

const DIALECT = { lua51: 0, lua52: 1, lua53: 2, lua54: 3, luajit: 4, luau: 5, cfxlua: 6 }

const wasmBytes = readFileSync(wasmPath)
const { instance } = await WebAssembly.instantiate(wasmBytes, {})
const exports = instance.exports
const { memory, lua_abi_version, lua_alloc, lua_dealloc, lua_parse } = exports

console.log(`wasm loaded: ${wasmPath}`)
console.log(`lua_abi_version = ${lua_abi_version()}`)

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

/** Runs one parse through the wasm ABI and returns the parsed LuaParseResult. */
function parseLua(source, dialectCode) {
  const srcBytes = encoder.encode(source)
  const srcPtr = lua_alloc(srcBytes.length)
  new Uint8Array(memory.buffer, srcPtr, srcBytes.length).set(srcBytes)

  const resultPtr = lua_parse(srcPtr, srcBytes.length, dialectCode)
  const lenView = new DataView(memory.buffer, resultPtr, 4)
  const jsonLen = lenView.getUint32(0, true)
  const jsonBytes = new Uint8Array(memory.buffer, resultPtr + 4, jsonLen)
  const json = decoder.decode(jsonBytes)

  lua_dealloc(srcPtr, srcBytes.length)
  lua_dealloc(resultPtr, jsonLen + 4)

  return JSON.parse(json)
}

/** Same as parseLua but also returns elapsed wall-clock ms (for the corpus scan). */
function parseLuaTimed(source, dialectCode) {
  const t0 = performance.now()
  const result = parseLua(source, dialectCode)
  const t1 = performance.now()
  return { result, ms: t1 - t0 }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

let passCount = 0
let failCount = 0
function check(name, fn) {
  try {
    fn()
    console.log(`PASS: ${name}`)
    passCount++
  } catch (e) {
    console.log(`FAIL: ${name} - ${e && e.message ? e.message : e}`)
    failCount++
  }
}

// -----------------------------------------------------------------------------------------
// Battery of hand-picked cases
// -----------------------------------------------------------------------------------------

check('lua54: <const> attribute, goto/label, method call, // and &', () => {
  const src = `local x <const> = 1 goto done ::done:: local y = a.b:c(1, "s\\x41") // 2 & 3`
  const r = parseLua(src, DIALECT.lua54)
  assert(r.errors.length === 0, `expected 0 errors, got ${JSON.stringify(r.errors)}`)

  const body = r.chunk.body
  const localX = body.find(s => s.type === 'AstStatLocal' && s.vars[0].name === 'x')
  assert(localX && localX.vars[0].attribute === 'const', 'expected local x with <const> attribute')
  assert(
    body.some(s => s.type === 'AstStatGoto' && s.label.name === 'done'),
    'expected goto done',
  )
  assert(
    body.some(s => s.type === 'AstStatLabel' && s.name.name === 'done'),
    'expected ::done::',
  )

  const localY = body.find(s => s.type === 'AstStatLocal' && s.vars[0].name === 'y')
  assert(localY, 'expected local y')
  const val = localY.values[0]
  assert(
    val.type === 'AstExprBinary' && val.op === 'BitAnd',
    `expected outer BitAnd, got ${val.type}/${val.op}`,
  )
  assert(
    val.left.type === 'AstExprBinary' && val.left.op === 'FloorDiv',
    `expected inner FloorDiv, got ${val.left.type}/${val.left.op}`,
  )
  const call = val.left.left
  assert(call.type === 'AstExprCall' && call.self === true, 'expected method call with self=true')
  assert(
    call.func.type === 'AstExprIndexName' && call.func.op === ':' && call.func.index === 'c',
    'expected a.b:c chain',
  )
  assert(
    call.args[1].value === 'sA',
    `expected "s\\x41" to decode to "sA", got ${JSON.stringify(call.args[1].value)}`,
  )
})

check('lua51: dotted method declaration, varargs, select', () => {
  const src = `function t.a.b:m(...) return select('#', ...) end`
  const r = parseLua(src, DIALECT.lua51)
  assert(r.errors.length === 0, `expected 0 errors, got ${JSON.stringify(r.errors)}`)

  const fn = r.chunk.body.find(s => s.type === 'AstStatFunction')
  assert(fn, 'expected AstStatFunction')
  assert(
    fn.name.type === 'AstExprIndexName' && fn.name.op === ':' && fn.name.index === 'm',
    'expected trailing :m',
  )
  assert(
    fn.name.expr.type === 'AstExprIndexName' &&
      fn.name.expr.op === '.' &&
      fn.name.expr.index === 'b',
    'expected .b',
  )
  assert(
    fn.name.expr.expr.type === 'AstExprIndexName' &&
      fn.name.expr.expr.op === '.' &&
      fn.name.expr.expr.index === 'a',
    'expected .a',
  )
  assert(
    fn.name.expr.expr.expr.type === 'AstExprName' && fn.name.expr.expr.expr.name === 't',
    'expected base t',
  )
  assert(fn.func.self && fn.func.self.name === 'self', 'expected implicit self local')
  assert(fn.func.vararg === true, 'expected vararg true')
  assert(fn.func.debugname === 't.a.b:m', `expected debugname t.a.b:m, got ${fn.func.debugname}`)

  const ret = fn.func.body.body.find(s => s.type === 'AstStatReturn')
  const call = ret.list[0]
  assert(
    call.type === 'AstExprCall' && call.func.type === 'AstExprName' && call.func.name === 'select',
    'expected select(...) call',
  )
  assert(call.args[1].type === 'AstExprVarargs', 'expected ... as second argument')
})

check(
  'luau: exported generic type, generic function, interp string, compound assign, if-expr, type assertion',
  () => {
    const src =
      'export type P<T> = { x: number, [string]: T? } local function f<T>(a: T, ...: number): (T, ...string) return a end local s = `v={x}` x += 1 continue_ = if a then b elseif c then d else e local v = (x :: any)'
    const r = parseLua(src, DIALECT.luau)
    assert(r.errors.length === 0, `expected 0 errors, got ${JSON.stringify(r.errors)}`)

    const typeAlias = r.chunk.body.find(s => s.type === 'AstStatTypeAlias')
    assert(
      typeAlias && typeAlias.exported === true && typeAlias.name.name === 'P',
      'expected exported type P',
    )
    assert(
      typeAlias.generics.length === 1 && typeAlias.generics[0].name === 'T',
      'expected generic <T>',
    )
    assert(
      typeAlias.value.type === 'AstTypeTable' && typeAlias.value.indexer,
      'expected table type with indexer',
    )
    assert(
      typeAlias.value.props.length === 1 && typeAlias.value.props[0].name === 'x',
      'expected prop x: number',
    )
    assert(
      typeAlias.value.indexer.resultType.type === 'AstTypeOptional',
      'expected [string]: T? (optional result)',
    )

    const fn = r.chunk.body.find(s => s.type === 'AstStatLocalFunction')
    assert(
      fn && fn.func.generics.length === 1 && fn.func.generics[0].name === 'T',
      'expected local function f<T>',
    )
    assert(
      fn.func.args.length === 1 && fn.func.args[0].name === 'a',
      'expected one named parameter a',
    )
    assert(
      fn.func.vararg === true &&
        fn.func.varargAnnotation &&
        fn.func.varargAnnotation.type === 'AstTypePackVariadic',
      'expected vararg with annotation',
    )
    assert(
      fn.func.returnAnnotation &&
        fn.func.returnAnnotation.types.length === 1 &&
        fn.func.returnAnnotation.tailType,
      `expected return (T, ...string) as one type + tail, got ${JSON.stringify(fn.func.returnAnnotation)}`,
    )

    const interpLocal = r.chunk.body.find(s => s.type === 'AstStatLocal' && s.vars[0].name === 's')
    assert(
      interpLocal && interpLocal.values[0].type === 'AstExprInterpString',
      'expected interpolated string',
    )
    const interp = interpLocal.values[0]
    assert(
      interp.strings.length === interp.expressions.length + 1,
      'interp string strings/expressions invariant',
    )

    const compound = r.chunk.body.find(s => s.type === 'AstStatCompoundAssign')
    assert(compound && compound.op === 'Add' && compound.var.name === 'x', 'expected x += 1')

    const ifExprAssign = r.chunk.body.find(
      s => s.type === 'AstStatAssign' && s.vars[0].name === 'continue_',
    )
    assert(ifExprAssign, 'expected continue_ = ... assignment (continue_ is just an identifier)')
    assert(ifExprAssign.values[0].type === 'AstExprIfElse', 'expected if-expression')
    assert(
      ifExprAssign.values[0].falseExpr.type === 'AstExprIfElse',
      'expected nested elseif in falseExpr',
    )

    // `(x :: any)` is parenthesized, so the outer node is AstExprGroup wrapping the assertion.
    const typeAssertLocal = r.chunk.body.find(
      s => s.type === 'AstStatLocal' && s.vars[0].name === 'v',
    )
    assert(
      typeAssertLocal && typeAssertLocal.values[0].type === 'AstExprGroup',
      'expected (x :: any) wrapped in AstExprGroup',
    )
    assert(
      typeAssertLocal.values[0].expr.type === 'AstExprTypeAssertion',
      'expected inner AstExprTypeAssertion',
    )
  },
)

check(
  'numbers: hex-float p-exponent, underscore separator, binary, decimal exponent, big integer',
  () => {
    const src = 'return 0x1p4, 1_000, 0b101, 3.25e2, 0.35, 9007199254740993'
    const r = parseLua(src, DIALECT.luau)
    assert(r.errors.length === 0, `expected 0 errors, got ${JSON.stringify(r.errors)}`)

    const ret = r.chunk.body.find(s => s.type === 'AstStatReturn')
    assert(ret && ret.list.length === 6, `expected 6 return values, got ${ret && ret.list.length}`)
    const raws = ret.list.map(e => e.raw)
    const expectedRaws = ['0x1p4', '1_000', '0b101', '3.25e2', '0.35', '9007199254740993']
    assert(
      JSON.stringify(raws) === JSON.stringify(expectedRaws),
      `raw mismatch: ${JSON.stringify(raws)}`,
    )
    assert(ret.list[0].value === 16, `expected 0x1p4 == 16, got ${ret.list[0].value}`)
    assert(ret.list[1].value === 1000, `expected 1_000 == 1000, got ${ret.list[1].value}`)
    assert(ret.list[2].value === 5, `expected 0b101 == 5, got ${ret.list[2].value}`)
    assert(ret.list[3].value === 325, `expected 3.25e2 == 325, got ${ret.list[3].value}`)
    assert(ret.list[4].value === 0.35, `expected 0.35 value, got ${ret.list[4].value}`)
  },
)

check(
  'strings: \\z whitespace-skip, long-string newline normalize, \\u/\\d/\\x escapes, invalid-utf8 byte',
  () => {
    const src = `return "a\\z   b", [[\nline1\r\nline2]], '\\u{48}\\65\\x6c', "\\255"`
    const r = parseLua(src, DIALECT.lua54)
    assert(r.errors.length === 0, `expected 0 errors, got ${JSON.stringify(r.errors)}`)

    const ret = r.chunk.body.find(s => s.type === 'AstStatReturn')
    const [a, b, c, d] = ret.list
    assert(
      a.quoteStyle === 'double' && a.value === 'ab',
      `expected "ab", got ${JSON.stringify(a.value)}`,
    )
    assert(
      b.quoteStyle === 'long' && b.value === 'line1\nline2',
      `expected line1\\nline2, got ${JSON.stringify(b.value)}`,
    )
    assert(
      c.quoteStyle === 'single' && c.value === 'HAl',
      `expected HAl, got ${JSON.stringify(c.value)}`,
    )
    assert(d.bytesHex === 'ff', `expected bytesHex "ff", got ${d.bytesHex}`)
  },
)

check('UTF-16 ranges: astral emoji counts as 2 code units', () => {
  const src = 'local ё = "😀" x = 1'
  const r = parseLua(src, DIALECT.luau)
  const assign = r.chunk.body.find(s => s.type === 'AstStatAssign')
  assert(assign, 'expected assignment statement x = 1')
  const expectedStart = src.indexOf('x = 1')
  const expectedEnd = expectedStart + 'x = 1'.length
  assert(
    assign.range[0] === expectedStart && assign.range[1] === expectedEnd,
    `expected range [${expectedStart},${expectedEnd}], got ${JSON.stringify(assign.range)}`,
  )
})

check('error recovery: incomplete local assignment does not trap', () => {
  const r = parseLua('local x = ', DIALECT.luau)
  assert(r.chunk && r.chunk.type === 'AstStatBlock', 'expected a chunk')
  assert(r.errors.length >= 1, `expected >=1 error, got ${r.errors.length}`)
})

check('deep nesting: 2000 nested parentheses does not trap', () => {
  const src = 'x = ' + '('.repeat(2000) + '1' + ')'.repeat(2000)
  const r = parseLua(src, DIALECT.luau)
  assert(r.chunk && r.chunk.type === 'AstStatBlock', 'expected a chunk')
  assert(
    r.errors.length === 0,
    `expected the raised wasm stack to parse this cleanly, got ${r.errors.length} errors`,
  )
})

// -----------------------------------------------------------------------------------------
// Real-world corpus scans
// -----------------------------------------------------------------------------------------

function walkFiles(dir, extensions) {
  const results = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
        results.push(full)
      }
    }
  }
  return results
}

function scanCorpus(label, dir, files) {
  console.log(`\n${label}: ${dir}`)
  if (files.length === 0) {
    console.log('  (no files found)')
    return
  }

  let totalBytes = 0
  let totalMs = 0
  let filesWithErrors = 0
  const errorSamples = []

  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      filesWithErrors++
      errorSamples.push({ file, message: `read failed: ${e.message}` })
      continue
    }
    totalBytes += Buffer.byteLength(text, 'utf8')
    const { result, ms } = parseLuaTimed(text, DIALECT.luau)
    totalMs += ms
    if (result.errors && result.errors.length > 0) {
      filesWithErrors++
      errorSamples.push({ file, message: result.errors[0].message })
    }
  }

  console.log(
    `  files: ${files.length}, files with errors: ${filesWithErrors}, total bytes: ${totalBytes}, total ms: ${totalMs.toFixed(1)}`,
  )
  for (const e of errorSamples) {
    console.log(`  ERROR ${path.relative(dir, e.file)}: ${e.message}`)
  }
}

const rtsDir = 'C:\\FILES\\SC2Files\\coding\\Roblox\\RTS\\src'
const rtsFiles = walkFiles(rtsDir, ['.lua', '.luau'])
scanCorpus('Roblox RTS corpus', rtsDir, rtsFiles)

const luaPackagesDir =
  'C:\\Users\\Admin\\AppData\\Local\\Roblox\\Versions\\version-3afcc74cf8b04b5d\\ExtraContent\\LuaPackages'
const luaPackagesFiles = walkFiles(luaPackagesDir, ['.lua']).slice(0, 300)
scanCorpus('Roblox LuaPackages corpus (first 300)', luaPackagesDir, luaPackagesFiles)

// -----------------------------------------------------------------------------------------

console.log(`\n${passCount} passed, ${failCount} failed`)
process.exitCode = failCount > 0 ? 1 : 0
