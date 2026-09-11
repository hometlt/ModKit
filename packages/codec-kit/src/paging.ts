export function pageStart(cursor?: string) {
  if (cursor === undefined) return 0
  if (!/^(?:0|[1-9][0-9]*)$/u.test(cursor)) throw new TypeError('invalid page cursor')
  const value = Number(cursor)
  if (!Number.isSafeInteger(value)) throw new TypeError('page cursor exceeds safe integer range')
  return value
}
