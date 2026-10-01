/**
 * A table whose value columns are variants of one another — a localization table is the case.
 *
 * Everything format-specific arrives as data: `columnInfo` says which column is the key, which are
 * variants (and which of those is the base), and `actions` names the operations for adding a row,
 * comparing a variant with the base and translating. This module only searches, filters and routes
 * requests; every write is an edit plan through `commitOperationWrite`, and value edits wait in a
 * draft until Save writes them as one.
 */
import type {
  AnyDescriptor,
  JsonValue,
  OperationSession,
  Row,
  TableActions,
  TableColumnInfo,
  TableDataSource,
  TableValueRendering,
  TableVariantComparison,
  CommitCoordinator,
  EditAuthorizationPort,
  ViewerWorkspaceDocument,
} from '@modkit/sdk'
import { isGameTemplateTextRun, type GameTemplateTextRun } from '@modkit/sdk/templates'
import type { GameTemplateImageResolver } from '../template/index.js'
import { createToolbar } from '../toolbar/index.js'
import { compileMatcher, compilePattern, textMatches, type TextMatcher } from '../filter/index.js'
import { setState } from '../parts.js'
import { element, invokeOperation, setPart, setViewerText } from '../viewer/index.js'
import { commitOperationWrite } from '../field-write/index.js'
import { invokeRefusalMessage } from '../field-editor/index.js'
import {
  announceEditorEdit,
  handleEditorHistoryRequest,
  handleEditorSaveRequest,
} from '../editor/commands.js'
import type { UiLocalizer } from '../localization/index.js'
import { TABLE_VARIANTS_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

/** Rows drawn per page of the filtered list. */
export const VARIANT_PAGE_ROWS = 200
/** Rows read per request while loading the whole table. */
const LOAD_PAGE_ROWS = 1000
/** Cells one translate click sends; the rest wait for the next click. */
export const TRANSLATE_BATCH = 50
/** Values one render request carries: a page of a dozen locales is a few requests, not one per cell. */
export const RENDER_BATCH = 400
/** A run's colour is drawn only in this form; anything else stays the default colour. */
const RUN_COLOR = /^#[0-9a-f]{6}$/iu

const FILTER_LABELS = {
  missing: 'table.filterMissing',
  untranslated: 'table.filterUntranslated',
  duplicate: 'table.filterDuplicate',
  empty: 'table.filterEmpty',
  // a value the codec's checks refuse in some locale (SC2: markup, a hotkey)
  error: 'table.filterErrors',
  changed: 'table.filterChanged',
} as const
const COMPARE_LABELS = {
  missing: 'table.filterMissing',
  untranslated: 'table.filterUntranslated',
  empty: 'table.compareEmpty',
  orphaned: 'table.compareOrphaned',
} as const
/** The toggles a filter and the find bar each carry. */
const MATCH_TOGGLES = [
  ['case', 'Aa', 'filter.matchCase', 'caseSensitive'],
  ['word', 'ab', 'filter.wholeWord', 'wholeWord'],
  ['regex', '.*', 'filter.regex', 'regex'],
] as const

type Shape = Awaited<ReturnType<TableDataSource['shape']>>

export interface VariantTableArgs {
  readonly root: HTMLElement
  readonly source: TableDataSource
  readonly shape: Shape
  readonly descriptor: AnyDescriptor
  readonly operations: OperationSession
  readonly commit?: CommitCoordinator
  readonly authorization?: EditAuthorizationPort
  readonly signal: AbortSignal
  readonly localizer?: UiLocalizer
  /** Draws rows with the table's own cells and inline editing. */
  readonly render: (rows: readonly Row[]) => readonly HTMLTableRowElement[]
  /** Called after any committed write; `true` means the host reopens the subject. */
  readonly committed: () => Promise<void>
  readonly writeRefusal?: () => string | undefined
  /** The rows' own element; the controls are placed above it. */
  readonly before: HTMLElement
  /** The documents around the subject, for the codec's render operation (its style sheet, say). */
  readonly documents?: () => Promise<readonly ViewerWorkspaceDocument[] | undefined>
  /** Pixels for the inline images a rendered value names. */
  readonly images?: GameTemplateImageResolver
  /** Puts what the open cell editors hold into the draft, before a save writes it. */
  readonly flush?: () => Promise<void>
}

export interface VariantTable {
  /** A cell write the table committed, so filters and status follow it. */
  written(row: number, column: number, value: string): void
  /** Whether an edit of this column waits in the draft rather than being written at once. */
  drafts(column: number): boolean
  /** The value the table holds for a cell — the draft's, which the pinned source does not know. */
  value(row: number, column: number): string | undefined
  /** One cell's new value into the draft; `false` when that changed nothing. */
  draft(row: number, column: number, value: string): boolean
  /** Why a cell of this column cannot be edited now: a save in flight, or a draft to keep. */
  refusal(column: number): string | undefined
}

/**
 * One value as runs. Text goes in through `textContent` and a colour only as `#rrggbb`; an image is
 * a named slot the host's pixels replace later, and an unresolved run is marked with why.
 */
function drawRuns(cell: HTMLTableCellElement, runs: readonly GameTemplateTextRun[]): void {
  const document = cell.ownerDocument
  cell.dataset['rendered'] = 'true'
  cell.replaceChildren()
  for (const run of runs) {
    if (run.asset !== undefined) {
      const slot = document.createElement('span')
      setPart(slot, 'table.asset')
      slot.dataset['asset'] = run.asset
      slot.title = run.asset
      setViewerText(slot, run.asset.split(/[\\/]/u).pop() ?? run.asset)
      cell.append(slot)
      continue
    }
    run.text.split('\n').forEach((line, index) => {
      if (index > 0) cell.append(document.createElement('br'))
      if (line === '') return
      const span = document.createElement('span')
      setViewerText(span, line)
      if (run.color !== undefined && RUN_COLOR.test(run.color)) span.style.color = run.color
      if (run.bold === true) span.style.fontWeight = 'bold'
      if (run.italic === true) span.style.fontStyle = 'italic'
      if (run.underline === true) span.style.textDecoration = 'underline'
      // A style sheet's glyph height, relative to a 16-unit body and kept readable in a row.
      if (run.size !== undefined) {
        span.style.fontSize = `${Math.min(2, Math.max(0.75, run.size / 16))}em`
      }
      if (run.unresolved !== undefined) {
        setPart(span, 'table.unresolved')
        span.title = run.unresolved
      }
      cell.append(span)
    })
  }
}

/** `pattern` is global, so its position is reset before every use. */
function found(value: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0
  return pattern.test(value)
}

/** Wrap what `pattern` finds in each text node of `cell`; a match across two nodes stays unmarked. */
function markMatches(cell: HTMLElement, pattern: RegExp): boolean {
  const document = cell.ownerDocument
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
    nodes.push(node as Text)
  let marked = false
  for (const node of nodes) {
    const parts: Node[] = []
    let last = 0
    pattern.lastIndex = 0
    for (const match of node.data.matchAll(pattern)) {
      if (match[0] === '') continue
      const from = match.index ?? 0
      parts.push(document.createTextNode(node.data.slice(last, from)))
      const mark = document.createElement('mark')
      setPart(mark, 'table.match')
      mark.textContent = match[0]
      parts.push(mark)
      last = from + match[0].length
    }
    if (parts.length === 0) continue
    parts.push(document.createTextNode(node.data.slice(last)))
    node.replaceWith(...parts)
    marked = true
  }
  return marked
}

/** The find bar (Ctrl+F) and its replace row (Ctrl+H). */
interface FindState {
  open: boolean
  replacing: boolean
  text: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  replace: string
  /** Which of the matching rows the bar stands on. */
  at: number
}

/** Filter state kept across a reopen of the same subject. */
interface FilterState {
  search: string
  /** The quick filter's toggles; its text is `search`. */
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  /** Kept open across the reopen a replace causes, so the next Replace goes on from there. */
  find: FindState
  group: string
  statuses: string[]
  /** Headers of the columns the reader hid; a dozen locales do not fit side by side. */
  hidden: string[]
  /** Values drawn as the game shows them rather than as stored. */
  render: boolean
  /** Long values wrap in their cells instead of running off the side (MK2's table, plan 7.36). */
  wrap?: boolean
}
const remembered = new Map<string, FilterState>()

export async function mountVariantTable(args: VariantTableArgs): Promise<VariantTable> {
  const text = withEnglishUiFallback(args.localizer, TABLE_VARIANTS_FALLBACK_MESSAGES).text
  const info: readonly TableColumnInfo[] = args.shape.columnInfo ?? []
  const actions: TableActions = args.shape.actions ?? {}
  const header = args.shape.header ?? []
  const keyColumn = Math.max(
    0,
    info.findIndex(column => column.role === 'key'),
  )
  const statusColumn = info.findIndex(column => column.role === 'status')
  const variants = info.flatMap((column, index) =>
    column.role === 'variant' && column.variant !== undefined ? [{ ...column, index }] : [],
  )
  const base = variants.find(column => column.base === true) ?? variants[0]
  const separator = args.shape.keySeparator

  // The whole table, once: search and filters work on every row, not on the page on screen.
  const rows: Row[] = []
  for (let from = 0; ; from += LOAD_PAGE_ROWS) {
    const page = await args.source.rows({ kind: 'range', from, count: LOAD_PAGE_ROWS }, args.signal)
    rows.push(...page.items.map(row => ({ index: row.index, cells: [...row.cells] })))
    if (page.nextCursor === undefined || page.items.length === 0) break
  }
  const changed = new Set<number>()
  /** Rows with a value in the draft; they count as changed as well. */
  let draftedRows = new Set<number>()
  const selected = new Set<number>()
  const statusOf = (row: Row): readonly string[] => [
    ...(statusColumn < 0 ? [] : (row.cells[statusColumn] ?? '').split(' ').filter(Boolean)),
    // a locale without a value, missing or blank (MK2's «empty» filter)
    ...(variants.some(column => (row.cells[column.index] ?? '') === '') ? ['empty'] : []),
    ...(changed.has(row.index) || draftedRows.has(row.index) ? ['changed'] : []),
  ]
  const state: FilterState = remembered.get(args.descriptor.subjectUri) ?? {
    search: '',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    find: {
      open: false,
      replacing: false,
      text: '',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      replace: '',
      at: 0,
    },
    group: '',
    statuses: [],
    hidden: [],
    render: false,
  }
  remembered.set(args.descriptor.subjectUri, state)

  const bar = element(args.root, 'div', { part: 'table.controls' })
  const status = element(args.root, 'output', { part: 'viewer.status' })
  status.setAttribute('role', 'status')
  const say = (message: string): void => setViewerText(status, message, 1024)
  const panel = element(args.root, 'section', { part: 'table.panel' })
  panel.hidden = true
  args.before.before(bar, status, panel)
  const applyWrap = (): void => {
    if (state.wrap === true) args.before.dataset['wrap'] = 'true'
    else delete args.before.dataset['wrap']
  }
  const statuses = ['missing', 'untranslated', 'duplicate', 'empty', 'error', 'changed'] as const
  const matchToggles = (
    target: { caseSensitive: boolean; wholeWord: boolean; regex: boolean },
    prefix: string,
    changed: () => void,
  ) =>
    MATCH_TOGGLES.map(([id, glyph, label, key]) => ({
      kind: 'toggle' as const,
      id: `${prefix}-${id}`,
      glyph,
      label: text(label),
      active: target[key],
      onToggle: (active: boolean) => {
        target[key] = active
        changed()
      },
    }))
  const toolbar = createToolbar(bar, {
    label: text('table.filters'),
    items: [
      {
        kind: 'search',
        id: 'search',
        label: text('table.search'),
        placeholder: text('table.search'),
        value: state.search,
        onInput: value => {
          state.search = value
          refresh()
        },
      },
      ...matchToggles(state, 'filter', () => refresh()),
      ...statuses.map(id => ({
        kind: 'chip' as const,
        id,
        label: text(FILTER_LABELS[id]),
        active: state.statuses.includes(id),
        onToggle: (active: boolean) => {
          state.statuses = active
            ? [...state.statuses, id]
            : state.statuses.filter(item => item !== id)
          toolbar.setActive(id, active)
          refresh()
        },
      })),
      { kind: 'separator' },
      {
        kind: 'toggle' as const,
        id: 'wrap',
        label: text('table.wrap'),
        active: state.wrap === true,
        onToggle: (active: boolean) => {
          state.wrap = active
          toolbar.setActive('wrap', active)
          applyWrap()
        },
      },
      ...(actions.renderValues === undefined
        ? []
        : [
            {
              kind: 'toggle' as const,
              id: 'render',
              label: text('table.render'),
              active: state.render,
              onToggle: (active: boolean) => {
                state.render = active
                toolbar.setActive('render', active)
                draw()
              },
            },
          ]),
      ...(actions.addRow === undefined || base === undefined
        ? []
        : [
            {
              kind: 'action' as const,
              id: 'add',
              label: text('table.addKey'),
              onActivate: () => showAdd(),
            },
            // the key across every locale at once, as MK2's table renamed and removed it
            {
              kind: 'action' as const,
              id: 'rename',
              label: text('table.renameKey'),
              onActivate: () => showRename(),
            },
            {
              kind: 'action' as const,
              id: 'delete',
              label: text('table.deleteKey'),
              onActivate: () => showDelete(),
            },
          ]),
      ...(actions.compareVariants === undefined || variants.length < 2
        ? []
        : [
            {
              kind: 'action' as const,
              id: 'compare',
              label: text('table.compare'),
              onActivate: () => void compare(),
            },
          ]),
      ...(actions.translateVariant === undefined || variants.length < 2
        ? []
        : [
            {
              kind: 'action' as const,
              id: 'translate',
              label: text('table.translate'),
              disabled: true,
              onActivate: () => void translate(),
            },
          ]),
    ],
  })
  applyWrap()

  // Key groups from the key path, so one area can be worked through at a time.
  const group = element(bar, 'select', { part: 'table.group' }) as HTMLSelectElement
  group.setAttribute('aria-label', text('table.group'))
  const counts = new Map<string, number>()
  if (separator !== undefined) {
    for (const row of rows) {
      const parts = (row.cells[keyColumn] ?? '').split(separator)
      for (let depth = 1; depth < Math.min(parts.length, 3); depth += 1) {
        const prefix = parts.slice(0, depth).join(separator) + separator
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
      }
    }
  }
  const option = (value: string, label: string) => {
    const node = group.ownerDocument.createElement('option')
    node.value = value
    node.textContent = label
    group.append(node)
  }
  option('', text('table.groupAll'))
  for (const [prefix, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    option(prefix, `${prefix} (${count})`)
  }
  group.value = state.group
  group.hidden = counts.size === 0
  group.addEventListener('change', () => {
    state.group = group.value
    refresh()
  })

  const target = element(bar, 'select', { part: 'table.group' }) as HTMLSelectElement
  target.setAttribute('aria-label', text('table.translateTarget'))
  for (const column of variants.filter(column => column !== base)) {
    const node = target.ownerDocument.createElement('option')
    node.value = String(column.index)
    node.textContent = column.variant ?? header[column.index] ?? ''
    target.append(node)
  }
  target.hidden = actions.translateVariant === undefined || variants.length < 2

  // Every column but the key can be hidden; the choice follows the subject across reopens.
  const columns = element(bar, 'details', { part: 'table.columns' })
  element(columns, 'summary', { text: text('table.columns') })
  const choices = element(columns, 'div', {})
  const isHidden = (column: number): boolean => state.hidden.includes(header[column] ?? '')
  const showColumns = (): void => {
    const head = (args.before as HTMLTableElement).tHead?.rows[0]
    // Each drawn row and the head start with the selection cell, so column c sits at c + 1.
    for (const tr of [...(head === undefined ? [] : [head]), ...drawnRows]) {
      header.forEach((_, column) => {
        const cell = tr.cells[column + 1]
        if (cell !== undefined) cell.hidden = isHidden(column)
      })
    }
  }
  header.forEach((label, column) => {
    if (column === keyColumn) return
    const line = element(choices, 'label', {})
    const box = element(line, 'input', {}) as HTMLInputElement
    box.type = 'checkbox'
    box.checked = !isHidden(column)
    line.append(line.ownerDocument.createTextNode(` ${label}`))
    box.addEventListener('change', () => {
      state.hidden = box.checked
        ? state.hidden.filter(item => item !== label)
        : [...state.hidden, label]
      // the find bar counts only the columns on screen
      if (state.find.open) seek()
      else showColumns()
    })
  })
  columns.hidden = header.length < 3

  // The draft's Save and Revert; VS Code takes both into its own Save and Revert File.
  const drafting = actions.addRow !== undefined
  const draftButton = (label: string, action: string, run: () => void): HTMLButtonElement => {
    const button = element(bar, 'button', {
      part: 'toolbar.action',
      text: label,
    }) as HTMLButtonElement
    button.type = 'button'
    button.disabled = true
    button.hidden = !drafting
    button.dataset['modkitAction'] = action
    button.addEventListener('click', run)
    return button
  }
  const saveButton = draftButton(text('table.save'), 'save', () => void saveDraft(true))
  const revertButton = draftButton(text('table.revert'), 'revert', () => revertDraft())

  const more = element(args.root, 'button', {
    part: 'table.next',
    text: text('table.more'),
  }) as HTMLButtonElement
  more.type = 'button'
  let visible: Row[] = []
  let shown = 0
  let keyFilter: ReadonlySet<string> | undefined
  let drawnRows: readonly HTMLTableRowElement[] = []
  let filterMatcher: TextMatcher = null
  let filterError = ''

  const matches = (row: Row): boolean => {
    const key = row.cells[keyColumn] ?? ''
    if (keyFilter !== undefined && !keyFilter.has(key)) return false
    if (state.group !== '' && !key.startsWith(state.group)) return false
    const flags = statusOf(row)
    if (state.statuses.length > 0 && !state.statuses.some(item => flags.includes(item)))
      return false
    return filterMatcher === null || row.cells.some(cell => textMatches(cell, filterMatcher))
  }

  /*
   * The find bar walks the rows the filters leave, over the key and the locale columns on screen;
   * a replace writes only locale values, and only those that are not empty: a pattern that matches
   * nothing must not add a key to a locale that lacks it.
   */
  const replaceable = actions.addRow !== undefined && variants.length > 0
  const find = element(args.root, 'div', { part: 'table.find' })
  status.after(find)
  let findPattern: RegExp | null | false = null
  let findError = ''
  /** Positions in `visible` of the rows with a match. */
  let findRows: number[] = []
  const findToolbar = createToolbar(find, {
    label: text('table.find'),
    items: [
      {
        kind: 'search',
        id: 'find',
        label: text('table.find'),
        placeholder: text('table.find'),
        value: state.find.text,
        onInput: value => {
          state.find.text = value
          state.find.at = 0
          seek()
        },
        onSubmit: (_value, backwards) => step(backwards ? -1 : 1),
      },
      ...matchToggles(state.find, 'find', () => {
        state.find.at = 0
        seek()
      }),
      { kind: 'label', id: 'count', text: '' },
      {
        kind: 'action',
        id: 'previous',
        glyph: '↑',
        label: text('table.findPrevious'),
        onActivate: () => step(-1),
      },
      {
        kind: 'action',
        id: 'next',
        glyph: '↓',
        label: text('table.findNext'),
        onActivate: () => step(1),
      },
      ...(replaceable
        ? [
            {
              kind: 'toggle' as const,
              id: 'replace',
              glyph: '⇄',
              label: text('table.replaceToggle'),
              active: state.find.replacing,
              onToggle: (active: boolean) => {
                state.find.replacing = active
                showFind()
              },
            },
          ]
        : []),
      {
        kind: 'action',
        id: 'close',
        glyph: '×',
        label: text('table.findClose'),
        onActivate: () => closeFind(),
      },
    ],
  })
  const replaceToolbar = createToolbar(find, {
    label: text('table.replaceWith'),
    items: [
      {
        kind: 'search',
        id: 'replace',
        label: text('table.replaceWith'),
        placeholder: text('table.replaceWith'),
        value: state.find.replace,
        onInput: value => {
          state.find.replace = value
        },
        onSubmit: () => replaceNext(),
      },
      {
        kind: 'action',
        id: 'replace-one',
        label: text('table.replaceOne'),
        onActivate: () => replaceNext(),
      },
      {
        kind: 'action',
        id: 'replace-all',
        label: text('table.replaceAll'),
        onActivate: () => replaceAll(),
      },
    ],
  })
  const findColumns = (): readonly number[] =>
    [keyColumn, ...variants.map(column => column.index)].filter(column => !isHidden(column))
  const showFind = (): void => {
    find.hidden = !state.find.open
    replaceToolbar.root.hidden = !(replaceable && state.find.replacing)
    findToolbar.setActive('replace', state.find.replacing)
  }
  const recount = (): void => {
    findError = ''
    findPattern = state.find.open
      ? compilePattern(state.find, message => {
          findError = message
        })
      : null
    const pattern = findPattern
    const columns = findColumns()
    findRows =
      pattern instanceof RegExp
        ? visible.flatMap((row, position) =>
            columns.some(column => found(row.cells[column] ?? '', pattern)) ? [position] : [],
          )
        : []
    state.find.at = findRows.length === 0 ? 0 : Math.min(state.find.at, findRows.length - 1)
  }
  /** The row the bar stands on and the count; the marks come with each draw. */
  const markCurrent = (): void => {
    const current = findRows[state.find.at]
    drawnRows.forEach((tr, position) => setState(tr, position === current ? ['active'] : []))
    findToolbar.setText(
      'count',
      findError !== ''
        ? findError
        : !(findPattern instanceof RegExp)
          ? ''
          : findRows.length === 0
            ? text('table.findNone')
            : text('table.findCount', { current: state.find.at + 1, total: findRows.length }),
    )
    findToolbar.root.querySelector('input')?.setAttribute('aria-invalid', String(findError !== ''))
  }
  const decorate = (): void => {
    const pattern = findPattern
    if (pattern instanceof RegExp) {
      const columns = findColumns()
      for (const tr of drawnRows) {
        for (const column of columns) {
          const cell = tr.cells[column + 1]
          // A marked cell keeps its marks: the syntax runs drawn on hover would replace them.
          if (cell !== undefined && markMatches(cell, pattern)) cell.dataset['highlighted'] = 'true'
        }
      }
    }
    markCurrent()
  }
  /** Draw far enough to show the row the bar stands on, then bring it into view. */
  const reveal = (redraw: boolean): void => {
    const position = findRows[state.find.at]
    if (position !== undefined && position >= shown) {
      shown = (Math.floor(position / VARIANT_PAGE_ROWS) + 1) * VARIANT_PAGE_ROWS
      redraw = true
    }
    if (redraw) draw()
    else markCurrent()
    if (position !== undefined) drawnRows[position]?.scrollIntoView({ block: 'nearest' })
  }
  const seek = (): void => {
    recount()
    reveal(true)
  }
  const step = (delta: number): void => {
    if (findRows.length === 0) return
    state.find.at = (state.find.at + delta + findRows.length) % findRows.length
    reveal(false)
  }
  const openFind = (replacing: boolean): void => {
    state.find.open = true
    if (replacing && replaceable) state.find.replacing = true
    showFind()
    seek()
    const input = findToolbar.root.querySelector('input')
    input?.focus()
    input?.select()
  }
  const closeFind = (): void => {
    state.find.open = false
    showFind()
    recount()
    draw()
  }
  // Ctrl+F finds and Ctrl+H replaces, as in an editor; the keys go no further than this table.
  args.root.addEventListener(
    'keydown',
    event => {
      const finding = (event.ctrlKey || event.metaKey) && event.code === 'KeyF'
      const replacing = event.ctrlKey && event.code === 'KeyH'
      if ((!finding && !replacing) || event.altKey || event.shiftKey) return
      event.preventDefault()
      event.stopPropagation()
      openFind(replacing)
    },
    { signal: args.signal },
  )
  find.addEventListener(
    'keydown',
    event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeFind()
    },
    { signal: args.signal },
  )

  const draw = (): void => {
    const page = visible.slice(0, shown)
    const drawn = args.render(page)
    drawn.forEach((tr, position) => {
      const row = page[position]
      if (row === undefined) return
      const cell = tr.insertCell(0)
      setPart(cell, 'table.select')
      const box = cell.ownerDocument.createElement('input')
      box.type = 'checkbox'
      box.checked = selected.has(row.index)
      box.setAttribute('aria-label', text('table.selectRow', { key: row.cells[keyColumn] ?? '' }))
      box.addEventListener('change', () => {
        if (box.checked) selected.add(row.index)
        else selected.delete(row.index)
      })
      cell.append(box)
      for (const column of variants) {
        const valueCell = tr.cells[column.index + 1]
        if (valueCell === undefined) continue
        // each locale's state at a glance, as MK2 coloured its cells: no value, or still the base's
        const value = row.cells[column.index] ?? ''
        const state =
          value === ''
            ? ('empty' as const)
            : base !== undefined && column.index !== base.index && value === row.cells[base.index]
              ? ('stale' as const)
              : undefined
        const states = [
          ...(draft.has(`${row.index}:${column.index}`) ? (['mutating'] as const) : []),
          ...(state === undefined ? [] : [state]),
        ]
        if (states.length > 0) setState(valueCell, states)
        if (state !== undefined) {
          const key = state === 'empty' ? 'table.cellMissing' : 'table.cellUntranslated'
          valueCell.title = text(key, { locale: column.variant ?? '' })
        }
      }
    })
    drawnRows = drawn
    showColumns()
    decorate()
    more.hidden = shown >= visible.length
    say(
      filterError !== ''
        ? filterError
        : text('table.shown', { shown: Math.min(shown, visible.length), total: rows.length }),
    )
    void renderPage(drawn, page).catch(error => {
      if (!args.signal.aborted) {
        say(text('table.renderRefused', { reason: error instanceof Error ? error.message : String(error) }))
      }
    })
  }

  let renderPass = 0
  /** The page's values as the game shows them, asked for in batches; a newer draw drops the answer. */
  const renderPage = async (
    drawn: readonly HTMLTableRowElement[],
    page: readonly Row[],
  ): Promise<void> => {
    const pass = ++renderPass
    if (!state.render || actions.renderValues === undefined) return
    const cells: { cell: HTMLTableCellElement; column: number; text: string }[] = []
    drawn.forEach((tr, position) => {
      const row = page[position]
      if (row === undefined) return
      for (const column of variants) {
        const value = row.cells[column.index] ?? ''
        // Each drawn row starts with the selection cell, so column c sits at c + 1.
        const cell = tr.cells[column.index + 1]
        if (value !== '' && cell !== undefined) cells.push({ cell, column: column.index, text: value })
      }
    })
    const workspaceDocuments = await args.documents?.()
    for (let from = 0; from < cells.length; from += RENDER_BATCH) {
      const batch = cells.slice(from, from + RENDER_BATCH)
      const result = await invokeOperation(
        args.descriptor,
        args.operations,
        actions.renderValues,
        {
          items: batch.map(({ column, text }) => ({ column, text })),
          ...(workspaceDocuments === undefined ? {} : { workspaceDocuments }),
        } as unknown as JsonValue,
        { signal: args.signal },
      )
      if (pass !== renderPass || args.signal.aborted) return
      if (result.state !== 'ok' || result.output.kind !== 'json') {
        const reason = result.state === 'ok' ? result.output.kind : invokeRefusalMessage(result)
        say(text('table.renderRefused', { reason }))
        return
      }
      const answer = result.output.value as unknown as Partial<TableValueRendering>
      const assets = new Set<string>()
      batch.forEach((item, index) => {
        const runs = answer.items?.[index]?.runs
        if (!Array.isArray(runs) || item.cell.dataset['editing'] === 'true') return
        const valid = runs.filter(isGameTemplateTextRun)
        drawRuns(item.cell, valid)
        if (findPattern instanceof RegExp) markMatches(item.cell, findPattern)
        for (const run of valid) if (run.asset !== undefined) assets.add(run.asset)
      })
      if (assets.size === 0 || args.images === undefined) continue
      const pixels = await args.images(args.descriptor, [...assets], args.signal)
      if (pass !== renderPass || args.signal.aborted) return
      for (const { cell } of batch) {
        for (const slot of cell.querySelectorAll<HTMLElement>('[data-asset]')) {
          const url = pixels.get(slot.dataset['asset'] ?? '')
          if (url === undefined) continue
          const image = slot.ownerDocument.createElement('img')
          image.src = url
          image.alt = slot.title
          image.title = slot.title
          image.style.height = '1.2em'
          image.style.verticalAlign = 'text-bottom'
          slot.replaceWith(image)
        }
      }
    }
  }

  const refresh = (): void => {
    filterMatcher = compileMatcher({ ...state, text: state.search }, message => {
      filterError = message
    })
    toolbar.root.querySelector('input')?.setAttribute('aria-invalid', String(filterError !== ''))
    visible = rows.filter(matches)
    shown = VARIANT_PAGE_ROWS
    for (const id of statuses) {
      toolbar.setCount(id, rows.filter(row => statusOf(row).includes(id)).length)
    }
    recount()
    draw()
  }
  more.addEventListener('click', () => {
    shown += VARIANT_PAGE_ROWS
    draw()
  })

  const route = {
    descriptor: args.descriptor,
    operations: args.operations,
    ...(args.commit === undefined ? {} : { commit: args.commit }),
    ...(args.authorization === undefined ? {} : { authorization: args.authorization }),
  }
  let writing = false
  /** `reopen: false` when the host reopens the subject after its own save (VS Code's Ctrl+S). */
  const write = async (operation: string, input: JsonValue, reopen = true): Promise<boolean> => {
    if (writing || args.signal.aborted) return false
    const stale = args.writeRefusal?.()
    if (stale !== undefined) {
      say(text('table.refused', { reason: stale }))
      return false
    }
    const refused = (reason: string): false => {
      say(text('table.refused', { reason }))
      return false
    }
    writing = true
    try {
      say(text('table.working'))
      const refusal = await commitOperationWrite(route, operation, input, args.signal)
      if (refusal !== undefined) return refused(refusal)
      say(text('table.saved'))
      if (reopen) await args.committed()
      return true
    } catch (error) {
      return refused(error instanceof Error ? error.message : String(error))
    } finally {
      writing = false
    }
  }

  type VariantColumn = (typeof variants)[number]
  interface Change {
    readonly row: Row
    readonly column: VariantColumn
    readonly value: string
  }
  /** A plain replacement is taken as it is; an expression's may name its groups (`$1`). */
  const replaced = (value: string): string => {
    const pattern = findPattern
    if (!(pattern instanceof RegExp) || value === '') return value
    const replacement = state.find.replace
    return state.find.regex
      ? value.replace(pattern, replacement)
      : value.replace(pattern, () => replacement)
  }
  const changesIn = (row: Row): Change[] =>
    variants.flatMap(column => {
      if (isHidden(column.index)) return []
      const value = row.cells[column.index] ?? ''
      const next = replaced(value)
      return next === value ? [] : [{ row, column, value: next }]
    })
  /*
   * Value edits wait in a draft until Save, as MK2's table edited the file's buffer: Save writes
   * every edited locale as one plan, Revert drops the draft, and each cell edit, replace or accepted
   * translation is one step of the host's Undo (VS Code's Ctrl+Z, through the editor history
   * request). Adding, renaming and deleting a key are written at once, so they wait for an empty
   * draft: the reopen after their write would drop it.
   */
  interface DraftChange {
    readonly row: Row
    readonly column: VariantColumn
    readonly from: string
    readonly to: string
  }
  /** Each drafted cell with its value as the source holds it, by `row:column`. */
  const draft = new Map<string, { row: Row; column: VariantColumn; saved: string }>()
  const undoSteps: DraftChange[][] = []
  const redoSteps: DraftChange[][] = []
  /** A save puts the open cell editors into the draft first, without a step for the host's Undo. */
  let flushing = false
  const put = (row: Row, column: VariantColumn, value: string): void => {
    const id = `${row.index}:${column.index}`
    const saved = draft.get(id)?.saved ?? row.cells[column.index] ?? ''
    if (value === saved) draft.delete(id)
    else if (!draft.has(id)) draft.set(id, { row, column, saved })
    ;(row.cells as string[])[column.index] = value
  }
  /** The page drawn again where it was: rows stay put under the filters until they change. */
  const afterDraft = (): void => {
    draftedRows = new Set([...draft.values()].map(entry => entry.row.index))
    saveButton.disabled = draft.size === 0
    revertButton.disabled = draft.size === 0
    setViewerText(
      saveButton,
      draft.size === 0 ? text('table.save') : text('table.saveCount', { count: draft.size }),
    )
    for (const id of statuses) {
      toolbar.setCount(id, rows.filter(row => statusOf(row).includes(id)).length)
    }
    recount()
    draw()
  }
  const edit = (changes: readonly Change[]): boolean => {
    if (writing) {
      say(text('table.working'))
      return false
    }
    const step = changes.flatMap(({ row, column, value }) => {
      const from = row.cells[column.index] ?? ''
      return from === value ? [] : [{ row, column, from, to: value }]
    })
    if (step.length === 0) return false
    for (const change of step) put(change.row, change.column, change.to)
    undoSteps.push(step)
    redoSteps.length = 0
    if (!flushing) announceEditorEdit(args.root)
    afterDraft()
    return true
  }
  const stepDraft = (from: DraftChange[][], into: DraftChange[][], forward: boolean): boolean => {
    const step = writing ? undefined : from.pop()
    if (step === undefined) return false
    for (const change of step) put(change.row, change.column, forward ? change.to : change.from)
    into.push(step)
    afterDraft()
    return true
  }
  const revertDraft = (): void => {
    if (writing) return
    for (const { row, column, saved } of draft.values()) {
      ;(row.cells as string[])[column.index] = saved
    }
    draft.clear()
    undoSteps.length = 0
    redoSteps.length = 0
    afterDraft()
  }
  /**
   * The draft as one plan, as MK2 saved one buffer: `set-many` writes one locale; several go as
   * `set-variants`, which a writer that cannot write them in one plan refuses rather than guesses.
   */
  const saveDraft = async (reopen: boolean): Promise<boolean> => {
    flushing = true
    try {
      await args.flush?.()
    } finally {
      flushing = false
    }
    const operation = actions.addRow
    if (draft.size === 0 || operation === undefined) return true
    const cells = [...draft.values()].sort(
      (left, right) => left.row.index - right.row.index || left.column.index - right.column.index,
    )
    const entries = cells.map(({ row, column }) => ({
      key: row.cells[keyColumn] ?? '',
      variant: column.variant ?? '',
      value: row.cells[column.index] ?? '',
    }))
    const locales = new Set(entries.map(entry => entry.variant))
    const [only] = locales
    const request =
      locales.size === 1
        ? {
            action: 'set-many',
            variant: only ?? '',
            entries: entries.map(({ key, value }) => ({ key, value })),
          }
        : { action: 'set-variants', entries }
    if (!(await write(operation, request, reopen))) return false
    for (const { row } of cells) changed.add(row.index)
    draft.clear()
    undoSteps.length = 0
    redoSteps.length = 0
    afterDraft()
    say(text('table.saved'))
    return true
  }
  /** Add, rename and delete write at once, and the reopen after that would drop the draft. */
  const unsaved = (): boolean => {
    if (draft.size === 0) return false
    say(text('table.refused', { reason: text('table.draftFirst') }))
    return true
  }

  /** The first cell a replace changes, from the row the bar stands on round to the one before. */
  const replaceNext = (): void => {
    for (let offset = 0; offset < findRows.length; offset += 1) {
      const at = (state.find.at + offset) % findRows.length
      const row = visible[findRows[at] ?? -1]
      const change = row === undefined ? undefined : changesIn(row)[0]
      if (change === undefined) continue
      state.find.at = at
      replace([change])
      return
    }
    say(text('table.replaceNothing'))
  }
  const replaceAll = (): void => {
    const changes = findRows.flatMap(position => {
      const row = visible[position]
      return row === undefined ? [] : changesIn(row)
    })
    if (changes.length === 0) say(text('table.replaceNothing'))
    else replace(changes)
  }
  /** A replace is one step of the draft, however many cells it changes. */
  const replace = (changes: readonly Change[]): void => {
    if (edit(changes)) say(text('table.replaced', { count: changes.length }))
  }

  const showAdd = (): void => {
    if (actions.addRow === undefined || base === undefined || unsaved()) return
    panel.hidden = false
    panel.replaceChildren()
    const form = element(panel, 'form', { part: 'table.add' }) as HTMLFormElement
    const key = element(form, 'input', { part: 'toolbar.search-input' }) as HTMLInputElement
    key.placeholder = text('table.addKeyName')
    key.setAttribute('aria-label', text('table.addKeyName'))
    key.required = true
    const value = element(form, 'input', { part: 'toolbar.search-input' }) as HTMLInputElement
    const valueLabel = text('table.addKeyValue', { variant: base.variant ?? '' })
    value.placeholder = valueLabel
    value.setAttribute('aria-label', valueLabel)
    const submit = element(form, 'button', {
      part: 'toolbar.action',
      text: text('table.addKeySubmit'),
    })
    ;(submit as HTMLButtonElement).type = 'submit'
    form.addEventListener('submit', event => {
      event.preventDefault()
      const name = key.value.trim()
      if (name === '') return
      if (rows.some(row => row.cells[keyColumn] === name)) {
        say(text('table.refused', { reason: text('table.keyExists', { key: name }) }))
        return
      }
      const request = { action: 'add', key: name, value: value.value, variant: base.variant ?? '' }
      void write(actions.addRow as string, request).then(done => {
        if (!done) return
        const cells = header.map((_, index) =>
          index === keyColumn ? name : index === base.index ? value.value : '',
        )
        if (statusColumn >= 0) cells[statusColumn] = variants.length > 1 ? 'missing' : ''
        const row = { index: rows.length, cells }
        rows.push(row)
        changed.add(row.index)
        panel.hidden = true
        refresh()
      })
    })
    key.focus()
  }

  /** The one row the reader ticked, or a word on why there is none. */
  const oneSelected = (): Row | undefined => {
    const chosen = rows.filter(row => selected.has(row.index))
    if (chosen.length === 1) return chosen[0]
    say(text('table.selectOneRow'))
    return undefined
  }

  const showRename = (): void => {
    if (unsaved()) return
    const row = oneSelected()
    if (row === undefined || actions.addRow === undefined) return
    const oldKey = row.cells[keyColumn] ?? ''
    panel.hidden = false
    panel.replaceChildren()
    const form = element(panel, 'form', { part: 'table.add' }) as HTMLFormElement
    const key = element(form, 'input', { part: 'toolbar.search-input' }) as HTMLInputElement
    key.value = oldKey
    key.setAttribute('aria-label', text('table.renameKeyName'))
    key.required = true
    const submit = element(form, 'button', {
      part: 'toolbar.action',
      text: text('table.renameKeySubmit'),
    })
    ;(submit as HTMLButtonElement).type = 'submit'
    form.addEventListener('submit', event => {
      event.preventDefault()
      const newKey = key.value.trim()
      if (newKey === '' || newKey === oldKey) return
      if (rows.some(other => other.cells[keyColumn] === newKey)) {
        say(text('table.refused', { reason: text('table.keyExists', { key: newKey }) }))
        return
      }
      void write(actions.addRow as string, { action: 'rename-variants', oldKey, newKey }).then(
        done => {
          if (!done) return
          rows[rows.indexOf(row)] = {
            ...row,
            cells: row.cells.map((cell, index) => (index === keyColumn ? newKey : cell)),
          }
          changed.add(row.index)
          panel.hidden = true
          refresh()
        },
      )
    })
    key.select()
  }

  const showDelete = (): void => {
    if (unsaved()) return
    const row = oneSelected()
    if (row === undefined || actions.addRow === undefined) return
    const key = row.cells[keyColumn] ?? ''
    // the locales that hold the key now: one is a plain delete, several go as one plan
    const holders = variants.filter(column => (row.cells[column.index] ?? '') !== '')
    panel.hidden = false
    panel.replaceChildren()
    const form = element(panel, 'form', { part: 'table.add' }) as HTMLFormElement
    element(form, 'span', {
      text: text('table.deleteKeyConfirm', { key, count: Math.max(1, holders.length) }),
    })
    const submit = element(form, 'button', {
      part: 'toolbar.action',
      text: text('table.deleteKeySubmit'),
    })
    ;(submit as HTMLButtonElement).type = 'submit'
    form.addEventListener('submit', event => {
      event.preventDefault()
      const request =
        variants.length > 1 ? { action: 'delete-variants', key } : { action: 'delete', key }
      void write(actions.addRow as string, request).then(done => {
        if (!done) return
        rows.splice(rows.indexOf(row), 1)
        selected.delete(row.index)
        panel.hidden = true
        refresh()
      })
    })
    ;(submit as HTMLButtonElement).focus()
  }

  const compare = async (): Promise<void> => {
    if (actions.compareVariants === undefined || base === undefined) return
    panel.hidden = false
    panel.replaceChildren()
    for (const column of variants.filter(item => item !== base)) {
      const result = await invokeOperation(
        args.descriptor,
        args.operations,
        actions.compareVariants,
        { variant: column.variant ?? '' },
        { signal: args.signal },
      )
      const line = element(panel, 'p', { part: 'table.compare' })
      if (result.state !== 'ok' || result.output.kind !== 'json') {
        const reason = result.state === 'ok' ? result.output.kind : invokeRefusalMessage(result)
        setViewerText(line, text('table.refused', { reason }), 1024)
        continue
      }
      const value = result.output.value as unknown as TableVariantComparison
      setViewerText(
        line,
        text('table.compareLine', {
          variant: column.variant ?? '',
          base: base.variant ?? '',
          translated: value.translated,
          total: value.total,
          missing: value.missing.length,
          identical: value.identical.length,
          empty: value.empty.length,
          orphaned: value.orphaned.length,
        }),
        1024,
      )
      for (const [name, keys] of [
        ['missing', value.missing],
        ['untranslated', value.identical],
        ['empty', value.empty],
        ['orphaned', value.orphaned],
      ] as const) {
        if (keys.length === 0) continue
        const show = element(line, 'button', {
          part: 'toolbar.chip',
          text: `${text(COMPARE_LABELS[name])} ${keys.length}`,
        })
        ;(show as HTMLButtonElement).type = 'button'
        show.addEventListener('click', () => {
          keyFilter = new Set(keys)
          refresh()
        })
      }
    }
    const clear = element(panel, 'button', { part: 'toolbar.action', text: text('table.showAll') })
    ;(clear as HTMLButtonElement).type = 'button'
    clear.addEventListener('click', () => {
      keyFilter = undefined
      refresh()
    })
  }

  // Translation is offered only once the codec says a service can answer; otherwise say why.
  if (actions.translateVariant !== undefined && variants.length > 1) {
    const probe = await invokeOperation(
      args.descriptor,
      args.operations,
      actions.translateVariant,
      { probe: true },
      { signal: args.signal },
    )
    const answer =
      probe.state === 'ok' && probe.output.kind === 'json'
        ? (probe.output.value as { available?: boolean; reason?: string })
        : undefined
    const reason =
      probe.state !== 'ok'
        ? invokeRefusalMessage(probe)
        : answer?.available === true
          ? undefined
          : (answer?.reason ?? 'unavailable')
    toolbar.setDisabled('translate', reason !== undefined)
    if (reason !== undefined) {
      const message = text('table.translateUnavailable', { reason })
      const button = [...toolbar.root.querySelectorAll('button')].find(
        node => node.getAttribute('aria-label') === text('table.translate'),
      )
      if (button !== undefined) button.title = message
      const note = element(bar, 'small', { part: 'table.note' })
      note.dataset['translate'] = 'unavailable'
      setViewerText(note, message, 1024)
    }
  }

  let translating = false
  const translate = async (): Promise<void> => {
    if (translating || args.signal.aborted) return
    if (actions.translateVariant === undefined || base === undefined) return
    const column = variants.find(item => String(item.index) === target.value)
    if (column === undefined) return
    const chosen = visible.filter(row => selected.size === 0 || selected.has(row.index))
    const empty = chosen.filter(
      row => (row.cells[column.index] ?? '') === '' && (row.cells[base.index] ?? '') !== '',
    )
    panel.hidden = false
    panel.replaceChildren()
    if (empty.length === 0) {
      setViewerText(
        element(panel, 'p', {}),
        text('table.translateNothing', { variant: column.variant ?? '' }),
      )
      return
    }
    translating = true
    toolbar.setDisabled('translate', true)
    try {
      const ready: { key: string; value: string }[] = []
      say(text('table.working'))
      for (const row of empty.slice(0, TRANSLATE_BATCH)) {
        if (args.signal.aborted) return
        const key = row.cells[keyColumn] ?? ''
        const result = await invokeOperation(
          args.descriptor,
          args.operations,
          actions.translateVariant,
          {
            key,
            sourceVariant: base.variant ?? '',
            targetVariant: column.variant ?? '',
            sourceLanguage: base.language ?? base.variant ?? '',
            targetLanguage: column.language ?? column.variant ?? '',
          },
          { signal: args.signal },
        )
        const value =
          result.state === 'ok' && result.output.kind === 'json'
            ? (result.output.value as { translated?: string; refused?: string; changed?: boolean })
            : undefined
        const refused = result.state !== 'ok' ? invokeRefusalMessage(result) : value?.refused
        const line = element(panel, 'p', { part: 'table.compare' })
        if (refused !== undefined || typeof value?.translated !== 'string') {
          setViewerText(
            line,
            text('table.translateRefused', { key, reason: refused ?? 'no answer' }),
            1024,
          )
          continue
        }
        setViewerText(line, `${key} → ${value.translated}`, 1024)
        if (value.changed !== false) ready.push({ key, value: value.translated })
      }
      say(text('table.translateReady', { count: ready.length, variant: column.variant ?? '' }))
      if (ready.length === 0 || actions.addRow === undefined) return
      // A human accepts the batch: one step of the draft, which Save writes with the rest.
      const apply = element(panel, 'button', {
        part: 'toolbar.action',
        text: text('table.translateApply'),
      })
      ;(apply as HTMLButtonElement).type = 'button'
      apply.addEventListener('click', () => {
        const changes = ready.flatMap(entry => {
          const row = rows.find(item => item.cells[keyColumn] === entry.key)
          return row === undefined ? [] : [{ row, column, value: entry.value }]
        })
        if (edit(changes)) panel.hidden = true
      })
    } catch (error) {
      say(text('table.refused', { reason: error instanceof Error ? error.message : String(error) }))
    } finally {
      translating = false
      if (!args.signal.aborted) toolbar.setDisabled('translate', false)
    }
  }

  // The host's Save, Undo and Redo reach the draft through the editor commands every editor answers.
  if (drafting) {
    args.root.dataset['modkitEditor'] = 'table'
    const removeSave = handleEditorSaveRequest(args.root, () => saveDraft(false))
    const removeHistory = handleEditorHistoryRequest(args.root, {
      undo: () => stepDraft(undoSteps, redoSteps, false),
      redo: () => stepDraft(redoSteps, undoSteps, true),
    })
    args.signal.addEventListener(
      'abort',
      () => {
        removeSave()
        removeHistory()
      },
      { once: true },
    )
  }

  showFind()
  refresh()
  const variantAt = (column: number) => variants.find(item => item.index === column)
  return {
    written(row, column, value) {
      const entry = rows.find(item => item.index === row)
      if (entry === undefined) return
      ;(entry.cells as string[])[column] = value
      changed.add(row)
      refresh()
    },
    drafts: column => drafting && variantAt(column) !== undefined,
    value: (row, column) => rows.find(item => item.index === row)?.cells[column],
    draft(row, column, value) {
      const entry = rows.find(item => item.index === row)
      const target = variantAt(column)
      return (
        entry !== undefined && target !== undefined && edit([{ row: entry, column: target, value }])
      )
    },
    refusal(column) {
      if (writing) return text('table.working')
      return draft.size > 0 && !(drafting && variantAt(column) !== undefined)
        ? text('table.draftFirst')
        : undefined
    },
  }
}
