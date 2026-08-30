import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LICENSE_NAME = /(?:^|\/)(?:(?:licen[cs]e|copying|notice|ofl)(?:\.|$)|MIT\.txt$)/iu
const ALLOWED_OUTSIDE_ROOT = [
  /(?:^|\/)(?:generated|dist|dist-app|vendor|node_modules|fixtures)(?:\/|$)/u,
  // The original OFL must remain beside redistributable source font files.
  /^assets\/fonts\/[^/]+\/OFL\.txt$/u,
]

export function licensePolicyViolations(paths) {
  return paths
    .map(path => path.replaceAll('\\', '/'))
    .filter(path => LICENSE_NAME.test(path))
    .filter(path => !path.startsWith('licenses/'))
    .filter(path => !ALLOWED_OUTSIDE_ROOT.some(pattern => pattern.test(path)))
    .sort()
}

export function checkLicensePolicy(root = repoRoot) {
  const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: root,
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter(path => existsSync(resolve(root, path)))
  const violations = licensePolicyViolations(tracked)
  if (violations.length > 0) {
    throw new Error(
      `tracked license/notice files must live under licenses/:\n${violations.join('\n')}`,
    )
  }
  const mit = readFileSync(resolve(root, 'licenses', 'MIT.txt'), 'utf8')
  if (!mit.startsWith('MIT License\n') || !mit.includes('Permission is hereby granted')) {
    throw new Error('licenses/MIT.txt is missing or is not the canonical MIT grant')
  }
  return {
    checked: tracked.length,
    licenseFiles: tracked.filter(path => LICENSE_NAME.test(path)).length,
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkLicensePolicy()
  console.log(`license policy ok (${result.licenseFiles} tracked license/notice files)`)
}
