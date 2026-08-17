import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

function json(path: string): unknown {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('failed to reserve a port')
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error === undefined ? resolve() : reject(error)))
  })
  return address.port
}

function waitForReady(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(
      () => reject(new Error(`PWA debug server timed out\n${output}`)),
      30_000,
    )
    const inspect = (chunk: Uint8Array) => {
      output += Buffer.from(chunk).toString('utf8')
      if (output.includes('debug-pwa: ready')) {
        clearTimeout(timer)
        resolve(output)
      }
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', code => {
      if (!output.includes('debug-pwa: ready')) {
        clearTimeout(timer)
        reject(new Error(`PWA debug server exited ${String(code)}\n${output}`))
      }
    })
  })
}

describe('VS Code debug launchers', () => {
  it('keeps launch configurations and tasks connected to every application adapter', () => {
    const launch = json('.vscode/launch.json') as {
      configurations: readonly { readonly name: string; readonly preLaunchTask?: string }[]
    }
    const tasks = json('.vscode/tasks.json') as {
      tasks: readonly { readonly label: string }[]
    }
    expect(launch.configurations.map(configuration => configuration.name)).toEqual([
      'Modkit X3: Headless',
      'Modkit X3: PWA (Chrome)',
      'Modkit X3: Electron Adapter',
      'Modkit X3: VS Code Adapter',
      // The adapters above compose topologies headlessly. These two launch the real shells, which
      // is a different thing to debug — a window and an extension host, not a Node process.
      'Modkit X3: Electron App (real window)',
      'Modkit X3: VS Code Extension (Extension Host)',
      'Modkit X3: Web Composition (Node)',
    ])
    const labels = new Set(tasks.tasks.map(task => task.label))
    for (const configuration of launch.configurations) {
      expect(labels.has(configuration.preLaunchTask ?? '')).toBe(true)
    }
  })

  it('starts a selected real extension set in the headless debug runner', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/debug/app-runner.mjs', '--app', 'headless', '--set', 'models-and-archives'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(output).toContain('headless/models-and-archives ready')
    expect(output).toContain("'headless'")
  })

  it('serves a hydrated extension inventory through the PWA debug server', async () => {
    const port = await availablePort()
    const child = spawn(
      process.execPath,
      ['scripts/debug/pwa-server.mjs', '--set', 'documents', '--port', String(port)],
      { cwd: root, stdio: 'pipe' },
    )
    try {
      await waitForReady(child)
      const [html, payload, serviceWorker] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/`).then(response => response.text()),
        fetch(`http://127.0.0.1:${port}/debug/extensions.json`).then(response => response.json()),
        fetch(`http://127.0.0.1:${port}/service-worker.js`).then(response => response.text()),
      ])
      expect(html).toContain('Modkit X3 PWA Debug')
      expect(payload).toMatchObject({
        set: 'documents',
        extensions: [{ containers: { packageJson: { modkit: { id: 'documents' } } } }],
      })
      expect(serviceWorker).toContain("addEventListener('fetch'")
    } finally {
      child.kill('SIGTERM')
    }
  }, 40_000)
})
