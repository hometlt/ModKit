/** Deep-freezes an owned data graph. Intended for public vocabulary and schema authorities. */
export function deepFreeze<Value>(value: Value): Value {
  const seen = new WeakSet<object>()
  const visit = (candidate: unknown): void => {
    if (typeof candidate !== 'object' || candidate === null || seen.has(candidate)) return
    seen.add(candidate)
    for (const key of Reflect.ownKeys(candidate)) {
      visit((candidate as Record<PropertyKey, unknown>)[key])
    }
    Object.freeze(candidate)
  }
  visit(value)
  return value
}
