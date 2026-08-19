/**
 * Browser entry point for the PWA.
 *
 * The composition root (`./index.js`, `./subjects.js`) stays free of DOM and bootstrap concerns
 * so it can be unit tested and reused by a different shell; this file is the part that only makes
 * sense in a page: it hands the real DOM globals to the subject services (codecs run in module
 * workers, never on this thread), mounts the workbench, and wires one honest open flow — pick a
 * file, open it through the host pipeline, show what was selected, under which boundary, and
 * what the session's first data source answers.
 */
import { revisionId, type ArtifactByteSource } from '@modkitx-x3/sdk'
import type {
  BrowserBlobConstructorLike,
  BrowserMessageChannelConstructorLike,
  BrowserObjectUrlLike,
} from '@modkitx-x3/host/browser'
import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import { createWebApp, mountWebWorkbench, probeWebFacilities } from './index.js'
import { createWebSubjectServices } from './subjects.js'

function requireRoot(): Element {
  const node = document.querySelector('#root')
  if (node === null) throw new Error('missing #root')
  return node
}

/** The browser does not report OS/arch portably; a real host adapter supplies this. */
function identity(): { operatingSystem: 'windows' | 'darwin' | 'linux'; architecture: 'x64' } {
  const agent = navigator.userAgent
  // `darwin`, not `macos`: the wire vocabulary is the platform name, not the product name.
  const operatingSystem = agent.includes('Windows')
    ? 'windows'
    : agent.includes('Mac')
      ? 'darwin'
      : 'linux'
  return { operatingSystem, architecture: 'x64' }
}

