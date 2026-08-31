import type { ResourceBudget } from '@modkit/sdk'
import type {
  ParseResult,
  TextDataContractId,
  TextDocumentMap,
  TextInput,
  TextSyntaxProvider,
} from '@modkit/sdk/text-data'

export interface TextDataConformanceCase<Contract extends TextDataContractId> {
  readonly name: string
  readonly input: TextInput
  readonly dialect: string
  readonly budget: ResourceBudget
  readonly expectedState: ParseResult<TextDocumentMap[Contract]>['state']
  readonly verify?: (document: TextDocumentMap[Contract]) => void
}

export interface TextDataConformanceFailure {
  readonly caseName: string
  readonly message: string
}

export interface TextDataConformanceReport {
  readonly contract: TextDataContractId
  readonly passed: number
  readonly failures: readonly TextDataConformanceFailure[]
}

/** One provider-neutral runner used by defaults and alternate implementations. */
export async function runTextDataConformance<Contract extends TextDataContractId>(
  provider: TextSyntaxProvider<Contract>,
  cases: readonly TextDataConformanceCase<Contract>[],
): Promise<TextDataConformanceReport> {
  const failures: TextDataConformanceFailure[] = []
  let passed = 0
  for (const item of cases) {
    let result: ParseResult<TextDocumentMap[Contract]>
    try {
      result = await provider.parse({
        input: item.input,
        dialect: item.dialect,
        budget: item.budget,
      })
    } catch (error) {
      failures.push({
        caseName: item.name,
        message: `provider threw: ${error instanceof Error ? error.message : String(error)}`,
      })
      continue
    }
    if (result.state !== item.expectedState) {
      failures.push({
        caseName: item.name,
        message: `expected ${item.expectedState}, received ${result.state}`,
      })
      continue
    }
    const invalidDiagnostic = result.diagnostics.find(
      diagnostic =>
        diagnostic.code.trim() === '' ||
        diagnostic.severity.trim() === '' ||
        diagnostic.message.trim() === '',
    )
    if (invalidDiagnostic !== undefined) {
      failures.push({ caseName: item.name, message: 'provider returned an invalid diagnostic' })
      continue
    }
    if (result.state !== 'failed' && item.verify !== undefined) item.verify(result.document)
    passed += 1
  }
  return Object.freeze({
    contract: provider.contract,
    passed,
    failures: Object.freeze(failures),
  })
}
