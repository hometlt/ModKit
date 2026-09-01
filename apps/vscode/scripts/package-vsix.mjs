/**
 * Produce the official VSIX from a throwaway, release-shaped staging directory.
 *
 * The application checkout remains a pnpm workspace. The staged manifest deliberately is not:
 * VS Code receives one unscoped extension manifest, one already-built dist-app tree, localization,
 * and icons. In particular, this command never runs a workspace lifecycle hook in the staging
 * directory and never copies a source node_modules tree.
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

import { managedPackagesDirectory, verifyVirtualOfflineRelease } from './offline-release.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const rawArguments = process.argv.slice(2)
// pnpm 11 preserves the conventional `--` separator when forwarding script arguments. Accept the
// same public command with or without that separator, but keep every other argument strict.
const argumentsList = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments
const outIndex = argumentsList.indexOf('--out')
if (outIndex < 0 || argumentsList[outIndex + 1] === undefined || argumentsList.length !== 2) {
  throw new Error('usage: node scripts/package-vsix.mjs --out <absolute-or-relative-output.vsix>')
}
const artifactPath = resolve(process.cwd(), argumentsList[outIndex + 1])
if (!artifactPath.endsWith('.vsix')) throw new Error('official VSIX output must end in .vsix')
if (existsSync(artifactPath))
  throw new Error(`refusing to overwrite an existing VSIX: ${artifactPath}`)

const localVsce = join(appRoot, 'node_modules', '@vscode', 'vsce', 'vsce')
if (!existsSync(localVsce)) {
  throw new Error(
    `missing pinned local @vscode/vsce entry point: ${localVsce}; install the app dev dependency first`,
  )
}

function vsixEntries(bytes) {
  // A VSIX is a regular ZIP. Reading its central directory is enough to verify the candidate
  // before it becomes the requested artifact; no system archive utility leaks into this contract.
  let end = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) {
      end = index
      break
    }
  }
  if (end < 0) throw new Error('VSIX candidate has no ZIP end-of-central-directory record')
  const count = bytes.readUInt16LE(end + 10)
  const offset = bytes.readUInt32LE(end + 16)
  const entries = new Map()
  let cursor = offset
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('VSIX candidate has an invalid ZIP directory')
    const compression = bytes.readUInt16LE(cursor + 10)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const externalAttributes = bytes.readUInt32LE(cursor + 38)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    entries.set(name, { compression, compressedSize, externalAttributes, localOffset })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function zipEntryIsSymlink(entry) {
  return ((entry.externalAttributes >>> 16) & 0xf000) === 0xa000
}

function readVsixEntry(bytes, entries, name) {
  const entry = entries.get(name)
  if (entry === undefined) throw new Error(`VSIX candidate is missing ${name}`)
  if (bytes.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw new Error(`VSIX candidate has an invalid local record for ${name}`)
  }
  const nameLength = bytes.readUInt16LE(entry.localOffset + 26)
  const extraLength = bytes.readUInt16LE(entry.localOffset + 28)
  const compressed = bytes.subarray(
    entry.localOffset + 30 + nameLength + extraLength,
    entry.localOffset + 30 + nameLength + extraLength + entry.compressedSize,
  )
  if (entry.compression === 0) return compressed
  if (entry.compression === 8) return inflateRawSync(compressed)
  throw new Error(`VSIX candidate uses unsupported compression ${entry.compression} for ${name}`)
}

function verifyCandidate(candidate) {
  const bytes = readFileSync(candidate)
  const entries = vsixEntries(bytes)
  const manifest = JSON.parse(
    readVsixEntry(bytes, entries, 'extension/package.json').toString('utf8'),
  )
  if (manifest.name !== 'modkit-vscode' || manifest.publisher !== 'modkit') {
    throw new Error('VSIX candidate manifest is not the official modkit.modkit-vscode extension')
  }
  if (!entries.has('extension/dist-app/format-smoke.v1.json')) {
    throw new Error('VSIX candidate is missing the generated A8 format smoke inventory')
  }
  for (const root of [
    'archives',
    'audio',
    'data',
    'documents',
    'images',
    'models',
    'vector',
    'video',
  ]) {
    if (!entries.has(`extension/dist-app/extensions/${root}/package.json`)) {
      throw new Error(`VSIX candidate is missing bundled Common root ${root}`)
    }
  }
  for (const dependency of ['codec-kit', 'core', 'host', 'sdk', 'vfs']) {
    if (
      !entries.has(`extension/dist-app/extensions/node_modules/@modkit/${dependency}/package.json`)
    ) {
      throw new Error(`VSIX candidate is missing required bundled dependency @modkit/${dependency}`)
    }
  }
  const managedPrefix = `extension/dist-app/${managedPackagesDirectory}/`
  for (const [name, entry] of entries) {
    if (name.startsWith(managedPrefix) && zipEntryIsSymlink(entry)) {
      throw new Error(`VSIX candidate managed package entry must not be a link: ${name}`)
    }
  }
  const managedFiles = [...entries.keys()]
    .filter(name => name.startsWith(managedPrefix) && !name.endsWith('/'))
    .map(name => name.slice(managedPrefix.length))
    .sort()
  verifyVirtualOfflineRelease(managedFiles, name =>
    readVsixEntry(bytes, entries, `${managedPrefix}${name}`),
  )
}

mkdirSync(dirname(artifactPath), { recursive: true })
const stage = mkdtempSync(join(dirname(artifactPath), '.modkit-vsix-stage-'))
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`
  if ((result.status ?? 1) !== 0)
    throw new Error(`${command} failed (${result.status ?? 1})\n${output}`)
  return output
}

try {
  // Build from the real source tree, but into staging: the package command cannot accidentally
  // consume an old dist-app or gain a repository-relative path from its working directory.
  run(
    process.execPath,
    [join(here, 'build-extension.mjs'), '--out', join(stage, 'dist-app')],
    appRoot,
  )

  const sourceManifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  const manifest = {
    ...sourceManifest,
    name: 'modkit-vscode',
    publisher: 'modkit',
    // `vsce` executes prepublish hooks from the package it is handed. The build above is the only
    // allowed prepublish step; it has already populated the clean staging tree.
    scripts: {},
    files: ['dist-app', 'media', 'package.nls.json', 'package.nls.ru.json'],
  }
  delete manifest.private
  delete manifest.dependencies
  delete manifest.devDependencies
  delete manifest.exports
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  for (const name of ['package.nls.json', 'package.nls.ru.json', 'media']) {
    const source = join(appRoot, name)
    if (!existsSync(source)) throw new Error(`release input is missing: ${source}`)
    const destination = join(stage, name)
    mkdirSync(dirname(destination), { recursive: true })
    // The three inputs are files/directories without workspace links. cp is deliberately limited
    // to this fixed list; dependency material is exclusively owned by build-extension.mjs.
    cpSync(source, destination, { recursive: true, dereference: false })
  }

  const candidate = join(stage, 'candidate.vsix')
  run(process.execPath, [localVsce, 'package', '--out', candidate], stage)
  if (!existsSync(candidate)) throw new Error(`@vscode/vsce completed without ${candidate}`)
  verifyCandidate(candidate)
  // The staging folder is created beside the requested output, so this is an atomic same-volume
  // commit. A failed pack or inventory check never leaves a partial official artifact behind.
  renameSync(candidate, artifactPath)
  console.log(`official VSIX: ${artifactPath}`)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
