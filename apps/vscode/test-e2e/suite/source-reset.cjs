const assert = require('node:assert/strict')
const fs = require('node:fs')
const vscode = require('vscode')

/** Native regression only: keep unsaved semantic data alive across a content-source reset. */
exports.run = async () => {
  const receipt = { kind: 'modkit.vscode-source-reset-regression', version: 1, passed: false }
  const extension = vscode.extensions.getExtension('modkit.modkit-vscode')
  try {
    assert(extension)
    const api = await extension.activate()
    const root = vscode.workspace.workspaceFolders[0].uri
    const uri = vscode.Uri.joinPath(root, 'Base.SC2Data/GameData/UnitData.xml')
    const saved = fs.readFileSync(uri.fsPath, 'utf8')
    const document = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(document)
    assert.equal(document.languageId, 'sc2-data')
    const text = '<Catalog>\n<CUnit id="SourceResetProbe"><LifeMax value="123"/></CUnit>\n</Catalog>\n'
    const edits = new vscode.WorkspaceEdit()
    edits.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text)
    assert(await vscode.workspace.applyEdit(edits))
    const position = document.positionAt(text.indexOf('LifeMax') + 2)
    const hover = async () => {
      const values = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, position)
      return (values ?? []).flatMap(value => value.contents).map(value => typeof value === 'string' ? value : value.value ?? '').join('\n')
    }
    const waitHover = async milliseconds => {
      const until = Date.now() + milliseconds
      let last = ''
      do {
        last = await hover()
        if (last.includes('LifeMax') && last.includes('123')) return last
        await new Promise(resolve => setTimeout(resolve, 150))
      } while (Date.now() < until)
      throw new Error(`Unsaved LifeMax=123 hover unavailable: ${last}`)
    }
    receipt.beforeHover = await waitHover(90000)
    await vscode.workspace.getConfiguration('modkit').update('contentSourceOptions', {
      'blizzard/starcraft2': { installationDirectory: process.env.MODKIT_INSTALLED_CASC_ROOT },
    }, vscode.ConfigurationTarget.Workspace)
    // Let the configuration reset's microtasks close the former connection before the next query.
    await new Promise(resolve => setTimeout(resolve, 500))
    receipt.afterHover = await waitHover(15000)
    assert.equal(document.getText(), text)
    assert.equal(document.isDirty, true)
    assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), saved)
    receipt.unsavedBufferPreserved = true
    receipt.diskUnchanged = true
    receipt.passed = true
    receipt.diagnostics = api.diagnostics().filter(line => line.includes('language-provider-failed'))
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
  } catch (error) {
    receipt.error = error.stack ?? String(error)
    if (extension?.isActive) receipt.diagnostics = extension.exports.diagnostics().filter(line => line.includes('language-provider-failed'))
    throw error
  } finally {
    fs.writeFileSync(process.env.MODKIT_INSTALLED_LANGUAGE_RESULT, JSON.stringify(receipt, null, 2))
  }
}
