import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { sha256 } from './load-mk2.mjs'
export async function loadMk3Reference(entry, workingPath) {
  if (!process.env.MK3_REFERENCE_MANIFEST) return import(pathToFileURL(workingPath).href)
  const reference = JSON.parse(await readFile(process.env.MK3_REFERENCE_MANIFEST, 'utf8'))
  const evidence = reference.modules[entry]
  if (!evidence || evidence.oracleCommit !== reference.commit) throw new Error(`Missing pinned MK3 reference: ${entry}`)
  const bundle = path.join(evidence.directory, 'oracle.mjs')
  if (sha256(await readFile(bundle)) !== evidence.bundleSha256) throw new Error(`Corrupt pinned MK3 reference: ${entry}`)
  return import(pathToFileURL(bundle).href)
}
