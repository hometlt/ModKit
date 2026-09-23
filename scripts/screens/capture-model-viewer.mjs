/**
 * Screenshot the model viewer, headless, on a real model.
 *
 *   node scripts/screens/capture-model-viewer.mjs <model file> <out.png> [--width N] [--height N]
 *
 * The model is opened in Node through the ordinary host — the same inventory, codec selection and
 * subject-bound raster port the products use — and everything it publishes is written to a payload:
 * scene info, meshes, nodes, decoded primitives, every model facet page, and each texture decoded
 * to RGBA through the raster port. Headless Chromium then mounts the real `@modkit/ui` model viewer
 * over that payload with the shipped WebGL renderer and the page is captured.
 *
 * Nothing about the viewer is stubbed: the panel, the controls and the frame are the product's. The
 * seam is the transport — a codec cannot run in this page, so the bytes it produced are carried
 * across instead. That makes this a picture of the viewer, not a proof that a codec works in a
 * browser; `packages/ui/test/browser-e2e.test.ts` is where the browser host itself is exercised.
 */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { localExtensionRoots } from './extension-roots.mjs'

const argv = process.argv.slice(2)
const [modelArgument, outArgument] = argv
if (modelArgument === undefined || outArgument === undefined)
  throw new Error('usage: capture-model-viewer.mjs <model file> <out.png> [--width N] [--height N]')
const numeric = (flag, fallback) => {
  const at = argv.indexOf(flag)
  return at < 0 ? fallback : Number(argv[at + 1])
}
const width = numeric('--width', 1600)
const height = numeric('--height', 1000)
const modelPath = resolve(modelArgument)
const outPath = resolve(outArgument)
if (!existsSync(modelPath)) throw new Error(`no such model: ${modelPath}`)
const coreRoot = resolve(import.meta.dirname, '..', '..')

// ------------------------------------------------------------------ node: open the real subject

const hostModule = await import(pathToFileURL(`${coreRoot}/packages/host/dist/index.js`).href)
const nodeModule = await import(pathToFileURL(`${coreRoot}/packages/host/dist/node/index.js`).href)
const {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createSubjectServices,
  resolveContentAssetOrigins,
} = hostModule
const { createPathSubjectOpener, loadExtensionDirectory } = nodeModule

const budget = {
  maxInputBytes: 400_000_000n,
  maxDepth: 64,
  maxNodes: 400_000,
  maxScalarBytes: 400_000_000,
  maxDiagnostics: 200,
}
const MODEL_FACETS = [
  'common.view/model-resource-refs-source',
  'common.view/model-skeleton-source',
  'common.view/model-animation-source',
  'common.view/model-collision-source',
  'common.view/model-material-source',
  'common.view/model-socket-source',
  'common.view/model-effect-source',
  'common.view/model-light-source',
  'common.view/model-camera-source',
  'common.view/model-physics-source',
  'common.view/model-node-behaviour-source',
]
const FACET_METHOD = {
  'common.view/model-resource-refs-source': 'references',
  'common.view/model-skeleton-source': 'bindings',
  'common.view/model-animation-source': 'clips',
  'common.view/model-collision-source': 'volumes',
  'common.view/model-material-source': 'materials',
  'common.view/model-socket-source': 'sockets',
  'common.view/model-effect-source': 'effects',
  'common.view/model-light-source': 'lights',
  'common.view/model-camera-source': 'cameras',
  'common.view/model-physics-source': 'bodies',
  'common.view/model-node-behaviour-source': 'behaviours',
}

/** Typed arrays do not survive JSON; they are carried as base64 and rebuilt in the page. */
const TYPED = {
  Float32Array,
  Float64Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
}
const encode = value => {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const name = value.constructor.name
    if (!(name in TYPED)) throw new TypeError(`unsupported typed array ${name}`)
    return {
      $typed: name,
      b64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'),
    }
  }
  if (Array.isArray(value)) return value.map(encode)
  if (typeof value === 'bigint') return { $bigint: value.toString() }
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]))
}