/** A picked `File` as a random-access byte source; revision is the file's own identity + mtime. */
function fileSource(file: File): ArtifactByteSource {
  const uri = `file-picker://${encodeURIComponent(file.name)}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`provider-token:${file.size}-${file.lastModified}`),
    size: BigInt(file.size),
    async read(offset, length) {
      const start = Number(offset)
      return new Uint8Array(await file.slice(start, start + length).arrayBuffer())
    },
    async *stream(range) {
      const start = Number(range?.offset ?? 0n)
      const end = range?.length === undefined ? file.size : start + Number(range.length)
      yield new Uint8Array(await file.slice(start, end).arrayBuffer())
    },
  }
}

async function pickFile(): Promise<File | undefined> {
  const picker = (window as { showOpenFilePicker?: () => Promise<{ getFile(): Promise<File> }[]> })
    .showOpenFilePicker
  if (picker !== undefined) {
    try {
      const [handle] = await picker.call(window)
      return handle === undefined ? undefined : await handle.getFile()
    } catch {
      return undefined
    }
  }
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? undefined), { once: true })
    input.click()
  })
}

const el = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

async function boot(): Promise<void> {
  const probe = probeWebFacilities()
  const app = await createWebApp(identity(), [], probe)
  const workbench = mountWebWorkbench(document, requireRoot(), app, 'Modkit MK3')

  // ---------------------------------------------------------------- subject services
  const baseUrl = new URL('./', document.baseURI)
  const bootDiagnostics: string[] = []
  const services = await createWebSubjectServices({
    baseUrl,
    catalog: WEB_EXTENSION_CATALOG,
    identity: identity(),
    probe,
    dom: {
      fetch: (url, init) => fetch(url, init),
      subtle: {
        digest: (algorithm, data) =>
          crypto.subtle.digest(algorithm, data as Uint8Array<ArrayBuffer>),
      },
      // the structural DOM shapes take readonly parts / any blob; the platform types are wider
      Blob: Blob as unknown as BrowserBlobConstructorLike,
      objectUrls: URL as unknown as BrowserObjectUrlLike,
      Worker,
      MessageChannel: MessageChannel as unknown as BrowserMessageChannelConstructorLike,
    },
    onDiagnostic: diagnostic => {
      bootDiagnostics.push(`${diagnostic.code}: ${diagnostic.message}`)
      console.info(`[worker] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`)
    },
  })

  // ---------------------------------------------------------------- sidebar
  const summary = el('div', 'boot-summary')
  const errors = services.main.inventory.diagnostics.filter(item => item.severity === 'error')
  summary.textContent =
    `${app.topology.realms.length} realms · ` +
    `main ${services.main.profile.facilities.length} facilities · ` +
    `worker ${services.worker.profile.facilities.length} facilities · ` +
    `${services.main.inventory.extensions.length} extensions · ` +
    `${errors.length} errors · shared memory ${probe.sharedMemory ? 'yes' : 'no'} · ` +
    `codecs run ${services.executionProfiles.join('/')} in ${services.worker.profile.realmId}`

  const facilities = el('ul', 'facility-list')
  for (const facility of services.main.profile.facilities) {
    facilities.append(el('li', '', facility))
  }
  const supported = el('p', 'muted', `Detects by name: ${services.supportedExtensions.join(', ')}`)
  const excluded = WEB_EXTENSION_CATALOG.excluded
  const excludedNote =
    excluded.length === 0
      ? undefined
      : el(
          'p',
          'muted',
          `Not served in the browser yet: ${excluded.map(item => item.name).join(', ')} (vendor dependencies not bundled for the worker).`,
        )

  const openButton = document.createElement('button')
  openButton.type = 'button'
  openButton.className = 'open-button'
  openButton.textContent = 'Open file…'

  const panel = el('div', 'boot-panel')
  panel.append(
    summary,
    openButton,
    supported,
    ...(excludedNote === undefined ? [] : [excludedNote]),
    facilities,
  )
  workbench.setSidebar(panel)

  const empty = el(
    'p',
    'placeholder',
    `${services.main.inventory.extensions.length} codec extensions are attested and served; pick a file to open it worker-brokered.`,
  )
  workbench.setMain(empty)

  // ---------------------------------------------------------------- open flow
  let current: { dispose(): Promise<void> } | undefined
  openButton.addEventListener('click', () => {
    void (async () => {
      const file = await pickFile()
      if (file === undefined) return
      openButton.disabled = true
      const view = el('div', 'subject-view')
      view.append(el('h2', '', file.name), el('p', 'muted', 'opening…'))
      workbench.setMain(view)
      try {
        await current?.dispose()
        current = undefined
        const result = await services.open({
          source: fileSource(file),
          path: file.name,
          intent: 'full',
          grant: { id: `pwa:${Date.now().toString(36)}`, classes: ['read-source'] },
          budget: {
            maxInputBytes: BigInt(64 * 1024 * 1024),
            maxDepth: 256,
            maxNodes: 1_000_000,
            maxScalarBytes: 64 * 1024 * 1024,
            maxDiagnostics: 10_000,
            deadlineMs: 30_000,
          },
        })
        view.replaceChildren(el('h2', '', file.name))
        if (result.state === 'unresolved') {
          view.append(
            el('p', 'bad', `unresolved: ${result.reason}`),
            el('p', 'muted', `fallback: ${result.fallback.preferred}`),
          )
          const list = el('ul', 'diagnostic-list')
          for (const candidate of result.candidates) {
            list.append(
              el(
                'li',
                '',
                `${candidate.contributionId}/${candidate.variantId}: ${candidate.state}` +
                  candidate.diagnostics.map(item => ` — ${item.code}: ${item.message}`).join(''),
              ),
            )
          }
          view.append(list)
          return
        }
        current = result.session
        const boundary = result.diagnostics.some(
          item => item.code === 'x3.host/worker-shared-process',
        )
          ? 'worker-brokered (module worker of this page)'
          : 'unknown boundary'
        view.append(
          el(
            'p',
            '',
            `${result.selected.contributionId}/${result.selected.variantId} · ${Math.round(
              result.selected.confidence * 100,
            )}% · ${boundary}`,
          ),
        )
        const descriptor = el('pre', 'descriptor')
        descriptor.textContent = JSON.stringify(result.descriptor, null, 2).slice(0, 8000)
        view.append(el('h3', '', 'descriptor'), descriptor)
        // the first published data source: prove the session answers over the RPC
        const sources =
          (
            result.descriptor as unknown as {
              dataSources?: readonly { contract: string; major: number }[]
            }
          ).dataSources ?? []
        const first = sources[0]
        if (first !== undefined) {
          try {
            const lease = await (
              result.session.dataSource as unknown as (
                contract: string,
                major: number,
              ) => Promise<{ value: unknown; release(): Promise<void> }>
            )(first.contract, first.major)
            const value = lease.value as Record<string, unknown>
            const probeMethod = ['root', 'info', 'size', 'shape', 'summary', 'snapshot'].find(
              name => typeof value[name] === 'function',
            )
            if (probeMethod !== undefined) {
              const answer = await (value[probeMethod] as () => Promise<unknown>)()
              const pre = el('pre', 'descriptor')
              pre.textContent = `${first.contract}@${first.major}.${probeMethod}() → ${JSON.stringify(
                answer,
                (_key, item: unknown) => (typeof item === 'bigint' ? `${item}n` : item),
                2,
              ).slice(0, 4000)}`
              view.append(el('h3', '', 'first data source'), pre)
            }
            await lease.release()
          } catch (error) {
            view.append(el('p', 'bad', `data source failed: ${String(error)}`))
          }
        }
        const notes = el('ul', 'diagnostic-list')
        for (const item of result.diagnostics)
          notes.append(el('li', '', `${item.code}: ${item.message}`))
        for (const line of bootDiagnostics.splice(0)) notes.append(el('li', 'muted', line))
        view.append(el('h3', '', 'diagnostics'), notes)
      } catch (error) {
        view.append(
          el('p', 'bad', `open failed: ${error instanceof Error ? error.message : String(error)}`),
        )
      } finally {
        openButton.disabled = false
      }
    })()
  })
}

// Registered after boot so a service-worker failure can never block the app from starting.
async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('./service-worker.js', { scope: './' })
  } catch (error) {
    console.warn('service worker registration failed', error)
  }
}

boot()
  .then(registerServiceWorker)
  .catch((error: unknown) => {
    const node = requireRoot()
    node.replaceChildren()
    const failure = document.createElement('p')
    failure.className = 'booting'
    failure.textContent = `Boot failed: ${error instanceof Error ? error.message : String(error)}`
    node.append(failure)
  })
