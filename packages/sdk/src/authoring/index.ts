/** Safe authoring sugar. Wire schemas remain authoritative; builders only remove boilerplate. */

import { ModkitError, canonicalJsonStringify } from '@modkitx-x3/core'
import type {
  ArtifactStage,
  ByteProbePlan,
  Codec,
  CodecContributionSpecV1,
  CodecModule,
  CompanionRule,
  DataSourceRef,
  DerivedProbePlan,
  FormatRef,
  FormatRole,
  ImplementationTierClaim,
  JsonValue,
  KnownContractId,
  MatchRules,
  NamespaceProbePlan,
  OpenIntent,
  OperationDecl,
  OperationOutput,
  PermissionClass,
  Progress,
  RepresentationDecl,
  ResourceBudget,
  RuntimeEnvironment,
  RuntimeTargetConstraint,
  RuntimeVariantDeclaration,
  ServiceProviderContributionSpecV1,
  ServiceProviderModule,
  TraitDeclaration,
  ViewerContributionSpecV1,
  ViewerModule,
} from '../index.js'
import type { ContractMajor } from '../service-contracts.js'

export interface TargetDecl extends Omit<RuntimeTargetConstraint, 'environments'> {
  readonly variantId: string
  readonly environments: readonly [RuntimeEnvironment, ...RuntimeEnvironment[]]
  readonly entrypoint: string
}

export type NodeTargetDecl = Omit<TargetDecl, 'environments'> & {
  readonly environments: readonly ['node' | 'node-worker', ...('node' | 'node-worker')[]]
}

export type AuthoringExecution =
  | {
      readonly profile: 'pure-transform'
      readonly targets: readonly [TargetDecl, ...TargetDecl[]]
      readonly permissions?: never
    }
  | {
      readonly profile: 'source-reader'
      readonly targets: readonly [TargetDecl, ...TargetDecl[]]
      readonly permissions?: never
    }
  | {
      readonly profile: 'node-only'
      readonly targets: readonly [NodeTargetDecl, ...NodeTargetDecl[]]
      readonly permissions: readonly PermissionClass[]
    }
  | {
      readonly profile: 'explicit'
      readonly targets: readonly [TargetDecl, ...TargetDecl[]]
      readonly permissions: readonly PermissionClass[]
    }

export type ProbeFn = Codec['probe']
export type OpenFn = Codec['open']
export type PlanInputFn = NonNullable<Codec['planInput']>
export type HandlerFn = (
  input: JsonValue,
  options?: {
    readonly signal?: AbortSignal
    readonly onProgress?: (progress: Progress) => void
  },
) => Promise<OperationOutput>

interface CodecAuthoringBase {
  readonly id: string
  readonly displayName: string
  readonly format: FormatRef | readonly FormatRef[]
  readonly roles: readonly FormatRole[]
  readonly stages: readonly ArtifactStage[]
  readonly intents: readonly OpenIntent[]
  readonly match: MatchRules
  readonly open: OpenFn
  readonly planInput?: PlanInputFn
  readonly operations: readonly (OperationDecl & { readonly handler: HandlerFn })[]
  readonly representations: readonly RepresentationDecl[]
  readonly publishesDataSources: readonly DataSourceRef[]
  readonly companions?: readonly CompanionRule[]
  readonly traitDeclarations?: readonly TraitDeclaration[]
  readonly budgets: ResourceBudget
  readonly implementationTier: ImplementationTierClaim
}

type CodecTopologyAuthoring =
  | {
      readonly topology: 'single' | 'bundle'
      readonly probe: ByteProbePlan & { readonly run: ProbeFn }
    }
  | {
      readonly topology: 'namespace'
      readonly probe: NamespaceProbePlan & { readonly run: ProbeFn }
    }
  | {
      readonly topology: 'derived'
      readonly probe: DerivedProbePlan & { readonly run: ProbeFn }
    }

export type CodecAuthoringSpec = CodecAuthoringBase & CodecTopologyAuthoring & AuthoringExecution

export interface AuthoringDefinitionBase {
  readonly id: string
  readonly profile: AuthoringExecution['profile']
  readonly targets: readonly TargetDecl[]
  readonly requestedPermissionClasses: readonly PermissionClass[]
  readonly runtimeVariants: readonly RuntimeVariantDeclaration[]
}

export interface CodecDefinition extends AuthoringDefinitionBase {
  readonly contribution: CodecContributionSpecV1
  readonly module: CodecModule
}

export type GroupDefaults = Pick<
  CodecAuthoringBase,
  | 'roles'
  | 'stages'
  | 'intents'
  | 'budgets'
  | 'representations'
  | 'publishesDataSources'
  | 'implementationTier'
