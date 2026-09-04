/**
 * DocumentKindRegistry — priority-ordered document classification for the language protocol
 * host (PLAN_mod_document_lsp_coverage.md R3).
 *
 * This file is the rule ENGINE and knows no game. One game's rule DATA is contributed alongside
 * its language modules, and the host composes a registry from the rules of everything registered.
 * There is deliberately no default rule set: a registry that silently classified documents with
 * one game's rules would be exactly the hidden coupling the split exists to remove.
 *
 * Two ad-hoc routing mechanisms exist today:
 *
 *  1. `DocumentRouter.moduleFor` — top-level MODULE selection, `byLanguageId ?? byExt`.
 *  2. `GamedataShared.docKindOf` — the fine `gamedata | strings` split WITHIN the combined
 *     mod-data module.
 *
 * This registry is the single source of truth both delegate to. It matches on the R3 priority
 * order — **language ID → exact basename → normalized relative path → root element/content →
 * extension (final fallback)** — and lets one module own several document kinds (ModDataModule
 * owns both `gamedata` and `include-manifest`), instead of encoding one module = one extension.
 */

/**
 * Classification lives beside the {@link DocumentKind} vocabulary rather than in the protocol
 * host, because both ends need it: the host to route, and a contributing codec to declare the
 * rules that map ITS paths to ITS kinds. A host that owned the rules could only ever classify one
 * game's documents. Distinct from the StarCraft II document-coverage IDs in
 * `extensions/blizzard/starcraft-2/src/document-coverage` (`@modkitx/document-registry` until
 * 2026-08-08), which are a documentation/coverage-gate manifest, not a runtime router.
 */
import type { DocumentKind } from './module.js'

/** Match tiers, highest priority first (R3 order). */
export const MATCH_TIERS = [
  'language-id',
  'basename',
  'relative-path',
  'content',
  'extension',
] as const
export type MatchTier = (typeof MATCH_TIERS)[number]

/** What a caller knows about a document. `text` may be empty/partial mid-edit. */
export interface DocumentInput {
  readonly languageId?: string
  /** Filesystem path (or URI-derived path); either separator style is accepted. */
  readonly fsPath: string
  readonly text?: string
}

/** A classification result with the rule/tier that produced it (for tests + G5). */
export interface DocumentMatch {
  readonly kind: DocumentKind
  readonly tier: MatchTier
  readonly ruleId: string
}

/** Pre-computed view of a {@link DocumentInput} shared by every rule predicate. */
export interface NormalizedInput {
  readonly languageId?: string
  readonly fsPath: string
  /** Last path segment, original case. */
  readonly basename: string
  /** Lowercased basename, for case-insensitive exact-name matches. */
  readonly basenameLower: string
  /** Lowercased extension including the dot (e.g. `.xml`), or `''` when extensionless. */
  readonly ext: string
  readonly text: string
}

/** One classification rule. A game contributes a whole array of these and nothing else. */
export interface KindRule {
  readonly id: string
  readonly kind: DocumentKind
  readonly tier: MatchTier
  /**
   * `true` when the rule DEFINITIVELY identifies the format from its name/path/content.
   * `false` for coarse ownership fallbacks (generic `languageId: 'xml'`, bare extension)
   * that decide module ownership but must never feed a fine sub-kind gate.
   */
  readonly definitive: boolean
  /**
   * Client file-watcher glob(s) that cover this rule's on-disk family (G5). Absent for
   * rules that only match a `languageId` (nothing on disk to watch beyond what the
   * extension/path rules already glob). {@link DocumentKindRegistry.watcherGlobs} unions
   * every rule's globs and collapses any specific glob that a same-extension wildcard
   * (`** /*.xml`) already subsumes, so the emitted set is minimal but complete.
   */
  readonly globs?: readonly string[]
  matches(input: NormalizedInput): boolean
}

