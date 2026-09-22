// MK3 through the host: the published sc2-mod codec's own `content.mount` handler.
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildInventory,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
  registerServiceDefinitionsOrThrow,
} from '@modkit/host'
import { loadExtensionDirectory, openDirectoryArtifactSource } from '@modkit/host/node'
import { blizzardRoot, importPublic, sha256 } from '../lib/kit.mjs'
import { driveMigrated } from './probes.mjs'

const extensionRoot = path.join(blizzardRoot, 'starcraft2')
const manifestFile = path.join(extensionRoot, 'modules/mod/codecs/mod/codec.json')
const budget = Object.freeze({
  maxInputBytes: 64_000_000n,
  maxDepth: 256,
  maxNodes: 1_000_000,
  maxScalarBytes: 16_000_000,
  maxDiagnostics: 1_000,
})

export async function prepareMigrated({ operation }) {
  const workspace = await importPublic(extensionRoot, '@modkit/blizzard-starcraft2/workspace')
  const manifestBytes = await readFile(manifestFile)
  const manifest = JSON.parse(manifestBytes)
  const mount = manifest.spec?.operations?.find(item => item.id === 'content.mount')
  if (mount?.handlerId !== 'mount') throw new Error('published operation absent: content.mount/mount')

  const extension = {
    ...(await loadExtensionDirectory(extensionRoot)),
    execution: { origin: 'bundled', allowTrustedInProcess: true },
  }
  const inventory = await buildInventory([extension], createHostContributionContractRegistry())
  // content.mount resolves the chain through the mod-workspace composition service, so the
  // composition must carry the platform's service definitions, exactly as a product host does.
  const serviceDefinitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(inventory, serviceDefinitions)
  const executionBackends = createExecutionBackendRegistry([
    {
      profile: 'trusted-in-process',
      supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
      async activate(context) {
        return { module: await import(context.entrypoint.href), release: async () => undefined }
      },
    },
  ])
  const open = async directory => {
    const opened = await openSubject({
      inventory,
      executionBackends,
      serviceDefinitions,
      source: await openDirectoryArtifactSource(directory),
      path: directory,
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'sc2-mod-content-parity', classes: ['read-source'] },
      budget,
    })
    if (opened.state !== 'opened') {
      throw Object.assign(new Error(opened.reason ?? 'directory was not routed'), { code: opened.state })
    }
    return opened.session
  }

  const self = fileURLToPath(import.meta.url)
  const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))
  return {
    module: {
      [operation]: input =>
        driveMigrated(
          open,
          input,
          async directory =>
            (await readdir(directory, { withFileTypes: true }))
              .filter(entry => entry.isDirectory())
              .map(entry => entry.name),
          workspace.module.composeStarcraft2Workspace,
        ),
    },
    evidence: {
      extensionRoot: path.relative(blizzardRoot, extensionRoot).split(path.sep).join('/'),
      manifest: path.relative(blizzardRoot, manifestFile).split(path.sep).join('/'),
      manifestSha256: sha256(manifestBytes),
      handler: { operation: 'content.resolve-dependencies', handlerId: 'resolve-dependencies' },
      workspaceProvider: path.relative(blizzardRoot, workspace.file).split(path.sep).join('/'),
      workspaceProviderSha256: sha256(await readFile(workspace.file)),
      probesSha256: sha256(await readFile(probes)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
