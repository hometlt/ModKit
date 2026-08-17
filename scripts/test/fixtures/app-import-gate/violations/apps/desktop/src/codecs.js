import { createCodec } from '../../../extensions/common/foo/src/codec.js'
export const dyn = () => import('../../../extensions/common/foo/src/other.js')
export { createCodec }
