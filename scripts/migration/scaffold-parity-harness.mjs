#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { portContext } from './lib/port-context.mjs'
import { scaffoldHarness } from './lib/port-generators.mjs'
import { parseFlags, requiredFlag } from './lib/port-cli.mjs'

const flags = parseFlags(process.argv.slice(2), ['--codec', '--out'])
const value = flag => requiredFlag(flags, flag)
const codec = value('--codec')
const out = path.resolve(value('--out'))
const context = await portContext()
const relative = path
  .relative(path.dirname(out), fileURLToPath(new URL('./lib/port-generators.mjs', import.meta.url)))
  .replaceAll('\\', '/')
const libraryUrl = relative.startsWith('.') ? relative : `./${relative}`
// Compute by URL rather than the shell so spaces and Windows drive letters remain literal.
const expected = new URL(libraryUrl, pathToFileURL(out)).href
if (expected !== new URL('./lib/port-generators.mjs', import.meta.url).href)
  throw new Error('generated relative module path does not resolve to its runtime')
const body = scaffoldHarness({ codec, requirements: context.requirements, libraryUrl })
await mkdir(path.dirname(out), { recursive: true })
await writeFile(out, body, { flag: 'wx' })
console.log(out)
