#!/usr/bin/env node

import { resolve } from 'node:path'

import { discoverNodeExtensionRoots, extensionLockDocument, writeExtensionLock } from './node.js'

const USAGE = `Usage: modkit-extensions [list|roots|lock] [options]

Commands:
  list              Print discovered extensions (default)
  roots             Print host root descriptors
  lock              Write and print the configured extension lock

Options:
  --config <path>   Use a specific modkit.workspace.json
  --profile <name>  Select a configured profile
  --cache <path>    Override the materialization cache
  -h, --help        Show this help
`

function argumentsOf(argv) {
  const output = { command: 'list' }
  const rest = [...argv]
  if (rest.includes('--help') || rest.includes('-h')) return { ...output, help: true }
  if (rest[0] !== undefined && !rest[0].startsWith('-')) output.command = rest.shift()
  while (rest.length > 0) {
    const flag = rest.shift()
    if (flag === '--config') output.configurationPath = resolve(rest.shift() ?? '')
    else if (flag === '--profile') output.profile = rest.shift()
    else if (flag === '--cache') output.cacheRoot = resolve(rest.shift() ?? '')
    else throw new Error(`unknown argument: ${flag}`)
  }
  return output
}

const options = argumentsOf(process.argv.slice(2))
if (options.help) {
  process.stdout.write(USAGE)
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
