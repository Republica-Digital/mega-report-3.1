import { useMemo, useState } from 'react'
import {
  Activity, ArrowLeft, BarChart3, ChevronLeft, ChevronRight, Eye, Heart, LineChart, Target, Trophy, Users,
  Wallet, Zap, SlidersHorizontal, RotateCcw, TrendingUp, TrendingDown,
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChartCard, MultiMetricLineChart } from '../ui/Charts'
import { SectionHeader, EmptyState } from '../ui/SectionHeader'
import { safeNumber, formatMonthShort, formatMonthLong, formatNumber, formatCurrency, formatPercent, formatPercentPlain } from '../../utils/format'
import {
  buildPlatformHistory,
  buildAccountHistory,
  getMetricHighlights,
  getSocialMetricConfig,
} from '../../utils/historicalAnalytics'
import { buildPaidMediaKPICatalog, computeKpiInsights } from '../../utils/paidMediaAnalytics'
import {
  COMPETITION_METRICS,
  buildCompetitionHistorySeries,
  calculateRanking,
  getBrandAliases,
  normalizeCompetitorId,
} from '../../utils/competitionAnalytics'
import { PLATFORM_CONFIG } from './CompetenciaSection'

const ICONS = { users: Users, eye: Eye, heart: Heart, activity: Activity }

