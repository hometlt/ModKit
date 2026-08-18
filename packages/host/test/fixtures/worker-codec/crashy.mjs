// A codec module (CodecModule ABI v1) for the restart tests of the Node worker backend (acc-8):
// `probe` kills the whole worker when the host-side source is called `/crash` (process exit 9,
// no reply ever), answers normally otherwise, and reports its own generation-visible identity
// (`process.pid` is shared, `threadId` is not) so a test can tell one generation from the next.
import { threadId } from 'node:worker_threads'

export const abiVersion = 1

export function createCodec(context) {
  return {
    async probe(request) {
      const path = request.source.ref?.path ?? ''
      if (path === '/crash') process.exit(9)
      context.diagnostics.report({
        code: 'x3.demo/probed',
        severity: 'information',
        message: `probed ${path} in thread ${threadId}`,
      })
      return { confidence: 1, threadId, path }
    },
    async open() {
      throw new Error('crashy does not open')
    },
  }
}
