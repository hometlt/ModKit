import { resolve } from 'node:path'
import { expect, it } from 'vitest'

import { contentSourceRoots } from '../src/content-source-roots.js'

const extension = (publisher: string, id: string, source: string) =>
  ({ source, manifest: { publisher, id } }) as never

it('composes one content-source root per extension: the one the inventory loaded', () => {
  // v37: the live repository and the acceptance snapshot both held roblox/roblox, and two modules
  // naming the region "open-cloud" broke the content sources of every game in the window.
  const roots = contentSourceRoots({
    extensions: [
      extension('blizzard', 'starcraft2', 'C:/snapshot/blizzard/starcraft2'),
      extension('roblox', 'roblox', 'C:/snapshot/roblox'),
      extension('roblox', 'roblox', 'C:/live/roblox'),
    ],
  })
  expect(roots).toEqual([resolve('C:/snapshot/blizzard/starcraft2'), resolve('C:/snapshot/roblox')])
})
