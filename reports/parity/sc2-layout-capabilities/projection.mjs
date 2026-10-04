// Protocol presentation only: preserve every diagnostic, its message, severity and UTF-16 range.
export function projectDiagnostics(documents) {
  return documents
    .map(document => ({
      file: decodeURIComponent(document.uri).split('/').at(-1),
      diagnostics: document.diagnostics
        .map(item => ({
          range: item.range,
          message: item.message,
          severity: item.severity,
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    }))
    .sort((a, b) => a.file.localeCompare(b.file))
}
