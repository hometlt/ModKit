/** Native entry identity/context must survive both ordinary and workspace companion routing. */
import { describe, expect, it } from 'vitest'
import { revisionId, type NamespaceEntrySource } from '@modkit/sdk'
import { artifactByteSourceFromBytes } from '../src/source-bridge.js'
import {
  createNamespaceCompanionOrigin,
  createWorkspaceNamespaceCompanionOrigin,
  createCompositeWorkspaceNamespaceCompanionOrigin,
} from '../src/namespace-origin.js'

describe('namespace provider-pinned artifact sources', () => {
  it.each(['ordinary', 'workspace', 'composite'] as const)(
    'keeps original identity through %s origin without legacy range or extraction',
    async mode => {
      const original = artifactByteSourceFromBytes(
        { id: 'native', uri: 'native://CAB-one' },
        revisionId('provider-token:original'),
        new Uint8Array([7, 8]),
        { native: 'entry' },
      )
      let releases = 0
      const namespace: NamespaceEntrySource = {
        async list() {
          return {
            items: [
              {
                id: 'CAB-one',
                path: 'CAB-one',
                name: 'CAB-one',
                kind: 'file',
                rangeAccess: true,
                size: 2n,
                revision: revisionId('provider-token:parent-listing'),
              },
            ],
          }
        },
        async openEntry() {
          throw new Error('Legacy ref must not replace native identity')
        },
        async openEntrySource() {
          throw new Error('Legacy range must not replace native identity')
        },
        async nestedContext() {
          return { wrong: 'namespace-wide' }
        },
        async openEntryArtifactSource() {
          return {
            value: original,
            release: async () => {
              releases += 1
            },
          }
        },
      }
      const common = {
        namespace,
        primaryLogicalId: 'selected.prefab',
        containerRevision: revisionId('provider-token:parent'),
        extract: async () => {
          throw new Error('Whole extraction forbidden')
        },
      }
      const origin =
        mode === 'ordinary'
          ? createNamespaceCompanionOrigin(common)
          : mode === 'workspace'
            ? createWorkspaceNamespaceCompanionOrigin({
                ...common,
                logicalRoots: [{ rootId: 'native', pathPrefix: '' }],
              })
            : createCompositeWorkspaceNamespaceCompanionOrigin({
                primaryLogicalId: 'selected.prefab',
                roots: [{ rootId: 'native', pathPrefix: '', ...common }],
              })
      const lease = await origin.open('CAB-one')
      expect(lease.value).toBe(original)
      expect(lease.value.revision).not.toBe(common.containerRevision)
      expect(lease.value.containerContext).toEqual({ native: 'entry' })
      if (lease.value.kind !== 'bytes') throw new Error('Expected bytes')
      expect(await lease.value.read(1n, 1)).toEqual(new Uint8Array([8]))
      await lease.release()
      expect(releases).toBe(1)
    },
  )
})
