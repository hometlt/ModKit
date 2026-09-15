const CONTRACT = 'common.language/document-analysis'

export const abiVersion = 1
export const provides = Object.freeze([CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== CONTRACT || selection.major !== 1) throw new TypeError('unsupported')
  return Object.freeze({
    value: Object.freeze({
      contract: CONTRACT,
      languageIds: Object.freeze(['fixture-language']),
      async analyze(request) {
        const end = Math.min(7, request.document.text.length)
        const lines = request.document.text.split(/\r\n|\r|\n/u)
        return Object.freeze({
          documentUri: request.document.uri,
          documentVersion: request.document.version,
          tokens: Object.freeze(
            end === 0
              ? []
              : lines.length > 1
                ? [
                    {
                      range: {
                        start: { line: 0, character: 0 },
                        end: { line: lines.length - 1, character: lines.at(-1).length },
                      },
                      kind: 'keyword',
                    },
                  ]
                : [
                    {
                      range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: end },
                      },
                      kind: 'keyword',
                    },
                  ],
          ),
          diagnostics: Object.freeze(
            request.document.text.includes('invalid')
              ? [
                  {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: end } },
                    severity: 'error',
                    message: 'invalid fixture source',
                    code: 'fixture/invalid',
                  },
                ]
              : [],
          ),
          symbols: Object.freeze(
            end === 0
              ? []
              : [
                  {
                    name: 'fixture',
                    kind: 'function',
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: end } },
                    selectionRange: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: end },
                    },
                  },
                ],
          ),
        })
      },
      async hover(request) {
        return Object.freeze({
          markdown: `version ${request.document.version}: ${request.document.text}`,
        })
      },
      async definition(request) {
        return Object.freeze({
          locations: Object.freeze(
            request.workspaceDocuments
              .filter(document => document.uri.endsWith('/Dependency.fixturelang'))
              .map(document => ({
                uri: document.uri,
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: Math.min(10, document.text.length) },
                },
              })),
          ),
          isIncomplete: request.workspaceIncomplete,
        })
      },
    }),
    release: async () => undefined,
  })
}
