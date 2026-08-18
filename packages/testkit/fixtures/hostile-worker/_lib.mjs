// Shared raw-protocol helpers for the hostile worker fixtures. Deliberately dependency-free: the
// hostile side speaks `x3.host/rpc` frames by hand, so nothing here can be "fixed" by the endpoint
// it is attacking. The harness (`superviseFixtureWorker`) passes `workerData =
// { session, generation, port, options }` and transfers `port` (a MessagePort).
import { parentPort, workerData } from 'node:worker_threads'

const data = workerData ?? {}
export const port = data.port ?? parentPort
export const session = typeof data.session === 'string' ? data.session : 'unknown-session'
export const generation = typeof data.generation === 'number' ? data.generation : 1
export const options = data.options ?? {}

export const MODULE = { contract: 'x3.testkit/module', major: 1 }
export const CODEC = { contract: 'x3.testkit/codec', major: 1 }
export const SESSION = { contract: 'x3.testkit/session', major: 1 }
export const TEXT = { contract: 'x3.testkit/text', major: 1 }

let outbound = 0

/** A fresh, monotonic envelope; `overrides` lets a fixture forge session/generation/id. */
export function envelope(overrides = {}) {
  outbound += 1
  return { domain: 'x3.host/rpc', version: 1, session, generation, id: outbound, ...overrides }
}

/** Posts one frame and returns the id it went out with. */
export function post(body, overrides = {}, transfer = []) {
  const frame = { ...envelope(overrides), ...body }
  port.postMessage(frame, transfer)
  return frame.id
}

/** Posts an arbitrary object as-is (no envelope) — for garbage. */
export function postRaw(value) {
  port.postMessage(value)
}

export function handleId(index) {
  return `w${generation}-${index}`
}

export function handleRef(index, kind = 'lease', surface = undefined) {
  const id = handleId(index)
  return surface === undefined
    ? { '@x3.handle': { id, kind } }
    : { '@x3.handle': { id, kind, contract: surface.contract, major: surface.major } }
}

export function listen(handler) {
  port.on('message', handler)
  port.start?.()
}

export function exit(code = 0) {
  process.exit(code)
}

export function throwFrame(inReplyTo, code, message, extra = {}) {
  post({ t: 'throw', inReplyTo, error: { code, message, retryability: 'never', ...extra } })
}

/**
 * Serves the demo chain a host walks (`load` → root, `createCodec` → codec, `open` → session,
 * `descriptor`/`echo`/`dispose`, `release`) so a fixture only has to script its misbehaviour in
 * the hooks. Every hook may return `'handled'` to suppress the default reply.
 */
export function serveDemoChain(hooks = {}) {
  const ROOT = 1
  const CODEC_HANDLE = 2
  const SESSION_HANDLE = 3
  const state = { loaded: false }
  listen(frame => {
    if (typeof frame !== 'object' || frame === null) return
    hooks.onFrame?.(frame)
    switch (frame.t) {
      case 'load': {
        state.loaded = true
        if (hooks.onLoad?.(frame) === 'handled') return
        post({
          t: 'ready',
          inReplyTo: frame.id,
          abiVersion: 1,
          exports: ['abiVersion', 'createCodec'],
          root: handleRef(ROOT, 'lease', MODULE),
        })
        hooks.afterReady?.(frame)
        return
      }
      case 'call': {
        if (hooks.onCall?.(frame) === 'handled') return
        if (frame.handle === handleId(ROOT) && frame.method === 'createCodec') {
          post({ t: 'return', inReplyTo: frame.id, value: handleRef(CODEC_HANDLE, 'lease', CODEC) })
          return
        }
        if (frame.handle === handleId(CODEC_HANDLE) && frame.method === 'open') {
          post({
            t: 'return',
            inReplyTo: frame.id,
            value: handleRef(SESSION_HANDLE, 'lease', SESSION),
          })
          hooks.afterOpen?.(frame)
          return
        }
        if (frame.method === 'descriptor') {
          post({
            t: 'return',
            inReplyTo: frame.id,
            value: { id: 'demo', traits: ['content.text'] },
          })
          return
        }
        if (frame.method === 'echo') {
          post({ t: 'return', inReplyTo: frame.id, value: frame.args[0] })
          return
        }
        if (frame.method === 'dispose') {
          post({ t: 'return', inReplyTo: frame.id })
          return
        }
        throwFrame(frame.id, 'x3.testkit/not-implemented', `fixture has no ${frame.method}`)
        return
      }
      case 'release':
        if (hooks.onRelease?.(frame) === 'handled') return
        post({ t: 'return', inReplyTo: frame.id, value: { released: true } })
        return
      case 'cancel':
        hooks.onCancel?.(frame)
        return
      case 'subscribe':
        hooks.onSubscribe?.(frame)
        return
      case 'next':
        hooks.onNext?.(frame)
        return
      case 'terminate':
        if (hooks.onTerminate?.(frame) === 'handled') return
        exit(0)
        return
      default:
        return
    }
  })
  return { ROOT, CODEC_HANDLE, SESSION_HANDLE, state }
}
