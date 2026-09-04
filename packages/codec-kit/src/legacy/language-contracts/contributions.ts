import { ModkitError } from '../core/index.js'
import { DocumentKindRegistry } from './document-kind.js'
import type { KindRule } from './document-kind.js'
import type { DocumentKind, LanguageModule, SessionSubstrate } from './module.js'

/** Serializable identity exposed to hosts/settings without exposing runtime factories. */
export interface CodecLanguageContributionSummary {
  readonly id: string
  readonly codecId: string
  readonly languageId: string
  readonly documentKinds: readonly DocumentKind[]
}

/** One semantic codec's adapter onto the language protocol host. */
export interface CodecLanguageContribution extends CodecLanguageContributionSummary {
  createModule(context: LanguageContributionContext): LanguageModule
  /**
   * Rules mapping paths and content to this contribution's {@link documentKinds}.
   *
   * Contributed rather than owned by the host: the host would otherwise need one game's rule set
   * compiled into it, and could classify no other game's documents. Several contributions of one
   * game may each bring a slice; the host unions them all into one registry, so tier priority
   * still resolves across games rather than per contribution.
   *
   * Optional — a contribution whose documents are reached by `languageId` or extension alone
   * needs none.
   */
  readonly documentKindRules?: readonly KindRule[]
}

/**
 * Per-session shared-substrate scope.
 *
 * Separate codec contributions may intentionally share one substrate: GameData and GameStrings
 * use this to keep their one-load/one-overlay behaviour while remaining independently
 * registerable, and a game's language modules use it to share one loaded mod. Contributions of
 * DIFFERENT games never collide, because each keys its substrate by its own service id.
 *
 * The scope is created and owned by the protocol host, not by the registry: the host is what has
 * a session, and {@link substrates} is how it drives their lifecycle without knowing any
 * game's service ids.
 */
export class LanguageContributionContext {
  private readonly services = new Map<string, unknown>()

  shared<T>(id: string, create: () => T): T {
    if (this.services.has(id)) return this.services.get(id) as T
    const service = create()
    this.services.set(id, service)
    return service
  }

  /**
   * Every shared substrate, in the order it was first requested — which is contribution
   * registration order, so a game that registers before another also starts before it.
   */
  substrates(): readonly SessionSubstrate[] {
    return [...this.services.values()].filter(
      (service): service is SessionSubstrate => typeof service === 'object' && service !== null,
    )
  }
}

/**
 * Registration-order-preserving language contribution registry.
 *
 * Duplicate contribution IDs are rejected because they are stable host/configuration keys.
 * Multiple contributions may name the same codec in the future when one codec exposes more than
 * one language module.
 */
export class CodecLanguageContributionRegistry {
  private readonly contributions = new Map<string, CodecLanguageContribution>()

  constructor(contributions: readonly CodecLanguageContribution[] = []) {
    for (const contribution of contributions) this.register(contribution)
  }

  register(contribution: CodecLanguageContribution): void {
    if (this.contributions.has(contribution.id)) {
      throw new ModkitError({
        code: 'CONFIG_INVALID',
        message: `Language contribution '${contribution.id}' is already registered.`,
        context: {
          contributionId: contribution.id,
          codecId: contribution.codecId,
        },
      })
    }
    this.contributions.set(contribution.id, contribution)
  }

  list(): readonly CodecLanguageContributionSummary[] {
    return [...this.contributions.values()].map(contribution => ({
      id: contribution.id,
      codecId: contribution.codecId,
      languageId: contribution.languageId,
      documentKinds: [...contribution.documentKinds],
    }))
  }

  /**
   * Materialize every contribution into the host-supplied session scope.
   *
   * The scope is a parameter rather than a local: the host owns the session, so it must be able
   * to drive the substrates the contributions populate (see
   * {@link LanguageContributionContext.substrates}).
   */
  /**
   * One classification registry over every registered contribution's rules.
   *
   * Unioned rather than consulted per contribution so the tier order (languageId → basename →
   * path → content → extension) still decides across games: a second game's exact-basename rule
   * must beat the first game's bare-extension fallback, which per-contribution lookup could not
   * express.
   */
  documentKindRegistry(): DocumentKindRegistry {
    return new DocumentKindRegistry(
      [...this.contributions.values()].flatMap(
        contribution => contribution.documentKindRules ?? [],
      ),
    )
  }

  createModules(context: LanguageContributionContext): LanguageModule[] {
    return [...this.contributions.values()].map(contribution => {
      const module = contribution.createModule(context)
      this.assertModuleIdentity(contribution, module)
      return module
    })
  }

  private assertModuleIdentity(
    contribution: CodecLanguageContribution,
    module: LanguageModule,
  ): void {
    const actualKinds = [...(module.kinds ?? [])]
    const expectedKinds = [...contribution.documentKinds]
    if (
      module.languageId === contribution.languageId &&
      actualKinds.length === expectedKinds.length &&
      actualKinds.every((kind, index) => kind === expectedKinds[index])
    ) {
      return
    }
    throw new ModkitError({
      code: 'CONFIG_INVALID',
      message: `Language contribution '${contribution.id}' produced a module with mismatched identity.`,
      context: {
        contributionId: contribution.id,
        codecId: contribution.codecId,
        expectedLanguageId: contribution.languageId,
        actualLanguageId: module.languageId,
        expectedDocumentKinds: expectedKinds,
        actualDocumentKinds: actualKinds,
      },
    })
  }
}
