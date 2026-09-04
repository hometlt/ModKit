import { CAPABILITY_IDS, type KnownCapabilityId } from './capabilities.js'
import { ASSET_OPERATION_IDS } from './operations.js'
import { ASSET_SOURCE_KINDS, isKnownAssetSourceKind, type AssetSourceKind } from './source.js'

export const CODEC_MANIFEST_SCHEMA_VERSION = 1 as const

export const CODEC_MANIFEST_KINDS = [
  'archive',
  'model',
  'image',
  'audio',
  'video',
  'vector',
  'document',
  'game',
  'map',
  'mod',
  'data',
  'script',
  'layout',
  'localization',
  'replay',
  'save',
  'runtime',
] as const

export type CodecManifestKind = (typeof CODEC_MANIFEST_KINDS)[number]

export const CODEC_SUPPORT_STATUSES = [
  'supported',
  'partial',
  'experimental',
  'unsupported',
  'deprecated',
] as const

export type CodecSupportStatus = (typeof CODEC_SUPPORT_STATUSES)[number]

export const CODEC_CAPABILITIES = [
  'detect',
  'read',
  'inspect',
  'edit',
  'write',
  'validate',
  'references',
  'language',
  'render',
  'play',
  'export',
  'extract',
  'launch',
  'provision',
  'sign',
  'analyze',
] as const

export type CodecCapability = (typeof CODEC_CAPABILITIES)[number]

/**
 * Which representation of a game's data a trait was read out of.
 *
 * The axis `ASSET_CAPABILITIES.md` section 4 lacks, and the one that decides whether a coverage
 * claim is true. Three games that look like three degrees of one problem per domain are three
 * different problems along this axis: StarCraft II ships its authored format at retail and has no
 * compiled column at all; Command & Conquer 3's entire retail surface is compiled
 * (`BIN`/`MANIFEST`/`IMP`/`RELO`/`CDATA`) and `cnc3-data` reads mod-authored XML only; Beyond All
 * Reason is the inverse, with readable authored Lua and unreadable compiled `SMF`/`SMT` and `COB`.
 *
 * A codec reporting `game.catalog` without naming the representation it read is wrong in a way no
 * host can detect — which is exactly why "C&C 3 data: supported" would be a false statement today.
 *
 * - `source` — the authored format a mod author edits (SC2 `.SC2Data` XML, SAGE `.str`, Lua).
 * - `compiled` — a build artifact produced from that source (SAGE `.csf`, Spring `COB`).
 * - `runtime` — a packaged/binary shipping form that was never hand-authored (`.m3`, `.pie`,
 *   archives, replays).
 */
export const CODEC_TRAIT_REPRESENTATIONS = ['source', 'compiled', 'runtime'] as const

export type CodecTraitRepresentation = (typeof CODEC_TRAIT_REPRESENTATIONS)[number]

/**
 * The static half of `CapabilityState`.
 *
 * `disabled` and `dependency-required` are facts about one opened document — a missing companion,
 * an ungranted permission — so they belong on a descriptor, not on a manifest that describes every
 * document of a format. What a codec can say ahead of time is whether it reads the trait whole
 * (`available`) or in part (`partial`, as `cnc3-map` does for `game.map`: the `EAR` wrapper, the
 * chunk directory and `HeightMapData` dimensions, and no further).
 */
export const CODEC_TRAIT_STATES = ['available', 'partial'] as const

export type CodecTraitState = (typeof CODEC_TRAIT_STATES)[number]

export const CODEC_RUNTIME_ENVIRONMENTS = [
  'browser-main',
  'browser-worker',
  'node',
  'node-worker',
  'wasm',
  'native',
  'external-tool',
] as const

export type CodecRuntimeEnvironment = (typeof CODEC_RUNTIME_ENVIRONMENTS)[number]

export const CODEC_RUNTIME_AVAILABILITY = ['available', 'unavailable'] as const

export type CodecRuntimeAvailability = (typeof CODEC_RUNTIME_AVAILABILITY)[number]

export const CODEC_OPERATING_SYSTEMS = [
  'any',
  'windows',
  'linux',
  'darwin',
  'android',
  'ios',
] as const

export type CodecOperatingSystem = (typeof CODEC_OPERATING_SYSTEMS)[number]

export const CODEC_ARCHITECTURES = ['any', 'x86', 'x64', 'arm32', 'arm64', 'wasm32'] as const

export type CodecArchitecture = (typeof CODEC_ARCHITECTURES)[number]

export const CODEC_HOST_CAPABILITIES = [
  'random-access-source',
  'native-filesystem',
  'filesystem-write',
  'network',
  'worker',
  'webgl2',
  'webgpu',
  'web-audio',
  'process-launch',
  'secure-storage',
] as const

export type CodecHostCapability = (typeof CODEC_HOST_CAPABILITIES)[number]

export const CODEC_WEB_APIS = [
  'file-system-access',
  'web-worker',
  'offscreen-canvas',
  'webgl2',
  'webgpu',
  'web-audio',
  'shared-array-buffer',
  'compression-streams',
] as const

export type CodecWebApi = (typeof CODEC_WEB_APIS)[number]

export const CODEC_PERMISSION_CLASSES = [
  'read-source',
  'write-source',
  'filesystem-read',
  'filesystem-write',
  'network',
  'process-launch',
  'native-code',
  'clipboard',
  'persistent-storage',
] as const

export type CodecPermissionClass = (typeof CODEC_PERMISSION_CLASSES)[number]

export const CODEC_DEPENDENCY_RELATIONS = [
  'requires',
  'defaults',
  'suggests',
  'integrates',
  'conflicts',
  'replaces',
  'provides',
] as const

export type CodecDependencyRelation = (typeof CODEC_DEPENDENCY_RELATIONS)[number]

export const CODEC_CONFLICT_SCOPES = [
  'codec',
  'game',
  'feature-group',
  'source',
  'workspace',
  'host',
] as const

export type CodecConflictScope = (typeof CODEC_CONFLICT_SCOPES)[number]

export const GAME_CONTRIBUTION_MODES = ['requires', 'defaults', 'suggests', 'integrates'] as const

export type GameContributionMode = (typeof GAME_CONTRIBUTION_MODES)[number]

export const GAME_INSTALL_PRESET_MODES = ['required', 'default', 'optional'] as const

export type GameInstallPresetMode = (typeof GAME_INSTALL_PRESET_MODES)[number]

export type CodecManifestSourceKind = AssetSourceKind

export interface CodecManifestMatch {
  readonly extensions?: readonly string[]
  readonly pathGlobs?: readonly string[]
  readonly mimeTypes?: readonly string[]
  readonly magic?: readonly CodecManifestMagicMatch[]
  readonly xmlRoots?: readonly string[]
  readonly parentArtifacts?: readonly string[]
}

/**
 * An editor language identity this codec's documents speak, and the file associations that select
 * it.
 *
 * Only identity and association live here. The TextMate grammar and the language-configuration
 * file are the host editor's assets with host-relative paths, so naming them in a codec manifest
 * would couple a codec to one application's directory layout — the coupling this whole block
 * exists to remove, only pointing the other way. A host pairs its own assets to these ids.
 *
 * `id` may be one the host already knows (`xml`, `ini`, `lua`), in which case the entry only adds
 * file associations to it rather than declaring a new language.
 */
export interface CodecManifestLanguage {
  readonly id: string
  readonly aliases?: readonly string[]
  readonly extensions?: readonly string[]
  readonly filenames?: readonly string[]
  readonly filenamePatterns?: readonly string[]
}

/**
 * A `ASSET_CAPABILITIES.md` section 4 trait this codec's documents carry, and which representation
 * of the game's data it read to get there.
 *
 * This is what makes "show the unit's 3D model" a question about `model.geometry` rather than about
 * whether the format is called `.m3`, `.w3x` or `.s3o`. While traits lived only in a Markdown file a
 * host could not ask the catalog which codecs give it a skeleton — it could only load a codec and
 * look, which is the join a single entity card across several games needs and could not have.
 *
 * Two rules carried unchanged from the `languages` block, both of which cost something to learn:
 *
 * - **Declare only what the codec knows.** A trait is codec knowledge about a format. A widget is
 *   not, and neither is a host's decision about what to do with the data.
 * - **Independent of `entrypoints` and of `capabilities`.** A codec may declare a trait it has no
 *   runtime for, exactly as `sc2-map` contributes the `xml` language with no language server. The
 *   coarse `capabilities` verbs answer "what can this codec *do*"; traits answer "what does the
 *   asset *contain*". Both are needed and neither derives the other.
 */
