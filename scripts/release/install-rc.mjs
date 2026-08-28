import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { verifyRc } from './rc.mjs'

const STATE_NAME = 'installation-state.json'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeRelativePath(path, label = 'path') {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some(part => part === '' || part === '.' || part === '..')
  ) {
    throw new TypeError(`${label} must be a safe non-empty POSIX relative path: ${String(path)}`)
  }
  return path
}

function tarString(header, offset, length) {
  const field = header.subarray(offset, offset + length)
  const end = field.indexOf(0)
  return field.subarray(0, end < 0 ? field.length : end).toString('utf8')
}

function tarOctal(header, offset, length, label) {
  const value = tarString(header, offset, length).trim()
  if (!/^[0-7]+$/u.test(value)) throw new TypeError(`invalid ${label} in release tar`)
  return Number.parseInt(value, 8)
}

/** Read the regular-file-only ustar subset emitted by deterministicTar. */
export function readReleaseTar(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length % 512 !== 0) {
    throw new TypeError('release tar must be a block-aligned Buffer')
  }
  const files = new Map()
  let offset = 0
  let zeroBlocks = 0
  while (offset < bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    offset += 512
    if (header.every(byte => byte === 0)) {
      zeroBlocks += 1
      if (zeroBlocks === 2) {
        if (!bytes.subarray(offset).every(byte => byte === 0)) {
          throw new Error('release tar has non-zero bytes after its end marker')
        }
        return files
      }
      continue
    }
    if (zeroBlocks !== 0) throw new Error('release tar has an incomplete end marker')
    const storedChecksum = tarOctal(header, 148, 8, 'header checksum')
    const checksumHeader = Buffer.from(header)
    checksumHeader.fill(0x20, 148, 156)
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0)
    if (storedChecksum !== actualChecksum) throw new Error('release tar header checksum mismatch')
    if (tarString(header, 257, 6) !== 'ustar') throw new TypeError('release tar is not ustar')
    const type = header[156]
    if (type !== 0 && type !== '0'.charCodeAt(0)) {
      throw new TypeError('release tar may contain regular files only')
    }
    const name = tarString(header, 0, 100)
    const prefix = tarString(header, 345, 155)
    const path = safeRelativePath(prefix === '' ? name : `${prefix}/${name}`, 'tar entry')
    const size = tarOctal(header, 124, 12, 'entry size')
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > bytes.length) {
      throw new Error(`release tar entry has an invalid size: ${path}`)
    }
    if (files.has(path)) throw new Error(`release tar contains a duplicate path: ${path}`)
    files.set(path, Buffer.from(bytes.subarray(offset, offset + size)))
    offset += Math.ceil(size / 512) * 512
  }
  throw new Error('release tar has no complete end marker')
}

function readState(storeRoot) {
  const path = join(storeRoot, STATE_NAME)
  const backup = `${path}.bak`
  if (!existsSync(path) && existsSync(backup)) renameSync(backup, path)
  else if (existsSync(path) && existsSync(backup)) rmSync(backup)
  if (!existsSync(path)) return undefined
  const state = JSON.parse(readFileSync(path, 'utf8'))
  if (
    state.schemaVersion !== 'local-rc-installation-1' ||
    typeof state.activeManifestSha256 !== 'string' ||
    !Array.isArray(state.history) ||
    ![state.activeManifestSha256, ...state.history].every(digest =>
      /^sha256:[0-9a-f]{64}$/u.test(digest),
    )
  ) {
    throw new TypeError('unsupported local RC installation state')
  }
  return state
}

function writeState(storeRoot, state) {
  const target = join(storeRoot, STATE_NAME)
  const temporary = join(storeRoot, `.${STATE_NAME}.${process.pid}.tmp`)
  const backup = `${target}.bak`
  if (existsSync(temporary)) throw new Error(`installation state staging path exists: ${temporary}`)
  if (existsSync(backup)) throw new Error(`installation state backup path exists: ${backup}`)
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  const replacing = existsSync(target)
  if (replacing) renameSync(target, backup)
  try {
    renameSync(temporary, target)
    if (replacing) rmSync(backup)
  } catch (error) {
    if (!existsSync(target) && existsSync(backup)) renameSync(backup, target)
    rmSync(temporary, { force: true })
    throw error
  }
}

