function abort(signal) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

function braceDelta(line) {
  let delta = 0
  let quote
  let escaped = false
  for (const character of line) {
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '{') delta += 1
    else if (character === '}') delta -= 1
  }
  return delta
}

export function parseBos(bytes, budget, signal) {
  abort(signal)
  if (BigInt(bytes.byteLength) > budget.maxInputBytes)
    throw new RangeError('BOS exceeds maxInputBytes')
  if (bytes.byteLength > budget.maxScalarBytes) throw new RangeError('BOS exceeds maxScalarBytes')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const pieceNames = []
  for (const declaration of text.matchAll(/\bpiece\s+([^;]+);/giu)) {
    for (const value of declaration[1].split(',')) {
      const name = value.trim()
      if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) pieceNames.push(name)
    }
  }

  const functions = []
  let active
  let depth = 0
  let records = pieceNames.length
  for (const line of text.split(/\r?\n/u)) {
    abort(signal)
    const commentAt = line.indexOf('//')
    const code = commentAt === -1 ? line : line.slice(0, commentAt)
    if (active === undefined && depth === 0) {
      const start = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/u.exec(code)
      if (start !== null) {
        active = {
          name: start[1],
          channels: new Map(),
          frames: new Set(),
          motionStatements: 0,
          unsupportedStatements: 0,
          currentFrame: undefined,
        }
      }
    }
    if (active !== undefined) {
      const marker = /\/\/\s*Frame\s*:\s*(\d+)/iu.exec(line)
      if (marker !== null) {
        const frame = Number(marker[1])
        if (!Number.isSafeInteger(frame) || frame < 0 || frame > budget.maxNodes) {
          throw new RangeError('BOS frame marker is outside the bounded range')
        }
        active.currentFrame = frame
        active.frames.add(frame)
      }
      for (const motion of code.matchAll(
        /\b(turn|move)\s+([A-Za-z_][A-Za-z0-9_]*)\s+to\s+([xyz])-axis\b/giu,
      )) {
        records += 1
        if (records > budget.maxNodes) throw new RangeError('BOS records exceed maxNodes')
        active.motionStatements += 1
        if (active.currentFrame === undefined) {
          active.unsupportedStatements += 1
          continue
        }
        const kind = motion[1].toLowerCase() === 'turn' ? 'rotation' : 'translation'
        const target = motion[2]
        const axis = motion[3].toLowerCase()
        const key = `${target.toLowerCase()}\0${kind}\0${axis}`
        const prior = active.channels.get(key)
        active.channels.set(key, {
          target,
          kind,
          axis,
          firstFrame: Math.min(prior?.firstFrame ?? active.currentFrame, active.currentFrame),
          lastFrame: Math.max(prior?.lastFrame ?? active.currentFrame, active.currentFrame),
        })
      }
    }
    depth += braceDelta(code)
    if (depth < 0) throw new TypeError('BOS braces are unbalanced')
    if (active !== undefined && depth === 0) {
      functions.push(
        Object.freeze({
          name: active.name,
          frames: Object.freeze([...active.frames].sort((left, right) => left - right)),
          channels: Object.freeze([...active.channels.values()]),
          motionStatements: active.motionStatements,
          unsupportedStatements: active.unsupportedStatements,
        }),
      )
      active = undefined
    }
  }
  if (depth !== 0 || active !== undefined) throw new TypeError('BOS braces are unbalanced')
  return Object.freeze({
    pieceNames: Object.freeze([...new Set(pieceNames)]),
    functions: Object.freeze(functions),
    motionStatements: functions.reduce((sum, item) => sum + item.motionStatements, 0),
  })
}
