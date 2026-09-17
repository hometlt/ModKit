// MK3 sc2-replay arm: the installed Blizzard extensions (common formats, MPQ, StarCraft II) in the
// ordinary MK3 host; the replay is opened by openSubject and driven through published operations.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, caseBytes, caseName, importPublic, resolveInput, sha256, workspace } from '../lib/kit.mjs'
import { project } from './projection.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
export const handlers = Object.freeze({
  'view.inspect': 'inspect',
  'asset.validate': 'validate',
  'export.raw': 'export-raw',
  'sc2-replay.analyze': 'analyze',
  'media.seek': 'transport-seek',
  'media.play': 'transport-play-pause',
  'view.render': 'sample-scene',
  timeline: 'timeline',
})
const LOOPS_PER_SECOND = 22.4
const budget = { maxInputBytes: 16_777_216n, maxDepth: 64, maxNodes: 1_000_000, maxScalarBytes: 8_388_608, maxDiagnostics: 100, deadlineMs: 60_000 }

/** The ordinary MK3 host with the installed Blizzard extensions (shared with other harnesses). */
export async function blizzardHost(names = ['blizzard-common-formats', 'mpq', 'starcraft2']) {
  const host = (await importPublic(packageDir, '@modkit/host')).module
  const hostNode = (await importPublic(packageDir, '@modkit/host/node')).module
  const extensions = await Promise.all(names.map(async name => ({
    ...(await hostNode.loadExtensionDirectory(path.join(blizzardRoot, name))),
    execution: { origin: 'bundled', allowTrustedInProcess: true },
  })))
  const inventory = await host.buildInventory(extensions, host.createHostContributionContractRegistry())
  const serviceDefinitions = host.createBundledServiceDefinitionRegistry()
  await host.registerServiceDefinitionsOrThrow(inventory, serviceDefinitions)
  const executionBackends = host.createExecutionBackendRegistry([{
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) { return { module: await import(context.entrypoint.href), release: async () => undefined } },
  }])
  const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' }
  return { host, hostNode, inventory, serviceDefinitions, executionBackends, target }
}

export async function prepareMigrated({ corpus }) {
  const env = await blizzardHost()
  const scratch = path.join(os.tmpdir(), 'modkit-replay-parity')
  const open = async (bytes, name, input) => {
    // Checked-in fixtures open in place; inline inputs are written to a scratch file.
    let file = input.file === undefined ? undefined : path.resolve(workspace, input.file)
    if (file === undefined) {
      await mkdir(scratch, { recursive: true })
      file = path.join(scratch, name)
      await writeFile(file, bytes)
    }
    const opened = await env.host.openSubject({
      inventory: env.inventory, serviceDefinitions: env.serviceDefinitions, executionBackends: env.executionBackends, target: env.target,
      source: await env.hostNode.openFileArtifactSource(file), path: file, intent: 'full',
      grant: { id: 'sc2-replay-parity', classes: ['read-source'] }, budget,
    })
    if (opened.state !== 'opened') throw new Error(`replay did not open: ${opened.reason}`)
    if (opened.selected.contributionId !== 'blizzard/sc2-replay') {
      await opened.session.dispose()
      throw new Error(`replay selected ${opened.selected.contributionId} ${JSON.stringify(opened.diagnostics ?? opened.candidates ?? Object.keys(opened)).slice(0, 1500)}`)
    }
    return opened.session
  }
  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const bytes = await caseBytes(input)
    const name = caseName(input)
    if (input.probe === 'detect') {
      try {
        await (await open(bytes, name, input)).dispose()
        return project('detect', { value: true })
      } catch { return project('detect', { value: false }) }
    }
    const session = await open(bytes, name, input)
    const call = async (id, request = {}) => {
      const result = await session.operations().invoke(handlers[id], request)
      if (result.state !== 'ok') throw Object.assign(new Error(result.reason ?? `${id} refused`), { code: result.code })
      return result.output.value
    }
    try {
      switch (input.probe) {
        case 'view.inspect': return project(input.probe, { native: await call('view.inspect') })
        case 'asset.validate': return project(input.probe, { native: await call('asset.validate') })
        case 'export.raw': return project(input.probe, { value: await call('export.raw') })
        case 'export.convert': return project(input.probe, { native: { inspect: await call('view.inspect'), timeline: await call('timeline') } })
        case 'sc2-replay.analyze': return project(input.probe, { native: await call('sc2-replay.analyze') })
        case 'view.render': return project(input.probe, { native: { scene: await call('view.render', { loop: input.loop }), timeline: await call('timeline') } })
        case 'media.seek':
        case 'media.play': {
          const lease = await session.dataSource('common.view/transport-source', 1)
          try {
            const transport = lease.value
            const { durationMs } = await transport.snapshot()
            const positionMs = Math.min(Math.round((input.loop / LOOPS_PER_SECOND) * 1000), Number(durationMs))
            await call('media.seek', { positionMs })
            if (input.probe === 'media.play') await call('media.play', {})
            return project(input.probe, { native: await transport.snapshot() })
          } finally { await lease.release() }
        }
      }
    } finally { await session.dispose() }
    throw new Error(`unknown sc2-replay probe: ${input.probe}`)
  }
  const self = fileURLToPath(import.meta.url)
  const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
  return {
    module: { 'sc2-replay.parity': invoke },
    release: () => rm(scratch, { recursive: true, force: true }),
    evidence: {
      route: 'installed blizzard-common-formats + mpq + starcraft2 extensions; openSubject; published operations',
      manifest: 'modkit-extensions-blizzard/starcraft2/modules/replay/codecs/replay/codec.json',
      manifestSha256: sha256(await readFile(path.join(packageDir, 'modules/replay/codecs/replay/codec.json'))),
      projectionSha256: sha256(await readFile(projection)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
