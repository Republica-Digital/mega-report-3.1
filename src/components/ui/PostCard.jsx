import { Heart, Eye, Play, Trophy, Sparkles, Lightbulb, ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon, Loader, AlertCircle } from 'lucide-react'
import { useState, useEffect, useRef, useMemo } from 'react'
import { formatNumber } from '../../utils/format'
import { isNullishString, classifyEmbed, extractLinkFromEmbed, detectPlatform } from '../../utils/urls'

const EMBED_MIN_HEIGHT = 300
const EMBED_MAX_HEIGHT = 520
const EMBED_HEIGHT = EMBED_MIN_HEIGHT // usado por los estados de carga/error/imagen dentro del embed
const FACEBOOK_EMBED_WIDTH = 320
const FACEBOOK_SDK_URL = 'https://connect.facebook.net/es_LA/sdk.js#xfbml=1&version=v18.0'

const PLATFORM_STYLES = {
  facebook:  { gradient: 'from-blue-500 to-blue-700',                bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.35)',  label: 'Facebook' },
  instagram: { gradient: 'from-pink-500 via-purple-500 to-orange-500', bg: 'rgba(236,72,153,0.15)',  border: 'rgba(236,72,153,0.35)',  label: 'Instagram' },
  tiktok:    { gradient: 'from-cyan-400 via-pink-500 to-red-500',     bg: 'rgba(34,211,238,0.15)',  border: 'rgba(34,211,238,0.35)',  label: 'TikTok' },
}

const TYPE_LABELS = {
  alcance: { label: 'Alcance', icon: Eye, metric: 'alcance' },
  interaccion: { label: 'Interacción', icon: Heart, metric: 'interacciones' },
  views: { label: 'Reproducciones', icon: Play, metric: 'views' },
}

const normalizePlatform = (value) => String(value || '')
  .toLowerCase()
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')

let pendingTikTokEmbeds = null
let facebookSdkPromise = null

function reloadTikTokEmbeds(onLoad, onError) {
  if (typeof document === 'undefined') return
  if (!pendingTikTokEmbeds) {
    pendingTikTokEmbeds = new Promise((resolve, reject) => {
      window.setTimeout(() => {
        document.getElementById('tt-embed')?.remove()
        const script = document.createElement('script')
        script.src = 'https://www.tiktok.com/embed.js'
        script.id = 'tt-embed'
        script.async = true
        script.onload = resolve
        script.onerror = reject
        document.body.appendChild(script)
      }, 50)
    }).finally(() => { pendingTikTokEmbeds = null })
  }
  pendingTikTokEmbeds.then(onLoad, onError)
}

function ensureFacebookSdk() {
  if (typeof document === 'undefined') return Promise.resolve(null)
  if (window.FB?.XFBML) return Promise.resolve(window.FB)
  if (facebookSdkPromise) return facebookSdkPromise

  facebookSdkPromise = new Promise((resolve, reject) => {
    let root = document.getElementById('fb-root')
    if (!root) {
      root = document.createElement('div')
      root.id = 'fb-root'
      document.body.prepend(root)
    }

    const existing = document.getElementById('fb-sdk')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.FB), { once: true })
      existing.addEventListener('error', reject, { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = 'fb-sdk'
    script.src = FACEBOOK_SDK_URL
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.onload = () => resolve(window.FB)
    script.onerror = reject
    document.body.appendChild(script)
  })

  return facebookSdkPromise
}

