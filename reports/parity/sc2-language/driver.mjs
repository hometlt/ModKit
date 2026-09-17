// Shared LSP scenario driver: writes a scenario workspace, starts one language server per scenario,
// opens the documents, waits for indexing and answers requests projected to a declared shape.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { startServer } from './lsp-client.mjs'

/** Protocol-shape normalization shared by both arms (URIs, hover, locations, symbols, completion). */
export function makeProjection(root) {
  const base = pathToFileURL(root).href.toLowerCase()
  const uri = value => {
    const decoded = decodeURIComponent(value).replace(/^file:\/\/\/([a-z]):/iu, (_m, drive) => `file:///${drive.toLowerCase()}:`)
    return decoded.toLowerCase().startsWith(base) ? `<ws>${decoded.slice(base.length)}` : decoded
  }
  const range = value => (value === undefined || value === null ? null : { start: value.start, end: value.end })
  const hoverText = contents => {
    const list = Array.isArray(contents) ? contents : [contents]
    return list.map(item => (typeof item === 'string' ? item : item.value)).join('\n\n')
  }
  const location = item => ({ uri: uri(item.targetUri ?? item.uri), range: range(item.targetSelectionRange ?? item.range) })
  const symbol = item => ({
    name: item.name,
    kind: item.kind,
    range: range(item.range ?? item.location?.range),
    ...(item.location === undefined ? {} : { uri: uri(item.location.uri) }),
    children: (item.children ?? []).map(symbol),
  })
  const sortBy = key => (a, b) => (JSON.stringify(key(a)) < JSON.stringify(key(b)) ? -1 : 1)
  return (kind, result) => {
    if (result === null || result === undefined) return null
    switch (kind) {
      case 'hover': return { text: hoverText(result.contents), range: range(result.range) }
      case 'locations': return (Array.isArray(result) ? result : [result]).map(location).sort(sortBy(item => item))
      case 'location-start': return (Array.isArray(result) ? result : [result]).map(location).map(item => ({ uri: item.uri, start: item.range.start })).sort(sortBy(item => item))
      case 'symbols': return result.map(symbol)
      case 'workspace-symbols': return result.map(symbol).filter(item => item.uri?.startsWith('<ws>')).sort(sortBy(item => [item.uri, item.name]))
      case 'signature': return { signatures: result.signatures.map(item => ({ label: item.label, parameters: (item.parameters ?? []).map(p => p.label) })), activeSignature: result.activeSignature ?? 0, activeParameter: result.activeParameter ?? 0 }
      case 'completion-labels': return [...new Set((Array.isArray(result) ? result : result.items).map(item => item.label))].sort()
      case 'colors': return result.map(item => ({ range: range(item.range), color: item.color }))
      case 'rename': {
        const changes = result.changes ?? Object.fromEntries((result.documentChanges ?? []).map(item => [item.textDocument.uri, item.edits]))
        return Object.entries(changes).map(([key, edits]) => [uri(key), edits.map(edit => ({ range: range(edit.range), newText: edit.newText })).sort(sortBy(item => item.range))]).sort(sortBy(item => item[0]))
      }
      case 'raw': return result
    }
    throw new Error(`unknown projection ${kind}`)
  }
}

/**
 * One server per scenario, started lazily and kept for the scenario's requests.
 * `launch(root)` returns { command, args, options, languageIds, initializationOptions }.
 */
const drivers = new Set()
/** Stops every scenario server of both arms (the runner only releases the migrated adapter). */
export async function releaseAllDrivers() {
  for (const driver of [...drivers]) await driver.release()
}

export function createScenarioDriver(corpus, launch) {
  const running = new Map()
  const open = async scenarioId => {
    if (running.has(scenarioId)) return running.get(scenarioId)
    const scenario = corpus.scenarios[scenarioId]
    const pending = (async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'modkit-lsp-parity-'))
      for (const [file, text] of Object.entries(scenario.files)) {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true })
        await writeFile(path.join(root, file), text)
      }
      const setup = launch(root)
      const server = startServer(setup.command, setup.args, setup.options)
      const answer = await server.request('initialize', {
        processId: null, rootUri: pathToFileURL(root).href,
        workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'ws' }],
        capabilities: {}, initializationOptions: setup.initializationOptions,
      })
      if (answer.error) throw new Error(`initialize failed: ${answer.error.message}`)
      server.notify('initialized', {})
      for (const [file, text] of Object.entries(scenario.files)) {
        const languageId = setup.languageIds[scenario.languages[file]]
        if (languageId !== undefined)
          server.notify('textDocument/didOpen', { textDocument: { uri: pathToFileURL(path.join(root, file)).href, languageId, version: 1, text } })
      }
      await new Promise(resolve => setTimeout(resolve, scenario.settleMs ?? 15_000))
      return { root, server, project: makeProjection(root), capabilities: answer.result.capabilities }
    })()
    running.set(scenarioId, pending)
    return pending
  }
  const invoke = async input => {
    const { root, server, project, capabilities } = await open(input.scenario)
    if (input.method === 'capabilities') return input.keys.map(key => [key, capabilities[key] !== undefined && capabilities[key] !== false])
    const params = JSON.parse(JSON.stringify(input.params).replaceAll('<ws>', pathToFileURL(root).href))
    const answer = await server.request(input.method, params)
    if (answer.error) throw Object.assign(new Error('request refused'), { code: 'LSP_ERROR' })
    return project(input.projection, answer.result)
  }
  const release = async () => {
    for (const pending of running.values()) {
      const { root, server } = await pending
      await server.close()
      await rm(root, { recursive: true, force: true }).catch(() => {})
    }
    running.clear()
  }
  const driver = { invoke, release: async () => { drivers.delete(driver); await release() } }
  drivers.add(driver)
  return driver
}