function mergeTarFiles(target, additions, artifactId) {
  for (const [path, bytes] of additions) {
    const previous = target.get(path)
    if (previous !== undefined && !previous.equals(bytes)) {
      throw new Error(`RC artifacts conflict at ${path} while installing ${artifactId}`)
    }
    target.set(path, bytes)
  }
}

function writeTree(root, files) {
  for (const [path, bytes] of [...files].sort(([left], [right]) =>
    left.localeCompare(right, 'en'),
  )) {
    const target = join(root, ...safeRelativePath(path).split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
}

function versionRoot(storeRoot, digest) {
  return join(storeRoot, 'versions', digest.replace(/^sha256:/u, ''), 'root')
}

/** Verify and install a signed RC into an immutable version, then atomically select it. */
export function installRc({ outDir, storeRoot, publicKeyPath }) {
  const source = resolve(outDir)
  const store = resolve(storeRoot)
  verifyRc({ outDir: source, publicKeyPath, requireSignature: true })
  if (existsSync(store) && lstatSync(store).isSymbolicLink()) {
    throw new Error('local RC installation store must not be a symbolic link')
  }
  const versions = join(store, 'versions')
  mkdirSync(versions, { recursive: true })
  if (lstatSync(versions).isSymbolicLink()) {
    throw new Error('local RC versions directory must not be a symbolic link')
  }
  const manifestBytes = readFileSync(join(source, 'release-manifest.json'))
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const manifestDigest = `sha256:${sha256(manifestBytes)}`
  const root = versionRoot(store, manifestDigest)
  if (!existsSync(root)) {
    const versionDirectory = dirname(root)
    const staging = join(
      versions,
      `.staging-${manifestDigest.slice('sha256:'.length)}-${process.pid}`,
    )
    if (existsSync(staging)) throw new Error(`installation staging path exists: ${staging}`)
    mkdirSync(staging, { recursive: true })
    try {
      const files = new Map()
      for (const artifact of manifest.artifacts) {
        const artifactPath = safeRelativePath(artifact.file, 'artifact file')
        mergeTarFiles(
          files,
          readReleaseTar(readFileSync(join(source, ...artifactPath.split('/')))),
          artifact.id,
        )
      }
      for (const name of [
        'INSTALL.md',
        'LICENSE-NOTICES.txt',
        'release-manifest.json',
        'release-signature.json',
        'sbom.cdx.json',
      ]) {
        const path = join(source, name)
        if (existsSync(path)) files.set(`release/${name}`, readFileSync(path))
      }
      writeTree(join(staging, 'root'), files)
      renameSync(staging, versionDirectory)
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      throw error
    }
  }
  const previous = readState(store)
  const history =
    previous?.activeManifestSha256 === manifestDigest
      ? previous.history
      : [
          ...(previous === undefined ? [] : [previous.activeManifestSha256]),
          ...(previous?.history ?? []),
        ].filter(
          (digest, index, values) => digest !== manifestDigest && values.indexOf(digest) === index,
        )
  const state = {
    schemaVersion: 'local-rc-installation-1',
    releaseId: manifest.release.id,
    activeManifestSha256: manifestDigest,
    history,
  }
  writeState(store, state)
  return {
    state: 'installed',
    manifestDigest,
    root,
    previousManifestDigest: previous?.activeManifestSha256,
  }
}

/** Reactivate the most recently replaced immutable RC without deleting either version. */
export function rollbackRc({ storeRoot }) {
  const store = resolve(storeRoot)
  const current = readState(store)
  if (current === undefined || current.history.length === 0) {
    throw new Error('local RC installation has no version to roll back to')
  }
  const [manifestDigest, ...history] = current.history
  const root = versionRoot(store, manifestDigest)
  if (!existsSync(root)) throw new Error(`rollback RC version is missing: ${manifestDigest}`)
  writeState(store, { ...current, activeManifestSha256: manifestDigest, history })
  return { state: 'rolled-back', manifestDigest, root }
}

export function activeRc({ storeRoot }) {
  const store = resolve(storeRoot)
  const state = readState(store)
  if (state === undefined) return undefined
  const root = versionRoot(store, state.activeManifestSha256)
  if (!existsSync(root))
    throw new Error(`active RC version is missing: ${state.activeManifestSha256}`)
  return { manifestDigest: state.activeManifestSha256, root }
}
