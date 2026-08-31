import { describe, expect, it } from 'vitest'
import { createV1DescriptorProjectionPort, assembleSubjectDescriptor } from '@modkit/host'
import { resolvedDescriptorWire } from './fixtures/descriptor.js'

describe('A-3 host-local descriptor v2 → v1 projection', () => {
  it('projects only catalog-evaluated data and preserves a proven zero-match', async () => {
    const descriptor = await assembleSubjectDescriptor(resolvedDescriptorWire())
    const port = createV1DescriptorProjectionPort()
    const result = await port.project(descriptor, {
      state: 'evaluated',
      subjectUri: descriptor.subjectUri,
      revision: descriptor.revision,
      catalogRevision: 'catalog-1',
      compatibleContributions: [],
    })
    expect(result).toEqual({
      state: 'projected',
      projection: {
        schemaVersion: 1,
        contributions: [],
        catalogRevision: 'catalog-1',
        persistable: false,
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/ticket|digest|plan|factory/i)
  })

  it('fails closed for absent or cross-subject catalog context', async () => {
    const descriptor = await assembleSubjectDescriptor(resolvedDescriptorWire())
    const port = createV1DescriptorProjectionPort()
    for (const catalog of [
      undefined,
      {
        state: 'evaluated' as const,
        subjectUri: 'memory://fixtures/other.bin',
        revision: descriptor.revision,
        catalogRevision: 'catalog-1',
        compatibleContributions: [],
      },
    ]) {
      const result = await port.project(descriptor, catalog)
      expect(result).toMatchObject({
        state: 'unavailable',
        diagnostics: [{ code: 'modkit/compat-v1-projection-unavailable' }],
      })
    }
  })
})
