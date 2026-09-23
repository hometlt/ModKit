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

import type { ArchiveAction, ArchiveTarget } from '@modkit/ui/archive'
import {
  decodeJsonValue,
  encodeJsonValue,
  framePortFromJsonPort,
  type FramePort,
  type JsonPortLike,
} from '@modkit/host/execution'

// ---------------------------------------------------------------------------------------------
// shell messages

/** One browsable root the extension host granted (a workspace folder, or a single opened file). */
export interface ShellRoot {
  /** Absolute path; also the entry id the explorer and the opener use. */
  readonly id: string
  readonly label: string
}

/** One directory entry, in the shape `@modkit/ui`'s explorer consumes. */
export interface ShellEntry {
  readonly id: string
  readonly name: string
  readonly directory: boolean
  readonly size?: number
}

/** What a close prompt can answer. `save` is only offered when the tab has a save path. */
export type CloseAnswer = 'save' | 'discard' | 'cancel'

/**
 * What the webview's settings section shows.
 *
 * All of it is inert description: coordinates, reasons and switch positions. The page never
 * receives the raw setting value, only these views — the entries carry the index the writers below
 * name, so the *extension side* stays the one that decides what a hand-written setting looks like.
 */
export interface ShellSettingsView {
  readonly bundled: readonly string[]
  readonly installed: readonly string[]
  readonly failures: readonly {
    readonly root: string
    readonly code: string
    readonly message: string
  }[]
  /** Settings entries that were not usable as a root at all (malformed, no path). */
  readonly problems: readonly string[]
  readonly configuredExtensions: readonly ShellConfiguredExtension[]
  readonly contributions: readonly ShellContribution[]
  readonly disabledExtensions: readonly string[]
  readonly disabledContributions: readonly string[]
  /** Which configuration target a write lands in (`workspace` when one is open, else `user`). */
  readonly scope: 'workspace' | 'user'
  /** False when this window has no way to write configuration; the page then draws no switches. */
  readonly writable: boolean
}

export interface ShellConfiguredExtension {
  readonly index: number
  readonly path: string
  readonly id?: string
  readonly enabled: boolean
  /** What the loader made of it, when the composition can say. */
  readonly state: 'loaded' | 'disabled' | 'failed' | 'absent'
  readonly code?: string
  readonly message?: string
}

export interface ShellContribution {
  readonly id?: string
  readonly displayName: string
  readonly contract?: string
  readonly extension: string
  readonly origin: string
  readonly activationEligible: boolean
  readonly disabled: boolean
  readonly path: string
}

/** The answer to any request that changes configuration. */
export interface ShellConfigureResult {
  readonly changed: boolean
  /** One sentence for the page's status line, written by the side that did the work. */
  readonly message: string
  /** The state after the write, so the page never has to guess what it now looks like. */
  readonly view: ShellSettingsView
}

/** Webview → extension host. Every one of these is answered exactly once. */
/** One menu entry a viewer publishes with a status item; a choice may carry a second step. */
export interface ShellStatusChoice {
  readonly id: string
  readonly label: string
  readonly choices?: readonly ShellStatusChoice[]
}