function ScaleToggle({ scale, onChange }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 p-1">
      <button
        onClick={() => onChange('linear')}
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${scale === 'linear' ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white'}`}
      >Lineal</button>
      <button
        onClick={() => onChange('log')}
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${scale === 'log' ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white'}`}
      >Logarítmica</button>
    </div>
  )
}

function MetricSelector({ metrics, selected, onToggle, accent }) {
  return (
    <div className="flex flex-wrap gap-2">
      {metrics.map(metric => {
        const active = selected.includes(metric.key)
        return (
          <button
            key={metric.key}
            onClick={() => onToggle(metric.key)}
            className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${active ? 'text-white' : 'text-white/45 hover:text-white'}`}
            style={active ? { background: `${metric.color}18`, borderColor: `${metric.color}66`, boxShadow: `0 4px 18px -8px ${metric.color}66` } : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: active ? metric.color : 'rgba(255,255,255,0.25)' }} />
            {metric.label}
          </button>
        )
      })}
      <button
        onClick={() => selected.length === metrics.length ? onToggle('__clear__') : onToggle('__all__')}
        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-white/55 hover:text-white transition"
      >
        {selected.length === metrics.length ? 'Quitar todos' : 'Ver todos'}
      </button>
    </div>
  )
}

function HighlightStrip({ rows, selectedMetric, currentMonth, metricConfig }) {
  const metric = metricConfig.find(m => m.key === selectedMetric)
  const highlight = getMetricHighlights(rows, selectedMetric, currentMonth)
  if (!metric || !highlight) return null
  const Icon = ICONS[metric.icon] || Activity
  const comparison = highlight.vsAverage == null
    ? 'No hay suficiente histórico para comparar.'
    : `${highlight.vsAverage >= 0 ? '+' : ''}${highlight.vsAverage.toFixed(1)}% vs. el promedio de los meses anteriores visibles.`
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40 font-semibold">
          <Icon className="w-3.5 h-3.5" style={{ color: metric.color }} /> Mejor mes
        </div>
        <p className="text-lg font-bold text-white mt-2">{formatMonthShort(highlight.bestMonth) || '—'}</p>
        <p className="text-xs text-white/45 mt-1">{formatHistoricalMetric(highlight.bestValue, metric.format)}</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">Mes actual</div>
        <p className="text-lg font-bold text-white mt-2">{formatMonthShort(highlight.currentMonth) || '—'}</p>
        <p className="text-xs text-white/45 mt-1">{formatHistoricalMetric(highlight.currentValue, metric.format)}</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">Comportamiento</div>
        <p className={`text-lg font-bold mt-2 ${highlight.vsAverage == null ? 'text-white/70' : highlight.vsAverage >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
          {highlight.vsAverage == null ? '—' : `${highlight.vsAverage >= 0 ? '+' : ''}${highlight.vsAverage.toFixed(1)}%`}
        </p>
        <p className="text-xs text-white/45 mt-1">{comparison} · {highlight.rank}° de {highlight.totalMonths} meses.</p>
      </div>
    </div>
  )
}

function formatHistoricalMetric(value, format) {
  const n = safeNumber(value)
  if (format === 'percent') return `${n.toFixed(2)}%`
  if (format === 'currency') return formatCurrency(n)
  return formatNumber(n)
}

// Inversión total (Campañas + Google Ads) agrupada por mes, sin filtrar por
// plataforma — es la misma noción de "Inversión Total" que usa el Resumen Ejecutivo.
function buildInvestmentByMonth(campanas = [], googleAds = []) {
  const map = new Map()
  for (const row of campanas) {
    if (!row?.mes) continue
    map.set(row.mes, (map.get(row.mes) || 0) + safeNumber(row.inversion))
  }
  for (const row of googleAds) {
    if (!row?.mes) continue
    map.set(row.mes, (map.get(row.mes) || 0) + safeNumber(row.inversion))
  }
  return map
}

function FanpageHistory({ rows, platform, currentMonth, accent }) {
  const metrics = getSocialMetricConfig(platform)
  const [selected, setSelected] = useState([metrics[0].key])
  const [scale, setScale] = useState('linear')

  const chartLines = metrics.filter(m => selected.includes(m.key)).map(m => ({
    key: m.key,
    name: m.label,
    color: m.color,
    format: m.format,
  }))
  const chartData = rows.map(row => ({ mes: row.mes, ...Object.fromEntries(selected.map(key => [key, safeNumber(row[key])])) }))

  const toggle = key => {
    if (key === '__all__') return setSelected(metrics.map(m => m.key))
    if (key === '__clear__') return setSelected([metrics[0].key])
    setSelected(prev => prev.includes(key) ? (prev.length === 1 ? prev : prev.filter(k => k !== key)) : [...prev, key])
  }

  const primary = metrics.find(m => m.key === selected[0]) || metrics[0]
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">Rendimiento de fanpage</h2>
          <p className="text-xs text-white/45 mt-1">Selecciona uno, dos o todos los KPIs. Cada métrica conserva su propia escala.</p>
        </div>
        <ScaleToggle scale={scale} onChange={setScale} />
      </div>
      <MetricSelector metrics={metrics} selected={selected} onToggle={toggle} accent={accent} />
      <ChartCard title={`${primary.label}${selected.length > 1 ? ' y otros KPIs' : ''}`} subtitle="Histórico mensual · etiquetas siempre visibles" allowLogScale={false} expandable>
        {({ expanded }) => (
          <MultiMetricLineChart data={chartData} lines={chartLines} scale={scale} expanded={expanded} percentKeys={metrics.filter(m => m.format === 'percent').map(m => m.key)} />
        )}
      </ChartCard>
      <HighlightStrip rows={rows} selectedMetric={selected[0]} currentMonth={currentMonth} metricConfig={metrics} />
    </section>
  )
}

const QUICK_MODES = {
  resultados: { label: 'Resultados', icon: BarChart3, desc: 'Los resultados principales de cada objetivo activo' },
  eficiencia: { label: 'Eficiencia', icon: Zap, desc: 'Costo por resultado de cada objetivo' },
  inversion: { label: 'Inversión', icon: Wallet, desc: 'Inversión total del mes' },
  personalizado: { label: 'Personalizado', icon: SlidersHorizontal, desc: 'Tu propia combinación de KPIs' },
}

function quickModeSelection(kpis, mode) {
  if (mode === 'resultados') return kpis.filter(k => k.role === 'result').map(k => k.id)
  if (mode === 'eficiencia') return kpis.filter(k => k.role === 'cost').map(k => k.id)
  if (mode === 'inversion') return ['spend::__total__']
  return []
}

function KpiChipGroup({ title, kpis, selected, onToggle }) {
  if (!kpis.length) return null
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/35 font-semibold mb-1.5">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {kpis.map(kpi => {
          const active = selected.includes(kpi.id)
          const chipLabel = kpi.role === 'investment' || kpi.role === 'investment-total' ? 'Inversión' : kpi.label
          return (
            <button
              key={kpi.id}
              onClick={() => onToggle(kpi.id)}
              className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${active ? 'text-white' : 'text-white/45 hover:text-white'}`}
              style={active ? { background: `${kpi.color}20`, borderColor: `${kpi.color}70` } : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: active ? kpi.color : 'rgba(255,255,255,0.25)' }} />
              {chipLabel}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function statValue(kpi, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (kpi.unit === 'currency') return formatCurrency(value)
  if (kpi.unit === 'percent') return formatPercentPlain(value, 2)
  return formatNumber(value)
}

function statVariation(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return formatPercent(value, 1)
}

function VariationTag({ value }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-white/30">—</span>
  }
  const positive = value >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
      {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {statVariation(value)}
    </span>
  )
}

function KpiInsightCard({ kpi, insights, currentMonth }) {
  if (!insights) return null
  const isInvestment = kpi.role === 'investment' || kpi.role === 'investment-total'
  const bestLabel = isInvestment ? 'Mayor inversión' : 'Mejor mes'
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 min-w-[240px] flex-1">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full" style={{ background: kpi.color }} />
        <p className="text-xs font-bold text-white truncate">{kpi.role === 'investment' || kpi.role === 'investment-total' ? 'Inversión' : kpi.label}</p>
      </div>
      <p className="text-xl font-bold text-white font-display">{statValue(kpi, insights.currentValue)}</p>
      <p className="text-[10px] text-white/35 mb-3">{formatMonthShort(currentMonth)}</p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <div className="text-white/40">{bestLabel}</div>
        <div className="text-white text-right font-semibold">{statValue(kpi, insights.bestValue)} <span className="text-white/30 font-normal">({formatMonthShort(insights.bestMonth)})</span></div>

        <div className="text-white/40">Promedio ({formatMonthShort(insights.currentMonth)?.split(' ')[0] === 'Ene' ? 'Ene' : `Ene–${formatMonthShort(insights.currentMonth).split(' ')[0]}`})</div>
        <div className="text-white text-right font-semibold">{statValue(kpi, insights.average)}</div>

        <div className="text-white/40">Vs. promedio</div>
        <div className="text-right"><VariationTag value={insights.vsAverage} /></div>

        <div className="text-white/40">Vs. mes anterior</div>
        <div className="text-right">{insights.hasPrevMonth ? <VariationTag value={insights.vsPrevMonth} /> : <span className="text-white/30">—</span>}</div>

        <div className="text-white/40">Vs. enero</div>
        <div className="text-right">{insights.isJanuary ? <span className="text-white/30">—</span> : <VariationTag value={insights.vsJanuary} />}</div>

        {kpi.accumulate && (
          <>
            <div className="text-white/40">{isInvestment ? 'Inversión acumulada' : 'Acumulado'}</div>
            <div className="text-white text-right font-semibold">{statValue(kpi, insights.accumulated)}</div>
          </>
        )}
      </div>
    </div>
  )
}

function PaidMediaHistory({ campanas, platform, currentMonth, accent, socialRows = [] }) {
  const catalog = useMemo(
    () => buildPaidMediaKPICatalog(campanas, platform, socialRows, currentMonth),
    [campanas, platform, socialRows, currentMonth]
  )
  const { months, objectives, kpis } = catalog
  const kpiById = useMemo(() => new Map(kpis.map(k => [k.id, k])), [kpis])

  const [quickMode, setQuickMode] = useState('resultados')
  const [selected, setSelected] = useState(() => quickModeSelection(kpis, 'resultados'))
  const [scale, setScale] = useState('linear')

  const applyQuickMode = (mode) => {
    setQuickMode(mode)
    setSelected(quickModeSelection(kpis, mode))
  }

  const toggleKpi = (id) => {
    setQuickMode('personalizado')
    setSelected(prev => prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id])
  }

  const clearSelection = () => {
    setQuickMode('personalizado')
    setSelected([])
  }

  const selectedKpis = selected.map(id => kpiById.get(id)).filter(Boolean)

  const chartData = useMemo(() => months.map(mes => {
    const row = { mes }
    for (const kpi of kpis) row[kpi.id] = kpi.series[mes]
    return row
  }), [months, kpis])

  const lines = selectedKpis.map(kpi => ({
    key: kpi.id,
    name: kpi.role === 'investment' || kpi.role === 'investment-total' ? `Inversión · ${kpi.objectiveKey === '__total__' ? 'Total' : kpi.objectiveKey}` : kpi.label,
    color: kpi.color,
    format: kpi.unit === 'currency' ? 'currency' : undefined,
  }))
  const percentKeys = selectedKpis.filter(k => k.unit === 'percent').map(k => k.id)

  const totalInvestmentKpi = kpiById.get('spend::__total__')
  const perObjectiveKpis = kpis.filter(k => k.role !== 'investment-total')

  return (
    <section className="space-y-4 pt-2">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">Rendimiento de Paid Media</h2>
          <p className="text-xs text-white/45 mt-1">
            Analizando {formatMonthLong(currentMonth)} — histórico desde enero
          </p>
        </div>
        <ScaleToggle scale={scale} onChange={setScale} />
      </div>

      {kpis.length <= 1 ? (
        <div className="glass-card rounded-2xl p-8 text-center text-white/40 text-sm">No hay campañas históricas para esta plataforma.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {Object.entries(QUICK_MODES).map(([key, cfg]) => {
              const Icon = cfg.icon
              const active = quickMode === key
              return (
                <button
                  key={key}
                  onClick={() => key === 'personalizado' ? setQuickMode('personalizado') : applyQuickMode(key)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 ${active ? 'text-white' : 'text-white/45 hover:text-white'}`}
                  style={active ? { background: `${accent}1a`, borderColor: `${accent}66` } : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {cfg.label}
                </button>
              )
            })}
            <div className="flex-1" />
            <button onClick={clearSelection} className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/40 hover:text-white text-xs font-semibold flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> Limpiar selección
            </button>
          </div>

          <div className="space-y-3">
            {totalInvestmentKpi && (
              <KpiChipGroup title="General" kpis={[totalInvestmentKpi]} selected={selected} onToggle={toggleKpi} />
            )}
            {objectives.map(obj => (
              <KpiChipGroup
                key={obj.key}
                title={obj.label}
                kpis={perObjectiveKpis.filter(k => k.objectiveKey === obj.key)}
                selected={selected}
                onToggle={toggleKpi}
              />
            ))}
          </div>

          {selectedKpis.length === 0 ? (
            <div className="glass-card rounded-2xl p-8 text-center text-white/40 text-sm">Selecciona al menos un KPI para ver su evolución.</div>
          ) : (
            <>
              <ChartCard title="Evolución histórica" subtitle={`${selectedKpis.length} KPI${selectedKpis.length === 1 ? '' : 's'} seleccionado${selectedKpis.length === 1 ? '' : 's'}`} allowLogScale={false}>
                {({ expanded }) => (
                  <MultiMetricLineChart data={chartData} lines={lines} scale={scale} expanded={expanded} connectNulls={false} percentKeys={percentKeys} />
                )}
              </ChartCard>

              <div className="flex flex-wrap gap-3">
                {selectedKpis.map(kpi => (
                  <KpiInsightCard key={kpi.id} kpi={kpi} insights={computeKpiInsights(kpi, months, currentMonth)} currentMonth={currentMonth} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

export function AccountHistoricalCarousel({ historical, campanas = [], selectedMonth, theme }) {
  const [index, setIndex] = useState(0)
  const [scale, setScale] = useState('linear')
  const metrics = [
    { key: 'seguidores', label: 'Seguidores', color: theme?.primary || '#60a5fa', format: 'number', icon: Users },
    { key: 'alcance', label: 'Alcance', color: '#22d3ee', format: 'number', icon: Eye },
    { key: 'interacciones', label: 'Interacciones', color: '#ec4899', format: 'number', icon: Heart },
    { key: 'engagement_rate', label: 'Engagement Rate', color: '#22c55e', format: 'percent', icon: Activity },
    { key: 'inversion_total', label: 'Inversión Total', color: '#f59e0b', format: 'currency', icon: Wallet },
    { key: 'cpm', label: 'Costo por Mil Alcanzados', color: '#eab308', format: 'currency', icon: Target, better: 'lower' },
  ]
  const rows = useMemo(() => {
    const base = buildAccountHistory({ facebook: historical?.facebook || [], instagram: historical?.instagram || [], tiktok: historical?.tiktok || [] }, 12, selectedMonth)
    const investmentByMonth = buildInvestmentByMonth(campanas, historical?.googleAds || [])
    return base.map(row => {
      const inversion_total = investmentByMonth.get(row.mes) || 0
      const cpm = row.alcance > 0 ? (inversion_total / row.alcance) * 1000 : null
      return { ...row, inversion_total, cpm }
    })
  }, [historical, campanas, selectedMonth])
  const metric = metrics[index]
  const Icon = metric.icon
  const chartData = rows.map(r => ({ mes: r.mes, [metric.key]: safeNumber(r[metric.key]) }))
  const highlight = getMetricHighlights(rows, metric.key, selectedMonth, metric.better || 'higher')
  return (
    <ChartCard title="Histórico de performance de la cuenta" subtitle="Un KPI a la vez · acumulado de Facebook + Instagram + TikTok" allowLogScale={false}>
      {({ expanded }) => (
        <div>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={() => setIndex((index - 1 + metrics.length) % metrics.length)} className="p-2 rounded-xl border border-white/10 bg-white/5 text-white/50 hover:text-white" title="KPI anterior"><ChevronLeft className="w-4 h-4" /></button>
              {metrics.map((m, i) => (
                <button key={m.key} onClick={() => setIndex(i)} className={`px-3 py-2 rounded-xl text-xs font-semibold border transition ${index === i ? 'text-white' : 'text-white/45 hover:text-white'}`} style={index === i ? { background: `${m.color}18`, borderColor: `${m.color}66` } : { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}>
                  {m.label}
                </button>
              ))}
              <button onClick={() => setIndex((index + 1) % metrics.length)} className="p-2 rounded-xl border border-white/10 bg-white/5 text-white/50 hover:text-white" title="Siguiente KPI"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <ScaleToggle scale={scale} onChange={setScale} />
          </div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Icon className="w-4 h-4" style={{ color: metric.color }} /> {metric.label}</div>
            {highlight && <span className="text-[11px] text-white/40">Mejor mes: <strong className="text-white/75">{formatMonthShort(highlight.bestMonth)}</strong></span>}
          </div>
          <MultiMetricLineChart data={chartData} lines={[{ key: metric.key, name: metric.label, color: metric.color, format: metric.format }]} scale={scale} expanded={expanded} percentKeys={metric.format === 'percent' ? [metric.key] : []} />
          {highlight && (
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-white/45">
              <span>Mejor mes: <strong className="text-white">{formatMonthShort(highlight.bestMonth)}</strong> · {formatHistoricalMetric(highlight.bestValue, metric.format)}</span>
              <span>Actual: <strong className={highlight.vsAverage >= 0 ? 'text-emerald-300' : 'text-red-300'}>{highlight.vsAverage == null ? 'sin comparación' : `${highlight.vsAverage >= 0 ? '+' : ''}${highlight.vsAverage.toFixed(1)}% vs promedio previo`}</strong></span>
            </div>
          )}
        </div>
      )}
    </ChartCard>
  )
}

export function PlatformHistory({ platform, historical = [], campanas = [], currentMonth, theme }) {
  const navigate = useNavigate()
  const { marcaId } = useParams()
  const rows = useMemo(() => buildPlatformHistory(historical, platform, 12, currentMonth), [historical, platform, currentMonth])
  const cfg = getSocialMetricConfig(platform)
  const label = platform === 'instagram' ? 'Instagram' : platform === 'tiktok' ? 'TikTok' : 'Facebook'
  const accent = cfg[0]?.color || theme?.primary || '#6366f1'

  return (
    <div className="space-y-7">
      <SectionHeader
        icon={LineChart}
        title={`Histórico de ${label}`}
        subtitle="Lectura de tendencia y comportamiento mensual"
        accentColor={accent}
        actions={
          <button onClick={() => navigate(`/dashboard/${marcaId}/${platform}`)} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/70 hover:text-white flex items-center gap-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Volver a {label}
          </button>
        }
      />

      <div className="glass-card rounded-2xl p-5 border border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4" style={{ color: accent }} />
          <span className="text-sm font-semibold text-white">Rendimiento de fanpage</span>
        </div>
        <FanpageHistory rows={rows} platform={platform} currentMonth={currentMonth} accent={accent} />
      </div>

      <div className="glass-card rounded-2xl p-5 border border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-4 h-4" style={{ color: '#f59e0b' }} />
          <span className="text-sm font-semibold text-white">Paid Media</span>
        </div>
        <PaidMediaHistory campanas={campanas} platform={platform} currentMonth={currentMonth} accent={accent} socialRows={rows} />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Histórico de competencia — configurable por métrica + competidores.
//
// Regla de coherencia: se elige UNA sola métrica a la vez (mismas unidades para
// todas las líneas) y luego cuáles competidores graficar sobre esa métrica.
// Así el usuario nunca puede combinar cosas que no son comparables entre sí
// (p. ej. seguidores de uno con engagement % de otro), y la gráfica no se
// amontona: hasta MAX_HISTORY_COMPETITORS líneas a la vez.
// ═══════════════════════════════════════════════════════════════════════════════
const MAX_HISTORY_COMPETITORS = 6

function CompetitorChipSelector({ competitors, selected, onToggle, max = MAX_HISTORY_COMPETITORS }) {
  return (
    <div className="flex flex-wrap gap-2">
      {competitors.map(c => {
        const active = selected.includes(c.id)
        const disabled = !active && selected.length >= max
        return (
          <button
            key={c.id}
            onClick={() => !disabled && onToggle(c.id)}
            disabled={disabled}
            title={disabled ? `Máximo ${max} competidores a la vez` : undefined}
            className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${active ? 'text-white' : disabled ? 'text-white/20 cursor-not-allowed' : 'text-white/45 hover:text-white'}`}
            style={active ? { background: `${c.color}18`, borderColor: `${c.color}66`, boxShadow: `0 4px 18px -8px ${c.color}66` } : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: active ? c.color : 'rgba(255,255,255,0.25)' }} />
            {c.label}{c.isBrand ? ' · Marca' : ''}
          </button>
        )
      })}
    </div>
  )
}

// Se remonta (via `key`) cada vez que cambia la métrica, así cada métrica
// arranca con su propia selección de competidores recomendada.
function CompetitionMetricPanel({ metricConfig, competitors, series, defaultSelection, scale, label }) {
  const [selected, setSelected] = useState(defaultSelection)

  const toggle = id => setSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : (prev.length >= MAX_HISTORY_COMPETITORS ? prev : [...prev, id])
  )

  const lines = selected
    .map(id => competitors.find(c => c.id === id))
    .filter(Boolean)
    .map(c => ({ key: c.id, name: c.label, color: c.color, format: metricConfig.type === 'percent' ? 'percent' : undefined }))
  const percentKeys = metricConfig.type === 'percent' ? selected : []

  return (
    <>
      <CompetitorChipSelector competitors={competitors} selected={selected} onToggle={toggle} />
      {selected.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center text-white/40 text-sm">Selecciona al menos un competidor para ver su evolución.</div>
      ) : (
        <ChartCard title={metricConfig.label} subtitle={`Histórico mensual · ${label}`} allowLogScale={false}>
          {({ expanded }) => (
            <MultiMetricLineChart data={series} lines={lines} scale={scale} expanded={expanded} percentKeys={percentKeys} connectNulls={false} />
          )}
        </ChartCard>
      )}
    </>
  )
}

export function CompetenciaHistory({ platform, allData = [], currentMonth, brandId, brandConfig }) {
  const navigate = useNavigate()
  const { marcaId } = useParams()
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.facebook
  const accent = cfg.accent
  const label = cfg.label

  const [selectedMetric, setSelectedMetric] = useState('seguidores')
  const [scale, setScale] = useState('linear')

  const brandAliases = useMemo(
    () => getBrandAliases(brandId, brandConfig?.nombre),
    [brandId, brandConfig?.nombre]
  )
  const metricConfig = COMPETITION_METRICS.find(m => m.key === selectedMetric) || COMPETITION_METRICS[0]

  const { competitors, series } = useMemo(
    () => buildCompetitionHistorySeries({
      rows: allData,
      platform,
      metricKey: selectedMetric,
      brandAliases,
      maxMonths: 12,
      endMonth: currentMonth,
      brandColor: accent,
    }),
    [allData, platform, selectedMetric, brandAliases, currentMonth, accent]
  )

  // Selección recomendada: la marca + los mejores rankeados del mes vigente
  // para la métrica elegida, hasta un máximo de 4 líneas por default.
  const defaultSelection = useMemo(() => {
    const ranking = calculateRanking(allData, platform, currentMonth, metricConfig, brandAliases).ranking
    const rankedIds = ranking.map(row => competitors.find(c => c.id === normalizeCompetitorId(row.competidor))?.id).filter(Boolean)
    const brand = competitors.find(c => c.isBrand)
    const ordered = brand ? [brand.id, ...rankedIds.filter(id => id !== brand.id)] : rankedIds
    const fallback = competitors.map(c => c.id)
    return (ordered.length ? ordered : fallback).slice(0, 4)
  }, [allData, platform, currentMonth, metricConfig, brandAliases, competitors])

  return (
    <div className="space-y-7">
      <SectionHeader
        icon={Trophy}
        title={`Histórico de competencia · ${label}`}
        subtitle="Compara a la marca contra sus competidores, mes a mes"
        accentColor={accent}
        actions={
          <button onClick={() => navigate(`/dashboard/${marcaId}/${platform}/competencia`)} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/70 hover:text-white flex items-center gap-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Volver a Competencia
          </button>
        }
      />

      {!competitors.length ? (
        <EmptyState icon={Trophy} title="Sin histórico de competencia" message={`Todavía no hay datos de Competencia registrados para ${label}.`} />
      ) : (
        <div className="glass-card rounded-2xl p-5 border border-white/10 bg-white/[0.02] space-y-4">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-bold text-white">Evolución por KPI</h2>
              <p className="text-xs text-white/45 mt-1">
                Elige una métrica y hasta {MAX_HISTORY_COMPETITORS} competidores para compararlos. Todas las líneas usan la misma métrica para que sean comparables entre sí.
              </p>
            </div>
            <ScaleToggle scale={scale} onChange={setScale} />
          </div>

          <div className="flex flex-wrap gap-1.5 p-1 rounded-xl border border-white/10 bg-white/[0.025] w-fit">
            {COMPETITION_METRICS.map(metric => (
              <button
                key={metric.key}
                onClick={() => setSelectedMetric(metric.key)}
                className={`px-3 py-2 rounded-lg text-[11px] font-semibold transition-all ${selectedMetric === metric.key ? 'text-white' : 'text-white/45 hover:text-white/80'}`}
                style={selectedMetric === metric.key ? { background: `${accent}18`, border: `1px solid ${accent}45` } : { border: '1px solid transparent' }}
              >
                {metric.label}
              </button>
            ))}
          </div>

          <CompetitionMetricPanel
            key={selectedMetric}
            metricConfig={metricConfig}
            competitors={competitors}
            series={series}
            defaultSelection={defaultSelection}
            scale={scale}
            label={label}
          />
        </div>
      )}
    </div>
  )
}
