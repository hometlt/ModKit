import { VirtualFileSystem, collectStream, normalizeVfsPath } from '@modkitx-x3/vfs'

import { ExtensionManagerError, normalizeRepositoryManifest } from './schema.js'

const decoder = new TextDecoder('utf-8', { fatal: true })

export function createExtensionVfs(providers) {
  const vfs = new VirtualFileSystem()
  const protocols = []
  for (const provider of providers) {
    vfs.registerProvider(provider)
    protocols.push(provider.scheme)
  }
  return Object.freeze({ vfs, protocols: Object.freeze(protocols.sort()) })
}

export async function readMountBytes(mount, path = '', signal) {
  const source = await mount.open(normalizeVfsPath(path), signal)
  try {
    return await collectStream(source.stream(0, undefined, signal), signal)
  } finally {
    await source.dispose()
  }
}

export async function readMountJson(mount, path = '', signal) {
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

export async function openRepositorySource(vfs, source, signal) {
  const mount = await vfs.openMount(source.uri, { signal })
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
