/**
 * Hand-authored public types for the extension envelope. Structural equality with the
 * schema consts is enforced at compile time by test/schema-drift.ts — these interfaces
 * cannot silently diverge from the wire authority.
 */

import type { ExtensionId } from '@modkitx-x3/core'

export type RequirementMode = 'required' | 'default' | 'suggested' | 'integrates'

export type RequirementScopeKind =
  'contribution' | 'offer' | 'operation' | 'intent' | 'variant' | 'profile' | 'projection' | 'slot'

export interface RequirementScope {
  readonly kind: RequirementScopeKind
  readonly id: string
}

/** Q75 (owner decision 2026-08-13): extension-level dependency, scope mandatory. */
export interface ExtensionRequirement {
  readonly extension: ExtensionId
  readonly range?: string
  readonly mode: RequirementMode
  readonly scope: RequirementScope
}

/** The one normalized contract both authored containers produce (canon §5.13). */
export interface ExtensionManifest {
  readonly schemaVersion: 1
  readonly publisher: string
  readonly id: string
  readonly version: string
  readonly license: string
  readonly contributionManifests: readonly string[]
  readonly dependsOn?: readonly ExtensionRequirement[]
}

/** Authored `package.json#modkit` block: no version/license by construction (Q76). */
export interface ModkitBlock {
  readonly schemaVersion: 1
  readonly publisher: string
  readonly id: string
  readonly contributionManifests: readonly string[]
  readonly dependsOn?: readonly ExtensionRequirement[]
}

export type AuthoredContainerKind = 'package-json' | 'standalone'