function normalize(input: DocumentInput): NormalizedInput {
  const fsPath = input.fsPath
  const slash = Math.max(fsPath.lastIndexOf('/'), fsPath.lastIndexOf('\\'))
  const basename = slash >= 0 ? fsPath.slice(slash + 1) : fsPath
  const dot = basename.lastIndexOf('.')
  const ext = dot > 0 ? basename.slice(dot).toLowerCase() : ''
  return {
    ...(input.languageId !== undefined ? { languageId: input.languageId } : {}),
    fsPath,
    basename,
    basenameLower: basename.toLowerCase(),
    ext,
    text: input.text ?? '',
  }
}

const TIER_ORDER: ReadonlyMap<MatchTier, number> = new Map(MATCH_TIERS.map((t, i) => [t, i]))
const tierIndex = (tier: MatchTier): number => TIER_ORDER.get(tier) ?? MATCH_TIERS.length

export class DocumentKindRegistry {
  /** Rules sorted by ascending tier priority; registration order breaks ties (stable). */
  private readonly rules: readonly KindRule[]

  constructor(rules: readonly KindRule[]) {
    this.rules = [...rules]
      .map((rule, idx) => ({ rule, idx }))
      .sort((a, b) => tierIndex(a.rule.tier) - tierIndex(b.rule.tier) || a.idx - b.idx)
      .map(({ rule }) => rule)
  }

  /** The highest-priority rule that matches, with its kind/tier/id, or `undefined`. */
  classifyDetailed(input: DocumentInput): DocumentMatch | undefined {
    const norm = normalize(input)
    for (const rule of this.rules) {
      if (rule.matches(norm)) return { kind: rule.kind, tier: rule.tier, ruleId: rule.id }
    }
    return undefined
  }

  /** Coarse document kind for module routing (drives `DocumentRouter.moduleFor`). */
  classify(input: DocumentInput): DocumentKind | undefined {
    return this.classifyDetailed(input)?.kind
  }

  /**
   * Client file-watcher globs covering every on-disk family the registry knows (G5).
   *
   * Unions each rule's declared {@link KindRule.globs}, then collapses any specific glob
   * that a same-extension wildcard (`** /*.xml`, `** /*.txt`) already subsumes — so the
   * emitted set is minimal but complete. This is what the router registers with the client
   * (dynamic `workspace/didChangeWatchedFiles`), closing the audited gap where families
   * like `PreloadAssetDB.txt` were classified but never actually watched. The result is
   * sorted for a stable registration payload.
   */
  watcherGlobs(): string[] {
    const all = new Set<string>()
    for (const rule of this.rules) for (const g of rule.globs ?? []) all.add(g)
    // Extensions already covered by a `**/*.<ext>` wildcard — specific same-ext globs are redundant.
    const wildcardExts = new Set<string>()
    for (const g of all) {
      const m = /\*\*\/\*(\.[^./*]+)$/.exec(g)
      if (m) wildcardExts.add(m[1]!.toLowerCase())
    }
    const out: string[] = []
    for (const g of all) {
      const isWildcard = /\*\*\/\*\./.test(g)
      const ext = /(\.[^./*]+)$/.exec(g)?.[1]?.toLowerCase()
      if (!isWildcard && ext && wildcardExts.has(ext)) continue // subsumed by the wildcard
      out.push(g)
    }
    return out.sort()
  }

  /**
   * A module's fine sub-kind gate, restricted to the `gate` kinds it actually handles.
   *
   * Distinct from {@link classify}, which answers "which module owns this document". This
   * answers "which of MY kinds is it", and considers only DEFINITIVE rules — so coarse
   * ownership fallbacks (a bare `languageId`/extension) never decide a gate. The gate kinds are
   * a parameter rather than a constant because they are one game's vocabulary, not the engine's.
   */
  gatedKind<K extends DocumentKind>(input: DocumentInput, gate: readonly K[]): K | undefined {
    const norm = normalize(input)
    for (const rule of this.rules) {
      if (!rule.definitive) continue
      const kind = gate.find(candidate => candidate === rule.kind)
      if (kind === undefined) continue
      if (rule.matches(norm)) return kind
    }
    return undefined
  }
}
