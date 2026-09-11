/** Actual renderer/preload/main smoke with a deterministic source backend; never signs into Blizzard. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(appRoot, '..', '..')
const output = join(repoRoot, 'artifacts', 'content-sources-ui')
await mkdir(output, { recursive: true })
const temporary = await mkdtemp(join(output, 'run-'))
const backend = join(temporary, 'provider.mjs')
await writeFile(backend, `
export async function createContentSources() {
  let removed = false;
  let rowRemoved = false;
  let rowCached = false;
  return {
    async snapshot() { return { label: 'Test source', publishing: true, deletion: true, regions: [{ id: 'us', label: 'NA' }],
      connections: [{ id: 'test-account-kr', accountId: 'test-account', label: 'Test account', region: 'kr' }],
      roots: [{ id: 'public:us', region: 'us', kind: 'public', label: 'Public mods · NA' },
        { id: 'mine:test-account-kr', region: 'kr', kind: 'mine', label: 'Own mods · KR' }] } },
    async list(id, path) {
      if (id === 'mine:test-account-kr') return rowRemoved ? [] : [{ name: 'OwnTest.SC2Mod', path: 'OwnTest.SC2Mod', directory: true,
        actions: [{ id: rowCached ? 'clear-cache' : 'download' }, { id: 'delete-publication' }] }];
      if (id !== 'public:us') throw new Error('Unknown source');
      return path === '' ? [{ name: 'TestMod.SC2Mod', path: 'TestMod.SC2Mod', directory: true }]
        : [{ name: 'Readme.txt', path: 'TestMod.SC2Mod/Readme.txt', directory: false, size: 26 }]
    },
    async read(id, path) {
      if (id !== 'public:us' || path !== 'TestMod.SC2Mod/Readme.txt') throw new Error('Unknown file');
      return new TextEncoder().encode('Content source smoke proof')
    },
    async refresh() {}, async connect() {}, async disconnect() {}, async search() { return [] },
    async preparePublish(id, file, manifest) {
      if (id !== 'test-account-kr' || file !== 'C:/test.SC2Mod' || manifest !== 'C:/test.modkit-publish.json') throw new Error('Review input mismatch');
      return { id: 'review', name: 'Prepared test', account: 'Test account', region: 'kr', bytes: 100, sha256: 'a'.repeat(64),
        target: { mode: 'update', id: 19, expectedVersion: 65537 }, visibility: 'private', locked: true }
    },
    async publish(id) { if (id !== 'review') throw new Error('Review token mismatch'); return { publication: { id: 19, version: 65538, name: 'Prepared test' } } },
    async deletionCandidates(id) { if (id !== 'test-account-kr') throw new Error('Wrong account'); return removed ? [] : [{ id: 'own-review', label: 'Own test publication', description: '#19 · 1.2 · KR' }] },
    async deletePublication(id) { if (id === 'own-review') removed = true; else if (id === 'row-review') rowRemoved = true; else throw new Error('Wrong selection'); return { status: 'unlinked', serverUnlinkVerified: true } },
    async prepareDeletePublication(source, path) {
      if (source !== 'mine:test-account-kr' || path !== 'OwnTest.SC2Mod') throw new Error('Wrong own publication');
      return { id: 'row-review' };
    },
    async download(source, path) {
      if (source !== 'mine:test-account-kr' || path !== 'OwnTest.SC2Mod') throw new Error('Wrong download');
      rowCached = true;
    },
    async clearCache(source, path) {
      if (source !== 'mine:test-account-kr' || path !== 'OwnTest.SC2Mod') throw new Error('Wrong cache clear');
      rowCached = false;
    },
    async add() {}, async remove() {}, async dispose() {}
  }
}
`)
const config = join(temporary, 'provider.json')
await writeFile(config, JSON.stringify({ module: backend }))
const env = { ...process.env, MODKIT_CONTENT_SOURCE_CONFIG: config,
  MODKIT_ELECTRON_USER_DATA_DIR: join(temporary, 'user-data') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: [join(appRoot, 'electron', 'main.cjs')], cwd: repoRoot, env, timeout: 60000 })
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  await page.getByRole('button', { name: /^(Источники|Sources)…$/ }).click()
  await page.getByRole('dialog').waitFor()
  await page.screenshot({ path: join(output, 'picker.png') })
  await page.getByRole('button', { name: 'Public mods · NA', exact: true }).click()
  await page.getByText('TestMod.SC2Mod', { exact: true }).click()
  await page.getByText('Readme.txt', { exact: true }).dblclick()
  await page.getByText('Content source smoke proof', { exact: false }).first().waitFor()
  await page.screenshot({ path: join(output, 'file.png') })
  assert(await page.getByText('Content source smoke proof', { exact: false }).count())
  console.log('PASS: source picker → VFS tree → file → read-only codec preview')
  await page.getByRole('button', { name: /^(Источники|Sources)…$/ }).click()
  await page.getByRole('button', { name: 'Own mods · KR', exact: true }).click()
  await page.getByRole('button', { name: /^(Download|Загрузить)$/ }).click()
  await page.getByRole('button', { name: /^(Clear cache|Очистить кэш)$/ }).waitFor()
  await page.screenshot({ path: join(output, 'publication-row-actions.png') })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: /^(Delete|Удалить)$/ }).click()
  await page.getByText('OwnTest.SC2Mod', { exact: true }).waitFor({ state: 'detached' })
  console.log('PASS: publication row → cache action and confirmed server deletion (mock backend, no network)')
  await page.getByRole('button', { name: /^(Источники|Sources)…$/ }).click()
  await page.getByRole('button', { name: /^(Publish prepared|Опубликовать подготовленный)/ }).click()
  await page.getByRole('button', { name: 'Test account — KR', exact: true }).click()
  await page.getByRole('dialog').locator('input').fill('C:/test.SC2Mod')
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await page.getByRole('dialog').locator('input').fill('C:/test.modkit-publish.json')
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await page.getByRole('dialog').getByText(/Prepared test · Test account · KR/).waitFor()
  await page.screenshot({ path: join(output, 'publish-review.png') })
  await page.getByRole('button', { name: /^(Publish|Опубликовать):/ }).click()
  await page.getByRole('button', { name: 'Prepared test · #19 · 1.2', exact: true }).waitFor()
  console.log('PASS: prepared package review → selected KR connection → confirmed receipt (mock backend, no network)')
  await page.getByRole('button', { name: 'Prepared test · #19 · 1.2', exact: true }).click()
  await page.getByRole('button', { name: /^(Delete own Battle.net|Удалить свою публикацию)/ }).click()
  await page.getByRole('button', { name: 'Test account — KR', exact: true }).click()
  await page.getByRole('button', { name: /^Own test publication —/ }).click()
  await page.getByRole('button', { name: /^(Delete publication from this account|Удалить публикацию из этого аккаунта)/ }).waitFor()
  await page.screenshot({ path: join(output, 'delete-review.png') })
  await page.getByRole('button', { name: /^(Delete publication from this account|Удалить публикацию из этого аккаунта)/ }).click()
  await page.getByRole('dialog').getByText(/(Publication removal confirmed|Снятие публикации подтверждено)/).waitFor()
  console.log('PASS: own-publication selection → KR deletion review → unlink receipt (mock backend, no network)')
} catch (error) {
  const pages = app.windows()
  if (pages.length) {
    await pages[0].screenshot({ path: join(output, 'failure.png') }).catch(() => {})
    await writeFile(join(output, 'failure.txt'), await pages[0].locator('body').innerText())
  }
  throw error
} finally { await app.close() }
