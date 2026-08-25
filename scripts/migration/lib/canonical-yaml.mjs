// Canonical YAML subset used by the block-10 migration registry artifacts
// (migration/capabilities.yaml, migration/projections.yaml).
//
// The registry is a hand+machine hybrid: a skeleton is derived from
// migration/generated/source-inventory.json and the X3 ratchets, semantic fields are authored.
// A full YAML implementation would let that hybrid drift into unreviewable shapes, so the
// artifacts are restricted to one canonical subset and both the writer and the reader live here:
//
//   - two-space indentation, block style only;
//   - mappings with plain unquoted keys;
//   - scalars are quoted strings, integers, `true`/`false` or `null`, quoted exactly the way
//     Prettier quotes them for this repository, so `pnpm format:check` stays green;
//   - strings contain no backslashes and no line breaks;
//   - sequences are block sequences of scalars or of mappings;
//   - `[]` and `{}` are the only flow forms, and only for empty collections;
//   - `#` comments on their own line;
//   - no anchors, aliases, tags, multi-document streams or multi-line scalars.
//
// Anything outside the subset is a parse error, so a hand edit that breaks canonical form fails
// `pnpm migration:check` instead of silently changing meaning.

const INDENT = '  '

// --- writer ------------------------------------------------------------------------------------

/**
 * Quote exactly the way Prettier does for this repository (`singleQuote: true`): single quotes,
 * doubling an embedded `'`, unless the value contains a `'` and no `"` — then double quotes are
 * shorter. Backslashes and line breaks are rejected instead of escaped so the artifacts stay in
 * one unambiguous scalar style.
 */
function quote(value) {
  if (/[\\\n\r\t]/.test(value)) {
    throw new TypeError(
      `string contains a backslash or line break, which is outside the subset: ${value}`,
    )
  }
  const hasSingle = value.includes("'")
  const hasDouble = value.includes('"')
  if (hasSingle && !hasDouble) return `"${value}"`
  return `'${value.replace(/'/g, "''")}'`
}

function formatScalar(value) {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isInteger(value))
      throw new TypeError(`non-integer number is outside the subset: ${value}`)
    return String(value)
  }
  if (typeof value === 'string') return quote(value)
  throw new TypeError(`unsupported scalar ${String(value)}`)
}

const isScalar = value =>
  value === null ||
  typeof value === 'boolean' ||
  typeof value === 'number' ||
  typeof value === 'string'

function writeValue(value, depth, lines) {
  const pad = INDENT.repeat(depth)
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isScalar(item)) {
        lines.push(`${pad}- ${formatScalar(item)}`)
        continue
      }
      if (Array.isArray(item))
        throw new TypeError('nested sequence-of-sequence is outside the subset')
      const entries = Object.entries(item).filter(([, entry]) => entry !== undefined)
      if (entries.length === 0) {
        lines.push(`${pad}- {}`)
        continue
      }
      const [firstKey, firstValue] = entries[0]
      if (isScalar(firstValue)) {
        lines.push(`${pad}- ${firstKey}: ${formatScalar(firstValue)}`)
      } else if (Array.isArray(firstValue) && firstValue.length === 0) {
        lines.push(`${pad}- ${firstKey}: []`)
      } else if (!Array.isArray(firstValue) && Object.keys(firstValue).length === 0) {
        lines.push(`${pad}- ${firstKey}: {}`)
      } else {
        lines.push(`${pad}- ${firstKey}:`)
        writeValue(firstValue, depth + 2, lines)
      }
      for (const [key, entry] of entries.slice(1)) {
        writeMapEntry(key, entry, depth + 1, lines)
      }
    }
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue
    writeMapEntry(key, entry, depth, lines)
  }
}

