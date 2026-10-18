/** Exact hidden companions reuse the namespace lookup and provider-owned artifact lease. */
import { expect, it } from 'vitest'
import { revisionId, type NamespaceEntrySource } from '@modkit/sdk'
import { createNamespaceCompanionOrigin } from '../src/namespace-origin.js'
import { artifactByteSourceFromBytes } from '../src/source-bridge.js'

it.each([false, true])('retains a hidden exact range with prior enumeration=%s', async enumerate => {
  const path = '__native__/revision-one/CAB-one.resS'
  const revision = revisionId('provider-token:exact-hidden')
  const source = artifactByteSourceFromBytes({ id: 'native', uri: 'native://resource' }, revision, Uint8Array.of(5, 6), { selected: 'native' })
  let lookups = 0
  let releases = 0
  const namespace: NamespaceEntrySource = {
    async list() { throw new Error('Hidden companion must not be found by listing') },
    async lookup(request) {
      lookups += 1
      expect(request.toLowerCase()).toBe(path.toLowerCase())
      return { id: 'opaque-entry', path, name: 'CAB-one.resS', kind: 'file', size: 2n, rangeAccess: true, revision }
    },
    async openEntry() { throw new Error('Legacy ref forbidden') },
    async openEntryArtifactSource(id) {
      expect(id).toBe('opaque-entry')
      return { value: source, release: async () => { releases += 1 } }
    },
  }
  const origin = createNamespaceCompanionOrigin({ namespace, primaryLogicalId: 'Assets/native.tga', containerRevision: revision, extract: async () => { throw new Error('Whole extraction forbidden') } })
  if (enumerate) {
    const entries = []
    for await (const entry of origin.enumerate('current-mount', { prefix: path.toLowerCase(), exactPath: true })) entries.push(entry)
    expect(entries).toEqual([{ logicalId: path, size: 2n }])
  }
  const lease = await origin.open(path)
  expect(lease.value).toBe(source)
  expect(lease.value.containerContext).toEqual({ selected: 'native' })
  expect(lookups).toBe(1)
  await lease.release()
  expect(releases).toBe(1)
})

it.each(['directory', 'different-file', 'missing'] as const)('does not admit an exact lookup returning %s', async mode => {
  const revision = revisionId('provider-token:exact-refusal')
  const prefixes: string[] = []
  const namespace: NamespaceEntrySource = {
    async list(prefix) { prefixes.push(prefix); return { items: [] } },
    async lookup() { return mode === 'missing' ? undefined : { id: 'wrong', path: mode === 'directory' ? 'hidden/file' : 'elsewhere/file', name: 'file', kind: mode === 'directory' ? 'directory' : 'file', revision } },
    async openEntry() { throw new Error('No admitted entry') },
  }
  const origin = createNamespaceCompanionOrigin({ namespace, primaryLogicalId: 'asset', containerRevision: revision, extract: async () => { throw new Error('No extraction') } })
  const entries = []
  for await (const entry of origin.enumerate('current-mount', { prefix: 'hidden/file', exactPath: true })) entries.push(entry)
  expect(entries).toEqual([])
  expect(prefixes).toEqual(['hidden/file'])
})

it('propagates exact lookup failures without a listing fallback', async () => {
  const revision = revisionId('provider-token:exact-error')
  const failure = new Error('retired namespace')
  const namespace: NamespaceEntrySource = {
    async list() { throw new Error('Fallback forbidden') },
    async lookup() { throw failure },
    async openEntry() { throw new Error('Open forbidden') },
  }
  const origin = createNamespaceCompanionOrigin({ namespace, primaryLogicalId: 'asset', containerRevision: revision, extract: async () => new Uint8Array() })
  await expect(origin.open('hidden/file')).rejects.toBe(failure)
})
