/**
 * Lua's string machinery for the evaluator (evaluate.ts): number spelling as Lua prints it, the
 * patterns of `string.find`/`match`/`gmatch`/`gsub` (a port of lstrlib's matcher), and
 * `string.format`. Strings are JavaScript strings; a pattern class tests UTF-16 code units the way
 * lstrlib tests bytes, which is the same for the ASCII text data scripts carry.
 */

/** Lua 5.1 `tostring` of a number: `%.14g`, `inf`, `-inf`, `nan`. */
export function luaNumberText(value: number): string {
  if (Number.isNaN(value)) return 'nan'
  if (value === Infinity) return 'inf'
  if (value === -Infinity) return '-inf'
  if (Number.isInteger(value) && Math.abs(value) < 1e15)
    return Object.is(value, -0) ? '-0' : String(value)
  return cFormat(value, 'g', 14, '')
}

/** C printf of one number: `e`, `f` or `g` with a precision and the `#` flag. */
export function cFormat(
  value: number,
  conversion: 'e' | 'f' | 'g',
  precision: number,
  flags: string,
): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf'
  const alternate = flags.includes('#')
  const exponential = (digits: number) => {
    const [mantissa, exponent] = Math.abs(value).toExponential(digits).split('e') as [
      string,
      string,
    ]
    const power = Number(exponent)
    return `${value < 0 || Object.is(value, -0) ? '-' : ''}${mantissa}e${power < 0 ? '-' : '+'}${String(Math.abs(power)).padStart(2, '0')}`
  }
  if (conversion === 'e') return exponential(precision)
  if (conversion === 'f') return value.toFixed(precision)
  // %g: the shortest of the two, by the exponent the value has at this precision
  const digits = Math.max(1, precision)
  const power = Number(
    Math.abs(value)
      .toExponential(digits - 1)
      .split('e')[1],
  )
  let text =
    power < -4 || power >= digits
      ? exponential(digits - 1)
      : value.toFixed(Math.max(0, digits - 1 - power))
  if (!alternate) {
    // trailing zeros of the fraction go, and the point with them
    text = text.replace(/(\.\d*?)0+(e|$)/u, '$1$2').replace(/\.(e|$)/u, '$1')
  }
  return text
}

// ---------------------------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------------------------

/** A capture: a substring (start, length) or a position capture (length -2). */
interface Capture {
  start: number
  length: number
}

const CAPTURE_UNFINISHED = -1
const CAPTURE_POSITION = -2
const MAX_CAPTURES = 32

export class LuaPatternError extends Error {}

interface MatchState {
  readonly source: string
  readonly pattern: string
  level: number
  readonly captures: Capture[]
  /** Called once per matching step, so a pattern cannot backtrack without bound. */
  readonly tick: () => void
  depth: number
}

const code = (text: string, index: number) => text.charCodeAt(index)

function classEnd(state: MatchState, at: number): number {
  const { pattern } = state
  let index = at
  if (index >= pattern.length) throw new LuaPatternError('malformed pattern (ends with "%")')
  const character = pattern[index++]!
  if (character === '%') {
    if (index >= pattern.length) throw new LuaPatternError('malformed pattern (ends with "%")')
    return index + 1
  }
  if (character === '[') {
    if (pattern[index] === '^') index++
    // the first character of a set may be "]"
    do {
      if (index >= pattern.length) throw new LuaPatternError('malformed pattern (missing "]")')
      const current = pattern[index++]!
      if (current === '%') index++
    } while (pattern[index] !== ']')
    return index + 1
  }
  return index
}

function singleClass(character: number, kind: string): boolean {
  const lower = kind.toLowerCase()
  let result: boolean
  switch (lower) {
    case 'a':
      result = (character >= 65 && character <= 90) || (character >= 97 && character <= 122)
      break
    case 'c':
      result = character < 32 || character === 127
      break
    case 'd':
      result = character >= 48 && character <= 57
      break
    case 'g':
      result = character > 32 && character < 127
      break
    case 'l':
      result = character >= 97 && character <= 122
      break
    case 'p':
      result =
        (character >= 33 && character <= 47) ||
        (character >= 58 && character <= 64) ||
        (character >= 91 && character <= 96) ||
        (character >= 123 && character <= 126)
      break
    case 's':
      result = character === 32 || (character >= 9 && character <= 13)
      break
    case 'u':
      result = character >= 65 && character <= 90
      break
    case 'w':
      result =
        (character >= 48 && character <= 57) ||
        (character >= 65 && character <= 90) ||
        (character >= 97 && character <= 122)
      break
    case 'x':
      result =
        (character >= 48 && character <= 57) ||
        (character >= 65 && character <= 70) ||
        (character >= 97 && character <= 102)
      break
    default:
      return kind.charCodeAt(0) === character
  }
  // an upper-case class is the complement
  return kind === lower ? result : !result
}

