import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import {
  collectFailureDiagnostics,
  probeFailureTarget,
  redactDiagnosticText,
  webviewDocumentExpression,
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
