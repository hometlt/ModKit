/** One source-selection workflow for Electron and VS Code; the host owns the actual dialogs. */
export interface SourceChoice { readonly id: string; readonly label: string; readonly description?: string }
export interface SourceRoot { readonly id: string; readonly label: string; readonly region: string; readonly kind: 'mine' | 'public' | 'local' }
export interface SourceSnapshot {
  readonly label: string
  readonly publishing?: boolean
  readonly deletion?: boolean
  readonly regions: readonly { readonly id: string; readonly label: string }[]
  readonly connections: readonly { readonly id: string; readonly accountId: string; readonly label: string; readonly region: string }[]
  readonly roots: readonly SourceRoot[]
}
export interface SourcePickerHost {
  choose(title: string, items: readonly SourceChoice[]): Promise<string | undefined>
  input(title: string): Promise<string | undefined>
  call(method: string, args: readonly unknown[]): Promise<unknown>
  open(root: SourceRoot): Promise<void>
  openLocal(): Promise<void>
  readonly russian?: boolean
}
export async function chooseContentSource(host: SourcePickerHost): Promise<void> {
  const t = (en: string, ru: string) => host.russian ? ru : en
  for (;;) {
    let snapshot: SourceSnapshot
    try { snapshot = await host.call('snapshot', []) as SourceSnapshot }
    catch (error) {
      const action = await host.choose(t('Content sources', 'Источники содержимого'), [
        { id: '$local', label: t('Installed game / local folder…', 'Установленная игра / локальная папка…') },
        { id: '$unavailable', label: t('Battle.net unavailable — details…', 'Battle.net недоступен — подробности…') },
      ])
      if (action === '$local') await host.openLocal()
      if (action === '$unavailable') throw error
      return
    }
    const selected = await host.choose(t('Content sources', 'Источники содержимого'), [
      { id: '$local', label: t('Installed game / local folder…', 'Установленная игра / локальная папка…') },
      ...snapshot.roots,
      ...(snapshot.regions.length ? [{ id: '$connect', label: t('Add Battle.net account / region…', 'Добавить аккаунт / регион Battle.net…') }] : []),
      ...(snapshot.connections.length ? [{ id: '$search', label: t('Find and add public mod…', 'Найти и добавить публичный мод…') },
        { id: '$disconnect', label: t('Disconnect account / region…', 'Отключить аккаунт / регион…') }] : []),
      ...(snapshot.publishing && snapshot.connections.length ? [{ id: '$publish', label: t('Publish prepared map/mod package…', 'Опубликовать подготовленный пакет карты/мода…') }] : []),
      ...(snapshot.deletion && snapshot.connections.length ? [{ id: '$deletePublication', label: t('Delete own Battle.net publication…', 'Удалить свою публикацию из Battle.net…') }] : []),
      ...(snapshot.roots.some(root => root.kind === 'public') ? [{ id: '$remove', label: t('Remove saved public mod…', 'Убрать сохранённый публичный мод…') }] : []),
    ])
    if (selected === undefined) return
    if (selected === '$local') { await host.openLocal(); return }
    const root = snapshot.roots.find(item => item.id === selected)
    if (root) { await host.call('refresh', [root.id]); await host.open(root); return }
    if (selected === '$connect') {
      const region = await host.choose(t('Battle.net server', 'Сервер Battle.net'), snapshot.regions)
      if (!region) continue
      const accounts = [...new Map(snapshot.connections.map(item => [item.accountId, item])).values()]
      const account = await host.choose(t('Account', 'Аккаунт'), [
        { id: '$new', label: t('Sign in to another account', 'Войти в другой аккаунт') },
        ...accounts.map(item => ({ id: item.accountId, label: item.label })),
      ])
      if (account) await host.call('connect', account === '$new' ? [region] : [region, account])
    } else if (selected === '$deletePublication') {
      const connection = await host.choose(t('Account and server', 'Аккаунт и сервер'), snapshot.connections.map(item => ({
        id: item.id, label: item.label, description: item.region.toUpperCase(),
      })))
      if (!connection) continue
      const rows = await host.call('deletionCandidates', [connection]) as readonly SourceChoice[]
      const selectedRow = await host.choose(t('Own publication to delete', 'Собственная публикация для удаления'), rows)
      const row = rows.find(item => item.id === selectedRow)
      if (!row) continue
      const account = snapshot.connections.find(item => item.id === connection)!
      const action = await host.choose(`${row.label} · ${row.description ?? ''} · ${account.label}`, [
        { id: '$cancel', label: t('Cancel', 'Отмена') },
        { id: '$delete', label: t('Delete publication from this account', 'Удалить публикацию из этого аккаунта'),
          description: t('Blizzard Unlink: cached/depot copies may remain available.', 'Операция Blizzard Unlink: копии в кеше и depot могут сохраняться.') },
      ])
      if (action !== '$delete') continue
      await host.call('deletePublication', [row.id])
      await host.choose(t('Publication removal confirmed by Blizzard', 'Снятие публикации подтверждено Blizzard'), [{ id: '$ok', label: row.label }])
    } else if (selected === '$publish') {
      const connection = await host.choose(t('Publishing account and server', 'Аккаунт и сервер публикации'),
        snapshot.connections.map(item => ({ id: item.id, label: item.label, description: item.region.toUpperCase() })))
      if (!connection) continue
      const file = await host.input(t('Saved .SC2Map / .SC2Mod — full path', 'Сохранённый .SC2Map / .SC2Mod — полный путь'))
      if (!file) continue
      const manifest = await host.input(t('Prepared .modkit-publish.json — full path', 'Подготовленный .modkit-publish.json — полный путь'))
      if (!manifest) continue
      const review = await host.call('preparePublish', [connection, file, manifest]) as {
        id: string; name: string; account: string; region: string; bytes: number; sha256: string;
        target: { mode: string; id?: number; expectedVersion?: number }; visibility: string; locked: boolean
      }
      const target = review.target.mode === 'create' ? t('Create', 'Создать') : `${t('Update', 'Обновить')} #${review.target.id} (${review.target.expectedVersion})`
      const action = await host.choose(`${review.name} · ${review.account} · ${review.region.toUpperCase()}`, [
        { id: '$cancel', label: t('Cancel', 'Отмена') },
        { id: '$send', label: `${t('Publish', 'Опубликовать')}: ${target} · ${review.visibility} · ${review.locked ? 'locked' : 'unlocked'}`,
          description: `${review.bytes} bytes · SHA-256 ${review.sha256}` },
      ])
      if (action !== '$send') continue
      const receipt = await host.call('publish', [review.id]) as { publication: { id: number; version: number; name: string } }
      await host.choose(t('Publication confirmed by Blizzard', 'Публикация подтверждена Blizzard'), [{ id: '$ok',
        label: `${receipt.publication.name} · #${receipt.publication.id} · ${receipt.publication.version >>> 16}.${receipt.publication.version & 65535}` }])
    } else if (selected === '$search' || selected === '$disconnect') {
      const connection = await host.choose(t('Account and server', 'Аккаунт и сервер'),
        snapshot.connections.map(item => ({ id: item.id, label: item.label, description: item.region.toUpperCase() })))
      if (!connection) continue
      if (selected === '$disconnect') await host.call('disconnect', [connection])
      else {
        const name = await host.input(t('Public map/mod name', 'Название публичной карты или мода'))
        if (!name?.trim()) continue
        const results = await host.call('search', [connection, name.trim()]) as readonly SourceChoice[]
        const result = await host.choose(t('Add a publication to Public mods', 'Добавить публикацию в публичные моды'), results)
        if (result) await host.call('add', [result])
      }
    } else if (selected === '$remove') {
      const id = await host.choose(t('Public source', 'Публичный источник'), snapshot.roots.filter(item => item.kind === 'public'))
      if (!id) continue
      const entries = await host.call('list', [id, '']) as readonly { path: string; name: string }[]
      const path = await host.choose(t('Remove from this list', 'Убрать из этого списка'), entries.map(item => ({ id: item.path, label: item.name })))
      if (path) await host.call('remove', [id, path])
    }
  }
}

