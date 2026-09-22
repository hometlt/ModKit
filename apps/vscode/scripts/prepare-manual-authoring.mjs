import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')

const valueOf = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const has = name => process.argv.includes(name)
const blizzardRoot = resolve(
  valueOf('--blizzard-root') ?? resolve(repoRoot, '..', 'modkit-extensions-blizzard'),
)
const sc2ExtensionRoot = join(blizzardRoot, 'starcraft2')
const cascExtensionRoot = join(blizzardRoot, 'casc')
const outputRoot = resolve(
  valueOf('--out') ?? join(repoRoot, 'artifacts', 'vscode-manual-authoring'),
)
const vscodeExecutable = resolve(
  valueOf('--vscode') ??
    process.env.MODKIT_VSCODE_EXECUTABLE ??
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
)

/*
 * Rebuilding everything on every run cost minutes for a one-line edit, so each stage now states
 * what it reads and what it writes, and is skipped when nothing it reads is newer than what it
 * wrote. This is a timestamp check, not a content hash: it is wrong only in the direction of
 * rebuilding, and `--force` exists for the case where a stale output must be discarded anyway.
 */
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.tmp', 'artifacts', 'coverage'])

const newestMtime = (roots, extensions) => {
  let newest = 0
  const visit = directory => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        visit(join(directory, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      if (extensions !== undefined && !extensions.some(value => entry.name.endsWith(value))) continue
      try {
        const at = statSync(join(directory, entry.name)).mtimeMs
        if (at > newest) newest = at
      } catch {
        // A file that vanished mid-walk cannot be newer than an output that already exists.
      }
    }
  }
  for (const root of roots) {
    try {
      const state = statSync(root)
      if (state.isDirectory()) visit(root)
      else if (state.mtimeMs > newest) newest = state.mtimeMs
    } catch {
      // A missing input is not a reason to rebuild; a missing *output* is, and that is checked.
    }
  }
  return newest
}

const outputIsCurrent = (output, inputs, extensions) => {
  if (has('--force')) return false
  if (!existsSync(output)) return false
  return statSync(output).mtimeMs >= newestMtime(inputs, extensions)
}

const timed = (label, action) => {
  const startedAt = Date.now()
  const answer = action()
  console.log(`${label}: ${String(Date.now() - startedAt)} ms`)
  return answer
}

