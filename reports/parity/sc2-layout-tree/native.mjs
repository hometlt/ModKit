// Use the published Host worker and common TreeDataSource. No native parser or schema imports.
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { workspace } from '../lib/kit.mjs'

export async function prepareMigrated({ operation }) {
  const host = await import(pathToFileURL(path.join(workspace, 'modkit-core/packages/host/dist/node/index.js')))
  const root = path.join(workspace, '.acceptance/modkit-extensions-blizzard/starcraft2')
  const scratch = await mkdtemp('C:/MKTEMP/modkit-layout-tree-parity-')
  const modkit = await host.createModkit({ extensions: [root], roots: [scratch], intent: 'inspect', policy: host.workerBackendPolicy({ outputCapBytes: 4_194_304 }) })
  if (modkit.extensionFailures.length) throw new Error(JSON.stringify(modkit.extensionFailures))
  const invoke = async input => {
    const file = path.join(scratch, `${input.name}.SC2Layout`)
    await writeFile(file, input.text)
    const opened = await modkit.open(file)
    if (opened.snapshot.state !== 'opened') throw new Error(JSON.stringify(opened.snapshot))
    try {
      const lease = await opened.session.dataSource('common.view/tree-data-source', 1)
      try {
        const tree = lease.value
        const children = async parent => {
          const page = await tree.children(parent, { limit: 256 })
          if (page.nextCursor !== undefined) throw new Error('Parity tree exceeded one page')
          return Promise.all(page.items.map(async node => ({ node, facts: await tree.facts(node) })))
        }
        const project = async ({ node, facts }) => {
          const nested = await children(node)
          const schemaNode = nested.find(item => item.facts.kind === 'schema')
          let schema
          if (schemaNode !== undefined) {
            const groups = await children(schemaNode.node)
            const hookups = groups.find(item => item.facts.kind === 'hookups')
            schema = {
              ...schemaNode.facts.value,
              hookups: (await children(hookups.node)).map(item => item.facts.value),
              descriptions: await Promise.all(groups.filter(item => item.facts.kind === 'description-structure').map(async item => ({
                name: item.facts.label, fields: (await children(item.node)).map(field => field.facts.value),
              }))),
              classes: await Promise.all(groups.filter(item => item.facts.kind === 'frame-class').map(async item => ({
                name: item.facts.label, properties: (await children(item.node)).map(property => {
                  if (property.facts.editable !== undefined) throw new Error('Schema nodes must not advertise native field editing')
                  return property.facts.value
                }),
              }))),
            }
          }
          return {
            kind: facts.kind, label: facts.label, path: facts.semanticPath, range: facts.range,
            ...(facts.preview === undefined ? {} : { type: facts.preview }),
            schema, children: await Promise.all(nested.filter(item => item.facts.kind !== 'schema').map(project)),
          }
        }
        return await Promise.all((await children(await tree.root())).map(project))
      } finally { await lease.release() }
    } finally { await opened.close() }
  }
  const files = [fileURLToPath(import.meta.url), path.join(root, 'modules/layout/codecs/layout/codec.json'), path.join(root, 'dist/modules/layout/codecs/layout/portable/codec.mjs')]
  const artifacts = await Promise.all(files.map(async file => ({ file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') })))
  return { module: { [operation]: invoke }, evidence: { transport: 'public Host worker/common TreeDataSource', artifacts }, release: () => modkit.close() }
}
