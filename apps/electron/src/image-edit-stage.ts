/**
 * PNG pixel editor — decoded RGBA8 in the renderer, encoding and committing in the host.
 *
 * The canvas never invents PNG bytes. It authors an RGBA8 semantic change set and the editor ports
 * send that to the `png/rgba8/mutate/semantic` writer main resolved through the extension
 * inventory. The stage is only registered for a subject after that writer resolved; JPEG and
 * every other raster format therefore keep their ordinary read-only image stage.
 */
import {
  createImageEditor,
  createSurface,
  defineEditorModule,
  element,
  setState,
  setViewerText,
  ViewerMountScope,
  type ImageEditor,
} from '@modkitx-x3/ui'
import type { ChangeSet, EditorModule, RasterImageSource, SubjectEditTarget } from '@modkitx-x3/sdk'

/** The same ceiling the read-only image stage applies before it materialises pixels. */
const MAXIMUM_DECODED_BYTES = 64 * 1024 * 1024

export const PNG_SEMANTIC_WARNING =
  'Saving re-encodes the PNG from the current RGBA canvas. Metadata and unknown PNG chunks are removed.'

export interface ImageEditStageOptions {
  /** Reopen the tab after commit so every view reads the new revision. */
  readonly onCommitted?: (descriptor: Record<string, unknown>) => Promise<boolean>
}

/** The exact semantic payload the PNG encoder writer accepts. */
export function pngPixelChange(
  pixels: ImageData,
  targets: readonly SubjectEditTarget[],
): ChangeSet {
  const target = targets[0]
  if (target === undefined) throw new TypeError('this PNG publishes no editable source target')
  const expectedBytes = pixels.width * pixels.height * 4
  if (!Number.isSafeInteger(expectedBytes) || pixels.data.byteLength !== expectedBytes) {
    throw new RangeError('RGBA8 pixels do not match their declared dimensions')
  }
  const bytes = new Uint8Array(expectedBytes)
  bytes.set(pixels.data)
  return {
    targets,
    edits: [
      {
        operation: 'replace',
        targetId: target.targetId,
        source: target.ownerSource,
        payload: { kind: 'inline', bytes },
      },
    ],
    semanticIntent: { width: pixels.width, height: pixels.height },
    provenance: { actor: 'user', note: 'Electron PNG pixel editor' },
  }
}

