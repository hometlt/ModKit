import type { JsonObject } from '@modkit/sdk'
import { array, field, object } from './values.js'

export const UVM_GAME_MODEL_STATES = 'UV_game_model_states'

export interface UvmModelState {
  readonly state: string
  readonly model: string
}

/** Reads portable named model variants. Resolution remains the host's responsibility. */
export function readUvmModelStates(
  document: JsonObject,
  maxBytes: number,
  signal?: AbortSignal,
): readonly UvmModelState[] {
  signal?.throwIfAborted()
  const raw = field(document['extensions'], UVM_GAME_MODEL_STATES)
  if (raw === undefined) return []
  const extension = object(raw, 'model states')
  if (
    extension['schemaVersion'] !== 1 ||
    Object.keys(extension).some(key => !['schemaVersion', 'states'].includes(key)) ||
    !array(document, 'extensionsUsed').includes(UVM_GAME_MODEL_STATES)
  )
    throw new TypeError('unsupported UVM model states')
  const states: UvmModelState[] = []
  const seen = new Set<string>()
  let bytes = 0
  for (const candidate of array(extension, 'states')) {
    signal?.throwIfAborted()
    const value = object(candidate, 'model state'),
      state = value['state'],
      model = value['model']
    if (
      Object.keys(value).some(key => !['state', 'model'].includes(key)) ||
      typeof state !== 'string' ||
      state.length === 0 ||
      state !== state.trim() ||
      state === 'base' ||
      typeof model !== 'string' ||
      model.length === 0 ||
      model !== model.trim() ||
      seen.has(state)
    )
      throw new TypeError('invalid or duplicate UVM model state')
    bytes += 128 + (state.length + model.length) * 2
    if (bytes > maxBytes) throw new RangeError('UVM model states exceed byte budget')
    seen.add(state)
    states.push({ state, model })
  }
  return states
}
