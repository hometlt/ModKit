export const definition = Object.freeze({
  format: 'csv',
  extensions: Object.freeze(['csv']),
  mediaType: 'text/csv',
  contract: 'common.text-data/csv-syntax',
  dialect: 'csv-rfc4180',
  delimiter: ',',
  semantic: 'table',
  implementationTier: 2,
})
