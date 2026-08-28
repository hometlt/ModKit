/**
 * The PWA's preview policy: which shipped viewer may appear for which subject.
 *
 * Every stage is a `@modkitx-x3/ui` module bound to one published data-source contract. The
 * application owns the *list*; `createCodecPreview` owns the *decision*, and it makes it from the
 * descriptor alone — a codec that grows a new data source gets a new tab here without this file
 * changing, and a codec that publishes nothing gets the built-in text/hex fallback.
 *
 * Two rules are worth stating because they are load-bearing:
 *
 *  - **Editable stages are offered only for a file this page can write.** The text and hex
 *    *editors* are listed with `editable: true`, and `createCodecPreview` drops them unless the
 *    host passes `editorPorts`. The shell now passes them — but per subject: a file picked through
 *    `showOpenFilePicker`/`showDirectoryPicker` has a handle with `createWritable()` and gets the
 *    editors; a file that arrived through a plain file input, a drop or a same-origin fetch has no
 *    handle, can never be saved back, and gets none. Write permission that the browser has already
 *    denied drops them too. An editor that could never save would still be a lie; the difference is
 *    that the app now knows exactly which files those are (see `./editing.js`).
 *  - **A stage is gated by its contract, not by a trait, unless the trait is what a viewer needs.**
 *    PNG publishes a tree data source while declaring only image traits; requiring
 *    `structure.hierarchy` there would hide a tree the codec really does publish. The text stages
 *    do carry `content.text`, which is exactly what the shipped bounded/virtual text manifests
 *    require and what the codec-kit text runtime emits.
 *
 * Monaco is Electron-only (it needs a relaxed CSP and a trusted in-process editor); the browser
 * uses the bounded and virtual text viewers.
 */
import { CONTAINER_EXTRACT_OPERATION_ID } from '@modkitx-x3/core'
import {
  bindingId,
  presentationSlotId,
  type AnyDescriptor,
  type BindingRef,
  type JsonValue,
  type KnownDataSourceId,
  type NamespaceEntrySource,
  type OperationSession,
  type PresentationSlot,
  type ViewerModule,
  type ViewerMount,
} from '@modkitx-x3/sdk'
import { audioViewer } from '@modkitx-x3/ui/audio'
import { boundedTextViewer } from '@modkitx-x3/ui/code'
import { textEditor } from '@modkitx-x3/ui/editor'
import type { PreviewStage } from '@modkitx-x3/ui/explorer'
import { hexViewer } from '@modkitx-x3/ui/hex'
import { hexEditor } from '@modkitx-x3/ui/hex-editor'
import { imageViewer } from '@modkitx-x3/ui/image'
import { metadataPanel } from '@modkitx-x3/ui/metadata'
import { MODEL_FACET_CONTRACTS, modelViewer } from '@modkitx-x3/ui/model'
import { namespaceViewer } from '@modkitx-x3/ui/namespace'
import { tableViewer } from '@modkitx-x3/ui/table'
import { virtualTextViewer } from '@modkitx-x3/ui/text-virtual'
import { transportViewer } from '@modkitx-x3/ui/transport'
import { treeViewer } from '@modkitx-x3/ui/tree'
import { vectorViewer } from '@modkitx-x3/ui/vector'
import { videoViewer } from '@modkitx-x3/ui/video'
import { worldViewer } from '@modkitx-x3/ui/world'
import {
  defineViewerModule,
  element,
  requireContainer,
  setViewerText,
  unknownSourceLease,
} from '@modkitx-x3/ui/viewer'

/** How many bytes of an archive entry the inline preview reads. */
export const ARCHIVE_ENTRY_PREVIEW_BYTES = 64 * 1024

/** Listing pages the entry stage will walk to resolve one entry id to its path. */
export const ARCHIVE_LISTING_PAGES = 25

/**
 * How the app reaches the live session behind a mounted descriptor.
 *
 * `createCodecPreview` mounts viewers with no operation session (it has no business inventing
 * one), so a stage that needs to invoke an operation asks the shell, which owns the sessions it
 * opened. Keyed by descriptor identity rather than by tab, because the descriptor is the only
 * thing a `ViewerModule` is handed.
 */
