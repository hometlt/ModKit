/**
 * Open `ContributionManifestV1` transport envelope (owner: MK3/27 §6 with §0.5
 * simplifications: no per-contribution version, `status` optional display hint, security
 * authored only here in runtime variants). `RuntimeVariantDeclaration` shape belongs to
 * MK3/24 §3; `ScopedContractRequirement` to MK3/23 §8; `executionProfile` enum is the
 * Q77 owner decision (2026-08-13). Runtime-target dictionaries are the live v1 wire
 * facts ported from modkitx packages/assets/src/codec-manifest.ts@f10666be (PORTED.md).
 */

import {
  QUALIFIED_PATTERN,
  RELATIVE_ENTRYPOINT_PATTERN,
  SEGMENT_PATTERN,
  VERSION_RANGE_PATTERN,
} from './patterns.js'
import { deepFreeze } from '@modkitx-x3/core'
import { requirementScopeSchema } from './extension-manifest.js'

export const EXECUTION_PROFILES = Object.freeze([
  'browser-sandbox',
  'worker-brokered',
  'process-brokered',
  'wasm-brokered',
  'trusted-in-process',
  'remote-provider',
] as const)

/** Canonical permission taxonomy (MK3/24 §3). */
export const PERMISSION_CLASSES = Object.freeze([
  'read-source',
  'write-source',
  'filesystem-read',
  'filesystem-write',
  'network',
  'process-launch',
  'native-code',
  'credentials',
  'clipboard',
  'persistent-storage',
] as const)

export const RUNTIME_ENVIRONMENTS = Object.freeze([
  'browser-main',
  'browser-worker',
  'node',
  'node-worker',
  'wasm',
  'native',
  'external-tool',
] as const)

export const OPERATING_SYSTEMS = Object.freeze([
  'any',
  'windows',
  'linux',
  'darwin',
  'android',
  'ios',
] as const)

export const ARCHITECTURES = Object.freeze([
  'any',
  'x86',
  'x64',
  'arm32',
  'arm64',
  'wasm32',
] as const)

export const runtimeTargetConstraintSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    environments: { type: 'array', items: { enum: RUNTIME_ENVIRONMENTS }, minItems: 1 },
    operatingSystems: { type: 'array', items: { enum: OPERATING_SYSTEMS }, minItems: 1 },
    architectures: { type: 'array', items: { enum: ARCHITECTURES }, minItems: 1 },
    requiredHostCapabilities: { type: 'array', items: { type: 'string', minLength: 1 } },
    requiredWebApis: { type: 'array', items: { type: 'string', minLength: 1 } },
    externalTools: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const

/** MK3/24 §3 — the one authored source of requested permissions/targets/profiles. */
export const runtimeVariantDeclarationSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkitx.org/x3/runtime-variant-declaration.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['variantId', 'entrypoint', 'target', 'executionProfile', 'requestedPermissionClasses'],
  properties: {
    variantId: { type: 'string', pattern: SEGMENT_PATTERN },
    // Containment is enforced twice: here (authoring gate) and again by the host before
    // any import (MK3/24 §8) — the host never trusts that someone validated the input.
    entrypoint: { type: 'string', pattern: RELATIVE_ENTRYPOINT_PATTERN },
    target: runtimeTargetConstraintSchema,
    executionProfile: { enum: EXECUTION_PROFILES },
    requestedPermissionClasses: { type: 'array', items: { enum: PERMISSION_CLASSES } },
  },
} as const

/** MK3/23 §8 — contract-based requirement with explicit mode/scope. */
export const scopedContractRequirementSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkitx.org/x3/scoped-contract-requirement.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['contract', 'major', 'mode', 'scope'],
  properties: {
    contract: { type: 'string', pattern: QUALIFIED_PATTERN },
    major: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    range: { type: 'string', pattern: VERSION_RANGE_PATTERN },
    mode: { enum: ['required', 'default', 'suggested', 'integrates'] },
    scope: requirementScopeSchema,
  },
} as const

export const contributionManifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkitx.org/x3/contribution-manifest.v1.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'contract', 'id', 'displayName', 'spec'],
  properties: {
    schemaVersion: { const: 1 },
    contract: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'major'],
      properties: {
        id: { type: 'string', pattern: QUALIFIED_PATTERN },
        major: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      },
    },
    id: { type: 'string', pattern: QUALIFIED_PATTERN },
    displayName: { type: 'string', minLength: 1 },
    status: { enum: ['supported', 'partial', 'unsupported', 'experimental'] },
    runtimeVariants: { type: 'array', items: runtimeVariantDeclarationSchema },
    dependsOn: { type: 'array', items: scopedContractRequirementSchema },
    limitations: { type: 'array', items: { type: 'string', minLength: 1 } },
    spec: { title: 'JsonValue' },
  },
} as const

deepFreeze(runtimeTargetConstraintSchema)
deepFreeze(runtimeVariantDeclarationSchema)
deepFreeze(scopedContractRequirementSchema)
deepFreeze(contributionManifestSchema)
