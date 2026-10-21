/** Shell documents follow Electron's app-resolved palette before rendering their cards. */
const palette = window.matchMedia('(prefers-color-scheme: dark)')
const applyPalette = () => { document.body.toggleAttribute('data-ds-dark-theme', palette.matches) }
applyPalette()
palette.addEventListener('change', applyPalette)
window.addEventListener('pagehide', () => { palette.removeEventListener('change', applyPalette) }, { once: true })
