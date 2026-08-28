/** Browser-safe wire text for an explicit map-preview continuation over the existing open(string). */

const SELECTION_REQUEST_PREFIX = 'x3-app-map-preview-selection:'

export interface ElectronMapPreviewSelectionRequest {
  readonly path: string
  readonly selectionId: string
}

export function electronMapPreviewSelectionRequest(
  request: ElectronMapPreviewSelectionRequest,
): string {
  if (request.path.length === 0 || request.selectionId.length === 0) {
    throw new TypeError('map preview selection needs a path and selectionId')
  }
  const encoded = `${SELECTION_REQUEST_PREFIX}${encodeURIComponent(JSON.stringify(request))}`
  if (encoded.length > 4_096) throw new RangeError('map preview selection request is too long')
  return encoded
}

/** Main-side inverse; malformed app requests fail closed instead of becoming filesystem paths. */
export function parseElectronMapPreviewSelectionRequest(
  value: string,
): ElectronMapPreviewSelectionRequest | undefined {
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

/** Release the first ordinary view, then perform the explicit second open carrying selectionId. */
export async function continueElectronMapPreviewSelection<Result>(options: {
  readonly path: string
  readonly selectionId: string
  readonly dispose: () => Promise<void>
  readonly open: (request: string) => Promise<Result>
}): Promise<Result> {
  const request = electronMapPreviewSelectionRequest(options)
  await options.dispose()
  return options.open(request)
}