function normalizeFacebookEmbed(container) {
  if (!container) return
  const width = Math.min(container.clientWidth || FACEBOOK_EMBED_WIDTH, FACEBOOK_EMBED_WIDTH)

  container.querySelectorAll('.fb-post, .fb-video').forEach(node => {
    node.setAttribute('data-width', String(width))
    node.setAttribute('data-show-text', 'true')
    node.style.width = '100%'
    node.style.maxWidth = `${FACEBOOK_EMBED_WIDTH}px`
    node.style.margin = '0 auto'
  })

  container.querySelectorAll('iframe').forEach(iframe => {
    const src = iframe.getAttribute('src') || ''
    if (!src.includes('facebook.com/plugins/')) return

    try {
      const parsed = new URL(src)
      parsed.searchParams.set('width', String(width))
      parsed.searchParams.set('show_text', 'true')
      iframe.setAttribute('src', parsed.toString())
    } catch {}

    iframe.setAttribute('width', String(width))
    iframe.style.width = '100%'
    iframe.style.maxWidth = `${FACEBOOK_EMBED_WIDTH}px`
    iframe.style.margin = '0 auto'
    iframe.style.background = '#fff'
    iframe.style.borderRadius = '10px'
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal HTML Embed — accepts ANY embed code pasted into embed_url.
// Scales iframes to fit the container by setting width=100% and preserving
// aspect ratio. Supports Instagram, Facebook, TikTok, YouTube, plain iframes.
// ─────────────────────────────────────────────────────────────────────────────
function UniversalEmbed({ html, platform, onFail }) {
  const ref = useRef(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const isFacebookEmbed = platform === 'facebook' || String(html || '').toLowerCase().includes('facebook')

  useEffect(() => {
    if (!html || !ref.current) return
    ref.current.innerHTML = html
    if (isFacebookEmbed) normalizeFacebookEmbed(ref.current)

    // Normalize any iframe inside the embed: fill parent & keep aspect.
    const iframes = ref.current.querySelectorAll('iframe')
    iframes.forEach(iframe => {
      iframe.style.maxWidth = '100%'
      iframe.style.width = '100%'
      iframe.style.border = '0'
      iframe.style.display = 'block'
      iframe.setAttribute('loading', 'lazy')
      // Hide scrolling artefacts
      iframe.setAttribute('scrolling', 'no')
      // If height is explicit, keep it; otherwise fill container
      if (!iframe.style.height && !iframe.getAttribute('height')) {
        iframe.style.height = '100%'
      }
      // Detect if the iframe src is a Meta business preview link (requires login)
      const src = iframe.getAttribute('src') || ''
      if (src.includes('business.facebook.com/ads/api/preview_iframe')) {
        setFailed(true)
        onFail?.()
      }
    })

    // Load platform-specific SDK when needed
    const loadScript = (id, src, cb) => {
      if (document.getElementById(id)) { cb?.(); return }
      const s = document.createElement('script')
      s.id = id; s.src = src; s.async = true
      s.onload = cb
      s.onerror = () => { setFailed(true); onFail?.() }
      document.body.appendChild(s)
    }

    const lc = html.toLowerCase()
    if (lc.includes('instagram') || platform === 'instagram') {
      loadScript('ig-embed', 'https://www.instagram.com/embed.js', () => {
        try { window.instgrm?.Embeds?.process(ref.current) } catch {}
        setLoading(false)
      })
    } else if (lc.includes('tiktok') || platform === 'tiktok') {
      reloadTikTokEmbeds(
        () => setLoading(false),
        () => { setFailed(true); onFail?.() }
      )
    } else if (lc.includes('fb-post') || lc.includes('fb-video') || lc.includes('connect.facebook.net') || isFacebookEmbed) {
      ensureFacebookSdk().then(() => {
        normalizeFacebookEmbed(ref.current)
        try { window.FB?.XFBML?.parse(ref.current) } catch {}
        window.setTimeout(() => normalizeFacebookEmbed(ref.current), 300)
        setLoading(false)
      }).catch(() => { setFailed(true); onFail?.() })
    } else {
      setLoading(false)
    }

    const timeout = setTimeout(() => setLoading(false), 4000)
    return () => clearTimeout(timeout)
  }, [html, platform, isFacebookEmbed])

  if (failed) {
    return (
      <div className="relative bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-xl overflow-hidden flex items-center justify-center p-6" style={{ minHeight: EMBED_HEIGHT }}>
        <div className="text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-amber-400/80 mx-auto mb-3" />
          <p className="text-white/80 text-sm font-semibold mb-2">Vista previa no disponible</p>
          <p className="text-white/50 text-xs">
            Este post no se puede mostrar aquí directamente. Consulta la publicación original en la plataforma correspondiente.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative flex justify-center"
      style={{ minHeight: loading ? EMBED_HEIGHT : undefined }}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Loader className="w-6 h-6 text-white/40 animate-spin" />
        </div>
      )}
      <div
        ref={ref}
        className="flex min-w-0 w-full items-start justify-center"
        style={{
          maxWidth: isFacebookEmbed ? FACEBOOK_EMBED_WIDTH : undefined,
        }}
      />
    </div>
  )
}

// URL → Embed (IG/FB/TT public URLs get converted to proper iframes)
function FacebookUrlEmbed({ url, isVideo, onFail }) {
  const ref = useRef(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!url || !ref.current) return
    setLoading(true)
    ref.current.innerHTML = `
      <div
        class="${isVideo ? 'fb-video' : 'fb-post'}"
        data-href="${url}"
        data-width="${FACEBOOK_EMBED_WIDTH}"
        data-show-text="true"
      ></div>
    `

    normalizeFacebookEmbed(ref.current)
    ensureFacebookSdk().then(() => {
      try { window.FB?.XFBML?.parse(ref.current) } catch {}
      window.setTimeout(() => normalizeFacebookEmbed(ref.current), 300)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
      onFail?.()
    })
  }, [url, isVideo, onFail])

  return (
    <div className="relative flex justify-center" style={{ minHeight: loading ? EMBED_HEIGHT : undefined }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Loader className="w-6 h-6 text-zinc-500 animate-spin" />
        </div>
      )}
      <div
        ref={ref}
        className="flex min-w-0 w-full items-start justify-center"
        style={{ maxWidth: FACEBOOK_EMBED_WIDTH }}
      />
    </div>
  )
}

