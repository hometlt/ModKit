'use strict'

/** Native editor-command acceptance for Data, Galaxy, Layout, Strings, Style and Wizard owners. */

const fs = require('node:fs')
const vscode = require('vscode')

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitFor(check, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() >= deadline) return undefined
    await sleep(100)
  }
}

function positionOf(document, needle, delta = 0, occurrence = 0) {
  const text = document.getText()
  let offset = -1
  for (let index = 0; index <= occurrence; index += 1) offset = text.indexOf(needle, offset + 1)
  if (offset < 0) throw new Error(`${document.uri.path} does not contain ${needle}`)
  return document.positionAt(offset + delta)
}

const locationUri = item => item?.uri ?? item?.targetUri
const normalizedUriPath = uri =>
  uri?.scheme === 'file'
    ? uri.fsPath.replaceAll('\\', '/').toLowerCase()
    : uri?.toString().toLowerCase()
const sameDocument = (left, right) => normalizedUriPath(left) === normalizedUriPath(right)
const receiptLocations = (folder, items) =>
  items.map(item => ({
    uri: relativeUri(folder, locationUri(item)),
    fsPath: normalizedUriPath(locationUri(item)),
    range: item.range ?? item.targetSelectionRange ?? item.targetRange,
  }))
const hoverText = items =>
  Array.isArray(items)
    ? items
        .flatMap(item => item.contents ?? [])
        .map(item => (typeof item === 'string' ? item : (item.value ?? String(item))))
        .join('\n')
    : ''

const completionInsertText = item =>
  typeof item?.insertText === 'string' ? item.insertText : item?.insertText?.value
const completionDocumentation = item =>
  typeof item?.documentation === 'string' ? item.documentation : item?.documentation?.value
const completionRange = item => item?.range?.replacing ?? item?.range

async function completionAt(document, position, label, triggerCharacter) {
  return waitFor(async () => {
    const result = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      document.uri,
      position,
      triggerCharacter,
    )
    const item = result?.items?.find(candidate => candidate.label === label)
    return item === undefined
      ? undefined
      : {
          item,
          labels: result.items.map(candidate => candidate.label),
          isIncomplete: result.isIncomplete,
        }
  })
}

const relativeUri = (folder, uri) => {
  const relative = vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/')
  return relative.startsWith('../') ? uri.scheme : relative
}

async function locations(command, uri, position) {
  const result = await vscode.commands.executeCommand(command, uri, position)
  return Array.isArray(result) ? result : []
}

/** Exercise real read-only CASC files via native commands and the existing public diagnostics export. */
async function probeInstalledCasc(receipt, resultPath, gameRoot) {
  const reportUri = vscode.Uri.file(`${resultPath}.window-diagnostics.json`)
  const state = (receipt.casc = { gameRoot, samples: [], completed: false })
  /** Record one editor operation without treating a single sample as a latency SLA. */
  async function measured(phase, action) {
    console.log(`installed CASC probe: ${phase}`)
    const start = Date.now()
    const value = await action()
    state.samples.push({ phase, ms: Date.now() - start })
    return value
  }
  /** Read the same bounded, redacted report users can export; never inspect private extension state. */
  async function windowState() {
    const exported = await vscode.commands.executeCommand('modkit.exportDiagnostics', reportUri)
    if (exported === undefined) throw new Error('Public diagnostics export failed')
    return JSON.parse(fs.readFileSync(reportUri.fsPath, 'utf8'))
  }
  await vscode.workspace
    .getConfiguration('modkit')
    .update(
      'contentSourceOptions',
      { 'blizzard/starcraft2': { installationDirectory: gameRoot } },
      vscode.ConfigurationTarget.Workspace,
    )
  /** Address the same provider-owned virtual file that Sources opens in the editor. */
  const sourceUri = path => vscode.Uri.parse(`modkit-source://battlenet/local%3Acasc/${path}`)
  const voidUri = sourceUri('mods/void.sc2mod/base.sc2data/gamedata/unitdata.xml')
  const libertyUri = sourceUri('mods/liberty.sc2mod/base.sc2data/gamedata/unitdata.xml')
  state.voidUri = voidUri.toString()
  state.libertyUri = libertyUri.toString()
  const voidDocument = await measured('open-Void-UnitData', async () => {
    const document = await vscode.workspace.openTextDocument(voidUri)
    await vscode.window.showTextDocument(document)
    return document
  })
  if (voidDocument.languageId !== 'sc2-data')
    throw new Error(`Native CASC UnitData used ${voidDocument.languageId}, expected sc2-data`)
  const loaded = await measured('automatic-dependency-load', () =>
    waitFor(async () => {
      const report = await windowState()
      const labels = new Set(report.loadedMods.map(mod => mod.label.toLowerCase()))
      return ['core.sc2mod', 'liberty.sc2mod', 'swarm.sc2mod', 'void.sc2mod'].every(label =>
        labels.has(label),
      )
        ? report
        : undefined
    }, 120_000),
  )
  if (loaded === undefined)
    throw new Error('Opening CASC Void did not automatically retain its four dependency mods')
  state.loadedMods = loaded.loadedMods
  state.contentSources = loaded.contentSources
  const root = await measured('Catalog-root-completion', () =>
    completionAt(voidDocument, positionOf(voidDocument, '<Catalog', 1), 'Catalog', '<'),
  )
  if (root === undefined || root.labels.length !== 1)
    throw new Error(`Native CASC root completion must offer only Catalog: ${root?.labels}`)
  state.rootCompletion = root.labels
  const liberty = await measured('open-Liberty-Marine', async () => {
    const document = await vscode.workspace.openTextDocument(libertyUri)
    await vscode.window.showTextDocument(document)
    return document
  })
  const text = liberty.getText()
  const marine = text.indexOf('<CUnit id="Marine"')
  if (marine < 0) throw new Error('Installed Liberty fixture has no Marine declaration')
  const end = text.indexOf('</CUnit>', marine)
  const openEnd = text.indexOf('>', marine) + 1
  const firstField = text.indexOf('<', openEnd)
  const life = text.indexOf('<LifeMax', openEnd)
  if (end < 0 || firstField >= end || life < 0 || life >= end)
    throw new Error('Installed Marine fixture has no readable fields/LifeMax')
  // Replace this field's name: another position correctly excludes the existing scalar LifeMax.
  const fields = await measured('Marine-field-completion', () =>
    completionAt(liberty, liberty.positionAt(life + 1), 'LifeMax', '<'),
  )
  if (fields === undefined) throw new Error('Native CASC nested Unit completion omitted LifeMax')
  state.fieldCompletion = { count: fields.labels.length, matched: fields.item.label }
  const lifeHover = await measured('Marine-resolved-value-hover', () =>
    waitFor(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        libertyUri,
        liberty.positionAt(life + 2),
      )
      const markdown = hoverText(result)
      return markdown.includes('LifeMax') && markdown.includes('45') ? markdown : undefined
    }, 60_000),
  )
  if (lifeHover === undefined)
    throw new Error('Native CASC Marine hover omitted the resolved LifeMax=45')
  state.lifeHover = lifeHover
  // These literals locate test cursors only; production classes/inheritance stay with the Data owner.
  const entityIds = [...text.matchAll(/<CUnit\s[^>]*\bid="([^"]+)"/gu)].map(match => match[1])
  const lastEntity = entityIds.at(-1)
  state.entityCount = entityIds.length
  state.lastEntity = lastEntity
  const lenses = await measured('Marine-and-document-tail-lenses', () =>
    waitFor(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeCodeLensProvider',
        libertyUri,
      )
      return result?.length > 0 ? result : undefined
    }, 60_000),
  )
  const commands = (lenses ?? []).map(lens => lens.command).filter(Boolean)
  state.codeLenses = { count: lenses?.length ?? 0, marine: [], last: [] }
  for (const [key, id] of [
    ['marine', 'Marine'],
    ['last', lastEntity],
  ]) {
    state.codeLenses[key] = commands
      .filter(command => command.arguments?.[0]?.subjectId === `Unit/${id}`)
      .map(command => ({ title: command.title, view: command.arguments[0].view }))
    if (!state.codeLenses[key].some(command => command.view === 'card'))
      throw new Error(`Native CASC CodeLens omitted the card at Unit/${id}`)
  }
  const card = commands.find(
    command =>
      command.arguments?.[0]?.subjectId === 'Unit/Marine' && command.arguments[0].view === 'card',
  )
  if (
    !(await measured('Marine-card-command', () =>
      vscode.commands.executeCommand(card.command, ...card.arguments),
    ))
  )
    throw new Error('Native CASC Marine card command did not route to the subject owner')
  state.cardCommandRouted = true
  const cardTab = await waitFor(
    () =>
      vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .find(tab => tab.label.includes('Marine')),
    60_000,
  )
  if (cardTab === undefined)
    throw new Error('Native CASC Marine card command opened no subject tab')
  state.cardTab = { label: cardTab.label, viewType: cardTab.input.viewType }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  const afterClose = await windowState()
  state.loadedModsAfterClose = afterClose.loadedMods
  const idsAfterClose = new Set(afterClose.loadedMods.map(mod => mod.id))
  if (!loaded.loadedMods.every(mod => idsAfterClose.has(mod.id)))
    throw new Error('Closing native CASC editors unloaded an existing resource mod')
  state.completed = true
}