function setMatch(state: MatchState, character: number, start: number, end: number): boolean {
  const { pattern } = state
  let index = start + 1
  let negate = false
  if (pattern[index] === '^') {
    negate = true
    index++
  }
  while (index < end) {
    if (pattern[index] === '%') {
      index++
      if (singleClass(character, pattern[index]!)) return !negate
      index++
    } else if (pattern[index + 1] === '-' && index + 2 < end) {
      if (code(pattern, index) <= character && character <= code(pattern, index + 2)) return !negate
      index += 3
    } else {
      if (code(pattern, index) === character) return !negate
      index++
    }
  }
  return negate
}

function singleMatch(state: MatchState, at: number, patternAt: number, classAt: number): boolean {
  if (at >= state.source.length) return false
  const character = code(state.source, at)
  const kind = state.pattern[patternAt]
  if (kind === '.') return true
  if (kind === '%') return singleClass(character, state.pattern[patternAt + 1]!)
  if (kind === '[') return setMatch(state, character, patternAt, classAt - 1)
  return code(state.pattern, patternAt) === character
}

function doMatch(state: MatchState, sourceAt: number, patternAt: number): number | undefined {
  state.tick()
  if (++state.depth > 200) throw new LuaPatternError('pattern too complex')
  try {
    let at = sourceAt
    let index = patternAt
    const { source, pattern } = state
    for (;;) {
      if (index >= pattern.length) return at
      const character = pattern[index]
      if (character === '(') {
        return pattern[index + 1] === ')'
          ? startCapture(state, at, index + 2, CAPTURE_POSITION)
          : startCapture(state, at, index + 1, CAPTURE_UNFINISHED)
      }
      if (character === ')') return endCapture(state, at, index + 1)
      if (character === '$' && index + 1 === pattern.length)
        return at === source.length ? at : undefined
      if (character === '%' && pattern[index + 1] === 'b') {
        const matched = matchBalance(state, at, index + 2)
        if (matched === undefined) return undefined
        at = matched
        index += 4
        continue
      }
      if (character === '%' && pattern[index + 1] === 'f') {
        index += 2
        if (pattern[index] !== '[') throw new LuaPatternError('missing "[" after "%f" in pattern')
        const end = classEnd(state, index)
        const previous = at === 0 ? 0 : code(source, at - 1)
        const current = at < source.length ? code(source, at) : 0
        if (
          !setMatch(state, previous, index, end - 1) &&
          setMatch(state, current, index, end - 1)
        ) {
          index = end
          continue
        }
        return undefined
      }
      if (
        character === '%' &&
        pattern[index + 1] !== undefined &&
        /\d/u.test(pattern[index + 1]!)
      ) {
        const matched = matchCapture(state, at, Number(pattern[index + 1]))
        if (matched === undefined) return undefined
        at = matched
        index += 2
        continue
      }
      const end = classEnd(state, index)
      const quantifier = pattern[end]
      if (quantifier === '?') {
        if (singleMatch(state, at, index, end)) {
          const result = doMatch(state, at + 1, end + 1)
          if (result !== undefined) return result
        }
        index = end + 1
        continue
      }
      if (quantifier === '+')
        return singleMatch(state, at, index, end) ? maxExpand(state, at + 1, index, end) : undefined
      if (quantifier === '*') return maxExpand(state, at, index, end)
      if (quantifier === '-') return minExpand(state, at, index, end)
      if (!singleMatch(state, at, index, end)) return undefined
      at++
      index = end
    }
  } finally {
    state.depth--
  }
}

function maxExpand(
  state: MatchState,
  at: number,
  patternAt: number,
  classAt: number,
): number | undefined {
  let count = 0
  while (singleMatch(state, at + count, patternAt, classAt)) count++
  for (; count >= 0; count--) {
    const result = doMatch(state, at + count, classAt + 1)
    if (result !== undefined) return result
  }
  return undefined
}

