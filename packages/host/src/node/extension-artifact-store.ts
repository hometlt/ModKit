/**
 * Offline, filesystem-backed lifecycle for installed extension artifacts.
 *
 * Catalog entries point directly at local directories and pin the loader's tree digest. A
 * candidate is copied without following links, loaded from a staging directory, checked again
 * after any asynchronous verifier, and only then admitted under an immutable digest path. The
 * active version is a small atomically-replaced state file, so a failed install/update never
 * replaces the last working version.
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ModkitError, OperationCancelledError, throwIfAborted } from '@modkitx-x3/core'
import { normalizeExtensionManifest } from '@modkitx-x3/sdk'
import type { ExtensionInput } from '../inventory.js'
import { loadExtensionDirectory } from './loader.js'

const COORDINATE =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
const SHA256 = /^sha256:[0-9a-f]{64}$/

export interface LocalExtensionCatalogEntry {
  /** Exact normalized `publisher/id` expected from the artifact manifest. */
  readonly extensionId: string
  /** Exact manifest version; lifecycle operations never guess a newest version. */
  readonly version: string
  /** Absolute path to an unpacked local artifact. Network URLs are deliberately not accepted. */
  readonly artifactRoot: string
  /** Digest produced by `loadExtensionDirectory` for the complete artifact tree. */
  readonly artifactDigest: string
}

export interface InstalledExtensionArtifact {
  readonly extensionId: string
  readonly version: string
  readonly artifactDigest: string
  readonly artifactRoot: string
}

export type ExtensionQuarantineReason =
  | 'digest-mismatch'
  | 'load-verification-failed'
  | 'interrupted-install'
  | 'installed-artifact-corrupt'

export interface QuarantinedExtensionArtifact {
  readonly extensionId?: string
  readonly version?: string
  readonly expectedDigest?: string
  readonly actualDigest?: string
  readonly reason: ExtensionQuarantineReason
  readonly message: string
  readonly artifactRoot: string
}

export interface ExtensionArtifactRecovery {
  readonly quarantinedStaging: number
  readonly quarantinedInstalled: number
  readonly removedStateTemps: number
  readonly removedStaleLocks: number
  readonly restoredActive: number
  readonly deactivatedActive: number
  readonly heldLocks: readonly string[]
}

export interface LocalExtensionArtifactStoreOptions {
  /** Private product data directory used only for installed extension artifacts and state. */
  readonly root: string
  /** Direct local catalog. Entries are snapshotted and require exact id + version selection. */
  readonly catalog: readonly LocalExtensionCatalogEntry[]
  /**
   * Optional product load gate (for example, inventory/composition validation). Throwing rejects
   * and quarantines the staged artifact before it can become active.
   */
  readonly verifyLoaded?: (
    input: ExtensionInput,
    entry: LocalExtensionCatalogEntry,
  ) => void | Promise<void>
}

