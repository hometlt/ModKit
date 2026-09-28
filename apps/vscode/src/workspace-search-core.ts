/**
 * The editor-independent half of searching Modkit folders (`modkit-source:`, `modkit-container:`)
 * from VS Code's own search: glob scoping, quick-open ranking and text matching with previews.
 * `workspace-search.ts` wires it to the search provider API.
 */

/**
 * A VS Code glob (`**`, `*`, `?`, `{a,b}`, `[...]`) as a case-insensitive whole-path test. A file
 * matches when its path or one of its folders does — `**\/node_modules` excludes what is inside.
 */
export function globMatcher(globs: readonly string[]): (path: string) => boolean {
  const patterns = globs
    .map(glob => glob.trim().replaceAll('\\', '/').replace(/^\.\//u, ''))
    .filter(glob => glob !== '')
    .map(glob => new RegExp(`^${globSource(glob)}$`, 'iu'))
  if (patterns.length === 0) return () => false
  return path => {
    for (let end = path.indexOf('/'); ; end = path.indexOf('/', end + 1)) {
      const candidate = end === -1 ? path : path.slice(0, end)
      if (patterns.some(pattern => pattern.test(candidate))) return true
      if (end === -1) return false
    }
  }
}

function globSource(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!
    if (char === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/'
        const atSegmentStart = i === 0 || glob[i - 1] === '/'
        out += slashAfter && atSegmentStart ? '(?:.*/)?' : '.*'
        i += slashAfter && atSegmentStart ? 2 : 1
      } else out += '[^/]*'
    } else if (char === '?') out += '[^/]'
    else if (char === '{') {
      let depth = 1
      let end = i + 1
      for (; end < glob.length && depth > 0; end++) {
        if (glob[end] === '{') depth++
        else if (glob[end] === '}') depth--
      }
      if (depth !== 0) out += '\\{'
      else {
        out += `(?:${splitAlternatives(glob.slice(i + 1, end - 1)).map(globSource).join('|')})`
        i = end - 1
      }
    } else if (char === '[') {
      const end = glob.indexOf(']', i + 1)
      if (end === -1) out += '\\['
      else {
        const body = glob.slice(i + 1, end).replace(/^!/u, '^').replaceAll('\\', '\\\\')
        out += `[${body}]`
        i = end
      }
    } else out += char.replace(/[.+^${}()|\\/]/gu, match => `\\${match}`)
  }
  return out
}

