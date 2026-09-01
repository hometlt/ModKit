/**
 * The browser entry published by `@rgrove/parse-xml` is CommonJS-shaped. Re-exporting the parser
 * from an ESM entrypoint makes the named contract used by the portable XML codec explicit in the
 * worker vendor graph. The build resolves the package from the data extension's pinned install.
 */
export { parseXml } from '@rgrove/parse-xml'