> &
  Pick<CodecTopologyAuthoring, 'topology'> &
  Pick<AuthoringExecution, 'targets' | 'profile'> & {
    readonly permissions?: readonly PermissionClass[]
  }

export type CodecGroupMember = Omit<CodecAuthoringSpec, keyof GroupDefaults> &
  Partial<GroupDefaults>

export type ServiceProviderAuthoringSpec<
  Contract extends KnownContractId,
  Major extends ContractMajor<Contract>,
> = AuthoringExecution & {
  readonly id: string
  readonly contribution: ServiceProviderContributionSpecV1<Contract>
  readonly module: ServiceProviderModule<Contract, Major>
}

export interface ProviderDefinition<
  Contract extends KnownContractId = KnownContractId,
> extends AuthoringDefinitionBase {
  readonly contribution: ServiceProviderContributionSpecV1<Contract>
  readonly module: ServiceProviderModule<Contract>
}

export type ViewerAuthoringSpec = AuthoringExecution & {
  readonly id: string
  readonly contribution: ViewerContributionSpecV1
  readonly module: ViewerModule
}

export interface ViewerDefinition extends AuthoringDefinitionBase {
  readonly contribution: ViewerContributionSpecV1
  readonly module: ViewerModule
}

export interface TargetSmokeEvidence {
  readonly variantId: string
  readonly environment: RuntimeEnvironment
  readonly state: 'passed' | 'failed'
}

export type AuthoringSmokeVerification =
  | { readonly state: 'verified'; readonly evidence: readonly TargetSmokeEvidence[] }
  | {
      readonly state: 'incomplete'
      readonly missing: readonly {
        readonly variantId: string
        readonly environment: RuntimeEnvironment
      }[]
      readonly failed: readonly TargetSmokeEvidence[]
    }

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

function snapshot<T>(value: T): T {
  return deepFreeze(JSON.parse(canonicalJsonStringify(value)) as T)
}

function permissions(execution: AuthoringExecution): readonly PermissionClass[] {
  switch (execution.profile) {
    case 'pure-transform':
      return Object.freeze([])
    case 'source-reader':
      return Object.freeze(['read-source'])
    case 'node-only':
    case 'explicit':
      return Object.freeze([...execution.permissions])
  }
}

function executionProfile(profile: AuthoringExecution['profile']) {
  switch (profile) {
    case 'pure-transform':
    case 'source-reader':
      return 'worker-brokered' as const
    case 'node-only':
      return 'trusted-in-process' as const
    case 'explicit':
      return 'process-brokered' as const
  }
}

function targets(execution: AuthoringExecution): readonly TargetDecl[] {
  return snapshot(execution.targets as readonly TargetDecl[])
}

function runtimeVariants(execution: AuthoringExecution) {
  const requestedPermissionClasses = permissions(execution)
  return snapshot(
    execution.targets.map(target => {
      const { variantId, entrypoint, ...constraint } = target
      return {
        variantId,
        entrypoint,
        target: constraint,
        executionProfile: executionProfile(execution.profile),
        requestedPermissionClasses,
      }
    }),
  )
}

function assertCodecTopology(spec: CodecAuthoringSpec): void {
  const expected =
    spec.topology === 'namespace' ? 'namespace' : spec.topology === 'derived' ? 'derived' : 'bytes'
  if (spec.probe.kind !== expected) {
    throw new ModkitError({
      code: 'x3.sdk/authoring-topology-mismatch',
      message: `codec topology ${spec.topology} requires a ${expected} probe plan`,
    })
  }
}

