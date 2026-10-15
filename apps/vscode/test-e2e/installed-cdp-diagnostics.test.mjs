import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import {
  collectFailureDiagnostics,
  probeFailureTarget,
  redactDiagnosticText,
  webviewDocumentExpression,
  imageDiagnosticDocument,
  displayedDdsRaster,
  readDdsMetadata,
} from './installed-cdp-diagnostics.mjs'

test('empty target list and fetch errors remain distinguishable', async () => {
  assert.deepEqual(
    await collectFailureDiagnostics(1, async () => ({ ok: true, json: async () => [] })),
    {
      status: 'no-webview-targets',
      targetCount: 0,
      targets: [],
    },
  )
  assert.deepEqual(
    await collectFailureDiagnostics(1, async () => {
      throw new Error('secret')
    }),
    { status: 'target-list-unavailable' },
  )
})

test('DDS metadata follows visible sidebar sections, not unrelated filtering/writer selects', () => {
  const win = {
    __MODKIT_ACCEPTANCE__: { subject: { descriptor: { identity: { formatId: 'dds' } } } },
  }
  const read = doc => readDdsMetadata(doc, win)
  const sidebar = { hidden: true }
  const makeSection = values => {
    const body = {
      hidden: true,
      scrollIntoView() {},
      getBoundingClientRect: () => ({ width: 200, height: 80 }),
    }
    const header = {
      getAttribute: () => (body.hidden ? 'false' : 'true'),
      click: () => {
        body.hidden = false
      },
    }
    return {
      querySelector: selector => (selector.includes('section-header') ? header : body),
      querySelectorAll: () =>
        values.map(([label, value]) => ({
          querySelector: tag => ({ textContent: tag === 'dt' ? label : value }),
        })),
    }
  }
  const image = makeSection([
    ['Dimensions', '4 × 4'],
    ['Aspect', '1.000'],
  ])
  const format = makeSection([
    ['Format', 'DirectDraw Surface · DXT1'],
    ['Mip levels', '3'],
    ['Channels', '4 × 8-bit'],
    ['Colour space', 'unknown'],
  ])
  const headerMetadata = makeSection([
    ['width', '4'],
    ['height', '4'],
    ['encoding', 'dxt1'],
  ])
  const doc = {
    querySelector: selector =>
      selector.includes('data-side')
        ? {
            click: () => {
              sidebar.hidden = false
            },
          }
        : selector.includes('section-id="image"')
          ? image
          : selector.includes('section-id="format"')
            ? format
            : selector.includes('section-id="metadata"')
              ? headerMetadata
              : sidebar,
  }
  const evidence = read(doc)
  assert.equal(evidence.surface, 'image-sidebar-metadata')
  assert.equal(evidence.presentation, 'sidebar-sections')
  assert.equal(evidence.image[0].value, '4 × 4')
  assert.equal(sidebar.hidden, false)
  assert.equal(evidence.headerMetadata[0].value, '4')
  assert.equal(
    readDdsMetadata(doc, {
      __MODKIT_ACCEPTANCE__: { subject: { descriptor: { identity: { formatId: 'png' } } } },
    }),
    undefined,
  )
  const absent = { querySelector: () => null }
  assert.equal(read(absent), undefined)
  const wrong = makeSection([
    ['Format', 'PNG'],
    ['Mip levels', '1'],
    ['Channels', '4 × 8-bit'],
  ])
  const original = doc.querySelector
  doc.querySelector = selector =>
    selector.includes('section-id="format"') ? wrong : original(selector)
  assert.equal(read(doc), undefined)
  doc.querySelector = original
  const emptyHeader = makeSection([])
  doc.querySelector = selector =>
    selector.includes('section-id="metadata"') ? emptyHeader : original(selector)
  assert.equal(read(doc), undefined, 'empty Header/Metadata must not pass')
  doc.querySelector = original
  image.querySelector('[data-mk-part="media-shell.section-body"]').getBoundingClientRect = () => ({
    width: 0,
    height: 0,
  })
  assert.equal(read(doc), undefined, 'hidden layout must not pass on DOM text alone')
})

test('DDS probe samples native 4x4 exact-red texels from a centered viewport at multiple DPRs; backgrounds cannot pass', () => {
  for (const ratio of [1, 1.5, 2]) {
    let mode = 'image'
    class Canvas {
      width = Math.round(101 * ratio)
      height = Math.round(77 * ratio)
      getContext() {
        return {
          getImageData: (x, y) => {
            const inside =
              x >= Math.round((101 - 4) / 2) * ratio &&
              x < (Math.round((101 - 4) / 2) + 4) * ratio &&
              y >= Math.round((77 - 4) / 2) * ratio &&
              y < (Math.round((77 - 4) / 2) + 4) * ratio
            return {
              data: Uint8Array.from(
                mode === 'all-red' || (mode === 'image' && inside)
                  ? [255, 0, 0, 255]
                  : [120, 120, 120, 255],
              ),
            }
          },
        }
      }
    }
    const canvas = new Canvas()
    const doc = {
      querySelector: selector =>
        selector.includes('image.canvas')
          ? canvas
          : { getBoundingClientRect: () => ({ width: 101, height: 77 }) },
      querySelectorAll: () => [{ textContent: '4 × 4' }],
    }
    const win = { HTMLCanvasElement: Canvas, devicePixelRatio: ratio }
    const result = displayedDdsRaster(doc, win)
    assert.equal(result.pixelBytes, 64)
    assert.equal(result.opaquePixels, 16)
    assert.equal(result.viewportWidth, Math.round(101 * ratio))
    mode = 'checker'
    assert.equal(displayedDdsRaster(doc, win), undefined)
    mode = 'all-red'
    assert.equal(displayedDdsRaster(doc, win), undefined)
    mode = 'image'
    doc.querySelectorAll = () => [{ textContent: '8 × 8' }]
    assert.equal(displayedDdsRaster(doc, win), undefined)
  }
})