const run = (command, args, cwd = repoRoot) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32' && command === 'pnpm',
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}${result.stderr}`,
    )
  }
  return `${result.stdout}${result.stderr}`
}

if (!existsSync(join(blizzardRoot, 'modkit.repository.json'))) {
  throw new Error(`Blizzard extension repository was not found at ${blizzardRoot}`)
}
if (!existsSync(join(sc2ExtensionRoot, 'package.json'))) {
  throw new Error(`StarCraft II extension was not found at ${sc2ExtensionRoot}`)
}
if (!existsSync(vscodeExecutable))
  throw new Error(`VS Code executable was not found: ${vscodeExecutable}`)

mkdirSync(outputRoot, { recursive: true })
const workspaceRoot = join(outputRoot, 'ManualAuthoring.SC2Mod')
const profileRoot = join(outputRoot, 'profile')
const extensionsRoot = join(outputRoot, 'extensions')
const vsixPath = join(outputRoot, 'modkit-manual-authoring.vsix')
/** Where the debugging loop puts the extension so VS Code loads it without an install step. */
const developmentExtension = join(extensionsRoot, 'modkit.modkit-vscode-0.1.0')
for (const directory of [workspaceRoot, profileRoot, extensionsRoot]) {
  mkdirSync(directory, { recursive: true })
}

if (has('--reuse-vsix')) {
  if (!existsSync(vsixPath)) throw new Error(`reusable VSIX was not found: ${vsixPath}`)
} else {
  const portableCodec = join(
    sc2ExtensionRoot,
    'dist/modules/mod/codecs/mod/portable/codec.mjs',
  )
  const blizzardSources = [
    join(sc2ExtensionRoot, 'modules'),
    join(sc2ExtensionRoot, 'shared'),
    join(sc2ExtensionRoot, 'src'),
    join(sc2ExtensionRoot, 'contributions'),
  ]
  // One `tsc` per project plus the portable bundle is the slowest stage by far, and it only
  // matters when the StarCraft II extension itself changed.
  if (outputIsCurrent(portableCodec, blizzardSources, ['.ts', '.js', '.mjs', '.json'])) {
    console.log('blizzard projects: up to date')
  } else {
    timed('blizzard projects', () => {
      for (const project of [
        'starcraft2/tsconfig.battlenet.json',
        'starcraft2/tsconfig.sc2-galaxy.json',
        'starcraft2/tsconfig.sc2-data.json',
        'starcraft2/tsconfig.sc2-style.json',
        'starcraft2/tsconfig.sc2-strings.json',
        'starcraft2/tsconfig.sc2-layout-runtime.json',
        'starcraft2/tsconfig.sc2-wizard.json',
        'starcraft2/tsconfig.sc2-mod.json',
      ]) {
        run('pnpm', ['exec', 'tsc', '-p', project], blizzardRoot)
      }
      run(
        'pnpm',
        [
          '--dir',
          './starcraft2',
          'exec',
          'vite',
          'build',
          '--config',
          './vite.sc2-mod-portable.config.mjs',
        ],
        blizzardRoot,
      )
    })
  }

  const hostOutput = join(repoRoot, 'packages/host/dist/index.js')
  const hostSources = [join(repoRoot, 'packages')]
  if (outputIsCurrent(hostOutput, hostSources, ['.ts', '.tsx', '.js', '.mjs', '.json'])) {
    console.log('host build: up to date')
  } else {
    timed('host build', () => run('pnpm', ['--filter', '@modkit/host', 'build']))
  }

  const vsixSources = [
    join(appRoot, 'src'),
    join(appRoot, 'dist-app'),
    join(appRoot, 'package.json'),
    join(appRoot, 'package.nls.json'),
    join(appRoot, 'package.nls.ru.json'),
    join(repoRoot, 'packages'),
    // The packaged extension carries the built host, and `dist` is skipped by the walk — so the
    // build output is named directly. Without it a fresh host would be packaged into a stale VSIX.
    hostOutput,
  ]
  const buildInputs = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css']
  if (has('--vsix')) {
    if (outputIsCurrent(vsixPath, vsixSources, buildInputs)) {
      console.log('vsix: up to date')
    } else {
      timed('vsix', () => {
        rmSync(vsixPath, { force: true })
        run('node', [join(appRoot, 'scripts', 'package-vsix.mjs'), '--out', vsixPath])
      })
    }
  } else if (outputIsCurrent(join(developmentExtension, 'dist-app', 'extension.cjs'), vsixSources, buildInputs)) {
    console.log('extension: up to date')
  } else {
    /*
     * The debugging loop installs the extension as a folder, not as a package.
     *
     * Zipping 60 MB and asking the CLI to unzip it again added about a minute and a half to every
     * iteration and proved nothing that the folder does not: VS Code reads `--extensions-dir` the
     * same way either way. `--vsix` still produces the real package for acceptance, where how it
     * installs is part of what is being tested.
     */
    timed('extension', () => {
      rmSync(developmentExtension, { recursive: true, force: true })
      mkdirSync(developmentExtension, { recursive: true })
      run('node', [
        join(appRoot, 'scripts', 'build-extension.mjs'),
        '--out',
        join(developmentExtension, 'dist-app'),
      ])
      const sourceManifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
      // The same manifest the package build writes: no scripts (nothing may run on load) and no
      // dependency material (everything the extension needs is inside the bundle).
      const manifest = { ...sourceManifest, name: 'modkit-vscode', publisher: 'modkit', scripts: {} }
      delete manifest.private
      delete manifest.dependencies
      delete manifest.devDependencies
      delete manifest.exports
      writeFileSync(
        join(developmentExtension, 'package.json'),
        `${JSON.stringify(manifest, null, 2)}
