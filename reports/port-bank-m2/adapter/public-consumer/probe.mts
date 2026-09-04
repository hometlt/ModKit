import {
  parseBank,
  serializeBank,
  calculateBankSignature,
  verifyBankSignature,
  parseBankList,
  serializeBankList,
  SC2BankEditor,
  createSc2BankCodec,
  type SC2Bank,
  type SC2BankSignatureInfo,
} from '@modkit/blizzard-starcraft2/bank/core'
import {
  discoverBankFiles,
  loadBankFile,
  saveBankFile,
  runBankCli,
  type BankCliIO,
  type LoadedBankFile,
  type DiscoveredBankFile,
} from '@modkit/blizzard-starcraft2/bank/node'
import {
  createCodec,
  createCodecWithOptions,
  definition,
  operations,
  SC2_BANK_OPERATION_MAP,
  SC2_BANK_OPERATION_MAP_VERSION,
  type Sc2BankCodecOptions,
} from '@modkit/blizzard-starcraft2/bank/codec'
import type { Codec, OperationDecl } from '@modkit/sdk'

export function inspectPublicBank(xml: string) {
  const bank: SC2Bank = parseBank(xml)
  const identity: SC2BankSignatureInfo = {
    bankName: 'Probe', authorId: '2-S2-1-20', playerId: '2-S2-1-10',
  }
  const editor = new SC2BankEditor(bank, identity)
  editor.setInt('Stats', 'Score', 42)
  const options: Sc2BankCodecOptions = { signatureInfo: identity }
  const native: Codec = createCodecWithOptions(options)
  const defaultNative: Codec = createCodec()
  const declarations: readonly OperationDecl[] = operations
  return {
    native, defaultNative, declarations, definition,
    legacy: createSc2BankCodec(),
    serialized: serializeBank(bank, { sort: true }),
    signature: calculateBankSignature(bank, identity),
    verified: verifyBankSignature(bank, identity),
    bankList: serializeBankList(parseBankList('<BankList><Bank Name="Probe" Player="1"/></BankList>')),
    score: editor.getInt('Stats', 'Score'),
    mapping: SC2_BANK_OPERATION_MAP,
    mappingVersion: SC2_BANK_OPERATION_MAP_VERSION,
  }
}

/** Compile the Node-only API without executing filesystem operations. */
export async function inspectPublicNodeBank(path: string, io: BankCliIO) {
  const discovered: DiscoveredBankFile[] = await discoverBankFiles(path, { maxDepth: 1 })
  const loaded: LoadedBankFile = await loadBankFile(path, { validate: true })
  const saved: string = await saveBankFile(path, loaded.editor, { sign: false, createDirs: true })
  const exitCode: number = await runBankCli(['--help'], io)
  return { discovered, loaded, saved, exitCode }
}
