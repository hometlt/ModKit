const HEADER_BYTES = 44

function abort(signal) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

function checkedRange(bytes, offset, length, label) {
  const end = offset + length
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    !Number.isSafeInteger(end) ||
    end > bytes.byteLength
  ) {
    throw new RangeError(`COB ${label} is outside the file`)
  }
}

export function parseCob(bytes, budget, signal) {
  abort(signal)
  if (BigInt(bytes.byteLength) > budget.maxInputBytes)
    throw new RangeError('COB exceeds maxInputBytes')
  checkedRange(bytes, 0, HEADER_BYTES, 'header')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getInt32(0, true)
  const scriptCount = view.getInt32(4, true)
  const pieceCount = view.getInt32(8, true)
  const totalScriptWords = view.getInt32(12, true)
  const staticVariables = view.getInt32(16, true)
  const scriptCodeIndexOffset = view.getInt32(24, true)
  const scriptNameOffset = view.getInt32(28, true)
  const pieceNameOffset = view.getInt32(32, true)
  const scriptCodeOffset = view.getInt32(36, true)
  const soundNameOffset = view.getInt32(40, true)
  // The pinned BAR corpus and the Recoil v4 layout prove this header. Version 6 is not inferred
  // from adjacent fields: accepting it without an exercised layout would turn parsing into guesswork.
  if (version !== 4) throw new RangeError(`COB version ${version} is unsupported`)
  for (const [label, value] of [
    ['script count', scriptCount],
    ['piece count', pieceCount],
    ['script word count', totalScriptWords],
    ['static variable count', staticVariables],
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`COB ${label} is invalid`)
  }
  if (scriptCount + pieceCount + totalScriptWords > budget.maxNodes) {
    throw new RangeError('COB records exceed maxNodes')
  }
  checkedRange(bytes, scriptCodeIndexOffset, scriptCount * 4, 'script code index table')
  checkedRange(bytes, scriptNameOffset, scriptCount * 4, 'script name table')
  checkedRange(bytes, pieceNameOffset, pieceCount * 4, 'piece name table')
  checkedRange(bytes, scriptCodeOffset, totalScriptWords * 4, 'script code')
  if (soundNameOffset !== 0) checkedRange(bytes, soundNameOffset, 0, 'sound-name region')

  const stringAt = (offset, label) => {
    if (!Number.isSafeInteger(offset) || offset < HEADER_BYTES || offset >= bytes.byteLength) {
      throw new RangeError(`COB ${label} offset is outside the file`)
    }
    const maximum = Math.min(bytes.byteLength, offset + budget.maxScalarBytes)
    let end = offset
    while (end < maximum && bytes[end] !== 0) end += 1
    if (end === maximum)
      throw new RangeError(`COB ${label} exceeds maxScalarBytes or is unterminated`)
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, end))
    if (value.length === 0) throw new TypeError(`COB ${label} is empty`)
    return value
  }
  const namesAt = (offset, count, label) => {
    const names = []
    for (let index = 0; index < count; index += 1) {
      abort(signal)
      names.push(stringAt(view.getInt32(offset + index * 4, true), `${label} ${index}`))
    }
    return Object.freeze(names)
  }
  return Object.freeze({
    version,
    scriptCount,
    pieceCount,
    totalScriptWords,
    staticVariables,
    soundNameOffset,
    scriptNames: namesAt(scriptNameOffset, scriptCount, 'script name'),
    pieceNames: namesAt(pieceNameOffset, pieceCount, 'piece name'),
  })
}
