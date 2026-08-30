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
  JsonValue,
  KnowledgeCatalog,
  KnowledgeHit,
  KnowledgeTarget,
  Page,
  SubjectFact,
  SubjectFactsSource,
  ViewerModule,
} from '@modkitx-x3/sdk'
import { createAccordion, accordionField } from '../primitives/accordion.js'
import { setPart, setState } from '../parts.js'
import { setToken } from '../tokens/index.js'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  safeViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'

export interface CardRef {
  readonly label: string
  /** Where the value came from: a file and line, another subject, a schema node. */
  readonly href?: string
  readonly title?: string
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
  /** Rendered as a chip after the value: the origin subject, a unit, a schema hint. */
  readonly badge?: string
  readonly title?: string
  /** Exact codec-owned address for lazily resolving field help. */
  readonly knowledgeTarget?: KnowledgeTarget
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
  readonly label: string
  readonly sections: readonly CardSection[]
  /** Optional read-only knowledge snapshot; cards remain usable when it is absent. */
  readonly knowledge?: KnowledgeCatalog
  readonly knowledgeLocales?: readonly string[]
  onNavigate?(ref: CardRef): void
}

export interface SubjectCard {
  readonly root: HTMLElement
  destroy(): void
}

export interface SubjectCardLoadOptions {
  readonly groupLimit?: number
  readonly factsPerGroup?: number
  readonly relationLimit?: number
  readonly pageSize?: number
  readonly signal?: AbortSignal
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

function factValue(value: JsonValue): string {
  if (typeof value === 'string') return value
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return JSON.stringify(value)
}

function factField(fact: SubjectFact): CardField {
  const provenance = fact.provenance.map(item => item.label)
  return {
    name: fact.label,
    value: factValue(fact.value),
    ...(provenance.length === 0 ? {} : { badge: provenance[0] }),
    ...(provenance.length <= 1 ? {} : { title: provenance.join(' · ') }),
    ...(fact.knowledgeTarget === undefined ? {} : { knowledgeTarget: fact.knowledgeTarget }),
  }
}

/** Default host projection. The source publishes facts and never chooses a card component. */
export async function loadSubjectCardSections(
  source: SubjectFactsSource,
  options: SubjectCardLoadOptions = {},
): Promise<readonly CardSection[]> {
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
    notes.push('Fact groups are capped.')
  if (relations.capped || relations.items.length < summary.relationCount)
    notes.push('Related subjects are capped.')
  const sections: CardSection[] = [
    {
      kind: 'header',
      title: summary.identity.label,
      refs: summary.identity.origins.map(origin => ({
        label: origin.label,
        ...(origin.source === undefined ? {} : { href: origin.source.uri }),
      })),
      chips: [
        { label: summary.identity.kind },
        ...(summary.identity.type === undefined ? [] : [{ label: summary.identity.type }]),
      ],
      ...(notes.length === 0 ? {} : { notes }),
    },
  ]
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
  for (const { group, page } of factGroups) {
    sections.push({
      kind: 'fields',
      id: group.id,
      title:
        page.capped || page.items.length < group.factCount
          ? `${group.label} (capped)`
          : group.label,
      fields: page.items.map(factField),
      expanded: true,
    })
  }
  if (relations.items.length > 0) {
    sections.push({
      kind: 'links',
      id: 'related-subjects',
      title: 'Related subjects',
      links: relations.items.map(item => ({
        label: item.label,
        href: item.subjectId,
        title: `${item.role} · ${item.kind}`,
      })),
    })
  }
  return Object.freeze(sections)
}

function ref(document: Document, item: CardRef, onNavigate?: (ref: CardRef) => void): HTMLElement {
  const node = document.createElement(onNavigate === undefined ? 'span' : 'button')
  node.className = 'modkit-card__ref'
  setPart(node, 'card.ref')
  node.textContent = safeViewerText(item.label, 256)
  if (item.title !== undefined) node.title = item.title
  if (onNavigate !== undefined) {
    ;(node as HTMLButtonElement).type = 'button'
    node.addEventListener('click', () => onNavigate(item))
  }
  return node
}

function renderHeader(
  document: Document,
  host: HTMLElement,
  section: Extract<CardSection, { kind: 'header' }>,
  onNavigate?: (ref: CardRef) => void,
): void {
  const header = document.createElement('div')
  header.className = 'modkit-card__header'
  setPart(header, 'card.header')

  if (section.portrait !== undefined) {
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

  const title = document.createElement('h2')
  title.className = 'modkit-card__title'
  title.textContent = safeViewerText(section.title, 256)
  setPart(title, 'card.title')
  identity.append(title)

  if (section.refs !== undefined && section.refs.length > 0) {
    const subtitle = document.createElement('div')
    subtitle.className = 'modkit-card__subtitle'
    setPart(subtitle, 'card.subtitle')
    for (const item of section.refs) subtitle.append(ref(document, item, onNavigate))
    identity.append(subtitle)
  }

  if (section.chips !== undefined && section.chips.length > 0) {
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
    select.setAttribute('aria-label', 'Locale')
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

  host.append(header)
}

function renderFields(
  document: Document,
  host: HTMLElement,
  fields: readonly CardField[],
  inspectKnowledge?: (target: KnowledgeTarget | undefined) => void,
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
    const name = document.createElement('span')
    name.textContent = safeViewerText(field.name, 128)
    setPart(name, 'card.field-name')
    const value = document.createElement('span')
    value.textContent = safeViewerText(field.value, 2048)
    setPart(value, 'card.field-value')
    row.append(name, value)
    if (field.badge !== undefined) {
      const badge = document.createElement('span')
      badge.className = 'modkit-card__chip'
      badge.dataset['tone'] = 'neutral'
      badge.textContent = safeViewerText(field.badge, 48)
      setPart(badge, 'card.chip')
      row.append(badge)
    }
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
  const root = document.createElement('article')
  root.className = 'modkit-card'
  root.setAttribute('aria-label', options.label)
  setPart(root, 'card')

  const header = options.sections.find(section => section.kind === 'header')
  if (header !== undefined) renderHeader(document, root, header, options.onNavigate)

  const knowledge = document.createElement('aside')
  knowledge.className = 'modkit-card__knowledge'
  knowledge.setAttribute('role', 'status')
  knowledge.setAttribute('aria-live', 'polite')
  knowledge.dataset['knowledgeState'] = 'missing'
  setPart(knowledge, 'card.knowledge')
  knowledge.textContent = 'Description is not available yet.'
  root.append(knowledge)

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
    knowledge.textContent = 'Description is not available yet.'
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
    knowledge.textContent = 'Loading description…'
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
    label: `${options.label} sections`,
    sections: collapsible.map(section => ({
      id: section.id,
      title: section.title,
      ...(section.expanded === undefined ? {} : { expanded: section.expanded }),
      render(panel: HTMLElement) {
        setPart(panel.parentElement ?? panel, 'accordion.section')
        switch (section.kind) {
          case 'fields':
            renderFields(document, panel, section.fields, inspectKnowledge)
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
      accordion.destroy()
      root.remove()
    },
  }
}

/** Standard stage adapter over the codec-owned, presentation-neutral subject facts source. */
export const subjectCardViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Subject card')
    try {
      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/subject-facts-source',
      )
      if (lease === undefined) throw new TypeError('subject facts binding is unavailable')
      scope.lease(lease)
      const sections = await loadSubjectCardSections(lease.value as SubjectFactsSource, {
        signal: scope.signal,
      })
      const card = createSubjectCard(root.ownerDocument, {
        label: 'Subject card',
        sections,
        ...(args.knowledge === undefined ? {} : { knowledge: args.knowledge }),
      })
      root.append(card.root)
      scope.cleanup(() => card.destroy())
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

export default subjectCardViewer

export { accordionField }
