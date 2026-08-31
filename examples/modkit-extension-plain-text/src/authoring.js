import { contractId, operationId } from '@modkit/core'
import { defineCodec } from '@modkit/sdk/authoring'
import { openPlainText, plainTextCodec } from './codec.js'
import { probePlainText } from './shared/probe.js'

const id = 'modkit/plain-text'

export const plainTextDefinition = defineCodec({
  id,
  displayName: 'Plain text',
  format: { formatId: 'plain-text', label: 'Plain text', mediaType: 'text/plain' },
  roles: ['semantic'],
  topology: 'single',
  stages: ['authored'],
  intents: ['probe', 'inspect', 'full', 'stream', 'export'],
  match: { extensions: ['txt', 'log', 'md', 'text'], mediaTypes: ['text/plain'] },
  probe: {
    kind: 'bytes',
    ranges: [{ from: 'start', length: 4096 }],
    maxBytes: 4096,
    run: probePlainText,
  },
  planInput: plainTextCodec.planInput,
  open: openPlainText,
  operations: [
    ['view.inspect', 'inspect', 'json'],
    ['asset.validate', 'validate', 'none'],
    ['asset.search', 'search', 'json'],
    ['export.raw', 'export-raw', 'bytes'],
  ].map(([operation, handlerId, output]) => ({
    id: operationId(operation, { contributionId: id }),
    handlerId,
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: [output],
    handler: async () => ({ kind: 'none' }),
  })),
  representations: [
    {
      id: 'source-text',
      contract: contractId('modkit/plain-text-representation'),
      major: 1,
      stage: 'authored',
      lossy: false,
    },
  ],
  publishesDataSources: [
    { contract: 'common.view/text-data-source', major: 1 },
    { contract: 'common.view/byte-range-source', major: 1 },
  ],
  traitDeclarations: [
    { id: 'content.text', representation: 'source', presence: 'will-expose' },
    { id: 'content.binary', representation: 'source', presence: 'will-expose' },
    { id: 'content.metadata', representation: 'source', presence: 'will-expose' },
  ],
  budgets: {
    maxInputBytes: 268435456n,
    maxDepth: 4,
    maxNodes: 1000000,
    maxScalarBytes: 16777216,
    maxDiagnostics: 1000,
  },
  implementationTier: { claimed: 1 },
  profile: 'source-reader',
  targets: [
    {
      variantId: 'browser-main',
      environments: ['browser-main'],
      entrypoint: './src/entrypoint.js',
    },
    {
      variantId: 'browser-worker',
      environments: ['browser-worker'],
      entrypoint: './src/entrypoint.js',
    },
    { variantId: 'node', environments: ['node'], entrypoint: './src/entrypoint.js' },
    {
      variantId: 'node-worker',
      environments: ['node-worker'],
      entrypoint: './src/entrypoint.js',
    },
  ],
})
