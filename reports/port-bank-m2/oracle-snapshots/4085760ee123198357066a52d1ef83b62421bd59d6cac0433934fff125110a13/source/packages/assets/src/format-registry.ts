/**
 * Extension + magic-sniff resolution with lazily loaded, load-at-most-once codecs.
 *
 * This is the current shared registry base used by every `<domain>-processing` package. It
 * predates the descriptor pipeline in `ASSET_CAPABILITIES.md` and remains the migration
 * adapter surface: the target model ranks structured {@link import('./detection.js').AssetCandidate}
 * evidence instead of returning a single registration.
 */

import {
  detectHeaderFromModule,
  matchCodecRegistry,
  type CodecMatchingRegistryEntry,
  type CodecMatchingResult,
} from './codec-matching.js'

export function normalizeFormatExtension(pathOrExtension: string): string {
  const normalized = pathOrExtension.replace(/\\/g, '/').toLowerCase()
  const dot = normalized.lastIndexOf('.')
  if (dot < 0) return ''
  const ext = normalized.slice(dot)
  return /^\.[a-z0-9]+$/.test(ext) ? ext : ''
}

export interface FormatRegistration<TCodec> {
  readonly id: string
  /** Lowercase extensions with the leading dot, e.g. [".m3"]. */
  readonly extensions: readonly string[]
  /**
   * Cheap magic sniff over the file header, callable without loading the codec.
   * Optional — extension-only formats (text formats without magic) may omit it.
   */
  sniff?(header: Uint8Array): boolean
  /**
   * Where {@link sniff} is allowed to win.
   *
   * - `'global'` (default) — the sniff positively identifies the format from its magic, so
   *   it may claim a payload whose extension matched nothing.
   * - `'extension'` — the sniff is only a TIEBREAKER between codecs sharing an extension
   *   (typically expressed as a negation, "this `.tex` is not the other `.tex`"). Such a
   *   sniff says nothing about unrelated payloads, so it is excluded from the whole-registry
   *   fallback sweep; without this, one negated sniff silently swallows every unknown byte
   *   sequence in the registry.
   */
  readonly sniffScope?: 'global' | 'extension'
  readonly load: () => Promise<TCodec> | TCodec
}

/**
 * Shared registry shape for all five codec registries (models, archives, textures,
 * audio, video): extension + magic resolution, lazily loaded codecs, load-at-most-once.
 */
export class FormatRegistry<
  TCodec,
  TRegistration extends FormatRegistration<TCodec> = FormatRegistration<TCodec>,
> {
  private readonly registrations = new Map<string, TRegistration>()
  private readonly loaded = new Map<string, Promise<TCodec>>()
  private catalog: readonly CodecMatchingRegistryEntry[] = []

  constructor(private readonly kind = 'format codec') {}

  /**
   * Hand over the generated catalog the registrations were derived from, so resolution can rank
   * candidates by loading each codec's own `detect` entrypoint instead of consulting a detector
   * linked in advance.
   *
   * That single synchronous contract — `resolveRegistration()` cannot await a lazy `import()` — is
   * why every `<domain>-processing` package ended up holding a detector per format, some of them
   * imported by name out of a game's extension. A registry given its catalog needs none of them.
   */
  setCatalog(entries: readonly CodecMatchingRegistryEntry[]): void {
    this.catalog = entries
  }

  /**
   * Rank the catalog against a header and a filename hint.
   *
   * Returns the ranking only. Loading stays with {@link load}, because `matchCodecRegistry()`
   * resolves a codec's runtime straight from the catalog and would bypass the per-id overrides a
   * registry exists to honour — a host-parametrised codec, or a diagnostic placeholder standing in
   * for a format with no decoder in this repository. Taking the decision from `candidates` also
   * means a candidate whose generated runtime is missing still resolves.
   *
   * Whether an unbroken tie is an error is the caller's policy, not this registry's.
   */
  async matchCatalog(
    header: Uint8Array,
    hint = '',
    allowDetectFallback = false,
  ): Promise<CodecMatchingResult> {
    const path = hint.replace(/\\/g, '/')
    // `normalizeFormatExtension` answers '' rather than undefined, and a present-but-empty
    // extension is evidence that matches nothing.
    const extension = normalizeFormatExtension(path)
    return matchCodecRegistry(
      this.catalog,
      {
        sourceKind: 'file',
        header,
        ...(path.length > 0 ? { path } : {}),
        ...(extension.length > 0 ? { extension } : {}),
      },
      { runDetect: detectHeaderFromModule, allowDetectFallback },
    )
  }

  register(registration: TRegistration): void {
    if (this.registrations.has(registration.id)) {
      throw new Error(`${this.kind} "${registration.id}" is already registered`)
    }
    this.registrations.set(registration.id, registration)
  }

  list(): TRegistration[] {
    return [...this.registrations.values()]
  }

  get(id: string): TRegistration | null {
    return this.registrations.get(id) ?? null
  }

  /** All extensions any registered codec claims — drives editor registration. */
  extensions(): string[] {
    const all = new Set<string>()
    for (const registration of this.registrations.values()) {
      for (const ext of registration.extensions) all.add(ext)
    }
    return [...all]
  }

  matchByExtension(pathOrExtension: string): TRegistration[] {
    const ext = normalizeFormatExtension(pathOrExtension)
    if (!ext) return []
    return this.list().filter(registration => registration.extensions.includes(ext))
  }

  matchBySniff(header: Uint8Array): TRegistration[] {
    return this.list().filter(registration => registration.sniff?.(header) === true)
  }

  /**
   * Resolution order (decision 3): extension match first; when zero or several
   * extension candidates exist, disambiguate by magic sniff; extension-only codecs
   * (no sniff) win only when they are the sole extension match.
   *
   * The whole-registry fallback consults only `sniffScope: 'global'` codecs — an
   * extension-scoped tiebreaker must never claim a payload that did not match its
   * extension in the first place.
   */
  resolveRegistration(header: Uint8Array, hint = ''): TRegistration | null {
    const byExtension = this.matchByExtension(hint)
    const only = byExtension.length === 1 ? byExtension[0] : undefined
    if (only && (!only.sniff || only.sniff(header))) return only
    const candidates =
      byExtension.length > 1
        ? byExtension
        : this.list().filter(registration => registration.sniffScope !== 'extension')
    const sniffed = candidates.filter(registration => registration.sniff?.(header) === true)
    return sniffed[0] ?? only ?? null
  }

  /** Resolve and lazily load the codec; codecs load at most once. */
  async resolve(header: Uint8Array, hint = ''): Promise<TCodec | null> {
    const registration = this.resolveRegistration(header, hint)
    if (!registration) return null
    return this.load(registration.id)
  }

  async load(id: string): Promise<TCodec> {
    const registration = this.registrations.get(id)
    if (!registration) throw new Error(`${this.kind} "${id}" is not registered`)
    let pending = this.loaded.get(id)
    if (!pending) {
      pending = Promise.resolve(registration.load())
      this.loaded.set(id, pending)
    }
    return pending
  }
}
