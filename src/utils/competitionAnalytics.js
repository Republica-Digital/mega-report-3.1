export const COMPETITION_METRICS = [
  { key: 'seguidores', label: 'Seguidores', type: 'number' },
  { key: 'crecimiento_pct', label: 'Crecimiento de comunidad', type: 'percent' },
  { key: 'posts', label: 'Posts publicados', type: 'number' },
  { key: 'interaccion', label: 'Interacción total', type: 'number' },
  { key: 'engagement_pct', label: 'Engagement Rate', type: 'percent' },
]

const normalizeText = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')
  .trim()

const normalizePlatform = value => normalizeText(value)

export function getPreviousQuarter(selectedMonth) {
  if (!/^\d{4}-\d{2}$/.test(String(selectedMonth || ''))) return null

  const [year, month] = String(selectedMonth).split('-').map(Number)
  const currentQuarter = Math.floor((month - 1) / 3) + 1
  let previousQuarter = currentQuarter - 1
  let previousYear = year

  if (previousQuarter === 0) {
    previousQuarter = 4
    previousYear -= 1
  }

  const firstMonth = (previousQuarter - 1) * 3 + 1
  const months = [0, 1, 2].map(offset => {
    const m = firstMonth + offset
    return `${previousYear}-${String(m).padStart(2, '0')}`
  })

  return {
    year: previousYear,
    quarter: previousQuarter,
    months,
    label: `Q${previousQuarter} ${previousYear}`,
  }
}

export function getCurrentQuarter(selectedMonth) {
  if (!/^\d{4}-\d{2}$/.test(String(selectedMonth || ''))) return null
  const [year, month] = String(selectedMonth).split('-').map(Number)
  return Math.floor((month - 1) / 3) + 1
}

export function normalizeRate(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  // The source Sheet uses decimal ratios such as 0.043 for 4.3%.
  return Math.abs(n) <= 1 ? n * 100 : n
}

export function formatCompetitionPercent(value, decimals = 2) {
  const n = normalizeRate(value)
  if (n === null) return '—'
  return `${n.toFixed(decimals)}%`
}

export function formatBenchmarkValue(value, metric) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  if (metric?.type === 'percent') return formatCompetitionPercent(value)
  return Math.round(Number(value)).toLocaleString('es-MX')
}

export function formatRankingValue(value, metric) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  if (metric?.type === 'percent') return formatCompetitionPercent(value)
  return Math.round(Number(value)).toLocaleString('es-MX')
}

export function getBrandAliases(brandId, brandName) {
  return new Set([normalizeText(brandId), normalizeText(brandName)].filter(Boolean))
}

export function isMainBrand(row, brandAliases) {
  const competitor = normalizeText(row?.competidor)
  return competitor !== '' && brandAliases.has(competitor)
}

function finiteValues(rows, field) {
  return rows
    .map(row => Number(row?.[field]))
    .filter(Number.isFinite)
}

