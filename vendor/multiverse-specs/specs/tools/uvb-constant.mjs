/** The one portable UVB 1.1 constant rule, shared by the verifier and binary encoder. */
export function classifyUvbConstant(value, type) {
  if (type === 'i64' || type === 'fixed64') {
    if (!((typeof value === 'number' && Number.isSafeInteger(value))
      || (typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value)))) {
      throw new Error(`const of type ${type} carries a non-integer value ${JSON.stringify(value)}`)
    }
    const exact = BigInt(value)
    if (typeof value === 'string' && Number.isSafeInteger(Number(exact)))
      throw new Error(`noncanonical i64 string: ${value}`)
    if (exact < -(1n << 63n) || exact > (1n << 63n) - 1n)
      throw new Error(`i64 out of range: ${exact}`)
    return { tag: 1, value: exact }
  }
  if (type === 'bool') {
    if (typeof value !== 'boolean') throw new Error(`const of type bool carries ${JSON.stringify(value)}`)
    return { tag: 2, value }
  }
  if (type === 'strref') {
    if (typeof value !== 'string') throw new Error(`const of type strref carries ${JSON.stringify(value)}`)
    return { tag: 3, value }
  }
  throw new Error(`const with unencodable declared type ${JSON.stringify(type)}`)
}
