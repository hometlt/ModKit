/** Implemented value types. Canonical representation belongs to uv-value.mjs. */
const foundationValueTypes = ['bool', 'i64', 'fixed64', 'strref',
  'ref<entity>', 'ref<entity>?', 'ref<def>', 'ref<player>', 'ref<job>', 'ref<timer>', 'list<ref<entity>>'] as const
export type FoundationValueType = typeof foundationValueTypes[number]
export function isFoundationValueType(value: unknown): value is FoundationValueType {
  return typeof value === 'string' && (foundationValueTypes as readonly string[]).includes(value)
}
export { foundationValueTypes }
