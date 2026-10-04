import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('default language workspace composition', () => {
  const read = (name: string) => readFileSync(join(import.meta.dirname, '..', 'src', name), 'utf8')
  const source = read('extension.ts')

  it('supplies bounded inventory-routed workspace documents with editor overlays', () => {
    expect(source).toContain('const languageDocumentSource: LanguageWorkspaceDocumentSource')
    expect(source).toContain('documentSource: languageDocumentSource')
    expect(source).toContain('resolveContentLanguageSources({')
    expect(source).toContain('composeLanguageDocumentSources([')
    expect(source).toContain('selectScopedSubject(')
    expect(source).toContain('projected?.dependenciesComplete === true')
    // Project files come from the folders on disk only, through the one helper that asks VS Code.
    expect(source).toContain('findDiskFiles(')
    expect(read('workspace-files.ts')).toContain('vscode.workspace.findFiles(')
    // A file that is not open is read from disk: opening it would open it in the language
    // workspace, and that cancels the request the snapshot serves.
    expect(source).toContain('vscode.workspace.fs.readFile(candidate.uri)')
    expect(source).not.toContain('vscode.workspace.openTextDocument(candidate.uri)')
    expect(source).toContain('routedLanguageIds.length === 1')
    expect(source).toContain(
      'BigInt(totalTextBytes + bytes) > LANGUAGE_WORKSPACE_BUDGET.maxInputBytes',
    )
    expect(source).toContain('isComplete = false')
  })
})
