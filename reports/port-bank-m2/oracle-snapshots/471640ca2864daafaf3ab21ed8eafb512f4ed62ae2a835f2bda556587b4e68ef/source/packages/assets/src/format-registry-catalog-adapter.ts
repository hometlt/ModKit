/**
 * Bridges `FormatRegistry` (synchronous `resolveRegistration(header, hint)`, load-once
 * `load(id)` — `./format-registry.ts`) to the generated codec catalog
 * (`generated/codec-catalog/registries/**`, consumed elsewhere only through the async
 * `matchCodecRegistry()` pipeline in `./codec-matching.ts`).
 *
 * Why this is needed (see RUNBOOK_codec_manifest_contract.md, Slice C4 item 5): the
 * generated catalog is deliberately lazy about *everything*, including each codec's
 * `detect` entrypoint — matching a candidate against a custom detector means awaiting a
 * dynamic `import()`. `FormatRegistry.resolveRegistration()` is synchronous by contract
 * (called inline while ranking candidates, before any codec is loaded), so it cannot
 * await a module load without either faking synchronicity (busy-waiting — banned) or
 * eagerly importing every codec up front (defeats the laziness the catalog exists to
 * preserve). There is no honest way to make the *custom-detect* stage synchronous without
 * changing one of the two contracts.
 *
 * The declarative prefilter stages (source kind, extension, magic bytes, MIME, XML root)
 * are a different story: `matchesCodecManifestPrefilter()` in `./codec-manifest.ts`
 * already operates purely on the manifest object with no module load at all. Those stages
 * stay real, generated-catalog-driven, and fully synchronous through this adapter.
 *
 * So the adapter's honest division of labor is:
 * - id, extensions, and (optionally) magic-byte sniffing come from the generated catalog
 *   — single source of truth, no hand-copied metadata;
 * - any codec whose real detection logic is not expressible as manifest-declared magic
 *   bytes (the common case — most model/audio detectors parse structure, not just a
 *   fixed byte pattern) needs its already-loaded, synchronous detector function supplied
 *   by the caller (`detectors`), exactly as today's handwritten registries already do —
 *   this adapter does not remove that requirement, it only removes the *id/extension*
 *   duplication around it;
 * - the async `load(id)` path — where `FormatRegistry` was already async — genuinely
 *   routes through the generated registry's lazy `runtime` entrypoint loader. This is
 *   real wiring, not a shape comparison: the actual dynamic `import()` executed at parse
 *   time is the one the catalog generated from each codec's `codec.manifest.json`.
 *
 * Runtime-parametrized loaders (e.g. `vscode-modkit`'s
 * `createModelCodecRegistry({ m3: () => createM3ModelCodec({ structuresXml, ... }) })`):
 * the manifest's static `import()` target cannot express a per-call constructor argument,
 * so `overrides` lets a caller supply a per-id loader that bypasses the generated
 * `runtime` entrypoint entirely for that id. The generated catalog still supplies that
 * id's identity/extensions/sniff-relevant data; only its fixed module target is replaced.
 */

import type { CodecMatchingRegistryEntry } from './codec-matching.js'
import type { FormatRegistration } from './format-registry.js'

/** Synchronous per-id detector, already loaded/imported by the caller. */
export type FormatRegistryCatalogDetector = (header: Uint8Array) => boolean