/** `a,{b,c},d` → `a`, `{b,c}`, `d`: only top-level commas separate. */
function splitAlternatives(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') depth++
    else if (body[i] === '}') depth--
    else if (body[i] === ',' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts
}

/** Whether `text` holds the characters of `needle` in order, not necessarily together. */
export function holdsInOrder(text: string, needle: string): boolean {
  let at = 0
  for (let i = 0; i < text.length && at < needle.length; i++) if (text[i] === needle[at]) at++
  return at === needle.length
}

/** What quick-open typed, as the characters a path must hold in order. */
export function quickOpenNeedle(pattern: string): string {
  return pattern.replace(/\s+/gu, '').replaceAll('\\', '/').toLowerCase()
}

/**
 * Keep the `maximum` paths quick-open most likely wants, of those that hold the needle in order:
 * the name holding it whole first, then the path holding it whole, then the rest. VS Code scores
 * what it gets again; this only decides which of many thousands of CASC names it gets at all.
 * Returns `full` when the strongest group is complete, so a caller may stop reading more names.
 */
export function createQuickOpenRanking(pattern: string, maximum: number) {
  const needle = quickOpenNeedle(pattern)
  const groups: [string[], string[], string[]] = [[], [], []]
  return {
    /** Consider one path; one that does not hold the needle in order is left out. */
    add(path: string): void {
      const folded = path.toLowerCase()
      if (!holdsInOrder(folded, needle)) return
      const name = folded.slice(folded.lastIndexOf('/') + 1)
      const group = groups[name.includes(needle) ? 0 : folded.includes(needle) ? 1 : 2]
      if (group.length < maximum) group.push(path)
    },
    get full(): boolean {
      return groups[0].length >= maximum
    },
    results(): string[] {
      return [...groups[0], ...groups[1], ...groups[2]].slice(0, maximum)
    },
  }
}

export interface TextQuery {
  readonly pattern: string
  readonly isRegExp?: boolean
  readonly isCaseSensitive?: boolean
  readonly isWordMatch?: boolean
  readonly isMultiline?: boolean
}

/** The query as one global regular expression, as VS Code's own search builds it. */
export function textSearchRegExp(query: TextQuery): RegExp {
  let source = query.isRegExp
    ? query.pattern
    : query.pattern.replace(/[.*+?^${}()|[\]\\]/gu, match => `\\${match}`)
  if (query.isWordMatch) source = `\\b(?:${source})\\b`
  const flags = `gm${query.isCaseSensitive ? '' : 'i'}`
  try {
    return new RegExp(source, `${flags}u`)
  } catch {
    return new RegExp(source, flags)
  }
}

export interface PreviewOptions {
  readonly matchLines: number
  readonly charsPerLine: number
}

export interface LineRange {
  readonly startLine: number
  readonly startCharacter: number
  readonly endLine: number
  readonly endCharacter: number
}

/** One reported line: where in the file, and the same spans inside `previewText`. */
export interface TextSearchHit {
  readonly ranges: readonly LineRange[]
  readonly previewText: string
  readonly previewRanges: readonly LineRange[]
}

/**
 * Every match of `regexp` in `text`, grouped by the line it starts on (as ripgrep reports them),
 * at most `maximum` matches. A match spanning lines is kept only for a multiline query; empty
 * matches are skipped.
 */
export function findTextMatches(
  text: string,
  regexp: RegExp,
  options: { readonly multiline: boolean; readonly maximum: number; readonly preview: PreviewOptions },
): { readonly hits: readonly TextSearchHit[]; readonly matches: number; readonly limitHit: boolean } {
  const hits: TextSearchHit[] = []
  let matches = 0
  let line = 0
  let lineStart = 0
  let group: { line: number; spans: { start: number; end: number }[] } | undefined
  const advanceTo = (offset: number): void => {
    for (let at = text.indexOf('\n', lineStart); at !== -1 && at < offset; at = text.indexOf('\n', at + 1)) {
      line++
      lineStart = at + 1
    }
  }
  const flush = (): void => {
    if (group !== undefined) hits.push(hitFor(text, group.line, group.spans, options.preview))
    group = undefined
  }
  regexp.lastIndex = 0
  for (let found = regexp.exec(text); found !== null; found = regexp.exec(text)) {
    const start = found.index
    const end = start + found[0].length
    if (end === start) {
      regexp.lastIndex = start + 1
      continue
    }
    if (!options.multiline && found[0].includes('\n')) {
      regexp.lastIndex = start + 1
      continue
    }
    if (matches >= options.maximum) {
      flush()
      return { hits, matches, limitHit: true }
    }
    advanceTo(start)
    if (group?.line !== line) {
      flush()
      group = { line, spans: [] }
    }
    group.spans.push({ start, end })
    matches++
  }
  flush()
  return { hits, matches, limitHit: false }
}

function hitFor(
  text: string,
  line: number,
  spans: readonly { readonly start: number; readonly end: number }[],
  preview: PreviewOptions,
): TextSearchHit {
  const lineStart = text.lastIndexOf('\n', spans[0]!.start - 1) + 1
  const ranges = spans.map(span => rangeOf(text, lineStart, line, span.start, span.end))
  // The preview is the lines the matches cover, each cut to `charsPerLine`, so a minified file
  // does not send a megabyte per result; the window starts shortly before the first match.
  const lastLine = Math.min(
    ranges.reduce((most, range) => Math.max(most, range.endLine), line),
    line + Math.max(1, preview.matchLines) - 1,
  )
  let previewEnd = lineStart
  for (let at = line; at <= lastLine; at++) {
    const next = text.indexOf('\n', previewEnd)
    previewEnd = next === -1 ? text.length : at < lastLine ? next + 1 : next
  }
  const width = Math.max(1, preview.charsPerLine)
  const skip = ranges[0]!.startCharacter > width / 2 ? ranges[0]!.startCharacter - 20 : 0
  const lines = text
    .slice(lineStart, previewEnd)
    .replace(/\r(?=\n|$)/gu, '')
    .split('\n')
    .map((item, index) => (index === 0 ? item.slice(skip, skip + width) : item.slice(0, width)))
  const previewRanges = ranges.map(range => {
    const startCharacter = Math.max(0, range.startCharacter - skip)
    const endLine = Math.min(range.endLine, lastLine) - line
    const endCharacter =
      range.endLine > lastLine
        ? (lines[endLine]?.length ?? 0)
        : endLine === 0
          ? Math.max(startCharacter, range.endCharacter - skip)
          : range.endCharacter
    return {
      startLine: 0,
      startCharacter: Math.min(startCharacter, lines[0]!.length),
      endLine,
      endCharacter: Math.min(endCharacter, lines[endLine]?.length ?? endCharacter),
    }
  })
  return { ranges, previewText: lines.join('\n'), previewRanges }
}

function rangeOf(text: string, lineStart: number, line: number, start: number, end: number): LineRange {
  let endLine = line
  let endLineStart = lineStart
  for (let at = text.indexOf('\n', start); at !== -1 && at < end; at = text.indexOf('\n', at + 1)) {
    endLine++
    endLineStart = at + 1
  }
  return {
    startLine: line,
    startCharacter: start - lineStart,
    endLine,
    endCharacter: end - endLineStart,
  }
}

/** Whether bytes look like a binary file: a NUL in the first 8 KiB, as ripgrep decides. */
export function looksBinary(bytes: Uint8Array): boolean {
  // UTF-16 text is full of NULs; its byte-order mark says it is text.
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return false
  const end = Math.min(bytes.length, 8192)
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true
  return false
}

/**
 * Whether a text search may take its files from a content index (host `content-index`). The index
 * answers a literal query of printable ASCII over the default text files: every other byte folds
 * into one class, so an encoding would change such a query's trigrams. A regular expression, any
 * other character or a "files to include" choice is searched by reading every file, as before.
 */
export function contentIndexApplies(query: TextQuery, includes: readonly string[]): boolean {
  if (query.isRegExp === true || includes.length > 0) return false
  for (let index = 0; index < query.pattern.length; index++) {
    const code = query.pattern.charCodeAt(index)
    if (code !== 9 && (code < 32 || code > 126)) return false
  }
  return true
}

/** Bytes as the content index should see them: the index skips NULs, so UTF-16 becomes UTF-8. */
export function indexableText(bytes: Uint8Array): Uint8Array {
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
  return utf16 ? new TextEncoder().encode(decodeText(bytes, undefined)) : bytes
}

/**
 * `read` runs up to `width` items ahead of the consumer; results come in order. A content index is
 * built from one file at a time, and one read at a time would make the first search the slowest.
 * `read` must not reject: a later read would fail unobserved while an earlier one is awaited.
 */
export async function* readAhead<T, R>(
  items: AsyncIterable<T>,
  read: (item: T) => Promise<R>,
  width: number,
): AsyncGenerator<R> {
  const pending: Promise<R>[] = []
  for await (const item of items) {
    pending.push(read(item))
    const next = pending.length >= width ? pending.shift() : undefined
    if (next !== undefined) yield await next
  }
  for (const next of pending) yield await next
}

/** Text of a file in the encoding the search asked for; a byte-order mark wins, as in VS Code. */
export function decodeText(bytes: Uint8Array, encoding: string | undefined): string {
  let label = (encoding ?? 'utf8').toLowerCase()
  if (bytes[0] === 0xff && bytes[1] === 0xfe) label = 'utf-16le'
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be'
  else if (label === 'utf8' || label === 'utf8bom') label = 'utf-8'
  else if (label === 'utf16le') label = 'utf-16le'
  else if (label === 'utf16be') label = 'utf-16be'
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}