`,
      )
      for (const name of ['package.nls.json', 'package.nls.ru.json', 'media']) {
        const source = join(appRoot, name)
        if (existsSync(source)) {
          cpSync(source, join(developmentExtension, name), { recursive: true, dereference: false })
        }
      }
    })
  }
}

const files = new Map([
  [
    'ComponentList.SC2Components',
    '<?xml version="1.0" encoding="utf-8"?>\n<Components>\n  <DataComponent Type="gada">GameData</DataComponent>\n  <DataComponent Type="text" Locale="enUS">GameText</DataComponent>\n  <DataComponent Type="info">DocumentInfo</DataComponent>\n</Components>\n',
  ],
  [
    'DocumentInfo',
    '<?xml version="1.0" encoding="utf-8"?>\n<DocInfo>\n  <Name><Value>Manual Authoring</Value></Name>\n</DocInfo>\n',
  ],
  [
    'Base.SC2Data/GameData/UnitData.xml',
    '<Catalog>\n  <CUnit id="ManualMarine">\n    <Name value="Unit/Name/ManualMarine"/>\n  </CUnit>\n</Catalog>\n',
  ],
  ['EmptyUnit.SC2Data/GameData/UnitData.xml', '<Catalog>\n  \n</Catalog>\n'],
  ['EmptyActor.SC2Data/GameData/ActorData.xml', '<Catalog>\n  \n</Catalog>\n'],
  ['EmptyCustom.SC2Data/GameData/CustomData.xml', '<Catalog>\n  \n</Catalog>\n'],
  ['RootOnly.SC2Data/GameData/RootData.xml', '<?xml version="1.0" encoding="utf-8"?>\n<'],
  [
    'Base.SC2Data/GameData/ActorData.xml',
    '<Catalog>\n  <CActorCutscene id="ManualIntro">\n    <FilePath value="Assets/"/>\n  </CActorCutscene>\n</Catalog>\n',
  ],
  [
    'Base.SC2Data/GameData/OnTypeData.xml',
    '<Catalog>\n  <CUnit id="OnType">\n    <Mob value/>\n    <EditorFlags value="NoPlacement"/>\n  </CUnit>\n</Catalog>\n',
  ],
  [
    'Base.SC2Data/GameData/AttributeData.xml',
    '<Catalog>\n  <CUnit id="AttributeProbe">\n    <Mob/>\n  </CUnit>\n</Catalog>\n',
  ],
  [
    'Base.SC2Data/GameData/NestedData.xml',
    '<Catalog>\n  <CUnit id="NestedProbe">\n    <\n  </CUnit>\n</Catalog>\n',
  ],
  ['Base.SC2Data/Assets/Test/ManualIntro.ogv', 'manual-asset-probe'],
  [
    'enUS.SC2Data/LocalizedData/GameStrings.txt',
    'Unit/Name/ManualMarine=<s val="ManualTitle">Manual Marine</s>\n',
  ],
  [
    'Base.SC2Data/UI/FontStyles.SC2Style',
    '<StyleFile>\n  <Constant name="ManualColor" val="ffcc00"/>\n  <Style name="ManualTitle" height="24" textcolor="#ManualColor"/>\n</StyleFile>\n',
  ],
  [
    'Base.SC2Data/UI/Layout/Manual.SC2Layout',
    '<Desc>\n  <Frame type="Label" name="ManualLabel" style="ManualTitle">\n    <Text val="@Unit/Name/ManualMarine"/>\n  </Frame>\n</Desc>\n',
  ],
  [
    'Base.SC2Data/Scripts/Manual.galaxy',
    'void ManualCreate() {\n    point p = Point(0.0, 0.0);\n    UnitCreate(1, "ManualMarine", 0, 1, p, 0.0);\n}\n',
  ],
  [
    'Base.SC2Data/Templates/Manual.BlizWiz',
    '<wizardfile>\n  <wizard id="ManualWizard">\n    <name>Manual wizard</name>\n    <input id="UnitId" type="WizardText">\n      <default value="ManualMarine"/>\n    </input>\n    <macro id="UnitName">^UnitId^</macro>\n  </wizard>\n</wizardfile>\n',
  ],
])
for (const [relative, text] of files) {
  const path = join(workspaceRoot, ...relative.split('/'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const settings = {
  'modkit.extensions': [sc2ExtensionRoot, cascExtensionRoot],
  'editor.semanticHighlighting.enabled': true,
  'extensions.ignoreRecommendations': true,
  'window.title': '[MK3 TEST] ${activeEditorShort}${separator}${rootName}',
}
mkdirSync(join(workspaceRoot, '.vscode'), { recursive: true })
writeFileSync(
  join(workspaceRoot, '.vscode', 'settings.json'),
  `${JSON.stringify(settings, null, 2)}\n`,
)

const workspaceFile = join(outputRoot, 'SC2 Authoring Manual Test.code-workspace')
writeFileSync(
  workspaceFile,
  `${JSON.stringify({ folders: [{ path: workspaceRoot }], settings }, null, 2)}\n`,
)
writeFileSync(
  join(workspaceRoot, 'MANUAL_TEST.md'),
  `# Modkit SC2 authoring manual test\n\n` +
    `Use only the window whose title starts with \`[MK3 TEST]\`. Its isolated profile contains only \`modkit.modkit-vscode\`; output channels owned by \`talv.sc2galaxy\` or \`talv.sc2layouts\` belong to the old plugin in another VS Code window.\n\n` +
    `1. Open each empty GameData fixture and type \`<\` at the blank root line. UnitData must offer only Unit classes, ActorData only Actor classes, and CustomData every catalog class; typed files also offer their schema-derived structure defaults.\n` +
    `   Open RootData.xml as well: at the document root it must offer only \`Catalog\`, immediately.\n` +
    `2. In AttributeData.xml type a space before \`>\` in the CUnit tag: \`parent\` must appear and the existing \`id\` must not repeat. Type a space after \`Mob\`: accept \`value\` and confirm \`value=""\`, the cursor between quotes, enum values such as \`Multiplayer\`, field type, description and Reference link.\n` +
    `   In NestedData.xml confirm \`<\` offers both \`Fidget\` and \`AddedOnArray\`; the latter must insert \`index="" value=""\`. Accept \`Fidget\`, type \`<\` inside it and confirm \`ChanceArray\` inserts the same indexed-value shape.\n` +
    `3. In OnTypeData.xml place the caret after \`value\` in \`<Mob value/>\` and type \`=\`. Confirm the editor produces \`value=""\`, leaves the caret between the quotes and immediately opens enum values such as \`Multiplayer\`.\n` +
    `4. In a flags value, type \`,\` and \`;\`; only the current segment is replaced and already selected flags are omitted.\n` +
    `5. In ActorData.xml, request completion inside \`FilePath value="Assets/"\`; confirm \`Assets\\Test\\ManualIntro.ogv\` is offered from the loaded workspace.\n` +
    `6. Open every fixture and confirm its Modkit diagnostics and outline.\n` +
    `7. From \`ManualMarine\` in Galaxy, use Go to Definition and Find References.\n` +
    `8. From \`ManualTitle\` in Strings/Layout, navigate to FontStyles and inspect hover.\n` +
    `9. Change \`ManualMarine\` without saving; repeat navigation and confirm the dirty buffer wins.\n` +
    `10. Rename a local symbol, inspect the workspace edit, save, reopen, undo and redo.\n` +
    `11. Inspect the Wizard outline/completion and its token references.\n` +
    `12. Open the Modkit Resources view while a GameData text file is active. It must show GameData, Strings, Galaxy, Layouts, Asset aliases, EditorCategories, FontStyles, Preload, Files and Dependencies from this workspace mod. Expand GameData → Unit and open ManualMarine; the entity card must open beside the text editor.\n` +
    `13. Open the Modkit activity panel. It must contain Sources, Resources and Extensions; the internal Host section must not be visible.\n` +
    `14. In Sources select the installed StarCraft II at C:\\Apps\\StarCraft II. Expand provider sources and confirm Battle.net cache, SC2 Maps Cache, installation Maps/Mods, player Documents and Editor Wizards are present. Click the selected installation row: a read-only CASC folder must appear in Explorer and expose installed Mods/Campaigns.\n` +
    `15. Open SC2 Maps Cache: every hash-named cache directory must appear as a logical \`.SC2Map\` or \`.SC2Mod\`, never \`.s2ma\`. Right-click local source roots and Explorer rows and run “Show Local Source in File Explorer”; folders must open directly and a Battle.net Content/component row must select its physical \`.s2ma\` file.\n` +
    `16. In the CASC workspace open \`Mods/void.SC2Mod/Base.SC2Data/GameData/AbilData.xml\`. Completion, hover, diagnostics and navigation must use the enclosing Void mod together with its resolved \`Core.SC2Mod → Liberty.SC2Mod → Swarm.SC2Mod\` dependency layers; no physical \`Mods\` directory is required. Repeat with a file inside a loose \`.SC2Mod\` directory.\n` +
    `17. Confirm the VS Code status bar identifies each bundled SC2 language and record any incomplete context explicitly.\n` +
    `18. Keep that CASC \`AbilData.xml\` the active text editor and look at Resources. It must show the Void mod's own resource tree instead of “Open a Modkit subject to browse its resources”; no custom editor and no physical workspace folder may be involved. Expand Files and open \`DocumentInfo\`: it must exist for this Blizzard package, open read-only, and contain \`file:Mods/Swarm.SC2Mod\`. Attempting to save it must fail rather than write into CASC. Completion, hover and diagnostics in AbilData must resolve Core → Liberty → Swarm → Void.\n` +
    `19. Open a text file inside \`Campaigns/VoidStory.SC2Campaign\`. Resources must switch to the VoidStory subject, its virtual \`DocumentInfo\` must reference \`Campaigns/Void.SC2Campaign\`, and \`Explain mod resolution\` must list all eight layers in order: Mods/Core.SC2Mod, Mods/Liberty.SC2Mod, Campaigns/Liberty.SC2Campaign, Mods/Swarm.SC2Mod, Campaigns/Swarm.SC2Campaign, Mods/Void.SC2Mod, Campaigns/Void.SC2Campaign, Campaigns/VoidStory.SC2Campaign.\n` +
    `20. Switch back to this authored workspace mod, which has a real \`DocumentInfo\` on disk. Its Resources tree must show that authored file, not a virtual projection: the content stays \`Manual Authoring\` and the file remains writable. Switch between an authored file and a CASC file several times and confirm Resources always follows the active editor without mixing the two mods' resources.\n\n` +
    `VSIX: ${vsixPath}\nStarCraft II extension: ${sc2ExtensionRoot}\nCASC extension: ${cascExtensionRoot}\n`,
)