export function defineCodec(spec: CodecAuthoringSpec): CodecDefinition {
  assertCodecTopology(spec)
  const probe = spec.probe.run
  const open = spec.open
  const planInput = spec.planInput
  const probePlan =
    spec.probe.kind === 'bytes'
      ? {
          kind: spec.probe.kind,
          ranges: spec.probe.ranges,
          maxBytes: spec.probe.maxBytes,
        }
      : spec.probe.kind === 'namespace'
        ? {
            kind: spec.probe.kind,
            ...(spec.probe.prefixes === undefined ? {} : { prefixes: spec.probe.prefixes }),
            maxEntries: spec.probe.maxEntries,
            maxDepth: spec.probe.maxDepth,
            maxPathBytes: spec.probe.maxPathBytes,
          }
        : {
            kind: spec.probe.kind,
            maxSubjects: spec.probe.maxSubjects,
            maxRelationDepth: spec.probe.maxRelationDepth,
          }
  const operationDeclarations = spec.operations.map(item => ({
    id: item.id,
    handlerId: item.handlerId,
    mutatesSource: item.mutatesSource,
    ...(item.requiredPermissions === undefined
      ? {}
      : { requiredPermissions: item.requiredPermissions }),
    ...(item.requiresContract === undefined ? {} : { requiresContract: item.requiresContract }),
    ...(item.inputSchema === undefined ? {} : { inputSchema: item.inputSchema }),
    ...(item.outputKinds === undefined ? {} : { outputKinds: item.outputKinds }),
  }))
  const contribution = snapshot({
    formatRefs: Array.isArray(spec.format) ? spec.format : [spec.format],
    roles: spec.roles,
    artifactStages: spec.stages,
    openIntents: spec.intents,
    match: spec.match,
    ...(spec.companions === undefined ? {} : { companions: spec.companions }),
    representations: spec.representations,
    publishesDataSources: spec.publishesDataSources,
    operations: operationDeclarations,
    ...(spec.traitDeclarations === undefined ? {} : { traitDeclarations: spec.traitDeclarations }),
    implementationTier: spec.implementationTier,
    budgets: {
      ...spec.budgets,
      maxInputBytes: spec.budgets.maxInputBytes.toString(10),
    },
    sourceTopology: spec.topology,
    probe: probePlan,
  }) as CodecContributionSpecV1
  const module = Object.freeze({
    abiVersion: 1 as const,
    createCodec: () =>
      Object.freeze({
        probe,
        ...(planInput === undefined ? {} : { planInput }),
        open,
      }),
  })
  return Object.freeze({
    id: spec.id,
    profile: spec.profile,
    contribution,
    module,
    targets: targets(spec),
    requestedPermissionClasses: permissions(spec),
    runtimeVariants: runtimeVariants(spec),
  }) as CodecDefinition
}

export function defineCodecGroup(spec: {
  readonly defaults: GroupDefaults
  readonly codecs: readonly CodecGroupMember[]
}): readonly CodecDefinition[] {
  return Object.freeze(
    spec.codecs.map(codec =>
      defineCodec({ ...spec.defaults, ...codec } as unknown as CodecAuthoringSpec),
    ),
  )
}

export function defineServiceProvider<
  Contract extends KnownContractId,
  Major extends ContractMajor<Contract>,
>(spec: ServiceProviderAuthoringSpec<Contract, Major>): ProviderDefinition<Contract> {
  const module = Object.freeze({ ...spec.module }) as ServiceProviderModule<Contract, Major>
  return Object.freeze({
    id: spec.id,
    profile: spec.profile,
    contribution: snapshot(spec.contribution),
    module,
    targets: targets(spec),
    requestedPermissionClasses: permissions(spec),
    runtimeVariants: runtimeVariants(spec),
  }) as unknown as ProviderDefinition<Contract>
}

export function defineViewer(spec: ViewerAuthoringSpec): ViewerDefinition {
  return Object.freeze({
    id: spec.id,
    profile: spec.profile,
    contribution: snapshot(spec.contribution),
    module: Object.freeze({ ...spec.module }),
    targets: targets(spec),
    requestedPermissionClasses: permissions(spec),
    runtimeVariants: runtimeVariants(spec),
  })
}

/** Every declared environment needs positive smoke evidence before packaging. */
export function verifyAuthoringTargets(
  definition: AuthoringDefinitionBase,
  evidence: readonly TargetSmokeEvidence[],
): AuthoringSmokeVerification {
  const ownedEvidence = snapshot(evidence)
  const failed = ownedEvidence.filter(item => item.state === 'failed')
  const missing = definition.targets.flatMap(target =>
    target.environments
      .filter(
        environment =>
          !ownedEvidence.some(
            item =>
              item.variantId === target.variantId &&
              item.environment === environment &&
              item.state === 'passed',
          ),
      )
      .map(environment => ({ variantId: target.variantId, environment })),
  )
  return missing.length === 0 && failed.length === 0
    ? { state: 'verified', evidence: ownedEvidence }
    : { state: 'incomplete', missing: snapshot(missing), failed }
}

export function assertAuthoringPackable(
  definition: AuthoringDefinitionBase,
  evidence: readonly TargetSmokeEvidence[],
): void {
  const result = verifyAuthoringTargets(definition, evidence)
  if (result.state === 'verified') return
  throw new ModkitError({
    code: 'x3.sdk/authoring-smoke-incomplete',
    message: 'every declared target environment must pass its smoke test before packaging',
    context: { missing: result.missing, failed: result.failed },
  })
}
