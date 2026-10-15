import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const state = { calls: [], sources: undefined, workspace: undefined, server: undefined }
globalThis.__modkitRootStartupTest = state
const mocks = new Map([
  [pathToFileURL(require.resolve('@modkit/host')).href, `
    const s=globalThis.__modkitRootStartupTest;
    export const composeLanguageDocumentSources=sources=>sources[0];
    export async function resolveContentLanguageSources(request){s.calls.push(['project',request]);return{sources:[],diagnostics:[],contexts:[]}}
  `],
  [pathToFileURL(require.resolve('@modkit/host/node')).href, `
    const s=globalThis.__modkitRootStartupTest;
    export async function createModkit(){return{extensionFailures:[],services:{inventory:{}},
      open:async()=>{throw Error('language startup must not activate a subject codec')},close:async()=>s.calls.push(['host-close'])}}
    export const workerBackendPolicy=()=>({});
    export async function loadContentSources(){s.calls.push(['sources']);return s.sources}
    export const withSharedModContexts=local=>local;
    export const createFilesystemLanguageDocumentSource=()=>({origin:()=>undefined});
  `],
  [pathToFileURL(require.resolve('@modkit/host/language')).href, `
    const s=globalThis.__modkitRootStartupTest;
    export const languageProviderRoutes=()=>[{languageId:'fixture'}];
    export const createLanguageFileClassifier=()=>()=>false;
    export const languageWorkspaceContextToken=JSON.stringify;
    export const createLanguageModContexts=()=>({dispose:async()=>s.calls.push(['contexts-close']),
      prepare:()=>s.calls.push(['prepare']),invalidate:()=>s.calls.push(['invalidate'])});
    export function createLanguageWorkspace(options){s.workspace=options;return{initialize:async()=>s.calls.push(['workspace-initialize'])}}
  `],
  [new URL('../dist/server.js', import.meta.url).href, `
    const s=globalThis.__modkitRootStartupTest;
    export function createModkitLanguageServer(options){s.server=options;return{
      listen:()=>s.calls.push(['listen']),close:async()=>s.calls.push(['server-close'])}}
  `],
])
registerHooks({
  load(url, context, next) {
    const source = mocks.get(url)
    return source === undefined ? next(url, context) : { format: 'module', source, shortCircuit: true }
  },
})
const { runModkitLsp } = await import('../dist/main.js')

/** Real canonical roots; mock only service boundaries so boot cannot hide a codec activation. */
async function fixture(withSources, run) {
  const scratch = await mkdtemp(join(tmpdir(), 'modkit-lsp-root-context-'))
  try {
    const roots = [join(scratch, 'Example.modpkg'), join(scratch, 'loose')]
    await Promise.all(roots.map(root => mkdir(root)))
    state.calls = []
    state.sources = { dispose: async () => state.calls.push(['sources-close']) }
    const args = [...roots.flatMap(root => ['--root', root]), '--extension', scratch]
    if (withSources) args.push('--content-source-config', join(scratch, 'sources.json'),
      '--content-source-storage', join(scratch, 'storage'), '--base-mod', 'Mods/Base.modpkg')
    const running = await runModkitLsp(args)
    try { await run(running, await Promise.all(roots.map(root => realpath(root)))) }
    finally { await running.close() }
  } finally { await rm(scratch, { recursive: true, force: true }) }
}

test('projects package and loose roots through the canonical context without opening subjects', async () => {
  await fixture(true, async (running, roots) => {
    const projects = state.calls.filter(([name]) => name === 'project')
    assert.equal(projects.length, 1)
    const request = projects[0][1]
    assert.deepEqual(request.subjects, roots.map(root => ({ descriptor: { subjectUri: pathToFileURL(root).href } })))
    assert.deepEqual(request.baseMods, { '*': ['Mods/Base.modpkg'] })
    assert.equal(request.keepContexts, true)
    assert.equal(request.contentSources, state.sources)
    assert.ok(request.limits.maxDocumentBytes > 0)
    assert.ok(request.limits.maxWorkspaceBytes >= request.limits.maxDocumentBytes)
    assert.ok(state.workspace.semanticInputs.some(input => input.kind === 'locale-set'))
    assert.ok(!state.workspace.semanticInputs.some(input => input.kind === 'subject-set'))
    assert.equal(typeof state.server.clientInitialized, 'function')
    state.server.clientInitialized()
    assert.ok(state.calls.some(([name]) => name === 'prepare'))
    state.server.filesChanged()
    assert.ok(state.calls.some(([name]) => name === 'invalidate'))
    await running.close()
    await running.close()
    assert.deepEqual(state.calls.filter(([name]) => name.endsWith('-close')).map(([name]) => name),
      ['server-close', 'contexts-close', 'sources-close', 'host-close'])
  })
})

test('keeps filesystem-only startup independent of content sources and subject codecs', async () => {
  await fixture(false, async () => {
    assert.ok(state.calls.some(([name]) => name === 'listen'))
    assert.ok(!state.calls.some(([name]) => name === 'project' || name === 'sources'))
    assert.equal(state.server.clientInitialized, undefined)
  })
})
