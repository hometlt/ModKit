/**
 * The one channel between the extension host and the webview, and the two kinds of traffic on it.
 *
 * VS Code gives a webview exactly one duplex message channel — `webview.postMessage` /
 * `onDidReceiveMessage` on the extension side, `acquireVsCodeApi().postMessage` /
 * `window.onmessage` on the page side — and it carries JSON, not structured clone. Two things have
 * to share it:
 *
 *  - **capability-RPC frames** (`x3.app/subject-services@1`: open a subject, attach its session,
 *    lease its editing arm). `framePortFromJsonPort` is the host's own adapter for a text channel,
 *    so frames travel as JSON *strings* and every wire rule — validation, handles, leases — is the
 *    production one. `exposeSubjectRpc`/`connectSubjectRpc` do not take a `FramePort`; they wrap a
 *    `MessagePortLike` with `framePortFromMessagePort` themselves. So the adapter is re-shaped into
 *    that: `postMessage` → `frames.post`, `on('message', …)` → `frames.onFrame`, and the call sites
 *    pass `listener: 'emitter-value'` because this port is an emitter, not an `EventTarget`.
 *  - **shell traffic** (workspace roots, directory listings, file bytes, a close prompt) as plain
 *    objects encoded with the same module's `encodeJsonValue`/`decodeJsonValue`, so a `Uint8Array`
 *    crosses as `{"$x3":"bytes","base64":…}` under the codec the frames already use rather than a
 *    second, hand-rolled one.
 *
 * The two are told apart by JavaScript type: a frame is a string, a shell message is an object.
 * Nothing here interprets a frame, and nothing here grants anything — it is a pipe with a codec.
 */

import {
  decodeJsonValue,
  encodeJsonValue,
  framePortFromJsonPort,
  type Frame,
  type JsonPortLike,
  type MessagePortLike,
} from '@modkitx-x3/host/execution'

// ---------------------------------------------------------------------------------------------
// shell messages

/** One browsable root the extension host granted (a workspace folder, or a single opened file). */
export interface ShellRoot {
  /** Absolute path; also the entry id the explorer and the opener use. */
  readonly id: string
  readonly label: string
}

/** One directory entry, in the shape `@modkitx-x3/ui`'s explorer consumes. */
export interface ShellEntry {
  readonly id: string
  readonly name: string
  readonly directory: boolean
  readonly size?: number
}

/** What a close prompt can answer. `save` is only offered when the tab has a save path. */
export type CloseAnswer = 'save' | 'discard' | 'cancel'

/** Webview → extension host. Every one of these is answered exactly once. */
export type ShellRequest =
  | { readonly op: 'list'; readonly path?: string }
  | { readonly op: 'read'; readonly path: string; readonly maxBytes: number }
  /** A webview iframe cannot show a modal of its own, so the prompt happens in the editor. */
  | { readonly op: 'confirm'; readonly message: string; readonly savable: boolean }

/** Fire-and-forget, in both directions. */
export type ShellEvent =
  | { readonly op: 'roots'; readonly roots: readonly ShellRoot[] }
  | { readonly op: 'open'; readonly path: string; readonly name: string }
  | { readonly op: 'notice'; readonly text: string; readonly severity: 'info' | 'error' }
  /** The webview's status line, mirrored into the extension's output channel. */
  | { readonly op: 'status'; readonly text: string }

interface RequestEnvelope {
  readonly modkit: 1
  readonly kind: 'request'
  readonly requestId: string
  readonly request: ShellRequest
}

interface ResponseEnvelope {
  readonly modkit: 1
  readonly kind: 'response'
  readonly requestId: string
  readonly ok: boolean
  readonly value?: unknown
  readonly message?: string
}

interface EventEnvelope {
  readonly modkit: 1
  readonly kind: 'event'
  readonly event: ShellEvent
}

type Envelope = RequestEnvelope | ResponseEnvelope | EventEnvelope

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function asEnvelope(value: unknown): Envelope | undefined {
  if (!isRecord(value) || value['modkit'] !== 1) return undefined
  const kind = value['kind']
  if (kind === 'request' && typeof value['requestId'] === 'string' && isRecord(value['request'])) {
    return value as unknown as RequestEnvelope
  }
  if (kind === 'response' && typeof value['requestId'] === 'string') {
    return value as unknown as ResponseEnvelope
  }
  if (kind === 'event' && isRecord(value['event'])) return value as unknown as EventEnvelope
  return undefined
}

// ---------------------------------------------------------------------------------------------
// the channel

/** The duplex VS Code offers, from either side. Implemented by the adapters, never by this file. */
export interface WebviewChannel {
  post(message: unknown): void
  /** Subscribe to incoming messages; returns the unsubscribe. */
  onMessage(handler: (message: unknown) => void): () => void
}

