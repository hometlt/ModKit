function markerOutsideString(text, marker) {
  let quote = false
  let escaped = false
  for (let index = 0; index <= text.length - marker.length; index += 1) {
    const character = text[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quote = false
      continue
    }
    if (character === '"') quote = true
    else if (text.startsWith(marker, index)) return true
  }
  return false
}

export function detectJson(dialect, text, uri) {
  if (text.includes('\0')) return { confidence: 0.01, note: 'nul-byte' }
  const trimmed = text.trimStart()
  const structure = trimmed.startsWith('{') || trimmed.startsWith('[')
  const comment = markerOutsideString(text, '//') || markerOutsideString(text, '/*')
  if (!structure) return { confidence: 0.05, note: 'no-json-root' }
  if (dialect === 'jsonc' && comment) return { confidence: 0.98, note: 'jsonc-marker' }
  if (dialect === 'json' && comment) return { confidence: 0.1, note: 'jsonc-marker' }
  const extension = uri.split(/[?#]/u, 1)[0]?.split('.').at(-1)?.toLowerCase()
  return {
    confidence: extension === dialect ? 0.78 : 0.72,
    note: 'json-jsonc-ambiguous',
  }
}
