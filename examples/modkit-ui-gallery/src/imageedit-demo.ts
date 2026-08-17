/**
 * Image editing demo.
 *
 * The editor owns pixels and history, never a codec, so the demo generates its own test texture: a
 * gradient with a distinct alpha wedge, which makes a channel-isolated write visible at a glance
 * (paint with `A` isolated and only the wedge moves).
 */
import { createImageEditor, type ImageChannel } from '@modkitx-x3/ui'

const CHANNELS: readonly ImageChannel[] = ['rgb', 'r', 'g', 'b', 'a']

function testTexture(width: number, height: number): ImageData {
  const pixels = new ImageData(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      pixels.data[offset] = Math.round((x / (width - 1)) * 255)
      pixels.data[offset + 1] = Math.round((y / (height - 1)) * 255)
      pixels.data[offset + 2] = 128
      // A diagonal alpha wedge: transparent bottom-left, opaque top-right.
      pixels.data[offset + 3] = Math.round(
        Math.min(255, ((x + (height - y)) / (width + height)) * 340),
      )
    }
  }
  return pixels
}

export function mountImageEditDemo(
  canvas: HTMLCanvasElement,
  panel: HTMLElement,
  log: (line: string) => void,
): void {
  const context = canvas.getContext('2d')
  if (context === null) throw new TypeError('2d canvas context is unavailable')

  const source = testTexture(canvas.width, canvas.height)

  const present = (pixels: ImageData): void => {
    if (pixels.width !== canvas.width || pixels.height !== canvas.height) {
      // A crop changes the buffer's size; the canvas has to follow or the image would be scaled.
      canvas.width = pixels.width
      canvas.height = pixels.height
    }
    context.putImageData(pixels, 0, 0)
  }

  const editor = createImageEditor(panel, {
    source,
    onChange: pixels => {
      present(pixels)
    },
    onCommit: pixels => {
      log(`commit requested: ${pixels.width}×${pixels.height}, ${pixels.data.length} bytes`)
    },
  })

  // The channel selector lives with the viewer in a real host; the demo adds one so the
  // single-byte write path is reachable without a codec.
  const channels = document.createElement('div')
  channels.className = 'filter'
  for (const channel of CHANNELS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = channel.toUpperCase()
    button.title = channel === 'rgb' ? 'Composite normally' : `Write only the ${channel} byte`
    button.addEventListener('click', () => {
      editor.channel = channel
      for (const node of channels.querySelectorAll('button')) {
        node.setAttribute('aria-pressed', String(node === button))
      }
      log(`channel: ${channel}`)
    })
    button.setAttribute('aria-pressed', String(channel === 'rgb'))
    channels.append(button)
  }
  panel.prepend(channels)

  editor.attach(canvas)
  present(editor.pixels)
  log(`texture ready: ${source.width}×${source.height}`)
}