function average(rows, field) {
  const values = finiteValues(rows, field)
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function calculateQuarterBenchmark(data, platform, selectedMonth) {
  const previousQuarter = getPreviousQuarter(selectedMonth)
  if (!previousQuarter) {
    return { benchmark: null, quarter: null, partial: false, rowsUsed: 0 }
  }

  const platformKey = normalizePlatform(platform)
  const rows = (data || []).filter(row =>
    normalizePlatform(row?.red) === platformKey && previousQuarter.months.includes(row?.mes)
  )

  const benchmark = {}
  for (const metric of COMPETITION_METRICS.filter(m => m.key !== 'seguidores')) {
    benchmark[metric.key] = average(rows, metric.key)
  }

  const availableMonths = new Set(rows.map(row => row?.mes).filter(Boolean))
  const partial = availableMonths.size < previousQuarter.months.length

  return {
    benchmark,
    quarter: previousQuarter,
    partial,
    rowsUsed: rows.length,
    availableMonths: [...availableMonths].sort(),
  }
}

export function calculateRanking(data, platform, selectedMonth, metric, brandAliases) {
  const platformKey = normalizePlatform(platform)
  const rows = (data || []).filter(row =>
    normalizePlatform(row?.red) === platformKey && row?.mes === selectedMonth && row?.competidor
  )

  const deduped = new Map()
  for (const row of rows) {
    const key = normalizeText(row.competidor)
    if (!key) continue
    // Keep the last record if the source has accidental duplicate rows.
    deduped.set(key, row)
  }

  const ranking = [...deduped.values()]
    .map(row => ({
      ...row,
      isBrand: isMainBrand(row, brandAliases),
      value: Number(row?.[metric.key]),
    }))
    .filter(row => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value)
    .map((row, index) => ({ ...row, position: index + 1 }))

  const brandRow = ranking.find(row => row.isBrand) || null

  return {
    ranking,
    brandRow,
    brandPosition: brandRow?.position || null,
    total: ranking.length,
  }
}

export function calculateVsBrand(value, brandValue) {
  const current = Number(value)
  const brand = Number(brandValue)
  if (!Number.isFinite(current) || !Number.isFinite(brand) || brand === 0) return null
  return ((current - brand) / Math.abs(brand)) * 100
}

export function calculateBenchmarkVariation(value, benchmark) {
  const current = Number(value)
  const base = Number(benchmark)
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null
  return ((current - base) / Math.abs(base)) * 100
}

export function normalizePlatformKey(value) {
  return normalizePlatform(value)
}

export function normalizeCompetitorId(value) {
  return normalizeText(value)
}

// ─────────────────────────────────────────────────────────────────────────────
// Share of voice — participación de la marca sobre el total de la categoría
// (todos los competidores + la marca) para el mes seleccionado.
// ─────────────────────────────────────────────────────────────────────────────
function dedupeCompetitorRows(rows = []) {
  const deduped = new Map()
  for (const row of rows) {
    const key = normalizeText(row?.competidor)
    if (!key) continue
    // Keep the last record if the source has accidental duplicate rows.
    deduped.set(key, row)
  }
  return [...deduped.values()]
}

export function calculateShareOfVoice(currentRows = [], brandAliases) {
  const rows = dedupeCompetitorRows(currentRows)

  const sum = (field) => rows.reduce((acc, row) => {
    const n = Number(row?.[field])
    return acc + (Number.isFinite(n) ? n : 0)
  }, 0)

  const totalPosts = sum('posts')
  const totalInteraction = sum('interaccion')

  const brandRow = rows.find(row => isMainBrand(row, brandAliases)) || null
  const brandPosts = Number(brandRow?.posts)
  const brandInteraction = Number(brandRow?.interaccion)

  const postsShare = totalPosts > 0 && Number.isFinite(brandPosts) ? (brandPosts / totalPosts) * 100 : null
  const interactionShare = totalInteraction > 0 && Number.isFinite(brandInteraction) ? (brandInteraction / totalInteraction) * 100 : null

  return {
    postsShare,
    interactionShare,
    totalPosts,
    totalInteraction,
    brandPosts: Number.isFinite(brandPosts) ? brandPosts : null,
    brandInteraction: Number.isFinite(brandInteraction) ? brandInteraction : null,
    competitorsCount: rows.length,
    hasBrand: Boolean(brandRow),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Histórico de competencia — series mensuales configurables por competidor.
// Regla de coherencia: se elige UNA métrica a la vez (misma unidad para todas
// las líneas) y N competidores sobre esa métrica, para que las líneas del
// gráfico siempre sean comparables entre sí.
// ─────────────────────────────────────────────────────────────────────────────
const HISTORY_PALETTE = ['#22d3ee', '#a78bfa', '#f43f5e', '#34d399', '#facc15', '#60a5fa', '#fb7185', '#c084fc', '#4ade80', '#f97316']

export function buildCompetitionHistorySeries({ rows = [], platform, metricKey, brandAliases, maxMonths = 12, endMonth = null, brandColor = '#f59e0b' }) {
  const platformKey = normalizePlatform(platform)
  const platformRows = (rows || []).filter(row =>
    normalizePlatform(row?.red) === platformKey && row?.competidor && (!endMonth || String(row?.mes) <= String(endMonth))
  )

  // Identifica competidores distintos (por nombre normalizado), conservando la
  // última etiqueta visible que haya usado el analista en el Sheet.
  const byId = new Map()
  for (const row of platformRows) {
    const id = normalizeText(row.competidor)
    if (!id) continue
    const existing = byId.get(id)
    if (!existing || String(row.mes) >= String(existing.mes)) {
      byId.set(id, { id, label: row.competidor, isBrand: isMainBrand(row, brandAliases), mes: row.mes })
    }
  }

  let paletteIdx = 0
  const competitors = [...byId.values()]
    .sort((a, b) => (a.isBrand === b.isBrand ? a.label.localeCompare(b.label) : a.isBrand ? -1 : 1))
    .map((c) => ({
      id: c.id,
      label: c.label,
      isBrand: c.isBrand,
      color: c.isBrand ? brandColor : HISTORY_PALETTE[(paletteIdx++) % HISTORY_PALETTE.length],
    }))

  const months = [...new Set(platformRows.map(row => row.mes))].filter(Boolean).sort().slice(-maxMonths)

  const valueByKey = new Map()
  for (const row of platformRows) {
    const id = normalizeText(row.competidor)
    if (!id) continue
    const value = Number(row?.[metricKey])
    if (Number.isFinite(value)) valueByKey.set(`${row.mes}::${id}`, value)
  }

  const series = months.map(mes => {
    const point = { mes }
    for (const c of competitors) {
      const value = valueByKey.get(`${mes}::${c.id}`)
      point[c.id] = value !== undefined ? value : null
    }
    return point
  })

  return { competitors, series, months }
}
