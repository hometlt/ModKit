#!/usr/bin/env node

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { extensionSet } from '../app-extension-sets.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? fallback : process.argv[index + 1]
}

const setName = option('set', process.env['MODKIT_EXTENSION_SET'] ?? 'structured-text')
const portText = option('port', process.env['MODKIT_PWA_PORT'] ?? '4173')
const port = Number(portText)
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`invalid PWA debug port: ${portText}`)
}

console.log(`debug-pwa: starting extension set ${setName}`)

const { loadExtensionDirectory } = await import('../../packages/host/dist/node/index.js')
const extensionInputs = await Promise.all(
  extensionSet(setName).map(directory =>
    loadExtensionDirectory(join(root, 'extensions', 'common', directory)),
  ),
)
const serializableInputs = extensionInputs.map(input => ({
  source: input.source,
  containers: input.containers,
  files: input.files,
  documents: [...input.documents],
  documentDigests: [...input.documentDigests],
  artifact: {
    inventoryRecordId: input.artifact.inventoryRecordId,
    artifactDigest: input.artifact.artifactDigest,
    artifactRoot: input.artifact.artifactRoot.href,
  },
}))

const browserEntry = `
  import { createWebApp, mountWebWorkbench } from './apps/web/src/index.ts';

  const response = await fetch('/debug/extensions.json');
  if (!response.ok) throw new Error('failed to load the debug extension set');
  const payload = await response.json();
  const extensions = payload.extensions.map(input => ({
    ...input,
    documents: new Map(input.documents),
    documentDigests: new Map(input.documentDigests),
    artifact: {
      ...input.artifact,
      artifactRoot: new URL(input.artifact.artifactRoot),
      verifyArtifactDigest: () => true,
    },
  }));
  const app = await createWebApp(
    { operatingSystem: 'linux', architecture: 'x64' },
    extensions,
    {
      main: ['editor.monaco', 'update.service-worker', 'worker.module'],
      worker: [],
      sharedMemory: globalThis.crossOriginIsolated === true,
    },
  );
  const root = document.querySelector('#app');
  if (!(root instanceof HTMLElement)) throw new Error('debug application root is missing');
  const workbench = mountWebWorkbench(document, root, app, 'Modkit X3 PWA · ' + payload.set);
  const details = document.createElement('pre');
  details.dataset.modkitDebug = 'inventory';
  details.textContent = JSON.stringify({
    extensionSet: payload.set,
    main: {
      realm: app.main.profile.realmId,
      extensions: app.main.inventory.extensions.map(extension =>
        extension.manifest.publisher + '/' + extension.manifest.id),
    },
    worker: {
      realm: app.worker.profile.realmId,
      contributions: app.worker.inventory.extensions.flatMap(extension =>
        extension.contributions.map(contribution => contribution.manifest?.id ?? contribution.path)),
    },
  }, null, 2);
  workbench.setMain(details);
  Object.defineProperty(globalThis, 'modkitDebug', {
    configurable: false,
    enumerable: true,
    value: Object.freeze({ app, extensions, extensionSet: payload.set, workbench }),
  });
  if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/service-worker.js');
  document.documentElement.dataset.modkitReady = 'true';
`

const built = await build({
  stdin: {
    contents: browserEntry,
    resolveDir: root,
    loader: 'js',
    sourcefile: 'modkit-pwa-debug-entry.js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  sourcemap: 'inline',
  write: false,
  logLevel: 'silent',
})
const appBundle = built.outputFiles[0]?.contents
if (appBundle === undefined) throw new Error('PWA debug bundle was not emitted')

const manifest = await readFile(join(root, 'apps', 'web', 'public', 'manifest.webmanifest'))
const serviceWorker = await readFile(join(root, 'apps', 'web', 'public', 'service-worker.js'))
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#0078d4">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="stylesheet" href="/debug.css">
    <title>Modkit X3 PWA Debug</title>
  </head>
  <body><div id="app"></div><script type="module" src="/app.js"></script></body>
</html>`
const css = `
  :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #1f1f1f; color: #eee; }
  body { margin: 0; }
  .modkit-workbench { display: grid; grid-template: auto 1fr auto / 3rem 16rem 1fr; min-height: 100vh; }
  [data-mk-part="workbench.titlebar"], [data-mk-part="workbench.statusbar"] { grid-column: 1 / -1; padding: .6rem 1rem; background: #181818; }
  [data-mk-part="workbench.activitybar"] { background: #242424; }
  [data-mk-part="workbench.sidebar"] { background: #202020; }
  [data-mk-part="workbench.main"] { overflow: auto; padding: 1rem; }
  [data-mk-part="workbench.panel"] { display: none; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
`

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  const send = (status, type, body, cache = 'no-store') => {
    response.writeHead(status, {
      'cache-control': cache,
      'content-security-policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'",
      'content-type': type,
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'x-content-type-options': 'nosniff',
    })
    response.end(body)
  }
  switch (url.pathname) {
    case '/':
    case '/index.html':
      send(200, 'text/html; charset=utf-8', html)
      break
    case '/app.js':
      send(200, 'text/javascript; charset=utf-8', appBundle)
      break
    case '/debug.css':
      send(200, 'text/css; charset=utf-8', css)
      break
    case '/debug/extensions.json':
      send(
        200,
        'application/json; charset=utf-8',
        JSON.stringify({ set: setName, extensions: serializableInputs }),
      )
      break
    case '/manifest.webmanifest':
      send(200, 'application/manifest+json; charset=utf-8', manifest)
      break
    case '/service-worker.js':
      send(200, 'text/javascript; charset=utf-8', serviceWorker, 'no-cache')
      break
    default:
      send(404, 'text/plain; charset=utf-8', 'Not found')
  }
})

server.on('error', error => {
  console.error(`debug-pwa: ${error.message}`)
  process.exitCode = 1
})
server.listen(port, '127.0.0.1', () => {
  console.log(`debug-pwa: ready http://127.0.0.1:${port}/ set=${setName}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)))
}