export interface Bridge {
  /**
   * The port `exposeSubjectRpc`/`connectSubjectRpc` take. Pass `listener: 'emitter-value'`
   * beside it: this object has `on`, not `addEventListener`, and the default style for an
   * emitter-shaped port is the one that hands the payload through unchanged.
   */
  readonly port: MessagePortLike
  /** Send a request and await its single answer. Rejects with the far side's message. */
  request(request: ShellRequest): Promise<unknown>
  /** Serve requests from the far side. One handler; a second call replaces it. */
  serve(handler: (request: ShellRequest) => Promise<unknown>): void
  emit(event: ShellEvent): void
  onEvent(handler: (event: ShellEvent) => void): () => void
  dispose(): void
}

export interface BridgeOptions {
  readonly channel: WebviewChannel
  /** Ids are only unique per bridge; a prefix keeps the two directions readable in a trace. */
  readonly idPrefix?: string
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

export function createBridge(options: BridgeOptions): Bridge {
  const { channel } = options
  const prefix = options.idPrefix ?? 'shell'

  /** Frame sinks: `framePortFromJsonPort` subscribes here, the channel fan-out feeds them. */
  const frameSinks = new Set<(text: string) => void>()
  const eventSinks = new Set<(event: ShellEvent) => void>()
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let serving: ((request: ShellRequest) => Promise<unknown>) | undefined
  let sequence = 0
  let disposed = false

  const send = (envelope: Envelope): void => {
    channel.post(encodeJsonValue(envelope))
  }

  const handleEnvelope = (envelope: Envelope): void => {
    if (envelope.kind === 'event') {
      for (const sink of [...eventSinks]) sink(envelope.event)
      return
    }
    if (envelope.kind === 'response') {
      const waiter = pending.get(envelope.requestId)
      if (waiter === undefined) return
      pending.delete(envelope.requestId)
      if (envelope.ok) waiter.resolve(envelope.value)
      else waiter.reject(new Error(envelope.message ?? 'the other side refused without a reason'))
      return
    }
    const handler = serving
    if (handler === undefined) {
      send({
        modkit: 1,
        kind: 'response',
        requestId: envelope.requestId,
        ok: false,
        message: 'this side serves no shell requests',
      })
      return
    }
    void handler(envelope.request).then(
      value => {
        send({ modkit: 1, kind: 'response', requestId: envelope.requestId, ok: true, value })
      },
      (error: unknown) => {
        send({
          modkit: 1,
          kind: 'response',
          requestId: envelope.requestId,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }

  const unsubscribe = channel.onMessage(message => {
    if (typeof message === 'string') {
      for (const sink of [...frameSinks]) sink(message)
      return
    }
    const envelope = asEnvelope(decodeJsonValue(message))
    if (envelope === undefined) {
      options.onDiagnostic?.({
        code: 'x3.app/vscode-bridge-unknown-message',
        message: 'a message on the webview channel was neither an RPC frame nor a shell envelope',
      })
      return
    }
    handleEnvelope(envelope)
  })

  const jsonPort: JsonPortLike = {
    send: text => {
      channel.post(text)
    },
    onMessage: handler => {
      frameSinks.add(handler)
      return () => frameSinks.delete(handler)
    },
  }
  const frames = framePortFromJsonPort(jsonPort)

  /** Emitter-shaped, because that is the one style whose payload is the frame itself. */
  const listeners = new Map<(payload: unknown) => void, () => void>()
  const port: MessagePortLike = {
    postMessage(message: unknown): void {
      frames.post(message as Frame, [])
    },
    on(_event: 'message', listener: (payload: unknown) => void): unknown {
      listeners.set(listener, frames.onFrame(listener))
      return port
    },
    off(_event: 'message', listener: (payload: unknown) => void): unknown {
      listeners.get(listener)?.()
      listeners.delete(listener)
      return port
    },
  }

  return {
    port,

    async request(request: ShellRequest): Promise<unknown> {
      if (disposed) throw new Error('the webview bridge is closed')
      sequence += 1
      const requestId = `${prefix}-${sequence}`
      return new Promise<unknown>((resolve, reject) => {
        pending.set(requestId, { resolve, reject })
        send({ modkit: 1, kind: 'request', requestId, request })
      })
    },

    serve(handler) {
      serving = handler
    },

    emit(event) {
      send({ modkit: 1, kind: 'event', event })
    },

    onEvent(handler) {
      eventSinks.add(handler)
      return () => eventSinks.delete(handler)
    },

    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      frameSinks.clear()
      eventSinks.clear()
      for (const waiter of pending.values()) waiter.reject(new Error('the webview bridge closed'))
      pending.clear()
    },
  }
}