/** Accessible modal for hosts without a native quick picker. Text is never interpreted as HTML. */
export function createSourceDialogs(document: Document) {
  async function show(title: string, choices?: readonly SourceChoice[]): Promise<string | undefined> {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog')
      dialog.style.cssText = 'color:var(--mk-color-fg);background:var(--mk-color-bg);border:1px solid var(--mk-color-border,#555);border-radius:6px;padding:18px;min-width:min(440px,85vw);max-width:90vw;font:inherit'
      const form = document.createElement('form'); form.method = 'dialog'
      const label = document.createElement('label'); label.textContent = title
      const input = document.createElement('input'); input.type = 'text'; input.maxLength = 4096
      input.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:10px 0'
      const rows = document.createElement('div')
      rows.style.cssText = 'display:grid;gap:6px;max-height:60vh;overflow:auto'
      const finish = (value?: string) => { dialog.close(); dialog.remove(); resolve(value) }
      const render = () => {
        rows.replaceChildren()
        for (const item of choices ?? []) {
          if (!`${item.label} ${item.description ?? ''}`.toLocaleLowerCase().includes(input.value.toLocaleLowerCase())) continue
          const button = document.createElement('button'); button.type = 'button'
          button.style.cssText = 'text-align:left;padding:8px'
          button.textContent = `${item.label}${item.description ? ` — ${item.description}` : ''}`
          button.addEventListener('click', () => finish(item.id)); rows.append(button)
        }
      }
      input.addEventListener('input', render)
      label.append(input); form.append(label, rows)
      if (!choices) {
        const submit = document.createElement('button'); submit.textContent = 'OK'; submit.type = 'submit'; form.append(submit)
      }
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '×'
      cancel.setAttribute('aria-label', 'Close'); cancel.addEventListener('click', () => finish()); form.append(cancel)
      form.addEventListener('submit', event => { event.preventDefault(); if (!choices) finish(input.value) })
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish() })
      dialog.append(form); document.body.append(dialog); render(); dialog.showModal(); input.focus()
    })
  }
  return { choose: (title: string, choices: readonly SourceChoice[]) => show(title, choices), input: (title: string) => show(title) }
}
