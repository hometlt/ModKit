import { CASC_LIMITS, cascError, throwIfCancelled } from './limits.js'

const PATH_ENCODER = new TextEncoder()

function checkPath(path) {
  if (typeof path !== 'string' || PATH_ENCODER.encode(path).byteLength > CASC_LIMITS.maxPathBytes) {
    throw cascError('x3.casc/path-budget-exceeded', 'CASC path exceeds its configured boundary', {
      path,
      maxPathBytes: CASC_LIMITS.maxPathBytes,
    })
  }
}

function notFound(error) {
  return error?.code === 'x3.host/namespace-entry-not-found'
}

class ReadBudget {
  consumed = 0
  reserved = 0

  reserve(bytes, path) {
    if (this.consumed + this.reserved + bytes > CASC_LIMITS.maxSourceReadBytes) {
      throw cascError(
        'x3.casc/source-read-budget-exceeded',
        'CASC exhausted its cumulative source-read budget',
        {
          path,
          requestedBytes: bytes,
          consumedBytes: this.consumed,
          reservedBytes: this.reserved,
          maxSourceReadBytes: CASC_LIMITS.maxSourceReadBytes,
        },
      )
    }
    this.reserved += bytes
    let remaining = bytes
    return Object.freeze({
      commit: actual => {
        remaining -= actual
        this.reserved -= actual
        this.consumed += actual
      },
      release: () => {
        this.reserved -= remaining
        remaining = 0
      },
    })
  }
}

async function byteEntry(namespace, path, signal) {
  checkPath(path)
  throwIfCancelled(signal)
  const lease = await namespace.open(path, signal)
  if (lease.value.kind !== 'bytes') {
    await lease.release()
    throw cascError('x3.casc/not-a-file', 'CASC expected a byte entry', { path })
  }
  return lease
}

async function readFully(source, offset, length, budget, path, signal) {
  const reservation = budget.reserve(length, path)
  const result = new Uint8Array(length)
  let written = 0
  try {
    while (written < length) {
      throwIfCancelled(signal)
      const requested = Math.min(CASC_LIMITS.maxHostReadBytes, length - written)
      const bytes = await source.read(offset + BigInt(written), requested, signal)
      if (bytes.byteLength === 0) {
        throw cascError(
          'x3.casc/source-ended-early',
          'CASC source ended before its declared size',
          {
            path,
            offset: String(offset + BigInt(written)),
            remainingBytes: length - written,
          },
        )
      }
      if (bytes.byteLength > requested) {
        throw cascError('x3.casc/source-read-invalid', 'CASC source returned too many bytes', {
          path,
          requestedBytes: requested,
          returnedBytes: bytes.byteLength,
        })
      }
      result.set(bytes, written)
      written += bytes.byteLength
      reservation.commit(bytes.byteLength)
    }
    return result
  } finally {
    reservation.release()
  }
}

export function cascSourceFromNamespace(namespace, signal) {
  const budget = new ReadBudget()
  return Object.freeze({
    async list(path) {
      checkPath(path)
      throwIfCancelled(signal)
      const names = []
      for await (const entry of namespace.list(path, signal)) {
        throwIfCancelled(signal)
        names.push(entry.path)
        if (names.length > CASC_LIMITS.maxListEntries) {
          throw cascError(
            'x3.casc/list-entry-budget-exceeded',
            'CASC source directory exceeds its listing budget',
            { path, maxListEntries: CASC_LIMITS.maxListEntries },
          )
        }
      }
      return names
    },
    async get(path) {
      const lease = await byteEntry(namespace, path, signal)
      try {
        const size = Number(lease.value.size)
        if (!Number.isSafeInteger(size) || size > CASC_LIMITS.maxWholeFileBytes) {
          throw cascError(
            'x3.casc/whole-file-budget-exceeded',
            'CASC metadata file exceeds its whole-file budget',
            {
              path,
              bytes: String(lease.value.size),
              maxWholeFileBytes: CASC_LIMITS.maxWholeFileBytes,
            },
          )
        }
        return await readFully(lease.value, 0n, size, budget, path, signal)
      } finally {
        await lease.release()
      }
    },
    async getRange(path, offset, length) {
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        length > CASC_LIMITS.maxContainerReadBytes
      ) {
        throw cascError(
          'x3.casc/container-read-budget-exceeded',
          'CASC container range exceeds its configured boundary',
          { path, offset, length, maxContainerReadBytes: CASC_LIMITS.maxContainerReadBytes },
        )
      }
      const lease = await byteEntry(namespace, path, signal)
      try {
        if (BigInt(offset + length) > lease.value.size) {
          throw cascError('x3.casc/container-range-invalid', 'CASC container range is invalid', {
            path,
            offset,
            length,
            fileBytes: String(lease.value.size),
          })
        }
        return await readFully(lease.value, BigInt(offset), length, budget, path, signal)
      } finally {
        await lease.release()
      }
    },
    async exists(path) {
      checkPath(path)
      throwIfCancelled(signal)
      let lease
      try {
        lease = await namespace.open(path, signal)
        return true
      } catch (error) {
        if (notFound(error)) return false
        throw error
      } finally {
        await lease?.release()
      }
    },
  })
}
