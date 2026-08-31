/**
 * Hand-authored public types for the extension envelope. Structural equality with the
 * schema consts is enforced at compile time by test/schema-drift.ts — these interfaces
 * cannot silently diverge from the wire authority.
 */

import type { ExtensionId } from '@modkit/core'

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

/** Stable publisher identity shown independently from the extension coordinate. */
export interface ExtensionVendorDescriptor {
  readonly id: string
  readonly displayName: string
}

/** A game this extension presents support for; routing still belongs to contributions. */
export interface ExtensionGameDescriptor {
  readonly id: string
  readonly displayName: string
}

/** A file contained by the extension artifact and opened only through its confined VFS mount. */
export interface ExtensionAssetReference {
  readonly path: string
  readonly displayName?: string
  readonly mediaType?: string
}

/** Human-facing source attribution, never an ambient filesystem handle. */
export type ExtensionSourceDetails =
  | {
      readonly kind: 'root'
      /** Confined, portable path relative to the extension VFS mount. */
      readonly root: string
    }
  | {
      readonly kind: 'url'
      /** Absolute HTTP(S) source or project URL. */
      readonly url: string
    }

/** Optional data-only presentation metadata shared by manifests, managers and subject cards. */
export interface ExtensionPresentation {
  readonly displayName?: string
  readonly description?: string
  readonly vendor?: ExtensionVendorDescriptor
  readonly games?: readonly ExtensionGameDescriptor[]
  readonly icon?: ExtensionAssetReference
  readonly source?: ExtensionSourceDetails
  readonly licenseFiles?: readonly ExtensionAssetReference[]
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
  readonly presentation?: ExtensionPresentation
}

/** Authored `package.json#modkit` block: no version/license by construction (Q76). */
export interface ModkitBlock {
  readonly schemaVersion: 1
  readonly publisher: string
  readonly id: string
  readonly contributionManifests: readonly string[]
  readonly dependsOn?: readonly ExtensionRequirement[]
  readonly presentation?: ExtensionPresentation
}

export type AuthoredContainerKind = 'package-json' | 'standalone'
