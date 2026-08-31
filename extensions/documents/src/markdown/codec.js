import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const decoder = new TextDecoder('utf-8', { fatal: true })

/** Every alias the legacy route answered for; MK3 closes all four (plan 11A.2). */
const ALIASES = new Set(['md', 'markdown', 'mdown', 'mkd'])

function looksLikeMarkdown(bytes) {
  let text
  try {
    text = decoder.decode(bytes)
  } catch {
    return false
  }
  return (
    /^(?: {0,3}#{1,6}\s+| {0,3}(?:[-*+] |\d+[.)] )|```|~~~|> )/mu.test(text) ||
    /\[[^\]]+\]\([^)]+\)/u.test(text)
  )
}

function parseMarkdown(text, maxNodes) {
  if (text.includes('\0')) throw new TypeError('Markdown cannot contain NUL bytes')
  const root = { kind: 'document', label: 'Markdown', children: [] }
  const stack = [{ level: 0, node: root }]
  const headings = []
  const links = []
  let lists = 0
  let quotes = 0
  let codeBlocks = 0
  let inFence = false
  let nodes = 0
  const lines = text.split(/\r?\n/u)
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const fence = /^ {0,3}(```+|~~~+)/u.exec(line)
    if (fence !== null) {
      inFence = !inFence
      if (inFence) codeBlocks += 1
      continue
    }
    if (inFence) continue
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line)
    if (heading !== null) {
      nodes += 1
      if (nodes > maxNodes) throw new RangeError('Markdown outline exceeds maxNodes budget')
      const level = heading[1].length
      const label = heading[2]
      while (stack.at(-1).level >= level) stack.pop()
      const node = {
        kind: 'heading',
        label,
        preview: `level ${level}, line ${lineIndex + 1}`,
        children: [],
      }
      stack.at(-1).node.children.push(node)
      stack.push({ level, node })
      headings.push({ level, text: label, line: lineIndex + 1 })
    }
    if (/^ {0,3}(?:[-*+] |\d+[.)] )/u.test(line)) lists += 1
    if (/^ {0,3}>/u.test(line)) quotes += 1
    for (const link of line.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
      links.push({ label: link[1], target: link[2], line: lineIndex + 1 })
    }
  }
  return Object.freeze({
    root,
    headings: Object.freeze(headings),
    links: Object.freeze(links),
    lists,
    quotes,
    codeBlocks,
    lines: lines.length,
  })
}

const definition = Object.freeze({
  id: 'org.modkitx/document-markdown',
  format: Object.freeze({ id: 'markdown', label: 'Markdown document', mediaType: 'text/markdown' }),
  async detect(bytes, uri) {
    const structure = looksLikeMarkdown(bytes)
    const extension = uri.split(/[?#]/u, 1)[0]?.split('.').at(-1)?.toLowerCase()
    const alias = ALIASES.has(extension)
    // Two pieces of evidence beat one: the MK3 route reads the bounded structure *and* the alias,
    // so it is decisively above a route that only reads structure (slice 11A.2 routing).
    const confidence = structure ? (alias ? 0.96 : 0.72) : alias ? 0.4 : 0.05
    return {
      confidence,
      kind: 'structure',
      note: structure
        ? alias
          ? 'markdown-structure-and-alias'
          : 'markdown-structure'
        : 'markdown-structure-missing',
    }
  },
  async inspect(bytes, context) {
    const text = decoder.decode(bytes)
    const markdown = parseMarkdown(text, context.budget.maxNodes)
    return {
      summary: {
        format: 'markdown',
        lines: markdown.lines,
        headings: markdown.headings.length,
        links: markdown.links.length,
        listItems: markdown.lists,
        quotes: markdown.quotes,
        codeBlocks: markdown.codeBlocks,
      },
      metadata: [
        {
          id: 'markdown-document',
          label: 'Markdown document',
          entries: [
            { key: 'lines', value: markdown.lines },
            { key: 'headings', value: markdown.headings.length },
            { key: 'links', value: markdown.links.length },
            { key: 'listItems', value: markdown.lists },
            { key: 'quotes', value: markdown.quotes },
            { key: 'codeBlocks', value: markdown.codeBlocks },
          ],
        },
      ],
      traits: [
        {
          id: 'document.flow',
          parameters: { lines: markdown.lines, codeBlocks: markdown.codeBlocks },
        },
        { id: 'document.outline', parameters: { headings: markdown.headings.length } },
        { id: 'structure.hierarchy', parameters: { nodes: markdown.headings.length, lazy: true } },
        { id: 'content.text', parameters: { encoding: 'utf-8' } },
      ],
      text: true,
      dataSources: { 'common.view/tree-data-source': createTreeDataSource(markdown.root) },
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
