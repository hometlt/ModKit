import type { Inventory } from '@modkit/host'
import type { RasterRegion } from '@modkit/sdk'

/** Image support comes from enabled codec contracts, including external extensions. */
export function imageGalleryExtensions(inventory: Inventory): ReadonlySet<string> {
  const result = new Set<string>()
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      if (!contribution.activationEligible) continue
      const manifest = contribution.manifest
      if (manifest?.contract.id !== 'modkit/codec-contribution') continue
      const spec = manifest.spec as {
        publishesDataSources?: readonly { contract: string }[]
        match?: { extensions?: readonly string[] }
      }
      if (
        !spec.publishesDataSources?.some(source =>
          ['common.view/raster-image-source', 'common.view/vector-scene-source'].includes(
            source.contract,
          ),
        )
      )
        continue
      for (const suffix of spec.match?.extensions ?? [])
        result.add(suffix.replace(/^\./u, '').toLowerCase())
    }
  }
  return result
}

export function galleryThumbnail(region: RasterRegion, maxEdge = 96) {
  const scale = Math.min(1, maxEdge / Math.max(region.width, region.height))
  const width = Math.max(1, Math.round(region.width * scale))
  const height = Math.max(1, Math.round(region.height * scale))
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = Math.floor(y / scale) * region.rowStride + Math.floor(x / scale) * 4
      pixels.set(region.pixels.subarray(from, from + 4), (y * width + x) * 4)
    }
  }
  return { width, height, pixels: Array.from(pixels) }
}

export function imageGalleryHtml(
  nonce: string,
  resources: {
    cspSource: string
    script: string
    stylesheet: string
    icons: string
  },
): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<!doctype html><html data-mk-theme="modkit-dark" data-mk-density="compact"><head>
<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src ${escape(resources.cspSource)}; style-src ${escape(resources.cspSource)} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${escape(resources.stylesheet)}"><link rel="stylesheet" href="${escape(resources.icons)}">
<style nonce="${nonce}">html,body{height:100%;margin:0;padding:0;overflow:hidden;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font:var(--vscode-font-size,13px) var(--vscode-font-family,Segoe UI,sans-serif)}body>[data-mk-part='media-shell.gallery']{display:block!important;width:100%!important;height:100%;border:0;flex:none} [data-mk-part='media-shell.gallery-toolbar']{background:var(--vscode-sideBar-background)} [data-mk-part='media-shell.gallery-item'][aria-current='true']{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}</style>
</head><body><script nonce="${nonce}" type="module" src="${escape(resources.script)}"></script></body></html>`
}
