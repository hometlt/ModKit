#!/usr/bin/env node
// Builds native/ (a plain extern "C" Rust crate, no wasm-bindgen) to wasm32-unknown-unknown and
// copies the result to extensions/lua/wasm/modkit-lua-syntax.wasm. Node ESM, no dependencies.

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const luaRoot = path.resolve(__dirname, '..')
const nativeManifest = path.join(luaRoot, 'native', 'Cargo.toml')
const builtWasm = path.join(
  luaRoot,
  'native',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'modkit_lua_syntax.wasm',
)
const wasmOutDir = path.join(luaRoot, 'wasm')
const wasmOutFile = path.join(wasmOutDir, 'modkit-lua-syntax.wasm')

function locateCargo() {
  const exeName = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
  const homeCandidate = path.join(homedir(), '.cargo', 'bin', exeName)
  if (existsSync(homeCandidate)) return homeCandidate
  return 'cargo' // fall back to PATH
}

const cargo = locateCargo()
const nativeDir = path.join(luaRoot, 'native')
const args = [
  'build',
  '--manifest-path',
  nativeManifest,
  '--release',
  '--target',
  'wasm32-unknown-unknown',
  '--locked',
]

console.log(`Using cargo: ${cargo}`)
console.log(`Running (cwd=${nativeDir}): ${cargo} ${args.join(' ')}`)

// Cargo discovers `.cargo/config.toml` (which raises the wasm stack size) by walking up from
// its OWN working directory, not from --manifest-path. Run from native/ so native/.cargo/
// config.toml is always found, regardless of where this script was invoked from.
const buildResult = spawnSync(cargo, args, { stdio: 'inherit', cwd: nativeDir })
if (buildResult.error) {
  console.error(`Failed to launch cargo: ${buildResult.error.message}`)
  process.exit(1)
}
if (buildResult.status !== 0) {
  console.error(`cargo build failed with exit code ${buildResult.status}`)
  process.exit(buildResult.status ?? 1)
}

if (!existsSync(builtWasm)) {
  console.error(`Expected build output not found: ${builtWasm}`)
  process.exit(1)
}

mkdirSync(wasmOutDir, { recursive: true })
copyFileSync(builtWasm, wasmOutFile)

const bytes = readFileSync(wasmOutFile)
const sha256 = createHash('sha256').update(bytes).digest('hex')

console.log(`Copied to: ${wasmOutFile}`)
console.log(`Size: ${bytes.length} bytes`)
console.log(`SHA-256: ${sha256}`)
