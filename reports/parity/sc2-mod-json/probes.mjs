// JSON mod writer/reader probes, driven identically against either implementation's public API.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Declared projection: a file body is compared as UTF-8 text whether it is carried as a string or bytes.
const text = value => (typeof value === 'string' ? value : new TextDecoder().decode(value))

export async function drive(api, input) {
  const mods = new Map(Object.entries(input.mods))
  const files = [...mods].map(([name, mod]) => [name, api.jsonModToFiles(mod, input.indent).map(item => ({ path: item.path, content: text(item.content) }))])
  const reader = new api.JsonModReader(mods)
  const read = async target => {
    const out = {}
    for (const probe of input.paths) {
      const settle = async fn => { try { return await fn() } catch (error) { return { error: String(error?.message ?? error) } } }
      out[probe] = {
        exists: await settle(() => target.exists(probe)),
        list: await settle(() => target.list(probe)),
        text: await settle(() => target.getText(probe)),
        bytes: await settle(async () => text(await target.get(probe))),
      }
    }
    return out
  }
  const root = path.join(os.tmpdir(), 'modkit-json-mod-parity')
  await rm(root, { recursive: true, force: true })
  try {
    for (const [name, mod] of mods) {
      await mkdir(root, { recursive: true })
      await writeFile(path.join(root, `${name}.json`), JSON.stringify(mod))
    }
    const fromDir = await api.JsonModReader.fromDir(root)
    return { files, reader: await read(reader), fromDir: await read(fromDir) }
  } finally { await rm(root, { recursive: true, force: true }) }
}
