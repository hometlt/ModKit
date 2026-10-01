/** Semantic checks for imported replay observations, after JSON Schema admission. */
import { jcsStringify } from './uv-canonical-form.mjs'
import { compareCanonicalKeys, sha256Hex } from './uv-canonical.mjs'

const INTEGER = /^(0|[1-9][0-9]*)$/u
const DIGEST = /^sha256:[0-9a-f]{64}$/u
const MAX_TICK = (1n << 64n) - 1n

export function observationDigest(observations) {
  return `sha256:${sha256Hex(new TextEncoder().encode(jcsStringify(observations)))}`
}

/** A source event ID and native (tick, sequence) form one stable total order. */
export function verifyImportedObservations(document) {
  const refuse = (rule, message) => ({ refusal: { rule, message } })
  if (document?.kind !== 'uv.observations' || document.schemaVersion !== 1
    || !document.source || !DIGEST.test(document.source.artifactDigest)
    || !document.clock || !Array.isArray(document.observations)
    || !DIGEST.test(document.observationsDigest))
    return refuse('observation-shape', 'Expected a versioned imported-observations bundle.')
  const seen = new Set()
  const removed = new Set()
  let previousTick = -1n, previousSequence = -1
  for (const [index, observation] of document.observations.entries()) {
    if (!INTEGER.test(observation?.tick) || BigInt(observation.tick) > MAX_TICK
      || !Number.isSafeInteger(observation.sequence) || observation.sequence < 0)
      return refuse('observation-time', `Observation ${index} has an invalid native time.`)
    const tick = BigInt(observation.tick)
    if (tick < previousTick || (tick === previousTick && observation.sequence <= previousSequence))
      return refuse('observation-order', `Observation ${index} is not strictly ordered.`)
    previousTick = tick; previousSequence = observation.sequence
    if (typeof observation.sourceEventId !== 'string' || !observation.sourceEventId
      || seen.has(observation.sourceEventId))
      return refuse('observation-identity', `Observation ${index} has a repeated or missing source event ID.`)
    seen.add(observation.sourceEventId)
    if (observation.subject?.kind === 'entity'
      && (!INTEGER.test(observation.subject.generation)
        || BigInt(observation.subject.generation) > MAX_TICK))
      return refuse('observation-generation', `Entity observation ${index} needs a stable generation.`)
    const subjectKey = JSON.stringify([observation.subject?.kind, observation.subject?.id,
      observation.subject?.generation ?? ''])
    if (removed.has(subjectKey))
      return refuse('observation-lifecycle', `Observation ${index} reuses a removed subject generation.`)
    if (observation.action === 'remove') {
      if (observation.subject?.kind !== 'entity' || observation.fields !== undefined)
        return refuse('observation-removal', `Observation ${index} is not an explicit entity removal.`)
      removed.add(subjectKey)
    } else if (observation.action === 'fields') {
      if (!Array.isArray(observation.fields) || observation.fields.length === 0
        || observation.fields.some(field => typeof field?.path !== 'string'
          || !field.path || !Object.hasOwn(field, 'value')))
        return refuse('observation-fields', `Observation ${index} has no observed fields.`)
      const paths = observation.fields.map(field => field.path)
      if (new Set(paths).size !== paths.length)
        return refuse('observation-fields', `Observation ${index} repeats a field path.`)
    } else return refuse('observation-action', `Observation ${index} has an unknown action.`)
  }
  try {
    if (observationDigest(document.observations) !== document.observationsDigest)
      return refuse('observation-digest', 'Observation bytes differ from their canonical digest.')
  } catch {
    return refuse('observation-shape', 'Observations cannot be canonicalized.')
  }
  return { observationsDigest: document.observationsDigest, count: document.observations.length }
}

/** Read-only reference projection. It does not infer deaths or feed interpolated frames to State. */
export function observedStateAt(document, tick, sequence = Number.MAX_SAFE_INTEGER) {
  const verified = verifyImportedObservations(document)
  if (verified.refusal) return verified
  if (!INTEGER.test(tick) || BigInt(tick) > MAX_TICK
    || !Number.isSafeInteger(sequence) || sequence < 0)
    return { refusal: { rule: 'observation-time', message: 'Sample time is not a native tick/sequence.' } }
  const targetTick = BigInt(tick)
  const active = new Map(), removed = []
  for (const event of document.observations) {
    const eventTick = BigInt(event.tick)
    if (eventTick > targetTick || eventTick === targetTick && event.sequence > sequence) break
    const subject = event.subject
    const key = JSON.stringify([subject.kind, subject.id, subject.generation ?? ''])
    if (event.action === 'remove') {
      active.delete(key)
      removed.push({ subject: structuredClone(subject), sourceEventId: event.sourceEventId,
        tick: event.tick, sequence: event.sequence })
      continue
    }
    if (!active.has(key)) active.set(key, { subject: structuredClone(subject), fields: new Map() })
    const fields = active.get(key).fields
    for (const field of event.fields) fields.set(field.path, { path: field.path,
      value: structuredClone(field.value), sourceEventId: event.sourceEventId,
      tick: event.tick, sequence: event.sequence })
  }
  return { observationsDigest: verified.observationsDigest, tick, sequence,
    subjects: [...active.values()].map(entry => ({ subject: entry.subject,
      fields: [...entry.fields.values()].sort((a, b) => compareCanonicalKeys(a.path, b.path)) }))
      .sort((a, b) => compareCanonicalKeys(JSON.stringify(a.subject), JSON.stringify(b.subject))),
    removed }
}
