/** The only host-only seam used by direct DDS oracle functions. */
export const ddsStubs = [{
  path: 'packages/image-processing/src/registry.ts',
  kind: 'host-registry',
  reason: 'Direct DDS functions do not use the host codec registry; every substituted entry throws if reached.',
  source: `export class ImageCodecRegistry { constructor() { throw new Error('Host registry forbidden in direct DDS oracle') } }
export const createImageCodecRegistry = () => { throw new Error('Host registry forbidden in direct DDS oracle') };
export const decodeImageBytes = createImageCodecRegistry, describeImageBytes = createImageCodecRegistry, encodeImage = createImageCodecRegistry, resolveImageCodec = createImageCodecRegistry;`,
}]
