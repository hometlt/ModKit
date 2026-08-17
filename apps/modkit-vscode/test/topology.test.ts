import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createVsCodeDesktopApp } from '../src/index.js'

describe('VS Code composition topology', () => {
  it('keeps native editor and process facilities outside the webview realm', async () => {
    const app = await createVsCodeDesktopApp()
    expect(app.extensionHost.profile.facilities).toContain('editor.host-native')
    expect(app.extensionHost.profile.facilities).toContain('process.launch')
    expect(app.webview.profile.facilities).not.toContain('editor.host-native')
    expect(app.webview.profile.facilities).not.toContain('process.launch')
  })

  it('ships only generic static contribution points and no Monaco binding', async () => {
    const generated = await readFile(
      new URL('../contributes.generated.json', import.meta.url),
      'utf8',
    )
    expect(generated).toContain('modkit.genericAssetPreview')
    expect(generated.toLowerCase()).not.toContain('monaco')
  })
})
