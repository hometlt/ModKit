import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../dist/main.js', import.meta.url))

/** Minimal JSON-RPC stdio client over the built `modkit-lsp` bin. */
export function startLanguageServer(args, { timeoutMs = 60_000 } = {}) {
  const child = spawn(process.execPath, [executable, ...args], {
    cwd: resolve('.'),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buffer = Buffer.alloc(0)
  let stderr = ''
  let nextId = 1
  const messages = []
  const waiters = []
  const dispatch = message => {
    // Answer server-to-client requests (registration, configuration) so the server never stalls.
    if (message.id !== undefined && message.method !== undefined) {
      send({ jsonrpc: '2.0', id: message.id, result: null })
    }
    messages.push(message)
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue
      waiters.splice(waiters.indexOf(waiter), 1)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    }
  }
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const match = /Content-Length: (\d+)/iu.exec(buffer.subarray(0, headerEnd).toString('ascii'))
      if (match === null) throw new Error('invalid LSP header')
      const end = headerEnd + 4 + Number(match[1])
      if (buffer.length < end) return
      dispatch(JSON.parse(buffer.subarray(headerEnd + 4, end).toString('utf8')))
      buffer = buffer.subarray(end)
    }
  })
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const send = message => {
    const body = Buffer.from(JSON.stringify(message))
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    child.stdin.write(body)
  }
  const waitFor = (predicate, label) => {
    const existing = messages.find(predicate)
    if (existing !== undefined) return Promise.resolve(existing)
    return new Promise((resolveWait, reject) => {
      const waiter = {
        predicate,
        resolve: resolveWait,
        timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1)
          reject(new Error(`timed out waiting for ${label}\n${stderr}`))
        }, timeoutMs),
      }
      waiters.push(waiter)
    })
  }
  const request = (method, params) => {
    const id = nextId++
    send({ jsonrpc: '2.0', id, method, params })
    return waitFor(message => message.id === id && message.method === undefined, method)
  }
  const notify = (method, params) => send({ jsonrpc: '2.0', method, params })
  return {
    child,
    messages,
    send,
    waitFor,
    request,
    notify,
    stderr: () => stderr,
    nextId: () => nextId++,
    async shutdown() {
      await request('shutdown', null)
      notify('exit', null)
      await new Promise(resolveExit => {
        if (child.exitCode !== null) resolveExit()
        else child.once('exit', resolveExit)
      })
      return child.exitCode
    },
  }
}
