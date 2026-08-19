/**
 * R6 → S9: the Electron subject bridge is the host's subject RPC (`@modkitx-x3/host`
 * `exposeSubjectRpc`/`connectSubjectRpc`) over an Electron `MessageChannelMain` port pair —
 * main serves `x3.app/subject-services@1` (`open` → snapshot with the presentation plan,
 * `attach` → the live `x3.abi/asset-session@1`), the renderer consumes materialized proxies. This
 * file keeps the Electron names and the Electron module identity; the implementation is shared
 * with every other host that exposes subjects over a port (the server, S9).
 */

import {
  connectSubjectRpc,
  exposeSubjectRpc,
  SUBJECT_SERVICES,
  type ConnectSubjectRpcOptions,
  type ExposeSubjectRpcOptions,
  type SubjectOpener,
  type SubjectRpcClient,
  type SubjectRpcExposure,
} from '@modkitx-x3/host'
import type { MessagePortLike } from '@modkitx-x3/host/execution'

export type {
  SubjectClientOpenResult,
  SubjectOpenedSnapshot,
  SubjectOpenSnapshot,
  SubjectPreviewSession,
  SubjectRpcClient,
  SubjectRpcExposure,
  SubjectUnresolvedSnapshot,
} from '@modkitx-x3/host'

/** The one app-level surface (shared with every host). */
export const ELECTRON_SUBJECT_SERVICES = SUBJECT_SERVICES
/** Electron's module identity of the services root (there is nothing to import). */
export const ELECTRON_SUBJECT_SERVICES_URL = 'x3-app://electron/subject-services'

/** Main-side opener: everything the old `modkit.subject` open branch did, minus the transport. */
export type ElectronSubjectOpener = SubjectOpener

/** `MessagePortMain`, a DOM `MessagePort` or anything port-shaped; adapted structurally. */
type ElectronPort = MessagePortLike | MessagePort

/**
 * Copy byte results across the main→renderer port instead of transferring them.
 *
 * The endpoint's transfer policy is "arguments are copied, results and events are transferred",
 * and it hands the frame's `ArrayBuffer`s to `postMessage` as the transfer list. A DOM
 * `MessagePort` accepts that; Electron's `MessagePortMain` accepts **only** `MessagePortMain`
 * values and rejects everything else with `Port at index 0 is not a valid port`. Measured: with the
 * transfer list intact, every byte-carrying result over this boundary fails — `export.raw`, an
 * archive entry's bytes, and the encoded representation behind the image, audio, video and model
 * stages — while json-only operations succeed. Dropping the list makes the structured clone copy
 * the buffers, which is what Electron supports; the cost is one copy per byte payload and nothing
 * else changes (the sender's buffer simply is not detached).
 *
 * The general fix belongs in `framePortFromMessagePort`, which is the one place that knows which
 * port shape it adapted; the report to Root carries that request.
 */
function copyingPort(port: ElectronPort): MessagePortLike {
  const source = port as MessagePortLike
  // Only the methods the real port has are forwarded: the frame adapter picks its listener style
  // by probing for `addEventListener`, so inventing one here would change how frames are read.
  const wrapper: MessagePortLike = {
    postMessage: message => {
      source.postMessage(message)
    },
  }
  const forward: Partial<MessagePortLike> = wrapper
  if (typeof source.addEventListener === 'function') {
    forward.addEventListener = (type, listener) => source.addEventListener?.(type, listener)
    forward.removeEventListener = (type, listener) => source.removeEventListener?.(type, listener)
  }
  if (typeof source.on === 'function') {
    forward.on = (event, listener) => source.on?.(event, listener)
    forward.off = (event, listener) => source.off?.(event, listener)
  }
  if (typeof source.start === 'function') forward.start = () => source.start?.()
  if (typeof source.close === 'function') forward.close = () => source.close?.()
  return wrapper
}

export function exposeElectronSubjectRpc(
  options: Omit<ExposeSubjectRpcOptions, 'moduleUrl' | 'port'> & { readonly port: ElectronPort },
): SubjectRpcExposure {
  return exposeSubjectRpc({
    ...options,
    port: copyingPort(options.port),
    moduleUrl: ELECTRON_SUBJECT_SERVICES_URL,
  })
}

export async function connectElectronSubjectRpc(
  options: Omit<ConnectSubjectRpcOptions, 'moduleUrl' | 'contributionId' | 'port'> & {
    readonly port: ElectronPort
  },
): Promise<SubjectRpcClient> {
  return connectSubjectRpc({
    ...options,
    port: options.port as MessagePortLike,
    moduleUrl: ELECTRON_SUBJECT_SERVICES_URL,
    contributionId: 'org.modkitx.app.electron/subject-services',
  })
}
