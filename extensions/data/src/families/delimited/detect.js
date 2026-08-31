/**
 * Delimited detection reads the same grammar the parser reads.
 *
 * The first implementation split the probe window on bare newlines and then on the bare delimiter.
 * That is not the CSV grammar: RFC 4180 lets a quoted field carry the delimiter, a CR, an LF and a
 * doubled quote. A spec-legal file whose first data row contains `"Hello, ""world"""` therefore
 * reported four fields where the document has three, an embedded CR/LF split one row into two, the
 * arity looked unstable and the format scored 0.05 — the canonical document stack parsed the very
 * same bytes (block 9 difference matrix, `csv-synthetic`).
 *
 * The scan below is the parser's own state machine, bounded to the first few rows: quotes suspend
 * both the delimiter and the row break, `""` is an escaped quote, and CRLF counts once. Nothing
 * else about the verdict changed — stable arity over at least two rows still decides, and the file
 * extension still separates a confident match from a plausible one.
 */

/** Rows to sample. Enough to see stable arity, small enough to stay a bounded probe. */
const SAMPLE_ROWS = 4

/**
 * Field counts of the leading rows, read with quote awareness.
 *
 * Scanning stops as soon as `SAMPLE_ROWS` complete rows are known. A trailing newline does not
 * open a further row, and a probe window that ends inside a quoted field simply contributes no
 * further row — a truncated prefix must not look like unstable arity.
 */
function sampleWidths(text, delimiter) {
  const widths = []
  let fields = 1
  let quoted = false
  let sawContent = false
  for (let index = 0; index < text.length && widths.length < SAMPLE_ROWS; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character !== '"') continue
      if (text[index + 1] === '"') index += 1
      else quoted = false
      continue
    }
    if (character === '"') {
      quoted = true
      sawContent = true
      continue
    }
    if (character === delimiter) {
      fields += 1
      sawContent = true
      continue
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      if (sawContent) widths.push(fields)
      fields = 1
      sawContent = false
      continue
    }
    sawContent = true
  }
  // A final row without a trailing newline still counts, but an unterminated quoted field does
  // not: the probe window may simply have ended mid-field.
  if (!quoted && sawContent && widths.length < SAMPLE_ROWS) widths.push(fields)
  return widths
}

export function detectDelimited(format, delimiter, text, uri) {
  if (text.includes('\0')) return { confidence: 0.01, note: 'nul-byte' }
  const extension = uri.split(/[?#]/u, 1)[0]?.split('.').at(-1)?.toLowerCase()
  const widths = sampleWidths(text, delimiter)
  const stable = widths.length >= 2 && widths[0] >= 2 && widths.every(width => width === widths[0])
  return {
    confidence: stable ? (extension === format ? 0.94 : 0.76) : 0.05,
    note: 'delimited-arity',
  }
}