function writeMapEntry(key, value, depth, lines) {
  const pad = INDENT.repeat(depth)
  if (isScalar(value)) {
    lines.push(`${pad}${key}: ${formatScalar(value)}`)
    return
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${pad}${key}: []`)
      return
    }
    lines.push(`${pad}${key}:`)
    writeValue(value, depth + 1, lines)
    return
  }
  if (Object.keys(value).length === 0) {
    lines.push(`${pad}${key}: {}`)
    return
  }
  lines.push(`${pad}${key}:`)
  writeValue(value, depth + 1, lines)
}

/** Render a document in the canonical subset. `comments` are emitted as a leading block. */
export function stringifyCanonicalYaml(document, comments = []) {
  const lines = comments.map(line => (line === '' ? '#' : `# ${line}`))
  writeValue(document, 0, lines)
  return `${lines.join('\n')}\n`
}

// --- reader ------------------------------------------------------------------------------------

class YamlError extends Error {
  constructor(message, lineNumber) {
    super(`line ${lineNumber}: ${message}`)
    this.name = 'YamlError'
    this.lineNumber = lineNumber
  }
}

function parseScalar(text, lineNumber) {
  if (text === 'null') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === '[]') return []
  if (text === '{}') return {}
  if (/^-?\d+$/.test(text)) return Number(text)
  if (text.includes('\\'))
    throw new YamlError('backslashes are outside the canonical subset', lineNumber)
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2)
      throw new YamlError('unterminated double-quoted string', lineNumber)
    const body = text.slice(1, -1)
    if (body.includes('"'))
      throw new YamlError('unescaped quote inside a double-quoted string', lineNumber)
    return body
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2)
      throw new YamlError('unterminated single-quoted string', lineNumber)
    const body = text.slice(1, -1)
    if (/(^|[^'])'([^']|$)/.test(body)) {
      throw new YamlError(
        'a single quote inside a single-quoted string must be doubled',
        lineNumber,
      )
    }
    return body.replace(/''/g, "'")
  }
  throw new YamlError(`scalar outside the canonical subset: ${text}`, lineNumber)
}

/** Parse a document written in the canonical subset. */
export function parseCanonicalYaml(text) {
  const rows = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) return
    const indent = raw.length - raw.trimStart().length
    if (indent % 2 !== 0)
      throw new YamlError('indentation must be a multiple of two spaces', lineNumber)
    if (/\t/.test(raw)) throw new YamlError('tabs are outside the canonical subset', lineNumber)
    rows.push({ depth: indent / 2, text: raw.trim(), lineNumber })
  })

  let cursor = 0

  const parseBlock = depth => {
    if (cursor >= rows.length) return {}
    if (rows[cursor].text.startsWith('- ')) return parseSequence(depth)
    return parseMapping(depth)
  }

  const parseMapping = depth => {
    const result = {}
    while (
      cursor < rows.length &&
      rows[cursor].depth === depth &&
      !rows[cursor].text.startsWith('- ')
    ) {
      const row = rows[cursor]
      const separator = row.text.indexOf(':')
      if (separator === -1)
        throw new YamlError(`expected "key: value": ${row.text}`, row.lineNumber)
      const key = row.text.slice(0, separator)
      if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(key)) {
        throw new YamlError(`key outside the canonical subset: ${key}`, row.lineNumber)
      }
      if (key in result) throw new YamlError(`duplicate key ${key}`, row.lineNumber)
      const rest = row.text.slice(separator + 1).trim()
      cursor += 1
      if (rest !== '') {
        result[key] = parseScalar(rest, row.lineNumber)
        continue
      }
      const childDepth = cursor < rows.length ? rows[cursor].depth : depth
      if (cursor >= rows.length || childDepth <= depth) {
        throw new YamlError(
          `key ${key} has no value; write null or an empty collection`,
          row.lineNumber,
        )
      }
      result[key] = parseBlock(childDepth)
    }
    return result
  }

  const parseSequence = depth => {
    const items = []
    while (
      cursor < rows.length &&
      rows[cursor].depth === depth &&
      rows[cursor].text.startsWith('- ')
    ) {
      const row = rows[cursor]
      const body = row.text.slice(2).trim()
      const separator = body.indexOf(':')
      const looksLikeMapping =
        separator !== -1 && /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(body.slice(0, separator))
      if (!looksLikeMapping) {
        items.push(parseScalar(body, row.lineNumber))
        cursor += 1
        continue
      }
      // A sequence item that opens a mapping: the first key sits on the dash line at depth+1,
      // the remaining keys are written one level in.
      const key = body.slice(0, separator)
      const rest = body.slice(separator + 1).trim()
      cursor += 1
      const item = {}
      if (rest !== '') {
        item[key] = parseScalar(rest, row.lineNumber)
      } else {
        const childDepth = cursor < rows.length ? rows[cursor].depth : depth
        if (cursor >= rows.length || childDepth <= depth + 1) {
          throw new YamlError(
            `key ${key} has no value; write null or an empty collection`,
            row.lineNumber,
          )
        }
        item[key] = parseBlock(childDepth)
      }
      while (
        cursor < rows.length &&
        rows[cursor].depth === depth + 1 &&
        !rows[cursor].text.startsWith('- ')
      ) {
        Object.assign(item, parseMapping(depth + 1))
      }
      items.push(item)
    }
    return items
  }

  const document = parseBlock(0)
  if (cursor !== rows.length) {
    throw new YamlError(
      'unexpected indentation; document did not consume every line',
      rows[cursor].lineNumber,
    )
  }
  return document
}
