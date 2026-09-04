/**
 * Browser-safe staged matching for generated codec registries.
 *
 * Generated registries provide declarative manifests plus lazy entrypoint loaders. This module
 * narrows candidates before loading executable code:
 *
 * 1. source kind and parent-artifact scope;
 * 2. the remaining cheap manifest prefilters;
 * 3. lazy structural detection;
 * 4. deterministic selection and one runtime load.
 */

import {
  codecManifestCoordinate,
  matchesCodecManifestPrefilter,
  type CodecManifestEntrypoints,
  type CodecManifestPrefilterInput,
  type CodecManifestV1,
  type CodecRuntimeEnvironment,
} from './codec-manifest.js'

export const DEFAULT_CODEC_PREFILTER_CONFIDENCE = 0.25

/** Export name a detect module may use to declare its header predicate unambiguously. */
export const CODEC_DETECT_EXPORT = 'detectHeader' as const

export type CodecDetectResult = boolean | number

export type CodecEntrypointKind = keyof CodecManifestEntrypoints

export type CodecEntrypointLoader = () => Promise<unknown>

export type CodecMatchingEntrypointLoaders = Partial<
  Readonly<Record<CodecEntrypointKind, CodecEntrypointLoader>>
>

export interface CodecMatchingVariant {
  readonly id: string
  readonly environment: CodecRuntimeEnvironment
}

/**
 * Runtime registration emitted by catalog generation. Loader functions must contain literal
 * dynamic imports; implementations are never imported while constructing or filtering a registry.
 */
export interface CodecMatchingRegistryEntry {
  readonly manifest: CodecManifestV1
  readonly variant: CodecMatchingVariant
  readonly loaders: CodecMatchingEntrypointLoaders
}

export interface CodecMatchingOptions {
  /**
   * Adapts a raw detect module namespace to the common boolean/confidence result. The manifest
   * intentionally does not prescribe module export names, so generated registries cannot unwrap
   * detect modules themselves.
   */
  readonly runDetect?: (
    module: unknown,
    input: CodecManifestPrefilterInput,
    manifest: CodecManifestV1,
    entry: CodecMatchingRegistryEntry,
  ) => CodecDetectResult | Promise<CodecDetectResult>
  /**
   * Confidence assigned when a variant has no custom detect entrypoint. It stays below a positive
   * structural detector by default while allowing strongly scoped manifest-only codecs to route.
   */
  readonly prefilterConfidence?: number
  /**
   * When no declarative prefilter matches, allow codecs with a custom detect entrypoint to inspect
   * the header anyway. This preserves content-based routing for generic or misleading filename
   * extensions without eagerly importing detector tables into the host package.
   */
  readonly allowDetectFallback?: boolean
}

export type CodecMatchingStage = 'source-scope' | 'prefilter' | 'detect' | 'runtime'

export type CodecMatchingDiagnosticCode =
  | 'codec-matching.source-kind'
  | 'codec-matching.parent-artifact'
  | 'codec-matching.prefilter-evidence'
  | 'codec-matching.prefilter'
  | 'codec-matching.detect-adapter'
  | 'codec-matching.detect-rejected'
  | 'codec-matching.detect-failed'
  | 'codec-matching.detect-result'
  | 'codec-matching.runtime-unavailable'
  | 'codec-matching.runtime-failed'

export interface CodecMatchingDiagnostic {
  readonly code: CodecMatchingDiagnosticCode
  readonly stage: CodecMatchingStage
  readonly severity: 'info' | 'warning' | 'error'
  readonly coordinate: string
  readonly variantId: string
  readonly message: string
  readonly missingEvidence?: readonly ('extension' | 'path' | 'mime-type' | 'header' | 'xml-root')[]
}

export interface CodecMatchedCandidate {
  readonly coordinate: string
  readonly manifest: CodecManifestV1
  readonly variant: CodecMatchingVariant
  readonly confidence: number
  readonly detection: 'custom' | 'prefilter'
}

/**
 * Every candidate that survived detection, best first — the same order selection used.
 *
 * Selection here is deterministic rather than an error, which is the right default for a host
 * opening a file. A caller that must instead *refuse* an ambiguous source cannot reconstruct that
 * from `diagnostics`: a candidate which was accepted and merely lost leaves no diagnostic behind.
 * So the ranking is reported, and whether a tie is a failure stays the caller's policy.
 */
export type CodecMatchedCandidates = readonly CodecMatchedCandidate[]