function UrlEmbed({ url, type, isVideo, onFail }) {
  const [loading, setLoading] = useState(true)
  const ref = useRef(null)

  const embedSrc = useMemo(() => {
    if (type === 'ig_url') {
      const clean = url.split('?')[0].replace(/\/$/, '')
      return `${clean}/embed`
    }
    return null
  }, [url, type])

  useEffect(() => {
    if (type !== 'tt_url' || !ref.current) return
    setLoading(true)
    const videoId = url.match(/video\/(\d+)/)?.[1]
    if (!videoId) { onFail?.(); return }
    ref.current.innerHTML = `
      <blockquote class="tiktok-embed" cite="${url}" data-video-id="${videoId}" style="max-width:380px;min-width:280px;margin:0;">
        <section></section>
      </blockquote>
    `
    reloadTikTokEmbeds(() => setLoading(false), onFail)
  }, [url, type])

  if (type === 'tt_url') {
    return (
      <div className="relative flex items-start justify-center" style={{ minHeight: loading ? EMBED_HEIGHT : undefined }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <Loader className="w-6 h-6 text-white/40 animate-spin" />
          </div>
        )}
        <div ref={ref} className="flex w-full min-w-0 justify-center" />
      </div>
    )
  }

  if (type === 'fb_url') {
    return <FacebookUrlEmbed url={url} isVideo={isVideo} onFail={onFail} />
  }

  if (!embedSrc) return null

  return (
    <div
      className="relative flex justify-center"
      style={{ minHeight: loading ? EMBED_HEIGHT : undefined }}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Loader className="w-6 h-6 text-white/40 animate-spin" />
        </div>
      )}
      <iframe
        src={embedSrc}
        title="Vista previa de Instagram"
        className="border-0"
        style={{
          height: isVideo ? EMBED_MAX_HEIGHT : 400,
          width: '100%',
        }}
        scrolling="no"
        allowFullScreen
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
        onLoad={() => setLoading(false)}
        onError={() => onFail?.()}
      />
    </div>
  )
}

// Image fallback
function ImagePreview({ src, isVideo, onFail }) {
  return (
    <div className="relative flex justify-center">
      <img
        src={src}
        alt="Vista previa de la publicación"
        onError={onFail}
        className="max-w-full object-contain"
        style={{ maxHeight: EMBED_MAX_HEIGHT }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/30" />
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-white/25 backdrop-blur-md border border-white/40 flex items-center justify-center">
            <Play className="w-6 h-6 text-white fill-white" />
          </div>
        </div>
      )}
    </div>
  )
}

