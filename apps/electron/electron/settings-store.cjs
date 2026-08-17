/**
 * Settings persistence for the desktop app.
 *
 * A plain JSON file in Electron's `userData`, written atomically. The same document shape the web
 * app, VS Code and a headless run read, so the file can be copied between them or edited by hand
 * while the app is closed.
 *
 * Atomic because settings are small and rewritten on every toggle: a crash mid-write must not leave
 * a truncated file that then fails to parse and silently resets the user's extensions.
 */
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

// Windows cannot atomically replace the same destination from two concurrent rename calls. The
// renderer normally saves sequentially, but menu/toggle events may overlap, so serialize writes per
// settings file while keeping different Electron profiles independent.
const pendingWrites = new Map()

/** @returns the settings file path for this installation. */
function settingsPath(app) {
  return path.join(app.getPath('userData'), 'modkit-settings.json')
}

async function readSettings(app) {
  const file = settingsPath(app)
  try {
    return { location: file, raw: JSON.parse(await fsp.readFile(file, 'utf8')) }
  } catch (error) {
    // A missing file is the normal first run; a malformed one is reported and treated as empty so
    // the app still starts and the user can fix it from the settings panel.
    return {
      location: file,
      raw: undefined,
      ...(error.code === 'ENOENT' ? {} : { problem: `${file}: ${error.message}` }),
    }
  }
}

async function writeSettings(app, text) {
  const file = settingsPath(app)
  const previous = pendingWrites.get(file) ?? Promise.resolve()
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      await fsp.mkdir(path.dirname(file), { recursive: true })
      const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
      try {
        await fsp.writeFile(temporary, text, 'utf8')
        await fsp.rename(temporary, file)
      } finally {
        await fsp.rm(temporary, { force: true })
      }
      return file
    })
  pendingWrites.set(file, operation)
  try {
    return await operation
  } finally {
    if (pendingWrites.get(file) === operation) pendingWrites.delete(file)
  }
}

module.exports = { settingsPath, readSettings, writeSettings }