export type ShellRequest =
  | { readonly op: 'list'; readonly path?: string }
  | { readonly op: 'read'; readonly path: string; readonly maxBytes: number }
  /** Native CustomEditorProvider lifecycle, extension host → its one resolved webview. */
  | { readonly op: 'document-save'; readonly path: string }
  /** The editor's own Undo and Redo, routed to whichever view owns the pending edit. */
  | { readonly op: 'document-undo'; readonly path: string }
  | { readonly op: 'document-redo'; readonly path: string }
  | { readonly op: 'document-revert'; readonly path: string }
  /** A webview iframe cannot show a modal of its own, so the prompt happens in the editor. */
  | { readonly op: 'confirm'; readonly message: string; readonly savable: boolean }
  /** Show another file in this editor (a gallery pick). */
  /** A file, or with `entry` one member of the container file at `path`. */
  | { readonly op: 'open-in-editor'; readonly path: string; readonly entry?: string }
  /** A file-manager action inside the archive `subject` shows (a file, or a member archive). */
  | {
      readonly op: 'archive-action'
      readonly subject: string
      readonly action: ArchiveAction
      readonly path: string
      readonly kind: ArchiveTarget['kind']
    }
  /** The mounted viewer's status items, drawn as native status bar entries. */
  | {
      readonly op: 'status-set'
      readonly items: readonly {
        readonly id: string
        readonly text: string
        readonly tooltip?: string
        readonly align?: 'start' | 'end'
        readonly choices?: readonly ShellStatusChoice[]
        /** Codicon name; the native status bar spells it `$(name)`. */
        readonly icon?: string
        /** One click, no menu: reported back as an empty choice id. */
        readonly action?: boolean
        readonly selected?: string
      }[]
    }
  /*
   * Settings traffic. The webview holds no host and no configuration API, so it asks — which is
   * the honest path: `vscode.workspace.getConfiguration().update` exists only on the extension
   * side, and a page that could reach it would have become an extension host.
   */
  | {
      readonly op: 'workspace-documents'
      readonly path?: string
      readonly languageIds?: readonly string[]
      readonly maxDocuments?: number
    }
  /**
   * Operations extensions published for a viewer surface, and one run of one of them.
   *
   * This is the extension-into-viewer route: the extension's code runs where it always did (the
   * extension host), the page only renders the declared controls and carries the pixels across.
   */
  | { readonly op: 'viewer-operations'; readonly surface: string }
  | {
      readonly op: 'viewer-operation-run'
      readonly operationId: string
      readonly input: unknown
      readonly image: { readonly width: number; readonly height: number; readonly rgba: string }
    }
  | { readonly op: 'settings' }
  | { readonly op: 'set-contribution'; readonly id: string; readonly enabled: boolean }
  | { readonly op: 'set-contributions'; readonly ids: readonly string[]; readonly enabled: boolean }
  | { readonly op: 'set-extension-coordinate'; readonly id: string; readonly enabled: boolean }
  | { readonly op: 'set-managed-package'; readonly id: string; readonly enabled: boolean }
  | { readonly op: 'remove-managed-package'; readonly id: string }
  | { readonly op: 'link-extension'; readonly id: string }
  | {
      readonly op: 'manage-repository-subject'
      readonly kind: 'vendor' | 'game'
      readonly id: string
      readonly action: 'install' | 'remove'
    }
  /**
   * Opens a resource registered for an extension card by the extension host.
   *
   * The page supplies only opaque identifiers. In particular, it cannot turn a visible source
   * path into filesystem authority: the host resolves this triple against its own card registry.
   */
  | {
      readonly op: 'open-extension-resource'
      readonly subjectId: string
      readonly resourceId: string
      readonly role: 'source' | 'license'
    }
  /**
   * Write viewer-produced files (today: PNG subresource exports) into this window's export folder.
   *
   * The page supplies bytes and a leaf name only. It cannot name a destination: the extension host
   * resolves the folder from the workspace, so a page cannot turn "export" into "write anywhere".
   */
  | {
      readonly op: 'export-files'
      readonly files: readonly {
        readonly name: string
        readonly mediaType: string
        readonly bytes: Uint8Array
      }[]
      /** The subject the files were made from; a conversion is written beside it and opened. */
      readonly beside?: string
    }
  | { readonly op: 'set-extension'; readonly index: number; readonly enabled: boolean }
  | { readonly op: 'remove-extension'; readonly index: number }
  | { readonly op: 'add-extension-folder' }
  /**
   * A small picture for the explorer's gallery: the member `entry` of the container at `path`, or
   * the Modkit Explorer entry `explorerId`. `undefined` when the host cannot decode one.
   */
  | {
      readonly op: 'thumbnail'
      readonly path?: string
      readonly entry?: string
      readonly explorerId?: string
      readonly maxEdge: number
    }
  /** The immediate children of `path` (`''` is the root) in the folder a Modkit Explorer shows. */
  | { readonly op: 'explorer-children'; readonly path: string }
  /** Open one Modkit Explorer entry in an editor tab of its own. */
  | { readonly op: 'explorer-open'; readonly id: string }

/** A picture the gallery draws: RGBA, at most the requested edge on its long side. */
export interface ShellThumbnail {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

/** One entry of a Modkit Explorer folder: `id` is opaque to the page, `path` is from the root. */
export interface ShellExplorerEntry {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly kind: 'file' | 'directory'
  readonly size?: number
  readonly modifiedAt?: number
}

/** Fire-and-forget, in both directions. */
export type ShellEvent =
  | { readonly op: 'roots'; readonly roots: readonly ShellRoot[] }
  | { readonly op: 'open'; readonly path: string; readonly name: string }
  /** Open an opaque subject reference through the navigation port of the mounted parent session. */
  | { readonly op: 'navigate-subject'; readonly subjectId: string }
  | { readonly op: 'notice'; readonly text: string; readonly severity: 'info' | 'error' }
  /** The webview's status line, mirrored into the extension's output channel. */
  | { readonly op: 'status'; readonly text: string }
  /** A status bar choice the user picked for the mounted viewer. */
  | { readonly op: 'status-choose'; readonly itemId: string; readonly choiceId: string }
  /**
   * What the page's realm can actually honour, probed by the page itself (§1.5).
   *
   * Sent once, on load. The extension composed the realm with an intended facility set; only the
   * page can say whether the machine it is running on agrees — `--disable-gpu`, a remote session or
   * a driver without WebGL2 all make the composed claim untrue, and a product that never asked
   * would go on asserting it.
   */
  | { readonly op: 'facilities'; readonly observed: readonly string[] }
  /** The custom document's native dirty indicator follows this one opened path only. */
  | { readonly op: 'document-dirty'; readonly path: string; readonly dirty: boolean }
  /**
   * One committed edit in a view that keeps its own history (the image tools).
   *
   * The editor owns the undo stack: every edit reported here becomes one entry in it, and the
   * editor's Undo and Redo come back as `document-undo` / `document-redo`. A view must therefore
   * not undo on its own key handling, or the two stacks drift apart.
   */
  | { readonly op: 'document-edited'; readonly path: string }
  /** One phase the page measured (bundle evaluated, workbench mounted, stage mounted). */
  | { readonly op: 'timing'; readonly name: string; readonly milliseconds: number }
  /** An in-page Save button delegates to VS Code so the provider, title marker and Ctrl+S agree. */
  | { readonly op: 'document-save-requested'; readonly path: string }

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
  /** The transport itself: a text channel is a `FramePort` from the start. */
  readonly framePort: FramePort
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
  /*
   * Handed over as a `FramePort`, which is what it already is.
   *
   * This used to be re-shaped into something port-like so `exposeSubjectRpc`/`connectSubjectRpc`
   * could adapt it back — two conversions to arrive where the adapter had started. Both now accept
   * `framePort` directly.
   */
  const framePort = framePortFromJsonPort(jsonPort)

  return {
    framePort,

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
