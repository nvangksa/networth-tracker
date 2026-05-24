import { useState, useEffect } from 'react'

const STORAGE_KEY = 'portfolio-theme'

// Supported themes. Order matters for the sidebar's quick-toggle cycle —
// clicking the sun/moon icon advances to the NEXT theme in this list.
// We expose the full list so Settings can render a proper picker.
export const THEMES = [
  { id: 'light',    label: 'Paper Light',     description: 'Warm cream + forest green' },
  { id: 'modern',   label: 'Modern Light',    description: 'Cool gray + indigo' },
  { id: 'dark',     label: 'Dark',            description: 'Warm black + teal' },
  { id: 'midnight', label: 'Midnight Library', description: 'Deep navy + brass' },
]

// Shared theme state. Previously every useTheme() instance held its own
// useState, so toggling theme in the sidebar didn't notify chart components —
// their `key={theme}` prop never changed, Chart.js kept the old palette,
// and the user saw a half-repainted UI until reload. Now a module-level
// subscriber set fans out every change to every mounted useTheme() caller.
// First-run default is Modern Light — Dark felt generic for the welcome
// view and gave a strong "yet another fintech app" vibe. Users who prefer
// dark can switch via the sidebar moon icon or Settings; their choice
// persists to localStorage and overrides this default on subsequent loads.
const DEFAULT_THEME = 'modern'
let currentTheme = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return THEMES.some(t => t.id === stored) ? stored : DEFAULT_THEME
  } catch { return DEFAULT_THEME }
})()
const subscribers = new Set()

function applyTheme(next) {
  if (!THEMES.some(t => t.id === next)) return
  currentTheme = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', next)
  }
  for (const fn of subscribers) fn(next)
}

// Apply the initial theme to <html> on first import so CSS variables are
// correct before the first render (avoids a flash of the wrong palette).
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', currentTheme)
}

export function useTheme() {
  const [theme, setLocal] = useState(currentTheme)

  useEffect(() => {
    subscribers.add(setLocal)
    // Sync up in case the theme changed between render and effect.
    if (theme !== currentTheme) setLocal(currentTheme)
    return () => { subscribers.delete(setLocal) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setTheme = (next) => applyTheme(next)
  // Sidebar cycle: advance to the next theme in THEMES, wrapping around.
  // One full loop visits every theme in THEMES order. The Settings page
  // exposes a proper picker for users who'd rather choose directly.
  const toggle = () => {
    const i = THEMES.findIndex(t => t.id === currentTheme)
    const next = THEMES[(i + 1) % THEMES.length].id
    applyTheme(next)
  }

  return { theme, setTheme, toggle, themes: THEMES }
}
