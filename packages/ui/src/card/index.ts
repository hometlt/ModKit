/**
 * SubjectCard — a declarative composition surface for any subject.
 *
 * A subject is not a file. A domain entity may be assembled from many files and own none; a file
 * is equally a subject. So a card is never format-specific code: it is a list of section specs
 * that the host builds from whatever the subject exposes, rendered by reusable section kinds.
 *
 * Adding a new kind of subject means composing a different section list, not writing a new viewer.
 * `custom` is the escape hatch for a genuinely bespoke template (a command card, a skill tree),
 * and it still renders inside the same chrome, collapsing and theming like every other section.
 */
import type {
  AnyDescriptor,
  FieldEditable,
  FieldType,
  JsonValue,
  Lease,
  ModelResourceRef,
  SubjectSelectorSource,
  KnowledgeCatalog,
  KnowledgeHit,
  KnowledgeTarget,
  Page,
  PresentationSlot,
  SubjectFact,
  SubjectFactProvenance,
  SubjectFactsSource,
  SubjectEditTargetResult,
  ViewerModule,
  ViewerMount,
  ViewerSources,
} from '@modkit/sdk'
import { createAccordion, accordionField } from '../primitives/accordion.js'
import { setPart, setState } from '../parts.js'
import { setToken } from '../tokens/index.js'
import {
  bindingFor,
  createSurface,
  createViewerMount,
  defineViewerModule,
  safeViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import { type UiLocalizer, type UiMessageKey } from '../localization/index.js'
import { CARD_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'
import {
  mountFieldEditTarget,
  mountInlineField,
  type FieldWriteTarget,
} from '../field-write/index.js'
import type { ModelViewerOptions } from '../model/index.js'

export interface CardRef {
  readonly label: string
  /** Where the value came from: a file and line, another subject, a schema node. */
  readonly href?: string
  readonly title?: string
  /** A stable unresolved target. It remains visible but cannot be opened. */
  readonly dead?: boolean
  /** A place in a file (a fact's declaration, a subject's origin), opened by the host's editor. */
  readonly location?: CardLocation
}

/** A file and, when the publisher knows it, the zero-based line and column to show. */
export interface CardLocation {
  readonly uri: string
  readonly line?: number
  readonly column?: number
}

/** Host-neutral back/forward state for serialized subject references. */
export class SubjectNavigationHistory {
  private currentAddress: string | undefined
  private readonly backStack: string[] = []
  private readonly forwardStack: string[] = []

  get current(): string | undefined {
    return this.currentAddress
  }

  get canBack(): boolean {
    return this.backStack.length > 0
  }

  get canForward(): boolean {
    return this.forwardStack.length > 0
  }

  get breadcrumbs(): readonly string[] {
    return Object.freeze([
      ...this.backStack,
      ...(this.currentAddress === undefined ? [] : [this.currentAddress]),
    ])
  }

  reset(address: string): void {
    this.backStack.length = 0
    this.forwardStack.length = 0
    this.currentAddress = address
  }

  open(address: string): void {
    if (address === this.currentAddress) return
    if (this.currentAddress !== undefined) this.backStack.push(this.currentAddress)
    this.currentAddress = address
    this.forwardStack.length = 0
  }

  back(): string | undefined {
    const address = this.backStack.pop()
    if (address !== undefined) {
      if (this.currentAddress !== undefined) this.forwardStack.push(this.currentAddress)
      this.currentAddress = address
    }
    return address
  }

  forward(): string | undefined {
    const address = this.forwardStack.pop()
    if (address !== undefined) {
      if (this.currentAddress !== undefined) this.backStack.push(this.currentAddress)
      this.currentAddress = address
    }
    return address
  }

  /** Jump to an earlier breadcrumb while retaining the newer branch for forward navigation. */
  jump(address: string): string | undefined {
    const index = this.backStack.indexOf(address)
    if (index < 0) return undefined
    const skipped = this.backStack.splice(index)
    if (this.currentAddress !== undefined) this.forwardStack.push(this.currentAddress)
    for (let item = skipped.length - 1; item > 0; item -= 1) {
      const next = skipped[item]
      if (next !== undefined) this.forwardStack.push(next)
    }
    this.currentAddress = address
    return address
  }
}

export interface CardChip {
  readonly label: string
  readonly tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'error'
}

export interface CardStat {
  readonly icon: string
  readonly value: string
  /** Secondary value shown small under the main one: rate, upkeep, delta. */
  readonly delta?: string
  readonly title?: string
  readonly tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'error'
}

export interface CardField {
  readonly name: string
  readonly value: string
  /** Optional subject link rendered in the left/name column of the two-column table. */
  readonly ref?: CardRef
  /** Rendered as a chip after the value: the origin subject, a unit, a schema hint. */
  readonly badge?: string
  /** Where the value was declared, in the publisher's order (a mod chain: load order). */
  readonly sources?: readonly CardRef[]
  readonly title?: string
  /** One sentence under the value about what it is, when the value alone misleads. */
  readonly note?: string
  /** Exact codec-owned address for lazily resolving field help. */
  readonly knowledgeTarget?: KnowledgeTarget
  readonly editTarget?: SubjectEditTargetResult
  /** A value the codec declares writable: its type, its write and where the write goes. */
  readonly edit?: {
    readonly type: FieldType
    readonly unit?: string
    readonly editable: FieldEditable
    readonly value: JsonValue
    readonly target: FieldWriteTarget
  }
}

export interface CardGridCell {
  readonly id: string
  readonly icon?: string
  readonly hotkey?: string
  readonly label?: string
  readonly empty?: boolean
}

export interface CardSubcard {
  readonly title: string
  readonly ref?: CardRef
  readonly icon?: string
  readonly badge?: string
  readonly fields: readonly CardField[]
}

export type CardSection =
  | {
      readonly kind: 'header'
      readonly title: string
      readonly portrait?: string
      /** A logical image id resolved through `SubjectCardOptions.resolveImage`. */
      readonly portraitImage?: string
      readonly refs?: readonly CardRef[]
      readonly chips?: readonly CardChip[]
      readonly description?: string
      readonly notes?: readonly string[]
      readonly stats?: readonly CardStat[]
      /** Right-aligned control, e.g. the locale picker in the MK2 card. */
      readonly aside?: {
        readonly options: readonly string[]
        readonly value?: string
        onChange?(value: string): void
      }
    }
  | {
      readonly kind: 'fields'
      readonly id: string
      readonly title: string
      readonly fields: readonly CardField[]
      readonly expanded?: boolean
    }
  | {
      readonly kind: 'links'
      readonly id: string
      readonly title: string
      readonly links: readonly CardRef[]
      readonly lead?: string
      readonly expanded?: boolean
    }
  | {
      readonly kind: 'grid'
      readonly id: string
      readonly title: string
      readonly columns: number
      readonly cells: readonly CardGridCell[]
      readonly expanded?: boolean
    }
  | {
      readonly kind: 'cards'
      readonly id: string
      readonly title: string
      readonly cards: readonly CardSubcard[]
      readonly expanded?: boolean
    }
  | {
      readonly kind: 'text'
      readonly id: string
      readonly title: string
      readonly text: string
      readonly expanded?: boolean
    }
  | {
      readonly kind: 'custom'
      readonly id: string
      readonly title: string
      readonly expanded?: boolean
      render(host: HTMLElement): void | Promise<void>
    }

export interface SubjectCardOptions {
  readonly localizer?: UiLocalizer
  readonly label: string
  readonly sections: readonly CardSection[]
  /** Optional read-only knowledge snapshot; cards remain usable when it is absent. */
  readonly knowledge?: KnowledgeCatalog
  readonly knowledgeLocales?: readonly string[]
  onNavigate?(ref: CardRef): void
  /** Opens a `CardRef.location` in the host's editor; without it a location falls back to `href`. */
  onOpenSource?(location: CardLocation): void
  /** Edits a writable value in place (double-click or Enter on it); without it values stay text. */
  onEditField?(field: CardField, host: HTMLElement): void
  /**
   * False drops the subject's name and kind chips, which the host's own chrome already shows. The
   * rest of the header — portrait, stats, description, locale, sources and notes — is the card's
   * content and stays.
   */
  readonly header?: boolean
  /** Host-owned image lookup for `portraitImage`; the card never turns an id into a path. */
  resolveImage?(id: string, signal: AbortSignal): Promise<CardImage | undefined>
}

/** Decoded RGBA8 pixels, top-left origin. */
export interface CardImage {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

export interface SubjectCard {
  readonly root: HTMLElement
  destroy(): void
}

export interface SubjectCardLoadOptions {
  readonly localizer?: UiLocalizer
  readonly groupLimit?: number
  readonly factsPerGroup?: number
  readonly relationLimit?: number
  readonly pageSize?: number
  readonly signal?: AbortSignal
  /** Which locale to show when facts are published in several; defaults to enUS, then the first. */
  readonly locale?: string
  /** Called with the chosen locale when the reader switches it in the header. */
  onLocaleChange?(locale: string): void
}

function cardLoadLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be positive`)
  return value
}

async function loadCardPages<T>(
  read: (cursor: string | undefined, limit: number) => Promise<Page<T>>,
  maximum: number,
  pageSize: number,
): Promise<{ readonly items: readonly T[]; readonly capped: boolean }> {
  const items: T[] = []
  let cursor: string | undefined
  const seen = new Set<string>()
  while (items.length < maximum) {
    const result = await read(cursor, Math.min(pageSize, maximum - items.length))
    items.push(...result.items)
    if (result.nextCursor === undefined) return { items: Object.freeze(items), capped: false }
    if (seen.has(result.nextCursor)) throw new Error('subject facts source repeated a page cursor')
    seen.add(result.nextCursor)
    cursor = result.nextCursor
  }
  return { items: Object.freeze(items), capped: cursor !== undefined }
}

function scalarText(value: JsonValue): string | undefined {
  if (typeof value === 'string') return value
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return undefined
}

/** A list reads as lines and a flat record as `key: value` lines; only deeper values stay JSON. */
function factValue(value: JsonValue): string {
  const scalar = scalarText(value)
  if (scalar !== undefined) return scalar
  if (Array.isArray(value)) {
    const items = value.map(scalarText)
    if (items.every((item): item is string => item !== undefined)) return items.join('\n')
  } else if (value !== null) {
    const entries = Object.entries(value).map(([key, item]) => [key, scalarText(item)] as const)
    if (entries.every(([, item]) => item !== undefined))
      return entries.map(([key, item]) => `${key}: ${item ?? ''}`).join('\n')
  }
  return JSON.stringify(value)
}

/**
 * Glyphs for the stat row, keyed by the fact's own id. These are the vocabulary of any unit or item
 * in any game: a producer that publishes a `stats` group names its facts with them and gets an
 * icon; any other id gets a neutral bullet.
 */
const STAT_ICONS: Readonly<Record<string, string>> = Object.freeze({
  life: '\u2665',
  health: '\u2665',
  shields: '\u25C8',
  energy: '\u26A1',
  armor: '\u26E8',
  speed: '\u00BB',
  minerals: '\u25C6',
  vespene: '\u25B2',
  gas: '\u25B2',
  food: '\u2302',
  supply: '\u2302',
  time: '\u23F1',
  damage: '\u2694',
  range: '\u2192',
  cooldown: '\u21BB',
  dps: '\u2694',
})

function statOf(fact: SubjectFact): CardStat {
  const key = fact.id.toLowerCase().split(/[-.:]/u).at(-1) ?? ''
  return {
    icon: STAT_ICONS[key] ?? '\u2022',
    value: factValue(fact.value),
    title: fact.note === undefined ? fact.label : `${fact.label} \u2014 ${fact.note}`,
  }
}

function localeOf(fact: { readonly locale?: string }): string | undefined {
  return typeof fact.locale === 'string' && fact.locale !== '' ? fact.locale : undefined
}

function preferredLocale(locales: readonly string[], wanted?: string): string | undefined {
  if (wanted !== undefined && locales.includes(wanted)) return wanted
  return locales.find(locale => locale.toLowerCase() === 'enus') ?? locales[0]
}

const EXTENSION_SUBJECT_KIND = 'modkit/extension'
const CONTRIBUTION_SUBJECT_KIND = 'modkit/contribution'
const VENDOR_SUBJECT_KIND = 'modkit/vendor'
const GAME_SUBJECT_KIND = 'modkit/game'

/**
 * Presentation labels for Modkit's own extension-subject projection.
 *
 * The subject-facts ABI intentionally remains presentation-neutral and continues to carry the
 * producer's original labels. Only these stable system ids are translated here; unknown ids,
 * including codec-owned `spec.*` fields, keep their exact producer-supplied labels.
 */
const EXTENSION_GROUP_MESSAGE_KEYS: Readonly<Record<string, UiMessageKey>> = Object.freeze({
  overview: 'card.extension.group.overview',
  state: 'card.extension.group.state',
  contributions: 'card.extension.group.contributions',
  declaration: 'card.extension.group.declaration',
  specification: 'card.extension.group.specification',
})

const EXTENSION_FACT_MESSAGE_KEYS: Readonly<Record<string, UiMessageKey>> = Object.freeze({
  id: 'card.extension.fact.id',
  'display-name': 'card.extension.fact.displayName',
  publisher: 'card.extension.fact.publisher',
  version: 'card.extension.fact.version',
  license: 'card.extension.fact.license',
  description: 'card.extension.fact.description',
  homepage: 'card.extension.fact.homepage',
  source: 'card.extension.fact.source',
  trusted: 'card.extension.fact.trusted',
  enabled: 'card.extension.fact.enabled',
  'contribution-count': 'card.extension.fact.contributionCount',
  vendor: 'card.extension.fact.vendor',
  games: 'card.extension.fact.games',
  'source-details': 'card.extension.fact.sourceDetails',
  'license-files': 'card.extension.fact.licenseFiles',
})

const CONTRIBUTION_FACT_MESSAGE_KEYS: Readonly<Record<string, UiMessageKey>> = Object.freeze({
  id: 'card.contribution.fact.id',
  'display-name': 'card.contribution.fact.displayName',
  description: 'card.extension.fact.description',
  'owner-extension': 'card.contribution.fact.ownerExtension',
  'contract-id': 'card.contribution.fact.contractId',
  'contract-major': 'card.contribution.fact.contractMajor',
  'contract-coordinate': 'card.contribution.fact.contractCoordinate',
  status: 'card.contribution.fact.status',
  enabled: 'card.contribution.fact.enabled',
  'effective-enabled': 'card.contribution.fact.effectiveEnabled',
  'depends-on': 'card.contribution.fact.dependencies',
  limitations: 'card.contribution.fact.limitations',
  'runtime-variants': 'card.contribution.fact.runtimeVariants',
  spec: 'card.contribution.fact.specification',
})
const REPOSITORY_SUBJECT_GROUP_MESSAGE_KEYS: Readonly<Record<string, UiMessageKey>> = Object.freeze(
  {
    overview: 'card.repository.group.overview',
    resources: 'card.repository.group.resources',
    offerings: 'card.repository.group.offerings',
    'extension-requirements': 'card.repository.group.extensions',
    'capability-requirements': 'card.repository.group.capabilities',
  },
)
const REPOSITORY_SUBJECT_FACT_MESSAGE_KEYS: Readonly<Record<string, UiMessageKey>> = Object.freeze({
  id: 'card.repository.fact.id',
  'display-name': 'card.repository.fact.displayName',
  description: 'card.extension.fact.description',
  vendor: 'card.repository.fact.vendor',
  'game-count': 'card.repository.fact.gameCount',
  'extension-count': 'card.repository.fact.extensionCount',
})
const NO_FACT_MESSAGE_KEYS: Readonly<Record<string, UiMessageKey>> = Object.freeze({})

function isRepositorySubjectKind(kind: string): boolean {
  return kind === VENDOR_SUBJECT_KIND || kind === GAME_SUBJECT_KIND
}

function systemSubjectLabel(
  localizer: UiLocalizer,
  subjectKind: string,
  keys: Readonly<Record<string, UiMessageKey>>,
  id: string,
  fallback: string,
): string {
  if (
    subjectKind !== EXTENSION_SUBJECT_KIND &&
    subjectKind !== CONTRIBUTION_SUBJECT_KIND &&
    !isRepositorySubjectKind(subjectKind)
  ) {
    return fallback
  }
  const key = keys[id]
  return key === undefined ? fallback : localizer.text(key)
}

/** A provenance entry as a link: to its file, at its declaration when the publisher knows it. */
/** A value as text in a node that held a control. */
function setViewerTextNode(node: HTMLElement, text: string): void {
  node.replaceChildren(node.ownerDocument.createTextNode(safeViewerText(text, 2048)))
}

function provenanceRef(item: SubjectFactProvenance): CardRef {
  if (item.source === undefined) return { label: item.label }
  const text = item.range as { readonly line?: number; readonly column?: number } | undefined
  return {
    label: item.label,
    href: item.source.uri,
    location: {
      uri: item.source.uri,
      ...(typeof text?.line === 'number' ? { line: text.line, column: text.column ?? 0 } : {}),
    },
  }
}

function factField(
  fact: SubjectFact,
  subjectKind: string,
  localizer: UiLocalizer,
  groupId: string,
): CardField {
  const keys: Readonly<Record<string, UiMessageKey>> =
    subjectKind === EXTENSION_SUBJECT_KIND
      ? EXTENSION_FACT_MESSAGE_KEYS
      : subjectKind === CONTRIBUTION_SUBJECT_KIND
        ? CONTRIBUTION_FACT_MESSAGE_KEYS
        : isRepositorySubjectKind(subjectKind)
          ? REPOSITORY_SUBJECT_FACT_MESSAGE_KEYS
          : NO_FACT_MESSAGE_KEYS
  return {
    name: systemSubjectLabel(localizer, subjectKind, keys, fact.id, fact.label),
    value: factValue(fact.value),
    ...(fact.provenance.length === 0 ? {} : { sources: fact.provenance.map(provenanceRef) }),
    ...(fact.note === undefined ? {} : { note: fact.note }),
    ...(fact.knowledgeTarget === undefined ? {} : { knowledgeTarget: fact.knowledgeTarget }),
    ...(fact.editTarget === undefined ? {} : { editTarget: fact.editTarget }),
    // the same write a tree node or a table cell makes: the codec's operation, keyed by group and fact
    ...(fact.editable === undefined || fact.type === undefined
      ? {}
      : {
          edit: {
            type: fact.type,
            ...(fact.unit === undefined ? {} : { unit: fact.unit }),
            editable: fact.editable,
            value: fact.value,
            target: { groupId, key: fact.id, ...factWritePath(fact) },
          },
        }),
  }
}

/**
 * Where the codec writes the fact: the semantic path its source names (`['Unit', 'Marine',
 * 'LifeMax']` for SC2 Data). The fact id alone does not say which entity a value belongs to.
 */
function factWritePath(fact: SubjectFact): { readonly path?: readonly string[] } {
  const path = fact.provenance.find(item => item.semanticPath !== undefined)?.semanticPath
  return path === undefined ? {} : { path }
}

function repositoryResourceRef(value: JsonValue): CardRef | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const label = Object.getOwnPropertyDescriptor(value, 'label')?.value as unknown
  const url = Object.getOwnPropertyDescriptor(value, 'url')?.value as unknown
  if (typeof label !== 'string' || typeof url !== 'string') return undefined
  try {
    const parsed = new URL(url)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      return undefined
    }
    return { label, href: parsed.href }
  } catch {
    return undefined
  }
}

function repositorySubjectTableField(fact: SubjectFact): CardField | undefined {
  const value = fact.value
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const subjectId = Object.getOwnPropertyDescriptor(value, 'subjectId')?.value as unknown
  const description = Object.getOwnPropertyDescriptor(value, 'description')?.value as unknown
  if (typeof subjectId !== 'string' || typeof description !== 'string') return undefined
  return {
    name: fact.label,
    value: description,
    ref: { label: fact.label, href: subjectId },
  }
}

function applyCardLayout(
  sections: readonly CardSection[],
  layout: readonly string[] | undefined,
): readonly CardSection[] {
  if (layout === undefined || layout.length === 0) return Object.freeze([...sections])
  const rank = new Map(layout.map((id, index) => [id, index]))
  const layoutId = (section: CardSection): string => {
    if (section.kind === 'header') return 'identity'
    if (rank.has(section.id)) return section.id
    if (
      section.id === 'related-subjects' ||
      section.id === 'contributions' ||
      section.id.startsWith('related:')
    )
      return 'relations'
    return section.id
  }
  return Object.freeze(
    sections
      .map((section, index) => ({ section, index, rank: rank.get(layoutId(section)) }))
      .sort(
        (left, right) =>
          (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER) ||
          left.index - right.index,
      )
      .map(item => item.section),
  )
}

/** Default host projection. The source publishes facts and never chooses a card component. */
export async function loadSubjectCardSections(
  source: SubjectFactsSource,
  options: SubjectCardLoadOptions = {},
): Promise<readonly CardSection[]> {
  const localizer = withEnglishUiFallback(options.localizer, CARD_FALLBACK_MESSAGES)
  const groupLimit = cardLoadLimit(options.groupLimit ?? 32, 'groupLimit')
  const factsPerGroup = cardLoadLimit(options.factsPerGroup ?? 256, 'factsPerGroup')
  const relationLimit = cardLoadLimit(options.relationLimit ?? 256, 'relationLimit')
  const pageSize = cardLoadLimit(options.pageSize ?? 64, 'pageSize')
  const summary = await source.summary(options.signal)
  const [groups, relations] = await Promise.all([
    loadCardPages(
      (cursor, limit) =>
        source.groups({ ...(cursor === undefined ? {} : { cursor }), limit }, options.signal),
      groupLimit,
      pageSize,
    ),
    loadCardPages(
      (cursor, limit) =>
        source.relations({ ...(cursor === undefined ? {} : { cursor }), limit }, options.signal),
      relationLimit,
      pageSize,
    ),
  ])
  const notes: string[] = []
  if (groups.capped || groups.items.length < summary.groupCount)
    notes.push(localizer.text('card.factGroupsCapped'))
  if (relations.capped || relations.items.length < summary.relationCount)
    notes.push(localizer.text('card.relatedCapped'))
  const factGroups = await Promise.all(
    groups.items.map(async group => ({
      group,
      page: await loadCardPages(
        (cursor, limit) =>
          source.facts(
            group.id,
            { ...(cursor === undefined ? {} : { cursor }), limit },
            options.signal,
          ),
        factsPerGroup,
        pageSize,
      ),
    })),
  )
  const identity = summary.identity
  const labels = identity.localizedLabels ?? {}
  const locales = [
    ...new Set([
      ...factGroups.flatMap(item => item.page.items.map(localeOf)),
      ...Object.keys(labels),
    ]),
  ]
    .filter((locale): locale is string => locale !== undefined)
    .sort()
  const locale = preferredLocale(locales, options.locale)
  const visible = (fact: SubjectFact): boolean => {
    const own = localeOf(fact)
    return own === undefined || own === locale
  }
  const stats = factGroups
    .filter(item => item.group.id === 'stats')
    .flatMap(item => item.page.items.filter(visible).map(statOf))
  const sections: CardSection[] = [
    {
      kind: 'header',
      title: (locale === undefined ? undefined : labels[locale]) ?? identity.label,
      ...(identity.portrait === undefined ? {} : { portraitImage: identity.portrait }),
      ...(stats.length === 0 ? {} : { stats }),
      ...(locales.length < 2
        ? {}
        : {
            aside: {
              options: locales,
              ...(locale === undefined ? {} : { value: locale }),
              ...(options.onLocaleChange === undefined ? {} : { onChange: options.onLocaleChange }),
            },
          }),
      refs: summary.identity.origins.map(provenanceRef),
      chips: [
        { label: summary.identity.kind },
        ...(summary.identity.type === undefined ? [] : [{ label: summary.identity.type }]),
      ],
      ...(notes.length === 0 ? {} : { notes }),
    },
  ]
  const description = factGroups
    .flatMap(item => item.page.items)
    .find(item => item.id === 'description' && visible(item))?.value
  if (typeof description === 'string' && description.trim() !== '') {
    const header = sections[0]
    if (header?.kind === 'header') sections[0] = { ...header, description }
  }
  if (summary.preview !== undefined && summary.card?.preview !== 'none') {
    sections.push({
      kind: 'links',
      id: 'preview',
      title: localizer.text('card.preview'),
      links: [
        {
          label: summary.preview.label ?? summary.preview.source.id,
          href: summary.preview.source.uri,
          ...(summary.preview.mediaType === undefined ? {} : { title: summary.preview.mediaType }),
        },
      ],
      expanded: true,
    })
  }
  for (const { group, page: loadedPage } of factGroups) {
    if (group.id === 'stats') continue
    const page = { ...loadedPage, items: loadedPage.items.filter(visible) }
    if (page.items.length === 0 && loadedPage.items.length > 0) continue
    // Extension-owned contributions are navigable subjects, not opaque JSON fields. Their
    // canonical links come from the relation page below; suppress the duplicate fact projection.
    if (summary.identity.kind === EXTENSION_SUBJECT_KIND && group.id === 'contributions') continue
    if (isRepositorySubjectKind(summary.identity.kind) && group.id === 'resources') {
      const links = page.items
        .map(item => repositoryResourceRef(item.value))
        .filter((item): item is CardRef => item !== undefined)
      if (links.length === page.items.length) {
        sections.push({
          kind: 'links',
          id: group.id,
          title: localizer.text('card.repository.group.resources'),
          links,
          expanded: true,
        })
        continue
      }
    }
    if (summary.identity.kind === VENDOR_SUBJECT_KIND && group.id === 'offerings') {
      const fields = page.items
        .map(repositorySubjectTableField)
        .filter((item): item is CardField => item !== undefined)
      if (fields.length === page.items.length) {
        sections.push({
          kind: 'fields',
          id: group.id,
          title: localizer.text('card.repository.group.offerings'),
          fields,
          expanded: true,
        })
        continue
      }
    }
    const groupKeys = isRepositorySubjectKind(summary.identity.kind)
      ? REPOSITORY_SUBJECT_GROUP_MESSAGE_KEYS
      : EXTENSION_GROUP_MESSAGE_KEYS
    const groupLabel = systemSubjectLabel(
      localizer,
      summary.identity.kind,
      groupKeys,
      group.id,
      group.label,
    )
    sections.push({
      kind: 'fields',
      id: group.id,
      title:
        page.capped || page.items.length < group.factCount
          ? localizer.text('card.capped', { label: groupLabel })
          : groupLabel,
      fields: page.items.map(fact => factField(fact, summary.identity.kind, localizer, group.id)),
      expanded: true,
    })
  }
  const relationRef = (item: (typeof relations.items)[number]): CardRef => ({
    label: item.label,
    href: item.subjectId,
    title: `${item.role} · ${item.kind}`,
    ...(item.dead === undefined ? {} : { dead: item.dead }),
  })
  const roles = [...new Set(relations.items.map(item => item.role))]
  if (summary.identity.kind !== EXTENSION_SUBJECT_KIND && roles.length > 1) {
    // Several kinds of link (weapons, abilities, dependencies) read as lists of their own.
    for (const role of roles) {
      sections.push({
        kind: 'links',
        id: `related:${role}`,
        title: role,
        links: relations.items.filter(item => item.role === role).map(relationRef),
        expanded: true,
      })
    }
  } else if (relations.items.length > 0) {
    const extensionContributions = summary.identity.kind === EXTENSION_SUBJECT_KIND
    sections.push({
      kind: 'links',
      id: extensionContributions ? 'contributions' : 'related-subjects',
      title: extensionContributions
        ? localizer.text('card.extension.group.contributions')
        : localizer.text('card.relatedSubjects'),
      links: relations.items.map(relationRef),
      ...(extensionContributions ? { expanded: true } : {}),
    })
  }
  return applyCardLayout(sections, summary.card?.sections)
}

/**
 * What a click on a ref does: a location opens in the host's editor, anything else goes through the
 * card's navigation; a dead ref, or one the host can follow neither way, is only text.
 */
export function cardRefAction(
  item: CardRef,
  onNavigate?: (ref: CardRef) => void,
  onOpenSource?: (location: CardLocation) => void,
): (() => void) | undefined {
  const location = item.location
  if (item.dead === true) return undefined
  if (location !== undefined && onOpenSource !== undefined) return () => onOpenSource(location)
  return onNavigate !== undefined && item.href !== undefined ? () => onNavigate(item) : undefined
}

function ref(
  document: Document,
  item: CardRef,
  onNavigate?: (ref: CardRef) => void,
  onOpenSource?: (location: CardLocation) => void,
): HTMLElement {
  const open = cardRefAction(item, onNavigate, onOpenSource)
  const navigable = open !== undefined
  const node = document.createElement(navigable ? 'button' : 'span')
  node.className = 'modkit-card__ref'
  setPart(node, 'card.ref')
  node.textContent = safeViewerText(item.label, 256)
  if (item.title !== undefined) node.title = item.title
  if (item.dead === true) {
    node.setAttribute('aria-disabled', 'true')
    setState(node, ['disabled'])
  }
  if (open !== undefined) {
    ;(node as HTMLButtonElement).type = 'button'
    node.addEventListener('click', open)
  }
  return node
}

function renderHeader(
  document: Document,
  host: HTMLElement,
  section: Extract<CardSection, { kind: 'header' }>,
  localizer: UiLocalizer,
  signal: AbortSignal,
  onNavigate?: (ref: CardRef) => void,
  resolveImage?: SubjectCardOptions['resolveImage'],
  /** False: the host names the subject, so the title and kind chips are left out. */
  named = true,
  onOpenSource?: (location: CardLocation) => void,
): void {
  const header = document.createElement('div')
  header.className = 'modkit-card__header'
  setPart(header, 'card.header')

  if (section.portraitImage !== undefined && resolveImage !== undefined) {
    const portrait = document.createElement('canvas')
    portrait.className = 'modkit-card__portrait'
    portrait.setAttribute('aria-hidden', 'true')
    portrait.hidden = true
    setPart(portrait, 'card.portrait')
    header.append(portrait)
    void resolveImage(section.portraitImage, signal)
      .then(image => {
        const context = image === undefined ? null : portrait.getContext('2d')
        if (image === undefined || context === null || signal.aborted) return
        if (image.rgba.byteLength !== image.width * image.height * 4) return
        portrait.width = image.width
        portrait.height = image.height
        const pixels = context.createImageData(image.width, image.height)
        pixels.data.set(image.rgba)
        context.putImageData(pixels, 0, 0)
        portrait.hidden = false
      })
      .catch(() => undefined)
  } else if (section.portrait !== undefined) {
    const portrait = document.createElement('div')
    portrait.className = 'modkit-card__portrait'
    portrait.setAttribute('aria-hidden', 'true')
    portrait.textContent = safeViewerText(section.portrait, 8)
    setPart(portrait, 'card.portrait')
    header.append(portrait)
  }

  const identity = document.createElement('div')
  identity.className = 'modkit-card__identity'
  setPart(identity, 'card.identity')
  header.append(identity)

  if (named) {
    const title = document.createElement('h2')
    title.className = 'modkit-card__title'
    title.textContent = safeViewerText(section.title, 256)
    setPart(title, 'card.title')
    identity.append(title)
  }

  if (section.refs !== undefined && section.refs.length > 0) {
    const subtitle = document.createElement('div')
    subtitle.className = 'modkit-card__subtitle'
    setPart(subtitle, 'card.subtitle')
    for (const item of section.refs) subtitle.append(ref(document, item, onNavigate, onOpenSource))
    identity.append(subtitle)
  }

  if (named && section.chips !== undefined && section.chips.length > 0) {
    const chips = document.createElement('div')
    chips.className = 'modkit-card__chips'
    setPart(chips, 'card.chips')
    for (const chip of section.chips) {
      const node = document.createElement('span')
      node.className = 'modkit-card__chip'
      node.textContent = safeViewerText(chip.label, 64)
      node.dataset['tone'] = chip.tone ?? 'accent'
      setPart(node, 'card.chip')
      chips.append(node)
    }
    identity.append(chips)
  }

  if (section.description !== undefined) {
    const description = document.createElement('p')
    description.className = 'modkit-card__description'
    description.textContent = safeViewerText(section.description, 2048)
    setPart(description, 'card.description')
    identity.append(description)
  }

  for (const note of section.notes ?? []) {
    const node = document.createElement('p')
    node.className = 'modkit-card__note'
    node.textContent = safeViewerText(note, 512)
    setPart(node, 'card.note')
    identity.append(node)
  }

  if (section.stats !== undefined && section.stats.length > 0) {
    const row = document.createElement('div')
    row.className = 'modkit-card__statrow'
    setPart(row, 'card.statrow')
    for (const stat of section.stats) {
      const cell = document.createElement('span')
      cell.className = 'modkit-card__stat'
      cell.dataset['tone'] = stat.tone ?? 'neutral'
      if (stat.title !== undefined) cell.title = stat.title
      setPart(cell, 'card.stat')
      const icon = document.createElement('span')
      icon.setAttribute('aria-hidden', 'true')
      icon.textContent = safeViewerText(stat.icon, 4)
      setPart(icon, 'card.stat-icon')
      const value = document.createElement('span')
      value.textContent = safeViewerText(stat.value, 32)
      setPart(value, 'card.stat-value')
      cell.append(icon, value)
      if (stat.delta !== undefined) {
        const delta = document.createElement('span')
        delta.textContent = safeViewerText(stat.delta, 32)
        setPart(delta, 'card.stat-delta')
        cell.append(delta)
      }
      row.append(cell)
    }
    identity.append(row)
  }

  if (section.aside !== undefined) {
    const select = document.createElement('select')
    select.className = 'modkit-card__locale'
    select.setAttribute('aria-label', localizer.text('card.locale'))
    setPart(select, 'card.locale')
    for (const option of section.aside.options) {
      const node = document.createElement('option')
      node.value = option
      node.textContent = safeViewerText(option, 32)
      select.append(node)
    }
    if (section.aside.value !== undefined) select.value = section.aside.value
    select.addEventListener('change', () => section.aside?.onChange?.(select.value))
    header.append(select)
  }

  // without its name, a header that holds nothing else is not drawn at all
  if (identity.childElementCount === 0) identity.remove()
  if (header.childElementCount > 0) host.append(header)
}

function renderFields(
  document: Document,
  host: HTMLElement,
  fields: readonly CardField[],
  inspectKnowledge?: (target: KnowledgeTarget | undefined) => void,
  onNavigate?: (ref: CardRef) => void,
  onOpenSource?: (location: CardLocation) => void,
  onEditField?: (field: CardField, host: HTMLElement) => void,
): void {
  const list = document.createElement('div')
  list.className = 'modkit-card__fields'
  list.setAttribute('role', 'table')
  setPart(list, 'card.fields')
  for (const field of fields) {
    const row = document.createElement('div')
    row.className = 'modkit-card__field'
    setPart(row, 'card.field')
    row.tabIndex = 0
    if (field.title !== undefined) row.title = field.title
    const name =
      field.ref === undefined
        ? document.createElement('span')
        : ref(document, field.ref, onNavigate)
    if (field.ref === undefined) name.textContent = safeViewerText(field.name, 128)
    setPart(name, 'card.field-name')
    const value = document.createElement('span')
    value.textContent = safeViewerText(field.value, 2048)
    setPart(value, 'card.field-value')
    if (field.note !== undefined) {
      const note = document.createElement('small')
      note.textContent = safeViewerText(field.note, 512)
      setPart(note, 'card.field-note')
      value.append(note)
    }
    row.append(name, value)
    if (field.edit !== undefined && onEditField !== undefined) {
      const begin = () => onEditField(field, value)
      value.dataset['editable'] = 'true'
      value.addEventListener('dblclick', begin)
      row.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || value.dataset['editing'] === 'true') return
        event.preventDefault()
        begin()
      })
    }
    if (field.badge !== undefined) {
      const badge = document.createElement('span')
      badge.className = 'modkit-card__chip'
      badge.dataset['tone'] = 'neutral'
      badge.textContent = safeViewerText(field.badge, 48)
      setPart(badge, 'card.chip')
      row.append(badge)
    }
    if (field.sources !== undefined && field.sources.length > 0) {
      const sources = document.createElement('span')
      setPart(sources, 'card.sources')
      for (const item of field.sources)
        sources.append(ref(document, item, onNavigate, onOpenSource))
      row.append(sources)
    }
    mountFieldEditTarget(row, field.editTarget)
    if (inspectKnowledge !== undefined) {
      const inspect = () => inspectKnowledge(field.knowledgeTarget)
      row.addEventListener('focus', inspect)
      row.addEventListener('mouseenter', inspect)
    }
    list.append(row)
  }
  host.append(list)
}

export function createSubjectCard(document: Document, options: SubjectCardOptions): SubjectCard {
  const localizer = withEnglishUiFallback(options.localizer, CARD_FALLBACK_MESSAGES)
  const root = document.createElement('article')
  root.className = 'modkit-card'
  root.setAttribute('aria-label', localizer.text('card.namedSubject', { label: options.label }))
  setPart(root, 'card')

  const images = new AbortController()
  /*
   * The subject's name and kind repeat what the host's own chrome already says, so a host with
   * chrome of its own leaves them out; the stats, portrait, description, locale and sources beside
   * them are facts no chrome shows, and stay.
   */
  const header = options.sections.find(section => section.kind === 'header')
  if (header !== undefined)
    renderHeader(
      document,
      root,
      header,
      localizer,
      images.signal,
      options.onNavigate,
      options.resolveImage,
      options.header !== false,
      options.onOpenSource,
    )

  const knowledge = document.createElement('aside')
  knowledge.className = 'modkit-card__knowledge'
  knowledge.setAttribute('role', 'status')
  knowledge.setAttribute('aria-live', 'polite')
  knowledge.dataset['knowledgeState'] = 'missing'
  setPart(knowledge, 'card.knowledge')
  knowledge.textContent = localizer.text('card.descriptionUnavailable')
  if (options.knowledge !== undefined) root.append(knowledge)

  let lookupRevision = 0
  let lookupController: AbortController | undefined
  const cancelLookup = (reason: string): number => {
    lookupRevision += 1
    lookupController?.abort(reason)
    lookupController = undefined
    return lookupRevision
  }
  const showMissingKnowledge = (): void => {
    knowledge.dataset['knowledgeState'] = 'missing'
    knowledge.replaceChildren()
    knowledge.textContent = localizer.text('card.descriptionUnavailable')
  }
  const directSource = (
    hit: KnowledgeHit,
  ): { readonly title: string; readonly url: URL } | undefined => {
    for (const source of hit.entry.sources) {
      if (source.url === undefined) continue
      try {
        const url = new URL(source.url)
        if (url.protocol === 'https:') return { title: source.title, url }
      } catch {
        // Knowledge is untrusted data; malformed links are deliberately omitted.
      }
    }
    return undefined
  }
  const showKnowledge = (hit: KnowledgeHit): void => {
    knowledge.dataset['knowledgeState'] = 'resolved'
    knowledge.replaceChildren()
    const summary = document.createElement('span')
    summary.textContent = safeViewerText(hit.entry.summary, 512)
    knowledge.append(summary)
    const source = directSource(hit)
    if (source === undefined) return
    knowledge.append(document.createTextNode(' '))
    const link = document.createElement('a')
    link.href = source.url.href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.referrerPolicy = 'no-referrer'
    link.textContent = safeViewerText(source.title, 160)
    knowledge.append(link)
  }
  const inspectKnowledge = (target: KnowledgeTarget | undefined): void => {
    const revision = cancelLookup('card-field-changed')
    if (target === undefined || options.knowledge === undefined) {
      showMissingKnowledge()
      return
    }
    const controller = new AbortController()
    lookupController = controller
    knowledge.dataset['knowledgeState'] = 'loading'
    knowledge.replaceChildren()
    knowledge.textContent = localizer.text('card.loadingDescription')
    void (async () => {
      try {
        const page = await options.knowledge?.resolve(
          { target, locales: options.knowledgeLocales ?? [], limit: 1 },
          controller.signal,
        )
        if (controller.signal.aborted || revision !== lookupRevision) return
        const hit = page?.items[0]
        if (hit === undefined) showMissingKnowledge()
        else showKnowledge(hit)
      } catch {
        if (!controller.signal.aborted && revision === lookupRevision) showMissingKnowledge()
      } finally {
        if (revision === lookupRevision) lookupController = undefined
      }
    })()
  }

  const collapsible = options.sections.filter(section => section.kind !== 'header')
  const accordion = createAccordion(document, {
    label: localizer.text('card.sections', { label: options.label }),
    sections: collapsible.map(section => ({
      id: section.id,
      title: section.title,
      ...(section.expanded === undefined ? {} : { expanded: section.expanded }),
      render(panel: HTMLElement) {
        setPart(panel.parentElement ?? panel, 'accordion.section')
        switch (section.kind) {
          case 'fields':
            renderFields(
              document,
              panel,
              section.fields,
              options.knowledge === undefined ? undefined : inspectKnowledge,
              options.onNavigate,
              options.onOpenSource,
              options.onEditField,
            )
            return
          case 'links': {
            const list = document.createElement('div')
            list.className = 'modkit-card__links'
            setPart(list, 'card.links')
            if (section.lead !== undefined) {
              const lead = document.createElement('span')
              lead.textContent = safeViewerText(section.lead, 256)
              setPart(lead, 'card.link-item')
              list.append(lead)
            }
            for (const link of section.links) list.append(ref(document, link, options.onNavigate))
            panel.append(list)
            return
          }
          case 'grid': {
            const grid = document.createElement('div')
            grid.className = 'modkit-card__grid'
            grid.setAttribute('role', 'grid')
            setPart(grid, 'card.grid')
            // A per-instance runtime slot, validated before it reaches the CSSOM.
            setToken(grid, 'card.grid-columns', String(section.columns))
            for (const cell of section.cells) {
              const node = document.createElement('button')
              node.type = 'button'
              node.className = 'modkit-card__grid-cell'
              node.disabled = cell.empty === true
              setPart(node, 'card.grid-cell')
              if (cell.empty === true) setState(node, ['disabled'])
              if (cell.label !== undefined) node.title = cell.label
              if (cell.hotkey !== undefined) {
                const hotkey = document.createElement('span')
                hotkey.setAttribute('aria-hidden', 'true')
                hotkey.textContent = safeViewerText(cell.hotkey, 2)
                setPart(hotkey, 'card.grid-hotkey')
                node.append(hotkey)
              }
              if (cell.icon !== undefined) {
                const icon = document.createElement('span')
                icon.textContent = safeViewerText(cell.icon, 4)
                setPart(icon, 'card.grid-icon')
                node.append(icon)
              }
              node.setAttribute('aria-label', cell.label ?? cell.id)
              grid.append(node)
            }
            panel.append(grid)
            return
          }
          case 'cards': {
            const list = document.createElement('div')
            list.className = 'modkit-card__subcards'
            setPart(list, 'card.subcards')
            for (const card of section.cards) {
              const item = document.createElement('div')
              item.className = 'modkit-card__subcard'
              setPart(item, 'card.subcard')
              const head = document.createElement('div')
              head.className = 'modkit-card__subcard-head'
              setPart(head, 'card.subcard-head')
              if (card.icon !== undefined) {
                const icon = document.createElement('span')
                icon.setAttribute('aria-hidden', 'true')
                icon.textContent = safeViewerText(card.icon, 4)
                setPart(icon, 'card.stat-icon')
                head.append(icon)
              }
              head.append(
                card.ref === undefined
                  ? (() => {
                      const title = document.createElement('span')
                      title.textContent = safeViewerText(card.title, 128)
                      setPart(title, 'card.ref')
                      return title
                    })()
                  : ref(document, { ...card.ref, label: card.title }, options.onNavigate),
              )
              if (card.badge !== undefined) {
                const badge = document.createElement('span')
                badge.className = 'modkit-card__chip'
                badge.dataset['tone'] = 'neutral'
                badge.textContent = safeViewerText(card.badge, 64)
                setPart(badge, 'card.chip')
                head.append(badge)
              }
              const body = document.createElement('div')
              body.className = 'modkit-card__subcard-body'
              setPart(body, 'card.subcard-body')
              renderFields(document, body, card.fields, inspectKnowledge)
              item.append(head, body)
              list.append(item)
            }
            panel.append(list)
            return
          }
          case 'text': {
            const pre = document.createElement('pre')
            pre.className = 'modkit-card__text'
            pre.textContent = safeViewerText(section.text, 200_000)
            setPart(pre, 'text')
            panel.append(pre)
            return
          }
          case 'custom': {
            const host = document.createElement('div')
            host.className = 'modkit-card__custom'
            setPart(host, 'card.custom')
            panel.append(host)
            void section.render(host)
            return
          }
          default:
            return
        }
      },
    })),
  })

  root.append(accordion.root)
  return {
    root,
    destroy() {
      cancelLookup('card-destroyed')
      images.abort('card-destroyed')
      accordion.destroy()
      root.remove()
    },
  }
}

/** Standard stage adapter over the codec-owned, presentation-neutral subject facts source. */
export interface SubjectCardViewerOptions {
  readonly localizer?: UiLocalizer
  /**
   * A subject of the bound selector to open on instead of the subject itself (a wiki's chosen
   * entity); its history starts there.
   */
  readonly subject?: string
  /**
   * The stages the preview section mounts. A host passes the same configured modules its own
   * image and model stages use (renderer port, texture resolver, export writer); without them the
   * card falls back to unconfigured ones, which draw a wireframe model and untextured materials.
   */
  readonly previews?: {
    readonly image?: ViewerModule
    readonly model?: ViewerModule
    readonly audio?: ViewerModule
    readonly video?: ViewerModule
  }
  /**
   * The host's subject-bound image lookup, the same one its model stage uses for textures. The
   * card uses it for a subject's portrait; without it the portrait is not drawn.
   */
  readonly textures?: ModelViewerOptions['textures']
  /** False drops the card's identity header (a host whose chrome already names the subject). */
  readonly header?: boolean
  /** The locale the card opens on (the host's game-strings setting); the header still switches it. */
  readonly locale?: string
  /** The host's relations stage (its default depth) for the card's relations graph section. */
  readonly graph?: ViewerModule
  /** The host's editor for a fact's declaration; without it a source stays a label. */
  readonly openSource?: (location: CardLocation) => void
  /**
   * After a value written from the card: the subject's file changed, so the host reopens it at its
   * new revision (the session the card read was pinned to the old one).
   */
  readonly onCommitted?: (descriptor: AnyDescriptor) => void
  /** Opens the model a subject names (`identity.model`) as a subject of its own, in its own tab. */
  readonly openModel?: (model: string) => void
}

export function createSubjectCardViewer(options: SubjectCardViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, CARD_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('card.subject'))
      try {
        const lease = await unknownSourceLease(
          args.sources,
          args.slot,
          'common.view/subject-facts-source',
        )
        if (lease === undefined) throw new TypeError('subject facts binding is unavailable')
        scope.lease(lease)
        const selectorLease = (await unknownSourceLease(
          args.sources,
          args.slot,
          SUBJECT_SELECTOR_CONTRACT,
        )) as Lease<SubjectSelectorSource> | undefined
        if (selectorLease !== undefined) scope.lease(selectorLease)
        const selector = selectorLease?.value
        const own = lease.value as SubjectFactsSource
        const ownId = (await own.summary(scope.signal)).identity.subjectId
        const document = root.ownerDocument
        const history = new SubjectNavigationHistory()
        const start = options.subject ?? ownId
        history.reset(start)
        const nav = document.createElement('div')
        setPart(nav, 'card.nav')
        const back = document.createElement('button')
        back.type = 'button'
        back.textContent = '\u2190'
        back.title = localizer.text('card.historyBack')
        back.setAttribute('aria-label', localizer.text('card.historyBack'))
        const forward = document.createElement('button')
        forward.type = 'button'
        forward.textContent = '\u2192'
        forward.title = localizer.text('card.historyForward')
        forward.setAttribute('aria-label', localizer.text('card.historyForward'))
        // where the reader came from, as MK2's card showed it: the last subjects, each a jump back
        const trail = document.createElement('span')
        setPart(trail, 'card.breadcrumbs')
        nav.append(back, forward, trail)
        root.append(nav)
        const labels = new Map<string, string>()
        const renderTrail = (): void => {
          trail.replaceChildren()
          const crumbs = history.breadcrumbs
          const shown = crumbs.slice(-CARD_BREADCRUMBS)
          if (shown.length < crumbs.length) trail.append('… › ')
          shown.forEach((address, index) => {
            const label = safeViewerText(labels.get(address) ?? address, 64)
            if (index === shown.length - 1) {
              const current = document.createElement('strong')
              current.textContent = label
              trail.append(current)
              return
            }
            const crumb = document.createElement('button')
            crumb.type = 'button'
            crumb.textContent = label
            crumb.title = address
            crumb.addEventListener('click', () => {
              const target = history.jump(address)
              if (target !== undefined) void show(target).catch(() => undefined)
            })
            trail.append(crumb, ' › ')
          })
        }

        const resolveImage =
          options.textures === undefined
            ? undefined
            : async (id: string, signal: AbortSignal): Promise<CardImage | undefined> => {
                const textures = await options.textures?.(
                  args.descriptor,
                  [
                    {
                      id,
                      role: 'texture',
                      provenance: 'reference-only',
                    } satisfies ModelResourceRef,
                  ],
                  signal,
                )
                const texture = textures?.get(id)
                if (texture === undefined || texture.dimension === 'cube') return undefined
                return {
                  width: texture.width,
                  height: texture.height,
                  rgba: texture.rgba.subarray(0, texture.width * texture.height * 4),
                }
              }

        let locale = options.locale
        let page: { card: SubjectCard; scope: ViewerMountScope } | undefined
        let generation = 0
        /*
         * One card at a time. A related subject the codec can lend from this same session (an
         * entity inside a catalog, a member of a mod) opens in place with back/forward; anything
         * else goes to the host's own navigation, which opens it as a subject of its own.
         */
        const show = async (address: string, commit?: () => void): Promise<void> => {
          const current = ++generation
          const pageScope = new ViewerMountScope(scope.signal)
          try {
            let source = own
            if (address !== ownId) {
              if (selector === undefined) throw new TypeError('no subject selector is bound')
              source = pageScope.lease(await selector.openFacts(address, pageScope.signal)).value
            }
            const loaded = await loadSubjectCardSections(source, {
              localizer,
              signal: pageScope.signal,
              ...(locale === undefined ? {} : { locale }),
              onLocaleChange(next) {
                locale = next
                void show(address).catch(() => undefined)
              },
            })
            if (current !== generation || scope.signal.aborted) {
              await pageScope.close()
              return
            }
            const sections = await embedRelatedModel(
              address === ownId
                ? embedRelationGraph(
                    embedPreview(loaded, args, pageScope, localizer, options.previews),
                    args,
                    pageScope,
                    localizer,
                    options.graph,
                  )
                : loaded,
              source,
              args,
              pageScope,
              localizer,
              options.previews,
              options.openModel,
            )
            const card = createSubjectCard(document, {
              label: localizer.text('card.subject'),
              localizer,
              sections,
              ...(options.header === undefined ? {} : { header: options.header }),
              ...(args.knowledge === undefined ? {} : { knowledge: args.knowledge }),
              // A link goes somewhere only through the host's navigation or this session's own
              // subjects; without either it stays text rather than a button that does nothing.
              ...(args.subjectNavigation === undefined && selector === undefined
                ? {}
                : { onNavigate: navigate }),
              ...(options.openSource === undefined ? {} : { onOpenSource: options.openSource }),
              // only the subject this card was opened on writes through this session's ports
              ...(address === ownId ? { onEditField: editField } : {}),
              ...(resolveImage === undefined ? {} : { resolveImage }),
            })
            commit?.()
            const heading = loaded.find(section => section.kind === 'header')
            if (heading?.kind === 'header') labels.set(address, heading.title)
            const previous = page
            page = { card, scope: pageScope }
            pageScope.cleanup(() => card.destroy())
            if (previous === undefined) root.append(card.root)
            else previous.card.root.replaceWith(card.root)
            await previous?.scope.close()
            back.disabled = !history.canBack
            forward.disabled = !history.canForward
            nav.hidden = !history.canBack && !history.canForward
            renderTrail()
            root.dataset['subject'] = address
          } catch (error) {
            await pageScope.close()
            throw error
          }
        }
        /*
         * A writable value edits in place through the same field write a tree or a table makes; the
         * field explains a refusal and stays open, Escape gives up, an accepted write shows its value
         * and asks the host to reopen the subject at its new revision.
         */
        function editField(field: CardField, host: HTMLElement): void {
          const edit = field.edit
          if (edit === undefined || host.dataset['editing'] === 'true') return
          host.dataset['editing'] = 'true'
          const previous = [...host.childNodes]
          host.replaceChildren()
          let written: JsonValue | undefined
          const close = (): void => {
            delete host.dataset['editing']
            if (written === undefined) host.replaceChildren(...previous)
            else setViewerTextNode(host, factValue(written))
          }
          void mountInlineField(host, {
            label: field.name,
            type: edit.type,
            value: edit.value,
            ...(edit.unit === undefined ? {} : { unit: edit.unit }),
            editable: edit.editable,
            target: edit.target,
            descriptor: args.descriptor,
            operations: args.operations,
            ...(args.commit === undefined ? {} : { commit: args.commit }),
            ...(args.authorization === undefined ? {} : { authorization: args.authorization }),
            signal: scope.signal,
            onWritten: value => {
              written = value
            },
          }).then(
            mount => {
              const finish = async (save: boolean): Promise<void> => {
                if (save && !(await mount.commit())) return
                host.removeEventListener('keydown', onKey)
                await mount.unmount()
                close()
                if (save) options.onCommitted?.(args.descriptor)
              }
              const onKey = (event: KeyboardEvent): void => {
                if (event.key !== 'Enter' && event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                void finish(event.key === 'Enter')
              }
              host.addEventListener('keydown', onKey)
              host.querySelector<HTMLElement>('input, textarea, select')?.focus()
            },
            () => close(),
          )
        }
        const subjectNavigation = args.subjectNavigation
        const navigate = (reference: CardRef): void => {
          const target = reference.href
          if (target === undefined) return
          void (async () => {
            if (target === history.current) return
            if (selector !== undefined || target === ownId) {
              try {
                await show(target, () => history.open(target))
                return
              } catch {
                // Not one of this session's subjects: the host opens it as a subject of its own.
              }
            }
            await subjectNavigation
              ?.open({ scope: subjectNavigation.scope, target }, scope.signal)
              .catch(() => undefined)
          })()
        }
        back.addEventListener('click', () => {
          const address = history.back()
          if (address !== undefined) void show(address).catch(() => undefined)
        })
        forward.addEventListener('click', () => {
          const address = history.forward()
          if (address !== undefined) void show(address).catch(() => undefined)
        })
        await show(start)
        scope.cleanup(() => page?.scope.close())
        root.dataset['revision'] = args.descriptor.revision
        return createViewerMount(root, scope, args, ({ descriptor }) => {
          root.dataset['revision'] = descriptor.revision
        })
      } catch (error) {
        await scope.close()
        root.remove()
        throw error
      }
    },
  })
}

const SUBJECT_SELECTOR_CONTRACT = 'common.view/subject-selector-source'
/** How many subjects the card's trail shows; the older ones fold into an ellipsis. */
const CARD_BREADCRUMBS = 6

const PREVIEW_STAGES = [
  { kind: 'model', contract: 'common.view/model-scene-source' },
  { kind: 'image', contract: 'common.view/raster-image-source' },
  { kind: 'video', contract: 'common.view/video-media-source' },
  { kind: 'audio', contract: 'common.view/audio-media-source' },
] as const

type PreviewStageKind = (typeof PREVIEW_STAGES)[number]['kind']

// Loaded on demand: the model stage brings the 3D renderer with it.
async function defaultPreviewStage(
  kind: PreviewStageKind,
  localizer: UiLocalizer,
): Promise<ViewerModule> {
  switch (kind) {
    case 'model':
      return (await import('../model/index.js')).createModelViewer({ localizer })
    case 'image':
      return (await import('../image/index.js')).createImageViewer({ localizer })
    case 'video':
      return (await import('../video/index.js')).createVideoViewer({ localizer })
    case 'audio':
      return (await import('../audio/index.js')).createAudioViewer({ localizer })
  }
}

/**
 * The card's preview section shows the subject itself, not a link to it: when the host bound a
 * raster, model, video or audio source to this slot, the standard stage mounts inside the
 * section. Without such a binding the section keeps its link.
 */
function embedPreview(
  sections: readonly CardSection[],
  args: Parameters<ViewerModule['mount']>[0],
  scope: ViewerMountScope,
  localizer: UiLocalizer,
  previews: SubjectCardViewerOptions['previews'],
): readonly CardSection[] {
  const kind = PREVIEW_STAGES.find(item => bindingFor(args.slot, item.contract))?.kind
  if (kind === undefined) return sections
  return sections.map(section =>
    section.kind !== 'links' || section.id !== 'preview'
      ? section
      : stageSection(
          { id: 'preview', title: section.title, expanded: true },
          scope,
          localizer,
          'card.previewUnavailable',
          async host => {
            const module = previews?.[kind] ?? (await defaultPreviewStage(kind, localizer))
            return scope.signal.aborted
              ? undefined
              : module.mount({ ...args, container: host, signal: scope.signal })
          },
        ),
  )
}

/**
 * A card section a standard stage mounts in: a box of its own height that the reader can resize,
 * torn down with the card page; a stage that fails says why inside the section.
 */
function stageSection(
  section: { readonly id: string; readonly title: string; readonly expanded: boolean },
  scope: ViewerMountScope,
  localizer: UiLocalizer,
  failure: 'card.previewUnavailable' | 'card.relationGraphUnavailable',
  mountStage: (host: HTMLElement) => Promise<ViewerMount | undefined>,
): CardSection {
  return {
    kind: 'custom',
    ...section,
    async render(host: HTMLElement) {
      setPart(host, 'card.preview')
      try {
        const mount = await mountStage(host)
        if (mount !== undefined) scope.cleanup(() => mount.unmount())
      } catch (error) {
        if (scope.signal.aborted) return
        host.textContent = localizer.text(failure, {
          reason: safeViewerText(error instanceof Error ? error.message : String(error), 256),
        })
      }
    },
  }
}

const RELATION_GRAPH_CONTRACT = 'common.view/relation-graph-source'

/**
 * The subject's relations inside its card, as MK2 showed them: the host's relations stage, walked
 * from this subject, with its type filter, depth and direction. Collapsed until opened, so a card
 * does not walk the graph nobody asked for.
 */
export function embedRelationGraph(
  sections: readonly CardSection[],
  args: Parameters<ViewerModule['mount']>[0],
  scope: ViewerMountScope,
  localizer: UiLocalizer,
  graph: ViewerModule | undefined,
): readonly CardSection[] {
  if (bindingFor(args.slot, RELATION_GRAPH_CONTRACT) === undefined) return sections
  return [
    ...sections,
    stageSection(
      { id: 'relations-graph', title: localizer.text('card.relationGraph'), expanded: false },
      scope,
      localizer,
      'card.relationGraphUnavailable',
      async host => {
        const module =
          graph ?? (await import('../graph/index.js')).createRelationGraphViewer({ localizer })
        return scope.signal.aborted
          ? undefined
          : module.mount({ ...args, container: host, signal: scope.signal })
      },
    ),
  ]
}

const RELATED_MODEL_FACETS = [
  { contract: 'common.view/model-scene-source', open: 'openModel' },
  { contract: 'common.view/model-material-source', open: 'openModelMaterials' },
  { contract: 'common.view/model-resource-refs-source', open: 'openModelResources' },
] as const

/**
 * The slot and sources a model stage mounts with for a facts source's related model: one binding
 * per model facet, each served by the facts source's host-added `openModel*` lease.
 */
export function relatedModelStageInputs(
  source: SubjectFactsSource,
  parent: PresentationSlot,
  signal: AbortSignal,
): { readonly slot: PresentationSlot; readonly sources: ViewerSources } {
  const slot = {
    ...parent,
    bindings: RELATED_MODEL_FACETS.map(({ contract }) => ({
      bindingId: `card-model:${contract}`,
      contract,
      major: 1,
    })),
  } as unknown as PresentationSlot
  const sources = {
    async get(binding: { readonly contract?: string }) {
      const facet = RELATED_MODEL_FACETS.find(item => item.contract === binding.contract)
      const open =
        facet === undefined
          ? undefined
          : (source[facet.open] as ((signal?: AbortSignal) => Promise<Lease<unknown>>) | undefined)
      if (open === undefined) return undefined
      try {
        return await open.call(source, signal)
      } catch (error) {
        // The scene is the preview; a missing material or reference facet only drops detail.
        if (facet?.open === 'openModel') throw error
        return undefined
      }
    },
    async getUnknown() {
      return undefined
    },
  } as unknown as ViewerSources
  return { slot, sources }
}

/**
 * A subject that names a model (`identity.model`) shows it: the host resolved and converted that
 * model and lends it through the facts source, and the standard model stage mounts over those
 * leases. The stage keeps this subject's descriptor, so the model's textures resolve through the
 * same subject-bound image lookup the portrait uses.
 */
async function embedRelatedModel(
  sections: readonly CardSection[],
  source: SubjectFactsSource,
  args: Parameters<ViewerModule['mount']>[0],
  scope: ViewerMountScope,
  localizer: UiLocalizer,
  previews: SubjectCardViewerOptions['previews'],
  openModel?: (model: string) => void,
): Promise<readonly CardSection[]> {
  if (source.openModel === undefined) return sections
  const model = (await source.summary(scope.signal)).identity.model
  if (model === undefined) return sections
  const { slot, sources } = relatedModelStageInputs(source, args.slot, scope.signal)
  const section = stageSection(
    { id: 'model', title: localizer.text('card.preview'), expanded: true },
    scope,
    localizer,
    'card.previewUnavailable',
    async host => {
      host.dataset['model'] = model
      const module = previews?.model ?? (await defaultPreviewStage('model', localizer))
      if (scope.signal.aborted) return undefined
      const mount = await module.mount({
        ...args,
        container: host,
        slot,
        sources,
        signal: scope.signal,
      })
      // the model as a subject of its own: its codec's views, sections and conversions in a tab
      if (openModel !== undefined) {
        const open = host.ownerDocument.createElement('button')
        open.type = 'button'
        open.textContent = localizer.text('card.openModel')
        open.title = model
        setPart(open, 'card.preview-open')
        open.addEventListener('click', () => openModel(model))
        host.append(open)
      }
      return mount
    },
  )
  const at = sections.findIndex(item => item.kind !== 'header')
  return at < 0
    ? [...sections, section]
    : [...sections.slice(0, at), section, ...sections.slice(at)]
}

export const subjectCardViewer: ViewerModule = createSubjectCardViewer()

export default subjectCardViewer

export { accordionField }
export { createSubjectWikiViewer, wikiKinds, WIKI_PAGE_SIZE } from './wiki.js'
export type { SubjectWikiViewerOptions } from './wiki.js'