exports.run = async function run() {
  const resultPath = process.env.MODKIT_INSTALLED_LANGUAGE_RESULT
  if (resultPath === undefined) throw new Error('MODKIT_INSTALLED_LANGUAGE_RESULT is not set')
  const receipt = {
    kind: 'modkit.vscode-installed-sc2-language',
    version: 10,
    passed: false,
    vscodeVersion: vscode.version,
  }
  let extensionApi
  try {
    const extension = vscode.extensions.getExtension('modkit.modkit-vscode')
    if (extension === undefined) throw new Error('installed modkit.modkit-vscode was not found')
    if (process.env.MODKIT_VSCODE_LANGUAGE_ONLY === '1')
      throw new Error('installed language acceptance must exercise normal full activation')
    const api = await extension.activate()
    extensionApi = api
    receipt.activationMs = api.activationMs
    receipt.extensionVersion = extension.packageJSON.version
    receipt.activationMode = 'full'
    receipt.languageRoutes = api.languageRoutes
    const expectedRoutes = [
      'galaxy:',
      'sc2-data:',
      'sc2-strings:',
      'sc2-style:',
      'sc2-layout:',
      'sc2-wizard:',
    ]
    const missingRoutes = expectedRoutes.filter(
      expected => !api.languageRoutes.some(route => route.startsWith(expected)),
    )
    if (missingRoutes.length > 0) {
      throw new Error(
        `installed host missed SC2 language routes ${missingRoutes.join(', ')}; got ${api.languageRoutes.join(', ')}`,
      )
    }
    const dataGrammar = extension.packageJSON.contributes?.grammars?.find(
      grammar => grammar.language === 'sc2-data',
    )
    if (
      dataGrammar?.scopeName !== 'text.xml.sc2-data' ||
      typeof dataGrammar.path !== 'string' ||
      !fs.existsSync(vscode.Uri.joinPath(extension.extensionUri, dataGrammar.path).fsPath)
    ) {
      throw new Error('installed extension did not package the SC2 Data XML syntax grammar')
    }
    receipt.dataSyntaxGrammar = {
      scopeName: dataGrammar.scopeName,
      path: dataGrammar.path,
    }
    const sourcesView = extension.packageJSON.contributes?.views?.modkit?.find(
      view => view.id === 'modkit.sources',
    )
    const registeredCommands = await vscode.commands.getCommands(true)
    const hasRefreshCommand = registeredCommands.includes('modkit.sources.refresh')
    const hasOpenCommand = registeredCommands.includes('modkit.sources.open')
    const refreshResult = hasRefreshCommand
      ? await vscode.commands.executeCommand('modkit.sources.refresh')
      : undefined
    if (
      sourcesView?.id !== 'modkit.sources' ||
      typeof sourcesView.name !== 'string' ||
      sourcesView.name.length === 0 ||
      !hasRefreshCommand ||
      !hasOpenCommand ||
      refreshResult !== true
    ) {
      throw new Error(
        `installed extension did not register the persistent Sources view workflow: ` +
          `${JSON.stringify({ sourcesView, hasRefreshCommand, hasOpenCommand, refreshResult })}`,
      )
    }
    receipt.sourcesView = {
      id: sourcesView.id,
      name: sourcesView.name,
      refreshCommand: 'modkit.sources.refresh',
      openCommand: 'modkit.sources.open',
    }
    const resourcesView = extension.packageJSON.contributes?.views?.modkit?.find(
      view => view.id === 'modkit.resources',
    )
    const hasResourcesRefreshCommand = registeredCommands.includes('modkit.resources.refresh')
    const hasResourcesSearchCommand = registeredCommands.includes('modkit.resources.search')
    const hasResourcesOpenCommand = registeredCommands.includes('modkit.resources.open')
    const resourcesRefreshResult = hasResourcesRefreshCommand
      ? await vscode.commands.executeCommand('modkit.resources.refresh')
      : undefined
    if (
      resourcesView?.id !== 'modkit.resources' ||
      typeof resourcesView.name !== 'string' ||
      resourcesView.name.length === 0 ||
      !hasResourcesRefreshCommand ||
      !hasResourcesSearchCommand ||
      !hasResourcesOpenCommand ||
      resourcesRefreshResult !== true
    ) {
      throw new Error(
        `installed extension did not register the persistent Resources view workflow: ` +
          `${JSON.stringify({
            resourcesView,
            hasResourcesRefreshCommand,
            hasResourcesSearchCommand,
            hasResourcesOpenCommand,
            resourcesRefreshResult,
          })}`,
      )
    }
    receipt.resourcesView = {
      id: resourcesView.id,
      name: resourcesView.name,
      refreshCommand: 'modkit.resources.refresh',
      searchCommand: 'modkit.resources.search',
      openCommand: 'modkit.resources.open',
    }
    if (process.env.MODKIT_INSTALLED_CASC_ONLY === '1') {
      const gameRoot = process.env.MODKIT_INSTALLED_CASC_ROOT
      if (gameRoot === undefined) throw new Error('CASC-only acceptance requires an installation')
      receipt.scope = 'installed CASC native API; six synthetic language fixtures not exercised'
      await probeInstalledCasc(receipt, resultPath, gameRoot)
      receipt.passed = true
      return
    }
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (folder === undefined) throw new Error('SC2 fixture workspace is not open')
    const fixture = {
      galaxy: 'Base.SC2Data/MapScript.galaxy',
      galaxyDependency: 'Base.SC2Data/Lib.galaxy',
      data: 'Base.SC2Data/GameData/UnitData.xml',
      actorData: 'Base.SC2Data/GameData/ActorData.xml',
      onTypeData: 'Base.SC2Data/GameData/OnTypeData.xml',
      attributeData: 'Base.SC2Data/GameData/AttributeData.xml',
      nestedData: 'Base.SC2Data/GameData/NestedData.xml',
      documentRoot: 'RootOnly.SC2Data/GameData/RootData.xml',
      editedUnit: 'Latency.SC2Data/GameData/UnitData.xml',
      emptyUnit: 'EmptyUnit.SC2Data/GameData/UnitData.xml',
      emptyActor: 'EmptyActor.SC2Data/GameData/ActorData.xml',
      emptyCustom: 'EmptyCustom.SC2Data/GameData/CustomData.xml',
      strings: 'enUS.SC2Data/LocalizedData/GameStrings.txt',
      style: 'Base.SC2Data/UI/FontStyles.SC2Style',
      layout: 'Base.SC2Data/UI/Layout/Hud.SC2Layout',
      wizard: 'Base.SC2Data/Wizards/Native.BlizWiz',
    }
    const uris = Object.fromEntries(
      Object.entries(fixture).map(([key, relative]) => [
        key,
        vscode.Uri.joinPath(folder.uri, relative),
      ]),
    )
    const documents = Object.fromEntries(
      await Promise.all(
        Object.entries(uris).map(async ([key, uri]) => [
          key,
          await vscode.workspace.openTextDocument(uri),
        ]),
      ),
    )
    const advertisedLanguage = {
      galaxy: 'galaxy',
      galaxyDependency: 'galaxy',
      data: 'sc2-data',
      actorData: 'sc2-data',
      onTypeData: 'sc2-data',
      attributeData: 'sc2-data',
      nestedData: 'sc2-data',
      documentRoot: 'sc2-data',
      editedUnit: 'sc2-data',
      emptyUnit: 'sc2-data',
      emptyActor: 'sc2-data',
      emptyCustom: 'sc2-data',
      strings: 'sc2-strings',
      style: 'sc2-style',
      layout: 'sc2-layout',
      wizard: 'sc2-wizard',
    }
    receipt.documentLanguages = Object.fromEntries(
      Object.entries(documents).map(([key, document]) => [key, document.languageId]),
    )
    receipt.advertisedLanguages = advertisedLanguage
    receipt.languageModeGaps = Object.fromEntries(
      Object.entries(documents)
        .filter(([key, document]) => document.languageId !== advertisedLanguage[key])
        .map(([key, document]) => [key, document.languageId]),
    )
    const mixedCaseDiscovery = await Promise.all([
      vscode.workspace.findFiles('**/*.[sS][cC]2[sS][tT][yY][lL][eE]'),
      vscode.workspace.findFiles('**/*.[sS][cC]2[lL][aA][yY][oO][uU][tT]'),
    ])
    receipt.mixedCaseDiscovery = mixedCaseDiscovery.flat().map(uri => relativeUri(folder, uri))
    if (
      !mixedCaseDiscovery[0].some(uri => uri.toString() === uris.style.toString()) ||
      !mixedCaseDiscovery[1].some(uri => uri.toString() === uris.layout.toString())
    ) {
      throw new Error('VS Code workspace discovery missed mixed-case SC2 Style/Layout suffixes')
    }
    await vscode.window.showTextDocument(documents.galaxy)

    const galaxyDefinition = await waitFor(async () => {
      const result = await locations(
        'vscode.executeDefinitionProvider',
        uris.galaxy,
        positionOf(documents.galaxy, 'Helper(2)', 2),
      )
      return result.some(item => locationUri(item)?.toString() === uris.galaxyDependency.toString())
        ? result
        : undefined
    })
    if (galaxyDefinition === undefined)
      throw new Error('Galaxy definition did not reach the unopened dependency source')
    const galaxyHover = await waitFor(async () => {
      const text = hoverText(
        await vscode.commands.executeCommand(
          'vscode.executeHoverProvider',
          uris.galaxy,
          positionOf(documents.galaxy, 'Helper(2)', 2),
        ),
      )
      return text.includes('int Helper(int amount)') ? text : undefined
    })
    if (galaxyHover === undefined)
      throw new Error('Galaxy hover did not expose the dependency signature')
    const galaxyCompletion = await waitFor(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        uris.galaxy,
        positionOf(documents.galaxy, 'Helper(2)', 2),
      )
      return result?.items?.some(item => item.label === 'Helper') ? result : undefined
    })
    if (galaxyCompletion === undefined) throw new Error('Galaxy completion did not include Helper')
    const signature = await waitFor(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeSignatureHelpProvider',
        uris.galaxy,
        positionOf(documents.galaxy, 'Helper(2)', 'Helper('.length),
      )
      return result?.signatures?.some(item => item.label.includes('Helper')) ? result : undefined
    })
    if (signature === undefined) throw new Error('Galaxy signature help did not include Helper')
    let galaxyReferencesProbe = []
    const galaxyReferences = await waitFor(async () => {
      const result = await locations(
        'vscode.executeReferenceProvider',
        uris.galaxyDependency,
        positionOf(documents.galaxyDependency, 'Helper', 2),
      )
      galaxyReferencesProbe = result
      return result.some(item => sameDocument(locationUri(item), uris.galaxy)) &&
        result.some(item => sameDocument(locationUri(item), uris.galaxyDependency))
        ? result
        : undefined
    })
    receipt.galaxyReferences = receiptLocations(folder, galaxyReferencesProbe)
    if (galaxyReferences === undefined)
      throw new Error('Galaxy references did not span declaration and caller')

    const dataHover = await waitFor(async () => {
      const text = hoverText(
        await vscode.commands.executeCommand(
          'vscode.executeHoverProvider',
          uris.data,
          positionOf(documents.data, 'LifeMax', 2),
        ),
      )
      return text.includes('LifeMax') ? text : undefined
    })
    if (dataHover === undefined) throw new Error('Data hover failed')
    const resolvedDataContext = await waitFor(() =>
      extensionApi
        .diagnostics()
        .find(
          line =>
            line.includes('inputs=resolved-data-snapshot:blizzard/starcraft-2') ||
            line.includes(',resolved-data-snapshot:blizzard/starcraft-2') ||
            line.includes('inputs=resolved-data-authoring-index:blizzard/starcraft-2') ||
            line.includes(',resolved-data-authoring-index:blizzard/starcraft-2'),
        ),
    )
    if (resolvedDataContext === undefined)
      throw new Error('Data provider did not receive a canonical host Data semantic context')
    receipt.resolvedDataContext = resolvedDataContext
    const dataRootCompletion = await waitFor(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        uris.data,
        new vscode.Position(2, 5),
        '<',
      )
      const labels = result?.items?.map(item => item.label).sort() ?? []
      return ['CUnit', 'CUnitHero', 'const'].every(label => labels.includes(label))
        ? labels
        : undefined
    })
    if (dataRootCompletion === undefined)
      throw new Error('Data root completion did not include CUnit, CUnitHero and const after <')
    receipt.dataRootCompletion = dataRootCompletion
    receipt.verifiedCompletionTriggerCharacters = ['<']

    const documentRootStarted = Date.now()
    const documentRootResult = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      uris.documentRoot,
      new vscode.Position(1, 1),
      '<',
    )
    const documentRootMs = Date.now() - documentRootStarted
    const documentRootLabels = documentRootResult?.items?.map(item => item.label).sort() ?? []
    if (documentRootLabels.length !== 1 || documentRootLabels[0] !== 'Catalog') {
      throw new Error(
        `Data document root must offer only Catalog; got ${documentRootLabels.join(', ')}`,
      )
    }
    if (documentRootMs > 1_500) {
      throw new Error(`Data document-root completion took ${documentRootMs} ms (limit 1500 ms)`)
    }
    receipt.dataDocumentRootCompletion = {
      labels: documentRootLabels,
      elapsedMs: documentRootMs,
    }

    const editedUnitEditor = await vscode.window.showTextDocument(documents.editedUnit)
    const editedUnitStart = positionOf(
      documents.editedUnit,
      '<Catalog>\n    ',
      '<Catalog>\n    '.length,
    )
    if (!(await editedUnitEditor.edit(builder => builder.insert(editedUnitStart, '<')))) {
      throw new Error('VS Code refused the Data completion latency edit')
    }
    const editedUnitPosition = editedUnitStart.translate(0, 1)
    const editedUnitStarted = Date.now()
    const editedUnitResult = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      uris.editedUnit,
      editedUnitPosition,
      '<',
    )
    const editedUnitMs = Date.now() - editedUnitStarted
    const editedUnitLabels = editedUnitResult?.items?.map(item => item.label) ?? []
    if (!editedUnitLabels.includes('CUnit')) {
      throw new Error('edited UnitData.xml completion did not include CUnit after <')
    }
    if (editedUnitMs > 1_000) {
      throw new Error(`edited Data completion took ${editedUnitMs} ms (limit 1000 ms)`)
    }
    receipt.dataEditedCompletion = {
      contains: 'CUnit',
      elapsedMs: editedUnitMs,
    }

    const assetCompletion = await completionAt(
      documents.actorData,
      positionOf(documents.actorData, 'value="Assets/', 'value="Assets/'.length),
      'Assets\\Test\\Intro.ogv',
    )
    if (assetCompletion === undefined)
      throw new Error('Data file-field completion did not resolve the workspace asset path')
    receipt.dataAssetCompletion = {
      label: assetCompletion.item.label,
      detail: assetCompletion.item.detail,
      insertText: completionInsertText(assetCompletion.item),
    }

    const onTypeEditor = await vscode.window.showTextDocument(documents.onTypeData)
    const beforeEquals = positionOf(documents.onTypeData, '<Mob value', '<Mob value'.length)
    const insertedEquals = await onTypeEditor.edit(builder => builder.insert(beforeEquals, '='))
    if (!insertedEquals) throw new Error('VS Code refused the Data on-type trigger edit')
    const quotedOnType = await waitFor(() =>
      documents.onTypeData.getText().includes('<Mob value=""') ? true : undefined,
    )
    if (quotedOnType === undefined)
      throw new Error('Data on-type action did not insert paired quotes')
    const onTypeCursor = beforeEquals.translate(0, 1)
    if (!onTypeEditor.selection.active.isEqual(onTypeCursor))
      throw new Error('Data on-type action did not leave the caret between paired quotes')
    const onTypeCompletion = await completionAt(documents.onTypeData, onTypeCursor, 'Multiplayer')
    if (onTypeCompletion === undefined)
      throw new Error('Data on-type action did not leave value completion available')
    receipt.dataOnTypeEdit = {
      text: documents.onTypeData.getText(),
      cursor: { line: onTypeCursor.line, character: onTypeCursor.character },
      completion: onTypeCompletion.item.label,
    }

    const attributeEditor = await vscode.window.showTextDocument(documents.attributeData)
    const entityAttributeStart = positionOf(
      documents.attributeData,
      '<CUnit id="AttributeProbe"',
      '<CUnit id="AttributeProbe"'.length,
    )
    if (!(await attributeEditor.edit(builder => builder.insert(entityAttributeStart, ' ')))) {
      throw new Error('VS Code refused the entity-attribute completion edit')
    }
    const entityAttributeCursor = entityAttributeStart.translate(0, 1)
    const parentAttribute = await completionAt(
      documents.attributeData,
      entityAttributeCursor,
      'parent',
      ' ',
    )
    if (parentAttribute === undefined)
      throw new Error('Data entity attributes did not include parent after a space')
    if (parentAttribute.labels.includes('id'))
      throw new Error('Data entity attributes repeated the already present id attribute')
    const parentRange = completionRange(parentAttribute.item)
    const parentInsertText = completionInsertText(parentAttribute.item)
    const parentDocumentation = completionDocumentation(parentAttribute.item)
    if (
      !(parentRange instanceof vscode.Range) ||
      !parentRange.start.isEqual(entityAttributeCursor) ||
      !parentRange.end.isEqual(entityAttributeCursor)
    )
      throw new Error('Data parent attribute completion did not target the current cursor')
    if (
      !(parentAttribute.item.insertText instanceof vscode.SnippetString) ||
      parentInsertText !== 'parent="$0"'
    )
      throw new Error('Data parent attribute completion did not include its quote snippet')
    if (typeof parentDocumentation !== 'string' || !parentDocumentation.includes('Reference'))
      throw new Error('Data parent attribute completion did not expose reference documentation')

    const fieldAttributeStart = positionOf(documents.attributeData, '<Mob', '<Mob'.length)
    if (!(await attributeEditor.edit(builder => builder.insert(fieldAttributeStart, ' ')))) {
      throw new Error('VS Code refused the field-attribute completion edit')
    }
    const fieldAttributeCursor = fieldAttributeStart.translate(0, 1)
    const valueAttribute = await completionAt(
      documents.attributeData,
      fieldAttributeCursor,
      'value',
      ' ',
    )
    if (valueAttribute === undefined)
      throw new Error('Data field attributes did not include value after a space')
    const valueRange = completionRange(valueAttribute.item)
    const valueInsertText = completionInsertText(valueAttribute.item)
    const valueDocumentation = completionDocumentation(valueAttribute.item)
    if (
      !(valueRange instanceof vscode.Range) ||
      !valueRange.start.isEqual(fieldAttributeCursor) ||
      !valueRange.end.isEqual(fieldAttributeCursor)
    )
      throw new Error('Data value attribute completion did not target the current cursor')
    if (
      !(valueAttribute.item.insertText instanceof vscode.SnippetString) ||
      valueInsertText !== 'value="$0"'
    )
      throw new Error('Data value attribute completion did not include its quote snippet')
    if (typeof valueDocumentation !== 'string' || !valueDocumentation.includes('Reference'))
      throw new Error('Data value attribute completion did not expose reference documentation')

    attributeEditor.selection = new vscode.Selection(valueRange.start, valueRange.end)
    await attributeEditor.insertSnippet(valueAttribute.item.insertText, valueRange)
    const appliedValueAttribute = await waitFor(() =>
      documents.attributeData.getText().includes('<Mob value=""/>') ? true : undefined,
    )
    if (appliedValueAttribute === undefined)
      throw new Error(
        'VS Code did not apply the Data value attribute snippet: ' +
          JSON.stringify({
            text: documents.attributeData.getText(),
            activeDocument: vscode.window.activeTextEditor?.document.uri.toString(),
            expectedDocument: documents.attributeData.uri.toString(),
            selection: attributeEditor.selection,
            valueRange,
            valueInsertText,
          }),
      )
    const valueCursor = attributeEditor.selection.active
    const quotedValueCompletion = await completionAt(
      documents.attributeData,
      valueCursor,
      'Multiplayer',
      '"',
    )
    if (quotedValueCompletion === undefined)
      throw new Error('Data enum values were unavailable between the inserted quotes')
    receipt.dataAttributeCompletion = {
      entityCandidate: parentAttribute.item.label,
      excludesPresentId: true,
      fieldCandidate: valueAttribute.item.label,
      parentSnippet: parentInsertText,
      valueSnippet: valueInsertText,
      snippetsAppliedByVsCode: true,
      quotedValueCandidate: quotedValueCompletion.item.label,
      referenceDocumentation: true,
    }

    const nestedEditor = await vscode.window.showTextDocument(documents.nestedData)
    const unitFieldCursor = positionOf(
      documents.nestedData,
      '<CUnit id="NestedProbe">\n        <',
      '<CUnit id="NestedProbe">\n        <'.length,
    )
    const addedOnCompletion = await completionAt(
      documents.nestedData,
      unitFieldCursor,
      'AddedOnArray',
      '<',
    )
    if (addedOnCompletion === undefined)
      throw new Error('Data nested completion did not include AddedOnArray')
    const addedOnInsertText = completionInsertText(addedOnCompletion.item)
    if (
      !(addedOnCompletion.item.insertText instanceof vscode.SnippetString) ||
      addedOnInsertText !== 'AddedOnArray index="$1" value="$0"/>'
    )
      throw new Error('Data array snippet did not include index and value placeholders')

    const fidgetCompletion = await completionAt(
      documents.nestedData,
      unitFieldCursor,
      'Fidget',
      '<',
    )
    if (fidgetCompletion === undefined)
      throw new Error('Data nested completion did not include the Fidget structure')
    const fidgetRange = completionRange(fidgetCompletion.item)
    const fidgetInsertText = completionInsertText(fidgetCompletion.item)
    if (
      !(fidgetRange instanceof vscode.Range) ||
      !(fidgetCompletion.item.insertText instanceof vscode.SnippetString) ||
      fidgetInsertText !== 'Fidget>\n\t$0\n</Fidget>'
    )
      throw new Error('Data Fidget completion did not expose its structure snippet and range')
    nestedEditor.selection = new vscode.Selection(fidgetRange.start, fidgetRange.end)
    await nestedEditor.insertSnippet(fidgetCompletion.item.insertText, fidgetRange)
    const fidgetApplied = await waitFor(() =>
      documents.nestedData.getText().includes('<Fidget>') ? true : undefined,
    )
    if (fidgetApplied === undefined)
      throw new Error('VS Code did not apply the nested Fidget snippet')

    const nestedFieldStart = nestedEditor.selection.active
    if (!(await nestedEditor.edit(builder => builder.insert(nestedFieldStart, '<')))) {
      throw new Error('VS Code refused the nested structure completion edit')
    }
    const nestedFieldCursor = nestedFieldStart.translate(0, 1)
    const chanceCompletion = await completionAt(
      documents.nestedData,
      nestedFieldCursor,
      'ChanceArray',
      '<',
    )
    if (chanceCompletion === undefined)
      throw new Error('Data nested structure completion did not include ChanceArray')
    const chanceInsertText = completionInsertText(chanceCompletion.item)
    const chanceRange = completionRange(chanceCompletion.item)
    if (
      !(chanceCompletion.item.insertText instanceof vscode.SnippetString) ||
      chanceInsertText !== 'ChanceArray index="$1" value="$0"/>' ||
      !(chanceRange instanceof vscode.Range)
    )
      throw new Error('Data nested array completion did not include index and value placeholders')
    nestedEditor.selection = new vscode.Selection(chanceRange.start, chanceRange.end)
    await nestedEditor.insertSnippet(chanceCompletion.item.insertText, chanceRange)
    const nestedArrayApplied = await waitFor(() =>
      documents.nestedData.getText().includes('<ChanceArray index="" value=""/>')
        ? true
        : undefined,
    )
    if (nestedArrayApplied === undefined)
      throw new Error('VS Code did not apply the nested array snippet')
    receipt.dataNestedCompletion = {
      unitArrayCandidate: addedOnCompletion.item.label,
      unitArraySnippet: addedOnInsertText,
      structureCandidate: fidgetCompletion.item.label,
      structureSnippet: fidgetInsertText,
      nestedArrayCandidate: chanceCompletion.item.label,
      nestedArraySnippet: chanceInsertText,
      nestedArrayAppliedByVsCode: true,
    }

    const delimitedValueEditor = await vscode.window.showTextDocument(documents.onTypeData)
    const firstFlagEnd = positionOf(documents.onTypeData, 'NoPlacement', 'NoPlacement'.length)
    const insertedComma = await delimitedValueEditor.edit(builder =>
      builder.insert(firstFlagEnd, ','),
    )
    if (!insertedComma) throw new Error('VS Code refused the Data comma trigger edit')
    const commaCursor = firstFlagEnd.translate(0, 1)
    const commaCompletion = await completionAt(documents.onTypeData, commaCursor, 'NoPalettes', ',')
    if (commaCompletion === undefined)
      throw new Error('Data flags completion did not continue after comma')
    if (commaCompletion.labels.includes('NoPlacement'))
      throw new Error('Data flags completion repeated a value already used before comma')
    const commaRange = completionRange(commaCompletion.item)
    if (
      !(commaRange instanceof vscode.Range) ||
      !commaRange.start.isEqual(commaCursor) ||
      !commaRange.end.isEqual(commaCursor)
    )
      throw new Error('Data flags completion after comma did not target the empty current segment')

    const typedFlagPrefix = 'NoP'
    const insertedFlagPrefix = await delimitedValueEditor.edit(builder =>
      builder.insert(commaCursor, typedFlagPrefix),
    )
    if (!insertedFlagPrefix) throw new Error('VS Code refused the Data flag prefix edit')
    const prefixEnd = commaCursor.translate(0, typedFlagPrefix.length)
    const prefixCompletion = await completionAt(documents.onTypeData, prefixEnd, 'NoPalettes')
    if (prefixCompletion === undefined)
      throw new Error('Data flags completion did not match the current comma segment')
    const prefixRange = completionRange(prefixCompletion.item)
    if (
      !(prefixRange instanceof vscode.Range) ||
      !prefixRange.start.isEqual(commaCursor) ||
      !prefixRange.end.isEqual(prefixEnd)
    )
      throw new Error('Data flags completion replaced more than the current comma segment')
    const prefixInsertText = completionInsertText(prefixCompletion.item)
    if (typeof prefixInsertText !== 'string')
      throw new Error('Data flags completion did not expose plain insertion text')
    const acceptedFlag = await delimitedValueEditor.edit(builder =>
      builder.replace(prefixRange, prefixInsertText),
    )
    if (!acceptedFlag) throw new Error('VS Code refused the Data flag completion edit')

    const secondFlagEnd = positionOf(
      documents.onTypeData,
      'NoPlacement,NoPalettes',
      'NoPlacement,NoPalettes'.length,
    )
    const insertedSemicolon = await delimitedValueEditor.edit(builder =>
      builder.insert(secondFlagEnd, ';'),
    )
    if (!insertedSemicolon) throw new Error('VS Code refused the Data semicolon trigger edit')
    const semicolonCursor = secondFlagEnd.translate(0, 1)
    const semicolonCompletion = await completionAt(
      documents.onTypeData,
      semicolonCursor,
      'BlockStructures',
      ';',
    )
    if (semicolonCompletion === undefined)
      throw new Error('Data flags completion did not continue after semicolon')
    if (
      semicolonCompletion.labels.includes('NoPlacement') ||
      semicolonCompletion.labels.includes('NoPalettes')
    )
      throw new Error('Data flags completion repeated a value already used before semicolon')
    const semicolonRange = completionRange(semicolonCompletion.item)
    if (
      !(semicolonRange instanceof vscode.Range) ||
      !semicolonRange.start.isEqual(semicolonCursor) ||
      !semicolonRange.end.isEqual(semicolonCursor)
    )
      throw new Error(
        'Data flags completion after semicolon did not target the empty current segment',
      )
    receipt.dataDelimitedValueCompletion = {
      commaCandidate: commaCompletion.item.label,
      commaReplacement: {
        start: { line: commaRange.start.line, character: commaRange.start.character },
        end: { line: commaRange.end.line, character: commaRange.end.character },
      },
      acceptedValue: prefixInsertText,
      semicolonCandidate: semicolonCompletion.item.label,
      excludesUsedValues: true,
    }
    receipt.verifiedCompletionTriggerCharacters = ['<', ' ', '"', '=', ',', ';']

    const emptyRootPosition = document =>
      positionOf(document, '<Catalog>\n    ', '<Catalog>\n    '.length)
    const emptyUnitPosition = emptyRootPosition(documents.emptyUnit)
    const emptyActorPosition = emptyRootPosition(documents.emptyActor)
    const emptyCustomPosition = emptyRootPosition(documents.emptyCustom)
    const emptyUnitCompletion = await completionAt(documents.emptyUnit, emptyUnitPosition, 'CUnit')
    const emptyActorCompletion = await completionAt(
      documents.emptyActor,
      emptyActorPosition,
      'CActor',
    )
    const emptyCustomCompletion = await completionAt(
      documents.emptyCustom,
      emptyCustomPosition,
      'CActor',
    )
    if (emptyUnitCompletion === undefined)
      throw new Error('empty UnitData.xml completion did not include CUnit')
    if (emptyActorCompletion === undefined)
      throw new Error('empty ActorData.xml completion did not include CActor')
    if (
      emptyCustomCompletion === undefined ||
      !emptyCustomCompletion.labels.includes('CAbil') ||
      emptyCustomCompletion.isIncomplete !== true
    )
      throw new Error('empty custom *Data.xml completion was not catalog-untyped')

    const unitItem = emptyUnitCompletion.item
    const unitInsertText = completionInsertText(unitItem)
    const unitDocumentation = completionDocumentation(unitItem)
    const unitRange = completionRange(unitItem)
    if (typeof unitInsertText !== 'string' || !unitInsertText.includes('CUnit'))
      throw new Error('CUnit completion did not expose an insertText snippet')
    if (!(unitItem.insertText instanceof vscode.SnippetString))
      throw new Error('CUnit completion insertText was not a VS Code SnippetString')
    if (
      !(unitRange instanceof vscode.Range) ||
      !unitRange.start.isEqual(emptyUnitPosition) ||
      !unitRange.end.isEqual(emptyUnitPosition)
    )
      throw new Error('CUnit completion did not expose the empty catalog insertion range')
    if (typeof unitDocumentation !== 'string' || unitDocumentation.trim().length === 0)
      throw new Error('CUnit completion did not expose documentation')
    receipt.emptyDataCompletion = {
      unitLabels: emptyUnitCompletion.labels,
      actorLabels: emptyActorCompletion.labels,
      customLabels: emptyCustomCompletion.labels,
      customIsIncomplete: emptyCustomCompletion.isIncomplete,
      customHasAbilAndActor: true,
      cunit: {
        insertText: unitInsertText,
        insertTextIsSnippet: unitItem.insertText instanceof vscode.SnippetString,
        range: {
          start: { line: unitRange.start.line, character: unitRange.start.character },
          end: { line: unitRange.end.line, character: unitRange.end.character },
        },
        documentation: unitDocumentation,
      },
    }

    const completionEditor = await vscode.window.showTextDocument(documents.emptyUnit)
    completionEditor.selection = new vscode.Selection(unitRange.start, unitRange.end)
    await completionEditor.insertSnippet(unitItem.insertText, unitRange)
    const appliedCompletion = await waitFor(() => {
      const text = documents.emptyUnit.getText()
      return text.includes('<CUnit id="">') && text.includes('</CUnit>') && !text.includes('$')
        ? text
        : undefined
    }, 5_000)
    if (appliedCompletion === undefined)
      throw new Error('VS Code did not apply the CUnit SnippetString to the document')
    receipt.emptyDataCompletion.appliedThroughTextEditorSnippetApi = true
    receipt.emptyDataCompletion.applicationBoundary =
      'VS Code exposes no command to accept a specific CompletionItem; acceptSelectedSuggestion is nondeterministic when the built-in XML provider competes.'
    receipt.emptyDataCompletion.appliedText = appliedCompletion
    await vscode.window.showTextDocument(documents.galaxy)

    const dataDefinition = await waitFor(async () => {
      const result = await locations(
        'vscode.executeDefinitionProvider',
        uris.data,
        positionOf(documents.data, 'parent="Marine"', 'parent="'.length + 2),
      )
      return result.some(item => locationUri(item)?.toString() === uris.data.toString())
        ? result
        : undefined
    })
    if (dataDefinition === undefined)
      throw new Error('Data parent definition did not resolve to the local Marine declaration')
    const dataReferences = await waitFor(async () => {
      const result = await locations(
        'vscode.executeReferenceProvider',
        uris.data,
        positionOf(documents.data, 'id="Marine"', 'id="'.length + 2),
      )
      return result.length >= 1 &&
        result.every(item => locationUri(item)?.toString() === uris.data.toString())
        ? result
        : undefined
    })
    if (dataReferences === undefined) throw new Error('Data references missed the parent relation')

    const stringsHover = await waitFor(async () => {
      const text = hoverText(
        await vscode.commands.executeCommand(
          'vscode.executeHoverProvider',
          uris.strings,
          positionOf(documents.strings, 'UI/ScoreTitle', 3),
        ),
      )
      return text.includes('UI/ScoreTitle') ? text : undefined
    })
    if (stringsHover === undefined) throw new Error('Strings hover failed')
    const stringsDefinition = await waitFor(async () => {
      const result = await locations(
        'vscode.executeDefinitionProvider',
        uris.strings,
        positionOf(documents.strings, 'UI/ScoreTitle', 3),
      )
      return result.some(item => locationUri(item)?.toString() === uris.strings.toString())
        ? result
        : undefined
    })
    if (stringsDefinition === undefined)
      throw new Error('Strings key definition did not resolve to its catalog entry')

    const styleHover = await waitFor(async () => {
      for (let delta = 0; delta <= '#ColorTitle'.length; delta += 1) {
        const text = hoverText(
          await vscode.commands.executeCommand(
            'vscode.executeHoverProvider',
            uris.style,
            positionOf(documents.style, '#ColorTitle', delta),
          ),
        )
        if (text.includes('ColorTitle') && text.includes('ffcc00')) return text
      }
      return undefined
    })
    if (styleHover === undefined) throw new Error('Style hover did not resolve the constant chain')
    const styleReferences = await waitFor(async () => {
      const result = await locations(
        'vscode.executeReferenceProvider',
        uris.style,
        positionOf(documents.style, 'name="ColorTitle"', 'name="'.length + 2),
      )
      return result.length >= 1 ? result : undefined
    })
    if (styleReferences === undefined) throw new Error('Style references missed ColorTitle uses')

    let layoutStyleDefinitionProbe = []
    const layoutStyleDefinition = await waitFor(async () => {
      const result = await locations(
        'vscode.executeDefinitionProvider',
        uris.layout,
        positionOf(documents.layout, '@@Title', 3),
      )
      layoutStyleDefinitionProbe = result
      return result.some(item => sameDocument(locationUri(item), uris.style)) ? result : undefined
    })
    receipt.layoutStyleDefinition = receiptLocations(folder, layoutStyleDefinitionProbe)
    if (layoutStyleDefinition === undefined)
      throw new Error('Layout Style value did not resolve to FontStyles.SC2Style')
    let layoutStringDefinitionProbe = []
    const layoutStringDefinition = await waitFor(async () => {
      const result = await locations(
        'vscode.executeDefinitionProvider',
        uris.layout,
        positionOf(documents.layout, '@UI/ScoreTitle', 4),
      )
      layoutStringDefinitionProbe = result
      return result.some(item => sameDocument(locationUri(item), uris.strings)) ? result : undefined
    })
    receipt.layoutStringDefinition = receiptLocations(folder, layoutStringDefinitionProbe)
    if (layoutStringDefinition === undefined)
      throw new Error('Layout text key did not resolve to GameStrings.txt')

    const formatting = await waitFor(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeFormatDocumentProvider',
        uris.galaxy,
        { tabSize: 4, insertSpaces: true },
      )
      return Array.isArray(result) ? result : undefined
    })
    if (formatting === undefined) throw new Error('Galaxy formatting provider was not registered')
    const actions = await waitFor(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeCodeActionProvider',
        uris.galaxy,
        new vscode.Range(
          0,
          0,
          documents.galaxy.lineCount - 1,
          documents.galaxy.lineAt(documents.galaxy.lineCount - 1).text.length,
        ),
        undefined,
        16,
      )
      return Array.isArray(result) && result.some(item => item.title === 'Add final newline')
        ? result
        : undefined
    })
    if (actions === undefined)
      throw new Error('Galaxy code actions did not offer Add final newline')
    const workspaceSymbols = await waitFor(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeWorkspaceSymbolProvider',
        'Helper',
      )
      return Array.isArray(result) && result.some(item => item.name === 'Helper')
        ? result
        : undefined
    })
    if (workspaceSymbols === undefined) throw new Error('Workspace symbols did not include Helper')

    const wizardControl = await completionAt(
      documents.wizard,
      positionOf(documents.wizard, 'type="WizardText"', 'type="'.length),
      'WizardCheckbox',
    )
    const wizardField = await completionAt(
      documents.wizard,
      positionOf(documents.wizard, 'field id="LifeMax"', 'field id="'.length),
      'Acceleration',
    )
    const wizardToken = await completionAt(
      documents.wizard,
      positionOf(documents.wizard, 'value="^Scale^"', 'value="^'.length),
      'Scale',
      '^',
    )
    receipt.wizardCompletionProbe = {
      control: wizardControl?.item.label,
      field: wizardField?.item.label,
      token: wizardToken?.item.label,
      triggerCharacters: extensionApi.completionTriggerCharacters,
    }
    if (wizardControl === undefined || wizardField === undefined || wizardToken === undefined)
      throw new Error(
        'Wizard completion missed canonical control types, Data schema fields or macros',
      )
    const wizardDefinition = await waitFor(async () => {
      const result = await locations(
        'vscode.executeDefinitionProvider',
        uris.wizard,
        positionOf(documents.wizard, '^Scale^', 3),
      )
      return result.some(item => sameDocument(locationUri(item), uris.wizard)) ? result : undefined
    })
    const wizardHover = await waitFor(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        uris.wizard,
        positionOf(documents.wizard, '^Scale^', 3),
      )
      return hoverText(result).includes('42') ? result : undefined
    })
    if (wizardDefinition === undefined || wizardHover === undefined)
      throw new Error('Wizard macro definition or canonical value hover failed in native VS Code')
    receipt.wizard = {
      controls: wizardControl.item.label,
      schemaField: wizardField.item.label,
      token: wizardToken.item.label,
      definitions: receiptLocations(folder, wizardDefinition),
      hover: hoverText(wizardHover),
    }

    const initialVersion = documents.galaxy.version
    const overlay = new vscode.WorkspaceEdit()
    overlay.replace(
      uris.galaxy,
      new vscode.Range(
        positionOf(documents.galaxy, 'Helper(2)'),
        positionOf(documents.galaxy, 'Helper(2)', 'Helper'.length),
      ),
      'Missing',
    )
    if (!(await vscode.workspace.applyEdit(overlay)))
      throw new Error('unsaved Galaxy overlay was rejected')
    let overlayDiagnosticsProbe = []
    const overlayDiagnostics = await waitFor(() => {
      const items = vscode.languages.getDiagnostics(uris.galaxy)
      overlayDiagnosticsProbe = items
      return items.some(item => item.message.includes("Function 'Missing'")) ? items : undefined
    })
    receipt.overlayDiagnostics = overlayDiagnosticsProbe.map(item => ({
      code: String(item.code),
      message: item.message,
      severity: item.severity,
    }))
    if (overlayDiagnostics === undefined)
      throw new Error('Galaxy diagnostics did not observe the unsaved Missing overlay')
    if (!documents.galaxy.isDirty || documents.galaxy.version <= initialVersion)
      throw new Error('VS Code did not retain the unsaved document revision')
    await vscode.window.showTextDocument(documents.galaxy)
    const verified = await vscode.commands.executeCommand('modkit.verifyDocument')
    if (!verified?.diagnostics.some(item => item.message.includes("Function 'Missing'")))
      throw new Error(
        'Verify did not check the unsaved Galaxy document through the language provider',
      )
    if (
      !vscode.languages
        .getDiagnostics(uris.galaxy)
        .some(item => item.message.includes("Function 'Missing'"))
    )
      throw new Error('Verify did not publish the provider findings to Problems')
    receipt.explicitVerification = {
      command: 'modkit.verifyDocument',
      checkedUnsavedBuffer: documents.galaxy.isDirty,
      publishedToProblems: true,
      isIncomplete: verified.isIncomplete,
    }
    receipt.explicitVerification.languages = {}
    for (const key of ['data', 'strings', 'style', 'layout', 'wizard']) {
      await vscode.window.showTextDocument(documents[key])
      const activeBeforeVerify = vscode.window.activeTextEditor?.document
      const result = await vscode.commands.executeCommand('modkit.verifyDocument')
      receipt.explicitVerification.languages[key] = {
        requestedUri: documents[key].uri.toString(),
        requestedClosed: documents[key].isClosed,
        requestedVersion: documents[key].version,
        activeUri: activeBeforeVerify?.uri.toString(),
        activeVersion: activeBeforeVerify?.version,
        activeLanguage: activeBeforeVerify?.languageId,
        returned: result !== undefined,
      }
      if (!Array.isArray(result?.diagnostics) || typeof result.isIncomplete !== 'boolean')
        throw new Error(`Verify did not return language diagnostics for ${key}`)
      const published = vscode.languages.getDiagnostics(uris[key])
      if (
        result.diagnostics.some(
          item => !published.some(finding => finding.message === item.message),
        )
      )
        throw new Error(`Verify did not publish ${key} findings to Problems`)
      receipt.explicitVerification.languages[key] = {
        diagnostics: result.diagnostics.length,
        isIncomplete: result.isIncomplete,
        publishedToProblems: true,
      }
    }
    const closedLayoutUri = vscode.Uri.joinPath(
      folder.uri,
      'Base.SC2Data/UI/Layout/ClosedInvalid.SC2Layout',
    )
    if (
      vscode.workspace.textDocuments.some(document => sameDocument(document.uri, closedLayoutUri))
    )
      throw new Error('Project verification fixture must never have been opened')
    await vscode.window.showTextDocument(documents.layout)
    const projectVerified = await vscode.commands.executeCommand('modkit.verifyMod')
    const closedReport = projectVerified?.documents.find(item =>
      sameDocument(vscode.Uri.parse(item.uri), closedLayoutUri),
    )
    const schemaMessage = 'Expected fixed numeric value [Real32]'
    if (!closedReport?.diagnostics.some(item => item.message === schemaMessage))
      throw new Error('Verify Mod omitted the schema error in a closed Layout document')
    if (
      !vscode.languages.getDiagnostics(closedLayoutUri).some(item => item.message === schemaMessage)
    )
      throw new Error('Verify Mod did not publish the closed Layout finding to Problems')
    receipt.projectVerification = {
      command: 'modkit.verifyMod',
      checkedNeverOpenedDocument: true,
      schemaMessage,
      publishedToProblems: true,
      isIncomplete: projectVerified.isIncomplete,
    }
    await vscode.window.showTextDocument(documents.galaxy)
    await vscode.commands.executeCommand('undo')
    if (await waitFor(() => documents.galaxy.getText().includes('Helper(2)'))) {
      // The undo restored the dependency call before any save.
    } else {
      throw new Error('undo did not restore the unsaved Galaxy overlay')
    }
    if (
      !(await waitFor(
        () =>
          !vscode.languages
            .getDiagnostics(uris.galaxy)
            .some(item => item.message.includes("Function 'Missing'")),
      ))
    )
      throw new Error('Galaxy diagnostics retained the undone document revision')

    await vscode.window.showTextDocument(documents.galaxyDependency)
    const renamePreview = await waitFor(async () => {
      try {
        const result = await vscode.commands.executeCommand(
          'vscode.executeDocumentRenameProvider',
          uris.galaxyDependency,
          positionOf(documents.galaxyDependency, 'Helper', 2),
          'Assist',
        )
        return result instanceof vscode.WorkspaceEdit && result.entries().length === 2
          ? result
          : undefined
      } catch (error) {
        // VS Code converts a transient undefined prepare/rename result to this error while a
        // changed workspace snapshot is still settling. Retry that state; preserve real failures.
        if (String(error?.message ?? error) === 'No result.') return undefined
        throw error
      }
    })
    if (renamePreview === undefined)
      throw new Error('Galaxy rename did not prepare a two-document workspace edit')
    if (!(await vscode.workspace.applyEdit(renamePreview)))
      throw new Error('Galaxy rename edit was rejected')
    if (
      !documents.galaxy.getText().includes('Assist(2)') ||
      !documents.galaxyDependency.getText().includes('Assist')
    )
      throw new Error('Galaxy rename edit did not update declaration and caller')
    await vscode.commands.executeCommand('workbench.action.files.saveAll')
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    const reopened = await vscode.workspace.openTextDocument(uris.galaxy)
    if (!reopened.getText().includes('Assist(2)') || reopened.isDirty)
      throw new Error('saved rename did not survive close and reopen')

    if (process.env.MODKIT_INSTALLED_CASC_ROOT !== undefined)
      await probeInstalledCasc(receipt, resultPath, process.env.MODKIT_INSTALLED_CASC_ROOT)

    Object.assign(receipt, {
      passed: true,
      fixtureKinds: ['Galaxy', 'Data', 'Strings', 'Style', 'Layout', 'Wizard'],
      commands: [
        'vscode.executeCompletionItemProvider',
        'vscode.executeHoverProvider',
        'vscode.executeSignatureHelpProvider',
        'vscode.executeDefinitionProvider',
        'vscode.executeReferenceProvider',
        'vscode.executeDocumentRenameProvider',
        'vscode.executeFormatDocumentProvider',
        'vscode.executeCodeActionProvider',
        'vscode.executeWorkspaceSymbolProvider',
        'modkit.verifyDocument',
      ],
      dependencyDefinition: galaxyDefinition.map(item => relativeUri(folder, locationUri(item))),
      crossLanguageDefinitions: {
        layoutToStyle: layoutStyleDefinition.map(item => relativeUri(folder, locationUri(item))),
        layoutToStrings: layoutStringDefinition.map(item => relativeUri(folder, locationUri(item))),
      },
      references: {
        galaxy: galaxyReferences.length,
        data: dataReferences.length,
        style: styleReferences.length,
      },
      documentRevisions: {
        opened: initialVersion,
        unsaved: documents.galaxy.version,
        reopened: reopened.version,
      },
      unsavedDiagnosticCodes: overlayDiagnostics.map(item => String(item.code)),
      renameDocuments: renamePreview
        .entries()
        .map(([uri]) => relativeUri(folder, uri))
        .sort(),
      saveReopen: true,
      undo: true,
    })
  } catch (error) {
    receipt.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
    throw error
  } finally {
    if (extensionApi !== undefined) {
      receipt.extensionDiagnostics = [
        ...new Set(
          extensionApi
            .diagnostics()
            .filter(line =>
              /\[(?:extensions|worker|language(?:-host)?|language-context)\]|language routes/u.test(
                line,
              ),
            ),
        ),
      ].slice(-200)
    }
    fs.writeFileSync(resultPath, `${JSON.stringify(receipt, null, 2)}\n`)
  }
}
