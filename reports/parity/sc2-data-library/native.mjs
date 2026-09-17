// MK3 sc2-data catalog library through the public @modkit/blizzard-starcraft2/data/format export.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, caseBytes, importPublic, resolveInput, sha256 } from '../lib/kit.mjs'
import { uriOf } from './legacy.mjs'
import { drive } from './probes.mjs'

export async function prepareMigrated({ corpus }) {
  const format = await importPublic(path.join(blizzardRoot, 'starcraft2'), '@modkit/blizzard-starcraft2/data/format')
  const api = format.module
  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const bytes = await caseBytes(input)
    const uri = uriOf(input)
    const name = uri.slice(uri.lastIndexOf('/') + 1)
    // The same memory source descriptor the published codec builds for its bytes.
    const source = {
      schemaVersion: 1, id: uri, kind: 'file', origin: 'memory', path: uri, name,
      extension: name.slice(name.lastIndexOf('.')).toLowerCase(), size: bytes.length,
      readOnly: true, randomAccess: true, seekable: true,
    }
    const document = api.loadCatalogDocument({
      files: [api.catalogFileFromBytes(source, bytes)], source, detection: api.detectSc2DataBytes(bytes, source), context: {},
    })
    return drive(api, document.catalog)
  }
  const self = fileURLToPath(import.meta.url)
  const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))
  return {
    module: { 'sc2-data.library-parity': invoke },
    evidence: {
      publicExport: path.relative(blizzardRoot, format.file).split(path.sep).join('/'),
      publicExportSha256: sha256(await readFile(format.file)),
      probesSha256: sha256(await readFile(probes)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