const cli =
  process.platform === 'win32'
    ? join(dirname(vscodeExecutable), 'bin', 'code.cmd')
    : vscodeExecutable
const installArguments = [
  '--user-data-dir',
  profileRoot,
  '--extensions-dir',
  extensionsRoot,
  '--install-extension',
  vsixPath,
  '--force',
]
/*
 * Installing a 60 MB VSIX and listing the profile back takes real time, and reinstalling the same
 * bytes changes nothing. The previous run's receipt records the digest that is installed; when it
 * matches, both the install and the listing are skipped.
 */
const builtExtension = join(developmentExtension, 'dist-app', 'extension.cjs')
const packaged = has('--vsix') || has('--reuse-vsix')
const vsixDigest = createHash('sha256')
  .update(readFileSync(packaged ? vsixPath : builtExtension))
  .digest('hex')
const receiptPath = join(outputRoot, 'receipt.json')
let previousReceipt
try {
  previousReceipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
} catch {
  previousReceipt = undefined
}
const alreadyInstalled =
  // A folder install *is* the installed extension: there is nothing for the CLI to do.
  !packaged ||
  (!has('--force') &&
    previousReceipt?.vsixSha256 === vsixDigest &&
    typeof previousReceipt?.installedExtension === 'string' &&
    existsSync(extensionsRoot) &&
    readdirSync(extensionsRoot).some(name => name.startsWith('modkit.modkit-vscode')))