/** Decode the codec's raster source to pixels, preferring its own decoded access. */
async function loadPixels(
  source: RasterImageSource,
  container: HTMLElement,
  signal?: AbortSignal,
): Promise<ImageData> {
  const info = await source.info(signal)
  const decodedBytes = info.width * info.height * 4
  if (
    info.decodedAccess &&
    source.readRegion !== undefined &&
    Number.isSafeInteger(decodedBytes) &&
    decodedBytes <= MAXIMUM_DECODED_BYTES
  ) {
    const region = await source.readRegion(
      {
        x: 0,
        y: 0,
        width: info.width,
        height: info.height,
        frame: 0,
        mipLevel: 0,
        layer: 0,
        face: 0,
        slice: 0,
        pixelFormat: 'rgba8',
        maxBytes: MAXIMUM_DECODED_BYTES,
      },
      signal,
    )
    const pixels = new Uint8ClampedArray(region.pixels.byteLength)
    pixels.set(region.pixels)
    return new ImageData(pixels, region.width, region.height)
  }

  const encoded = await source.encoded(signal)
  const media = await encoded.descriptor()
  if (media.bytes > BigInt(MAXIMUM_DECODED_BYTES)) {
    throw new RangeError(`encoded image exceeds the editing budget: ${media.bytes} bytes`)
  }
  const total = Number(media.bytes)
  const bytes = new Uint8Array(total)
  let offset = 0
  while (offset < total) {
    const chunk = await encoded.read(BigInt(offset), Math.min(1024 * 1024, total - offset), signal)
    if (chunk.byteLength === 0 || chunk.byteLength > total - offset) {
      throw new RangeError('encoded image ended outside its declared size')
    }
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: media.mediaType }))
  try {
    const canvas = container.ownerDocument.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new TypeError('2d canvas context is unavailable')
    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

export function createImageEditStage(options: ImageEditStageOptions = {}): EditorModule {
  return defineEditorModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, 'Image editor')
      const stage = element(root, 'div', { part: 'image' })
      const readout = element(stage, 'output', { part: 'image.readout' })
      const warning = element(stage, 'p', {
        part: 'imageedit.warning',
        text: PNG_SEMANTIC_WARNING,
      })
      warning.setAttribute('role', 'note')
      const canvas = element(stage, 'canvas', { part: 'image.canvas' }) as HTMLCanvasElement
      canvas.tabIndex = 0

      const lease = await args.sources.getUnknown({
        bindingId: 'content',
        contract: 'common.view/raster-image-source',
        major: 1,
      } as never)
      if (lease === undefined) throw new TypeError('image binding is unavailable')
      scope.lease(lease)

      setState(stage, ['loading'])
      try {
        const pixels = await loadPixels(lease.value as RasterImageSource, stage, scope.signal)
        canvas.width = pixels.width
        canvas.height = pixels.height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (context === null) throw new TypeError('2d canvas context is unavailable')

        const paint = (current: ImageData): void => {
          if (canvas.width !== current.width) canvas.width = current.width
          if (canvas.height !== current.height) canvas.height = current.height
          context.putImageData(current, 0, 0)
        }

        const commitPixels = async (current: ImageData): Promise<void> => {
          setState(stage, ['loading'])
          setViewerText(readout, 'Validating RGBA8 pixels…')
          try {
            const change = pngPixelChange(current, args.edit.targets)
            const validation = await args.edit.propose(change)
            if (!validation.valid) {
              setState(stage, ['error'])
              setViewerText(
                readout,
                validation.diagnostics[0]?.message ?? 'The PNG writer rejected these pixels.',
              )
              return
            }
            setViewerText(readout, 'Planning the semantic PNG rewrite…')
            const plan = await args.edit.plan(change)
            if (
              plan.fidelity.roundTrip !== 'semantic' ||
              plan.fidelity.preservesUnknownData !== false
            ) {
              throw new TypeError(
                'the PNG writer did not return the required semantic fidelity claim',
              )
            }
            setViewerText(readout, 'Authorizing the PNG rewrite…')
            const authorization = await args.authorization.request(plan, { signal: scope.signal })
            if (authorization === undefined) {
              setState(stage, [])
              setViewerText(readout, 'Save cancelled.')
              return
            }
            setViewerText(readout, 'Preparing the PNG rewrite…')
            const prepared = await args.commit.prepare(plan, {
              grant: authorization.grant,
              ...(authorization.confirmationToken === undefined
                ? {}
                : { confirmationToken: authorization.confirmationToken }),
              signal: scope.signal,
            })
            if (prepared.state !== 'ready') {
              setState(stage, ['error'])
              setViewerText(
                readout,
                prepared.state === 'conflict'
                  ? 'Not saved: the PNG changed on disk.'
                  : `Not saved: ${prepared.reason}.`,
              )
              return
            }
            setViewerText(readout, 'Encoding and committing PNG bytes…')
            const committed = await args.commit.commit(prepared.prepared, {
              grant: authorization.grant,
              signal: scope.signal,
            })
            if (committed.state !== 'committed') {
              setState(stage, ['error'])
              setViewerText(
                readout,
                committed.state === 'not-applied'
                  ? `Not saved: ${committed.reason}.`
                  : `Save ended in state ${committed.state}.`,
              )
              return
            }
            setState(stage, [])
            setViewerText(readout, 'Saved. Reopening the PNG at its new revision…')
            /*
             * Closing this very stage while its Apply listener is still on the stack can leave
             * the explorer waiting for the listener whose DOM it is unmounting. Start the reopen
             * in the next microtask and let this commit callback finish first. The shell still
             * owns and observes the asynchronous reopen; a failure remains visible if this stage
             * is connected long enough to report it.
             */
            queueMicrotask(() => {
              void options
                .onCommitted?.(args.descriptor as unknown as Record<string, unknown>)
                .then(reopened => {
                  if (reopened === false && readout.isConnected) {
                    setViewerText(readout, 'Saved. Reopen the tab to see the new revision.')
                  }
                })
                .catch(error => {
                  if (readout.isConnected) {
                    setState(stage, ['error'])
                    setViewerText(
                      readout,
                      `Saved, but reopening failed: ${error instanceof Error ? error.message : String(error)}`,
                    )
                  }
                })
            })
          } catch (error) {
            setState(stage, ['error'])
            setViewerText(readout, error instanceof Error ? error.message : String(error))
          }
        }

        const surface: ImageEditor = createImageEditor(stage, {
          source: pixels,
          onChange: current => {
            paint(current)
            setState(stage, ['mutating'])
            setViewerText(readout, `${current.width}x${current.height} · edited pixels not saved`)
          },
          onCommit: commitPixels,
        })
        scope.cleanup(() => surface.destroy())
        paint(surface.pixels)
        surface.attach(canvas, scope.signal)
        setState(stage, [])
        setViewerText(readout, `${pixels.width}x${pixels.height} · ready to edit`)
      } catch (error) {
        setState(stage, ['error'])
        canvas.remove()
        element(stage, 'p', {
          part: 'viewer.empty',
          text: `These bytes cannot be opened for editing: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      }

      return {
        async update() {
          // A committed change reopens the tab; an in-place descriptor update must not discard a
          // working pixel buffer.
          setViewerText(readout, 'Source updated; review the pixel buffer before saving.')
        },
        async unmount() {
          await scope.close()
          await args.edit.dispose()
          root.remove()
        },
      }
    },
  })
}

export const imageEditStage: EditorModule = createImageEditStage()