export interface FormatRegistryCatalogOptions<TCodec> {
  /**
   * Extracts the runtime codec instance from the module namespace the generated
   * registry's `runtime` loader resolves. The manifest intentionally does not
   * standardize codec export names (see `CodecMatchingOptions.runDetect` in
   * `./codec-matching.ts` for the same rationale), so the caller supplies this once
   * per registry kind rather than the catalog guessing an export name.
   */
  readonly resolveCodecExport: (moduleNamespace: unknown, id: string) => TCodec
  /**
   * Real, already-imported sync detectors for codecs whose detection is not (or not
   * fully) expressible as the manifest's declarative `match.magic` bytes. Keyed by
   * codec id. Optional per id — omitted ids fall back to declarative magic matching
   * (if the manifest declares any) or extension-only resolution.
   */
  readonly detectors?: Readonly<Record<string, FormatRegistryCatalogDetector>>
  /**
   * Declares a detector as an extension-tiebreaker rather than a global positive
   * identification — mirrors `FormatRegistration.sniffScope`. Omitted ids default to
   * `'global'`.
   */
  readonly sniffScopes?: Readonly<Record<string, 'global' | 'extension'>>
  /**
   * Per-id runtime overrides. When present for an id, used instead of the generated
   * entry's `runtime` loader — the mechanism that lets a runtime-parametrized loader
   * (e.g. `m3` with host-supplied `structuresXml`) keep working while every other id
   * still resolves through the generated catalog. Also the place to supply a
   * synthesized/diagnostic codec for an id whose generated entry has no `runtime`
   * loader at all (detect-only placeholders such as `max`/`wow-m2` in
   * models-processing).
   */
  readonly overrides?: Readonly<Record<string, () => Promise<TCodec> | TCodec>>
  /**
   * Extensions a codec answers to that its manifest deliberately does not declare in
   * `match.extensions`, keyed by codec id and merged with whatever the manifest declares.
   *
   * This covers the one v1 contract gap the runbook records: manifest match evidence is
   * conjunctive, so a codec that must claim a *broad* prefilter and defer to a structural
   * detector cannot also narrow itself to a fixed extension list. `ogg` and `opus` are the
   * live example — both are Ogg containers, so either extension may hold either payload and
   * the codecs sniff to decide. Their manifests therefore route on `pathGlobs: ["**\/*"]`.
   *
   * `FormatRegistry` still needs those extensions for hint-based resolution and to report
   * `extensions()`, so a caller supplies exactly the ids the manifest cannot express.
   * Prefer fixing the manifest whenever the extension list is genuinely the routing
   * evidence; use this only when a broad prefilter is deliberate.
   */
  readonly additionalExtensions?: Readonly<Record<string, readonly string[]>>
}

/** True if a manifest declares magic bytes at all — used to build a declarative sniff. */
function magicSniffFor(
  entry: CodecMatchingRegistryEntry,
): FormatRegistryCatalogDetector | undefined {
  const magic = entry.manifest.match.magic
  if (!magic || magic.length === 0) return undefined
  return (header: Uint8Array): boolean =>
    magic.some(candidate => {
      const bytes =
        candidate.encoding === 'hex'
          ? hexToBytes(candidate.bytes)
          : new TextEncoder().encode(candidate.bytes)
      if (header.length < candidate.offset + bytes.length) return false
      for (let index = 0; index < bytes.length; index += 1) {
        if (header[candidate.offset + index] !== bytes[index]) return false
      }
      return true
    })
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

/**
 * Default export-resolution heuristic: the codec instance a registration loads is
 * whichever export of the module namespace has `.id === id`. Holds across every
 * runtime-backed model/audio codec in the repository today (verified by the parity
 * tests this adapter builds on) because each codec module exports one object per
 * registry id, tagged with that id — including default-exported instances, since
 * `default` is itself one of `Object.values()` on a namespace object.
 */
export function resolveCodecExportById<TCodec>(moduleNamespace: unknown, id: string): TCodec {
  const candidate = Object.values(moduleNamespace as object).find(
    value => typeof value === 'object' && value !== null && (value as { id?: unknown }).id === id,
  )
  if (candidate === undefined) {
    throw new Error(
      `No export of the loaded module for codec "${id}" has a matching ".id" property.`,
    )
  }
  return candidate as TCodec
}

/**
 * Builds `FormatRegistration`s from generated catalog entries. See the module doc
 * comment above for the exact, honest division of labor between the generated catalog
 * and caller-supplied detectors/overrides.
 */
export function buildFormatRegistrationsFromCatalog<TCodec>(
  entries: readonly CodecMatchingRegistryEntry[],
  options: FormatRegistryCatalogOptions<TCodec>,
): FormatRegistration<TCodec>[] {
  return entries.map(entry => {
    const id = entry.manifest.id
    const extensions = [
      ...new Set([
        ...(entry.manifest.match.extensions ?? []),
        ...(options.additionalExtensions?.[id] ?? []),
      ]),
    ]
    const detector = options.detectors?.[id] ?? magicSniffFor(entry)
    const sniffScope = options.sniffScopes?.[id]
    const override = options.overrides?.[id]
    const runtimeLoad = entry.loaders.runtime

    return {
      id,
      extensions: [...extensions],
      ...(detector ? { sniff: detector } : {}),
      ...(sniffScope ? { sniffScope } : {}),
      load:
        override ??
        (async () => {
          if (!runtimeLoad) {
            throw new Error(
              `Generated codec catalog entry "${id}" has no runtime entrypoint and no override was supplied.`,
            )
          }
          const moduleNamespace = await runtimeLoad()
          return options.resolveCodecExport(moduleNamespace, id)
        }),
    }
  })
}