let installedExtensions
if (alreadyInstalled) {
  console.log(packaged ? 'install: up to date' : 'install: extension folder in place')
  installedExtensions =
    typeof previousReceipt?.installedExtension === 'string' && packaged
      ? String(previousReceipt.installedExtension)
      : 'modkit.modkit-vscode@0.1.0'
}
if (alreadyInstalled) {
  // The launch scripts are cheap to rewrite and must still point at this profile.
  if (process.platform === 'win32') {
    writeFileSync(
      join(outputRoot, 'launch.cmd'),
      `@start "Modkit MK3 manual authoring" "${vscodeExecutable}" --user-data-dir "${profileRoot}" --extensions-dir "${extensionsRoot}" --disable-extension talv.sc2galaxy --disable-extension talv.sc2layouts --new-window "${workspaceFile}"
`,
    )
  } else {
    writeFileSync(
      join(outputRoot, 'launch.sh'),
      `#!/bin/sh
exec "${vscodeExecutable}" --user-data-dir "${profileRoot}" --extensions-dir "${extensionsRoot}" --new-window "${workspaceFile}"
`,
    )
  }
} else if (process.platform === 'win32') {
  const installScript = join(outputRoot, 'install.cmd')
  writeFileSync(
    installScript,
    `@call "${cli}" ${installArguments.map(item => `"${item}"`).join(' ')}\r\n`,
  )
  run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', installScript])
  const listScript = join(outputRoot, 'list-extensions.cmd')
  writeFileSync(
    listScript,
    `@call "${cli}" --user-data-dir "${profileRoot}" --extensions-dir "${extensionsRoot}" --list-extensions --show-versions\r\n`,
  )
  installedExtensions = run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', listScript])
  writeFileSync(
    join(outputRoot, 'launch.cmd'),
    `@start "Modkit MK3 manual authoring" "${vscodeExecutable}" --user-data-dir "${profileRoot}" --extensions-dir "${extensionsRoot}" --disable-extension talv.sc2galaxy --disable-extension talv.sc2layouts --new-window "${workspaceFile}"\r\n`,
  )
} else {
  run(cli, installArguments)
  installedExtensions = run(cli, [
    '--user-data-dir',
    profileRoot,
    '--extensions-dir',
    extensionsRoot,
    '--list-extensions',
    '--show-versions',
  ])
  writeFileSync(
    join(outputRoot, 'launch.sh'),
    `#!/bin/sh\nexec "${vscodeExecutable}" --user-data-dir "${profileRoot}" --extensions-dir "${extensionsRoot}" --new-window "${workspaceFile}"\n`,
  )
}

