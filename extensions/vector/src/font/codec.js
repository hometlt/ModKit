/**
 * Font files (TrueType, OpenType, TrueType collections, WOFF, WOFF2): metadata and a glyph sheet.
 *
 * MK2 had no font codec; `apps/modkit-vscode/src/font-preview.ts` handed the bytes to a webview
 * `@font-face`. MK3 keeps the preview host-neutral instead: the codec reads the sfnt tables itself
 * and publishes the glyph outlines as a secure static SVG, so the vector stage every host already
 * has shows the specimen without fonts, scripts or `data:` URLs.
 *
 * Outlines are read from `glyf` (TrueType quadratic curves, simple and composite glyphs). CFF
 * outlines (`OTTO`) and WOFF2 (Brotli plus the `glyf` transform) publish metadata only; WOFF tables
 * are inflated with the platform `DecompressionStream`.
 */

import {
  createInspectionCodec,
  createTreeDataSource,
  createVectorSceneSource,
} from '@modkit/codec-kit'
import { decompressBounded } from '@modkit/codec-kit/compression/bounded'

const ID = 'modkit/vector-font'
const SPECIMEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&?!'
const COLUMNS = 13
const CELL = 64
const MAX_COMPOSITE_DEPTH = 8

const tagOf = (bytes, offset) =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** The container a font file uses, from its first four bytes. */
function flavourOf(bytes) {
  if (bytes.byteLength < 12) return undefined
  const tag = tagOf(bytes, 0)
  if (tag === 'wOFF') return 'woff'
  if (tag === 'wOF2') return 'woff2'
  if (tag === 'ttcf') return 'ttc'
  if (tag === 'OTTO') return 'otf'
  if (tag === 'true' || view(bytes).getUint32(0) === 0x0001_0000) return 'ttf'
  return undefined
}

const LABELS = Object.freeze({
  ttf: 'TrueType',
  otf: 'OpenType (CFF)',
  ttc: 'TrueType Collection',
  woff: 'WOFF',
  woff2: 'WOFF2',
})

function sfntDirectory(bytes, start) {
  const data = view(bytes)
  if (start + 12 > bytes.byteLength) throw new RangeError('font table directory is truncated')
  const count = data.getUint16(start + 4)
  if (start + 12 + count * 16 > bytes.byteLength)
    throw new RangeError('font table directory is truncated')
  const tables = new Map()
  for (let index = 0; index < count; index += 1) {
    const at = start + 12 + index * 16
    const offset = data.getUint32(at + 8)
    const length = data.getUint32(at + 12)
    if (offset + length > bytes.byteLength) {
      throw new RangeError(`font table ${tagOf(bytes, at)} lies outside the file`)
    }
    tables.set(tagOf(bytes, at), bytes.subarray(offset, offset + length))
  }
  return { flavor: tagOf(bytes, start), tables }
}

/** One zlib-compressed WOFF table, which must inflate to exactly its declared length. */
async function woffTable(bytes, expected) {
  const out = await decompressBounded(bytes, 'deflate', { maxOutputBytes: expected })
  if (out.byteLength !== expected) throw new RangeError('WOFF table inflated to the wrong size')
  return out
}

async function woffDirectory(bytes, budget) {
  const data = view(bytes)
  const count = data.getUint16(12)
  if (44 + count * 20 > bytes.byteLength) throw new RangeError('WOFF table directory is truncated')
  const tables = new Map()
  let total = 0
  for (let index = 0; index < count; index += 1) {
    const at = 44 + index * 20
    const offset = data.getUint32(at + 4)
    const compressed = data.getUint32(at + 8)
    const original = data.getUint32(at + 12)
    if (offset + compressed > bytes.byteLength)
      throw new RangeError('WOFF table lies outside the file')
    total += original
    if (total > budget) throw new RangeError('WOFF tables exceed the scalar budget')
    const raw = bytes.subarray(offset, offset + compressed)
    tables.set(tagOf(bytes, at), compressed < original ? await woffTable(raw, original) : raw)
  }
  return { flavor: tagOf(bytes, 4), tables }
}

/** WOFF2 table tags: known tags are a 6-bit index into the specification's list. */
const WOFF2_TAGS =
  'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
    .match(/.{4}\s?/gu)
    .map(tag => tag.slice(0, 4))

