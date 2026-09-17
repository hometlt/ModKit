// Child process: the pinned MK2 SC2 language server (DocumentRouter + SC2 language contribution
// registry) over stdio. Arguments: the two verified loadMk2 bundle directories, then `--stdio`.
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [routerDirectory, registryDirectory] = process.argv.slice(2)
const load = directory => import(pathToFileURL(path.join(directory, 'oracle.mjs')).href)
const { DocumentRouter } = await load(routerDirectory)
const { createSc2LanguageContributionRegistry } = await load(registryDirectory)
// stdout carries the protocol; nothing else may print there.
console.log = console.info = console.debug = (...args) => process.stderr.write(`${args.join(' ')}\n`)
new DocumentRouter(createSc2LanguageContributionRegistry()).createConnection().listen()
