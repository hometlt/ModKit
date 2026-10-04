import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const argument = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const has = name => process.argv.includes(name)
const suppliedVsix = argument('--vsix')
const artifact = resolve(
  suppliedVsix ?? join(repoRoot, 'artifacts', 'vsix', 'modkit-installed-language.vsix'),
)
const sc2Extension = resolve(
  argument('--sc2-extension') ??
    process.env.MODKIT_SC2_EXTENSION ??
    join(repoRoot, '..', 'modkit-extensions-blizzard', 'starcraft2'),
)
const reportPath = resolve(
  argument('--report') ??
    join(repoRoot, 'reports', 'vscode-smoke', 'installed-language-receipt.json'),
)

const run = (command, args, options = {}) =>
  new Promise(resolvePromise => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      shell: process.platform === 'win32' && ['pnpm', 'npm', 'npx'].includes(command),
      env: options.env ?? process.env,
    })
    let output = ''
    child.stdout?.on('data', chunk => (output += chunk))
    child.stderr?.on('data', chunk => (output += chunk))
    child.on('error', error => resolvePromise({ code: -1, output: String(error) }))
    child.on('close', code => resolvePromise({ code: code ?? -1, output }))
  })

const writeFixture = (root, relative, text) => {
  const path = join(root, ...relative.split('/'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

async function buildVsix() {
  if (suppliedVsix !== undefined) {
    if (!existsSync(artifact)) throw new Error(`supplied VSIX does not exist: ${artifact}`)
    return
  }
  const built = await run('pnpm', ['--filter', '@modkit/modkit-vscode', 'ext:build'])
  if (built.code !== 0) throw new Error(`extension build failed (${built.code}): ${built.output}`)
  mkdirSync(dirname(artifact), { recursive: true })
  rmSync(artifact, { force: true })
  const packaged = await run('node', [
    join(appRoot, 'scripts', 'package-vsix.mjs'),
    '--out',
    artifact,
  ])
  if (packaged.code !== 0)
    throw new Error(`VSIX packaging failed (${packaged.code}): ${packaged.output}`)
}

async function buildSc2Languages() {
  const extensionWorkspace = resolve(sc2Extension, '..')
  for (const config of [
    'tsconfig.sc2-galaxy.json',
    'tsconfig.sc2-data.json',
    'tsconfig.sc2-style.json',
    'tsconfig.sc2-strings.json',
    'tsconfig.sc2-layout-runtime.json',
  ]) {
    const built = await run('pnpm', ['exec', 'tsc', '-p', join('starcraft2', config)], {
      cwd: extensionWorkspace,
    })
    if (built.code !== 0) throw new Error(`SC2 language build failed (${config}): ${built.output}`)
  }
}

async function main() {
  if (
    !existsSync(join(sc2Extension, 'modules', 'galaxy', 'providers', 'language', 'provider.json'))
  ) {
    throw new Error(`built StarCraft II extension was not found at ${sc2Extension}`)
  }
  if (!has('--skip-sc2-build')) await buildSc2Languages()
  await buildVsix()

  const scratch = mkdtempSync(join(tmpdir(), 'modkit-installed-sc2-language-'))
  const userData = join(scratch, 'user-data')
  const extensions = join(scratch, 'extensions')
  const workspace = join(scratch, 'Probe.SC2Mod')
  const harness = join(scratch, 'harness')
  const resultPath = join(scratch, 'result.json')
  for (const directory of [userData, extensions, workspace, harness])
    mkdirSync(directory, { recursive: true })

  writeFixture(
    workspace,
    '.vscode/settings.json',
    `${JSON.stringify({ 'modkit.extensions': [sc2Extension] }, null, 2)}\n`,
  )
  writeFixture(
    workspace,
    'DocumentInfo',
    '<?xml version="1.0" encoding="utf-8"?>\n<DocInfo><Dependencies/></DocInfo>\n',
  )

  writeFixture(
    workspace,
    'Base.SC2Data/MapScript.galaxy',
    'include "Lib"\nvoid Init(){\nint x=Helper(2);\n}',
  )
  writeFixture(
    workspace,
    'Base.SC2Data/Lib.galaxy',
    'int Helper(int amount) {\n    return amount;\n}',
  )
  writeFixture(
    workspace,
    'Base.SC2Data/GameData/UnitData.xml',
    '<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n    <\n    <CUnit id="Marine">\n' +
      '        <LifeMax value="45"/>\n    </CUnit>\n    <CUnit id="Hero" parent="Marine"/>\n</Catalog>',
  )
  writeFixture(
    workspace,
    'Base.SC2Data/GameData/ActorData.xml',
    '<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n' +
      '    <CActorCutscene id="Intro"><FilePath value="Assets/"/></CActorCutscene>\n</Catalog>',
  )
  writeFixture(
    workspace,
    'Base.SC2Data/GameData/OnTypeData.xml',
    '<Catalog>\n    <CUnit id="OnType"><Mob value/><EditorFlags value="NoPlacement"/></CUnit>\n</Catalog>\n',
  )
  writeFixture(
    workspace,
    'Base.SC2Data/GameData/AttributeData.xml',
    '<Catalog>\n    <CUnit id="AttributeProbe">\n        <Mob/>\n    </CUnit>\n</Catalog>\n',
  )
  writeFixture(
    workspace,
    'Base.SC2Data/GameData/NestedData.xml',
    '<Catalog>\n    <CUnit id="NestedProbe">\n        <\n    </CUnit>\n</Catalog>\n',
  )
  writeFixture(
    workspace,
    'RootOnly.SC2Data/GameData/RootData.xml',
    '<?xml version="1.0" encoding="utf-8"?>\n<',
  )
  writeFixture(
    workspace,
    'Latency.SC2Data/GameData/UnitData.xml',
    '<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n    \n</Catalog>',
  )
  writeFixture(workspace, 'Base.SC2Data/Assets/Test/Intro.ogv', 'asset-probe')
  for (const [root, file] of [
    ['EmptyUnit.SC2Data', 'UnitData.xml'],
    ['EmptyActor.SC2Data', 'ActorData.xml'],
    ['EmptyCustom.SC2Data', 'CustomData.xml'],
  ]) {
    writeFixture(
      workspace,
      `${root}/GameData/${file}`,
      '<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n    \n</Catalog>',
    )
  }
  writeFixture(
    workspace,
    'enUS.SC2Data/LocalizedData/GameStrings.txt',
    'UI/ScoreTitle=<s val="Title">Score</s>\nUnit/Name/Marine=Marine',
  )
  writeFixture(
    workspace,
    'Base.SC2Data/UI/FontStyles.SC2Style',
    '<StyleFile>\n    <Constant name="ColorTitle" val="ffcc00"/>\n' +
      '    <Style name="Base" height="16" textcolor="#ColorTitle"/>\n' +
      '    <Style name="Title" template="Base" height="24"/>\n</StyleFile>',
  )
  writeFixture(
    workspace,
    'Base.SC2Data/UI/Layout/Hud.SC2Layout',
    '<Desc>\n  <Frame type="Label" name="Score">\n' +
      '    <Style val="@@Title"/>\n    <Text val="@UI/ScoreTitle"/>\n' +
      '  </Frame>\n</Desc>',
  )
  writeFixture(
    workspace,
    'Base.SC2Data/UI/Layout/ClosedInvalid.SC2Layout',
    '<Desc><!-- 🪐 -->\n<Frame type="Frame" name="ClosedInvalid"><Width val="invalid"/></Frame></Desc>',
  )
  writeFileSync(
    join(harness, 'package.json'),
    JSON.stringify({
      name: 'modkit-installed-language-harness',
      displayName: 'Modkit Installed Language Harness',
      publisher: 'modkit-test',
      version: '1.0.0',
      engines: { vscode: '^1.100.0' },
      main: './extension.cjs',
      activationEvents: ['*'],
    }),
  )
  writeFileSync(join(harness, 'extension.cjs'), 'exports.activate = () => undefined\n')

  try {
    const cachePath = process.env.MODKIT_VSCODE_TEST_CACHE ?? join(tmpdir(), 'modkit-vscode-test')
    const executable =
      process.env.MODKIT_VSCODE_EXECUTABLE ??
      (await downloadAndUnzipVSCode({ version: 'stable', cachePath }))
    const installArguments = [
      '--user-data-dir',
      userData,
      '--extensions-dir',
      extensions,
      '--install-extension',
      artifact,
      '--force',
    ]
    const cli =
      process.platform === 'win32' ? join(dirname(executable), 'bin', 'code.cmd') : executable
    const installScript = join(scratch, 'install-vsix.cmd')
    if (process.platform === 'win32') {
      writeFileSync(
        installScript,
        `@call "${cli}" ${installArguments.map(value => `"${value}"`).join(' ')}\r\n`,
      )
    }
    const installed =
      process.platform === 'win32'
        ? await run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', installScript])
        : await run(cli, installArguments)
    if (installed.code !== 0)
      throw new Error(`VSIX installation failed (${installed.code}): ${installed.output}`)
    let testFailure
    try {
      await runTests({
        vscodeExecutablePath: executable,
        extensionDevelopmentPath: harness,
        extensionTestsPath: join(here, 'suite', 'installed-language.cjs'),
        launchArgs: [
          workspace,
          '--user-data-dir',
          userData,
          '--extensions-dir',
          extensions,
          '--disable-gpu',
          '--disable-workspace-trust',
          '--skip-welcome',
          '--skip-release-notes',
          '--no-sandbox',
        ],
        extensionTestsEnv: {
          MODKIT_INSTALLED_LANGUAGE_RESULT: resultPath,
          MODKIT_EXTENSION_REGISTRY: '',
        },
      })
    } catch (error) {
      testFailure = error
    }
    if (!existsSync(resultPath)) throw new Error('installed language suite wrote no result')
    const result = JSON.parse(readFileSync(resultPath, 'utf8'))
    const artifactSha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex')
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(
      reportPath,
      `${JSON.stringify({ ...result, artifact, artifactSha256, sc2Extension }, null, 2)}\n`,
    )
    if (result.passed !== true) throw new Error(result.error ?? 'installed language suite failed')
    if (testFailure !== undefined) throw testFailure
    console.log(`installed SC2 language acceptance: PASS; receipt ${reportPath}`)
    if (has('--keep')) console.log(`kept acceptance workspace: ${scratch}`)
  } finally {
    if (!has('--keep')) rmSync(scratch, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
