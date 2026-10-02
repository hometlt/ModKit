/** Type surface of the canonical UVD resolver, shared by runtime adapters. */
import type { ScenarioVariableInitializer } from './uv-scenario-variables.mjs'
import type { projectUvwPlayers } from './uvw-players.ts'
export interface ResolvedDefinition {
  readonly kind: string
  readonly fields: Readonly<Record<string, { readonly value: unknown; readonly provenance: unknown }>>
}
export interface ResolvedAssembly {
  readonly slots: readonly { readonly id: string; readonly capacity: number | string; readonly accepts: readonly string[] }[]
  readonly initialParts: readonly { readonly id: string; readonly slot: string; readonly definition: string }[]
}
export interface ResolvedPartEffect {
  readonly id: string
  readonly field: string
  readonly delta: number | string
}
export interface ResolvedPartGrant {
  readonly id: string
  readonly capability: string
}
export interface ResolvedCapabilityCounter {
  readonly id: string
  readonly initial: number | string
  readonly minimum: number | string
  readonly maximum: number | string
}
export interface ResolvedMovement {
  readonly classId: string
  readonly speedField: string
}
/** Versioned, immutable match policy; game definitions still belong to UVD. */
export interface RuntimeRules {
  readonly schemaVersion: 1
  readonly worldMutation: 'none' | 'cell-blockers'
}
/** Immutable instances of UVW artifacts; IDs qualify their local spaces, not geometry copies. */
export interface WorldInstances {
  readonly schemaVersion: 1
  readonly instances: readonly { readonly id: string; readonly packageId: string; readonly path: string }[]
}
export interface VerifiedWorldSpace {
  readonly instanceId?: string
  readonly packageId: string
  readonly path: string
  readonly spaceId: string
  readonly address: string
  /** The exact immutable space object in the captured UVW document. */
  readonly space: unknown
}
export interface CompositionReceipt {
  readonly kind: 'uv.receipt/composition'
  readonly schemaVersion: 1
  readonly root: { readonly id: string; readonly version: string }
  readonly verdict: 'composed'
  readonly layers: readonly { readonly id: string; readonly version: string; readonly rank: 'base' | 'official' | 'map' | 'mod'; readonly contentDigest: string }[]
  readonly requirements: { readonly intrinsicsChecked: number; readonly capabilitiesGranted: readonly string[] }
  readonly compositionHash: string
}
export function compositionHashForLayers(layers: CompositionReceipt['layers']): Promise<string>
export function verifyCompositionReceipt(receipt: unknown):
  Promise<{ readonly compositionHash: string; readonly layers: CompositionReceipt['layers'] }
  | { readonly refusal: { readonly rule: string; readonly message: string } }>
/** Requires an in-process receipt issued after artifact-byte verification. */
export function verifyProducedCompositionReceipt(receipt: unknown):
  Promise<{ readonly compositionHash: string; readonly layers: CompositionReceipt['layers'] }
  | { readonly refusal: { readonly rule: string; readonly message: string } }>
export function verifiedCompositionDocuments(receipt: unknown):
  Promise<{ readonly documents: readonly { readonly packageId: string; readonly family: 'uvd' | 'uvw' | 'uvs'; readonly path: string; readonly layer?: number; readonly document: unknown }[];
    readonly lowering: Readonly<{ registry: unknown; manifests: readonly unknown[]; granted: readonly string[] }>;
    readonly contents: readonly { readonly packageId: string; readonly family: string; readonly path: string; readonly hash: string }[] }
  | { readonly refusal: { readonly rule: string; readonly message: string } }>
export function verifiedCompositionBytecode(receipt: unknown):
  Promise<{ readonly modules: readonly { readonly packageId: string; readonly path: string; readonly digest: string; readonly bytes: Uint8Array }[] }
  | { readonly refusal: { readonly rule: string; readonly message: string } }>
export const VERIFIED_MEDIA_LIMITS: Readonly<{ artifactBytes: number; totalBytes: number; artifacts: number }>
export function verifiedCompositionMedia(receipt: unknown):
  Promise<{ readonly media: readonly { readonly packageId: string; readonly path: string; readonly digest: string; readonly bytes: Uint8Array }[] }
  | { readonly refusal: { readonly rule: string; readonly message: string } }>
export const VERIFIED_MODEL_LIMITS: Readonly<{ artifactBytes: number; totalBytes: number; artifacts: number }>
export function verifiedCompositionModels(receipt: unknown):
  Promise<{ readonly models: readonly { readonly packageId: string; readonly path: string;
    readonly digest: string; readonly document: unknown; readonly bytes: Uint8Array }[] }
  | { readonly refusal: { readonly rule: string; readonly message: string } }>
export function verifiedCompositionScenarioVariables(receipt: unknown):
  Promise<{ readonly variables: readonly ScenarioVariableInitializer[] }
  | { readonly refusal: { readonly rule: string; readonly message: string } }>
export function verifiedCompositionRuntimeRules(receipt: unknown):
  Promise<{ readonly rules: RuntimeRules | undefined }
  | { readonly refusal: { readonly rule: string; readonly message: string } }>
export function verifiedCompositionWorldSpaces(receipt: unknown):
  Promise<{ readonly spaces: readonly VerifiedWorldSpace[] }
  | { readonly refusal: { readonly rule: string; readonly message: string } }>
export function verifiedCompositionWorldPlayers(receipt: unknown):
  Promise<ReturnType<typeof projectUvwPlayers>
  | { readonly refusal: { readonly rule: string; readonly message: string } }>
export function composeVerifiedReceipt(
  rootId: string,
  manifests: readonly unknown[],
  registry: unknown,
  granted: readonly string[],
  artifactDigest: (request: { readonly packageId: string; readonly content: { readonly family: string; readonly path: string; readonly hash: string; readonly layer?: number }; readonly signal?: AbortSignal }) => Promise<string | { readonly digest: string; readonly document?: unknown; readonly bytes?: Uint8Array }> | string | { readonly digest: string; readonly document?: unknown; readonly bytes?: Uint8Array },
  signal?: AbortSignal,
): Promise<{ readonly receipt: CompositionReceipt } | { readonly refusal: { readonly rule: string; readonly message: string } }>
export function resolveDefinitions(
  layers: readonly { readonly id: string; readonly documents: readonly unknown[] }[],
  options?: { danglingReferences?: 'refuse' | 'diagnose'; externalParents?: 'refuse' | 'truncate' },
): { readonly definitions: ReadonlyMap<string, ResolvedDefinition>; readonly diagnostics: readonly unknown[];
     readonly assemblies: ReadonlyMap<string, ResolvedAssembly>;
     readonly partEffects: ReadonlyMap<string, readonly ResolvedPartEffect[]>;
     readonly partGrants: ReadonlyMap<string, readonly ResolvedPartGrant[]>;
     readonly capabilityCounters: ReadonlyMap<string, readonly ResolvedCapabilityCounter[]>;
     readonly movements: ReadonlyMap<string, ResolvedMovement> }
  | { readonly refusal: { readonly rule: string; readonly message: string } }
