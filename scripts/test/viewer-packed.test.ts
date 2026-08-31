import { spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const extensionRoot = join(repoRoot, 'examples', 'modkit-extension-synthetic-viewer')
const temporary = mkdtempSync(join(tmpdir(), 'x3-packed-viewer-'))
const chromeCandidates = [
  process.env['CHROME_PATH'],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((value): value is string => value !== undefined)

let browser: Browser | undefined
let server: Server | undefined

afterAll(async () => {
  await browser?.close()
  if (server !== undefined) await new Promise<void>(resolve => server?.close(() => resolve()))
  rmSync(temporary, { recursive: true, force: true })
})

function command(commandName: string, args: readonly string[], cwd: string) {
  const shim = process.platform === 'win32' && ['npm', 'pnpm'].includes(commandName)
  const result = shim
    ? spawnSync(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', commandName, ...args], {
        cwd,
        encoding: 'utf8',
        timeout: 240_000,
        env: { ...process.env, npm_config_cache: join(temporary, 'npm-cache') },
      })
    : spawnSync(commandName, args, { cwd, encoding: 'utf8', timeout: 240_000 })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('13C packed external viewer in the real browser host (C-18a)', () => {
  it(
    'installs artifacts, validates inventory, resolves a plan and exercises the viewer under CSP',
    { timeout: 300_000 },
    async () => {
      const tarballDir = join(temporary, 'tarballs')
      for (const packageName of ['core', 'sdk', 'vfs', 'host', 'ui', 'testkit']) {
        const packed = command(
          'pnpm',
          ['pack', '--pack-destination', tarballDir],
          join(repoRoot, 'packages', packageName),
        )
        expect(packed.status, `packing ${packageName}: ${packed.stderr}`).toBe(0)
      }
      const externalPacked = command(
        'npm',
        ['pack', '--pack-destination', tarballDir, '--ignore-scripts'],
        extensionRoot,
      )
      expect(externalPacked.status, externalPacked.stderr).toBe(0)
      const tarballs = readdirSync(tarballDir)
        .filter(name => name.endsWith('.tgz'))
        .map(name => join(tarballDir, name))
      expect(tarballs).toHaveLength(7)

      const installed = join(temporary, 'installed')
      cpSync(extensionRoot, installed, { recursive: true })
      const installation = command(
        'npm',
        ['install', '--no-audit', '--no-fund', '--install-links=false', ...tarballs],
        installed,
      )
      expect(installation.status, installation.stderr).toBe(0)
      const inventoryCheck = command(
        'node',
        [
          '--input-type=module',
          '--eval',
          `import { readFile } from 'node:fs/promises';
           import { validateContributionManifest } from '@modkit/sdk';
           import { createHostContributionContractRegistry } from '@modkit/host';
           const manifest = JSON.parse(await readFile('./contribution.manifest.json', 'utf8'));
           const result = await validateContributionManifest(
             manifest,
             createHostContributionContractRegistry().validationRegistry(),
           );
           console.log(JSON.stringify({
             specState: result.specState,
             inventoryEligible: result.inventoryEligible,
             activationEligible: result.activationEligible,
             diagnostics: result.diagnostics,
           }));`,
        ],
        installed,
      )
      expect(inventoryCheck.status, inventoryCheck.stderr).toBe(0)
      expect(JSON.parse(inventoryCheck.stdout)).toEqual({
        specState: 'validated',
        inventoryEligible: true,
        activationEligible: true,
        diagnostics: [],
      })

      const bundled = await build({
        stdin: {
          contents: `
            import manifest from '@example/modkit-x3-synthetic-viewer/contribution.manifest.json';
            import syntheticViewer from '@example/modkit-x3-synthetic-viewer';
            import {
              evaluateViewerContribution,
              resolvePresentationPlan,
            } from '@modkit/host';
            import { createBrowserViewerHost } from '@modkit/testkit/browser';

            const descriptor = {
              descriptorVersion: 2,
              subjectUri: 'memory://packed-viewer',
              revision: 'content-hash.sha256:packed',
              state: 'resolved',
              identity: { codecId: 'org.example/synthetic', codecVersion: '1.0.0' },
              origin: {
                kind: 'single',
                binding: {
                  bindingId: 'primary', role: 'primary', ownership: 'owned', required: true,
                  source: { id: 'memory://packed-viewer', uri: 'memory://packed-viewer' },
                  revision: 'content-hash.sha256:packed',
                },
              },
              traits: [],
              representations: [],
              dataSources: [],
              operations: [{
                id: 'asset.validate', handlerId: 'validate', mutatesSource: false, state: 'available',
              }],
              diagnostics: [],
            };
            const eligibility = evaluateViewerContribution(
              manifest.spec,
              descriptor,
              { interpretation: 'codec', sourceBytes: 1n, longestLineBytes: 1 },
            );
            const candidate = {
              slotId: 'packed-stage',
              kind: manifest.spec.kind,
              contributionId: manifest.id,
              extensionId: '@example/modkit-x3-synthetic-viewer',
              priority: manifest.spec.priority,
              singletonGroup: manifest.spec.singletonGroup,
              bindings: [],
              eligible: eligibility.eligible,
              missing: eligibility.missing,
            };
            const resolved = await resolvePresentationPlan({
              descriptor,
              candidates: [candidate],
              async resolveBinding() { return undefined; },
              digest(value) { return JSON.stringify(value); },
            });
            let jumped = '';
            let invoked = 0;
            let cancelled = 0;
            const root = document.querySelector('#app');
            root.addEventListener('modkit-diagnostic-jump', event => {
              jumped = event.detail.id;
            });
            const operations = {
              invoke(_handler, _input, options) {
                invoked += 1;
                options.onProgress?.({ completed: 1, total: 2, message: 'working' });
                return new Promise(resolve => {
                  const finish = () => {
                    cancelled += 1;
                    resolve({ state: 'rejected', reason: 'cancelled', diagnostics: [] });
                  };
                  if (options.signal?.aborted) finish();
                  else options.signal?.addEventListener('abort', finish, { once: true });
                });
              },
              async dispose() {},
            };
            const host = await createBrowserViewerHost({
              root,
              descriptor,
              resolved,
              sources: { async get() { return undefined; } },
              operations,
              modules: { [manifest.id]: syntheticViewer },
            });
            globalThis.packedViewer = {
              eligibility,
              resolved,
              host,
              counters: () => ({ jumped, invoked, cancelled }),
            };
          `,
          resolveDir: installed,
          loader: 'js',
        },
        absWorkingDir: installed,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2023',
        write: false,
        logLevel: 'silent',
      })
      const application = bundled.outputFiles[0]?.contents
      if (application === undefined) throw new Error('packed viewer browser bundle was not emitted')
      const html = `<!doctype html><html><head>
        <meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src blob:">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Packed viewer</title></head><body><main id="app"></main>
        <script type="module" src="/app.js"></script></body></html>`
      server = createServer((request, response) => {
        if (request.url === '/app.js') {
          response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
          response.end(application)
        } else {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          response.end(html)
        }
      })
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject)
        server?.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('browser server failed')
      const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
      if (executablePath === undefined) throw new Error('Chrome/Chromium is required for C-18a')
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
      const page: Page = await browser.newPage()
      await page.goto(`http://127.0.0.1:${address.port}`)
      await page.waitForFunction(() => 'packedViewer' in globalThis)

      const initial = await page.evaluate(() => {
        const state = (
          globalThis as unknown as {
            packedViewer: {
              eligibility: { eligible: boolean; missing: string[] }
              resolved: { plan: { activeStage?: string } }
            }
          }
        ).packedViewer
        return {
          eligibility: state.eligibility,
          activeStage: state.resolved.plan.activeStage,
        }
      })
      expect(initial).toEqual({
        // the packed stage declares no optional facets, so nothing beyond the required source binds
        eligibility: { eligible: true, missing: [], optionalBound: [] },
        activeStage: 'packed-stage',
      })
      await page.getByRole('button', { name: 'Next page' }).click()
      expect(await page.getByText('page 2 of a synthetic million-row source').count()).toBe(1)
      await page.getByRole('button', { name: 'Expand root' }).click()
      expect(await page.getByRole('treeitem', { name: 'lazy child' }).count()).toBe(1)
      expect(await page.getByRole('cell', { name: '<untrusted cell>' }).count()).toBe(1)
      expect(await page.locator('script').count()).toBe(1)
      await page.getByRole('button', { name: 'Jump to diagnostic' }).click()
      await page.getByRole('button', { name: 'Run operation' }).click()
      await page.waitForFunction(() =>
        document.querySelector('output')?.textContent?.includes('working'),
      )
      await page.getByRole('button', { name: 'Cancel operation' }).click()
      await page.waitForFunction(
        () => document.querySelector('output')?.textContent === 'cancelled',
      )
      const counters = await page.evaluate(() =>
        (
          globalThis as unknown as {
            packedViewer: { counters(): { jumped: string; invoked: number; cancelled: number } }
          }
        ).packedViewer.counters(),
      )
      expect(counters).toEqual({ jumped: 'packed-diagnostic', invoked: 1, cancelled: 1 })
      await page.evaluate(async () => {
        await (
          globalThis as unknown as { packedViewer: { host: { unmount(): Promise<void> } } }
        ).packedViewer.host.unmount()
      })
      expect(await page.locator('#app').evaluate(node => node.children.length)).toBe(0)
      expect(
        readFileSync(
          join(installed, 'node_modules', '@example', 'modkit-x3-synthetic-viewer', 'package.json'),
          'utf8',
        ),
      ).not.toContain('workspace:')
    },
  )
})
