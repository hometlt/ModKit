export const APP_THEME_MANIFEST: 'modkit.themes.json'
export const APP_THEME_DOM_ID: 'modkit-app-themes'
export const APP_THEME_ROOTS_ENV: 'MODKIT_APP_THEME_ROOTS'

export interface AppTheme {
  readonly id: string
  readonly label: string
  readonly stylesheet: string
  readonly sourcePath?: string
  readonly manifestPath?: string
}

export interface AppThemeStylesheet extends AppTheme {
  readonly sourcePath: string
  readonly manifestPath: string
}

export function resolveAppThemes(options: {
  readonly repositoryRoot: string
  readonly environmentValue?: string
}): readonly AppTheme[]

export function renderAppThemeDomData(themes: readonly AppTheme[]): string

export function appThemeStylesheets(themes: readonly AppTheme[]): readonly AppThemeStylesheet[]
