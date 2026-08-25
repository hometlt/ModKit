/**
 * What the four ODF codecs actually recover, and the data sources they publish for it.
 *
 * The rule the plan sets (block 11 item 6) is that only a really parsed representation is
 * published: ODT gives flow, outline and text; ODS gives sheets, cells and formulas *as text*,
 * never evaluated; ODP gives ordered slides and their text; ODG gives pages, shapes, text and a
 * vector scene. A layout tree, a rasterised page and a thumbnail are derived presentation and do
 * not become a second source document — which is why the vector scene here is built from the
 * geometry that was parsed and stops at the shapes that were not.
 *
 * ODP and ODG share `readDrawPages` and the scene builder because a slide *is* a `draw:page`:
 * ADR-DOC-001 keeps one vector path for both instead of a presentation-shaped fork.
 */

import { childrenNamed, descendants, firstNamed, textOf } from './package.js'

/** CSS reference pixels per unit, so a scene's numbers mean the same thing everywhere. */
const UNITS = Object.freeze({
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
})

/**
 * Cap on rows and cells materialised from one spreadsheet.
 *
 * ODS encodes a sheet's empty tail as a single row with `table:number-rows-repeated="1048576"`.
 * Expanding that is how a 3 KB file becomes a million rows, so a repeat is honoured only while it
 * fits, and what did not fit is reported as a declared count rather than silently dropped.
 */
const MAX_TABLE_ROWS = 20_000
const MAX_TABLE_COLUMNS = 1024
/** Formula texts kept for the metadata panel; the count is always exact, the list is bounded. */
const MAX_LISTED_FORMULAS = 500

/** An ODF length in CSS pixels, or `undefined` when the value is absent or not a plain length. */
export function lengthInPixels(value) {
  if (typeof value !== 'string') return undefined
  const match = /^\s*(-?(?:\d+\.?\d*|\.\d+))(px|pt|pc|in|cm|mm)?\s*$/u.exec(value)
  if (match === null) return undefined
  const scale = match[2] === undefined ? 1 : UNITS[match[2]]
  const result = Number(match[1]) * scale
  return Number.isFinite(result) ? result : undefined
}

function repeatCount(value) {
  if (typeof value !== 'string') return 1
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
}

// -----------------------------------------------------------------------------------------------
// data sources

