const IDENTIFIER = /[A-Za-z0-9_]/u

function abort(signal) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

function logicalPath(value, label) {
  const normalized = value.replace(/\\/gu, '/').replace(/^\.\//u, '')
  if (
    normalized.length === 0 ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split('/').some(segment => segment === '' || segment === '..' || segment === '.')
  ) {
    throw new TypeError(`Spring ${label} is not a confined logical path`)
  }
  return normalized
}

function tokenize(text, budget, signal) {
  const tokens = []
  let cursor = 0
  const consume = () => {
    if (tokens.length >= budget.maxNodes) {
      throw new RangeError('Spring unit definition tokens exceed maxNodes')
    }
    abort(signal)
  }
  while (cursor < text.length) {
    abort(signal)
    const character = text[cursor]
    if (/\s/u.test(character)) {
      cursor += 1
      continue
    }
    if (text.startsWith('--[[', cursor)) {
      const end = text.indexOf(']]', cursor + 4)
      if (end === -1)
        throw new TypeError('Spring unit definition has an unterminated block comment')
      cursor = end + 2
      continue
    }
    if (text.startsWith('--', cursor)) {
      const end = text.indexOf('\n', cursor + 2)
      cursor = end === -1 ? text.length : end + 1
      continue
    }
    if (character === '"' || character === "'") {
      const quote = character
      let value = ''
      cursor += 1
      let terminated = false
      while (cursor < text.length) {
        const next = text[cursor]
        cursor += 1
        if (next === quote) {
          terminated = true
          break
        }
        if (next === '\\') {
          if (cursor >= text.length) break
          const escaped = text[cursor]
          cursor += 1
          value +=
            escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === 't' ? '\t' : escaped
        } else value += next
        if (new TextEncoder().encode(value).byteLength > budget.maxScalarBytes) {
          throw new RangeError('Spring unit definition string exceeds maxScalarBytes')
        }
      }
      if (!terminated) throw new TypeError('Spring unit definition has an unterminated string')
      consume()
      tokens.push(Object.freeze({ kind: 'string', value }))
      continue
    }
    if (character !== undefined && /[A-Za-z_]/u.test(character)) {
      const start = cursor
      cursor += 1
      while (cursor < text.length && IDENTIFIER.test(text[cursor])) cursor += 1
      consume()
      tokens.push(Object.freeze({ kind: 'identifier', value: text.slice(start, cursor) }))
      continue
    }
    consume()
    tokens.push(Object.freeze({ kind: 'punctuation', value: character }))
    cursor += 1
  }
  return tokens
}

function uniqueAssignment(tokens, key) {
  const values = []
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const name = tokens[index]
    const equals = tokens[index + 1]
    const value = tokens[index + 2]
    if (
      name?.kind === 'identifier' &&
      name.value.toLowerCase() === key &&
      equals?.value === '=' &&
      value?.kind === 'string'
    ) {
      values.push(value.value)
    }
  }
  const distinct = [...new Set(values)]
  if (distinct.length > 1) {
    throw new TypeError(`Spring unit definition declares ambiguous ${key} values`)
  }
  return distinct[0]
}

export function parseUnitDefinition(bytes, budget, signal) {
  abort(signal)
  if (BigInt(bytes.byteLength) > budget.maxInputBytes) {
    throw new RangeError('Spring unit definition exceeds maxInputBytes')
  }
  if (bytes.byteLength > budget.maxScalarBytes) {
    throw new RangeError('Spring unit definition exceeds maxScalarBytes')
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const tokens = tokenize(text, budget, signal)
  const objectName = uniqueAssignment(tokens, 'objectname')
  const script = uniqueAssignment(tokens, 'script')
  return Object.freeze({
    ...(objectName === undefined ? {} : { objectName: logicalPath(objectName, 'objectName') }),
    ...(script === undefined ? {} : { script: logicalPath(script, 'script') }),
  })
}

function below(prefix, path) {
  const lower = path.toLowerCase()
  return lower.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path
}

export function modelPathFor(objectName) {
  return `objects3d/${below('objects3d', logicalPath(objectName, 'objectName'))}`
}

export function scriptPathFor(script) {
  return `scripts/${below('scripts', logicalPath(script, 'script'))}`
}

export function bosPathFor(scriptPath) {
  return /\.cob$/iu.test(scriptPath) ? scriptPath.replace(/\.cob$/iu, '.bos') : undefined
}
