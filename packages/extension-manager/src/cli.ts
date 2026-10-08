#!/usr/bin/env node

import { resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { compactRepositoryManifest, normalizeRepositoryManifest } from './schema.js'

import { discoverNodeExtensionRoots, extensionLockDocument, writeExtensionLock } from './node.js'
import type { NodeExtensionDiscoveryOptions } from './node-types.js'

const USAGE = `Usage: modkit-extensions [list|roots|lock|compact] [options]

Commands:
  list              Print discovered extensions (default)
  roots             Print host root descriptors
  lock              Write and print the configured extension lock
  compact           Deduplicate an embedded bundle, optionally selecting extension roots

Options:
  --config <path>   Use a specific modkit.workspace.json
  --profile <name>  Select a configured profile
  --cache <path>    Override the materialization cache
  --input <path>    Input bundle for compact (format 1 or 2)
  --out <path>      New output file for compact; existing files are refused
  --extension <id>  Root to keep; repeat for a complete runtime set (default: all)
  -h, --help        Show this help
`

interface CliOptions extends NodeExtensionDiscoveryOptions {
  readonly command: string
  readonly help?: boolean
}

function argumentsOf(argv: readonly string[]): CliOptions {
  const output: {
    command: CliOptions['command']
    help?: boolean
    configurationPath?: string
    profile?: string | undefined
    cacheRoot?: string
  } = { command: 'list' }
  const rest = [...argv]
  if (rest.includes('--help') || rest.includes('-h')) return { ...output, help: true }
  if (rest[0] !== undefined && !rest[0].startsWith('-')) output.command = rest.shift() as string
  if (output.command === 'compact') return output
  while (rest.length > 0) {
    const flag = rest.shift()
    if (flag === '--config') output.configurationPath = resolve(rest.shift() ?? '')
    else if (flag === '--profile') output.profile = rest.shift()
    else if (flag === '--cache') output.cacheRoot = resolve(rest.shift() ?? '')
    else throw new Error(`unknown argument: ${flag}`)
  }
  return output
}

/** Compact a built bundle; selection is explicit and must include the caller's runtime providers. */
async function compactCommand(argv: readonly string[]): Promise<void> {
  let input: string | undefined
  let output: string | undefined
  const selected = new Set<string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    if (flag === '--input' && input === undefined) input = value
    else if (flag === '--out' && output === undefined) output = value
    else if (flag === '--extension' && !selected.has(value)) selected.add(value)
    else throw new Error(`unknown or repeated argument: ${flag} ${value}`)
  }
  if (input === undefined || output === undefined)
    throw new Error('compact requires --input and --out')
  const original = await readFile(resolve(input), 'utf8')
  const manifest = normalizeRepositoryManifest(JSON.parse(original))
  for (const id of selected) {
    if (!manifest.extensions.some(entry => entry.id === id))
      throw new Error(`unknown extension: ${id}`)
  }
  const extensions = manifest.extensions.filter(
    entry => selected.size === 0 || (entry.id !== undefined && selected.has(entry.id)),
  )
  if (extensions.length === 0 || extensions.some(entry => entry.files === undefined)) {
    throw new Error('compact requires embedded files for every selected root')
  }
  const compact = compactRepositoryManifest({ ...manifest, extensions })
  const bytes = new TextEncoder().encode(`${JSON.stringify(compact)}\n`)
  await writeFile(resolve(output), bytes, { flag: 'wx' })
  process.stdout.write(
    `${JSON.stringify({ output: resolve(output), bytes: bytes.byteLength, roots: extensions.map(entry => entry.id), blobs: compact.blobs.length })}\n`,
  )
}

const options = argumentsOf(process.argv.slice(2))
if (options.help) {
  process.stdout.write(USAGE)
} else if (options.command === 'compact') {
  await compactCommand(process.argv.slice(3))
} else {
  const discovery = await discoverNodeExtensionRoots(options)
  if (options.command === 'roots') {
    process.stdout.write(`${JSON.stringify(discovery.hostRoots, null, 2)}\n`)
  } else if (options.command === 'lock') {
    const path = await writeExtensionLock(discovery)
    process.stdout.write(
      `${JSON.stringify({ path, lock: extensionLockDocument(discovery) }, null, 2)}\n`,
    )
  } else if (options.command === 'list') {
    process.stdout.write(`${JSON.stringify(discovery, null, 2)}\n`)
  } else throw new Error(`unknown command: ${options.command}`)
}
