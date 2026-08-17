/**
 * Electron renderer — the file previewer.
 *
 * It composes nothing and touches no filesystem API. Everything it can do arrives through the
 * preload bridge: the main process owns the dialogs, the granted roots and the reads. The explorer
 * itself is the shared `@modkitx-x3/ui` component; this file only adapts the broker to the
 * `FileAccess` shape it expects.
 *
 * This file must not import `./index.js` — the composition root pulls in `@modkitx-x3/host/node`,
 * and a renderer able to run that would need the Node access `nodeIntegration: false` denies. The
 * bundle failing to resolve `node:fs` is the guard doing its job.
 */
import {
  createCodecPreview,
  createExplorer,
  createWorkbench,
  type ExplorerEntry,
  type FileAccess,
} from '@modkitx-x3/ui'

import { PREVIEW_FORMATS, PREVIEW_STAGES } from './codecs.js'

interface RendererProfile {
  readonly topologyId: string
  readonly renderer: {
    readonly realmId: string
    readonly facilities: readonly string[]
    readonly environment: string
  }
  readonly mainFacilityCount: number
}

interface Broker {
  readonly channels: readonly string[]
  request(channel: string, payload: unknown): Promise<unknown>
}

interface HostBridge {
  profile(): Promise<RendererProfile>
  initialFile(): Promise<{
    readonly present: boolean
    readonly root?: string
    readonly entry?: ExplorerEntry
    readonly selfTest?: boolean
  }>
  registerFileTypes(extensions: readonly string[]): Promise<{
    readonly supported: boolean
    readonly message: string
  }>
}

const broker = (globalThis as { modkitBroker?: Broker }).modkitBroker
const host = (globalThis as { modkitHost?: HostBridge }).modkitHost
const files = (globalThis as { modkitFiles?: { pathFor(file: File): string } }).modkitFiles

function requireRoot(): Element {
  const node = document.querySelector('#root')
  if (node === null) throw new Error('missing #root')
  return node
}

const basename = (value: string): string => {
  const parts = value.split(/[\\/]/u).filter(Boolean)
  return parts[parts.length - 1] ?? value
}

/** Wrap the broker in the capability shape the explorer asks for. */
function accessFor(rootPath: string): FileAccess {
  if (broker === undefined) throw new Error('preload bridge is missing')
  return {
    label: basename(rootPath) || rootPath,
    async list(entryId) {
      const result = (await broker.request('directory.list', {
        path: entryId ?? rootPath,
      })) as { entries: readonly ExplorerEntry[] }
      return result.entries
    },
    async read(entryId, maxBytes) {
      const result = (await broker.request('filesystem.read-file', {
        path: entryId,
        maxBytes,
      })) as { bytes: Uint8Array }
      // Structured clone may hand back a plain object view; normalise to a real Uint8Array.
      return result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes)
    },
  }
}

async function boot(): Promise<void> {
  if (host === undefined || broker === undefined) {
    throw new Error('preload bridge is missing: modkitHost/modkitBroker are undefined')
  }
  const profile = await host.profile()

  const workbench = createWorkbench(document, {
    title: 'Modkit MK3',
    host: { label: profile.renderer.realmId, facilities: profile.renderer.facilities },
  })
  requireRoot().replaceChildren(workbench.root)

  const preview = createCodecPreview({ formats: PREVIEW_FORMATS, stages: PREVIEW_STAGES })

  const explorer = createExplorer(document, {
    preview,

    async openFolder() {
      const result = (await broker.request('dialog.open-directory', {
        requestId: crypto.randomUUID(),
      })) as { canceled: boolean; root?: string }
      if (result.canceled || result.root === undefined) return undefined
      return accessFor(result.root)
    },

    async openFile() {
      const result = (await broker.request('dialog.open-file', {
        requestId: crypto.randomUUID(),
      })) as { canceled: boolean; root?: string; entry?: ExplorerEntry }
      if (result.canceled || result.root === undefined || result.entry === undefined) {
        return undefined
      }
      return { access: accessFor(result.root), entry: result.entry }
    },

    /*
     * A native drop carries real paths, which the preload reads with `webUtils.getPathForFile`.
     * The grant still happens in the main process: the drop is the user's consent, but only main
     * may widen what is readable.
     */
    async acceptDrop(transfer) {
      if (files === undefined) throw new Error('preload file bridge is missing')
      const paths = [...transfer.files]
        .map(file => files.pathFor(file))
        .filter(value => value !== '')
      if (paths.length === 0) {
        throw new Error('the drop carried no filesystem path (was it dragged from a browser?)')
      }
      const result = (await broker.request('dialog.accept-drop', { paths })) as {
        accepted: readonly { root: string; entry?: ExplorerEntry }[]
      }
      const first = result.accepted[0]
      if (first === undefined) return undefined
      return {
        access: accessFor(first.root),
        ...(first.entry === undefined ? {} : { entry: first.entry }),
      }
    },

    async registerFileTypes() {
      const response = await host.registerFileTypes(preview.supported)
      return response.message
    },
  })

  workbench.setMain(explorer.root)

  // Opened by double-click once this build is registered for the type.
  const initial = await host.initialFile()
  if (initial.present && initial.root !== undefined) {
    await explorer.setAccess(accessFor(initial.root))
    if (initial.entry !== undefined) await explorer.open(initial.entry)
    if (initial.selfTest === true) await selfTest(accessFor(initial.root), preview, explorer)
  }
}

/**
 * Drive the previewer without a human: list the granted folder, preview every file, and report what
 * mounted. Verification has to reach the codecs and the stages, not just the window.
 */
async function selfTest(
  access: FileAccess,
  preview: ReturnType<typeof createCodecPreview>,
  explorer: ReturnType<typeof createExplorer>,
): Promise<void> {
  const entries = await access.list(undefined)
  console.log(`selftest: ${entries.length} entries in ${access.label}`)
  console.log(`selftest: supported extensions ${preview.supported.join(', ')}`)

  for (const entry of entries) {
    if (entry.directory) continue
    try {
      await explorer.open(entry)
      const stage = document.querySelector('[data-mk-part="explorer.stage"]')
      const tabs = [...document.querySelectorAll('[data-mk-part="explorer.tab"]')].map(
        node => node.textContent,
      )
      const mounted = stage?.querySelector('[data-mk-part="viewer"]') !== null
      const note = document.querySelector('[data-mk-part="explorer.placeholder"]')?.textContent
      console.log(
        `selftest: ${entry.name} -> tabs [${tabs.join(', ')}] viewer=${mounted ? 'mounted' : 'none'}` +
          (note === undefined || note === null ? '' : ` note="${note}"`),
      )
    } catch (error) {
      console.log(`selftest: ${entry.name} -> FAILED ${String(error)}`)
    }
  }
  console.log('selftest: done')
}

boot().catch((error: unknown) => {
  const failure = document.createElement('p')
  failure.className = 'bad'
  failure.textContent = `Boot failed: ${error instanceof Error ? error.message : String(error)}`
  requireRoot().replaceChildren(failure)
})
