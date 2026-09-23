/**
 * How a publication's version reads, and what the next one is expected to be.
 *
 * Battle.net packs a publication version into one 32-bit number: the major in the high half, the
 * minor in the low half. The server allocates the next one, so what is shown before publishing is
 * an expectation — the receipt is what the window reports afterwards.
 */
export function formatPublicationVersion(version: number): string {
  return `${version >>> 16}.${version & 0xffff}`
}

/** Minor keeps the major and adds one; major takes the next major and starts its minor at zero. */
export function nextPublicationVersion(version: number, major: boolean): string {
  return major ? `${(version >>> 16) + 1}.0` : `${version >>> 16}.${(version & 0xffff) + 1}`
}