export interface WebViewContext {
  operationsFor(descriptor: AnyDescriptor): OperationSession | undefined
  /**
   * Open one member of this container as a subject of its own (block 13 slice B).
   *
   * The stage below can already read an entry's *bytes* — that is what `container.extract` is for,
   * and it is what this pane has shown since block 9. Bytes are a preview of a member, not the
   * member: a W3D previewed this way has no texture, because nothing resolved its companions
   * inside the archive it came from. The host route that does is `openNestedSubject`, and only the
   * shell can reach it because only the shell holds the container's live session. So the stage
   * asks, and answers with a sentence when the shell cannot.
   */
  openNestedEntry?(
    descriptor: AnyDescriptor,
    entryId: string,
    entryPath: string,
  ): Promise<string | undefined>
}

// ---------------------------------------------------------------------------------------------
// descriptor reading — the same two questions `createCodecPreview` asks

export function descriptorContracts(descriptor: AnyDescriptor): readonly string[] {
  return descriptor.dataSources.map(offer => offer.contract)
}

export function descriptorTraits(descriptor: AnyDescriptor): readonly string[] {
  return descriptor.traits.map(trait => trait.id)
}

/**
 * The stages this descriptor can actually show.
 *
 * The same predicate `createCodecPreview` applies, as a pure function: published contract, trait
 * when the stage names one, and an editable stage only when the host supplied editor ports. It
 * exists so the policy can be asserted in Node without a DOM — the shell hands the very same list
 * to `createCodecPreview` and never filters it itself.
 */
export function applicableStages(
  stages: readonly PreviewStage[],
  descriptor: AnyDescriptor,
  options: { readonly editorPorts?: boolean } = {},
): readonly PreviewStage[] {
  const contracts = new Set(descriptorContracts(descriptor))
  const traits = new Set(descriptorTraits(descriptor))
  return stages.filter(
    stage =>
      contracts.has(stage.contract) &&
      (stage.trait === undefined || traits.has(stage.trait)) &&
      (stage.editable !== true || options.editorPorts === true),
  )
}

export const stageIdOf = (stage: PreviewStage): string => stage.id ?? stage.contract

// ---------------------------------------------------------------------------------------------
// slots for app-composed stages

/**
 * A binding for one standard contract at major 1.
 *
 * `KnownBindingRef` distributes over the contract union, so a value whose `contract` is typed as
 * the union itself never simplifies to a single member. Every standard contract this app binds is
 * major 1, which is what each distributed member asks for.
 */
function contentBinding(contract: KnownDataSourceId): BindingRef {
  return { bindingId: bindingId('content'), contract, major: 1 } as unknown as BindingRef
}

function partSlot(slotId: string, contract: KnownDataSourceId): PresentationSlot {
  return {
    slotId: presentationSlotId(slotId),
    kind: 'stage',
    contributionId: 'org.modkitx.app.web/preview',
    extensionId: 'org.modkitx.app.web',
    priority: 100,
    bindings: [contentBinding(contract)],
  }
}

// ---------------------------------------------------------------------------------------------
// composite stages

interface CompositePart {
  /** Segment id for this part's slot. */
  readonly id: string
  readonly module: ViewerModule
  readonly contract: KnownDataSourceId
}

/**
 * Mount several shipped viewers into one stage.
 *
 * Each shipped module calls `createSurface`, which replaces its container's children, so every
 * part gets its own element. Parts whose contract the descriptor does not publish are skipped:
 * an audio subject without a transport source shows the waveform alone rather than a dead bar.
 */
