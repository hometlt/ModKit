/**
 * Parsers for other SC2 text file formats.
 */

/**
 * Parse a SC2 .ini-style text file (SC2Env.SC2Env, etc.)
 * Format:
 *   [SectionName]
 *   Key=Value
 */
export function parseSc2Ini(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let current = new Map<string, string>()
  sections.set('', current)

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue

    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1)
      current = new Map()
      sections.set(name, current)
      continue
    }

    const eq = line.indexOf('=')
    if (eq !== -1) {
      current.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
    }
  }

  return sections
}

/**
 * Parse a SC2 locale string file (.SC2Data/LocalizedData/*.txt or GameStrings.txt)
 * Format:  GameUI/ButtonName/Marine=Marine
 */
export function parseSc2Strings(text: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const rawLine of text.split(/\r?\n/)) {
    // Strip LEADING whitespace and any stray \r only. The value runs to end of line and
    // its trailing whitespace is SIGNIFICANT: Blizzard's own
    // `UI/Unlocks_Colon=Unlocks: ` relies on the trailing space for the gap before the
    // unit list in the tech tree, and trimming it butts the two labels together.
    const line = rawLine.replace(/^\s+/, '').replace(/\r+$/, '')
    if (!line || line.startsWith('//')) continue
    const eq = line.indexOf('=')
    if (eq !== -1) {
      result.set(line.slice(0, eq).trim(), line.slice(eq + 1))
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Ordered line-model for locale string files (lossless / round-trip safe).
//
// `parseSc2Strings` above is a lossy lookup map: it trims, drops blank/comment
// lines, and silently collapses DUPLICATE keys (real GameStrings.txt files do
// contain duplicates). The ordered model below is the source of truth for any
// editing or byte-exact round-trip. See docs/tasks-complete/entity-cards-strings/STRING_FILE_MODEL.md.
// ---------------------------------------------------------------------------

/** One physical line of a locale `.txt` file. */
export interface StringLine {
  /** Key (text before the first `=`); '' for blank/comment lines. */
  key: string
  /** Value (everything after the first `=`); not trimmed. '' for non-entry lines. */
  value: string
  /** Exact original line text, WITHOUT the line terminator. */
  raw: string
  /** Terminator that followed this line ('' for a final line with no EOL). */
  eol: '\r\n' | '\n' | ''
  /** True when the line contained a `=` (a real key/value entry). */
  isEntry: boolean
}

/** Ordered, lossless model of a locale string file. */
export interface StringFileModel {
  /** Whether the source began with a UTF-8 BOM (preserved on serialize). */
  bom: boolean
  /** All lines in order, including duplicates and blanks. */
  lines: StringLine[]
  /** Derived lookup: key → all entry lines with that key (last = effective). */
  index: Map<string, StringLine[]>
}

/** Split text into lines, recording each line's terminator (preserves mixed EOLs). */
function splitKeepEol(text: string): Array<{ content: string; eol: '\r\n' | '\n' | '' }> {
  const out: Array<{ content: string; eol: '\r\n' | '\n' | '' }> = []
  let i = 0
  while (i < text.length) {
    const nl = text.indexOf('\n', i)
    if (nl === -1) {
      out.push({ content: text.slice(i), eol: '' })
      break
    }
    if (nl > i && text[nl - 1] === '\r') {
      out.push({ content: text.slice(i, nl - 1), eol: '\r\n' })
    } else {
      out.push({ content: text.slice(i, nl), eol: '\n' })
    }
    i = nl + 1
  }
  return out
}

/** Build the derived key → lines index for a model's line list. */
function buildStringIndex(lines: StringLine[]): Map<string, StringLine[]> {
  const index = new Map<string, StringLine[]>()
  for (const line of lines) {
    if (!line.isEntry) continue
    let bucket = index.get(line.key)
    if (!bucket) {
      bucket = []
      index.set(line.key, bucket)
    }
    bucket.push(line)
  }
  return index
}

/**
 * Parse a locale `.txt` into the lossless ordered model. Accepts a string or raw
 * UTF-8 bytes. Preserves BOM, per-line terminators, blank/comment lines, value
 * whitespace, and duplicate keys. Round-trips byte-exact via {@link serializeStringModel}.
 */
export function parseSc2StringsOrdered(input: string | Uint8Array): StringFileModel {
  let text: string
  let bom = false
  if (typeof input === 'string') {
    if (input.charCodeAt(0) === 0xfeff) {
      bom = true
      text = input.slice(1)
    } else text = input
  } else {
    bom = input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf
    // TextDecoder('utf-8') strips a leading BOM by default, so the decoded text
    // has no BOM char regardless; we tracked it from the raw bytes above.
    text = new TextDecoder('utf-8').decode(input)
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  }

  const lines: StringLine[] = splitKeepEol(text).map(({ content, eol }) => {
    const eq = content.indexOf('=')
    // A line whose key portion starts with `//` is a full-line comment (distinct
    // from the `///` trailing-comment convention on a real entry's value), even if
    // the comment text itself happens to contain an `=`.
    const keyPart = eq === -1 ? content : content.slice(0, eq)
    if (eq === -1 || keyPart.trimStart().startsWith('//')) {
      return { key: '', value: '', raw: content, eol, isEntry: false }
    }
    return {
      key: content.slice(0, eq),
      value: content.slice(eq + 1),
      raw: content,
      eol,
      isEntry: true,
    }
  })

  return { bom, lines, index: buildStringIndex(lines) }
}

/** Serialize the ordered model back to text, byte-exact for an unedited model. */
export function serializeStringModel(model: StringFileModel): string {
  let out = model.bom ? '﻿' : ''
  for (const line of model.lines) out += line.raw + line.eol
  return out
}

/** Effective value for a key (last occurrence wins, matching the SC2 loader). */
export function effectiveValue(model: StringFileModel, key: string): string | undefined {
  const bucket = model.index.get(key)
  return bucket && bucket.length ? bucket[bucket.length - 1]!.value : undefined
}

/** Rebuild a line's `raw` from its current key/value (after an edit). */
function rebuildRaw(line: StringLine): void {
  line.raw = line.isEntry ? `${line.key}=${line.value}` : line.raw
}

/**
 * Set the value of `key`, patching only its LAST occurrence. Returns true when a
 * line changed. Does not create the key if absent (use {@link addStringEntry}).
 */
export function setStringValue(model: StringFileModel, key: string, newValue: string): boolean {
  const bucket = model.index.get(key)
  const line = bucket && bucket.length ? bucket[bucket.length - 1]! : undefined
  if (!line || line.value === newValue) return false
  line.value = newValue
  rebuildRaw(line)
  return true
}

/** Rename a key across all its occurrences (values/terminators untouched). Returns count. */
export function renameStringKey(model: StringFileModel, oldKey: string, newKey: string): number {
  const bucket = model.index.get(oldKey)
  if (!bucket || oldKey === newKey) return 0
  for (const line of bucket) {
    line.key = newKey
    rebuildRaw(line)
  }
  model.index.delete(oldKey)
  const dest = model.index.get(newKey)
  if (dest) dest.push(...bucket)
  else model.index.set(newKey, bucket)
  return bucket.length
}

/** Append a new entry (optionally after the last occurrence of `afterKey`). */
export function addStringEntry(
  model: StringFileModel,
  key: string,
  value: string,
  afterKey?: string,
): void {
  const line: StringLine = { key, value, raw: `${key}=${value}`, eol: '\n', isEntry: true }
  // The current last line may lack a terminator; give it one so appends are valid.
  const last = model.lines[model.lines.length - 1]
  if (last && last.eol === '') last.eol = '\n'

  let pos = model.lines.length
  if (afterKey) {
    const bucket = model.index.get(afterKey)
    const anchor = bucket && bucket.length ? bucket[bucket.length - 1] : undefined
    if (anchor) pos = model.lines.indexOf(anchor) + 1
  }
  model.lines.splice(pos, 0, line)
  const dest = model.index.get(key)
  if (dest) dest.push(line)
  else model.index.set(key, [line])
}

/**
 * LEGACY plain-text reader: returns every non-comment line. Only the custom/test
 * flat-text `ComponentList.SC2Components` convention (one dependency path per line)
 * uses this shape. Real SC2 files are XML — use {@link parseComponentList}, which
 * routes by `isXml`.
 */
export function parseSc2ComponentList(text: string): string[] {
  const lines: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line && !line.startsWith('//') && !line.startsWith('#')) {
      lines.push(line)
    }
  }
  return lines
}

