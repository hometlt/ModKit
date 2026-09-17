// Library-level SC2 bank probes, driven identically against either implementation's public API
// (MK2: pinned sc2-bank core/node; MK3: @modkit/blizzard-starcraft2/bank/node). The functions only
// sequence calls and project results to finite JSON; they contain no bank semantics.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const plain = value => (value === undefined ? null : JSON.parse(JSON.stringify(value, (_key, item) =>
  item instanceof Map ? [...item.entries()] : item instanceof Error ? { error: item.message } : item)))
const attempt = fn => { try { return { ok: plain(fn()) } } catch (error) { return { error: String(error?.message ?? error) } } }

/** A fixed scratch root so paths printed by either implementation are identical. */
async function scratch(name, run) {
  const root = path.join(os.tmpdir(), 'modkit-bank-parity', name)
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  try { return await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}
const relative = (root, value) => JSON.parse(JSON.stringify(value).replaceAll(JSON.stringify(root).slice(1, -1), '<root>').replaceAll(root.replaceAll('\\', '/'), '<root>'))

export async function runProbe(api, probe, input, text) {
  switch (probe) {
    case 'parse':
      return plain(api.parseBank(text))
    case 'sort':
      return api.serializeBank(api.sortBank(api.parseBank(text)))
    case 'serialize':
      return api.serializeBank(api.parseBank(text), input.options ?? {})
    case 'values':
      return input.values.map(([type, value]) => ({
        make: attempt(() => api.makeBankValue(type, value)),
        coerce: attempt(() => api.coerceBankValue(api.makeBankValue(type, value))),
      }))
    case 'lookup': {
      const bank = api.parseBank(text)
      return bank.sections.slice(0, 3).map(section => ({
        section: plain(api.getBankSection(bank, section.name)),
        keys: section.keys.slice(0, 3).map(key => ({
          key: plain(api.getBankKey(bank, section.name, key.name)),
          value: plain(api.getBankValue(bank, section.name, key.name)),
        })),
      }))
    }
    case 'patch':
      return plain(api.patchBankValueXml(text, input.patch))
    case 'signature': {
      const bank = api.parseBank(text)
      const signature = api.calculateBankSignature(bank, input.signatureInfo)
      return {
        signature,
        verify: api.verifyBankSignature(bank, input.signatureInfo),
        patched: plain(api.patchBankSignatureXml(text, signature)),
      }
    }
    case 'verify':
      return api.verifyBankSignature(api.parseBank(text), input.signatureInfo)
    case 'validate':
      return plain(api.validateBank(api.parseBank(text), input.options ?? {}))
    case 'editor': {
      const editor = new api.SC2BankEditor(api.parseBank(text))
      const log = []
      for (const [method, ...args] of input.script) {
        const result = attempt(() => {
          const value = editor[method](...args)
          return value === editor ? '<this>' : value
        })
        log.push([method, result])
      }
      return { log, serialized: attempt(() => editor.serialize({})) }
    }
    case 'infer':
      return input.paths.map(item => ({
        inferred: plain(api.inferBankSignatureInfo(item)),
        info: plain(api.toSignatureInfo(api.inferBankSignatureInfo(item))),
      }))
    case 'banklist': {
      const list = api.parseBankList(text)
      return {
        list: plain(list),
        serialized: api.serializeBankList(list),
        names: api.getBankListNames(list),
        match: plain(api.matchBankListToDiscovered(list, input.discovered)),
      }
    }
    case 'discover':
      return scratch('discover', async root => {
        for (const [file, body] of input.tree) {
          await mkdir(path.dirname(path.join(root, file)), { recursive: true })
          await writeFile(path.join(root, file), body)
        }
        return relative(root, plain(await api.discoverBankFiles(root, input.options ?? {})))
      })
    case 'io':
      return scratch('io', async root => {
        const file = path.join(root, input.relativePath)
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, text)
        const loaded = relative(root, plain(await api.loadBankFile(file, input.load ?? {})))
        const target = path.join(root, 'out', 'Saved.SC2Bank')
        let saved
        try {
          await api.saveBankFile(target, api.parseBank(text), input.save ?? {})
          saved = await readFile(target, 'utf8')
        } catch (error) { saved = { error: String(error?.message ?? error) } }
        return { loaded, saved }
      })
    case 'cli':
      return scratch('cli', async root => {
        const file = path.join(root, input.relativePath)
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, text)
        const out = []
        const err = []
        const args = input.args.map(arg => arg.replaceAll('<file>', file).replaceAll('<root>', root))
        const code = await api.runBankCli(args, { stdout: value => out.push(value), stderr: value => err.push(value) })
        const written = input.readBack ? await readFile(file, 'utf8') : undefined
        return relative(root, { code, stdout: out.join(''), stderr: err.join(''), ...(written === undefined ? {} : { written }) })
      })
  }
  throw new Error(`unknown bank probe: ${probe}`)
}
