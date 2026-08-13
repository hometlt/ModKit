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

export const REQUIREMENT_SCOPE_KINDS = [
  'contribution',
  'offer',
  'operation',
  'intent',
  'variant',
  'profile',
  'projection',
  'slot',
] as const

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
 * Normalized ExtensionManifest — the one contract both authored containers produce
 * (canon §5.13). Also the exact shape of the standalone `modkit.extension.json`
 * container (Q76: standalone carries its own version/license).
 */
export const extensionManifestSchema = {
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
  },
} as const

/**
 * Authored `package.json#modkit` block (decision 64). Q76: `version`/`license` come only
 * from the top-level package.json — `additionalProperties: false` plus their absence here
 * makes an in-block duplicate a schema violation (and the normalizer reports a dedicated
 * packaging-error diagnostic first).
 */
export const modkitBlockSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'publisher', 'id', 'contributionManifests'],
  properties: {
    schemaVersion: { const: 1 },
    publisher: { type: 'string', pattern: DOTTED_PATTERN },
    id: { type: 'string', pattern: DOTTED_PATTERN },
    contributionManifests: contributionManifestsSchema,
    dependsOn: { type: 'array', items: extensionRequirementSchema },
  },
} as const
