/**
 * The tiny mutation vocabulary conformance vectors are written in.
 *
 * Vectors describe their negative and near-miss cases as data rather than prose, so a second
 * implementation can execute them instead of reading them. The vocabulary is deliberately four
 * operations wide: anything a vector cannot express with them belongs in a fixture of its own.
 *
 * Dependency-free by design: Node built-ins only.
 */

const NON_FINITE = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, '-Infinity': Number.NEGATIVE_INFINITY }

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (value instanceof Float32Array) return Float32Array.from(value)
  if (value instanceof Uint32Array) return Uint32Array.from(value)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]))
  }
  return value
}

function resolveParent(root, path) {
  const segments = path.split('.')
  const last = segments.pop()
  let cursor = root
  for (const segment of segments) {
    if (cursor === undefined || cursor === null) {
      throw new TypeError(`mutation path ${path} does not exist`)
    }
    cursor = Array.isArray(cursor) ? cursor[Number(segment)] : cursor[segment]
  }
  if (cursor === undefined || cursor === null) {
    throw new TypeError(`mutation path ${path} does not exist`)
  }
  return { parent: cursor, key: Array.isArray(cursor) ? Number(last) : last }
}

/** Apply an ordered list of vector mutations to a deep copy of `value`. */
export function applyMutations(value, mutations = []) {
  const root = clone(value)
  for (const mutation of mutations) {
    const { parent, key } = resolveParent(root, mutation.path)
    switch (mutation.op) {
      case 'set':
        parent[key] = clone(mutation.value)
        break
      case 'set-non-finite': {
        const replacement = NON_FINITE[mutation.value]
        if (replacement === undefined) {
          throw new TypeError(`set-non-finite expects NaN, Infinity or -Infinity, got ${mutation.value}`)
        }
        parent[key] = replacement
        break
      }
      case 'delete':
        if (Array.isArray(parent)) parent.splice(key, 1)
        else delete parent[key]
        break
      case 'reverse': {
        const target = parent[key]
        if (!Array.isArray(target)) throw new TypeError(`reverse expects an array at ${mutation.path}`)
        parent[key] = [...target].reverse()
        break
      }
      default:
        throw new TypeError(`unknown mutation op ${String(mutation.op)}`)
    }
  }
  return root
}
