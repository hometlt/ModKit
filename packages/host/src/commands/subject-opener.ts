import type { SubjectOpener } from '../subject-rpc.js'
import type { CommandSubjectOpener } from './runtime.js'

/**
 * The one adapter between a host's `SubjectOpener` and the runtime's opener.
 *
 * Written once because the interesting half is disposal: the RPC opener hands back a live session
 * and expects its caller to end it, and a command that forgot would leak a worker per invocation in
 * a batch run. Every host gets that right by not implementing it.
 */
export function commandSubjectsFrom(open: SubjectOpener): CommandSubjectOpener {
  return async (ref, signal) => {
    const answer = await open(ref, signal)
    let disposed = false
    return {
      ref,
      snapshot: answer.snapshot,
      ...(answer.session === undefined ? {} : { session: answer.session }),
      async dispose() {
        if (disposed) return
        disposed = true
        await answer.session?.dispose()
      },
    }
  }
}
