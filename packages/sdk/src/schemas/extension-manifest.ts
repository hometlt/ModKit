/**
 * Single wire authority for the normalized `ExtensionManifest` and its two authored
 * containers (owners: canon §5.13 + MK3/27 §0.2; Q75/Q76 owner decisions 2026-08-13).
 * JSON Schema 2020-12, strict. The published .json artifacts are emitted from these
 * consts; the TypeScript types are pinned by the compile-time drift gate.
 */

import {
  DOTTED_PATTERN,
  QUALIFIED_PATTERN,
  SEMVER_PATTERN,
  VERSION_RANGE_PATTERN,
} from './patterns.js'
import { deepFreeze } from '@modkit/core'

export const REQUIREMENT_SCOPE_KINDS = Object.freeze([
  'contribution',
  'offer',
  'operation',
  'intent',
  'variant',
  'profile',
  'projection',
  'slot',
] as const)

export const requirementScopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id'],
  properties: {
    kind: { enum: REQUIREMENT_SCOPE_KINDS },
    id: { type: 'string', minLength: 1 },
  },
} as const

/** Q75 (owner decision 2026-08-13): extension-coordinate requirement, mandatory scope. */
export const extensionRequirementSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkit.org/x3/extension-requirement.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['extension', 'mode', 'scope'],
  properties: {
    extension: { type: 'string', pattern: QUALIFIED_PATTERN },
    range: { type: 'string', pattern: VERSION_RANGE_PATTERN },
    mode: { enum: ['required', 'default', 'suggested', 'integrates'] },
    scope: requirementScopeSchema,
  },
} as const

const contributionManifestsSchema = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
} as const

/**
 * Portable path inside an extension mount. `./` is accepted for compatibility with authored
 * contribution paths, while absolute/drive/UNC paths, traversal, backslashes and NUL are refused.
 */
export const EXTENSION_VFS_PATH_PATTERN =
  '^(?:\\./)?(?![A-Za-z]:)(?!\\\\)(?!.*\\\\)(?!.*\\u0000)(?!\\.{1,2}(?:/|$))(?!.*\\/\\.{1,2}(?:/|$))[^/]+(?:/[^/]+)*$'

export const extensionVendorDescriptorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'displayName'],
  properties: {
    id: { type: 'string', pattern: DOTTED_PATTERN },
    displayName: { type: 'string', minLength: 1 },
  },
} as const

export const extensionGameDescriptorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'displayName'],
  properties: {
    id: { type: 'string', pattern: QUALIFIED_PATTERN },
    displayName: { type: 'string', minLength: 1 },
  },
} as const

export const extensionAssetReferenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', pattern: EXTENSION_VFS_PATH_PATTERN },
    displayName: { type: 'string', minLength: 1 },
    mediaType: { type: 'string', minLength: 1 },
  },
} as const

export const extensionSourceDetailsSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'root'],
      properties: {
        kind: { const: 'root' },
        root: { type: 'string', pattern: EXTENSION_VFS_PATH_PATTERN },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'url'],
      properties: {
        kind: { const: 'url' },
        url: { type: 'string', pattern: '^https?://[^\\s]+$' },
      },
    },
  ],
} as const

export const extensionPresentationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    displayName: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    vendor: extensionVendorDescriptorSchema,
    games: { type: 'array', items: extensionGameDescriptorSchema },
    icon: extensionAssetReferenceSchema,
    source: extensionSourceDetailsSchema,
    licenseFiles: { type: 'array', items: extensionAssetReferenceSchema },
  },
} as const

/**
 * Normalized ExtensionManifest — the one contract both authored containers produce
 * (canon §5.13). Also the exact shape of the standalone `modkit.extension.json`
 * container (Q76: standalone carries its own version/license).
 */
/** `languageFiles`: game file associations (`.scar` → `lua`, dialect `lua51`). */
const LANGUAGE_TOKEN = { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' } as const
const languageFilesSchema = {
  type: 'array',
  maxItems: 64,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['extension', 'languageId'],
    properties: { extension: LANGUAGE_TOKEN, languageId: LANGUAGE_TOKEN, dialect: LANGUAGE_TOKEN },
  },
} as const

