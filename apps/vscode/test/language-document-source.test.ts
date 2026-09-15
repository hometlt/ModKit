import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('default language workspace composition', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'extension.ts'), 'utf8')

  it('supplies bounded inventory-routed workspace documents with editor overlays', () => {
    expect(source).toContain('const languageDocumentSource: LanguageWorkspaceDocumentSource')
    expect(source).toContain('documentSource: languageDocumentSource')
    expect(source).toContain('vscode.workspace.findFiles(')
    expect(source).toContain('vscode.workspace.openTextDocument(candidate.uri)')
    expect(source).toContain('routedLanguageIds.length === 1')
    expect(source).toContain('bytes > 4_194_304 || totalTextBytes + bytes > 16_777_216')
    expect(source).toContain('isComplete = false')
  })
})
