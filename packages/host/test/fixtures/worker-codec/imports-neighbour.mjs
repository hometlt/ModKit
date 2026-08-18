// An entrypoint that needs a relative import: the worker backend evaluates verified bytes only,
// so this must be refused as not pinned instead of being re-read from disk.
import { helper } from './helper.mjs'
export const abiVersion = 1
export function createCodec() {
  return { probe: async () => helper() }
}
