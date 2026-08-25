// ─────────────────────────────────────────────────────────────────────────────
// Nombres de marca forzados en pantalla — independientes de cómo estén
// escritos en la pestaña _MARCAS del Google Sheet (evita depender de que el
// analista capture el nombre con mayúsculas/espacios exactos).
// ─────────────────────────────────────────────────────────────────────────────
export const BRAND_DISPLAY_NAMES = {
  botanera: 'La Botanera',
  chamoy: 'Chamoy Mega',
  pacific: 'Pacific Mix',
}

export function displayBrandName(marcaId, fallback) {
  return BRAND_DISPLAY_NAMES[marcaId] || fallback || '—'
}