export interface CodecManifestTrait {
  /** A section 4 identifier. Membership is enforced — see `codec-manifest.trait-id`. */
  readonly id: KnownCapabilityId
  /** Which representations this codec reads the trait from. At least one. */
  readonly representations: readonly CodecTraitRepresentation[]
  /** Defaults to `available`. */
  readonly state?: CodecTraitState
}

export interface CodecManifestMagicMatch {
  readonly offset: number
  readonly bytes: string
  readonly encoding: 'hex' | 'ascii'
}

export interface CodecManifestEntrypoints {
  readonly detect?: string
  readonly runtime?: string
  readonly viewer?: string
  /**
   * Language services this codec contributes to a protocol host: completion, diagnostics,
   * navigation for the documents it owns.
   *
   * Declared here for the same reason `viewer` is — so a host can learn that a codec HAS one, and
   * decide whether to load it, without importing the codec. It is what lets the enabled language
   * set be derived from installed codecs and settings rather than from a list compiled into the
   * host.
   */
  readonly language?: string
  /**
   * Installation discovery contributed by a game codec. The loaded module implements the
   * `GameInstallProbeModule` contract from `@modkitx/games`, so a host can discover an installed
   * game through the catalog without importing that game or its storage codec eagerly.
   *
   * This is a Node-host contribution rather than an asset runtime entry point: matching an asset
   * must never select it as the codec's `runtime`, and browser variants cannot declare it.
   */
  readonly installProbe?: string
  readonly worker?: string
  readonly node?: string
  readonly native?: string
  readonly externalTool?: string
}

export interface CodecDependencyRef {
  readonly id: string
  readonly range: string
  readonly features?: readonly string[]
}

export interface CodecConflictRef extends CodecDependencyRef {
  readonly scope?: CodecConflictScope
}

export interface CodecManifestDependencies {
  readonly requires?: readonly CodecDependencyRef[]
  readonly defaults?: readonly CodecDependencyRef[]
  readonly suggests?: readonly CodecDependencyRef[]
  readonly integrates?: readonly CodecDependencyRef[]
  readonly conflicts?: readonly CodecConflictRef[]
  readonly replaces?: readonly CodecDependencyRef[]
  readonly provides?: readonly string[]
}

export interface GameFeatureGroup {
  readonly requires?: readonly CodecDependencyRef[]
  readonly defaults?: readonly CodecDependencyRef[]
  readonly suggests?: readonly CodecDependencyRef[]
  readonly integrates?: readonly CodecDependencyRef[]
}

export interface GameContributionConfig {
  readonly codecId: string
  readonly priority: number
  readonly sourceScopes: readonly string[]
}

export interface CodecManifestReference {
  readonly title: string
  readonly url?: string
  readonly documentId?: string
  readonly license?: string
}

export interface CodecRuntimeVariant {
  readonly id: string
  readonly availability?: CodecRuntimeAvailability
  readonly unavailableReason?: string
  readonly environments: readonly CodecRuntimeEnvironment[]
  readonly entrypoints: CodecManifestEntrypoints
  readonly operatingSystems: readonly CodecOperatingSystem[]
  readonly architectures: readonly CodecArchitecture[]
  readonly requiredHostCapabilities?: readonly CodecHostCapability[]
  readonly requiredWebApis?: readonly CodecWebApi[]
  readonly externalTools?: readonly string[]
  readonly permissions?: readonly CodecPermissionClass[]
  readonly capabilities: readonly CodecCapability[]
  readonly operations?: readonly string[]
  readonly companions?: readonly string[]
  readonly standards?: readonly string[]
  readonly testedGames?: readonly string[]
  readonly references?: readonly CodecManifestReference[]
  readonly limitations?: readonly string[]
  readonly dependencies?: CodecManifestDependencies
}

export interface CodecManifestV1 {
  readonly $schema?: string
  readonly schemaVersion: typeof CODEC_MANIFEST_SCHEMA_VERSION
  readonly publisher: string
  readonly id: string
  readonly version: string
  readonly contractVersion: number
  readonly kind: CodecManifestKind
  readonly displayName: string
  readonly status: CodecSupportStatus
  readonly sourceKinds: readonly CodecManifestSourceKind[]
  readonly match: CodecManifestMatch
  readonly languages?: readonly CodecManifestLanguage[]
  readonly traits?: readonly CodecManifestTrait[]
  readonly capabilities: readonly CodecCapability[]
  readonly runtimeVariants: readonly CodecRuntimeVariant[]
  readonly operations?: readonly string[]
  readonly companions?: readonly string[]
  readonly standards?: readonly string[]
  readonly testedGames?: readonly string[]
  readonly references?: readonly CodecManifestReference[]
  readonly limitations?: readonly string[]
  readonly dependencies?: CodecManifestDependencies
  readonly featureGroups?: Readonly<Record<string, GameFeatureGroup>>
  readonly contributionConfig?: readonly GameContributionConfig[]
}

export type CodecManifestDiagnosticSeverity = 'error' | 'warning'

export interface CodecManifestDiagnostic {
  readonly code: string
  readonly path: string
  readonly message: string
  readonly severity: CodecManifestDiagnosticSeverity
}

export interface CodecManifestValidationContext {
  /** Folder containing `codec.manifest.json`; used to enforce one folder per local codec ID. */
  readonly folderName?: string
  /** Source/build entry points known to exist, expressed exactly as manifest-relative `./` paths. */
  readonly availableEntryPoints?: readonly string[]
  /**
   * Build/import-graph classification supplied by repository or bundle validation.
   * Browser variants reject a reachable Node/native/external-tool entry. Missing evidence is a
   * warning for editor validation and an error when `requireEntrypointRuntimeEvidence` is set.
   */
  readonly entrypointRuntimeKinds?: Readonly<
    Record<string, 'portable' | 'node' | 'native' | 'external-tool'>
  >
  /**
   * Repository/build validation sets this so incomplete browser import-graph evidence is an
   * error. Interactive/editor structural validation may omit it and receives a warning instead.
   */
  readonly requireEntrypointRuntimeEvidence?: boolean
}

export interface CodecManifestRepositoryValidationContext extends Omit<
  CodecManifestValidationContext,
  | 'folderName'
  | 'availableEntryPoints'
  | 'entrypointRuntimeKinds'
  | 'requireEntrypointRuntimeEvidence'
> {
  readonly folderName: string
  readonly availableEntryPoints: readonly string[]
  readonly entrypointRuntimeKinds: Readonly<
    Record<string, 'portable' | 'node' | 'native' | 'external-tool'>
  >
}

export interface CodecManifestValidationResult {
  readonly valid: boolean
  readonly diagnostics: readonly CodecManifestDiagnostic[]
  readonly coordinate?: string
  readonly manifest?: CodecManifestV1
}

export interface CodecManifestPrefilterInput {
  readonly sourceKind: AssetSourceKind
  readonly extension?: string
  readonly path?: string
  readonly mimeType?: string
  readonly header?: Uint8Array
  readonly xmlRoot?: string
  readonly parentArtifactIds?: readonly string[]
}

export interface CodecRuntimeTarget {
  readonly environment: CodecRuntimeEnvironment
  readonly operatingSystem: Exclude<CodecOperatingSystem, 'any'>
  readonly architecture: Exclude<CodecArchitecture, 'any'>
  readonly hostCapabilities?: readonly CodecHostCapability[]
  readonly webApis?: readonly CodecWebApi[]
  readonly externalTools?: readonly string[]
  readonly grantedPermissions?: readonly CodecPermissionClass[]
}

export interface CodecRuntimeSelection {
  readonly variantIds: readonly string[]
  readonly capabilities: readonly CodecCapability[]
  readonly operations: readonly string[]
  readonly rejectedVariants: readonly CodecRuntimeRejection[]
}

