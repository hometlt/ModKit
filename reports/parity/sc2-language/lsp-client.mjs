// Minimal JSON-RPC stdio client for a language server child process (either implementation).
import { spawn } from 'node:child_process'

export function startServer(command, args, { timeoutMs = 120_000, cwd, responses = {} } = {}) {
  const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = Buffer.alloc(0)
  let stderr = ''
  let nextId = 1
  const messages = []
  const waiters = []
  const send = message => {
    const body = Buffer.from(JSON.stringify(message))
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    child.stdin.write(body)
  }
  const dispatch = message => {
    // Answer server-to-client requests (configuration, registration, progress) so neither stalls.
    if (message.id !== undefined && message.method !== undefined) {
      const result = Object.hasOwn(responses, message.method)
        ? responses[message.method]
        : message.method === 'workspace/configuration' ? (message.params?.items ?? []).map(() => null) : null
      send({ jsonrpc: '2.0', id: message.id, result })
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
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const match = /Content-Length: (\d+)/iu.exec(buffer.subarray(0, headerEnd).toString('ascii'))
      if (match === null) throw new Error(`invalid LSP header: ${buffer.subarray(0, headerEnd)}`)
      const end = headerEnd + 4 + Number(match[1])
      if (buffer.length < end) return
      dispatch(JSON.parse(buffer.subarray(headerEnd + 4, end).toString('utf8')))
      buffer = buffer.subarray(end)
    }
  })
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
  const waitFor = (predicate, label) => {
    const existing = messages.find(predicate)
    if (existing !== undefined) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate, resolve,
        timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1)
          reject(new Error(`timed out waiting for ${label}\n${stderr.slice(-2000)}`))
        }, timeoutMs),
      }
      waiters.push(waiter)
    })
  }
  return {
    messages,
    stderr: () => stderr,
    notify: (method, params) => send({ jsonrpc: '2.0', method, params }),
    request(method, params) {
      const id = nextId++
      send({ jsonrpc: '2.0', id, method, params })
      return waitFor(message => message.id === id && message.method === undefined, method)
    },
    waitFor,
    async close() {
      try {
        await Promise.race([this.request('shutdown', null), new Promise(resolve => setTimeout(resolve, 5_000))])
        this.notify('exit', null)
      } catch { /* the process is killed below */ }
      setTimeout(() => child.kill(), 1_000).unref()
    },
  }
}
