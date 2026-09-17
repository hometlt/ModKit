/**
 * A table whose value columns are variants of one another — a localization table is the case.
 *
 * Everything format-specific arrives as data: `columnInfo` says which column is the key, which are
 * variants (and which of those is the base), and `actions` names the operations for adding a row,
 * comparing a variant with the base and translating. This module only searches, filters and routes
 * requests; every write is an edit plan through `commitOperationWrite`.
 */
import type {
  AnyDescriptor,
  JsonValue,
  OperationSession,
  Row,
  TableActions,
  TableColumnInfo,
  TableDataSource,
  TableVariantComparison,
  CommitCoordinator,
  EditAuthorizationPort,
} from '@modkit/sdk'
import { createToolbar } from '../toolbar/index.js'
import { element, invokeOperation, setPart, setViewerText } from '../viewer/index.js'
import { commitOperationWrite } from '../field-write/index.js'
import { invokeRefusalMessage } from '../field-editor/index.js'
import type { UiLocalizer } from '../localization/index.js'
import { TABLE_VARIANTS_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

/** Rows drawn per page of the filtered list. */
export const VARIANT_PAGE_ROWS = 200
/** Rows read per request while loading the whole table. */
const LOAD_PAGE_ROWS = 1000
/** Cells one translate click sends; the rest wait for the next click. */
export const TRANSLATE_BATCH = 50

const FILTER_LABELS = {
  missing: 'table.filterMissing',
  untranslated: 'table.filterUntranslated',
  duplicate: 'table.filterDuplicate',
  changed: 'table.filterChanged',
} as const
const COMPARE_LABELS = {
  missing: 'table.filterMissing',
  untranslated: 'table.filterUntranslated',
  empty: 'table.compareEmpty',
  orphaned: 'table.compareOrphaned',
} as const

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
  /** The rows' own element; the controls are placed above it. */
  readonly before: HTMLElement
}

export interface VariantTable {
  /** A cell write the table committed, so filters and status follow it. */
  written(row: number, column: number, value: string): void
}

/** Filter state kept across a reopen of the same subject. */
interface FilterState {
  search: string
  group: string
  statuses: string[]
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
  const selected = new Set<number>()
  const statusOf = (row: Row): readonly string[] => [
    ...(statusColumn < 0 ? [] : (row.cells[statusColumn] ?? '').split(' ').filter(Boolean)),
    ...(changed.has(row.index) ? ['changed'] : []),
  ]
  const state: FilterState = remembered.get(args.descriptor.subjectUri) ?? {
    search: '',
    group: '',
    statuses: [],
  }
  remembered.set(args.descriptor.subjectUri, state)

  const bar = element(args.root, 'div', { part: 'table.controls' })
  const status = element(args.root, 'output', { part: 'viewer.status' })
  status.setAttribute('role', 'status')
  const say = (message: string): void => setViewerText(status, message, 1024)
  const panel = element(args.root, 'section', { part: 'table.panel' })
  panel.hidden = true
  args.before.before(bar, status, panel)
  const statuses = ['missing', 'untranslated', 'duplicate', 'changed'] as const
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
      ...(actions.addRow === undefined || base === undefined
        ? []
        : [
            {
              kind: 'action' as const,
              id: 'add',
              label: text('table.addKey'),
              onActivate: () => showAdd(),
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

  const more = element(args.root, 'button', {
    part: 'table.next',
    text: text('table.more'),
  }) as HTMLButtonElement
  more.type = 'button'
  let visible: Row[] = []
  let shown = 0
  let keyFilter: ReadonlySet<string> | undefined

  const matches = (row: Row): boolean => {
    const key = row.cells[keyColumn] ?? ''
    if (keyFilter !== undefined && !keyFilter.has(key)) return false
    if (state.group !== '' && !key.startsWith(state.group)) return false
    const flags = statusOf(row)
    if (state.statuses.length > 0 && !state.statuses.some(item => flags.includes(item)))
      return false
    const needle = state.search.toLocaleLowerCase()
    return needle === '' || row.cells.some(cell => cell.toLocaleLowerCase().includes(needle))
  }

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
    })
    more.hidden = shown >= visible.length
    say(text('table.shown', { shown: Math.min(shown, visible.length), total: rows.length }))
  }

  const refresh = (): void => {
    visible = rows.filter(matches)
    shown = VARIANT_PAGE_ROWS
    for (const id of statuses) {
      toolbar.setCount(id, rows.filter(row => statusOf(row).includes(id)).length)
    }
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
  const write = async (operation: string, input: JsonValue): Promise<boolean> => {
    say(text('table.working'))
    const refusal = await commitOperationWrite(route, operation, input, args.signal)
    if (refusal !== undefined) {
      say(text('table.refused', { reason: refusal }))
      return false
    }
    say(text('table.saved'))
    await args.committed()
    return true
  }

  const showAdd = (): void => {
    if (actions.addRow === undefined || base === undefined) return
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

  const translate = async (): Promise<void> => {
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
    const ready: { key: string; value: string }[] = []
    say(text('table.working'))
    for (const row of empty.slice(0, TRANSLATE_BATCH)) {
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
          ? (result.output.value as { translated?: string; refused?: string })
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
      ready.push({ key, value: value.translated })
    }
    say(text('table.translateReady', { count: ready.length, variant: column.variant ?? '' }))
    if (ready.length === 0 || actions.addRow === undefined) return
    // A human accepts the batch; one plan writes the whole batch into one locale file.
    const apply = element(panel, 'button', {
      part: 'toolbar.action',
      text: text('table.translateApply'),
    })
    ;(apply as HTMLButtonElement).type = 'button'
    apply.addEventListener('click', () => {
      void write(actions.addRow as string, {
        action: 'set-many',
        variant: column.variant ?? '',
        entries: ready,
      }).then(done => {
        if (!done) return
        for (const entry of ready) {
          const row = rows.find(item => item.cells[keyColumn] === entry.key)
          if (row === undefined) continue
          ;(row.cells as string[])[column.index] = entry.value
          changed.add(row.index)
        }
        panel.hidden = true
        refresh()
      })
    })
  }

  refresh()
  return {
    written(row, column, value) {
      const entry = rows.find(item => item.index === row)
      if (entry === undefined) return
      ;(entry.cells as string[])[column] = value
      changed.add(row)
      refresh()
    },
  }
}