function minExpand(
  state: MatchState,
  at: number,
  patternAt: number,
  classAt: number,
): number | undefined {
  let current = at
  for (;;) {
    const result = doMatch(state, current, classAt + 1)
    if (result !== undefined) return result
    if (!singleMatch(state, current, patternAt, classAt)) return undefined
    current++
  }
}

function startCapture(
  state: MatchState,
  at: number,
  patternAt: number,
  length: number,
): number | undefined {
  if (state.level >= MAX_CAPTURES) throw new LuaPatternError('too many captures')
  state.captures[state.level] = { start: at, length }
  state.level++
  const result = doMatch(state, at, patternAt)
  if (result === undefined) state.level--
  return result
}

function endCapture(state: MatchState, at: number, patternAt: number): number | undefined {
  let open = -1
  for (let level = state.level - 1; level >= 0; level--)
    if (state.captures[level]!.length === CAPTURE_UNFINISHED) {
      open = level
      break
    }
  if (open < 0) throw new LuaPatternError('invalid pattern capture')
  const capture = state.captures[open]!
  capture.length = at - capture.start
  const result = doMatch(state, at, patternAt)
  if (result === undefined) capture.length = CAPTURE_UNFINISHED
  return result
}

function matchBalance(state: MatchState, at: number, patternAt: number): number | undefined {
  if (patternAt + 1 >= state.pattern.length) throw new LuaPatternError('missing arguments to "%b"')
  const { source } = state
  if (at >= source.length || source[at] !== state.pattern[patternAt]) return undefined
  const open = state.pattern[patternAt]
  const close = state.pattern[patternAt + 1]
  let depth = 1
  for (let index = at + 1; index < source.length; index++) {
    if (source[index] === close) {
      if (--depth === 0) return index + 1
    } else if (source[index] === open) depth++
  }
  return undefined
}

function matchCapture(state: MatchState, at: number, level: number): number | undefined {
  const capture = state.captures[level - 1]
  if (capture === undefined || capture.length < 0 || level > state.level)
    throw new LuaPatternError(`invalid capture index %${level}`)
  const text = state.source.slice(capture.start, capture.start + capture.length)
  return state.source.startsWith(text, at) ? at + text.length : undefined
}

/** A capture's value: its text, or its 1-based position for `()`. */
export type LuaCaptureValue = string | number

export interface LuaPatternMatch {
  readonly start: number
  readonly end: number
  /** The captures, or the whole match when the pattern has none. */
  readonly captures: readonly LuaCaptureValue[]
  /** Whether the pattern has captures of its own. */
  readonly explicit: boolean
}

/** A match of `pattern` (its anchor already taken off) starting exactly at `at` (0-based). */
export function luaPatternMatchAt(
  source: string,
  pattern: string,
  at: number,
  tick: () => void,
): LuaPatternMatch | undefined {
  const state: MatchState = { source, pattern, level: 0, captures: [], tick, depth: 0 }
  const end = doMatch(state, at, 0)
  return end === undefined
    ? undefined
    : { start: at, end, captures: capturesOf(state, at, end), explicit: state.level > 0 }
}

/** The first match of `pattern` in `source` at or after `init` (0-based), lstrlib's `str_find_aux`. */
export function luaPatternFind(
  source: string,
  pattern: string,
  init: number,
  tick: () => void,
): LuaPatternMatch | undefined {
  const anchored = pattern.startsWith('^')
  const body = anchored ? pattern.slice(1) : pattern
  let at = init
  do {
    const found = luaPatternMatchAt(source, body, at, tick)
    if (found !== undefined) return found
    at++
  } while (at <= source.length && !anchored)
  return undefined
}

function capturesOf(state: MatchState, start: number, end: number): LuaCaptureValue[] {
  if (state.level === 0) return [state.source.slice(start, end)]
  const values: LuaCaptureValue[] = []
  for (let level = 0; level < state.level; level++) {
    const capture = state.captures[level]!
    if (capture.length === CAPTURE_UNFINISHED) throw new LuaPatternError('unfinished capture')
    values.push(
      capture.length === CAPTURE_POSITION
        ? capture.start + 1
        : state.source.slice(capture.start, capture.start + capture.length),
    )
  }
  return values
}

/** Whether a pattern has no special characters, so `find` may search it as plain text. */
export function luaPatternIsPlain(pattern: string): boolean {
  return !/[\^$*+?.()[\]%-]/u.test(pattern)
}