export interface LocalExtensionArtifactStore {
  readonly root: string
  listCatalog(): readonly LocalExtensionCatalogEntry[]
  /** Validates and repairs/quarantines corrupt active bytes before returning. */
  listInstalled(): Promise<readonly InstalledExtensionArtifact[]>
  listQuarantine(): readonly QuarantinedExtensionArtifact[]
  install(
    extensionId: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<InstalledExtensionArtifact>
  update(
    extensionId: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<InstalledExtensionArtifact>
  uninstall(extensionId: string): Promise<InstalledExtensionArtifact>
  rollback(extensionId: string): Promise<InstalledExtensionArtifact>
  recover(): Promise<ExtensionArtifactRecovery>
}

interface ArtifactReference {
  readonly version: string
  readonly artifactDigest: string
}

interface ExtensionState {
  readonly schemaVersion: 1
  readonly extensionId: string
  readonly active: ArtifactReference | null
  readonly history: readonly ArtifactReference[]
}

interface LockRecord {
  readonly pid: number
  readonly nonce: string
}

interface StoredArtifactValidation {
  readonly valid: boolean
  readonly message: string
  readonly actualDigest?: string
}

interface StorePaths {
  readonly root: string
  readonly artifacts: string
  readonly states: string
  readonly staging: string
  readonly quarantineArtifacts: string
  readonly quarantineRecords: string
  readonly locks: string
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>> = {},
): never {
  throw new ModkitError({ code, message, context })
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function confine(root: string, ...segments: readonly string[]): string {
  const candidate = resolve(root, ...segments)
  if (!isInside(root, candidate)) {
    fail('x3.host/extension-store-path-escape', 'extension store path escaped its private root', {
      root,
      candidate,
    })
  }
  return candidate
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function extensionKey(extensionId: string): string {
  return sha256(extensionId)
}

function validateIdentity(extensionId: string, version?: string): void {
  if (!COORDINATE.test(extensionId)) {
    fail(
      'x3.host/invalid-local-extension-catalog',
      `invalid extension coordinate in local catalog: «${extensionId}»`,
      { extensionId },
    )
  }
  if (version !== undefined && !SEMVER.test(version)) {
    fail(
      'x3.host/invalid-local-extension-catalog',
      `invalid extension version in local catalog: «${version}»`,
      { extensionId, version },
    )
  }
}

function validateReference(value: unknown): value is ArtifactReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const ref = value as Partial<ArtifactReference>
  return (
    typeof ref.version === 'string' &&
    SEMVER.test(ref.version) &&
    SHA256.test(ref.artifactDigest ?? '')
  )
}

function snapshotCatalog(
  entries: readonly LocalExtensionCatalogEntry[],
): readonly LocalExtensionCatalogEntry[] {
  const seen = new Set<string>()
  return Object.freeze(
    entries.map(entry => {
      validateIdentity(entry.extensionId, entry.version)
      if (!isAbsolute(entry.artifactRoot)) {
        fail(
          'x3.host/invalid-local-extension-catalog',
          'local extension catalog artifact roots must be absolute filesystem paths',
          { extensionId: entry.extensionId, artifactRoot: entry.artifactRoot },
        )
      }
      if (!SHA256.test(entry.artifactDigest)) {
        fail(
          'x3.host/invalid-local-extension-catalog',
          'local extension catalog artifact digest must be lowercase sha256',
          { extensionId: entry.extensionId, artifactDigest: entry.artifactDigest },
        )
      }
      const key = `${entry.extensionId}\u0000${entry.version}`
      if (seen.has(key)) {
        fail(
          'x3.host/invalid-local-extension-catalog',
          `duplicate local catalog entry for «${entry.extensionId}» ${entry.version}`,
          { extensionId: entry.extensionId, version: entry.version },
        )
      }
      seen.add(key)
      return Object.freeze({
        extensionId: entry.extensionId,
        version: entry.version,
        artifactRoot: resolve(entry.artifactRoot),
        artifactDigest: entry.artifactDigest,
      })
    }),
  )
}

function initializePaths(root: string): StorePaths {
  if (!isAbsolute(root)) {
    fail(
      'x3.host/invalid-extension-store-root',
      'extension store root must be an absolute filesystem path',
      { root },
    )
  }
  mkdirSync(root, { recursive: true })
  const resolvedRoot = realpathSync(root)
  const paths: StorePaths = {
    root: resolvedRoot,
    artifacts: confine(resolvedRoot, 'artifacts'),
    states: confine(resolvedRoot, 'states'),
    staging: confine(resolvedRoot, 'staging'),
    quarantineArtifacts: confine(resolvedRoot, 'quarantine', 'artifacts'),
    quarantineRecords: confine(resolvedRoot, 'quarantine', 'records'),
    locks: confine(resolvedRoot, 'locks'),
  }
  for (const path of Object.values(paths)) mkdirSync(path, { recursive: true })
  return paths
}

function statePath(paths: StorePaths, extensionId: string): string {
  return confine(paths.states, `${extensionKey(extensionId)}.json`)
}

function artifactPath(paths: StorePaths, extensionId: string, artifactDigest: string): string {
  return confine(paths.artifacts, extensionKey(extensionId), artifactDigest.slice('sha256:'.length))
}

function readState(paths: StorePaths, extensionId: string): ExtensionState {
  const path = statePath(paths, extensionId)
  if (!existsSync(path)) {
    return Object.freeze({
      schemaVersion: 1,
      extensionId,
      active: null,
      history: Object.freeze([]),
    })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    fail('x3.host/extension-store-state-corrupt', 'installed extension state is unreadable', {
      extensionId,
      error: messageOf(error),
    })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('x3.host/extension-store-state-corrupt', 'installed extension state is not an object', {
      extensionId,
    })
  }
  const state = parsed as Partial<ExtensionState>
  if (
    state.schemaVersion !== 1 ||
    state.extensionId !== extensionId ||
    (state.active !== null && !validateReference(state.active)) ||
    !Array.isArray(state.history) ||
    !state.history.every(validateReference)
  ) {
    fail('x3.host/extension-store-state-corrupt', 'installed extension state is malformed', {
      extensionId,
    })
  }
  return Object.freeze({
    schemaVersion: 1,
    extensionId,
    active: state.active === null ? null : Object.freeze({ ...state.active }),
    history: Object.freeze(state.history.map(item => Object.freeze({ ...item }))),
  })
}

function writeAtomicJson(path: string, value: unknown, tempTag = sha256(path)): void {
  const temp = confine(resolve(path, '..'), `.${tempTag}.${randomUUID()}.tmp`)
  const descriptor = openSync(temp, 'wx')
  try {
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  try {
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

function writeState(paths: StorePaths, state: ExtensionState): void {
  writeAtomicJson(statePath(paths, state.extensionId), state, extensionKey(state.extensionId))
}

function copyTreeConfined(source: string, target: string, signal?: AbortSignal): void {
  throwIfAborted(signal)
  const sourceStat = lstatSync(source)
  if (sourceStat.isSymbolicLink()) {
    fail(
      'x3.host/extension-artifact-link-refused',
      'local extension artifacts may not contain symbolic links',
      { source },
    )
  }
  if (sourceStat.isDirectory()) {
    mkdirSync(target, { recursive: false })
    for (const name of readdirSync(source).sort()) {
      copyTreeConfined(join(source, name), join(target, name), signal)
    }
    return
  }
  if (!sourceStat.isFile()) {
    fail(
      'x3.host/extension-artifact-file-type-refused',
      'local extension artifacts may contain only directories and regular files',
      { source },
    )
  }
  copyFileSync(source, target)
}

function assertRegularArtifactTree(root: string): void {
  const current = lstatSync(root)
  if (current.isSymbolicLink()) {
    fail(
      'x3.host/extension-artifact-link-refused',
      'installed extension artifacts may not contain symbolic links',
      { root },
    )
  }
  if (current.isDirectory()) {
    for (const name of readdirSync(root).sort()) assertRegularArtifactTree(join(root, name))
    return
  }
  if (!current.isFile()) {
    fail(
      'x3.host/extension-artifact-file-type-refused',
      'installed extension artifacts may contain only directories and regular files',
      { root },
    )
  }
}

function lockIsHeld(path: string): boolean {
  let parsed: Partial<LockRecord>
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockRecord>
  } catch {
    return false
  }
  if (
    !Number.isSafeInteger(parsed.pid) ||
    (parsed.pid ?? 0) <= 0 ||
    typeof parsed.nonce !== 'string'
  ) {
    return false
  }
  try {
    process.kill(parsed.pid as number, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function acquireLock(paths: StorePaths, extensionId: string): { path: string; nonce: string } {
  const path = confine(paths.locks, `${extensionKey(extensionId)}.lock`)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const nonce = randomUUID()
    try {
      const descriptor = openSync(path, 'wx')
      try {
        writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, nonce })}\n`, 'utf8')
        fsyncSync(descriptor)
      } finally {
        closeSync(descriptor)
      }
      return { path, nonce }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (attempt === 0 && !lockIsHeld(path)) {
        rmSync(path, { force: true })
        continue
      }
      fail(
        'x3.host/extension-install-locked',
        `another lifecycle operation is already running for «${extensionId}»`,
        { extensionId },
      )
    }
  }
  throw new Error('unreachable')
}

function releaseLock(lock: { path: string; nonce: string }): void {
  try {
    const record = JSON.parse(readFileSync(lock.path, 'utf8')) as Partial<LockRecord>
    if (record.nonce === lock.nonce) rmSync(lock.path, { force: true })
  } catch {
    // A missing/replaced lock is not ours to remove. The next recovery reports or cleans it.
  }
}

async function withLock<T>(
  paths: StorePaths,
  extensionId: string,
  run: () => Promise<T>,
): Promise<T> {
  validateIdentity(extensionId)
  const lock = acquireLock(paths, extensionId)
  try {
    return await run()
  } finally {
    releaseLock(lock)
  }
}

function referenceOf(entry: LocalExtensionCatalogEntry): ArtifactReference {
  return Object.freeze({ version: entry.version, artifactDigest: entry.artifactDigest })
}

function installedRecord(
  paths: StorePaths,
  extensionId: string,
  reference: ArtifactReference,
): InstalledExtensionArtifact {
  return Object.freeze({
    extensionId,
    version: reference.version,
    artifactDigest: reference.artifactDigest,
    artifactRoot: artifactPath(paths, extensionId, reference.artifactDigest),
  })
}

function quarantineStage(
  paths: StorePaths,
  stage: string,
  detail: Omit<QuarantinedExtensionArtifact, 'artifactRoot'>,
): QuarantinedExtensionArtifact {
  const quarantineId = `${Date.now()}-${randomUUID()}`
  const artifactRoot = confine(paths.quarantineArtifacts, quarantineId)
  if (existsSync(stage)) renameSync(stage, artifactRoot)
  else mkdirSync(artifactRoot)
  const record = Object.freeze({ ...detail, artifactRoot })
  writeAtomicJson(confine(paths.quarantineRecords, `${quarantineId}.json`), record)
  return record
}

function readQuarantine(paths: StorePaths): readonly QuarantinedExtensionArtifact[] {
  const records: QuarantinedExtensionArtifact[] = []
  for (const name of readdirSync(paths.quarantineRecords).sort()) {
    if (!name.endsWith('.json')) continue
    try {
      const value = JSON.parse(
        readFileSync(confine(paths.quarantineRecords, name), 'utf8'),
      ) as QuarantinedExtensionArtifact
      if (
        typeof value.reason === 'string' &&
        typeof value.message === 'string' &&
        typeof value.artifactRoot === 'string' &&
        isInside(paths.quarantineArtifacts, resolve(value.artifactRoot))
      ) {
        records.push(Object.freeze({ ...value }))
      }
    } catch {
      // A damaged diagnostic record is not executable state and must not hide healthy records.
    }
  }
  return Object.freeze(records)
}

/** Creates one local/offline extension lifecycle store. No catalog entry is fetched or executed. */
export function createLocalExtensionArtifactStore(
  options: LocalExtensionArtifactStoreOptions,
): LocalExtensionArtifactStore {
  const paths = initializePaths(options.root)
  const catalog = snapshotCatalog(options.catalog)
  const catalogByCoordinate = new Map(
    catalog.map(entry => [`${entry.extensionId}\u0000${entry.version}`, entry]),
  )

  const select = (extensionId: string, version: string): LocalExtensionCatalogEntry => {
    validateIdentity(extensionId, version)
    const entry = catalogByCoordinate.get(`${extensionId}\u0000${version}`)
    if (entry === undefined) {
      fail(
        'x3.host/extension-catalog-entry-missing',
        `local catalog has no exact entry for «${extensionId}» ${version}`,
        { extensionId, version },
      )
    }
    return entry
  }

  const validateStoredArtifact = async (
    extensionId: string,
    reference: ArtifactReference,
  ): Promise<StoredArtifactValidation> => {
    const root = artifactPath(paths, extensionId, reference.artifactDigest)
    if (!existsSync(root))
      return { valid: false, message: 'installed artifact directory is missing' }
    let actualDigest: string | undefined
    try {
      assertRegularArtifactTree(root)
      const loaded = await loadExtensionDirectory(root)
      actualDigest = loaded.artifact.artifactDigest
      if (actualDigest !== reference.artifactDigest) {
        return { valid: false, actualDigest, message: 'installed artifact digest changed' }
      }
      const normalized = await normalizeExtensionManifest(loaded.containers)
      const manifest = normalized.manifest
      const coordinate = manifest === undefined ? undefined : `${manifest.publisher}/${manifest.id}`
      if (
        manifest === undefined ||
        coordinate !== extensionId ||
        manifest.version !== reference.version
      ) {
        return {
          valid: false,
          actualDigest,
          message: 'installed artifact manifest identity/version changed or became invalid',
        }
      }
      if (options.verifyLoaded !== undefined) {
        await options.verifyLoaded(
          loaded,
          Object.freeze({
            extensionId,
            version: reference.version,
            artifactRoot: root,
            artifactDigest: reference.artifactDigest,
          }),
        )
      }
      assertRegularArtifactTree(root)
      if (!(await loaded.artifact.verifyArtifactDigest(reference.artifactDigest))) {
        return {
          valid: false,
          message: 'installed artifact changed while its load gate was running',
        }
      }
      return { valid: true, actualDigest, message: 'installed artifact is valid' }
    } catch (error) {
      return {
        valid: false,
        ...(actualDigest === undefined ? {} : { actualDigest }),
        message: messageOf(error),
      }
    }
  }

  const quarantineStoredArtifact = (
    extensionId: string,
    reference: ArtifactReference,
    validation: StoredArtifactValidation,
  ): void => {
    quarantineStage(paths, artifactPath(paths, extensionId, reference.artifactDigest), {
      extensionId,
      version: reference.version,
      expectedDigest: reference.artifactDigest,
      ...(validation.actualDigest === undefined ? {} : { actualDigest: validation.actualDigest }),
      reason: 'installed-artifact-corrupt',
      message: validation.message,
    })
  }

  const stageAndVerify = async (
    entry: LocalExtensionCatalogEntry,
    signal?: AbortSignal,
  ): Promise<string> => {
    throwIfAborted(signal)
    let sourceRoot: string
    try {
      sourceRoot = realpathSync(entry.artifactRoot)
    } catch (error) {
      fail(
        'x3.host/extension-artifact-unreadable',
        `local extension artifact is unreadable: ${messageOf(error)}`,
        { extensionId: entry.extensionId, artifactRoot: entry.artifactRoot },
      )
    }
    if (!statSync(sourceRoot).isDirectory()) {
      fail('x3.host/extension-artifact-unreadable', 'local extension artifact is not a directory', {
        extensionId: entry.extensionId,
        artifactRoot: sourceRoot,
      })
    }
    if (isInside(paths.root, sourceRoot) || isInside(sourceRoot, paths.root)) {
      fail(
        'x3.host/extension-artifact-store-overlap',
        'catalog artifact roots may not overlap the private extension store',
        { extensionId: entry.extensionId, artifactRoot: sourceRoot, storeRoot: paths.root },
      )
    }

    const stage = confine(paths.staging, `${extensionKey(entry.extensionId)}-${randomUUID()}`)
    try {
      copyTreeConfined(sourceRoot, stage, signal)
      const loaded = await loadExtensionDirectory(stage, signal)
      const actualDigest = loaded.artifact.artifactDigest
      if (actualDigest !== entry.artifactDigest) {
        const quarantined = quarantineStage(paths, stage, {
          extensionId: entry.extensionId,
          version: entry.version,
          expectedDigest: entry.artifactDigest,
          actualDigest,
          reason: 'digest-mismatch',
          message: 'copied artifact does not match the catalog digest',
        })
        fail(
          'x3.host/extension-artifact-digest-mismatch',
          'extension artifact digest does not match the offline catalog; candidate was quarantined',
          { extensionId: entry.extensionId, quarantineRoot: quarantined.artifactRoot },
        )
      }

      const normalized = await normalizeExtensionManifest(loaded.containers)
      const manifest = normalized.manifest
      const coordinate = manifest === undefined ? undefined : `${manifest.publisher}/${manifest.id}`
      if (
        manifest === undefined ||
        coordinate !== entry.extensionId ||
        manifest.version !== entry.version
      ) {
        const diagnosticCodes = normalized.diagnostics.map(item => item.code)
        const quarantined = quarantineStage(paths, stage, {
          extensionId: entry.extensionId,
          version: entry.version,
          expectedDigest: entry.artifactDigest,
          actualDigest,
          reason: 'load-verification-failed',
          message: `loaded manifest identity/version mismatch (${diagnosticCodes.join(', ') || 'no diagnostic'})`,
        })
        fail(
          'x3.host/extension-artifact-load-verification-failed',
          'extension artifact failed manifest loading; candidate was quarantined',
          { extensionId: entry.extensionId, quarantineRoot: quarantined.artifactRoot },
        )
      }

      try {
        await options.verifyLoaded?.(loaded, entry)
      } catch (error) {
        const quarantined = quarantineStage(paths, stage, {
          extensionId: entry.extensionId,
          version: entry.version,
          expectedDigest: entry.artifactDigest,
          actualDigest,
          reason: 'load-verification-failed',
          message: messageOf(error),
        })
        fail(
          'x3.host/extension-artifact-load-verification-failed',
          'extension artifact failed the product load gate; candidate was quarantined',
          {
            extensionId: entry.extensionId,
            quarantineRoot: quarantined.artifactRoot,
            error: messageOf(error),
          },
        )
      }

      throwIfAborted(signal)
      assertRegularArtifactTree(stage)
      if (!(await loaded.artifact.verifyArtifactDigest(entry.artifactDigest))) {
        const quarantined = quarantineStage(paths, stage, {
          extensionId: entry.extensionId,
          version: entry.version,
          expectedDigest: entry.artifactDigest,
          reason: 'digest-mismatch',
          message: 'artifact changed while its load gate was running',
        })
        fail(
          'x3.host/extension-artifact-digest-mismatch',
          'extension artifact changed during verification; candidate was quarantined',
          { extensionId: entry.extensionId, quarantineRoot: quarantined.artifactRoot },
        )
      }

      const destination = artifactPath(paths, entry.extensionId, entry.artifactDigest)
      mkdirSync(resolve(destination, '..'), { recursive: true })
      if (existsSync(destination)) {
        assertRegularArtifactTree(destination)
        const admitted = await loadExtensionDirectory(destination, signal)
        if (admitted.artifact.artifactDigest !== entry.artifactDigest) {
          const quarantined = quarantineStage(paths, stage, {
            extensionId: entry.extensionId,
            version: entry.version,
            expectedDigest: entry.artifactDigest,
            actualDigest: admitted.artifact.artifactDigest,
            reason: 'digest-mismatch',
            message: 'the immutable destination exists with different contents',
          })
          fail(
            'x3.host/extension-artifact-destination-conflict',
            'immutable artifact destination contains different bytes; candidate was quarantined',
            { extensionId: entry.extensionId, quarantineRoot: quarantined.artifactRoot },
          )
        }
        rmSync(stage, { recursive: true, force: true })
      } else {
        renameSync(stage, destination)
      }
      return destination
    } catch (error) {
      if (existsSync(stage)) {
        if (error instanceof OperationCancelledError) {
          rmSync(stage, { recursive: true, force: true })
        } else {
          const quarantined = quarantineStage(paths, stage, {
            extensionId: entry.extensionId,
            version: entry.version,
            expectedDigest: entry.artifactDigest,
            reason: 'load-verification-failed',
            message: messageOf(error),
          })
          fail(
            'x3.host/extension-artifact-load-verification-failed',
            'extension artifact could not be loaded; candidate was quarantined',
            { extensionId: entry.extensionId, quarantineRoot: quarantined.artifactRoot },
          )
        }
      }
      throw error
    }
  }

  const activate = async (
    mode: 'install' | 'update',
    extensionId: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<InstalledExtensionArtifact> =>
    withLock(paths, extensionId, async () => {
      const entry = select(extensionId, version)
      const before = readState(paths, extensionId)
      if (mode === 'install' && before.active !== null) {
        fail(
          'x3.host/extension-already-installed',
          `«${extensionId}» is already installed; use update with an exact catalog version`,
          { extensionId, version: before.active.version },
        )
      }
      if (mode === 'update' && before.active === null) {
        fail(
          'x3.host/extension-not-installed',
          `«${extensionId}» is not installed; use install first`,
          { extensionId },
        )
      }
      const next = referenceOf(entry)
      if (
        before.active?.version === next.version &&
        before.active.artifactDigest === next.artifactDigest
      ) {
        return installedRecord(paths, extensionId, next)
      }
      await stageAndVerify(entry, signal)
      const history = before.active === null ? before.history : [before.active, ...before.history]
      writeState(paths, {
        schemaVersion: 1,
        extensionId,
        active: next,
        history: Object.freeze(history),
      })
      return installedRecord(paths, extensionId, next)
    })

  const stateExtensionIds = (): readonly string[] => {
    const extensionIds: string[] = []
    for (const name of readdirSync(paths.states).sort()) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue
      const path = confine(paths.states, name)
      let parsed: { extensionId?: unknown }
      try {
        parsed = JSON.parse(readFileSync(path, 'utf8')) as { extensionId?: unknown }
      } catch (error) {
        fail('x3.host/extension-store-state-corrupt', 'installed extension state is unreadable', {
          path,
          error: messageOf(error),
        })
      }
      if (typeof parsed.extensionId !== 'string') {
        fail('x3.host/extension-store-state-corrupt', 'installed extension state has no identity', {
          path,
        })
      }
      validateIdentity(parsed.extensionId)
      if (name !== `${extensionKey(parsed.extensionId)}.json`) {
        fail(
          'x3.host/extension-store-state-corrupt',
          'installed extension state filename does not match its identity',
          { path, extensionId: parsed.extensionId },
        )
      }
      extensionIds.push(parsed.extensionId)
    }
    return Object.freeze(extensionIds)
  }

  const listInstalledState = (): readonly InstalledExtensionArtifact[] => {
    const installed: InstalledExtensionArtifact[] = []
    for (const extensionId of stateExtensionIds()) {
      const state = readState(paths, extensionId)
      if (state.active !== null) installed.push(installedRecord(paths, extensionId, state.active))
    }
    return Object.freeze(installed)
  }

  const recoverStore = async (): Promise<ExtensionArtifactRecovery> => {
    let quarantinedStaging = 0
    let quarantinedInstalled = 0
    let removedStateTemps = 0
    let removedStaleLocks = 0
    let restoredActive = 0
    let deactivatedActive = 0
    const heldLocks = new Set<string>()

    const lockHeldForKey = (key: string): boolean => {
      const name = `${key}.lock`
      const path = confine(paths.locks, name)
      if (!existsSync(path) || !lockIsHeld(path)) return false
      heldLocks.add(name)
      return true
    }

    for (const name of readdirSync(paths.staging).sort()) {
      const stage = confine(paths.staging, name)
      const key = /^([0-9a-f]{64})-/.exec(name)?.[1]
      // A stage is created only after this exact extension lock is acquired. Re-check the lock
      // immediately before mutation so recovery cannot steal a live candidate from another host.
      if (key !== undefined && lockHeldForKey(key)) continue
      if (!lstatSync(stage).isDirectory()) {
        rmSync(stage, { recursive: true, force: true })
        continue
      }
      quarantineStage(paths, stage, {
        reason: 'interrupted-install',
        message: 'staging artifact was left by an interrupted lifecycle operation',
      })
      quarantinedStaging += 1
    }

    for (const name of readdirSync(paths.states).sort()) {
      if (!name.endsWith('.tmp')) continue
      const key = /^\.([0-9a-f]{64})\./.exec(name)?.[1]
      // State temp files use the same extension key as the install lock. A live atomic replace
      // owns both until rename has completed and the lock is released.
      if (key !== undefined && lockHeldForKey(key)) continue
      rmSync(confine(paths.states, name), { force: true })
      removedStateTemps += 1
    }

    for (const extensionId of stateExtensionIds()) {
      let lock: { path: string; nonce: string }
      try {
        lock = acquireLock(paths, extensionId)
      } catch (error) {
        if (error instanceof ModkitError && error.code === 'x3.host/extension-install-locked') {
          heldLocks.add(`${extensionKey(extensionId)}.lock`)
          continue
        }
        throw error
      }
      try {
        const before = readState(paths, extensionId)
        if (before.active === null) continue
        const activeValidation = await validateStoredArtifact(extensionId, before.active)
        if (activeValidation.valid) continue

        quarantineStoredArtifact(extensionId, before.active, activeValidation)
        quarantinedInstalled += 1

        const validHistory: ArtifactReference[] = []
        const checkedDigests = new Set([before.active.artifactDigest])
        for (const reference of before.history) {
          if (checkedDigests.has(reference.artifactDigest)) continue
          checkedDigests.add(reference.artifactDigest)
          const validation = await validateStoredArtifact(extensionId, reference)
          if (validation.valid) {
            validHistory.push(reference)
            continue
          }
          quarantineStoredArtifact(extensionId, reference, validation)
          quarantinedInstalled += 1
        }

        const restored = validHistory.shift() ?? null
        writeState(paths, {
          schemaVersion: 1,
          extensionId,
          active: restored,
          history: Object.freeze(validHistory),
        })
        if (restored === null) deactivatedActive += 1
        else restoredActive += 1
      } finally {
        releaseLock(lock)
      }
    }

    for (const name of readdirSync(paths.locks).sort()) {
      const path = confine(paths.locks, name)
      if (lockIsHeld(path)) heldLocks.add(name)
      else {
        rmSync(path, { force: true })
        removedStaleLocks += 1
      }
    }
    return Object.freeze({
      quarantinedStaging,
      quarantinedInstalled,
      removedStateTemps,
      removedStaleLocks,
      restoredActive,
      deactivatedActive,
      heldLocks: Object.freeze([...heldLocks].sort()),
    })
  }

  const store: LocalExtensionArtifactStore = {
    root: paths.root,
    listCatalog: () => catalog,
    listInstalled: async () => {
      await recoverStore()
      return listInstalledState()
    },
    listQuarantine: () => readQuarantine(paths),
    install: (extensionId, version, signal) => activate('install', extensionId, version, signal),
    update: (extensionId, version, signal) => activate('update', extensionId, version, signal),
    uninstall: extensionId =>
      withLock(paths, extensionId, async () => {
        const before = readState(paths, extensionId)
        if (before.active === null) {
          fail('x3.host/extension-not-installed', `«${extensionId}» is not installed`, {
            extensionId,
          })
        }
        const removed = before.active
        writeState(paths, {
          schemaVersion: 1,
          extensionId,
          active: null,
          history: Object.freeze([removed, ...before.history]),
        })
        return installedRecord(paths, extensionId, removed)
      }),
    rollback: extensionId =>
      withLock(paths, extensionId, async () => {
        const before = readState(paths, extensionId)
        let current = before.active
        if (current !== null) {
          const validation = await validateStoredArtifact(extensionId, current)
          if (!validation.valid) {
            quarantineStoredArtifact(extensionId, current, validation)
            current = null
          }
        }
        const validHistory: ArtifactReference[] = []
        const checkedDigests = new Set(before.active === null ? [] : [before.active.artifactDigest])
        for (const reference of before.history) {
          if (checkedDigests.has(reference.artifactDigest)) continue
          checkedDigests.add(reference.artifactDigest)
          const validation = await validateStoredArtifact(extensionId, reference)
          if (validation.valid) validHistory.push(reference)
          else quarantineStoredArtifact(extensionId, reference, validation)
        }
        const restored = validHistory.shift()
        if (restored === undefined) {
          writeState(paths, {
            schemaVersion: 1,
            extensionId,
            active: current,
            history: Object.freeze([]),
          })
          fail(
            'x3.host/extension-rollback-unavailable',
            `«${extensionId}» has no valid previous installed version`,
            { extensionId },
          )
        }
        const history = [...(current === null ? [] : [current]), ...validHistory]
        writeState(paths, {
          schemaVersion: 1,
          extensionId,
          active: restored,
          history: Object.freeze(history),
        })
        return installedRecord(paths, extensionId, restored)
      }),
    recover: recoverStore,
  }
  return Object.freeze(store)
}
