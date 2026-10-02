import { assertUvmCore } from './uvm-profile.mjs'
import { assertUvwProfile, createUvwGltfDocument, restoreUvwProfileDocument } from './uvw-profile.mjs'
import { jcsStringify } from './uv-canonical-form.mjs'

export interface PresentationProbe { readonly models: readonly unknown[]; readonly worlds: readonly unknown[] }
export function probePresentation(input: PresentationProbe): unknown {
  const models = input.models.map(document => {
    try { assertUvmCore(document); return { accepted: true, unchanged: jcsStringify(document) } }
    catch (error) { return { refusal: error instanceof Error ? error.message : String(error) } }
  })
  const worlds = input.worlds.map(document => {
    try {
      assertUvwProfile(document)
      return { accepted: true, exact: jcsStringify(restoreUvwProfileDocument(createUvwGltfDocument(document))) === jcsStringify(document) }
    } catch (error) { return { refusal: error instanceof Error ? error.message : String(error) } }
  })
  return { models, worlds }
}
if (typeof self !== 'undefined') self.onmessage = (event: MessageEvent<PresentationProbe>) => self.postMessage(probePresentation(event.data))
