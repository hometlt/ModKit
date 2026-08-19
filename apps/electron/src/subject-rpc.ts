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

export function exposeElectronSubjectRpc(
  options: Omit<ExposeSubjectRpcOptions, 'moduleUrl' | 'port'> & { readonly port: ElectronPort },
): SubjectRpcExposure {
  return exposeSubjectRpc({
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
