import { readFile, writeFile } from 'node:fs/promises'
const path = new URL('./run-dds-transition.mjs', import.meta.url)
let source = await readFile(path, 'utf8')
source = source.replace('import { spawn }', 'import { spawn, execFileSync }')
source = source.replace('const mode = process.argv[2]', "const mode = 'current'")
source = source.replace("if (!['old', 'new'].includes(mode)) throw new Error('Usage: node run-dds-transition.mjs old|new')", "const mk3Root = path.join(codingRoot, 'modkit-core')\nconst workingIdentity = () => ({ head: execFileSync('git', ['-C', mk3Root, 'rev-parse', 'HEAD']).toString().trim(), diffSha256: sha256(execFileSync('git', ['-C', mk3Root, 'diff', '--binary', 'HEAD'], { maxBuffer: 128 * 1024 * 1024 })) })\nconst before = workingIdentity()")
source = source.replaceAll("mode === 'new'", "mode !== 'old'")
source = source.replace('`${name}.new.loader.json`', '`${name}.current.loader.json`')
source = source.replace("env.MK3_REFERENCE_MANIFEST = path.join(output, 'mk3-reference.json')", 'delete env.MK3_REFERENCE_MANIFEST')
source = source.replace("const reference = JSON.parse(await readFile(env.MK3_REFERENCE_MANIFEST, 'utf8'))", 'const reference = { commit: before.head }')
source = source.replace('environment: { MK3_REFERENCE_MANIFEST: env.MK3_REFERENCE_MANIFEST }', 'environment: { MK3_REFERENCE_MANIFEST: null }, mk3WorkingTree: before')
source = source.replace('MK3 side is isolated accepted M0; current M1 tree parity requires a separate post-freeze run.', 'MK3 side is the frozen current M1 working tree, identified by HEAD and binary diff digest.')
source += "\nif (JSON.stringify(before) !== JSON.stringify(workingIdentity())) throw new Error('MK3 tracked working tree changed during current parity run')\n"
await writeFile(new URL('./run-dds-current.mjs', import.meta.url), source)