function woff2Tags(bytes) {
  const count = view(bytes).getUint16(12)
  const tags = []
  let at = 48
  const base128 = () => {
    let value = 0
    for (let index = 0; index < 5; index += 1) {
      const byte = bytes[at++]
      if (byte === undefined) throw new RangeError('WOFF2 table directory is truncated')
      value = value * 128 + (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
    throw new RangeError('WOFF2 UIntBase128 is too long')
  }
  for (let index = 0; index < count; index += 1) {
    const flags = bytes[at++]
    if (flags === undefined) throw new RangeError('WOFF2 table directory is truncated')
    let tag
    if ((flags & 0x3f) === 0x3f) {
      if (at + 4 > bytes.byteLength) throw new RangeError('WOFF2 table directory is truncated')
      tag = tagOf(bytes, at)
      at += 4
    } else tag = WOFF2_TAGS[flags & 0x3f]
    base128()
    const version = (flags >> 6) & 3
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0
    if (transformed) base128()
    tags.push(tag)
  }
  return tags
}

function names(table) {
  const out = {}
  if (table === undefined || table.byteLength < 6) return out
  const data = view(table)
  const count = data.getUint16(2)
  const storage = data.getUint16(4)
  const wanted = { 1: 'family', 2: 'subfamily', 4: 'fullName', 5: 'version', 6: 'postScriptName' }
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 12
    if (at + 12 > table.byteLength) break
    const platform = data.getUint16(at)
    const key = wanted[data.getUint16(at + 6)]
    const length = data.getUint16(at + 8)
    const start = storage + data.getUint16(at + 10)
    if (key === undefined || start + length > table.byteLength) continue
    const raw = table.subarray(start, start + length)
    if (platform === 3 || platform === 0) {
      let text = ''
      for (let offset = 0; offset + 1 < raw.byteLength; offset += 2) {
        text += String.fromCharCode((raw[offset] << 8) | raw[offset + 1])
      }
      out[key] = text
    } else if (platform === 1 && out[key] === undefined) {
      out[key] = String.fromCharCode(...raw)
    }
  }
  return out
}

/** Unicode → glyph id through a format 4 (BMP) or format 12 subtable of `cmap`. */
function characterMap(table) {
  if (table === undefined || table.byteLength < 4) return undefined
  const data = view(table)
  let best
  for (let index = 0; index < data.getUint16(2); index += 1) {
    const at = 4 + index * 8
    if (at + 8 > table.byteLength) break
    const offset = data.getUint32(at + 4)
    if (offset + 4 > table.byteLength) continue
    const format = data.getUint16(offset)
    if (format === 12 || (format === 4 && best === undefined)) best = { format, offset }
  }
  if (best === undefined) return undefined
  const { format, offset } = best
  if (format === 12) {
    const groups = data.getUint32(offset + 12)
    return code => {
      for (let index = 0; index < groups; index += 1) {
        const at = offset + 16 + index * 12
        if (at + 12 > table.byteLength) return 0
        const first = data.getUint32(at)
        if (code >= first && code <= data.getUint32(at + 4))
          return data.getUint32(at + 8) + code - first
      }
      return 0
    }
  }
  const segments = data.getUint16(offset + 6) / 2
  const ends = offset + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const ranges = deltas + segments * 2
  return code => {
    for (let index = 0; index < segments; index += 1) {
      if (ranges + index * 2 + 2 > table.byteLength) return 0
      if (code > data.getUint16(ends + index * 2)) continue
      const start = data.getUint16(starts + index * 2)
      if (code < start) return 0
      const delta = data.getUint16(deltas + index * 2)
      const range = data.getUint16(ranges + index * 2)
      if (range === 0) return (code + delta) & 0xffff
      const at = ranges + index * 2 + range + (code - start) * 2
      if (at + 2 > table.byteLength) return 0
      const glyph = data.getUint16(at)
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff
    }
    return 0
  }
}

const round = value => Math.round(value * 100) / 100

/** SVG path data of one `glyf` glyph, composites resolved with their x/y offsets. */
function glyphPath(tables, glyphId, depth = 0) {
  const glyf = tables.glyf
  const loca = tables.loca
  if (depth > MAX_COMPOSITE_DEPTH) return ''
  const long = tables.longLoca
  const lv = view(loca)
  const entry = long ? glyphId * 4 : glyphId * 2
  if (entry + (long ? 8 : 4) > loca.byteLength) return ''
  const start = long ? lv.getUint32(entry) : lv.getUint16(entry) * 2
  const end = long ? lv.getUint32(entry + 4) : lv.getUint16(entry + 2) * 2
  if (end <= start || end > glyf.byteLength) return ''
  const g = glyf.subarray(start, end)
  const data = view(g)
  const contours = data.getInt16(0)
  if (contours < 0) {
    let path = ''
    let at = 10
    for (;;) {
      if (at + 4 > g.byteLength) return path
      const flags = data.getUint16(at)
      const component = data.getUint16(at + 2)
      at += 4
      const words = (flags & 1) !== 0
      const dx = (flags & 2) !== 0 ? (words ? data.getInt16(at) : data.getInt8(at)) : 0
      const dy = (flags & 2) !== 0 ? (words ? data.getInt16(at + 2) : data.getInt8(at + 1)) : 0
      at += words ? 4 : 2
      at += (flags & 8) !== 0 ? 2 : (flags & 0x40) !== 0 ? 4 : (flags & 0x80) !== 0 ? 8 : 0
      const inner = glyphPath(tables, component, depth + 1)
      // ponytail: component scale/2x2 transforms are ignored; offsets only.
      path += inner.replace(
        /(-?[\d.]+),(-?[\d.]+)/gu,
        (_, x, y) => `${round(Number(x) + dx)},${round(Number(y) + dy)}`,
      )
      if ((flags & 0x20) === 0) return path
    }
  }
  const endPoints = []
  for (let index = 0; index < contours; index += 1) endPoints.push(data.getUint16(10 + index * 2))
  const points = contours === 0 ? 0 : endPoints[contours - 1] + 1
  let at = 10 + contours * 2
  at += 2 + data.getUint16(at)
  const flags = []
  while (flags.length < points) {
    if (at >= g.byteLength) return ''
    const flag = g[at++]
    flags.push(flag)
    if ((flag & 8) !== 0) {
      const repeat = g[at++] ?? 0
      for (let index = 0; index < repeat; index += 1) flags.push(flag)
    }
  }
  const coordinates = (short, same) => {
    const out = []
    let value = 0
    for (const flag of flags) {
      if ((flag & short) !== 0) {
        const byte = g[at++] ?? 0
        value += (flag & same) !== 0 ? byte : -byte
      } else if ((flag & same) === 0) {
        if (at + 2 > g.byteLength) throw new RangeError('glyph coordinates are truncated')
        value += data.getInt16(at)
        at += 2
      }
      out.push(value)
    }
    return out
  }
  const xs = coordinates(2, 16)
  const ys = coordinates(4, 32)
  let path = ''
  let first = 0
  for (const last of endPoints) {
    const contour = []
    for (let index = first; index <= last; index += 1) {
      contour.push({ x: xs[index], y: ys[index], on: (flags[index] & 1) !== 0 })
    }
    first = last + 1
    if (contour.length === 0) continue
    // Implied on-curve points sit halfway between consecutive off-curve points.
    const expanded = []
    contour.forEach((point, index) => {
      const next = contour[(index + 1) % contour.length]
      expanded.push(point)
      if (!point.on && !next.on) {
        expanded.push({ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2, on: true })
      }
    })
    const startIndex = expanded.findIndex(point => point.on)
    if (startIndex < 0) continue
    const ordered = [...expanded.slice(startIndex), ...expanded.slice(0, startIndex)]
    path += `M${round(ordered[0].x)},${round(ordered[0].y)}`
    for (let index = 1; index < ordered.length; index += 1) {
      const point = ordered[index]
      if (point.on) path += `L${round(point.x)},${round(point.y)}`
      else {
        const next = ordered[(index + 1) % ordered.length]
        path += `Q${round(point.x)},${round(point.y)} ${round(next.x)},${round(next.y)}`
        index += 1
      }
    }
    path += 'Z'
  }
  return path
}

const escapeXml = text =>
  text.replace(
    /[<>&"]/gu,
    char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char],
  )

/** The specimen sheet: one cell per specimen character the font maps to a non-empty glyph. */
function glyphSheet(tables, unitsPerEm, lookup, label) {
  const cells = []
  for (const char of SPECIMEN) {
    const glyph = lookup(char.codePointAt(0))
    if (glyph === 0) continue
    let path = ''
    try {
      path = glyphPath(tables, glyph)
    } catch {
      // One malformed glyph costs its cell, not the whole specimen.
    }
    if (path !== '') cells.push({ char, glyph, path })
  }
  if (cells.length === 0) return undefined
  const rows = Math.ceil(cells.length / COLUMNS)
  const width = COLUMNS * CELL
  const height = rows * CELL + 24
  const scale = round((CELL * 0.7) / unitsPerEm)
  const body = cells
    .map((cell, index) => {
      const x = (index % COLUMNS) * CELL + CELL * 0.15
      const y = 24 + Math.floor(index / COLUMNS) * CELL + CELL * 0.8
      return `<path id="glyph-${cell.glyph}" transform="translate(${round(x)} ${round(y)}) scale(${scale} ${-scale})" d="${cell.path}"/>`
    })
    .join('')
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/><text x="4" y="16" font-size="12" fill="#555555">${escapeXml(label)}</text><g fill="#111111">${body}</g></svg>`
  return { text, width, height, glyphs: cells.length }
}

async function readFont(bytes, budget) {
  const flavour = flavourOf(bytes)
  if (flavour === undefined) throw new TypeError('not a TrueType/OpenType/WOFF font')
  if (flavour === 'woff2') {
    const data = view(bytes)
    return {
      flavour,
      sfntFlavor: tagOf(bytes, 4),
      tags: woff2Tags(bytes),
      fonts: 1,
      tables: new Map(),
      declaredLength: data.getUint32(8),
      sfntSize: data.getUint32(16),
    }
  }
  let fonts = 1
  let directory
  if (flavour === 'woff') directory = await woffDirectory(bytes, budget)
  else if (flavour === 'ttc') {
    fonts = view(bytes).getUint32(8)
    if (fonts === 0 || bytes.byteLength < 16) throw new RangeError('font collection lists no fonts')
    directory = sfntDirectory(bytes, view(bytes).getUint32(12))
  } else directory = sfntDirectory(bytes, 0)
  return {
    flavour,
    sfntFlavor: directory.flavor,
    tags: [...directory.tables.keys()],
    fonts,
    tables: directory.tables,
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'font', label: 'Font', mediaType: 'font/sfnt' }),
  async detect(prefix) {
    const flavour = flavourOf(prefix)
    return flavour === undefined
      ? { confidence: 0, kind: 'magic', note: 'font-signature-mismatch' }
      : { confidence: flavour === 'ttf' ? 0.9 : 0.97, kind: 'magic', note: `font-${flavour}` }
  },
  async inspect(bytes, context) {
    const font = await readFont(bytes, context.budget.maxScalarBytes)
    const t = font.tables
    const head = t.get('head')
    const unitsPerEm = head !== undefined && head.byteLength >= 54 ? view(head).getUint16(18) : null
    const numGlyphs = t.get('maxp')?.byteLength >= 6 ? view(t.get('maxp')).getUint16(4) : null
    const weight = t.get('OS/2')?.byteLength >= 6 ? view(t.get('OS/2')).getUint16(4) : null
    const naming = names(t.get('name'))
    const outlines = t.has('glyf') ? 'truetype' : t.has('CFF ') || t.has('CFF2') ? 'cff' : 'unknown'
    const label = [naming.fullName ?? naming.family, LABELS[font.flavour]]
      .filter(Boolean)
      .join(' — ')
    const lookup = characterMap(t.get('cmap'))
    const sheet =
      outlines === 'truetype' && unitsPerEm && t.has('loca') && lookup !== undefined
        ? glyphSheet(
            {
              glyf: t.get('glyf'),
              loca: t.get('loca'),
              longLoca: view(head).getInt16(50) === 1,
            },
            unitsPerEm,
            lookup,
            label,
          )
        : undefined
    const facts = {
      container: font.flavour,
      containerLabel: LABELS[font.flavour],
      family: naming.family ?? null,
      subfamily: naming.subfamily ?? null,
      fullName: naming.fullName ?? null,
      postScriptName: naming.postScriptName ?? null,
      version: naming.version ?? null,
      outlines:
        font.flavour === 'woff2' ? (font.sfntFlavor === 'OTTO' ? 'cff' : 'truetype') : outlines,
      unitsPerEm,
      glyphs: numGlyphs,
      weightClass: weight,
      fontsInFile: font.fonts,
      tables: font.tags.length,
    }
    const dataSources = {
      'common.view/tree-data-source': createTreeDataSource({
        kind: 'font',
        label: LABELS[font.flavour],
        preview: label,
        children: [
          ...Object.entries(facts).map(([key, value]) => ({
            kind: 'field',
            label: key,
            preview: String(value ?? '—'),
          })),
          {
            kind: 'group',
            label: 'Tables',
            children: font.tags.map(tag => ({ kind: 'table', label: tag })),
          },
        ],
      }),
      ...(sheet === undefined
        ? {}
        : {
            'common.view/vector-scene-source': createVectorSceneSource(
              {
                width: sheet.width,
                height: sheet.height,
                viewBox: [0, 0, sheet.width, sheet.height],
                nodes: sheet.glyphs + 4,
                paths: sheet.glyphs,
                shapes: 1,
                textNodes: 1,
                gradients: 0,
              },
              sheet.text,
            ),
          }),
    }
    return {
      summary: { format: 'font', ...facts, specimenGlyphs: sheet?.glyphs ?? 0 },
      metadata: [
        {
          id: 'font',
          label: 'Font',
          entries: Object.entries(facts).map(([key, value]) => ({ key, value })),
        },
      ],
      traits: [
        ...(sheet === undefined
          ? []
          : [
              { id: 'vector.scene', parameters: { nodes: sheet.glyphs + 4 } },
              { id: 'vector.paths', parameters: { count: sheet.glyphs } },
            ]),
        // the font itself, which a viewer sets in text from these bytes
        { id: 'content.fonts' },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources,
      unsupportedFeatures: [
        ...(outlines === 'cff' || font.flavour === 'woff2'
          ? ['glyph-sheet-for-this-outline-container']
          : []),
        'composite-glyph-scale',
        'hinting',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