/** One `<DataComponent>` entry from a `ComponentList.SC2Components` file. */
export interface ComponentEntry {
  /** FourCC-ish kind: `gada`|`text`|`info`|`mapi`|`trig`|`cuts`|`plob`|`font`|`uiui`… */
  type: string
  /** Present iff `Type="text"`; the declared locale (PascalCase, e.g. `enUS`). */
  locale?: string
  /** Inner text — the data path/stem, e.g. `GameData` / `GameText` / `UI/Layout/DescIndex.SC2Layout`. */
  path: string
}

export interface ComponentListResult {
  components: ComponentEntry[]
  /** Distinct declared locales (`Type="text" Locale=…`), first-seen order. */
  locales: string[]
  /** true when the text is the SC2 `<Components>` XML form (vs the legacy flat text). */
  isXml: boolean
}

const RE_DATA_COMPONENT = /<DataComponent\b([^>]*)>([\s\S]*?)<\/DataComponent>/gi

/**
 * Structurally parse a SC2 `ComponentList.SC2Components` file (the XML form), yielding
 * typed `<DataComponent>` records and the authoritative set of declared locales.
 *
 * Browser-safe: pure regex/string scanning, zero deps. Attribute order is tolerated
 * (`Type` and `Locale` are matched independently). `isXml` is false for the legacy
 * flat-text convention (no `<Components>` wrapper), in which case there are no
 * components/locales — callers fall back to {@link parseSc2ComponentList}.
 */
export function parseComponentList(text: string): ComponentListResult {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // strip BOM
  const isXml = /<Components\b/i.test(text)
  const components: ComponentEntry[] = []
  const locales: string[] = []
  if (!isXml) return { components, locales, isXml }

  const seen = new Set<string>()
  RE_DATA_COMPONENT.lastIndex = 0
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = RE_DATA_COMPONENT.exec(text))) {
    const attrs = m[1]!
    const type = attrs.match(/\bType="([^"]*)"/i)?.[1] ?? ''
    const locale = attrs.match(/\bLocale="([^"]*)"/i)?.[1]
    const entry: ComponentEntry = { type, path: m[2]!.trim() }
    if (locale !== undefined) {
      entry.locale = locale
      if (!seen.has(locale)) {
        seen.add(locale)
        locales.push(locale)
      }
    }
    components.push(entry)
  }
  return { components, locales, isXml }
}
