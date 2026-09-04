import { VirtualFileSystem, collectStream, normalizeVfsPath } from '@modkit/vfs'
import type { VfsMount, VfsProvider } from '@modkit/vfs'

import { ExtensionManagerError, normalizeRepositoryManifest } from './schema.js'
import { normalizeGameSubjectProfile, normalizeVendorSubjectProfile } from './subject-profiles.js'
import type {
  ExtensionSourceDescriptor,
  GameSubjectProfile,
  VendorSubjectProfile,
} from './public-types.js'

const decoder = new TextDecoder('utf-8', { fatal: true })
const MAXIMUM_SUBJECT_PROFILE_BYTES = 256 * 1024
const MAXIMUM_SUBJECT_PROFILES_BYTES = 4 * 1024 * 1024

export function createExtensionVfs(providers: readonly VfsProvider[]) {
  const vfs = new VirtualFileSystem()
  const protocols: string[] = []
  for (const provider of providers) {
    vfs.registerProvider(provider)
    protocols.push(provider.scheme)
  }
  return Object.freeze({ vfs, protocols: Object.freeze(protocols.sort()) })
}

export async function readMountBytes(
  mount: VfsMount,
  path = '',
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const source = await mount.open(normalizeVfsPath(path), signal)
  try {
    return await collectStream(source.stream(0, undefined, signal), signal)
  } finally {
    await source.dispose()
  }
}

export async function readMountJson(
  mount: VfsMount,
  path = '',
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; value: unknown }> {
  const bytes = await readMountBytes(mount, path, signal)
  try {
    return { bytes, value: JSON.parse(decoder.decode(bytes)) }
  } catch (cause) {
    throw new ExtensionManagerError(
      'extension-manager/json-invalid',
      `extension source document «${path}» is not valid UTF-8 JSON`,
      { path },
      cause,
    )
  }
}

export async function openRepositorySource(
  vfs: VirtualFileSystem,
  source: ExtensionSourceDescriptor,
  signal?: AbortSignal,
) {
  const mount = await vfs.openMount(source.uri, { signal } as Parameters<
    VirtualFileSystem['openMount']
  >[1])
  try {
    const protocol = new URL(source.uri).protocol.slice(0, -1)
    const descriptor =
      source.descriptor ??
      (protocol === 'http' || protocol === 'https' || protocol === 'browser-file'
        ? ''
        : 'modkit.repository.json')
    const document = await readMountJson(mount, descriptor, signal)
    return Object.freeze({
      mount,
      descriptor,
      descriptorBytes: document.bytes,
      manifest: normalizeRepositoryManifest(document.value),
      protocol,
    })
  } catch (error) {
    await mount.dispose()
    throw error
  }
}

/**
 * Load only the explicitly enumerated, confined data profiles from an already opened repository.
 * The caller retains ownership of the mount; no extension module is imported or evaluated.
 */
export async function loadRepositorySubjectProfiles(
  mount: VfsMount,
  manifest: unknown,
  signal?: AbortSignal,
): Promise<{
  readonly vendors: readonly VendorSubjectProfile[]
  readonly games: readonly GameSubjectProfile[]
}> {
  const normalizedManifest = normalizeRepositoryManifest(manifest)
  const vendors: VendorSubjectProfile[] = []
  const games: GameSubjectProfile[] = []
  const paths = [
    ...(normalizedManifest.subjects?.vendors ?? []).map(path => ({ kind: 'vendor', path })),
    ...(normalizedManifest.subjects?.games ?? []).map(path => ({ kind: 'game', path })),
  ]
  let totalBytes = 0
  for (const entry of paths) {
    signal?.throwIfAborted()
    const document = await readMountJson(mount, entry.path, signal)
    if (document.bytes.byteLength > MAXIMUM_SUBJECT_PROFILE_BYTES) {
      throw new ExtensionManagerError(
        'extension-manager/subject-profile-too-large',
        `repository subject profile «${entry.path}» exceeds the byte limit`,
        {
          path: entry.path,
          bytes: document.bytes.byteLength,
          limit: MAXIMUM_SUBJECT_PROFILE_BYTES,
        },
      )
    }
    totalBytes += document.bytes.byteLength
    if (totalBytes > MAXIMUM_SUBJECT_PROFILES_BYTES) {
      throw new ExtensionManagerError(
        'extension-manager/subject-profiles-too-large',
        'repository subject profiles exceed the total byte limit',
        { bytes: totalBytes, limit: MAXIMUM_SUBJECT_PROFILES_BYTES },
      )
    }
    const profile =
      entry.kind === 'vendor'
        ? normalizeVendorSubjectProfile(document.value)
        : normalizeGameSubjectProfile(document.value)
    ;(entry.kind === 'vendor'
      ? vendors
      : (games as (VendorSubjectProfile | GameSubjectProfile)[])
    ).push(profile)
  }
  const duplicate = (profiles: readonly { readonly id: string }[], label: string): void => {
    const seen = new Set<string>()
    for (const profile of profiles) {
      if (seen.has(profile.id)) {
        throw new ExtensionManagerError(
          'extension-manager/subject-profile-duplicate',
          `${label} subject profile «${profile.id}» is duplicated`,
          { id: profile.id },
        )
      }
      seen.add(profile.id)
    }
  }
  duplicate(vendors, 'vendor')
  duplicate(games, 'game')
  return Object.freeze({
    vendors: Object.freeze(vendors),
    games: Object.freeze(games),
  })
}
