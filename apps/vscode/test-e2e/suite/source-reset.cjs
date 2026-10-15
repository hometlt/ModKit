const assert = require('node:assert/strict')
const fs = require('node:fs')
const vscode = require('vscode')

/** Keep unsaved semantics and mods without open tabs alive across a content-source reset. */
exports.run = async () => {
  const receipt = { kind: 'modkit.vscode-source-reset-regression', version: 2, passed: false }
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
    const retainedRoot = vscode.Uri.joinPath(root, '..', 'Retained.SC2Mod')
    const retainedUri = vscode.Uri.joinPath(retainedRoot, 'Base.SC2Data/GameData/UnitData.xml')
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(retainedRoot, 'Base.SC2Data/GameData'))
    await vscode.workspace.fs.writeFile(retainedUri, Buffer.from('<Catalog><CUnit id="RetainedProbe"/></Catalog>'))
    const info = vscode.Uri.joinPath(root, 'DocumentInfo')
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(retainedRoot, 'DocumentInfo'), await vscode.workspace.fs.readFile(info))
    const retainedDocument = await vscode.workspace.openTextDocument(retainedUri)
    await vscode.window.showTextDocument(retainedDocument)
    await vscode.commands.executeCommand('modkit.resources.refresh')
    const reportUri = vscode.Uri.file(`${process.env.MODKIT_INSTALLED_LANGUAGE_RESULT}.window.json`)
    const loadedMods = async () => {
      assert(await vscode.commands.executeCommand('modkit.exportDiagnostics', reportUri))
      return JSON.parse(fs.readFileSync(reportUri.fsPath, 'utf8')).loadedMods
    }
    const untilLoaded = Date.now() + 90000
    while (!(await loadedMods()).some(mod => mod.label.toLowerCase() === 'retained.sc2mod')) {
      assert(Date.now() < untilLoaded, 'Second mod was not automatically retained')
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await vscode.window.showTextDocument(document)
    receipt.loadedBeforeReset = await loadedMods()
    assert(receipt.loadedBeforeReset.some(mod => mod.label.toLowerCase() === 'retained.sc2mod'))
    await vscode.workspace.getConfiguration('modkit').update('contentSourceOptions', {
      'blizzard/starcraft2': { installationDirectory: process.env.MODKIT_INSTALLED_CASC_ROOT },
    }, vscode.ConfigurationTarget.Workspace)
    // Let the configuration reset's microtasks close the former connection before the next query.
    await new Promise(resolve => setTimeout(resolve, 500))
    receipt.afterHover = await waitHover(15000)
    await vscode.commands.executeCommand('modkit.resources.refresh')
    receipt.loadedAfterReset = await loadedMods()
    const ids = new Set(receipt.loadedAfterReset.map(mod => mod.id))
    assert(receipt.loadedBeforeReset.every(mod => ids.has(mod.id)), 'Source reset forgot a loaded mod without an editor tab')
    receipt.closedModRetained = true
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
