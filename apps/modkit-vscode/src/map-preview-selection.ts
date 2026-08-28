/** Browser-safe wire text for an explicit map-preview continuation over the existing open(string). */

const SELECTION_REQUEST_PREFIX = 'x3-app-map-preview-selection:'

export interface VsCodeMapPreviewSelectionRequest {
  readonly path: string
  readonly selectionId: string
}

export function vsCodeMapPreviewSelectionRequest(
  request: VsCodeMapPreviewSelectionRequest,
): string {
  if (request.path.length === 0 || request.selectionId.length === 0) {
    throw new TypeError('map preview selection needs a path and selectionId')
  }
  const encoded = `${SELECTION_REQUEST_PREFIX}${encodeURIComponent(JSON.stringify(request))}`
  if (encoded.length > 4_096) throw new RangeError('map preview selection request is too long')
  return encoded
}

export function parseVsCodeMapPreviewSelectionRequest(
  value: string,
): VsCodeMapPreviewSelectionRequest | undefined {
  if (!value.startsWith(SELECTION_REQUEST_PREFIX)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeURIComponent(value.slice(SELECTION_REQUEST_PREFIX.length)))
  } catch {
    throw new TypeError('malformed map preview selection request')
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).some(key => key !== 'path' && key !== 'selectionId') ||
    typeof (parsed as { path?: unknown }).path !== 'string' ||
    (parsed as { path: string }).path.length === 0 ||
    typeof (parsed as { selectionId?: unknown }).selectionId !== 'string' ||
    (parsed as { selectionId: string }).selectionId.length === 0 ||
    (parsed as { selectionId: string }).selectionId.length > 1_024
  ) {
    throw new TypeError('malformed map preview selection request')
  }
  return Object.freeze({
    path: (parsed as { path: string }).path,
    selectionId: (parsed as { selectionId: string }).selectionId,
  })
}

export async function continueVsCodeMapPreviewSelection<Result>(options: {
  readonly path: string
  readonly selectionId: string
  readonly dispose: () => Promise<void>
  readonly open: (request: string) => Promise<Result>
}): Promise<Result> {
  const request = vsCodeMapPreviewSelectionRequest(options)
  await options.dispose()
  return options.open(request)
}
