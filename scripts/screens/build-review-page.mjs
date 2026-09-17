/**
 * Build the owner review page from captured screens.
 *
 *   node scripts/screens/build-review-page.mjs <screens-dir> <out.html>
 *
 * <screens-dir> holds one sub-directory per host (electron, vscode) with <id>.png, optional
 * <id>.txt (visible text) and results.json. The page embeds the rows as JSON; images are published
 * beside it as shots/<host>/<id>.png. Prints the Artifact `files` map as JSON on stdout.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const [screensArgument, outArgument] = process.argv.slice(2)
const screens = resolve(screensArgument)
const out = resolve(outArgument)
const template = readFileSync(join(import.meta.dirname, 'review-page.template.html'), 'utf8')

const groups = [
  ['media-image', 'Изображения'],
  ['media-audio', 'Аудио'],
  ['media-video', 'Видео'],
  ['models', 'Модели'],
  ['archives', 'Архивы'],
  ['mod', 'Мод и метаданные'],
  ['data', 'Данные (GameData)'],
  ['strings', 'Локализация'],
  ['triggers', 'Триггеры'],
  ['galaxy', 'Galaxy'],
  ['style', 'Стили'],
  ['layout', 'Layout'],
  ['cutscene', 'Катсцены'],
  ['blizwiz', 'BlizWiz'],
  ['map', 'Карты'],
  ['replay', 'Реплеи'],
]

function autoNotes(text, statusLine, id) {
  const notes = []
  if (/no-candidate/u.test(statusLine)) notes.push('Формат не опознан: показаны сырые байты (hex/текст).')
  const failure = statusLine.match(/failed[^·]*$/u)
  if (failure) notes.push(`Ошибка открытия: ${failure[0].trim()}`)
  if (/^Готово$|^Ready$/u.test(statusLine.trim())) notes.push('Файл не открылся (редактор пуст).')
  if (/\b(raster|model) preview\b|map preview \(invoke/u.test(text))
    notes.push('«Предпросмотр» в карточке — подпись вместо изображения/модели.')
  if (/^(data|strings)-/u.test(id) && /^Код|^Code/u.test(statusLine))
    notes.push('Открывается как код: нет таблицы/карточки данных по умолчанию.')
  if (/\["[^"]+"(,"[^"]+")*\]|\{"[^"]+":/u.test(text))
    notes.push('В карточке есть значения, показанные сырым JSON.')
  return notes
}

const rows = []
const files = {}
for (const host of ['electron', 'vscode']) {
  const dir = join(screens, host)
  if (!existsSync(dir)) continue
  const results = existsSync(join(dir, 'results.json'))
    ? JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'))
    : []
  const titles = new Map(results.map(result => [result.id, result]))
  for (const name of readdirSync(dir).filter(file => file.endsWith('.png')).sort()) {
    const id = name.slice(0, -4)
    const baseId = id.split('--')[0]
    const result = titles.get(baseId) ?? { title: baseId, ok: true }
    const textFile = join(dir, `${id}.txt`)
    const text = existsSync(textFile) ? readFileSync(textFile, 'utf8') : ''
    const statusLine = text.trim().split('\n').at(-1) ?? ''
    const group = groups.find(([prefix]) => baseId.startsWith(prefix)) ?? ['other', 'Прочее']
    const published = `shots/${host}/${name}`
    files[published] = relative(process.cwd(), join(dir, name)).replaceAll('\\', '/')
    rows.push({
      key: `${host}--${id}`,
      host,
      id,
      title: result.title + (id.includes('--') ? ` · ${id.split('--')[1]}` : ''),
      group: group[1],
      image: published,
      status: statusLine,
      notes: [
        ...(result.ok ? [] : [`Сценарий не выполнен: ${result.error}`]),
        ...(result.note ? [result.note] : []),
        ...autoNotes(text, statusLine, baseId),
      ],
    })
  }
}

const captured = new Date().toISOString().slice(0, 16).replace('T', ' ')
writeFileSync(
  out,
  template
    .replace('/*ROWS*/[]', JSON.stringify(rows).replaceAll('</', '<\\/'))
    .replace('{{CAPTURED}}', captured),
)
console.log(JSON.stringify(files))
