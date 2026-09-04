/** DDS facade over the universal pinned loader. No algorithm or error-class replacements. */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadMk2, codingRoot } from '../legacy-oracle/load-mk2.mjs'
import { ddsStubs } from '../legacy-oracle/dds-host-isolation.mjs'
import { oracleRunOptions } from '../legacy-oracle/track-corpus.mjs'
export { codingRoot }
const directory = 'extensions/common/images/codecs/dds/src'
export async function loadLegacy({ wasm = true } = {}) {
  const options = await oracleRunOptions()
  options.operationOptions = { ...options.operationOptions, requestedWasm: wasm }
  const result = {}
  const evidence = []
  for (const name of ['dds', 'helpers', 'ops', 'metadata', 'codec']) {
    const loaded = await loadMk2(`${directory}/${name}.ts`, {
      ...options, stubs: ddsStubs,
      runtimeDependencies: [{ name: 'texture2ddecoder-wasm', files: ['dist/index.mjs', 'wasm/texture2ddecoder.js', 'wasm/texture2ddecoder.wasm'] }],
      loaderFiles: [...options.loaderFiles, fileURLToPath(import.meta.url), fileURLToPath(new URL('../legacy-oracle/dds-host-isolation.mjs', import.meta.url))],
    })
    result[name] = loaded.module
    evidence.push(loaded.evidence)
  }
  if (process.env.MK2_ORACLE_EVIDENCE) await writeFile(process.env.MK2_ORACLE_EVIDENCE, `${JSON.stringify({ schemaVersion: 1, operation: options.operation, modules: evidence }, null, 2)}\n`)
  return result
}