// Placeholder branded
function Placeholder({ platform, isVideo }) {
  const style = PLATFORM_STYLES[platform] || PLATFORM_STYLES.facebook
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br ${style.gradient}`} style={{ height: EMBED_HEIGHT }}>
      <div className="absolute inset-0 opacity-30">
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-white/20 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-56 h-56 rounded-full bg-black/20 blur-3xl" />
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur-md border border-white/30 flex items-center justify-center mb-4 shadow-lg">
          {isVideo ? <Play className="w-8 h-8 text-white fill-white" /> : <ImageIcon className="w-7 h-7 text-white" />}
        </div>
        <p className="text-white/90 text-sm font-medium">Vista previa no disponible</p>
        <div className="absolute bottom-3 right-3 text-[10px] uppercase tracking-widest text-white/60 font-semibold">
          {style.label}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PostPreview — smart fallback chain
// ─────────────────────────────────────────────────────────────────────────────
function PostPreview({ post, platform, isVideo, embedInfo }) {
  const [embedFailed, setEmbedFailed] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const hasImage = !isNullishString(post.imagen_url) && !imgFailed

  if (!embedFailed && embedInfo.type === 'html_embed') {
    return <UniversalEmbed html={embedInfo.value} platform={platform} onFail={() => setEmbedFailed(true)} />
  }
  if (!embedFailed && ['ig_url', 'fb_url', 'tt_url'].includes(embedInfo.type)) {
    return <UrlEmbed url={embedInfo.value} type={embedInfo.type} isVideo={isVideo} onFail={() => setEmbedFailed(true)} />
  }
  if (hasImage) {
    return <ImagePreview src={post.imagen_url} isVideo={isVideo} onFail={() => setImgFailed(true)} />
  }
  return <Placeholder platform={platform} isVideo={isVideo} />
}

function getTypeInfo(label, key) {
  if (Object.hasOwn(TYPE_LABELS, key)) return TYPE_LABELS[key]
  if (key === 'reproducciones') return TYPE_LABELS.views
  if (key === 'interacciones') return TYPE_LABELS.interaccion
  if (/\s[-–—]\s*(views|reproducciones)$/.test(key)) {
    return { ...TYPE_LABELS.views, label }
  }
  return { label, icon: Trophy }
}

function getMetricValue(post, field) {
  const value = post[field]
  if (value === null || value === undefined || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function groupTopPosts(posts) {
  const groups = new Map()
  for (const post of posts) {
    const label = String(post.tipo_top || '').trim() || 'Sin objetivo'
    const key = normalizePlatform(label).replace(/\s+/g, ' ')
    if (!groups.has(key)) {
      groups.set(key, { key, ...getTypeInfo(label, key), highlights: [], opportunities: [] })
    }
    const group = groups.get(key)
    const isOpportunity = normalizePlatform(post.clasificacion) === 'oportunidad de mejora'
    const entries = isOpportunity ? group.opportunities : group.highlights
    entries.push(post)
  }

  return [...groups.values()].map(group => {
    const { highlights, opportunities, metric } = group
    const canRank = metric && highlights.every(post => getMetricValue(post, metric) !== null)
    if (canRank) highlights.sort((a, b) => getMetricValue(b, metric) - getMetricValue(a, metric))
    return {
      ...group,
      editorialOrder: highlights.length > 1 && !canRank,
      slides: [
        ...highlights.map((post, index) => ({ post, label: 'Top ' + (index + 1), isOpportunity: false })),
        ...opportunities.map(post => ({ post, label: 'Oportunidad de mejora', isOpportunity: true })),
      ],
    }
  })
}

const METRICS = Object.values(TYPE_LABELS).map(({ metric, label, icon }) => ({ metric, label, icon }))

function PostSlide({ slide, platform, group }) {
  const { post, label, isOpportunity } = slide
  const isVideo = platform === 'tiktok' || /video|reel|fb-video|facebook\.com\/watch/i.test([post.tipo, post.embed_url].join(' '))
  const embedInfo = classifyEmbed(post.embed_url)
  const linkUrl = extractLinkFromEmbed(post.embed_url)
  const BadgeIcon = isOpportunity ? Lightbulb : Sparkles
  const badgeStyle = isOpportunity
    ? 'border-cyan-300/25 bg-cyan-400/10 text-cyan-200'
    : 'border-amber-300/25 bg-amber-400/10 text-amber-200'

  const metrics = METRICS
    .map(metric => ({ ...metric, value: getMetricValue(post, metric.metric) }))
    .filter(metric => metric.value !== null && (metric.value > 0 || metric.metric === group.metric))
  if (group.metric) metrics.sort((a, b) => Number(b.metric === group.metric) - Number(a.metric === group.metric))

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span className={'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ' + badgeStyle}>
          <BadgeIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </span>
        {linkUrl && (
          <a href={linkUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-white/65 hover:text-white">
            Ver publicación original <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </div>

      <div className="mx-4 overflow-x-hidden overflow-y-auto rounded-xl border border-white/10 bg-black/25"
        style={{ maxHeight: EMBED_MAX_HEIGHT }}>
        <PostPreview post={post} platform={platform} isVideo={isVideo} embedInfo={embedInfo} />
      </div>

      <div className="space-y-3 p-4">
        {!!metrics.length && (
          <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl bg-white/5 px-4 py-3">
            {metrics.map(({ metric, label: metricLabel, value, icon: Icon }, index) => (
              <div key={metric} className="min-w-0">
                <dt className="flex items-center gap-1.5 text-xs text-white/65">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {metricLabel}
                </dt>
                <dd className={index === 0 ? 'text-xl font-bold text-white' : 'text-base font-semibold text-white/80'}>
                  {formatNumber(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {!isNullishString(post.descripcion) && (
          <div className="rounded-r-xl border-l-2 border-violet-400/70 bg-violet-400/10 px-4 py-3">
            <h5 className="text-xs font-bold text-violet-200">Hallazgo del post</h5>
            <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-white/85">{post.descripcion}</p>
          </div>
        )}
      </div>
    </>
  )
}

function ObjectiveCarousel({ group, platform }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const { label, icon: Icon, slides, highlights, opportunities, editorialOrder } = group
  const currentIndex = Math.min(activeIndex, slides.length - 1)
  const style = PLATFORM_STYLES[platform] || PLATFORM_STYLES.facebook
  const arrowStyle = 'rounded-lg border border-white/10 bg-white/5 p-2 text-white hover:bg-white/15 disabled:opacity-30'
  const slide = slides[currentIndex]
  const slideKey = [currentIndex, slide.post.embed_url, slide.post.imagen_url].join('|')

  return (
    <section aria-label={label} className="glass-card min-w-0 overflow-hidden rounded-2xl">
      <header className="flex items-start gap-3 border-b border-white/10 px-4 py-4">
        <span className="rounded-lg border p-2 text-white" style={{ background: style.bg, borderColor: style.border }}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h4 className="break-words text-base font-bold text-white">{label}</h4>
          <p className="text-xs text-white/65">
            {[
              highlights.length ? highlights.length + (highlights.length === 1 ? ' destacado' : ' destacados') : '',
              opportunities.length ? opportunities.length + (opportunities.length === 1 ? ' oportunidad' : ' oportunidades') : '',
              editorialOrder ? 'Orden editorial' : '',
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      </header>

      <PostSlide key={slideKey} slide={slide} platform={platform} group={group} />

      {slides.length > 1 && (
        <nav aria-label={'Publicaciones de ' + label} className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
          <button type="button" aria-label="Publicación anterior" className={arrowStyle}
            disabled={currentIndex === 0} onClick={() => setActiveIndex(currentIndex - 1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-center">
              {slides.map((entry, index) => (
                <button key={index} type="button" aria-current={index === currentIndex ? 'true' : undefined}
                  aria-label={entry.label + ', publicación ' + (index + 1)} title={entry.label}
                  className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10"
                  onClick={() => setActiveIndex(index)}>
                  <span className={[
                    'block h-2.5 w-2.5',
                    entry.isOpportunity ? 'rotate-45 rounded-sm bg-cyan-300' : 'rounded-full bg-amber-300',
                    index === currentIndex ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : 'opacity-50',
                  ].join(' ')} />
                </button>
              ))}
            </div>
            <p className="text-center text-[11px] text-white/60" aria-live="polite">
              {currentIndex + 1} de {slides.length} · {slide.label}
            </p>
          </div>
          <button type="button" aria-label="Siguiente publicación" className={arrowStyle}
            disabled={currentIndex === slides.length - 1} onClick={() => setActiveIndex(currentIndex + 1)}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </nav>
      )}
    </section>
  )
}

export function TopPostsSection({ posts = [], platform = 'facebook' }) {
  const platformKey = normalizePlatform(platform)
  const platformPosts = (posts || []).filter(post => normalizePlatform(detectPlatform(post)) === platformKey)
  if (!platformPosts.length) return null

  const groups = groupTopPosts(platformPosts)
  const periodKey = [platformKey, platformPosts[0].marca, platformPosts[0].mes].join('|')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-400" aria-hidden="true" />
        <h3 className="text-base font-bold font-display text-white">Top Posts del Mes</h3>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {groups.map(group => (
          <ObjectiveCarousel key={periodKey + '|' + group.key} group={group} platform={platformKey} />
        ))}
      </div>
    </div>
  )
}