export interface CodecRuntimeRejection {
  readonly variantId: string
  readonly code:
    | 'explicitly-unavailable'
    | 'environment'
    | 'operating-system'
    | 'architecture'
    | 'invalid-target'
    | 'host-capability'
    | 'web-api'
    | 'external-tool'
    | 'permission'
  readonly message: string
  readonly missing?: readonly string[]
}

const LOCAL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PUBLISHER_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const QUALIFIED_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/
const OPERATION_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

const TOP_LEVEL_KEYS = new Set([
  '$schema',
  'schemaVersion',
  'publisher',
  'id',
  'version',
  'contractVersion',
  'kind',
  'displayName',
  'status',
  'sourceKinds',
  'match',
  'languages',
  'traits',
  'capabilities',
  'runtimeVariants',
  'operations',
  'companions',
  'standards',
  'testedGames',
  'references',
  'limitations',
  'dependencies',
  'featureGroups',
  'contributionConfig',
])

const LANGUAGE_KEYS = new Set(['id', 'aliases', 'extensions', 'filenames', 'filenamePatterns'])

const TRAIT_KEYS = new Set(['id', 'representations', 'state'])

/**
 * The three namespaces an operation ID may come from, and the rule that tells them apart.
 *
 * Measured over the whole catalog on 2026-08-08: 55 distinct operation IDs, of which
 * `ASSET_CAPABILITIES.md` section 5 defined 14, and **86 % of declarations used an ID it never
 * introduced**. The validator checked an ID's *shape* and never its membership of anything, so the
 * divergence was invisible for as long as it lasted.
 *
 * Rewriting the 667 domain declarations onto section 5's list was the obvious repair and is the
 * wrong one: it destroys information. `image.inspect` and `archive.inspect` both collapse to
 * `view.inspect`, and the domain is exactly what those IDs carry. The codecs converged on
 * `<domain>.<verb>` independently and consistently, which is the same evidence-of-convergence
 * argument that makes the trait model credible.
 *
 * So the two vocabularies get distinct namespaces and a stated rule instead. An operation ID is
 * valid when it is:
 *
 * 1. **shared** — a member of {@link ASSET_OPERATION_IDS}. Cross-domain verbs a host can offer
 *    without knowing which domain answered: "validate", "compare", "save as". Closed set.
 * 2. **domain** — `<domain>.<verb>` where `<domain>` is one of {@link CODEC_MANIFEST_KINDS}. Open
 *    in its verbs, closed in its domains. Deliberately not "this codec's own kind": `sc2-map`
 *    (a map) declares `game.launch-map` and the `stormgate` game codec declares `archive.extract`,
 *    and both are right — the domain names the operation's subject, not the declarer.
 * 3. **codec** — `<codecId>.<verb>` where the prefix is *this manifest's own id*. Self-verifying,
 *    so no codec can squat another's namespace. `sc2-strings.translate` is legal on `sc2-strings`
 *    and nowhere else.
 *
 * All 801 declarations in the tree already satisfy this; the rule was latent and unenforced rather
 * than absent, and enforcing it is what stops a fourth vocabulary appearing the same way.
 */
function operationNamespace(
  operationId: string,
  ownId: unknown,
): 'shared' | 'domain' | 'codec' | undefined {
  if ((ASSET_OPERATION_IDS as readonly string[]).includes(operationId)) return 'shared'
  const separator = operationId.indexOf('.')
  if (separator <= 0 || separator === operationId.length - 1) return undefined
  const prefix = operationId.slice(0, separator)
  if (includes(CODEC_MANIFEST_KINDS, prefix)) return 'domain'
  if (typeof ownId === 'string' && prefix === ownId) return 'codec'
  return undefined
}

/**
 * The coarse verbs that can put an asset's data in front of a caller at all.
 *
 * A trait is a claim that a host can obtain this data from the codec. A codec that neither reads
 * nor inspects obtains nothing, so every trait it declared would be unbacked — the same shape of
 * mistake as a declared language that selects no document.
 */
const TRAIT_EVIDENCE_CAPABILITIES: readonly CodecCapability[] = ['read', 'inspect']

const MATCH_KEYS = new Set([
  'extensions',
  'pathGlobs',
  'mimeTypes',
  'magic',
  'xmlRoots',
  'parentArtifacts',
])

const MAGIC_KEYS = new Set(['offset', 'bytes', 'encoding'])
const ENTRYPOINT_KEYS = new Set([
  'detect',
  'runtime',
  'viewer',
  'language',
  'installProbe',
  'worker',
  'node',
  'native',
  'externalTool',
])
const VARIANT_KEYS = new Set([
  'id',
  'availability',
  'unavailableReason',
  'environments',
  'entrypoints',
  'operatingSystems',
  'architectures',
  'requiredHostCapabilities',
  'requiredWebApis',
  'externalTools',
  'permissions',
  'capabilities',
  'operations',
  'companions',
  'standards',
  'testedGames',
  'references',
  'limitations',
  'dependencies',
])
const DEPENDENCY_KEYS = new Set(CODEC_DEPENDENCY_RELATIONS)
const DEPENDENCY_REF_KEYS = new Set(['id', 'range', 'features'])
const CONFLICT_REF_KEYS = new Set(['id', 'range', 'features', 'scope'])
const GAME_FEATURE_GROUP_KEYS = new Set(GAME_CONTRIBUTION_MODES)
const GAME_CONTRIBUTION_CONFIG_KEYS = new Set(['codecId', 'priority', 'sourceScopes'])
const REFERENCE_KEYS = new Set(['title', 'url', 'documentId', 'license'])

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

function isSafeRelativeEntrypoint(value: string): boolean {
  if (!value.startsWith('./') || value.includes('\\')) return false
  const segments = value.slice(2).split('/')
  return segments.length > 0 && segments.every(segment => segment.length > 0 && segment !== '..')
}

function isPrivateIpv4(host: string): boolean {
  const ipv4 = host.split('.').map(segment => Number(segment))
  if (
    ipv4.length !== 4 ||
    !ipv4.every(segment => Number.isInteger(segment) && segment >= 0 && segment <= 255)
  ) {
    return false
  }
  const [first, second] = ipv4 as [number, number, number, number]
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  )
}

function isPublicReferenceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    const rawHost = url.hostname.toLowerCase()
    const ipv6Literal = rawHost.startsWith('[') && rawHost.endsWith(']')
    const host = (ipv6Literal ? rawHost.slice(1, -1) : rawHost).replace(/\.$/, '')
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
      return false
    }
    if (isPrivateIpv4(host)) return false
    if (ipv6Literal) {
      if (
        host === '::' ||
        host === '::1' ||
        host.startsWith('::ffff:') ||
        /^(?:fc|fd|fe[89a-f]|ff)/i.test(host) ||
        host.startsWith('2001:db8:')
      ) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every(value => right.has(value))
}

export function runtimeTargetCompatible(
  environment: string,
  operatingSystem: string,
  architecture: string,
): boolean {
  if (
    !includes(CODEC_RUNTIME_ENVIRONMENTS, environment) ||
    !includes(CODEC_OPERATING_SYSTEMS, operatingSystem) ||
    !includes(CODEC_ARCHITECTURES, architecture) ||
    operatingSystem === 'any' ||
    architecture === 'any'
  ) {
    return false
  }
  if (environment === 'browser-main' || environment === 'browser-worker') {
    return architecture !== 'wasm32'
  }
  if (environment === 'wasm') return architecture === 'wasm32'
  return (
    (operatingSystem === 'windows' ||
      operatingSystem === 'linux' ||
      operatingSystem === 'darwin') &&
    architecture !== 'wasm32'
  )
}

function expandsOperatingSystems(values: readonly string[]): readonly string[] {
  return values.includes('any') ? CODEC_OPERATING_SYSTEMS.filter(value => value !== 'any') : values
}

function expandsArchitectures(values: readonly string[]): readonly string[] {
  return values.includes('any') ? CODEC_ARCHITECTURES.filter(value => value !== 'any') : values
}

function selectsCurrentRuntimeTarget(
  environments: readonly string[],
  operatingSystems: readonly string[],
  architectures: readonly string[],
): boolean {
  return environments.some(environment =>
    expandsOperatingSystems(operatingSystems).some(operatingSystem =>
      expandsArchitectures(architectures).some(architecture =>
        runtimeTargetCompatible(environment, operatingSystem, architecture),
      ),
    ),
  )
}