const installedExtension = installedExtensions
  .split(/\r?\n/u)
  .map(value => value.trim())
  .find(value => value.toLowerCase().startsWith('modkit.modkit-vscode@'))
if (installedExtension === undefined) {
  throw new Error(`the isolated profile did not report the installed Modkit extension`)
}

const receipt = {
  kind: 'modkit.vscode-manual-authoring-kit',
  version: 1,
  preparedAt: new Date().toISOString(),
  // In the debugging loop this is the extension folder VS Code loads, and the digest is the
  // bundle's; with `--vsix` both name the real package.
  vsixPath: packaged ? vsixPath : developmentExtension,
  vsixSha256: vsixDigest,
  installedExtension,
  workspaceFile,
  profileRoot,
  extensionsRoot,
  blizzardRoot,
  sc2ExtensionRoot,
  cascExtensionRoot,
  fixtures: [...files.keys()],
}
writeFileSync(join(outputRoot, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
console.log(`manual authoring kit prepared: ${outputRoot}`)

if (has('--launch')) {
  const launcher = join(outputRoot, process.platform === 'win32' ? 'launch.cmd' : 'launch.sh')
  spawnSync(launcher, [], { cwd: outputRoot, detached: true, stdio: 'ignore', shell: true })
  console.log(`VS Code launched: ${workspaceFile}`)
}