/** `credentials`: sign-ins and keys through the host broker (PLAN_UNIFIED_AUTH). */
const HTTP_URL = { type: 'string', pattern: '^https?://[^\\s]+$', maxLength: 512 } as const
const credentialsSchema = {
  type: 'array',
  maxItems: 32,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'kind', 'label'],
    properties: {
      id: { type: 'string', pattern: '^[a-z0-9][a-z0-9.-]*/[a-z0-9][a-z0-9._-]*$', maxLength: 128 },
      kind: { enum: ['api-key', 'oauth2-pkce', 'provider-session', 'symmetric-key'] },
      label: { type: 'string', minLength: 1, maxLength: 128 },
      audience: { type: 'array', maxItems: 16, items: HTTP_URL },
      header: { type: 'string', pattern: '^[A-Za-z0-9-]{1,64}$' },
      scopes: {
        type: 'array',
        maxItems: 32,
        items: { type: 'string', minLength: 1, maxLength: 128 },
      },
      oauth: {
        type: 'object',
        additionalProperties: false,
        required: ['authorizationEndpoint', 'tokenEndpoint'],
        properties: {
          authorizationEndpoint: HTTP_URL,
          tokenEndpoint: HTTP_URL,
          revocationEndpoint: HTTP_URL,
          clientId: { type: 'string', minLength: 1, maxLength: 256 },
          clientIdSetting: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,64}$' },
          loopbackPort: { type: 'integer', minimum: 1024, maximum: 65535 },
        },
      },
      scoped: { type: 'boolean' },
      environment: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,63}$' },
    },
  },
} as const

export const extensionManifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkit.org/x3/extension-manifest.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'publisher', 'id', 'version', 'license', 'contributionManifests'],
  properties: {
    schemaVersion: { const: 1 },
    publisher: { type: 'string', pattern: DOTTED_PATTERN },
    id: { type: 'string', pattern: DOTTED_PATTERN },
    version: { type: 'string', pattern: SEMVER_PATTERN },
    license: { type: 'string', minLength: 1 },
    contributionManifests: contributionManifestsSchema,
    dependsOn: { type: 'array', items: extensionRequirementSchema },
    presentation: extensionPresentationSchema,
    contentSources: { type: 'string', pattern: EXTENSION_VFS_PATH_PATTERN },
    languageFiles: languageFilesSchema,
    credentials: credentialsSchema,
  },
} as const

/**
 * Authored `package.json#modkit` block (decision 64). Q76: `version`/`license` come only
 * from the top-level package.json — `additionalProperties: false` plus their absence here
 * makes an in-block duplicate a schema violation (and the normalizer reports a dedicated
 * packaging-error diagnostic first).
 */
export const modkitBlockSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkit.org/x3/extension-manifest-modkit-block.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'publisher', 'id', 'contributionManifests'],
  properties: {
    schemaVersion: { const: 1 },
    publisher: { type: 'string', pattern: DOTTED_PATTERN },
    id: { type: 'string', pattern: DOTTED_PATTERN },
    contributionManifests: contributionManifestsSchema,
    dependsOn: { type: 'array', items: extensionRequirementSchema },
    presentation: extensionPresentationSchema,
    contentSources: { type: 'string', pattern: EXTENSION_VFS_PATH_PATTERN },
    languageFiles: languageFilesSchema,
    credentials: credentialsSchema,
  },
} as const

deepFreeze(requirementScopeSchema)
deepFreeze(extensionRequirementSchema)
deepFreeze(extensionVendorDescriptorSchema)
deepFreeze(extensionGameDescriptorSchema)
deepFreeze(extensionAssetReferenceSchema)
deepFreeze(extensionSourceDetailsSchema)
deepFreeze(extensionPresentationSchema)
deepFreeze(extensionManifestSchema)
deepFreeze(modkitBlockSchema)
