/**
 * Run the built PWA's generated Wave 1B format-family acceptance in real Chromium.
 *
 * Corpus roots are explicit machine inputs. The server exposes only the exact generated files;
 * the page verifies their generated size/SHA before it asks the real browser host to open them.
 */
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

import {
  loadFormatSmokeAuthority,
  resolveFormatSmokeCases,
  verifyFormatSmokeCorpusBeforeOpen,
} from '../../vscode/test-e2e/format-smoke-runtime.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const codingRoot = existsSync(join(repoRoot, 'references')) ? repoRoot : resolve(repoRoot, '..')

const argument = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const roots = Object.freeze({
  workspaceRoot: resolve(argument('--workspace-root') ?? codingRoot),
  sc2InstallRoot: resolve(
    argument('--sc2-root') ??
      process.env['MODKIT_PWA_FORMAT_SMOKE_SC2_ROOT'] ??
      'C:\\apps\\StarCraft II',
  ),
  warzoneInstallRoot: resolve(
    argument('--warzone-root') ??
      process.env['MODKIT_PWA_FORMAT_SMOKE_WARZONE_ROOT'] ??
      'C:\\Program Files\\WindowsApps\\48148WZ2100Project.Warzone2100forWindows_4.7.0.0_x64__qsk72963svc8a',
  ),
})
const receiptPath = argument('--receipt')

const chromeCandidates = [
  process.env['CHROME_PATH'],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(value => value !== undefined)
const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
if (executablePath === undefined) throw new Error('Chrome/Chromium is required')

const scratch = mkdtempSync(join(tmpdir(), 'modkit-pwa-format-smoke-'))
const dist = join(scratch, 'dist')
const authority = loadFormatSmokeAuthority()
const resolvedCases = resolveFormatSmokeCases(authority, roots)
const resolvedById = new Map(resolvedCases.map(testCase => [testCase.id, testCase]))
const browserCases = authority.cases.filter(
  testCase =>
    testCase.runtime.pwa.kind === 'browser-subset' && testCase.corpus.kind !== 'named-exclusion',
)
if (browserCases.length !== 10)
  throw new Error('generated authority does not have 10 browser cases')
const hostOnlyCaseIds = new Set(
  authority.cases
    .filter(testCase => testCase.runtime.pwa.kind === 'host-facility-refusal')
    .map(testCase => testCase.id),
)
if (hostOnlyCaseIds.size !== 4)
  throw new Error('generated authority does not have 4 host-only cases')

const servedCorpus = new Map()
for (const descriptor of browserCases) {
  const testCase = resolvedById.get(descriptor.id)
  if (testCase?.kind !== 'open') throw new Error(`${descriptor.id} did not resolve as an open case`)
  let filePath
  if (testCase.source.kind === 'file') {
    await verifyFormatSmokeCorpusBeforeOpen(testCase)
    filePath = testCase.source.filePath
  } else if (testCase.source.containerKind === 'warzone-wz') {
    // The installed PWA extracts and verifies the entry bytes before opening the nested subject.
    filePath = testCase.source.containerPath
  } else {
    throw new Error(`${descriptor.id} is not browser-available`)
  }
  const route = `/format-smoke-corpus/${encodeURIComponent(descriptor.id)}/${encodeURIComponent(
    basename(filePath),
  )}`
  servedCorpus.set(route, filePath)
}

const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
})