/** Bounded, pageable table over already-materialised rows. */
export function createOdfTableSource(rows, columns) {
  const frozen = Object.freeze(
    rows.map((cells, index) => Object.freeze({ index, cells: Object.freeze([...cells]) })),
  )
  const startOf = request => {
    if (!Number.isSafeInteger(request.count) || request.count <= 0) {
      throw new TypeError('table page count must be a positive safe integer')
    }
    if (request.kind === 'range') {
      if (!Number.isSafeInteger(request.from) || request.from < 0) {
        throw new TypeError('table range start must be a non-negative safe integer')
      }
      return request.from
    }
    const value = Number(request.cursor)
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('table cursor is invalid')
    return value
  }
  return Object.freeze({
    async shape() {
      return Object.freeze({ rows: frozen.length, columns })
    },
    async rows(request, signal) {
      if (signal?.aborted === true) throw new DOMException('operation cancelled', 'AbortError')
      const start = startOf(request)
      const items = frozen.slice(start, start + request.count)
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < frozen.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
    async cell(coord) {
      if (!Number.isSafeInteger(coord.row) || !Number.isSafeInteger(coord.column)) {
        throw new TypeError('table cell coordinate is invalid')
      }
      const value = frozen[coord.row]?.cells[coord.column]
      if (value === undefined) throw new RangeError('table cell is outside the data')
      return Object.freeze({ value })
    },
    async *search(query, signal) {
      const needle = query.pattern.toLocaleLowerCase()
      for (const row of frozen) {
        for (let column = 0; column < row.cells.length; column += 1) {
          if (signal?.aborted === true) throw new DOMException('operation cancelled', 'AbortError')
          if (row.cells[column].toLocaleLowerCase().includes(needle)) {
            yield Object.freeze({ row: row.index, column })
          }
        }
      }
    },
  })
}

/**
 * `common.view/slide-deck-source@1` over an already-read deck (ADR-DOC-001).
 *
 * Deliberately narrow: order, text and the vector page a slide's geometry lives on. Masters,
 * layouts, transitions and animation are not parsed, so they are absent rather than empty.
 */
export function createSlideDeckSource(deck) {
  const slides = Object.freeze(
    deck.slides.map(slide =>
      Object.freeze({
        id: slide.id,
        index: slide.index,
        ...(slide.title === undefined ? {} : { title: slide.title }),
        textRuns: Object.freeze([...slide.textRuns]),
        ...(slide.notes === undefined ? {} : { notes: Object.freeze([...slide.notes]) }),
        page: Object.freeze({ kind: 'vector-scene-page', page: slide.index }),
      }),
    ),
  )
  const info = Object.freeze({
    slides: slides.length,
    ...(deck.title === undefined ? {} : { title: deck.title }),
    ...(deck.unparsedSlides === 0 ? {} : { unparsedSlides: deck.unparsedSlides }),
  })
  return Object.freeze({
    async info(signal) {
      if (signal?.aborted === true) throw new DOMException('operation cancelled', 'AbortError')
      return info
    },
    async slides(page, signal) {
      if (signal?.aborted === true) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('slide page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('slide cursor is invalid')
      const items = slides.slice(start, start + page.limit)
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < slides.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
  })
}

// -----------------------------------------------------------------------------------------------
// ODT — flow, outline, text

export function readOdt(pkg) {
  const p = pkg.prefixes
  const root = { kind: 'document', label: pkg.details.label, children: [], preview: undefined }
  const stack = [{ level: 0, node: root }]
  const lines = []
  let headings = 0
  let paragraphs = 0
  let lists = 0
  let tables = 0
  for (const element of descendants(pkg.body)) {
    if (element.name === `${p.text}:h`) {
      headings += 1
      const declared = Number.parseInt(element.attributes[`${p.text}:outline-level`] ?? '1', 10)
      const level = Number.isSafeInteger(declared) && declared > 0 ? declared : 1
      const label = textOf(element)
      lines.push(label)
      while (stack.length > 1 && stack.at(-1).level >= level) stack.pop()
      const node = { kind: 'heading', label, preview: `outline level ${level}`, children: [] }
      stack.at(-1).node.children.push(node)
      stack.push({ level, node })
      continue
    }
    if (element.name === `${p.text}:p`) {
      // a paragraph inside a heading, a cell or a frame is that element's text, not a sibling block
      paragraphs += 1
      const text = textOf(element)
      lines.push(text)
      stack.at(-1).node.children.push({
        kind: 'paragraph',
        label: text === '' ? '(empty)' : text,
        children: [],
      })
      continue
    }
    if (element.name === `${p.text}:list`) lists += 1
    if (element.name === `${p.table}:table`) tables += 1
  }
  const text = lines.join('\n')
  return {
    text,
    tree: root,
    summary: {
      format: pkg.details.formatId,
      entries: pkg.entries.length,
      headings,
      paragraphs,
      lists,
      tables,
      characters: text.length,
    },
    traits: [
      { id: 'document.flow', parameters: { paragraphs, headings } },
      { id: 'document.outline', parameters: { headings } },
      { id: 'structure.hierarchy', parameters: { nodes: headings + paragraphs, lazy: true } },
      { id: 'content.text', parameters: { encoding: 'utf-8' } },
    ],
  }
}

// -----------------------------------------------------------------------------------------------
// ODS — sheets, cells, formulas as text

/** One sheet's cells, with repeats honoured only as far as the caps allow. */
function readSheet(sheet, prefixes, formulas, sheetName) {
  const p = prefixes
  const rows = []
  let declaredRows = 0
  let cells = 0
  let columns = 0
  for (const rowElement of childrenNamed(sheet, `${p.table}:table-row`)) {
    const rowRepeat = repeatCount(rowElement.attributes[`${p.table}:number-rows-repeated`])
    const cellValues = []
    let empty = true
    for (const cellElement of rowElement.children) {
      if (
        cellElement.name !== `${p.table}:table-cell` &&
        cellElement.name !== `${p.table}:covered-table-cell`
      ) {
        continue
      }
      const repeat = repeatCount(cellElement.attributes[`${p.table}:number-columns-repeated`])
      const formula = cellElement.attributes[`${p.table}:formula`]
      const value = textOf(cellElement)
      if (value !== '') empty = false
      if (formula !== undefined) {
        // the formula is provenance and text, never a computation: nothing here evaluates it
        if (formulas.list.length < MAX_LISTED_FORMULAS) {
          formulas.list.push({
            sheet: sheetName,
            row: rows.length + 1,
            column: cellValues.length + 1,
            formula,
            storedValue: value,
          })
        }
        formulas.count += 1
      }
      const fits = Math.min(repeat, Math.max(0, MAX_TABLE_COLUMNS - cellValues.length))
      // a long repeat of the same *empty* cell is a sheet's padding, not a thousand facts
      const emit = value === '' && repeat > 1 ? Math.min(1, fits) : fits
      for (let index = 0; index < emit; index += 1) cellValues.push(value)
      cells += repeat
    }
    columns = Math.max(columns, cellValues.length)
    declaredRows += rowRepeat
    const fits = Math.min(rowRepeat, Math.max(0, MAX_TABLE_ROWS - rows.length))
    const emit = empty && rowRepeat > 1 ? Math.min(1, fits) : fits
    for (let index = 0; index < emit; index += 1) rows.push(cellValues)
  }
  return { rows, declaredRows, cells, columns }
}

export function readOds(pkg) {
  const p = pkg.prefixes
  const formulas = { count: 0, list: [] }
  const sheets = []
  for (const sheet of childrenNamed(pkg.body, `${p.table}:table`)) {
    const name = sheet.attributes[`${p.table}:name`] ?? `Sheet ${sheets.length + 1}`
    sheets.push({ name, ...readSheet(sheet, p, formulas, name) })
  }
  const first = sheets[0]
  const root = {
    kind: 'workbook',
    label: pkg.details.label,
    preview: `${sheets.length} sheet(s)`,
    children: sheets.map(sheet => ({
      kind: 'sheet',
      label: sheet.name,
      preview: `${sheet.declaredRows} row(s), ${sheet.cells} cell(s)`,
      children: [
        {
          kind: 'formulas',
          label: 'formulas',
          preview: `${formulas.list.filter(item => item.sheet === sheet.name).length} listed`,
          children: formulas.list
            .filter(item => item.sheet === sheet.name)
            .map(item => ({
              kind: 'formula',
              label: `r${item.row}c${item.column}`,
              preview: `${item.formula} → ${item.storedValue}`,
              children: [],
            })),
        },
      ],
    })),
  }
  const materialisedRows = sheets.reduce((total, sheet) => total + sheet.rows.length, 0)
  const declaredRows = sheets.reduce((total, sheet) => total + sheet.declaredRows, 0)
  const cells = sheets.reduce((total, sheet) => total + sheet.cells, 0)
  return {
    tree: root,
    table: first === undefined ? undefined : createOdfTableSource(first.rows, first.columns),
    tableSheet: first?.name,
    formulas: formulas.list,
    summary: {
      format: pkg.details.formatId,
      entries: pkg.entries.length,
      sheets: sheets.length,
      rows: materialisedRows,
      declaredRows,
      cells,
      formulas: formulas.count,
      tableSheet: first?.name ?? null,
    },
    traits: [
      { id: 'table.sheets', parameters: { count: sheets.length } },
      { id: 'table.cells', parameters: { count: cells, rows: materialisedRows } },
      ...(formulas.count > 0
        ? [{ id: 'table.formulas', parameters: { count: formulas.count, evaluated: false } }]
        : []),
      { id: 'structure.hierarchy', parameters: { nodes: sheets.length, lazy: true } },
      { id: 'content.text', parameters: { encoding: 'utf-8' } },
    ],
  }
}

// -----------------------------------------------------------------------------------------------
// draw:page — the shared ODP/ODG geometry

const GEOMETRIC_SHAPES = new Set([
  'rect',
  'ellipse',
  'circle',
  'line',
  'polyline',
  'polygon',
  'path',
])

function shapeBox(attributes, p) {
  return {
    x: lengthInPixels(attributes[`${p.svg}:x`]) ?? 0,
    y: lengthInPixels(attributes[`${p.svg}:y`]) ?? 0,
    width: lengthInPixels(attributes[`${p.svg}:width`]),
    height: lengthInPixels(attributes[`${p.svg}:height`]),
  }
}

function viewBoxOf(attributes, p) {
  const declared = attributes[`${p.svg}:viewBox`] ?? attributes[`${p.svg}:viewbox`]
  if (typeof declared !== 'string') return undefined
  const parts = declared
    .trim()
    .split(/[\s,]+/u)
    .map(Number)
  return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0
    ? parts
    : undefined
}

/** One page's shapes, flattened out of `draw:g` groups, with what was not parsed counted. */
function readShapes(page, p, into, depth = 0) {
  for (const element of page.children) {
    const [prefix, local] = element.name.split(':')
    if (prefix !== p.draw) continue
    if (local === 'g') {
      // groups are containers, not geometry; the transform of a group is a style, not parsed here
      if (depth < 16) readShapes(element, p, into, depth + 1)
      else into.unparsed.push(element.name)
      continue
    }
    if (GEOMETRIC_SHAPES.has(local)) {
      into.shapes.push({ kind: local, attributes: element.attributes })
      continue
    }
    if (local === 'frame') {
      const box = shapeBox(element.attributes, p)
      const runs = []
      for (const block of descendants(element)) {
        if (block.name === `${p.text}:p` || block.name === `${p.text}:h`) {
          const value = textOf(block)
          if (value !== '') runs.push(value)
        }
      }
      into.frames.push({
        box,
        runs,
        class: element.attributes[`${p.presentation}:class`],
        // an image or an embedded object is a reference this reader never resolves or fetches
        external: element.children.some(
          child => child.name === `${p.draw}:image` || child.name === `${p.draw}:object`,
        ),
      })
      continue
    }
    into.unparsed.push(element.name)
  }
}

/** Page size declared by the document's page layout, when `styles.xml` states one. */
async function pageSize(pkg) {
  const styles = await pkg.part('styles.xml')
  if (styles === undefined) return undefined
  const p = styles.prefixes
  const properties = firstNamed(styles.root, `${p.style}:page-layout-properties`)
  if (properties === undefined) return undefined
  const width = lengthInPixels(properties.attributes[`${p.fo}:page-width`])
  const height = lengthInPixels(properties.attributes[`${p.fo}:page-height`])
  return width === undefined || height === undefined ? undefined : { width, height }
}

/** Every `draw:page` of a presentation or a drawing, in document order. */
export async function readDrawPages(pkg) {
  const p = pkg.prefixes
  const size = await pageSize(pkg)
  const pages = []
  for (const pageElement of childrenNamed(pkg.body, `${p.draw}:page`)) {
    const collected = { shapes: [], frames: [], unparsed: [] }
    readShapes(pageElement, p, collected)
    const notesElement = pageElement.children.find(
      child => child.name === `${p.presentation}:notes`,
    )
    const notes = []
    if (notesElement !== undefined) {
      for (const block of descendants(notesElement)) {
        if (block.name === `${p.text}:p` || block.name === `${p.text}:h`) {
          const value = textOf(block)
          if (value !== '') notes.push(value)
        }
      }
    }
    pages.push({
      index: pages.length + 1,
      name: pageElement.attributes[`${p.draw}:name`],
      shapes: collected.shapes,
      frames: collected.frames,
      unparsed: collected.unparsed,
      notes,
    })
  }
  return { pages, size }
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const round = value => Math.round(value * 1000) / 1000

function shapeSvg(shape, p) {
  const a = shape.attributes
  const box = shapeBox(a, p)
  if (shape.kind === 'rect' && box.width !== undefined && box.height !== undefined) {
    return `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}"/>`
  }
  if (
    (shape.kind === 'ellipse' || shape.kind === 'circle') &&
    box.width !== undefined &&
    box.height !== undefined
  ) {
    return `<ellipse cx="${round(box.x + box.width / 2)}" cy="${round(box.y + box.height / 2)}" rx="${round(box.width / 2)}" ry="${round(box.height / 2)}"/>`
  }
  if (shape.kind === 'line') {
    const x1 = lengthInPixels(a[`${p.svg}:x1`])
    const y1 = lengthInPixels(a[`${p.svg}:y1`])
    const x2 = lengthInPixels(a[`${p.svg}:x2`])
    const y2 = lengthInPixels(a[`${p.svg}:y2`])
    if ([x1, y1, x2, y2].every(value => value !== undefined)) {
      return `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}"/>`
    }
    return undefined
  }
  const viewBox = viewBoxOf(a, p)
  if (viewBox === undefined || box.width === undefined || box.height === undefined) return undefined
  // ODF states path and point geometry in its own viewBox space; the placement is a transform, so
  // the numbers are carried over exactly instead of being re-derived point by point
  const scaleX = box.width / viewBox[2]
  const scaleY = box.height / viewBox[3]
  const open = `<g transform="translate(${round(box.x)} ${round(box.y)}) scale(${round(scaleX)} ${round(scaleY)}) translate(${round(-viewBox[0])} ${round(-viewBox[1])})">`
  if (shape.kind === 'path') {
    const d = a[`${p.svg}:d`]
    return typeof d === 'string' ? `${open}<path d="${escapeXml(d)}"/></g>` : undefined
  }
  const points = a[`${p.draw}:points`]
  if (typeof points !== 'string') return undefined
  const tag = shape.kind === 'polygon' ? 'polygon' : 'polyline'
  return `${open}<${tag} points="${escapeXml(points)}"/></g>`
}

/**
 * A page as a static, script-free SVG document — a derived presentation, not a second source.
 *
 * Only geometry that was parsed is drawn. Styles live in `styles.xml` and automatic styles, which
 * this reader does not interpret, so the scene is deliberately unstyled: a neutral stroke, no fill,
 * and text placed at its frame's origin. Anything not understood is counted, never approximated.
 */
export function pageSceneSvg(page, prefixes, size) {
  const p = prefixes
  const parts = []
  let maxX = 0
  let maxY = 0
  const extend = box => {
    if (box.width !== undefined) maxX = Math.max(maxX, box.x + box.width)
    if (box.height !== undefined) maxY = Math.max(maxY, box.y + box.height)
  }
  let drawnShapes = 0
  for (const shape of page.shapes) {
    const markup = shapeSvg(shape, p)
    extend(shapeBox(shape.attributes, p))
    if (markup === undefined) continue
    drawnShapes += 1
    parts.push(markup)
  }
  const textParts = []
  let drawnRuns = 0
  const fontSize = 16
  for (const frame of page.frames) {
    extend(frame.box)
    let offset = fontSize
    for (const run of frame.runs) {
      textParts.push(
        `<text x="${round(frame.box.x)}" y="${round(frame.box.y + offset)}" font-size="${fontSize}">${escapeXml(run)}</text>`,
      )
      // no font is loaded here, so a run's width is nominal (0.6em per character) and is used only
      // to keep the canvas large enough to hold what was drawn — never presented as a measurement
      maxX = Math.max(maxX, frame.box.x + run.length * fontSize * 0.6)
      maxY = Math.max(maxY, frame.box.y + offset)
      offset += fontSize * 1.25
      drawnRuns += 1
    }
  }
  const width = size?.width ?? (maxX > 0 ? maxX : 1)
  const height = size?.height ?? (maxY > 0 ? maxY : 1)
  const text = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">`,
    // outlines are stroked and text is filled: the two need opposite defaults, and neither takes a
    // colour from the document, because ODF styles are not read here
    '<g fill="none" stroke="currentColor" stroke-width="1">',
    ...parts,
    '</g>',
    '<g fill="currentColor" stroke="none">',
    ...textParts,
    '</g>',
    '</svg>',
  ].join('')
  return {
    text,
    info: {
      width: round(width),
      height: round(height),
      viewBox: [0, 0, round(width), round(height)],
      nodes: drawnShapes + drawnRuns,
      paths: page.shapes.filter(shape => shape.kind === 'path').length,
      shapes: drawnShapes,
      textNodes: drawnRuns,
      gradients: 0,
    },
    pageSizeKnown: size !== undefined,
  }
}

// -----------------------------------------------------------------------------------------------
// ODP — ordered slides, their text, and the vector page each one lives on

export function readOdp(pages, pkg) {
  const p = pkg.prefixes
  const slides = pages.map(page => {
    const titleFrame = page.frames.find(frame => frame.class === 'title')
    const title = titleFrame === undefined ? undefined : titleFrame.runs.join(' ')
    const textRuns = page.frames.filter(frame => frame !== titleFrame).flatMap(frame => frame.runs)
    return {
      id: page.name ?? `slide-${page.index}`,
      index: page.index,
      ...(title === undefined || title === '' ? {} : { title }),
      textRuns,
      ...(page.notes.length === 0 ? {} : { notes: page.notes }),
    }
  })
  const runs = slides.reduce(
    (total, slide) => total + slide.textRuns.length + (slide.title === undefined ? 0 : 1),
    0,
  )
  const unparsed = pages.reduce((total, page) => total + page.unparsed.length, 0)
  const root = {
    kind: 'deck',
    label: pkg.details.label,
    preview: `${slides.length} slide(s)`,
    children: slides.map(slide => ({
      kind: 'slide',
      label: slide.title ?? `Slide ${slide.index}`,
      preview: `${slide.textRuns.length} text run(s)`,
      children: [
        ...slide.textRuns.map(run => ({ kind: 'text', label: run, children: [] })),
        ...(slide.notes ?? []).map(note => ({ kind: 'notes', label: note, children: [] })),
      ],
    })),
  }
  const lines = slides.flatMap(slide => [
    ...(slide.title === undefined ? [] : [slide.title]),
    ...slide.textRuns,
  ])
  return {
    tree: root,
    text: lines.join('\n'),
    deck: { slides, unparsedSlides: 0 },
    summary: {
      format: pkg.details.formatId,
      entries: pkg.entries.length,
      slides: slides.length,
      textRuns: runs,
      notes: slides.reduce((total, slide) => total + (slide.notes?.length ?? 0), 0),
      unparsedShapes: unparsed,
    },
    traits: [
      { id: 'presentation.slides', parameters: { count: slides.length } },
      { id: 'content.text', parameters: { runs } },
      { id: 'structure.hierarchy', parameters: { nodes: slides.length, lazy: true } },
    ],
    prefixes: p,
  }
}

// -----------------------------------------------------------------------------------------------
// ODG — pages, shapes, text, vector scene

export function readOdg(pages, pkg) {
  const shapes = pages.reduce((total, page) => total + page.shapes.length, 0)
  const frames = pages.reduce((total, page) => total + page.frames.length, 0)
  const unparsed = pages.reduce((total, page) => total + page.unparsed.length, 0)
  const runs = pages.flatMap(page => page.frames.flatMap(frame => frame.runs))
  const root = {
    kind: 'drawing',
    label: pkg.details.label,
    preview: `${pages.length} page(s)`,
    children: pages.map(page => ({
      kind: 'page',
      label: page.name ?? `Page ${page.index}`,
      preview: `${page.shapes.length} shape(s), ${page.frames.length} frame(s)`,
      children: [
        ...page.shapes.map(shape => ({ kind: 'shape', label: shape.kind, children: [] })),
        ...page.frames.flatMap(frame =>
          frame.runs.map(run => ({ kind: 'text', label: run, children: [] })),
        ),
      ],
    })),
  }
  return {
    tree: root,
    text: runs.join('\n'),
    summary: {
      format: pkg.details.formatId,
      entries: pkg.entries.length,
      pages: pages.length,
      shapes,
      frames,
      textRuns: runs.length,
      unparsedShapes: unparsed,
    },
    traits: [
      { id: 'document.pages', parameters: { count: pages.length } },
      { id: 'vector.shapes', parameters: { count: shapes } },
      ...(runs.length > 0 ? [{ id: 'vector.text', parameters: { count: runs.length } }] : []),
      { id: 'structure.hierarchy', parameters: { nodes: pages.length + shapes, lazy: true } },
      { id: 'content.text', parameters: { runs: runs.length } },
    ],
  }
}