export type CodecMatchingResult =
  | {
      readonly status: 'resolved'
      readonly selected: CodecMatchedCandidate
      readonly candidates: CodecMatchedCandidates
      readonly runtimeEntrypoint: CodecEntrypointKind
      readonly runtime: unknown
      readonly diagnostics: readonly CodecMatchingDiagnostic[]
    }
  | {
      readonly status: 'unrecognized'
      readonly candidates: CodecMatchedCandidates
      readonly diagnostics: readonly CodecMatchingDiagnostic[]
    }
  | {
      readonly status: 'failed'
      readonly selected: CodecMatchedCandidate
      readonly candidates: CodecMatchedCandidates
      readonly diagnostics: readonly CodecMatchingDiagnostic[]
    }

type StageTwoEvidence = NonNullable<CodecMatchingDiagnostic['missingEvidence']>[number]

interface DetectedEntry {
  readonly entry: CodecMatchingRegistryEntry
  readonly candidate: CodecMatchedCandidate
}

function stageOneMatches(
  entry: CodecMatchingRegistryEntry,
  input: CodecManifestPrefilterInput,
  diagnostics: CodecMatchingDiagnostic[],
): boolean {
  const coordinate = codecManifestCoordinate(entry.manifest)
  const variantId = entry.variant.id
  if (!entry.manifest.sourceKinds.includes(input.sourceKind)) {
    diagnostics.push({
      code: 'codec-matching.source-kind',
      stage: 'source-scope',
      severity: 'info',
      coordinate,
      variantId,
      message: `Codec does not accept source kind '${input.sourceKind}'.`,
    })
    return false
  }

  const parents = entry.manifest.match.parentArtifacts
  if (
    parents !== undefined &&
    (input.parentArtifactIds === undefined ||
      !parents.some(parent => input.parentArtifactIds?.includes(parent)))
  ) {
    diagnostics.push({
      code: 'codec-matching.parent-artifact',
      stage: 'source-scope',
      severity: 'info',
      coordinate,
      variantId,
      message: 'Codec does not apply to the source parent-artifact scope.',
    })
    return false
  }
  return true
}

function missingStageTwoEvidence(
  manifest: CodecManifestV1,
  input: CodecManifestPrefilterInput,
): StageTwoEvidence[] {
  const missing: StageTwoEvidence[] = []
  const { match } = manifest
  if (match.extensions !== undefined && input.extension === undefined) missing.push('extension')
  if (match.pathGlobs !== undefined && input.path === undefined) missing.push('path')
  if (match.mimeTypes !== undefined && input.mimeType === undefined) missing.push('mime-type')
  if (match.magic !== undefined && input.header === undefined) missing.push('header')
  if (match.xmlRoots !== undefined && input.xmlRoot === undefined) missing.push('xml-root')
  return missing
}

function stageTwoMatches(
  entry: CodecMatchingRegistryEntry,
  input: CodecManifestPrefilterInput,
  diagnostics: CodecMatchingDiagnostic[],
): boolean {
  const coordinate = codecManifestCoordinate(entry.manifest)
  const variantId = entry.variant.id
  const missingEvidence = missingStageTwoEvidence(entry.manifest, input)
  if (missingEvidence.length > 0) {
    diagnostics.push({
      code: 'codec-matching.prefilter-evidence',
      stage: 'prefilter',
      severity: 'info',
      coordinate,
      variantId,
      message: `Codec prefilter evidence is missing: ${missingEvidence.join(', ')}.`,
      missingEvidence,
    })
    return false
  }
  if (!matchesCodecManifestPrefilter(entry.manifest, input)) {
    diagnostics.push({
      code: 'codec-matching.prefilter',
      stage: 'prefilter',
      severity: 'info',
      coordinate,
      variantId,
      message: 'Codec declarative prefilters did not match the source.',
    })
    return false
  }
  return true
}

function normalizeDetectResult(result: CodecDetectResult): number | undefined {
  if (typeof result === 'boolean') return result ? 1 : undefined
  if (!Number.isFinite(result) || result <= 0 || result > 1) return undefined
  return result
}

