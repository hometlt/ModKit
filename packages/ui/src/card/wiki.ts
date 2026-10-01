/**
 * SubjectWiki — the entities of a mod by kind, MK2's wiki (plan 5.25).
 *
 * Over the `common.view/subject-selector-source` a subject publishes (an SC2 mod's card): the kinds
 * on the left with their counts, the subjects of the chosen kind in the middle as a list or a grid
 * of icons, searched by name and id, and the card of the chosen subject on the right. The card is
 * the host's own subject card started on that subject, so its links, history and sources work as in
 * a card opened by itself.
 */
import type {
  Lease,
  ModelResourceRef,
  SelectableSubject,
  SubjectSelectorSource,
  SubjectSelectorSummary,
  ViewerModule,
  ViewerMount,
} from '@modkit/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  rememberUiPreference,
  setViewerText,
  uiPreference,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import type { UiLocalizer } from '../localization/index.js'
import { CARD_WIKI_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'
import type { SubjectCardViewerOptions } from './index.js'

/** Subjects asked for at once; more come with «Show more». */
export const WIKI_PAGE_SIZE = 200
/** Icons decoded at the same time, as MK2's gallery decoded six. */
const WIKI_ICON_CONCURRENCY = 4
const WIKI_MODE = 'wiki.mode'

export interface SubjectWikiViewerOptions {
  readonly localizer?: UiLocalizer
  /** The card of one subject of the selector, started on it (`createSubjectCardViewer({ subject })`). */
  readonly card: (subjectId: string) => ViewerModule
  /** Decoded icons, by the logical image id a subject names as its portrait (the card's route). */
  readonly textures?: SubjectCardViewerOptions['textures']
}

/** The kinds a wiki lists on its left, with counts; one «all» entry when the source names none. */
export function wikiKinds(
  summary: SubjectSelectorSummary,
): readonly { readonly kind?: string; readonly count: number }[] {
  const kinds = summary.kinds?.filter(item => item.count > 0) ?? []
  return kinds.length > 0 ? kinds : [{ count: summary.totalSubjects }]
}

/** A subject's own id in its kind: the last segment of an address (`…/Unit/Marine` → `Marine`). */
export function wikiSubjectId(subjectId: string): string {
  if (!subjectId.includes('://')) return subjectId
  const tail = subjectId.split('/').filter(Boolean).at(-1) ?? subjectId
  try {
    return decodeURIComponent(tail)
  } catch {
    return tail
  }
}

export function createSubjectWikiViewer(options: SubjectWikiViewerOptions): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, CARD_WIKI_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.wiki'))
      const lease = (await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/subject-selector-source',
      )) as Lease<SubjectSelectorSource> | undefined
      if (lease === undefined) throw new TypeError('subject selector binding is unavailable')
      scope.lease(lease)
      const selector = lease.value
      const summary = await selector.summary(scope.signal)

      const wiki = element(root, 'div', { part: 'wiki' })
      const kindList = element(wiki, 'nav', { part: 'wiki.kinds' })
      kindList.setAttribute('aria-label', localizer.text('viewer.wikiKinds'))
      const pane = element(wiki, 'section', { part: 'wiki.pane' })
      const toolbar = element(pane, 'div', { part: 'wiki.toolbar', role: 'toolbar' })
      const search = element(toolbar, 'input', { part: 'wiki.search' }) as HTMLInputElement
      search.type = 'search'
      search.placeholder = localizer.text('viewer.wikiSearch')
      search.setAttribute('aria-label', localizer.text('viewer.wikiSearch'))
      const modeButton = element(toolbar, 'button', {
        part: 'operations.button',
      }) as HTMLButtonElement
      modeButton.type = 'button'
      const status = element(pane, 'output', { part: 'wiki.status' })
      if (summary.completeness !== 'complete' && summary.reason !== undefined)
        element(pane, 'p', {
          part: 'wiki.status',
          text: localizer.text('viewer.wikiIncomplete', { reason: summary.reason }),
        })
      const list = element(pane, 'ul', { part: 'wiki.subjects' })
      const more = element(pane, 'button', {
        part: 'operations.button',
        text: localizer.text('viewer.wikiMore'),
      }) as HTMLButtonElement
      more.type = 'button'
      more.hidden = true
      const cardHost = element(wiki, 'section', { part: 'wiki.card' })
      element(cardHost, 'p', { part: 'viewer.empty', text: localizer.text('viewer.wikiPick') })

      // a list of names or a grid of icons, as the reader last left it
      let mode: 'list' | 'grid' = uiPreference(WIKI_MODE) === 'grid' ? 'grid' : 'list'
      const showMode = (): void => {
        list.dataset['mode'] = mode
        setViewerText(
          modeButton,
          localizer.text(mode === 'list' ? 'viewer.wikiGrid' : 'viewer.wikiList'),
        )
      }
      showMode()
      modeButton.addEventListener(
        'click',
        () => {
          mode = mode === 'list' ? 'grid' : 'list'
          rememberUiPreference(WIKI_MODE, mode)
          showMode()
        },
        { signal: scope.signal },
      )

      const kinds = wikiKinds(summary)
      let kind = kinds[0]?.kind
      let cursor: string | undefined
      let shown = 0
      let listing: AbortController | undefined
      let selected: HTMLElement | undefined

      // The chosen subject's card, one at a time.
      let card: { readonly mount: ViewerMount; readonly scope: ViewerMountScope } | undefined
      const openCard = async (subject: SelectableSubject, row: HTMLElement): Promise<void> => {
        selected?.removeAttribute('aria-current')
        row.setAttribute('aria-current', 'true')
        selected = row
        const previous = card
        card = undefined
        await previous?.mount.unmount()
        await previous?.scope.close()
        const cardScope = new ViewerMountScope(scope.signal)
        const container = root.ownerDocument.createElement('div')
        cardHost.replaceChildren(container)
        try {
          const mount = await options.card(subject.subjectId).mount({
            ...args,
            container,
            signal: cardScope.signal,
          })
          card = { mount, scope: cardScope }
          wiki.dataset['subject'] = subject.subjectId
        } catch (error) {
          await cardScope.close()
          if (scope.signal.aborted) return
          element(cardHost, 'p', {
            part: 'viewer.empty',
            text: error instanceof Error ? error.message : String(error),
          })
        }
      }
      scope.cleanup(async () => {
        await card?.mount.unmount()
        await card?.scope.close()
      })

      // Icons decode a few at a time, for the rows on the page now; a new listing drops the rest.
      const drawIcons = async (
        rows: readonly { readonly portrait: string; readonly canvas: HTMLCanvasElement }[],
        signal: AbortSignal,
      ): Promise<void> => {
        const textures = options.textures
        if (textures === undefined) return
        const queue = [...rows]
        const worker = async (): Promise<void> => {
          for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
            if (signal.aborted) return
            const reference: ModelResourceRef = {
              id: next.portrait,
              role: 'texture',
              provenance: 'reference-only',
            }
            const decoded = await textures(args.descriptor, [reference], signal).catch(
              () => undefined,
            )
            const texture = decoded?.get(next.portrait)
            const context = next.canvas.getContext('2d')
            if (texture === undefined || texture.dimension === 'cube' || context === null) continue
            next.canvas.width = texture.width
            next.canvas.height = texture.height
            const pixels = new Uint8ClampedArray(texture.width * texture.height * 4)
            pixels.set(texture.rgba.subarray(0, pixels.length))
            context.putImageData(new ImageData(pixels, texture.width, texture.height), 0, 0)
            next.canvas.hidden = false
          }
        }
        await Promise.all(Array.from({ length: WIKI_ICON_CONCURRENCY }, () => worker()))
      }

      const total = (): number | undefined =>
        search.value.trim() === '' ? kinds.find(item => item.kind === kind)?.count : undefined
      const showStatus = (): void => {
        const all = total()
        setViewerText(
          status,
          shown === 0
            ? localizer.text('viewer.wikiEmpty')
            : all === undefined
              ? String(shown)
              : localizer.text('viewer.wikiShown', { shown, total: all }),
        )
      }

      /** One page of the chosen kind and search; `reset` starts the list over. */
      const load = async (reset: boolean): Promise<void> => {
        if (reset) {
          listing?.abort()
          list.replaceChildren()
          cursor = undefined
          shown = 0
        }
        // the mount's end aborts the latest listing too (cleanup below)
        const controller = new AbortController()
        listing = controller
        const signal = controller.signal
        const text = search.value.trim()
        try {
          const page = await selector.subjects(
            {
              limit: WIKI_PAGE_SIZE,
              ...(cursor === undefined ? {} : { cursor }),
              ...(kind === undefined ? {} : { kind }),
              ...(text === '' ? {} : { text }),
            },
            signal,
          )
          if (signal.aborted) return
          const icons: { portrait: string; canvas: HTMLCanvasElement }[] = []
          for (const subject of page.items) {
            const item = element(list, 'li', { part: 'wiki.subject' })
            const row = element(item, 'button') as HTMLButtonElement
            row.type = 'button'
            row.title = subject.subjectId
            const icon = element(row, 'canvas', { part: 'wiki.icon' }) as HTMLCanvasElement
            icon.hidden = true
            icon.setAttribute('aria-hidden', 'true')
            if (subject.portrait !== undefined)
              icons.push({ portrait: subject.portrait, canvas: icon })
            element(row, 'span', { text: subject.label })
            element(row, 'small', { part: 'wiki.id', text: wikiSubjectId(subject.subjectId) })
            row.addEventListener('click', () => void openCard(subject, row), {
              signal: scope.signal,
            })
          }
          shown += page.items.length
          cursor = page.nextCursor
          more.hidden = cursor === undefined
          showStatus()
          void drawIcons(icons, signal)
        } catch (error) {
          if (signal.aborted) return
          setViewerText(status, error instanceof Error ? error.message : String(error))
        }
      }

      for (const entry of kinds) {
        const button = element(kindList, 'button', { part: 'wiki.kind' }) as HTMLButtonElement
        button.type = 'button'
        element(button, 'span', { text: entry.kind ?? localizer.text('viewer.wikiAll') })
        element(button, 'small', { text: String(entry.count) })
        if (entry.kind === kind) button.setAttribute('aria-current', 'true')
        button.addEventListener(
          'click',
          () => {
            kindList.querySelector('[aria-current]')?.removeAttribute('aria-current')
            button.setAttribute('aria-current', 'true')
            kind = entry.kind
            void load(true)
          },
          { signal: scope.signal },
        )
      }
      let typing: ReturnType<typeof setTimeout> | undefined
      search.addEventListener(
        'input',
        () => {
          clearTimeout(typing)
          typing = setTimeout(() => void load(true), 250)
        },
        { signal: scope.signal },
      )
      more.addEventListener('click', () => void load(false), { signal: scope.signal })
      scope.cleanup(() => {
        clearTimeout(typing)
        listing?.abort()
      })
      await load(true)

      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
      })
    },
  })
}
