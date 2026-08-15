export const definition = Object.freeze({
  format: 'tsv',
  extensions: Object.freeze(['tsv', 'tab']),
  mediaType: 'text/tab-separated-values',
  contract: 'common.text-data/tsv-syntax',
  dialect: 'tsv-iana',
  delimiter: '\t',
  semantic: 'table',
  implementationTier: 2,
})
