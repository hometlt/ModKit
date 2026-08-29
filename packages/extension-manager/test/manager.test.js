import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createBrowserExtensionVfs } from '../src/browser.js'
import {
  createNodeExtensionVfs,
  discoverNodeExtensionRoots,
  extensionLockDocument,
} from '../src/node.js'

const json = value => new TextEncoder().encode(JSON.stringify(value))
const base64 = value => Buffer.from(value).toString('base64')

const portableRepository = (publisher, id) =>
  json({
    schemaVersion: 1,
    extensions: [
      {
        id: `${publisher}/${id}`,
        files: {
          'package.json': base64(
            JSON.stringify({
              name: id,
              version: '1.0.0',
              modkit: {
                schemaVersion: 1,
                publisher,
                id,
                contributionManifests: [],
              },
            }),
          ),
        },
      },
    ],
  })

test('CLI help is inert and documents roots and lock commands', () => {
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, '..', 'src', 'cli.js'), '-h'],
    {
      encoding: 'utf8',
    },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage: modkit-extensions/u)
  assert.match(result.stdout, /roots/u)
  assert.match(result.stdout, /lock/u)
})

test('Browser entry exposes only browser-compatible VFS protocols', async () => {
  const created = createBrowserExtensionVfs()
  try {
    assert.deepEqual(created.protocols, ['browser-file', 'http', 'https', 'memory'])
  } finally {
    await created.vfs.dispose()
  }
})

test('Node entry exposes every VFS protocol available to the manager', async () => {
  const created = createNodeExtensionVfs()
  try {
    assert.deepEqual(created.protocols, [
      'browser-file',
      'file',
      'http',
      'https',
      'memory',
      'rapid+file',
    ])
  } finally {
    await created.vfs.dispose()
  }
})

test('discovers a local repository without copying its extension', async () => {
  const root = await mkdtemp(join(tmpdir(), 'modkit-extension-manager-file-'))
  const repository = join(root, 'vendor')
  const extension = join(repository, 'demo')
  await mkdir(extension, { recursive: true })
  await writeFile(
    join(repository, 'modkit.repository.json'),
    JSON.stringify({
      schemaVersion: 1,
      extensions: [{ id: 'example.vendor/demo', path: 'demo' }],
    }),
  )
  await writeFile(
    join(extension, 'package.json'),
    JSON.stringify({
      name: 'demo',
      version: '1.2.3',
      modkit: {
        schemaVersion: 1,
        publisher: 'example.vendor',
        id: 'demo',
        contributionManifests: [],
      },
    }),
  )
  const configurationPath = join(root, 'modkit.workspace.json')
  await writeFile(
    configurationPath,
    JSON.stringify({
      schemaVersion: 1,
      sources: [{ id: 'vendor', uri: './vendor' }],
    }),
  )
  const discovered = await discoverNodeExtensionRoots({ configurationPath })
  assert.equal(discovered.roots.length, 1)
  assert.equal(discovered.roots[0].path, extension)
  assert.equal(discovered.roots[0].materialized, false)
  assert.equal(discovered.roots[0].id, 'example.vendor/demo')
})

test('materializes a memory repository through VFS and emits a reproducible lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'modkit-extension-manager-memory-'))
  const entries = {
    'repo/modkit.repository.json': json({
      schemaVersion: 1,
      extensions: [{ id: 'example.memory/demo', path: 'demo' }],
    }),
    'repo/demo/package.json': json({
      name: 'memory-demo',
      version: '2.0.0',
      modkit: {
        schemaVersion: 1,
        publisher: 'example.memory',
        id: 'demo',
        contributionManifests: [],
      },
    }),
    'repo/demo/payload.txt': new TextEncoder().encode('from memory'),
  }
  const created = createNodeExtensionVfs({
    memoryEntries: entries,
    memoryAuthority: 'catalog',
  })
  try {
    const discovered = await discoverNodeExtensionRoots({
      configuration: {
        schemaVersion: 1,
        sources: [{ id: 'memory-catalog', uri: 'memory://catalog/repo' }],
      },
      configurationPath: join(root, 'modkit.workspace.json'),
      cacheRoot: join(root, 'cache'),
      vfs: created.vfs,
      protocols: created.protocols,
    })
    assert.equal(discovered.roots[0].materialized, true)
    assert.equal(
      await readFile(join(discovered.roots[0].path, 'payload.txt'), 'utf8'),
      'from memory',
    )
    const lock = extensionLockDocument(discovered)
    assert.equal(lock.extensions[0].digest.length, 64)
    assert.equal(lock.extensions[0].id, 'example.memory/demo')
  } finally {
    await created.vfs.dispose()
  }
})

test('materializes a portable repository selected through browser-file VFS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'modkit-extension-manager-browser-'))
  const uri = 'browser-file:catalog'
  const created = createNodeExtensionVfs({
    browserFiles: {
      [uri]: new Blob([portableRepository('example.browser', 'demo')]),
    },
  })
  try {
    const discovered = await discoverNodeExtensionRoots({
      configuration: { schemaVersion: 1, sources: [{ id: 'browser', uri }] },
      configurationPath: join(root, 'modkit.workspace.json'),
      cacheRoot: join(root, 'cache'),
      vfs: created.vfs,
    })
    assert.equal(discovered.roots[0].id, 'example.browser/demo')
    assert.equal(discovered.roots[0].protocol, 'browser-file')
  } finally {
    await created.vfs.dispose()
  }
})

test('materializes a portable repository selected through ranged HTTPS VFS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'modkit-extension-manager-http-'))
  const uri = 'https://extensions.example/catalog.json'
  const document = portableRepository('example.http', 'demo')
  const headers = {
    get: name =>
      ({
        'accept-ranges': 'bytes',
        'content-length': String(document.byteLength),
      })[name.toLowerCase()] ?? null,
  }
  const fetch = async (_url, init = {}) => {
    if (init.method === 'HEAD') {
      return {
        ok: true,
        status: 200,
        headers,
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    }
    const match = /^bytes=(\d+)-(\d+)$/u.exec(init.headers?.Range ?? '')
    assert.ok(match)
    const bytes = document.slice(Number(match[1]), Number(match[2]) + 1)
    return {
      ok: true,
      status: 206,
      headers,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }
  const created = createNodeExtensionVfs({ fetch })
  try {
    const discovered = await discoverNodeExtensionRoots({
      configuration: { schemaVersion: 1, sources: [{ id: 'http', uri }] },
      configurationPath: join(root, 'modkit.workspace.json'),
      cacheRoot: join(root, 'cache'),
      vfs: created.vfs,
    })
    assert.equal(discovered.roots[0].id, 'example.http/demo')
    assert.equal(discovered.roots[0].protocol, 'https')
  } finally {
    await created.vfs.dispose()
  }
})
