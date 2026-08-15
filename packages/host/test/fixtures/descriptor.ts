import type { ResolvedAssetDescriptorWire } from '@modkitx-x3/sdk'

export function resolvedDescriptorWire(
  operations: ResolvedAssetDescriptorWire['operations'] = [],
): ResolvedAssetDescriptorWire {
  return {
    schemaVersion: 2,
    subjectUri: 'memory://fixtures/session.bin',
    origin: {
      kind: 'single',
      binding: {
        id: 'content',
        role: 'content',
        source: { id: 'session-source', uri: 'memory://fixtures/session.bin' },
        required: true,
        ownership: 'owned',
        revision: 'content-hash.sha256:session-1',
      },
    },
    interpretation: 'codec',
    identity: {
      codecId: 'example.codec/session',
      codecVersion: '1.0.0',
      formatId: 'session-fixture',
      formatLabel: 'Session fixture',
      confidence: 1,
      detection: [{ kind: 'structure', weight: 1 }],
    },
    traits: [],
    operations,
    constraints: {
      readOnly: false,
      seekable: true,
      randomAccess: true,
      trusted: false,
    },
    dataSources: [],
    diagnostics: [],
    revision: 'content-hash.sha256:session-1',
    metadata: [],
  }
}
