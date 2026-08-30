/**
 * Find a file handed to Electron by the shell.
 *
 * A development invocation has two executable entries before user arguments:
 * `electron.exe electron/main.cjs`. A packaged application has only its executable. Keeping this
 * distinction here prevents the development entry point from being mistaken for the file to open.
 */
function findInitialFileArgument(argv, isPackaged, exists, isFile) {
  return argv
    .slice(isPackaged ? 1 : 2)
    .find(value => !value.startsWith('-') && exists(value) && isFile(value))
}

module.exports = { findInitialFileArgument }