function compositeStage(parts: readonly CompositePart[]): ViewerModule {
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const container = requireContainer(args.container)
      container.replaceChildren()
      const published = new Set(descriptorContracts(args.descriptor))
      const mounted: ViewerMount[] = []
      for (const part of parts) {
        if (!published.has(part.contract)) continue
        const host = container.ownerDocument.createElement('div')
        host.className = 'web-stage-part'
        container.append(host)
        mounted.push(
          await part.module.mount({
            ...args,
            container: host,
            slot: partSlot(part.id, part.contract),
          }),
        )
      }
      return {
        async update(next) {
          for (const mount of mounted) await mount.update(next)
        },
        async unmount() {
          for (const mount of mounted.reverse()) await mount.unmount()
          container.replaceChildren()
        },
      }
    },
  })
}

/** Waveform plus the transport bar, when the codec publishes one. */
const audioStage: ViewerModule = compositeStage([
  { id: 'audio', module: audioViewer, contract: 'common.view/audio-media-source' },
  { id: 'transport', module: transportViewer, contract: 'common.view/transport-source' },
])

// ---------------------------------------------------------------------------------------------
// archive / namespace stage

const previewText = (bytes: Uint8Array): string | undefined => {
  if (bytes.includes(0)) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

const hexDump = (bytes: Uint8Array): string => {
  const lines: string[] = []
  for (let index = 0; index < bytes.length; index += 16) {
    const chunk = bytes.slice(index, index + 16)
    const address = index.toString(16).padStart(8, '0')
    const hex = [...chunk].map(value => value.toString(16).padStart(2, '0')).join(' ')
    const ascii = [...chunk]
      .map(value => (value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.'))
      .join('')
    lines.push(`${address}  ${hex.padEnd(47)}  ${ascii}`)
  }
  return lines.join('\n')
}

/**
 * Browse a container and look inside one entry.
 *
 * The tree is the shipped namespace viewer. `openEntry` answers with a *reference* — an id and a
 * URI for a nested source — never bytes, because reopening a nested source is the host's job and
 * this host has no namespace routing yet. So the pane below states that reference and invokes the
 * platform-owned `container.extract` operation with the namespace's opaque entry id. When the
 * subject does not declare that contract, it says so instead of showing an empty box.
 */
function archiveStage(context: WebViewContext): ViewerModule {
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const container = requireContainer(args.container)
      container.replaceChildren()
      const treeHost = container.ownerDocument.createElement('div')
      treeHost.className = 'web-stage-part'
      const entryHost = container.ownerDocument.createElement('div')
      entryHost.className = 'web-stage-part web-archive-entry'
      container.append(treeHost, entryHost)

      const slot = partSlot('entries', 'common.view/namespace-entry-source')
      const tree = await namespaceViewer.mount({ ...args, container: treeHost, slot })

      const status = element(entryHost, 'output', { part: 'viewer.status' })
      /*
       * "Open as subject" — the member, not a preview of it (block 13 slice B).
       *
       * Disabled until an entry is picked, and hidden entirely when this shell composed no nested
       * route, so the page never offers a control that would answer with a refusal it caused.
       */
      const openAsSubject = entryHost.ownerDocument.createElement('button')
      openAsSubject.className = 'web-archive-open-subject'
      openAsSubject.type = 'button'
      openAsSubject.textContent = 'Open as subject'
      entryHost.append(openAsSubject)
      openAsSubject.disabled = true
      if (context.openNestedEntry === undefined) openAsSubject.hidden = true
      let picked: { readonly entryId: string; readonly path: string } | undefined
      openAsSubject.addEventListener('click', () => {
        const target = picked
        const route = context.openNestedEntry
        if (target === undefined || route === undefined) return
        openAsSubject.disabled = true
        void route(args.descriptor, target.entryId, target.path)
          .then(problem => {
            if (problem !== undefined) setViewerText(status, problem)
          })
          .catch((error: unknown) => {
            setViewerText(
              status,
              `opening ${target.path} as a subject failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            )
          })
          .finally(() => {
            openAsSubject.disabled = picked === undefined
          })
      })
      const body = element(entryHost, 'pre', { part: 'hex.content' })
      setViewerText(status, 'Pick an entry in the tree to inspect it.')

      /*
       * A second lease on the same namespace source. Entry ids are opaque by contract — the ZIP
       * codec numbers them — so the entry's *path* is read back from the listing rather than
       * guessed out of the id or the entry URI. Releasing is a no-op under `createCodecPreview`:
       * the codec session owns the source.
       */
      const lease = await unknownSourceLease(
        args.sources,
        slot,
        'common.view/namespace-entry-source',
      )
      const source = lease?.value as NamespaceEntrySource | undefined
      const paths = new Map<string, string>()
      const pathFor = async (entryId: string): Promise<string | undefined> => {
        const known = paths.get(entryId)
        if (known !== undefined || source === undefined) return known
        let cursor: string | undefined
        for (let page = 0; page < ARCHIVE_LISTING_PAGES; page += 1) {
          const listed = await source.list(
            '',
            { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
            args.signal,
          )
          for (const item of listed.items) paths.set(item.id, item.path)
          const found = paths.get(entryId)
          if (found !== undefined) return found
          cursor = listed.nextCursor
          if (cursor === undefined) break
        }
        return undefined
      }

      const extract = args.descriptor.operations.find(
        operation =>
          operation.state === 'available' &&
          !operation.mutatesSource &&
          operation.id === CONTAINER_EXTRACT_OPERATION_ID,
      )

      const show = (detail: { readonly entryId?: unknown; readonly source?: unknown }): void => {
        const reference = detail.source as { readonly id?: string; readonly uri?: string } | null
        const entryId = String(detail.entryId ?? '')
        setViewerText(
          status,
          `${entryId} → ${reference?.uri ?? 'no source reference'}${
            extract === undefined
              ? ' · this subject declares no available container.extract operation, so the bytes ' +
                'cannot be read in this host yet'
              : ''
          }`,
        )
        if (extract === undefined) {
          setViewerText(body, '')
          return
        }
        const operations = context.operationsFor(args.descriptor)
        if (operations === undefined) {
          setViewerText(body, 'The session that opened this container is no longer held.')
          return
        }
        void (async () => {
          try {
            const path = await pathFor(entryId)
            if (path === undefined) {
              setViewerText(body, `the namespace does not list an entry with id ${entryId}`)
              return
            }
            // Entry ids are opaque and come from the namespace source that owns this operation.
            const input: JsonValue = { entryId }
            const result = await operations.invoke(extract.handlerId, input, {
              ...(args.signal === undefined ? {} : { signal: args.signal }),
            })
            if (result.state !== 'ok' || result.output.kind !== 'bytes') {
              setViewerText(
                body,
                result.state === 'ok'
                  ? `the operation answered ${result.output.kind}, not bytes`
                  : `rejected: ${result.reason}`,
              )
              return
            }
            const bytes = result.output.value.slice(0, ARCHIVE_ENTRY_PREVIEW_BYTES)
            const text = previewText(bytes)
            setViewerText(body, text ?? hexDump(bytes), ARCHIVE_ENTRY_PREVIEW_BYTES * 4)
            setViewerText(
              status,
              `${path} · ${result.output.value.length} bytes · shown as ${
                text === undefined ? 'hex' : 'text'
              }`,
            )
            // The bytes above are the preview; this is what turns the same entry into a subject.
            picked = { entryId, path }
            openAsSubject.disabled = context.openNestedEntry === undefined
          } catch (error) {
            setViewerText(
              body,
              `entry read failed: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        })()
      }

      const listener = (event: Event): void => {
        const detail = (event as { detail?: Record<string, unknown> }).detail
        if (detail !== undefined) show(detail)
      }
      treeHost.addEventListener('modkit-open-source', listener)

      return {
        async update(next) {
          await tree.update(next)
        },
        async unmount() {
          treeHost.removeEventListener('modkit-open-source', listener)
          await tree.unmount()
          container.replaceChildren()
        },
      }
    },
  })
}

// ---------------------------------------------------------------------------------------------
// the catalog

/**
 * Every first-party stage the ui package ships, in the order the picker offers them.
 *
 * Order is preference: `createCodecPreview` mounts the first applicable stage, so the richest
 * rendering of a subject comes up first and hex stays last as the thing that always works.
 */
export function createWebPreviewStages(context: WebViewContext): readonly PreviewStage[] {
  return Object.freeze([
    {
      id: 'image',
      label: 'Image',
      contract: 'common.view/raster-image-source',
      module: imageViewer,
    },
    {
      id: 'vector',
      label: 'Vector',
      contract: 'common.view/vector-scene-source',
      module: vectorViewer,
    },
    {
      id: 'world',
      label: 'World',
      contract: 'common.view/world-scene-source',
      module: worldViewer,
    },
    {
      id: 'model',
      label: 'Model',
      contract: 'common.view/model-scene-source',
      module: modelViewer,
      // optional, never a selection rule: a codec publishing none of these still gets the stage
      optionalContracts: MODEL_FACET_CONTRACTS,
    },
    { id: 'audio', label: 'Audio', contract: 'common.view/audio-media-source', module: audioStage },
    {
      id: 'video',
      label: 'Video',
      contract: 'common.view/video-media-source',
      module: videoViewer,
    },
    {
      id: 'entries',
      label: 'Entries',
      contract: 'common.view/namespace-entry-source',
      module: archiveStage(context),
    },
    { id: 'table', label: 'Table', contract: 'common.view/table-data-source', module: tableViewer },
    { id: 'tree', label: 'Tree', contract: 'common.view/tree-data-source', module: treeViewer },
    {
      id: 'text',
      label: 'Text',
      contract: 'common.view/text-data-source',
      module: boundedTextViewer,
      trait: 'content.text',
    },
    {
      id: 'text-virtual',
      label: 'Text (streaming)',
      contract: 'common.view/text-data-source',
      module: virtualTextViewer,
      trait: 'content.text',
    },
    /*
     * The metadata panel consumes no data source at all — its shipped manifest declares
     * `consumesDataSources: []` and it renders the descriptor's own metadata groups. It is bound
     * to the byte-range source because that is the host's floor for an opened subject (the
     * codec-kit runtime publishes it for every codec, and even the unresolved descriptor carries
     * it), which makes "the subject opened" the condition, stated rather than implied.
     */
    {
      id: 'metadata',
      label: 'Metadata',
      contract: 'common.view/byte-range-source',
      module: metadataPanel,
    },
    { id: 'hex', label: 'Hex', contract: 'common.view/byte-range-source', module: hexViewer },
    /*
     * Mounted only for a subject the shell handed `editorPorts` for — a file with a File System
     * Access handle whose write permission the browser has not refused. See the module comment.
     */
    {
      id: 'text-editor',
      label: 'Text (editor)',
      contract: 'common.view/text-data-source',
      module: textEditor,
      trait: 'content.text',
      editable: true,
    },
    {
      id: 'hex-editor',
      label: 'Hex (editor)',
      contract: 'common.view/byte-range-source',
      module: hexEditor,
      editable: true,
    },
  ] satisfies readonly PreviewStage[])
}

/** Shown when no codec claims the file at all, so "unknown format" still means "look at it". */
export const WEB_PREVIEW_FALLBACK = Object.freeze({ text: boundedTextViewer, hex: hexViewer })

/** The stage ids that only ever appear when a host supplies editor ports. */
export const EDITABLE_STAGE_IDS = Object.freeze(['text-editor', 'hex-editor'])

/**
 * What this build can and cannot edit, in the words the UI shows.
 *
 * It replaces the old "viewing only, no browser editing backend" line, which stopped being true
 * when the File System Access backend was wired in. The sentence that matters is the second one:
 * the editors follow the *handle*, not the file type, and there is one kind of open file that can
 * never get them.
 */
export const WEB_EDITING_NOTICE =
  'Editing: a file opened through the file or folder picker has a writable handle, so it gets the ' +
  'text and hex editors, an Edit panel for the change operations its codec declares, and saves ' +
  'in place once you allow write access. A file that arrived by drop, by a plain file input or ' +
  'by a same-origin fetch has no handle and stays view-only.'
