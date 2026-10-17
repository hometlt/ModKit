/**
 * A single-file UVP (SPEC_UVP §2): the ZIP the core archive codec reads, seen as a world package —
 * the semantic alias over that container's namespace. Every file of the package is read (each
 * within the scalar budget, all within the input budget) and handed to the UVP owner
 * (`openUvpMapBundle`), which refuses a package whose files are not exactly the manifest and its
 * declared contents, whose hashes disagree or which exceeds its budgets. The world it publishes
 * reads its terrain media through the host's raster decoder and its object models through the
 * package's own UVM decoder: nothing of the game it came from.
 * The listing and `container.extract` are the ZIP carrier's, which the host lends an alias.
 * map.export-native hands the installed game's map encoder the package itself (the files read,
 * packed again by the UVP owner), so an encoder sees the world with its models and textures.
 */
import {
  createInspectionCodec,
  createTreeDataSource,
  type NamespaceInspectionCodecDefinition,
  type NamespaceInspectionContext,
  type NamespaceMarker,
} from '@modkit/codec-kit'
import type { AssetNamespace, ContributionContext } from '@modkit/sdk'
import { WORLD_SCENE_SOURCE_CONTRACT } from '@modkit/sdk/maps'
import {
  nativeMapExportHandler,
  nativeMapExportOperation,
  openUvpMapBundle,
  packUvpArchive,
} from '@modkit/uv/world'

import { createEmbeddedUvmWorldModelDecoder } from '../world/embedded-uvm.js'

const MANIFEST = 'uvp.manifest.json'

/**
 * Every file of the package by path, within `maxFiles` files, `maxFileBytes` bytes each and
 * `maxBytes` bytes in all.
 */
async function readPackageFiles(
  namespace: AssetNamespace,
  maxFiles: number,
  maxFileBytes: number,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  let total = 0
  const directories = ['']
  for (
    let directory = directories.shift();
    directory !== undefined;
    directory = directories.shift()
  ) {
    // a namespace lists a directory's own children
    for await (const entry of namespace.list(directory, signal)) {
      if (entry.kind === 'directory') {
        directories.push(entry.path)
        continue
      }
      if (files.size >= maxFiles)
        throw new RangeError(`UVP holds more than ${String(maxFiles)} files`)
      // refused before the bytes are read, when the listing knows the size
      if (entry.size !== undefined && total + Number(entry.size) > maxBytes)
        throw new RangeError(`UVP contents exceed ${String(maxBytes)} bytes`)
      const lease = await namespace.open(entry.path, signal)
      try {
        const source = lease.value
        if (source.kind !== 'bytes' || source.size === undefined)
          throw new TypeError(`UVP entry ${entry.path} is not a sized file`)
        if (Number(source.size) > maxFileBytes)
          throw new RangeError(`UVP entry ${entry.path} exceeds ${String(maxFileBytes)} bytes`)
        total += Number(source.size)
        if (total > maxBytes) throw new RangeError(`UVP contents exceed ${String(maxBytes)} bytes`)
        files.set(entry.path, await source.read(0n, Number(source.size), signal))
      } finally {
        await lease.release()
      }
    }
  }
  return files
}

const definition: NamespaceInspectionCodecDefinition = Object.freeze({
  id: 'modkit/world-uvp',
  version: '1.0.0',
  operations: Object.freeze([nativeMapExportOperation('modkit/world-uvp', 'export-uvp-native')]),
  // the world reads textures through the host's raster decoder, bound once the subject opens
  deferInspection: true,
  format: Object.freeze({ id: 'uvp', label: 'Universal Verse Package' }),
  namespace: Object.freeze({
    async detect(markers: readonly NamespaceMarker[]) {
      return markers.some(marker => marker.kind === 'file' && marker.path === MANIFEST)
        ? { confidence: 0.95, kind: 'structure' as const, note: MANIFEST }
        : { confidence: 0, kind: 'structure' as const, note: 'uvp-manifest-missing' }
    },
    async inspect(namespace: AssetNamespace, context: NamespaceInspectionContext) {
      // A file is one scalar; the package as a whole, its media and its models are what the
      // input budget lets the open read (a map's package holds hundreds of megabytes of them).
      const packageBytes = Number(context.budget.maxInputBytes)
      const files = await readPackageFiles(
        namespace,
        context.budget.maxNodes,
        context.budget.maxScalarBytes,
        packageBytes,
        context.signal,
      )
      const opened = await openUvpMapBundle(files, {
        snapshotId: namespace.revision,
        maxWorldBytes: context.budget.maxScalarBytes,
        maxMediaBytes: packageBytes,
        maxModelBytes: packageBytes,
        modelDecoder: createEmbeddedUvmWorldModelDecoder(context.rasterResources),
        ...(context.rasterResources === undefined
          ? {}
          : { rasterResources: context.rasterResources }),
      })
      const { manifest, document } = opened
      const summary = {
        format: 'uvp',
        id: manifest.id,
        version: manifest.version,
        contents: manifest.contents.length,
        spaces: document.spaces.length,
      }
      return {
        detection: { confidence: 0.95, kind: 'structure' as const, note: MANIFEST },
        summary,
        metadata: [
          {
            id: 'uvp-package',
            label: 'UVP package',
            entries: Object.entries(summary).map(([key, value]) => ({ key, value })),
          },
        ],
        traits: [{ id: 'structure.hierarchy', parameters: { kind: 'package' } }],
        dataSources: {
          [WORLD_SCENE_SOURCE_CONTRACT]: opened.source,
          'common.view/tree-data-source': createTreeDataSource({
            kind: 'package',
            label: manifest.id,
            preview: `UVP ${manifest.version}, ${String(manifest.contents.length)} contents`,
            children: manifest.contents.map(content => ({
              kind: content.family,
              label: content.path,
              preview: content.hash,
            })),
          }),
        },
        handlers: {
          'export-uvp-native': nativeMapExportHandler(
            () =>
              packUvpArchive(files, {
                maxNodes: files.size + 16,
                maxInputBytes: BigInt(packageBytes) * 2n,
              }),
            context,
            'modkit/world-uvp',
          ),
        },
        maxDecodedBytes: [...files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0),
        unsupportedFeatures: ['uvp-writing-in-place'],
      }
    },
  }),
})

export const abiVersion = 1
export const createCodec = (context: ContributionContext) =>
  createInspectionCodec(definition, context)