function globPattern(glob: string): RegExp {
  let pattern = '^'
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob.charAt(index)
    if (character === '*') {
      if (glob[index + 1] === '*') {
        index += 1
        if (glob[index + 1] === '/') {
          index += 1
          pattern += '(?:.*/)?'
        } else {
          pattern += '.*'
        }
      } else {
        pattern += '[^/]*'
      }
    } else if (character === '?') {
      pattern += '[^/]'
    } else {
      pattern += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
    }
  }
  return new RegExp(`${pattern}$`, 'i')
}

function magicBytes(match: CodecManifestMagicMatch): Uint8Array | undefined {
  if (match.encoding === 'ascii') {
    return new TextEncoder().encode(match.bytes)
  }
  const compact = match.bytes.replace(/\s+/g, '')
  if (compact.length === 0 || compact.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(compact)) {
    return undefined
  }
  const bytes = new Uint8Array(compact.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function matchesMagic(header: Uint8Array, match: CodecManifestMagicMatch): boolean {
  const expected = magicBytes(match)
  if (expected === undefined || match.offset + expected.length > header.length) return false
  return expected.every((byte, index) => header[match.offset + index] === byte)
}

/**
 * Applies manifest prefilters conjunctively across declared evidence categories and
 * disjunctively within each category. It is deliberately cheap; codec `detect()` remains the
 * structural authority.
 */
export function matchesCodecManifestPrefilter(
  manifest: Pick<CodecManifestV1, 'sourceKinds' | 'match'>,
  input: CodecManifestPrefilterInput,
): boolean {
  if (!manifest.sourceKinds.includes(input.sourceKind)) return false
  const { match } = manifest
  const normalizedExtension = input.extension?.toLowerCase()
  const normalizedPath = input.path?.replace(/\\/g, '/')
  const normalizedMimeType = input.mimeType?.split(';', 1)[0]?.trim().toLowerCase()
  const header = input.header
  if (
    match.extensions !== undefined &&
    (normalizedExtension === undefined ||
      !match.extensions.some(extension => extension.toLowerCase() === normalizedExtension))
  ) {
    return false
  }
  if (
    match.pathGlobs !== undefined &&
    (normalizedPath === undefined ||
      !match.pathGlobs.some(glob => globPattern(glob).test(normalizedPath)))
  ) {
    return false
  }
  if (
    match.mimeTypes !== undefined &&
    (normalizedMimeType === undefined ||
      !match.mimeTypes.some(mimeType => mimeType.toLowerCase() === normalizedMimeType))
  ) {
    return false
  }
  if (
    match.magic !== undefined &&
    (header === undefined || !match.magic.some(magicMatch => matchesMagic(header, magicMatch)))
  ) {
    return false
  }
  if (
    match.xmlRoots !== undefined &&
    (input.xmlRoot === undefined || !match.xmlRoots.includes(input.xmlRoot))
  ) {
    return false
  }
  if (
    match.parentArtifacts !== undefined &&
    (input.parentArtifactIds === undefined ||
      !match.parentArtifacts.some(parent => input.parentArtifactIds?.includes(parent)))
  ) {
    return false
  }
  return true
}

/**
 * Selects the runtime variants usable by one concrete host target and derives that host's
 * capability/operation view. An unavailable variant never contributes runtime claims.
 */
export function selectCodecRuntimeVariants(
  manifest: Pick<CodecManifestV1, 'runtimeVariants'>,
  target: CodecRuntimeTarget,
): CodecRuntimeSelection {
  const hostCapabilities = new Set(target.hostCapabilities ?? [])
  const webApis = new Set(target.webApis ?? [])
  const externalTools = new Set(target.externalTools ?? [])
  const grantedPermissions = new Set(target.grantedPermissions ?? [])
  const variants: CodecRuntimeVariant[] = []
  const rejectedVariants: CodecRuntimeRejection[] = []
  const reject = (
    variant: CodecRuntimeVariant,
    code: CodecRuntimeRejection['code'],
    message: string,
    missing?: readonly string[],
  ): void => {
    rejectedVariants.push({
      variantId: variant.id,
      code,
      message,
      ...(missing === undefined ? {} : { missing }),
    })
  }

  for (const variant of manifest.runtimeVariants) {
    if (variant.availability === 'unavailable') {
      reject(
        variant,
        'explicitly-unavailable',
        variant.unavailableReason ?? 'Runtime variant is explicitly unavailable.',
      )
      continue
    }
    if (!variant.environments.includes(target.environment)) {
      reject(
        variant,
        'environment',
        `Runtime variant does not support environment '${target.environment}'.`,
      )
      continue
    }
    if (
      !variant.operatingSystems.includes('any') &&
      !variant.operatingSystems.includes(target.operatingSystem)
    ) {
      reject(
        variant,
        'operating-system',
        `Runtime variant does not support operating system '${target.operatingSystem}'.`,
      )
      continue
    }
    if (
      !variant.architectures.includes('any') &&
      !variant.architectures.includes(target.architecture)
    ) {
      reject(
        variant,
        'architecture',
        `Runtime variant does not support architecture '${target.architecture}'.`,
      )
      continue
    }
    if (!runtimeTargetCompatible(target.environment, target.operatingSystem, target.architecture)) {
      reject(
        variant,
        'invalid-target',
        'The requested environment, operating system, and architecture do not form a current host target.',
      )
      continue
    }

    const missingHostCapabilities = (variant.requiredHostCapabilities ?? []).filter(
      capability => !hostCapabilities.has(capability),
    )
    if (missingHostCapabilities.length > 0) {
      reject(
        variant,
        'host-capability',
        'Runtime variant requires unavailable host capabilities.',
        missingHostCapabilities,
      )
      continue
    }
    const missingWebApis = (variant.requiredWebApis ?? []).filter(api => !webApis.has(api))
    if (missingWebApis.length > 0) {
      reject(variant, 'web-api', 'Runtime variant requires unavailable Web APIs.', missingWebApis)
      continue
    }
    const missingExternalTools = (variant.externalTools ?? []).filter(
      tool => !externalTools.has(tool),
    )
    if (missingExternalTools.length > 0) {
      reject(
        variant,
        'external-tool',
        'Runtime variant requires unavailable external tools.',
        missingExternalTools,
      )
      continue
    }
    const missingPermissions = (variant.permissions ?? []).filter(
      permission => !grantedPermissions.has(permission),
    )
    if (missingPermissions.length > 0) {
      reject(
        variant,
        'permission',
        'Runtime variant requires permissions not granted by the host.',
        missingPermissions,
      )
      continue
    }
    variants.push(variant)
  }

  return {
    variantIds: variants.map(variant => variant.id),
    capabilities: [...new Set(variants.flatMap(variant => variant.capabilities))],
    operations: [...new Set(variants.flatMap(variant => variant.operations ?? []))],
    rejectedVariants,
  }
}

export function codecManifestCoordinate(
  manifest: Pick<CodecManifestV1, 'publisher' | 'id'>,
): string {
  return `${manifest.publisher}/${manifest.id}`
}

export function validateCodecManifest(
  value: unknown,
  context: CodecManifestValidationContext = {},
): CodecManifestValidationResult {
  const diagnostics: CodecManifestDiagnostic[] = []
  const manifestIdCandidate = isRecord(value) ? value['id'] : undefined

  const report = (
    code: string,
    path: string,
    message: string,
    severity: CodecManifestDiagnosticSeverity = 'error',
  ): void => {
    diagnostics.push({ code, path, message, severity })
  }

  const knownKeys = (
    object: Readonly<Record<string, unknown>>,
    allowed: ReadonlySet<string>,
    path: string,
  ): void => {
    for (const key of Object.keys(object)) {
      if (!allowed.has(key)) {
        report('codec-manifest.unknown-field', `${path}/${key}`, `Unknown field '${key}'.`)
      }
    }
  }

  const requiredString = (
    object: Readonly<Record<string, unknown>>,
    key: string,
    path: string,
  ): string | undefined => {
    const candidate = object[key]
    if (typeof candidate !== 'string' || candidate.length === 0) {
      report(
        'codec-manifest.required-string',
        `${path}/${key}`,
        `Field '${key}' must be a non-empty string.`,
      )
      return undefined
    }
    return candidate
  }

  const stringArray = (
    candidate: unknown,
    path: string,
    options: {
      readonly required?: boolean
      readonly allowEmpty?: boolean
      readonly allowed?: readonly string[]
      readonly pattern?: RegExp
    } = {},
  ): readonly string[] | undefined => {
    if (candidate === undefined && options.required !== true) return undefined
    if (!Array.isArray(candidate)) {
      report('codec-manifest.string-array', path, 'Expected an array of strings.')
      return undefined
    }
    if (candidate.length === 0 && options.allowEmpty !== true) {
      report('codec-manifest.empty-array', path, 'Array must contain at least one value.')
    }
    const result: string[] = []
    const seen = new Set<string>()
    candidate.forEach((entry, index) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        report('codec-manifest.string-array', `${path}/${index}`, 'Expected a non-empty string.')
        return
      }
      result.push(entry)
      if (seen.has(entry)) {
        report('codec-manifest.duplicate-value', `${path}/${index}`, `Duplicate value '${entry}'.`)
      }
      seen.add(entry)
      if (options.allowed !== undefined && !options.allowed.includes(entry)) {
        report('codec-manifest.unknown-enum-value', `${path}/${index}`, `Unknown value '${entry}'.`)
      }
      if (options.pattern !== undefined && !options.pattern.test(entry)) {
        report(
          'codec-manifest.invalid-id',
          `${path}/${index}`,
          `Value '${entry}' does not use a stable lowercase ID.`,
        )
      }
    })
    return result
  }

  const checkOperationNamespaces = (operations: readonly string[], path: string): void => {
    operations.forEach((operation, index) => {
      if (operationNamespace(operation, manifestIdCandidate) !== undefined) return
      report(
        'codec-manifest.operation-namespace',
        `${path}/${index}`,
        `Operation '${operation}' belongs to no declared namespace. It must be a shared ID from ` +
          `ASSET_CAPABILITIES.md section 5, or '<domain>.<verb>' with a domain from ` +
          `[${CODEC_MANIFEST_KINDS.join(', ')}], or '${String(manifestIdCandidate)}.<verb>' in this ` +
          `codec's own namespace.`,
      )
    })
  }

  const validateReferences = (candidate: unknown, path: string): void => {
    if (candidate === undefined) return
    if (!Array.isArray(candidate)) {
      report('codec-manifest.references', path, 'References must be an array.')
      return
    }
    if (candidate.length === 0) {
      report('codec-manifest.empty-array', path, 'References must contain at least one entry.')
    }
    candidate.forEach((entry, index) => {
      const entryPath = `${path}/${index}`
      if (!isRecord(entry)) {
        report('codec-manifest.reference', entryPath, 'Reference must be an object.')
        return
      }
      knownKeys(entry, REFERENCE_KEYS, entryPath)
      requiredString(entry, 'title', entryPath)
      const url = entry['url']
      const documentId = entry['documentId']
      if (url === undefined && documentId === undefined) {
        report(
          'codec-manifest.reference-target',
          entryPath,
          'Reference requires either a public URL or repository documentId.',
        )
      }
      if (url !== undefined && (typeof url !== 'string' || !isPublicReferenceUrl(url))) {
        report(
          'codec-manifest.private-reference',
          `${entryPath}/url`,
          'Reference URL must be a public HTTP(S) URL.',
        )
      }
      if (
        documentId !== undefined &&
        (typeof documentId !== 'string' ||
          !documentId.startsWith('docs/') ||
          documentId.includes('..'))
      ) {
        report(
          'codec-manifest.document-reference',
          `${entryPath}/documentId`,
          'Repository documentId must stay under docs/ and may not contain parent traversal.',
        )
      }
      if (entry['license'] !== undefined && typeof entry['license'] !== 'string') {
        report(
          'codec-manifest.reference-license',
          `${entryPath}/license`,
          'Reference license must be a string.',
        )
      }
    })
  }

  const validateDependencyRefs = (
    candidate: unknown,
    path: string,
    conflict: boolean,
    requireEntries = false,
  ): void => {
    if (candidate === undefined) return
    if (!Array.isArray(candidate)) {
      report('codec-manifest.dependencies', path, 'Dependency relation must be an array.')
      return
    }
    if (requireEntries && candidate.length === 0) {
      report(
        'codec-manifest.empty-array',
        path,
        'Game feature-group dependency relation must contain at least one codec.',
      )
    }
    const seen = new Set<string>()
    candidate.forEach((entry, index) => {
      const entryPath = `${path}/${index}`
      if (!isRecord(entry)) {
        report('codec-manifest.dependency', entryPath, 'Dependency must be an object.')
        return
      }
      knownKeys(entry, conflict ? CONFLICT_REF_KEYS : DEPENDENCY_REF_KEYS, entryPath)
      const id = requiredString(entry, 'id', entryPath)
      const range = requiredString(entry, 'range', entryPath)
      if (id !== undefined && !QUALIFIED_ID_PATTERN.test(id)) {
        report(
          'codec-manifest.dependency-id',
          `${entryPath}/id`,
          `Dependency '${id}' must use a qualified publisher/local-id coordinate.`,
        )
      }
      if (id !== undefined && seen.has(id)) {
        report(
          'codec-manifest.duplicate-dependency',
          `${entryPath}/id`,
          `Dependency '${id}' is duplicated in this relation.`,
        )
      }
      if (id !== undefined) seen.add(id)
      if (range !== undefined && range.trim().length === 0) {
        report(
          'codec-manifest.dependency-range',
          `${entryPath}/range`,
          'Dependency range must not be empty.',
        )
      }
      stringArray(entry['features'], `${entryPath}/features`, {
        allowEmpty: false,
        pattern: LOCAL_ID_PATTERN,
      })
      if (
        conflict &&
        entry['scope'] !== undefined &&
        (typeof entry['scope'] !== 'string' || !includes(CODEC_CONFLICT_SCOPES, entry['scope']))
      ) {
        report(
          'codec-manifest.conflict-scope',
          `${entryPath}/scope`,
          'Conflict scope is not supported.',
        )
      }
    })
  }

  const validateDependencies = (candidate: unknown, path: string): void => {
    if (candidate === undefined) return
    if (!isRecord(candidate)) {
      report('codec-manifest.dependencies', path, 'Dependencies must be an object.')
      return
    }
    knownKeys(candidate, DEPENDENCY_KEYS, path)
    for (const relation of CODEC_DEPENDENCY_RELATIONS) {
      const relationPath = `${path}/${relation}`
      if (relation === 'provides') {
        stringArray(candidate[relation], relationPath, {
          allowEmpty: true,
          pattern: /^[a-z0-9]+(?::[a-z0-9-]+)+$/,
        })
      } else {
        validateDependencyRefs(candidate[relation], relationPath, relation === 'conflicts')
      }
    }
  }

  const validateGameFeatureGroups = (candidate: unknown, path: string): void => {
    if (!isRecord(candidate)) {
      report(
        'codec-manifest.game-feature-groups',
        path,
        'Game manifests must declare a featureGroups object.',
      )
      return
    }
    const entries = Object.entries(candidate)
    if (entries.length === 0) {
      report(
        'codec-manifest.game-feature-groups',
        path,
        'Game manifests must declare at least one feature group.',
      )
    }
    for (const [groupId, group] of entries) {
      const groupPath = `${path}/${groupId}`
      if (!LOCAL_ID_PATTERN.test(groupId)) {
        report(
          'codec-manifest.game-feature-group-id',
          groupPath,
          `Feature-group ID '${groupId}' must use a stable lowercase local ID.`,
        )
      }
      if (!isRecord(group)) {
        report(
          'codec-manifest.game-feature-group',
          groupPath,
          'Game feature group must be an object.',
        )
        continue
      }
      knownKeys(group, GAME_FEATURE_GROUP_KEYS, groupPath)
      if (Object.keys(group).length === 0) {
        report(
          'codec-manifest.game-feature-group',
          groupPath,
          'Game feature group must declare at least one dependency relation.',
        )
      }
      for (const relation of GAME_CONTRIBUTION_MODES) {
        validateDependencyRefs(group[relation], `${groupPath}/${relation}`, false, true)
      }
    }
  }

  const validateGameContributionConfig = (candidate: unknown, path: string): void => {
    if (candidate === undefined) return
    if (!Array.isArray(candidate)) {
      report(
        'codec-manifest.game-contribution-config',
        path,
        'Game contributionConfig must be an array.',
      )
      return
    }
    if (candidate.length === 0) {
      report(
        'codec-manifest.game-contribution-config',
        path,
        'Game contributionConfig must contain at least one codec configuration.',
      )
    }
    const seen = new Set<string>()
    candidate.forEach((entry, index) => {
      const entryPath = `${path}/${index}`
      if (!isRecord(entry)) {
        report(
          'codec-manifest.game-contribution',
          entryPath,
          'Game contribution configuration must be an object.',
        )
        return
      }
      knownKeys(entry, GAME_CONTRIBUTION_CONFIG_KEYS, entryPath)
      const codecId = requiredString(entry, 'codecId', entryPath)
      if (codecId !== undefined && !QUALIFIED_ID_PATTERN.test(codecId)) {
        report(
          'codec-manifest.game-contribution-id',
          `${entryPath}/codecId`,
          `Contribution codec '${codecId}' must use a qualified publisher/local-id coordinate.`,
        )
      }
      if (codecId !== undefined && seen.has(codecId)) {
        report(
          'codec-manifest.duplicate-game-contribution',
          `${entryPath}/codecId`,
          `Contribution codec '${codecId}' is duplicated in contributionConfig.`,
        )
      }
      if (codecId !== undefined) seen.add(codecId)
      if (!Number.isSafeInteger(entry['priority'])) {
        report(
          'codec-manifest.game-contribution-priority',
          `${entryPath}/priority`,
          'Game contribution priority must be an integer.',
        )
      }
      stringArray(entry['sourceScopes'], `${entryPath}/sourceScopes`, {
        required: true,
        pattern: LOCAL_ID_PATTERN,
      })
    })
  }

  if (!isRecord(value)) {
    report('codec-manifest.object-required', '/', 'Codec manifest must be an object.')
    return { valid: false, diagnostics }
  }

  const manifestKind = value['kind']
  knownKeys(value, TOP_LEVEL_KEYS, '')

  if (value['schemaVersion'] !== CODEC_MANIFEST_SCHEMA_VERSION) {
    report(
      'codec-manifest.schema-version',
      '/schemaVersion',
      `schemaVersion must be ${CODEC_MANIFEST_SCHEMA_VERSION}.`,
    )
  }
  if (value['$schema'] !== undefined && typeof value['$schema'] !== 'string') {
    report('codec-manifest.schema-uri', '/$schema', '$schema must be a string.')
  }

  const publisher = requiredString(value, 'publisher', '')
  const id = requiredString(value, 'id', '')
  const version = requiredString(value, 'version', '')
  requiredString(value, 'displayName', '')

  if (publisher !== undefined && !PUBLISHER_PATTERN.test(publisher)) {
    report(
      'codec-manifest.publisher',
      '/publisher',
      'Publisher must use lowercase dot/dash-separated segments.',
    )
  }
  if (id !== undefined && !LOCAL_ID_PATTERN.test(id)) {
    report('codec-manifest.local-id', '/id', 'Codec ID must use lowercase dash-separated segments.')
  }
  if (id !== undefined && context.folderName !== undefined && context.folderName !== id) {
    report(
      'codec-manifest.folder-id',
      '/id',
      `Codec ID '${id}' does not match containing folder '${context.folderName}'.`,
    )
  }
  if (version !== undefined && !SEMVER_PATTERN.test(version)) {
    report('codec-manifest.version', '/version', 'Version must be valid SemVer.')
  }
  if (!Number.isSafeInteger(value['contractVersion']) || (value['contractVersion'] as number) < 1) {
    report(
      'codec-manifest.contract-version',
      '/contractVersion',
      'contractVersion must be a positive integer.',
    )
  }
  if (typeof value['kind'] !== 'string' || !includes(CODEC_MANIFEST_KINDS, value['kind'])) {
    report('codec-manifest.kind', '/kind', 'Codec kind is not supported.')
  }
  if (typeof value['status'] !== 'string' || !includes(CODEC_SUPPORT_STATUSES, value['status'])) {
    report('codec-manifest.status', '/status', 'Codec support status is not supported.')
  }

  const sourceKinds = stringArray(value['sourceKinds'], '/sourceKinds', { required: true })
  sourceKinds?.forEach((sourceKind, index) => {
    if (!isKnownAssetSourceKind(sourceKind)) {
      report(
        'codec-manifest.source-kind',
        `/sourceKinds/${index}`,
        `Unknown source kind '${sourceKind}'. Expected one of ${ASSET_SOURCE_KINDS.join(', ')}.`,
      )
    }
  })

  if (!isRecord(value['match'])) {
    report('codec-manifest.match', '/match', 'Match prefilter must be an object.')
  } else {
    const match = value['match']
    knownKeys(match, MATCH_KEYS, '/match')
    stringArray(match['extensions'], '/match/extensions')
    stringArray(match['pathGlobs'], '/match/pathGlobs')
    stringArray(match['mimeTypes'], '/match/mimeTypes')
    stringArray(match['xmlRoots'], '/match/xmlRoots')
    stringArray(match['parentArtifacts'], '/match/parentArtifacts', {
      pattern: LOCAL_ID_PATTERN,
    })
    if (match['magic'] !== undefined) {
      if (!Array.isArray(match['magic'])) {
        report('codec-manifest.magic', '/match/magic', 'Magic prefilters must be an array.')
      } else {
        match['magic'].forEach((entry, index) => {
          const entryPath = `/match/magic/${index}`
          if (!isRecord(entry)) {
            report('codec-manifest.magic', entryPath, 'Magic prefilter must be an object.')
            return
          }
          knownKeys(entry, MAGIC_KEYS, entryPath)
          if (!Number.isSafeInteger(entry['offset']) || (entry['offset'] as number) < 0) {
            report(
              'codec-manifest.magic-offset',
              `${entryPath}/offset`,
              'Magic offset must be a non-negative integer.',
            )
          }
          const bytes = requiredString(entry, 'bytes', entryPath)
          const encoding = entry['encoding']
          if (encoding !== 'hex' && encoding !== 'ascii') {
            report(
              'codec-manifest.magic-encoding',
              `${entryPath}/encoding`,
              "Magic encoding must be 'hex' or 'ascii'.",
            )
          } else if (bytes !== undefined) {
            const validBytes =
              encoding === 'hex'
                ? /^(?:[0-9a-f]{2})(?:\s*[0-9a-f]{2})*$/i.test(bytes)
                : [...bytes].every(character => character.charCodeAt(0) <= 0x7f)
            if (!validBytes) {
              report(
                'codec-manifest.magic-bytes',
                `${entryPath}/bytes`,
                encoding === 'hex'
                  ? 'Hex magic must contain complete hexadecimal byte pairs.'
                  : 'ASCII magic may contain only 7-bit ASCII characters.',
              )
            }
          }
        })
      }
    }
    if (
      sourceKinds?.some(sourceKind => sourceKind === 'file' || sourceKind === 'archive-entry') &&
      Object.values(match).every(candidate => !Array.isArray(candidate) || candidate.length === 0)
    ) {
      report(
        'codec-manifest.match-evidence',
        '/match',
        'File and archive-entry codecs require at least one declarative match prefilter.',
      )
    }
  }

  if (value['languages'] !== undefined) {
    if (!Array.isArray(value['languages']) || value['languages'].length === 0) {
      report(
        'codec-manifest.languages',
        '/languages',
        'Declared languages must be a non-empty array.',
      )
    } else {
      value['languages'].forEach((entry, index) => {
        const entryPath = `/languages/${index}`
        if (!isRecord(entry)) {
          report('codec-manifest.languages', entryPath, 'Declared language must be an object.')
          return
        }
        knownKeys(entry, LANGUAGE_KEYS, entryPath)
        requiredString(entry, 'id', entryPath)
        stringArray(entry['aliases'], `${entryPath}/aliases`)
        stringArray(entry['extensions'], `${entryPath}/extensions`)
        stringArray(entry['filenames'], `${entryPath}/filenames`)
        stringArray(entry['filenamePatterns'], `${entryPath}/filenamePatterns`)
        // A language with no association selects nothing, so it can only be a mistake — and it is
        // one a host cannot report, because by then the entry has already become a manifest edit
        // nobody can explain.
        if (
          !['extensions', 'filenames', 'filenamePatterns'].some(
            key => Array.isArray(entry[key]) && (entry[key] as unknown[]).length > 0,
          )
        ) {
          report(
            'codec-manifest.language-association',
            entryPath,
            'A declared language needs at least one of extensions, filenames or filenamePatterns.',
          )
        }
      })
    }
  }

  const topCapabilities =
    stringArray(value['capabilities'], '/capabilities', {
      required: true,
      allowEmpty: value['status'] === 'unsupported',
      allowed: CODEC_CAPABILITIES,
    }) ?? []
  if (value['traits'] !== undefined) {
    if (!Array.isArray(value['traits']) || value['traits'].length === 0) {
      report('codec-manifest.traits', '/traits', 'Declared traits must be a non-empty array.')
    } else {
      // Evidence gate, checked once for the block rather than per entry. `ASSET_CAPABILITIES.md`
      // section 5's vocabulary drifted for as long as it did because the validator checked an
      // operation ID's *shape* and never its backing, so a trait that nothing supports is rejected
      // here rather than accepted and discovered by a host at load time.
      if (value['status'] === 'unsupported') {
        report(
          'codec-manifest.trait-evidence',
          '/traits',
          "A codec with status 'unsupported' has no implementation to read a trait from. " +
            'Declare traits when the format is implemented.',
        )
      } else if (
        !TRAIT_EVIDENCE_CAPABILITIES.some(capability => topCapabilities.includes(capability))
      ) {
        report(
          'codec-manifest.trait-evidence',
          '/traits',
          `A codec declaring traits must declare at least one of ${TRAIT_EVIDENCE_CAPABILITIES.join(
            ' or ',
          )} among its capabilities — a trait is data a host can obtain, and neither reading ` +
            'nor inspecting obtains anything.',
        )
      }
      const seenTraits = new Set<string>()
      value['traits'].forEach((entry, index) => {
        const entryPath = `/traits/${index}`
        if (!isRecord(entry)) {
          report('codec-manifest.traits', entryPath, 'Declared trait must be an object.')
          return
        }
        knownKeys(entry, TRAIT_KEYS, entryPath)
        const id = entry['id']
        if (typeof id !== 'string' || !includes(CAPABILITY_IDS, id)) {
          report(
            'codec-manifest.trait-id',
            `${entryPath}/id`,
            `Unknown trait '${String(id)}'. Traits come from ASSET_CAPABILITIES.md section 4; ` +
              'adding one means adding it there and to CAPABILITY_IDS first.',
          )
        } else if (seenTraits.has(id)) {
          report('codec-manifest.trait-duplicate', `${entryPath}/id`, `Duplicate trait '${id}'.`)
        } else {
          seenTraits.add(id)
        }
        stringArray(entry['representations'], `${entryPath}/representations`, {
          required: true,
          allowEmpty: false,
          allowed: CODEC_TRAIT_REPRESENTATIONS,
        })
        const state = entry['state']
        if (state !== undefined && !includes(CODEC_TRAIT_STATES, state as string)) {
          report(
            'codec-manifest.trait-state',
            `${entryPath}/state`,
            `Trait state must be one of ${CODEC_TRAIT_STATES.join(', ')}.`,
          )
        }
      })
    }
  }

  const topOperations =
    stringArray(value['operations'], '/operations', {
      allowEmpty: false,
      pattern: OPERATION_ID_PATTERN,
    }) ?? []
  checkOperationNamespaces(topOperations, '/operations')
  stringArray(value['companions'], '/companions', {
    allowEmpty: false,
    pattern: LOCAL_ID_PATTERN,
  })
  stringArray(value['standards'], '/standards', {
    allowEmpty: false,
    pattern: /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
  })
  stringArray(value['testedGames'], '/testedGames', {
    allowEmpty: false,
    pattern: LOCAL_ID_PATTERN,
  })
  stringArray(value['limitations'], '/limitations')
  validateReferences(value['references'], '/references')
  validateDependencies(value['dependencies'], '/dependencies')
  if (value['kind'] === 'game') {
    validateGameFeatureGroups(value['featureGroups'], '/featureGroups')
    if (value['contributionConfig'] !== undefined) {
      validateGameContributionConfig(value['contributionConfig'], '/contributionConfig')
    }
  } else {
    if (value['featureGroups'] !== undefined) {
      report(
        'codec-manifest.game-only-field',
        '/featureGroups',
        'featureGroups is only valid for game manifests.',
      )
    }
    if (value['contributionConfig'] !== undefined) {
      report(
        'codec-manifest.game-only-field',
        '/contributionConfig',
        'contributionConfig is only valid for game manifests.',
      )
    }
  }

  const variantCapabilities = new Set<string>()
  const variantOperations = new Set<string>()
  if (!Array.isArray(value['runtimeVariants']) || value['runtimeVariants'].length === 0) {
    report(
      'codec-manifest.runtime-variants',
      '/runtimeVariants',
      'At least one runtime variant is required.',
    )
  } else {
    const variantIds = new Set<string>()
    value['runtimeVariants'].forEach((entry, index) => {
      const path = `/runtimeVariants/${index}`
      if (!isRecord(entry)) {
        report('codec-manifest.runtime-variant', path, 'Runtime variant must be an object.')
        return
      }
      knownKeys(entry, VARIANT_KEYS, path)
      const variantId = requiredString(entry, 'id', path)
      if (variantId !== undefined && !LOCAL_ID_PATTERN.test(variantId)) {
        report(
          'codec-manifest.variant-id',
          `${path}/id`,
          'Runtime variant ID must use lowercase dash-separated segments.',
        )
      }
      if (variantId !== undefined && variantIds.has(variantId)) {
        report(
          'codec-manifest.duplicate-variant',
          `${path}/id`,
          `Runtime variant '${variantId}' is duplicated.`,
        )
      }
      if (variantId !== undefined) variantIds.add(variantId)

      const environments =
        stringArray(entry['environments'], `${path}/environments`, {
          required: true,
          allowed: CODEC_RUNTIME_ENVIRONMENTS,
        }) ?? []
      const operatingSystems =
        stringArray(entry['operatingSystems'], `${path}/operatingSystems`, {
          required: true,
          allowed: CODEC_OPERATING_SYSTEMS,
        }) ?? []
      const architectures =
        stringArray(entry['architectures'], `${path}/architectures`, {
          required: true,
          allowed: CODEC_ARCHITECTURES,
        }) ?? []
      const availability = entry['availability']
      const unavailableReason = entry['unavailableReason']
      const explicitlyUnavailable = availability === 'unavailable'
      if (
        availability !== undefined &&
        (typeof availability !== 'string' || !includes(CODEC_RUNTIME_AVAILABILITY, availability))
      ) {
        report(
          'codec-manifest.runtime-availability',
          `${path}/availability`,
          'Runtime availability must be available or unavailable.',
        )
      }
      if (
        explicitlyUnavailable &&
        (typeof unavailableReason !== 'string' || unavailableReason.trim().length === 0)
      ) {
        report(
          'codec-manifest.unavailable-reason',
          `${path}/unavailableReason`,
          'An unavailable runtime variant must explain why it is unavailable.',
        )
      } else if (!explicitlyUnavailable && unavailableReason !== undefined) {
        report(
          'codec-manifest.unavailable-reason',
          `${path}/unavailableReason`,
          'unavailableReason is only valid when availability is unavailable.',
        )
      }
      if (operatingSystems.includes('any') && operatingSystems.length > 1) {
        report(
          'codec-manifest.ambiguous-target',
          `${path}/operatingSystems`,
          "Operating system 'any' cannot be combined with specific operating systems.",
        )
      }
      if (architectures.includes('any') && architectures.length > 1) {
        report(
          'codec-manifest.ambiguous-target',
          `${path}/architectures`,
          "Architecture 'any' cannot be combined with specific architectures.",
        )
      }
      const hostCapabilities =
        stringArray(entry['requiredHostCapabilities'], `${path}/requiredHostCapabilities`, {
          allowed: CODEC_HOST_CAPABILITIES,
        }) ?? []
      stringArray(entry['requiredWebApis'], `${path}/requiredWebApis`, {
        allowed: CODEC_WEB_APIS,
      })
      const externalTools = stringArray(entry['externalTools'], `${path}/externalTools`) ?? []
      const permissions =
        stringArray(entry['permissions'], `${path}/permissions`, {
          allowed: CODEC_PERMISSION_CLASSES,
        }) ?? []
      const capabilities =
        stringArray(entry['capabilities'], `${path}/capabilities`, {
          required: true,
          allowEmpty: explicitlyUnavailable,
          allowed: CODEC_CAPABILITIES,
        }) ?? []
      capabilities.forEach(capability => variantCapabilities.add(capability))
      const operations =
        stringArray(entry['operations'], `${path}/operations`, {
          pattern: OPERATION_ID_PATTERN,
        }) ?? []
      checkOperationNamespaces(operations, `${path}/operations`)
      operations.forEach(operation => variantOperations.add(operation))
      stringArray(entry['companions'], `${path}/companions`, {
        pattern: LOCAL_ID_PATTERN,
      })
      stringArray(entry['standards'], `${path}/standards`, {
        pattern: /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
      })
      stringArray(entry['testedGames'], `${path}/testedGames`, {
        pattern: LOCAL_ID_PATTERN,
      })
      stringArray(entry['limitations'], `${path}/limitations`)
      validateReferences(entry['references'], `${path}/references`)
      validateDependencies(entry['dependencies'], `${path}/dependencies`)

      if (!isRecord(entry['entrypoints'])) {
        report(
          'codec-manifest.entrypoints',
          `${path}/entrypoints`,
          'Runtime variant entrypoints must be an object.',
        )
      } else {
        const entrypoints = entry['entrypoints']
        knownKeys(entrypoints, ENTRYPOINT_KEYS, `${path}/entrypoints`)
        if (entrypoints['installProbe'] !== undefined && manifestKind !== 'game') {
          report(
            'codec-manifest.install-probe-kind',
            `${path}/entrypoints/installProbe`,
            'Only a game manifest can declare an installation probe entrypoint.',
          )
        }
        const declaredEntrypoints = Object.entries(entrypoints)
        if (declaredEntrypoints.length === 0 && !explicitlyUnavailable) {
          report(
            'codec-manifest.entrypoints',
            `${path}/entrypoints`,
            'An available runtime variant must declare at least one entrypoint.',
          )
        }
        for (const [entrypointKind, entrypoint] of declaredEntrypoints) {
          const entrypointPath = `${path}/entrypoints/${entrypointKind}`
          if (typeof entrypoint !== 'string' || !isSafeRelativeEntrypoint(entrypoint)) {
            report(
              'codec-manifest.entrypoint-path',
              entrypointPath,
              'Entrypoint must be a safe manifest-relative ./ path.',
            )
            continue
          }
          if (
            context.availableEntryPoints !== undefined &&
            !context.availableEntryPoints.includes(entrypoint)
          ) {
            report(
              'codec-manifest.entrypoint-missing',
              entrypointPath,
              `Declared entrypoint '${entrypoint}' does not exist in the supplied source/build inventory.`,
            )
          }
        }

        const browserVariant = environments.some(environment => environment.startsWith('browser-'))
        if (
          browserVariant &&
          (entrypoints['node'] !== undefined ||
            entrypoints['native'] !== undefined ||
            entrypoints['externalTool'] !== undefined ||
            entrypoints['installProbe'] !== undefined ||
            externalTools.length > 0 ||
            hostCapabilities.includes('native-filesystem') ||
            hostCapabilities.includes('process-launch') ||
            permissions.includes('native-code') ||
            permissions.includes('process-launch'))
        ) {
          report(
            'codec-manifest.browser-runtime-boundary',
            path,
            'Browser runtime variants cannot reach Node, native, process-launch, or external-tool entries.',
          )
        }

        const requiresOneOf = (
          environment: CodecRuntimeEnvironment,
          acceptedEntrypoints: readonly (keyof CodecManifestEntrypoints)[],
        ): void => {
          if (
            environments.includes(environment) &&
            !acceptedEntrypoints.some(entrypoint => entrypoints[entrypoint] !== undefined)
          ) {
            report(
              'codec-manifest.runtime-entrypoint',
              `${path}/entrypoints`,
              `Environment '${environment}' requires one of: ${acceptedEntrypoints.join(', ')}.`,
            )
          }
        }

        if (!explicitlyUnavailable) {
          requiresOneOf('browser-main', ['runtime', 'viewer', 'detect'])
          requiresOneOf('browser-worker', ['runtime', 'worker', 'detect'])
          requiresOneOf('node', ['runtime', 'node', 'detect', 'installProbe'])
          requiresOneOf('node-worker', ['runtime', 'node', 'worker', 'detect'])
          requiresOneOf('wasm', ['runtime', 'worker', 'detect'])
          requiresOneOf('native', ['runtime', 'native'])
          requiresOneOf('external-tool', ['runtime', 'externalTool'])
        }

        if (
          !explicitlyUnavailable &&
          environments.includes('external-tool') &&
          externalTools.length === 0
        ) {
          report(
            'codec-manifest.external-tool-runtime',
            `${path}/externalTools`,
            'An external-tool runtime must name at least one required tool.',
          )
        }

        if (
          !explicitlyUnavailable &&
          environments.length > 0 &&
          operatingSystems.length > 0 &&
          architectures.length > 0 &&
          !selectsCurrentRuntimeTarget(environments, operatingSystems, architectures)
        ) {
          report(
            'codec-manifest.unavailable-target',
            path,
            'Runtime environment, operating-system, and architecture constraints do not select a current host target; mark the variant unavailable explicitly.',
          )
        }

        if (browserVariant) {
          let emittedUnverifiedDiagnostic = false
          for (const [entrypointKind, entrypoint] of declaredEntrypoints) {
            if (typeof entrypoint !== 'string' || !isSafeRelativeEntrypoint(entrypoint)) continue
            const runtimeKind = context.entrypointRuntimeKinds?.[entrypoint]
            if (runtimeKind === undefined) {
              if (!emittedUnverifiedDiagnostic) {
                report(
                  'codec-manifest.browser-reachability-unverified',
                  path,
                  'Browser entrypoint reachability was not supplied by the build/import-graph validator.',
                  context.requireEntrypointRuntimeEvidence === true ? 'error' : 'warning',
                )
                emittedUnverifiedDiagnostic = true
              }
            } else if (runtimeKind !== 'portable') {
              report(
                'codec-manifest.browser-entrypoint-reachability',
                `${path}/entrypoints/${entrypointKind}`,
                `Browser entrypoint '${entrypoint}' reaches ${runtimeKind} code.`,
              )
            }
          }
        }
      }
    })
  }

  if (!sameSet(new Set(topCapabilities), variantCapabilities)) {
    report(
      'codec-manifest.capability-union',
      '/capabilities',
      'Top-level capabilities must exactly equal the union of runtime variant capabilities.',
    )
  }
  if (!sameSet(new Set(topOperations), variantOperations)) {
    report(
      'codec-manifest.operation-union',
      '/operations',
      'Top-level operations must exactly equal the union of runtime variant operations.',
    )
  }

  const valid = diagnostics.every(diagnostic => diagnostic.severity !== 'error')
  if (!valid) return { valid, diagnostics }

  const manifest = value as unknown as CodecManifestV1
  return {
    valid,
    diagnostics,
    manifest,
    coordinate: codecManifestCoordinate(manifest),
  }
}

/** Strict entry point for repository scanners/build validation. */
export function validateCodecManifestForRepository(
  value: unknown,
  context: CodecManifestRepositoryValidationContext,
): CodecManifestValidationResult {
  return validateCodecManifest(value, {
    ...context,
    requireEntrypointRuntimeEvidence: true,
  })
}

export function isCodecManifestV1(value: unknown): value is CodecManifestV1 {
  return validateCodecManifest(value).valid
}
