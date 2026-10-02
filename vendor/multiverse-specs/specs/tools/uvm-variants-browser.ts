/** Shared Node/real-browser contract probe. Fixtures never supply I/O outside captured bytes. */
import { assertUvmVariants, uvmVariantModelReferences } from './uvm-variants.ts'
import { assertUvwProfile, createUvwGltfDocument, restoreUvwProfileDocument } from './uvw-profile.mjs'
import { composeVerifiedReceipt, verifiedCompositionModels } from './uv-composition.mjs'
import { jcsStringify } from './uv-canonical-form.mjs'

export interface ModelBytes { readonly path: string; readonly hash: string; readonly bytes: Uint8Array; readonly family?: 'uvm' | 'media' }
export interface ContractProbe {
  readonly variants: readonly unknown[]
  readonly worlds: readonly unknown[]
  readonly packages: readonly (readonly ModelBytes[])[]
}
export async function probeModelContracts(input: ContractProbe): Promise<unknown> {
  const variants = input.variants.map(document => {
    try { assertUvmVariants(document); return { references: uvmVariantModelReferences(document, 'models/body.uvm.glb') } }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  })
  const worlds = input.worlds.map(document => {
    try {
      assertUvwProfile(document)
      return { exact: jcsStringify(restoreUvwProfileDocument(createUvwGltfDocument(document))) === jcsStringify(document) }
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  })
  const packages = []
  for (const entries of input.packages) {
    const id = 'sample/variant-contract', manifest = { id, version: '1.0.0', kind: 'library',
      dependencies: [], requires: { intrinsics: [], capabilities: [] },
      contents: entries.map(entry => ({ family: entry.family ?? 'uvm', path: entry.path, hash: entry.hash })) }
    const result = await composeVerifiedReceipt(id, [manifest], { intrinsics: [] }, [], async request => {
      const entry = entries.find(value => value.path === request.content.path)
      if (!entry) throw new Error('Missing captured test bytes')
      return { digest: entry.hash, bytes: entry.bytes }
    })
    if ('refusal' in result) packages.push(result.refusal)
    else {
      const captured = await verifiedCompositionModels(result.receipt)
      if ('refusal' in captured) throw new Error(captured.refusal.message)
      packages.push({ models: captured.models.map(model => ({ path: model.path, digest: model.digest })) })
    }
  }
  return { variants, worlds, packages }
}
if (typeof self !== 'undefined') self.onmessage = async (event: MessageEvent<ContractProbe>) => {
  try { self.postMessage(await probeModelContracts(event.data)) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
