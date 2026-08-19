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
 * Which listener style a bare Electron port has.
 *
 * `MessagePortMain` is an emitter whose `'message'` events carry `.data`, which the adapter calls
 * `'emitter-event'` — and that is also what tells the adapter to copy byte payloads rather than
 * hand `postMessage` a transfer list, because `MessagePortMain` accepts only `MessagePortMain`
 * values in one. Defaulting it here means a caller that forgets does not silently get the
 * `'emitter-value'` fallback, under which every frame arrives as an event object and nothing works.
 */
const listenerStyleFor = (port: ElectronPort): 'event-target' | 'emitter-event' =>
  typeof (port as MessagePortLike).addEventListener === 'function'
    ? 'event-target'
    : 'emitter-event'

export function exposeElectronSubjectRpc(
  options: Omit<ExposeSubjectRpcOptions, 'moduleUrl' | 'port'> & { readonly port: ElectronPort },
): SubjectRpcExposure {
  return exposeSubjectRpc({
    listener: listenerStyleFor(options.port),
    ...options,
    port: options.port as MessagePortLike,
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
