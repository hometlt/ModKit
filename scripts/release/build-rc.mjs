#!/usr/bin/env node

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildRc, checkRc, emitRcMetadata, verifyRc } from './rc.mjs'
import { installRc, rollbackRc } from './install-rc.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const defaultRoot = resolve(dirname(scriptPath), '..', '..')

function parseArguments(argv) {
  const options = { repoRoot: defaultRoot }
  let mode = 'build'
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') mode = 'check'
    else if (argument === '--emit') mode = 'emit'
    else if (argument === '--verify') mode = 'verify'
    else if (argument === '--install') mode = 'install'
    else if (argument === '--rollback') mode = 'rollback'
    else if (argument === '--root') {
      if (argv[index + 1] === undefined) throw new Error('--root requires a path')
      options.repoRoot = resolve(argv[++index])
    } else if (argument === '--out') {
      if (argv[index + 1] === undefined) throw new Error('--out requires a path')
      options.outDir = resolve(argv[++index])
    } else if (argument === '--signing-key') {
      if (argv[index + 1] === undefined) throw new Error('--signing-key requires a path')
      options.signingKeyPath = resolve(argv[++index])
    } else if (argument === '--public-key') {
      if (argv[index + 1] === undefined) throw new Error('--public-key requires a path')
      options.publicKeyPath = resolve(argv[++index])
    } else if (argument === '--target') {
      if (argv[index + 1] === undefined) throw new Error('--target requires a path')
      options.storeRoot = resolve(argv[++index])
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  if (
    (mode === 'build' || mode === 'verify' || mode === 'install') &&
    options.outDir === undefined
  ) {
    throw new Error(`${mode} requires --out <fresh RC directory>`)
  }
  if (mode === 'build' && options.signingKeyPath === undefined) {
    throw new Error('signed RC build requires --signing-key <Ed25519 private PEM outside the repo>')
  }
  if (mode === 'verify' && options.publicKeyPath === undefined) {
    throw new Error('signed RC verification requires --public-key <Ed25519 public PEM>')
  }
  if (mode === 'install' && options.publicKeyPath === undefined) {
    throw new Error('install requires --public-key <Ed25519 public PEM>')
  }
  if ((mode === 'install' || mode === 'rollback') && options.storeRoot === undefined) {
    throw new Error(`${mode} requires --target <local installation store>`)
  }
  return { mode, options }
}

export function run(argv = process.argv.slice(2)) {
  const { mode, options } = parseArguments(argv)
  if (mode === 'check') {
    const result = checkRc(options)
    process.stdout.write(
      `release RC ${result.state}: ${result.fileCount} unsigned files are reproducible\n`,
    )
  } else if (mode === 'emit') {
    const result = emitRcMetadata(options)
    process.stdout.write(`release RC metadata ${result.state}: ${result.count} files\n`)
  } else if (mode === 'install') {
    const result = installRc(options)
    process.stdout.write(`release RC installed: ${result.root}\n`)
  } else if (mode === 'rollback') {
    const result = rollbackRc(options)
    process.stdout.write(`release RC rolled back: ${result.root}\n`)
  } else if (mode === 'verify') {
    const result = verifyRc(options)
    process.stdout.write(`release RC ${result.state}: ${result.artifactCount} artifacts\n`)
  } else {
    const result = buildRc(options)
    process.stdout.write(
      `release RC built: ${result.manifest.artifacts.length} artifacts, detached Ed25519 signature written\n`,
    )
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  try {
    run()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