// The core extensions too: a DDS beside an M3 is decoded by `modkit/images`, not by a game's codec.
const { readdir } = await import('node:fs/promises')
const bundledRoots = (await readdir(`${coreRoot}/extensions`, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => `${coreRoot}/extensions/${entry.name}`)
const extensions = await Promise.all(
  [...bundledRoots, ...localExtensionRoots(coreRoot)].map(async root => ({
    ...(await loadExtensionDirectory(root)),
    execution: { origin: 'installed', allowTrustedInProcess: true },
  })),
)
const inventory = await buildInventory(extensions, createHostContributionContractRegistry())
const services = createSubjectServices({
  inventory,
  target: { environment: 'node', operatingSystem: process.platform, architecture: process.arch },
  executionBackends: createExecutionBackendRegistry([
    {
      profile: 'trusted-in-process',
      supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
      async activate(context) {
        return { module: await import(context.entrypoint.href), release: async () => undefined }
      },
    },
  ]),
})
/*
 * `--content-sources <config.json>` loads the product's own source catalogue and asks it where this
 * subject's resources live — the mod it belongs to, what that mod depends on, and the content the
 * game loads whatever is open.
 *
 * This is the product's decision expressed through the machinery the product already has, rather
 * than a list of packages typed on a command line. A loose model opens over the game's base mods; a
 * model inside a mod picks up that mod's declared closure.
 */
const assetOrigins = []
let contentSources
const configAt = argv.indexOf('--content-sources')
if (configAt >= 0) {
  const { loadContentSources } = await import(
    pathToFileURL(`${coreRoot}/packages/vfs/dist/content-sources-node.js`).href
  )
  contentSources = await loadContentSources(
    resolve(argv[configAt + 1] ?? ''),
    `${coreRoot}/artifacts/model-screens/.content-source-state`,
  )
  if (contentSources === undefined) throw new Error('no content source module was configured')
  const projected = await resolveContentAssetOrigins({
    contentSources,
    subjects: [{ descriptor: { subjectUri: pathToFileURL(modelPath).href } }],
  })
  for (const item of projected.diagnostics)
    console.log(`[sources] ${item.severity}: ${item.message}`)
  assetOrigins.push(...projected.origins)
  console.log(`mounted ${assetOrigins.length} asset origin(s) from ${argv[configAt + 1]}`)
}

const opener = createPathSubjectOpener({
  subjects: services,
  roots: [dirname(modelPath)],
  grant: { id: 'capture-model-viewer', classes: ['read-source'] },
  budget,
  ...(assetOrigins.length === 0 ? {} : { assetOrigins }),
})
const answer = await opener(modelPath)
if (answer.snapshot.state !== 'opened' || answer.session === undefined)
  throw new Error(`the model did not open: ${JSON.stringify(answer.snapshot).slice(0, 600)}`)
const session = answer.session

const page = async (source, method) => {
  const items = []
  let cursor
  for (;;) {
    const answer = await source[method]({ limit: 256, ...(cursor ? { cursor } : {}) })
    items.push(...answer.items)
    cursor = answer.nextCursor
    if (cursor === undefined || items.length > 20_000) break
  }
  return items
}

const sceneLease = await session.dataSource('common.view/model-scene-source', 1)
const scene = sceneLease.value
const info = await scene.info()
const meshes = await page(scene, 'meshes')
const nodes = await page(scene, 'nodes')
const primitiveIds = [...new Set(meshes.flatMap(mesh => mesh.primitiveIds))]
const primitives = []
for (const id of primitiveIds)
  primitives.push(await scene.primitive(id, { maxBytes: 64 * 1024 * 1024 }))

const facets = {}
for (const contract of MODEL_FACETS) {
  let lease
  try {
    lease = await session.dataSource(contract, 1)
  } catch {
    continue
  }
  const source = lease.value
  const method = FACET_METHOD[contract]
  facets[contract] =
    typeof source[method] === 'function'
      ? { info: await source.info(), items: await page(source, method) }
      : { info: await source.info(), items: [] }
  await lease.release()
}

// Textures through the subject's own raster port, which is where the codec's search rule applies.
const textures = []
for (const reference of facets['common.view/model-resource-refs-source']?.items ?? []) {
  if (reference.role !== 'texture' || answer.rasterResources === undefined) continue
  const result = await answer.rasterResources.read({
    kind: 'logical',
    requirement: {
      id: `capture-${textures.length}`,
      logicalId: reference.id,
      role: 'texture',
      scopes: [
        'sibling-directory',
        'workspace-dependency-layer',
        'current-mount',
        'enclosing-container',
      ],
    },
    maxBytes: 64 * 1024 * 1024,
    selection: { face: 'all' },
  })
  if (result.state !== 'decoded' && result.state !== 'decoded-surfaces') continue
  const region = result.state === 'decoded' ? result.region : result.surfaces[0].region
  const rgba = new Uint8Array(result.info.width * result.info.height * 4)
  for (let row = 0; row < result.info.height; row += 1)
    rgba.set(
      region.pixels.subarray(
        row * region.rowStride,
        row * region.rowStride + result.info.width * 4,
      ),
      row * result.info.width * 4,
    )
  textures.push({
    referenceId: reference.id,
    id: `capture-texture-${textures.length}`,
    width: result.info.width,
    height: result.info.height,
    rgba,
  })
}

const payload = encode({
  name: modelPath.split(/[\\/]/u).at(-1),
  info,
  meshes,
  nodes,
  primitives,
  facets,
  textures,
})
await sceneLease.release()
await session.dispose()
await contentSources?.dispose?.()
console.log(
  `opened ${payload.name}: ${primitives.length} primitives, ${textures.length}/${facets['common.view/model-resource-refs-source']?.items.filter(item => item.role === 'texture').length ?? 0} textures, facets ${Object.keys(facets).length}`,
)

// ------------------------------------------------------- browser: the real viewer over that payload

const bundled = await build({
  stdin: {
    contents: `
      import * as ui from '@modkit/ui';
      import * as sceneRenderer from '@modkit/scene/render/browser';
      globalThis.modkit = { ui, sceneRenderer };
    `,
    resolveDir: coreRoot,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  write: false,
  logLevel: 'silent',
})
const appBundle = bundled.outputFiles[0]?.contents
if (appBundle === undefined) throw new Error('viewer bundle was not emitted')
const { readFile } = await import('node:fs/promises')
const stylesheet = await readFile(`${coreRoot}/packages/ui/styles/modkit-ui.css`)
const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8')
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Modkit model viewer</title><link rel="stylesheet" href="/modkit-ui.css">
<style>html,body{margin:0;height:100%;background:#1e1e1e}#app{height:100vh}</style>
</head><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>`
const server = createServer((request, response) => {
  if (request.url === '/app.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    response.end(appBundle)
  } else if (request.url === '/modkit-ui.css') {
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
    response.end(stylesheet)
  } else if (request.url === '/payload.json') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(payloadBytes)
  } else {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  }
})
await new Promise((done, fail) => {
  server.once('error', fail)
  server.listen(0, '127.0.0.1', done)
})
const origin = `http://127.0.0.1:${server.address().port}`

const chromeCandidates = [
  process.env['CHROME_PATH'],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(candidate => candidate !== undefined)
const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
if (executablePath === undefined) throw new Error('Chrome or Chromium is required')
const browser = await chromium.launch({
  executablePath,
  headless: true,
  // The shipped renderer is WebGL2; headless Chromium needs to be told to give it a real one.
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
})
const tab = await browser.newPage({
  viewport: { width, height },
  reducedMotion: 'reduce',
  colorScheme: 'dark',
  deviceScaleFactor: 2,
})
tab.on('console', message => {
  if (message.type() === 'error') console.log(`[page] ${message.text()}`)
})
await tab.goto(origin)

const mounted = await tab.evaluate(async () => {
  const TYPED = {
    Float32Array,
    Float64Array,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
  }
  const decode = value => {
    if (Array.isArray(value)) return value.map(decode)
    if (value === null || typeof value !== 'object') return value
    if ('$bigint' in value) return BigInt(value.$bigint)
    if ('$typed' in value) {
      const binary = Uint8Array.from(atob(value.b64), character => character.charCodeAt(0))
      return new TYPED[value.$typed](
        binary.buffer,
        binary.byteOffset,
        binary.byteLength / TYPED[value.$typed].BYTES_PER_ELEMENT,
      )
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]))
  }
  const model = decode(await (await fetch('/payload.json')).json())
  const ui = globalThis.modkit.ui
  const FACET_METHOD = {
    'common.view/model-resource-refs-source': 'references',
    'common.view/model-skeleton-source': 'bindings',
    'common.view/model-animation-source': 'clips',
    'common.view/model-collision-source': 'volumes',
    'common.view/model-material-source': 'materials',
    'common.view/model-socket-source': 'sockets',
    'common.view/model-effect-source': 'effects',
    'common.view/model-light-source': 'lights',
    'common.view/model-camera-source': 'cameras',
    'common.view/model-physics-source': 'bodies',
    'common.view/model-node-behaviour-source': 'behaviours',
  }
  const paged = items => ({ items })
  const sources = {
    'common.view/model-scene-source': {
      async info() {
        return model.info
      },
      async meshes() {
        return paged(model.meshes)
      },
      async nodes() {
        return paged(model.nodes)
      },
      async primitive(id) {
        const found = model.primitives.find(item => item.id === id)
        if (found === undefined) throw new Error(`no primitive ${id}`)
        return found
      },
    },
  }
  for (const [contract, facet] of Object.entries(model.facets)) {
    sources[contract] = {
      async info() {
        return facet.info
      },
      [FACET_METHOD[contract]]: async () => paged(facet.items),
    }
  }
  const renderer = {
    async acquire(request) {
      const provider = globalThis.modkit.sceneRenderer.createProvider({
        contract: 'common.render/scene-3d',
        major: request.outputKind === 'rgba8' ? 1 : 0,
      })
      return {
        state: 'resolved',
        diagnostics: [],
        lease: { renderer: provider.value, release: async () => undefined },
      }
    },
  }
  const mount = await ui
    .createModelViewer({
      renderer,
      async textures() {
        return new Map(
          model.textures.map(texture => [
            texture.referenceId,
            { id: texture.id, width: texture.width, height: texture.height, rgba: texture.rgba },
          ]),
        )
      },
    })
    .mount({
      container: document.querySelector('#app'),
      descriptor: { revision: 'content-hash.sha256:capture', operations: [], diagnostics: [] },
      slot: {
        slotId: 'model',
        kind: 'stage',
        contributionId: 'modkit.ui/model-stage',
        extensionId: 'modkit/ui',
        priority: 100,
        bindings: Object.keys(sources).map(contract => ({
          bindingId: contract,
          contract,
          major: 1,
        })),
      },
      sources: {
        async get(binding) {
          return { value: sources[binding.contract], release: async () => undefined }
        },
      },
      operations: { dispose: async () => undefined },
    })
  globalThis.__capture = { mount }
  return {
    sections: [...document.querySelectorAll('[data-mk-part="media-shell.section-title"]')].map(
      node => node.textContent,
    ),
    canvas: document
      .querySelector('[data-mk-part="model.canvas"]')
      ?.getAttribute('data-model-renderer'),
  }
})

/*
 * Optional staging, so a capture can show what a reader would open rather than the default panel:
 * `--expand bones,particles` opens those sections, `--no-skeleton` turns the bone overlay off.
 */
const expandAt = argv.indexOf('--expand')
const expand = expandAt < 0 ? [] : (argv[expandAt + 1] ?? '').split(',').filter(Boolean)
if (expand.length > 0 || argv.includes('--no-skeleton'))
  await tab.evaluate(
    staging => {
      if (staging.hideSkeleton) {
        const toggle = [...document.querySelectorAll('[data-mk-part="operations.button"]')].find(
          node => node.getAttribute('aria-pressed') === 'true',
        )
        toggle?.click()
      }
      for (const id of staging.expand) {
        const section = document.querySelector(`[data-section-id="${id}"]`)
        const header = section?.querySelector('[data-mk-part="media-shell.section-header"]')
        if (header?.getAttribute('aria-expanded') === 'false') header.click()
        // A record is a <details> of its own fields; opening the section alone shows only names.
        for (const record of section?.querySelectorAll('[data-mk-part="model.facet-item"]') ?? [])
          record.open = true
      }
    },
    { expand, hideSkeleton: argv.includes('--no-skeleton') },
  )

// The first frame is asynchronous; wait for pixels rather than for the attribute alone.
await tab
  .waitForFunction(
    () => {
      const canvas = document.querySelector('[data-mk-part="model.canvas"]')
      if (canvas === null || canvas.width === 0) return false
      const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
      if (pixels === undefined) return false
      for (let offset = 3; offset < pixels.length; offset += 4)
        if (pixels[offset] !== 0) return true
      return false
    },
    { timeout: 20_000 },
  )
  .catch(() => console.log('no opaque pixels arrived; capturing whatever is on screen'))

const evidence = await tab.evaluate(() => {
  const canvas = document.querySelector('[data-mk-part="model.canvas"]')
  const box = canvas?.getBoundingClientRect()
  const round = value => Math.round(value * 1000) / 1000
  return {
    // A canvas whose backing store is not the shape of its CSS box is drawn stretched, and the
    // amount depends on the panel size — so both aspects are reported, never one of them.
    backing: canvas === null ? null : `${canvas.width}x${canvas.height}`,
    css: box === undefined ? null : `${Math.round(box.width)}x${Math.round(box.height)}`,
    stretch:
      box === undefined || canvas === null || box.height === 0 || canvas.height === 0
        ? null
        : round(box.width / box.height / (canvas.width / canvas.height)),
    renderer: canvas?.getAttribute('data-model-renderer'),
    status: canvas?.getAttribute('data-model-renderer-status'),
    textures: canvas?.getAttribute('data-model-textures'),
    skeleton: canvas?.getAttribute('data-model-skeleton'),
    readout: document.querySelector('[data-mk-part="model.readout"]')?.textContent,
  }
})
await mkdir(dirname(outPath), { recursive: true })
await tab.screenshot({ path: outPath, fullPage: false })
console.log(`sections: ${mounted.sections.join(' · ')}`)
console.log(`evidence: ${JSON.stringify(evidence)}`)
console.log(`wrote ${outPath}`)
await browser.close()
await new Promise(done => server.close(done))