test('image diagnostics retain stage, viewport canvas dimensions and read failures without resizing', () => {
  const canvas = {
    width: 800,
    height: 600,
    clientWidth: 400,
    clientHeight: 300,
    getAttribute: () => 'image.canvas',
    getContext: () => ({
      getImageData: () => {
        throw new Error('tainted token=private')
      },
    }),
  }
  const doc = {
    body: { innerText: 'DDS' },
    querySelectorAll: selector =>
      selector === 'canvas'
        ? [canvas]
        : [
            {
              selectedOptions: [{ textContent: 'Image' }],
              options: [{ textContent: 'Image' }, { textContent: 'Metadata' }],
            },
          ],
  }
  const result = imageDiagnosticDocument(doc, {})
  assert.equal(result.selects[0].selected, 'Image')
  assert.equal(result.canvases[0].width, 800)
  assert.equal(result.canvases[0].context, '2d')
  assert.equal(redactDiagnosticText(result.canvases[0].readError), 'tainted token=<redacted>')
  assert.equal(canvas.width, 800)
  canvas.getContext = () => null
  assert.equal(imageDiagnosticDocument(doc, {}).canvases[0].context, 'unavailable')
})

test('shared document traversal observes an iframe receipt and its DDS error, not only top', () => {
  const frame = {
    contentDocument: { body: { innerText: 'DDS error token=private' } },
    contentWindow: {
      __MODKIT_ACCEPTANCE__: { subject: { selected: { contributionId: 'modkit/dds' } } },
    },
  }
  const context = { document: { body: { innerText: 'wrapper' }, querySelectorAll: () => [frame] } }
  const acceptance = runInNewContext(
    webviewDocumentExpression('(doc, win) => win.__MODKIT_ACCEPTANCE__?.subject'),
    context,
  )
  assert.equal(acceptance.selected.contributionId, 'modkit/dds')
  const observations = runInNewContext(
    webviewDocumentExpression(
      '(doc, win) => ({ text: doc.body.innerText, receiptPresent: !!win.__MODKIT_ACCEPTANCE__ })',
      true,
    ),
    context,
  )
  assert.equal(observations.length, 2)
  assert.equal(observations[0].value.receiptPresent, false)
  assert.equal(observations[1].value.receiptPresent, true)
  assert.equal(observations[1].depth, 1)
  assert.equal(observations[1].document, 'iframe')
  assert.equal(redactDiagnosticText(observations[1].value.text), 'DDS error token=<redacted>')
})

test('text is bounded and credentials and URLs are redacted', () => {
  const text = redactDiagnosticText(
    'token=abc password="def ghi" Bearer xyz https://host/path?key=secret ' + 'x'.repeat(3000),
  )
  assert.equal(text.length, 2000)
  for (const secret of ['abc', 'def ghi', 'xyz', 'https://host'])
    assert.equal(text.includes(secret), false)
})

function responseSocket(result) {
  return class {
    handlers = new Map()
    constructor() {
      queueMicrotask(() => this.handlers.get('open')?.())
    }
    addEventListener(name, handler) {
      this.handlers.set(name, handler)
    }
    send(bytes) {
      const request = JSON.parse(bytes)
      const message =
        request.id === 1
          ? {
              method: 'Runtime.executionContextCreated',
              params: { context: { id: 7, auxData: { isDefault: true }, origin: 'secret' } },
            }
          : { id: 2, ...result }
      this.handlers.get('message')?.({ data: JSON.stringify(message) })
    }
    close() {}
  }
}

test('probe records context and distinguishes JS exception, protocol error and empty result', async () => {
  const target = { webSocketDebuggerUrl: 'ws://secret' }
  const exception = await probeFailureTarget(
    target,
    responseSocket({ result: { exceptionDetails: { text: 'password=private' } } }),
  )
  assert.deepEqual(exception, {
    contexts: [{ id: 7, isDefault: true }],
    status: 'exception',
    exception: 'password=<redacted>',
  })
  assert.equal(
    (await probeFailureTarget(target, responseSocket({ error: { code: -1 } }))).status,
    'protocol-error',
  )
  assert.equal((await probeFailureTarget(target, responseSocket({ result: {} }))).status, 'empty')
  assert.equal(
    (
      await probeFailureTarget(
        target,
        class {
          constructor() {
            throw new Error('secret')
          }
        },
      )
    ).status,
    'socket-error',
  )
})

test('target evidence is limited and excludes debugger URLs', async () => {
  const targets = Array.from({ length: 8 }, () => ({
    url: 'vscode-webview://secret?token=x',
    webSocketDebuggerUrl: 'ws://secret',
  }))
  const result = await collectFailureDiagnostics(
    1,
    async () => ({ ok: true, json: async () => targets }),
    async () => ({ status: 'empty' }),
  )
  assert.equal(result.targets.length, 4)
  assert.equal(JSON.stringify(result).includes('secret'), false)
})
