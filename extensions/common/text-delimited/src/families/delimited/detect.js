export function detectDelimited(format, delimiter, text, uri) {
  if (text.includes('\0')) return { confidence: 0.01, note: 'nul-byte' }
  const extension = uri.split(/[?#]/u, 1)[0]?.split('.').at(-1)?.toLowerCase()
  const lines = text
    .split(/\r\n|\r|\n/u)
    .filter(Boolean)
    .slice(0, 4)
  const widths = lines.map(line => line.split(delimiter).length)
  const stable = widths.length >= 2 && widths[0] >= 2 && widths.every(width => width === widths[0])
  return {
    confidence: stable ? (extension === format ? 0.94 : 0.76) : 0.05,
    note: 'delimited-arity',
  }
}