const serveFile = (request, response, file) => {
  const size = statSync(file).size
  const headers = {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
  }
  const range = request.headers.range
  if (range !== undefined) {
    const match = /^bytes=(\d+)-(\d*)$/u.exec(range)
    const start = match === null ? Number.NaN : Number(match[1])
    const requestedEnd = match?.[2] === '' ? size - 1 : Number(match?.[2])
    const end = Math.min(requestedEnd, size - 1)
    if (
      match === null ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(requestedEnd) ||
      start < 0 ||
      requestedEnd < start ||
      start >= size
    ) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` })
      response.end()
      return
    }
    response.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    })
    if (request.method === 'HEAD') response.end()
    else createReadStream(file, { start, end }).pipe(response)
    return
  }
  response.writeHead(200, { ...headers, 'Content-Length': String(size) })
  if (request.method === 'HEAD') response.end()
  else createReadStream(file).pipe(response)
}

let server
let browser
try {
  execFileSync(process.execPath, [join(appRoot, 'scripts', 'build.mjs'), '--out', dist], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const corpus = servedCorpus.get(url.pathname)
    if (corpus !== undefined) {
      serveFile(request, response, corpus)
      return
    }
    const relativeName = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const target = resolve(dist, relativeName)
    const fromDist = relative(dist, target)
    if (fromDist === '..' || fromDist.startsWith(`..${sep}`) || isAbsolute(fromDist)) {
      response.writeHead(403).end()
      return
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      response.writeHead(404).end()
      return
    }
    serveFile(request, response, target)
  })
  await new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('acceptance server failed')
  const origin = `http://127.0.0.1:${address.port}`
  const corpusUrls = Object.fromEntries(
    [...servedCorpus.keys()].map(path => {
      const match = /^\/format-smoke-corpus\/([^/]+)\//u.exec(path)
      if (match === null) throw new Error(`invalid corpus route ${path}`)
      return [decodeURIComponent(match[1]), `${origin}${path}`]
    }),
  )

  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ colorScheme: 'dark' })
  const page = await context.newPage()
  const failures = []
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`)
    else if (message.type() === 'warning' && message.text().startsWith('[format-smoke]')) {
      process.stderr.write(`${message.text()}\n`)
    }
  })
  await page.goto(`${origin}/?format-smoke&lang=en`, { waitUntil: 'load', timeout: 120_000 })
  await page.waitForFunction(() => globalThis.__MODKIT_FORMAT_SMOKE__ !== undefined, undefined, {
    timeout: 120_000,
  })
  const prepared = await page.evaluate(() => globalThis.__MODKIT_FORMAT_SMOKE__.prepare())
  if (prepared.reloadRequired) {
    await page.reload({ waitUntil: 'load', timeout: 120_000 })
    await page.waitForFunction(() => globalThis.__MODKIT_FORMAT_SMOKE__ !== undefined, undefined, {
      timeout: 120_000,
    })
  }
  const receipt = await page.evaluate(
    urls => globalThis.__MODKIT_FORMAT_SMOKE__.run(urls),
    corpusUrls,
  )
  if (receipt.verdict !== 'pass') {
    throw new Error(`PWA format smoke failed: ${JSON.stringify(receipt)}`)
  }
  const refused = receipt.cases.filter(item => item.outcome === 'refused')
  if (
    refused.length !== 4 ||
    refused.some(
      item =>
        !hostOnlyCaseIds.has(item.id) ||
        item.source?.boundary !== 'modkit.app.web/source-open' ||
        item.code !== 'x3.host/facility-unavailable' ||
        item.facility !== 'filesystem.read-random',
    )
  ) {
    throw new Error('PWA receipt does not prove four page-owned source-boundary refusals')
  }
  if (Object.keys(corpusUrls).some(caseId => hostOnlyCaseIds.has(caseId))) {
    throw new Error('host-only CASC corpus must not be served to the browser')
  }
  if (receipt.cases.length !== 14) throw new Error('PWA receipt does not contain all 14 cases')
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`
  for (const root of Object.values(roots)) {
    if (serialized.includes(root) || serialized.includes(root.replaceAll('\\', '/'))) {
      throw new Error('PWA receipt contains an absolute corpus root')
    }
  }
  if (/\b(?:file|https?):|[A-Z]:[\\/]|\\\\/u.test(serialized)) {
    throw new Error('PWA receipt contains an absolute location')
  }
  if (failures.length > 0) throw new Error(failures.join('\n'))
  if (receiptPath !== undefined) {
    const target = resolve(receiptPath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, serialized)
  }
  process.stdout.write(`pwa format-smoke: done\n${serialized}`)
  await context.close()
} finally {
  await browser?.close()
  if (server !== undefined) await new Promise(done => server.close(() => done()))
  rmSync(scratch, { recursive: true, force: true })
}