function compareDetected(left: DetectedEntry, right: DetectedEntry): number {
  const confidence = right.candidate.confidence - left.candidate.confidence
  if (confidence !== 0) return confidence
  const coordinate = left.candidate.coordinate.localeCompare(right.candidate.coordinate)
  if (coordinate !== 0) return coordinate
  const variant = left.candidate.variant.id.localeCompare(right.candidate.variant.id)
  return variant !== 0
    ? variant
    : left.candidate.variant.environment.localeCompare(right.candidate.variant.environment)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const RUNTIME_ENTRYPOINT_PREFERENCE: Readonly<
  Record<CodecRuntimeEnvironment, readonly CodecEntrypointKind[]>
> = {
  'browser-main': ['runtime', 'viewer'],
  'browser-worker': ['runtime', 'worker'],
  node: ['runtime', 'node'],
  'node-worker': ['runtime', 'worker', 'node'],
  wasm: ['runtime', 'worker'],
  native: ['runtime', 'native'],
  'external-tool': ['runtime', 'externalTool'],
}

function runtimeLoader(entry: CodecMatchingRegistryEntry):
  | {
      readonly kind: CodecEntrypointKind
      readonly load: CodecEntrypointLoader
    }
  | undefined {
  for (const kind of RUNTIME_ENTRYPOINT_PREFERENCE[entry.variant.environment]) {
    const load = entry.loaders[kind]
    if (load !== undefined) return { kind, load }
  }
  return undefined
}

function prefilterConfidence(options: CodecMatchingOptions): number {
  const confidence = options.prefilterConfidence ?? DEFAULT_CODEC_PREFILTER_CONFIDENCE
  return Number.isFinite(confidence) && confidence > 0 && confidence <= 1
    ? confidence
    : DEFAULT_CODEC_PREFILTER_CONFIDENCE
}

/**
 * Runs the four-stage codec matching pipeline and loads only the selected runtime entrypoint.
 *
 * Detection failures reject that candidate with a structured diagnostic so another surviving
 * codec may still resolve. A selected runtime load failure is returned as `status: 'failed'`.
 */
export async function matchCodecRegistry(
  entries: readonly CodecMatchingRegistryEntry[],
  input: CodecManifestPrefilterInput,
  options: CodecMatchingOptions = {},
): Promise<CodecMatchingResult> {
  const diagnostics: CodecMatchingDiagnostic[] = []
  const scoped = [...entries]
    .sort((left, right) =>
      codecManifestCoordinate(left.manifest).localeCompare(codecManifestCoordinate(right.manifest)),
    )
    .filter(entry => stageOneMatches(entry, input, diagnostics))
  let prefiltered = scoped.filter(entry => stageTwoMatches(entry, input, diagnostics))
  if (prefiltered.length === 0 && options.allowDetectFallback && input.header !== undefined) {
    const detectorEntries = scoped.filter(entry => entry.loaders.detect !== undefined)
    const magicMatches = scoped.filter(entry =>
      entry.manifest.match.magic?.some(magic => matchesDeclaredMagic(input.header!, magic)),
    )
    prefiltered =
      magicMatches.length > 0 ? magicMatches : input.header.length >= 6 ? detectorEntries : []
  }
  const detected: DetectedEntry[] = []

  for (const entry of prefiltered) {
    const coordinate = codecManifestCoordinate(entry.manifest)
    const variantId = entry.variant.id
    const loadDetect = entry.loaders.detect
    if (loadDetect === undefined) {
      detected.push({
        entry,
        candidate: {
          coordinate,
          manifest: entry.manifest,
          variant: entry.variant,
          confidence: prefilterConfidence(options),
          detection: 'prefilter',
        },
      })
      continue
    }
    if (options.runDetect === undefined) {
      diagnostics.push({
        code: 'codec-matching.detect-adapter',
        stage: 'detect',
        severity: 'warning',
        coordinate,
        variantId,
        message: 'Codec declares a detect entrypoint, but no detect module adapter was supplied.',
      })
      continue
    }
    try {
      const detectModule = await loadDetect()
      const rawResult = await options.runDetect(detectModule, input, entry.manifest, entry)
      const confidence = normalizeDetectResult(rawResult)
      if (confidence === undefined) {
        diagnostics.push({
          code:
            rawResult === false || rawResult === 0
              ? 'codec-matching.detect-rejected'
              : 'codec-matching.detect-result',
          stage: 'detect',
          severity: rawResult === false || rawResult === 0 ? 'info' : 'warning',
          coordinate,
          variantId,
          message:
            rawResult === false || rawResult === 0
              ? 'Codec structural detection rejected the source.'
              : 'Codec detection must return true, false, or a confidence in the range (0, 1].',
        })
        continue
      }
      detected.push({
        entry,
        candidate: {
          coordinate,
          manifest: entry.manifest,
          variant: entry.variant,
          confidence,
          detection: 'custom',
        },
      })
    } catch (error) {
      diagnostics.push({
        code: 'codec-matching.detect-failed',
        stage: 'detect',
        severity: 'warning',
        coordinate,
        variantId,
        message: `Codec detection failed: ${errorMessage(error)}`,
      })
    }
  }

  const ordered = detected.sort(compareDetected)
  const candidates: CodecMatchedCandidates = ordered.map(entry => entry.candidate)
  if (ordered.length === 0) return { status: 'unrecognized', candidates, diagnostics }

  let selected: DetectedEntry | undefined
  let selectedRuntime: ReturnType<typeof runtimeLoader>
  for (const candidate of ordered) {
    const runtime = runtimeLoader(candidate.entry)
    if (runtime !== undefined) {
      selected = candidate
      selectedRuntime = runtime
      break
    }
    diagnostics.push({
      code: 'codec-matching.runtime-unavailable',
      stage: 'runtime',
      severity: 'warning',
      coordinate: candidate.candidate.coordinate,
      variantId: candidate.candidate.variant.id,
      message: `Codec variant has no runtime entrypoint for '${candidate.candidate.variant.environment}'.`,
    })
  }

  if (selected === undefined || selectedRuntime === undefined) {
    const best = ordered[0]
    if (best === undefined) return { status: 'unrecognized', candidates, diagnostics }
    return {
      status: 'failed',
      selected: best.candidate,
      candidates,
      diagnostics,
    }
  }

  try {
    const runtime = await selectedRuntime.load()
    return {
      status: 'resolved',
      selected: selected.candidate,
      candidates,
      runtimeEntrypoint: selectedRuntime.kind,
      runtime,
      diagnostics,
    }
  } catch (error) {
    diagnostics.push({
      code: 'codec-matching.runtime-failed',
      stage: 'runtime',
      severity: 'error',
      coordinate: selected.candidate.coordinate,
      variantId: selected.candidate.variant.id,
      message: `Codec runtime loading failed: ${errorMessage(error)}`,
    })
    return {
      status: 'failed',
      selected: selected.candidate,
      candidates,
      diagnostics,
    }
  }
}

function matchesDeclaredMagic(
  header: Uint8Array,
  magic: { readonly offset: number; readonly bytes: string; readonly encoding: 'hex' | 'ascii' },
): boolean {
  const expected =
    magic.encoding === 'ascii'
      ? Uint8Array.from(magic.bytes, character => character.charCodeAt(0))
      : Uint8Array.from(
          magic.bytes
            .replace(/\s+/g, '')
            .match(/.{2}/g)
            ?.map(byte => Number.parseInt(byte, 16)) ?? [],
        )
  return (
    expected.length > 0 &&
    magic.offset + expected.length <= header.length &&
    expected.every((byte, index) => header[magic.offset + index] === byte)
  )
}

/**
 * Ready-made {@link CodecMatchingOptions.runDetect} for detect modules whose job is to look at a
 * header and answer yes or no.
 *
 * The manifest deliberately does not prescribe export names, which is why an adapter exists at all
 * rather than the registry unwrapping modules itself. This one resolves, in order:
 *
 * 1. an export named {@link CODEC_DETECT_EXPORT}, which is how a codec says so unambiguously;
 * 2. a callable `default`;
 * 3. the single exported function, when the module exports exactly one.
 *
 * A module exporting several functions and no `detectHeader` is **not** guessed at: a detect module
 * commonly exports its named predicates for its own tests, and picking one by position would
 * silently route on whichever happened to be declared first. Many codecs also point `detect` at
 * their whole index, where the exports are the codec's API rather than a predicate.
 *
 * Having no opinion is reported as {@link DEFAULT_CODEC_PREFILTER_CONFIDENCE}, not as `false`. The
 * distinction matters: `false` means *this codec rejects the source*, which would discard a
 * candidate the declarative prefilter had already accepted on extension, magic or MIME evidence.
 * The same applies when the input carries no header — there is nothing to sniff, and silence is not
 * a rejection.
 */
export const detectHeaderFromModule: NonNullable<CodecMatchingOptions['runDetect']> = (
  module,
  input,
) => {
  if (input.header === undefined) return DEFAULT_CODEC_PREFILTER_CONFIDENCE
  const predicate = resolveHeaderPredicate(module)
  if (predicate === undefined) return DEFAULT_CODEC_PREFILTER_CONFIDENCE
  return predicate(input.header)
}

function resolveHeaderPredicate(
  module: unknown,
): ((header: Uint8Array) => CodecDetectResult) | undefined {
  if (typeof module !== 'object' || module === null) return undefined
  const namespace = module as Record<string, unknown>
  const declared = namespace[CODEC_DETECT_EXPORT]
  if (typeof declared === 'function') {
    return declared as (header: Uint8Array) => CodecDetectResult
  }
  if (typeof namespace['default'] === 'function') {
    return namespace['default'] as (header: Uint8Array) => CodecDetectResult
  }
  const functions = Object.values(namespace).filter(value => typeof value === 'function')
  return functions.length === 1
    ? (functions[0] as (header: Uint8Array) => CodecDetectResult)
    : undefined
}
