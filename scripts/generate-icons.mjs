/**
 * Rasterise the brand artwork into every application's icon set.
 *
 *   node scripts/generate-icons.mjs            write
 *   node scripts/generate-icons.mjs --check    verify current (CI)
 *
 * `assets/brand/modkit.png` is the authority — the same 1024px artwork MK2 ships — and everything
 * here is derived, so a change to it reaches Electron, the PWA, the gallery and the VS Code
 * extension in one step.
 *
 * Resampling runs in the Chromium that already ships for the browser conformance tests rather than
 * through a new image dependency: no native module enters the repo, and the icon is resized by the
 * same engine that will display it. Output is deterministic, which is what lets `--check` act as a
 * drift gate instead of a rebuild.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
const SOURCE = join(root, 'assets', 'brand', 'modkit.png')

const chromeCandidates = [
  process.env['CHROME_PATH'],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(value => value !== undefined)

/**
 * Targets, grouped by what consumes them.
 *
 * Sizes are not arbitrary: 16/32/48/256 are the entries Windows expects inside an `.ico`, 192/512
 * are what a web app manifest must declare to be installable, and 128 is the VS Code marketplace
 * icon size.
 */
const PNG_TARGETS = [
  // Progressive web app — plain and maskable, as the manifest declares both purposes.
  { size: 192, maskable: false, out: 'apps/web/public/icon-192.png' },
  { size: 512, maskable: false, out: 'apps/web/public/icon-512.png' },
  { size: 192, maskable: true, out: 'apps/web/public/icon-maskable-192.png' },
  { size: 512, maskable: true, out: 'apps/web/public/icon-maskable-512.png' },
  // Electron window and taskbar.
  { size: 256, maskable: false, out: 'apps/electron/media/icon-256.png' },
  { size: 512, maskable: false, out: 'apps/electron/media/icon-512.png' },
  // VS Code marketplace.
  { size: 128, maskable: false, out: 'apps/modkit-vscode/media/icon-128.png' },
  // Website and gallery favicons.
  { size: 32, maskable: false, out: 'apps/web/public/favicon-32.png' },
  { size: 180, maskable: false, out: 'apps/web/public/apple-touch-icon.png' },
]

/** Windows executables and file associations read the multi-size `.ico`. */
const ICO_SIZES = [16, 32, 48, 256]
const ICO_OUT = 'apps/electron/media/modkit.ico'

/**
 * Pack PNGs into an ICO container.
 *
 * PNG-compressed entries are legal since Vista and keep the file small; the 256px entry *must* be
 * PNG because the directory records size in one byte and stores 256 as 0.
 */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(16 * images.length)
  let offset = header.length + directory.length
  images.forEach((image, index) => {
    const at = index * 16
    directory[at] = image.size >= 256 ? 0 : image.size
    directory[at + 1] = image.size >= 256 ? 0 : image.size
    directory[at + 2] = 0 // palette entries
    directory[at + 3] = 0 // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(image.bytes.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += image.bytes.length
  })

  return Buffer.concat([header, directory, ...images.map(image => image.bytes)])
}

// ---------------------------------------------------------------- render
if (!existsSync(SOURCE)) {
  console.error(`missing brand artwork: ${relative(root, SOURCE)}`)
  process.exit(1)
}
const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
if (executablePath === undefined) {
  console.error('Chrome or Edge is required to resample icons; set CHROME_PATH to override.')
  process.exit(1)
}

const sourceDataUri = `data:image/png;base64,${readFileSync(SOURCE).toString('base64')}`
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setContent('<!doctype html><meta charset="utf-8"><canvas id="c"></canvas>')

/**
 * Resample the artwork to one size.
 *
 * A maskable icon is cropped by the launcher to a platform shape with only the centre 80%
 * guaranteed, so the artwork is inset and the margin is filled with the artwork's own corner colour
 * — whatever shape gets cut, it cuts into flat colour rather than into the mark.
 */
async function render(size, maskable) {
  const encoded = await page.evaluate(
    async ([dataUri, target, pad]) => {
      const image = new Image()
      image.src = dataUri
      await image.decode()

      const canvas = document.querySelector('#c')
      canvas.width = target
      canvas.height = target
      const context = canvas.getContext('2d')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'

      if (pad) {
        // Sample the source corner for the ground so the inset margin matches the artwork.
        const probe = document.createElement('canvas')
        probe.width = image.width
        probe.height = image.height
        const probeContext = probe.getContext('2d')
        probeContext.drawImage(image, 0, 0)
        const [r, g, b] = probeContext.getImageData(2, 2, 1, 1).data
        context.fillStyle = `rgb(${r},${g},${b})`
        context.fillRect(0, 0, target, target)
        const inset = Math.round(target * 0.11)
        context.drawImage(image, inset, inset, target - inset * 2, target - inset * 2)
      } else {
        context.drawImage(image, 0, 0, target, target)
      }
      return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length)
    },
    [sourceDataUri, size, maskable],
  )
  return Buffer.from(encoded, 'base64')
}

const problems = []
const written = []

async function emit(relativePath, bytes) {
  const target = join(root, relativePath)
  if (check) {
    if (!existsSync(target)) {
      problems.push(`missing: ${relativePath} — run pnpm icons:emit`)
      return
    }
    if (!readFileSync(target).equals(bytes)) {
      problems.push(`out of date: ${relativePath} — run pnpm icons:emit`)
    }
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes)
  written.push(relative(root, target).replaceAll('\\', '/'))
}

for (const target of PNG_TARGETS) {
  await emit(target.out, await render(target.size, target.maskable))
}

const icoImages = []
for (const size of ICO_SIZES) {
  icoImages.push({ size, bytes: await render(size, false) })
}
await emit(ICO_OUT, buildIco(icoImages))

await browser.close()

if (problems.length > 0) {
  console.error(`\nicon gate FAILED with ${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

if (check) {
  console.log(
    `icon gate passed: ${PNG_TARGETS.length} PNG targets and ${ICO_SIZES.length}-size ICO.`,
  )
} else {
  for (const file of written) console.log(`wrote ${file}`)
  console.log(`\n${written.length} icon files generated from assets/brand/modkit.png`)
}
