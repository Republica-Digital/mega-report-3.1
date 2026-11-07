import { Heart, Eye, Play, Trophy, Sparkles, Lightbulb, ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon, Loader } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { formatNumber } from '../../utils/format'
import { isNullishString, classifyEmbed, extractLinkFromEmbed, detectPlatform } from '../../utils/urls'

const EMBED_MIN_HEIGHT = 300
const EMBED_MAX_HEIGHT = 520
const EMBED_HEIGHT = EMBED_MIN_HEIGHT
const FACEBOOK_SDK_URL = 'https://connect.facebook.net/es_LA/sdk.js#xfbml=1&version=v25.0'

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

function getFacebookPlugin(html) {
  const src = html.match(/\bsrc\s*=\s*["']([^"']+)/i)?.[1]
  if (!src) return null
  try {
    const plugin = new URL(src.replace(/&amp;/gi, '&'))
    if (plugin.protocol !== 'https:' || !/(^|\.)facebook\.com$/i.test(plugin.hostname)) return null
    if (!/^\/plugins\/(post|video)\.php$/.test(plugin.pathname)) return null
    const url = new URL(plugin.searchParams.get('href'))
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/i.test(url.hostname)) return null
    return { url: url.href, isVideo: plugin.pathname.endsWith('/video.php') }
  } catch {
    return null
  }
}

function getTikTokPostId(value) {
  return value.match(/\bdata-video-id\s*=\s*["'](\d+)["']/i)?.[1]
    || value.match(/https?:\/\/(?:[\w-]+\.)?tiktok\.com\/(?:@[^/"'\s]+\/(?:video|photo)\/|player\/v1\/|embed\/v2\/)(\d+)/i)?.[1]
}

function getInstagramPostUrl(value) {
  const permalink = value.match(/\bdata-instgrm-permalink\s*=\s*["']([^"']+)/i)?.[1] || value
  return permalink.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[\w-]+/i)?.[0]
}

let instagramSdkPromise = null

function ensureInstagramSdk() {
  if (window.instgrm?.Embeds) return Promise.resolve(window.instgrm.Embeds)
  if (!instagramSdkPromise) {
    instagramSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      const fail = () => {
        clearTimeout(timeout)
        script.remove()
        reject(new Error('Instagram embed unavailable'))
      }
      const timeout = setTimeout(fail, 5000)
      script.addEventListener('load', () => {
        const embeds = window.instgrm?.Embeds
        if (!embeds) { fail(); return }
        clearTimeout(timeout)
        resolve(embeds)
      }, { once: true })
      script.addEventListener('error', fail, { once: true })
      script.src = 'https://www.instagram.com/embed.js'
      script.async = true
      document.body.appendChild(script)
    }).catch(error => {
      instagramSdkPromise = null
      throw error
    })
  }
  return instagramSdkPromise
}

function EmbedLoader() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <Loader className="h-6 w-6 animate-spin text-white/40" aria-label="Cargando publicación" />
    </div>
  )
}

function FacebookUrlEmbed({ url, isVideo, onFail }) {
  const ref = useRef(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const container = ref.current
    let active = true
    let resizeTimer
    let loadTimer
    let width
    const renderEmbed = () => {
      const nextWidth = Math.floor(container.clientWidth)
      if (!nextWidth || nextWidth === width) return
      width = nextWidth
      setLoading(true)
      clearTimeout(loadTimer)
      loadTimer = setTimeout(onFail, 8000)
      const post = document.createElement('div')
      post.className = isVideo ? 'fb-video' : 'fb-post'
      post.dataset.href = url
      post.dataset.width = String(width)
      post.dataset.showText = 'true'
      container.replaceChildren(post)

      ensureFacebookSdk().then(fb => {
        if (!active || !container.contains(post)) return
        if (!fb?.XFBML?.parse) throw new Error('Facebook embed unavailable')
        fb.XFBML.parse(container, () => {
          if (!active || !container.contains(post)) return
          clearTimeout(loadTimer)
          if (post.querySelector('iframe')) setLoading(false)
          else onFail()
        })
      }).catch(() => {
        if (active && container.contains(post)) onFail()
      })
    }

    renderEmbed()
    const observer = new ResizeObserver(() => {
      if (Math.floor(container.clientWidth) === width) return
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(renderEmbed, 150)
    })
    observer.observe(container)
    return () => {
      active = false
      clearTimeout(resizeTimer)
      clearTimeout(loadTimer)
      observer.disconnect()
      container.replaceChildren()
    }
  }, [url, isVideo, onFail])

  return (
    <div className="relative mx-auto w-full max-w-[350px]" style={{ minHeight: loading ? EMBED_HEIGHT : undefined }}>
      {loading && <EmbedLoader />}
      <div ref={ref} className="w-full [&_iframe]:max-w-full" />
    </div>
  )
}

function InstagramEmbed({ url, captioned, onFail }) {
  const ref = useRef(null)
  const [mode, setMode] = useState('loading')

  useEffect(() => {
    const container = ref.current
    let active = true
    const blockquote = document.createElement('blockquote')
    blockquote.className = 'instagram-media'
    blockquote.dataset.instgrmPermalink = url + '/'
    blockquote.dataset.instgrmVersion = '14'
    blockquote.style.margin = '0'
    blockquote.style.minWidth = '0'
    if (captioned) blockquote.dataset.instgrmCaptioned = ''
    container.replaceChildren(blockquote)

    let iframe
    const reveal = () => {
      if (!active || !iframe || iframe.offsetHeight <= 150) return
      clearTimeout(timeout)
      frameObserver.disconnect()
      setMode('ready')
    }
    const frameObserver = new ResizeObserver(reveal)
    const fallback = () => {
      if (!active) return
      active = false
      clearTimeout(timeout)
      observer.disconnect()
      frameObserver.disconnect()
      container.replaceChildren()
      setMode('direct')
    }
    const observer = new MutationObserver(() => {
      iframe = container.querySelector('iframe')
      if (!iframe) return
      observer.disconnect()
      iframe.addEventListener('error', fallback, { once: true })
      frameObserver.observe(iframe)
      reveal()
    })
    observer.observe(container, { childList: true, subtree: true })
    const timeout = setTimeout(fallback, 6500)

    ensureInstagramSdk().then(embeds => {
      if (active) embeds.process()
    }).catch(fallback)

    return () => {
      active = false
      clearTimeout(timeout)
      observer.disconnect()
      frameObserver.disconnect()
      iframe?.removeEventListener('error', fallback)
      container.replaceChildren()
    }
  }, [url, captioned])

  const isReel = /\/(reels?|tv)\//i.test(url)
  return (
    <div className="relative mx-auto w-full max-w-[390px] [&_iframe]:!min-w-0 [&_iframe]:max-w-full"
      style={{ minHeight: mode === 'loading' ? EMBED_HEIGHT : undefined }}>
      {mode === 'loading' && <EmbedLoader />}
      <div ref={ref} className={mode === 'loading' ? 'invisible w-full' : 'w-full'} />
      {mode === 'direct' && (
        <iframe
          src={url + '/embed/' + (captioned ? 'captioned/' : '')}
          title="Vista previa de Instagram"
          className="block w-full border-0"
          style={{ aspectRatio: isReel ? '4 / 9' : '4 / 7' }}
          allowFullScreen
          allow="encrypted-media; fullscreen; picture-in-picture"
          onError={onFail}
        />
      )}
    </div>
  )
}

function TikTokPlayer({ postId, onFail }) {
  const ref = useRef(null)

  useEffect(() => {
    const handleMessage = event => {
      if (event.origin === 'https://www.tiktok.com' && event.source === ref.current?.contentWindow
        && event.data?.['x-tiktok-player'] === true && event.data?.type === 'onPlayerError') {
        onFail()
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onFail])

  return (
    <iframe
      ref={ref}
      src={'https://www.tiktok.com/player/v1/' + postId + '?description=1&music_info=1'}
      title="Reproductor de TikTok"
      className="mx-auto block aspect-[9/16] w-full border-0"
      style={{ maxWidth: 'min(300px, max(190px, 34svh))' }}
      loading="lazy"
      allow="encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
      onError={onFail}
    />
  )
}

// Keep older or nonstandard pasted embeds available when they have no platform ID.
function UniversalEmbed({ html, platform, onFail }) {
  const ref = useRef(null)

  useEffect(() => {
    const container = ref.current
    let active = true
    container.innerHTML = html
    container.querySelectorAll('iframe').forEach(iframe => {
      iframe.style.maxWidth = '100%'
      iframe.style.border = '0'
      iframe.style.display = 'block'
      iframe.setAttribute('loading', 'lazy')
    })

    const fail = () => { if (active) onFail() }
    if (container.querySelector('.instagram-media')) {
      ensureInstagramSdk().then(embeds => { if (active) embeds.process() }).catch(fail)
    } else if (container.querySelector('.fb-post, .fb-video')) {
      ensureFacebookSdk().then(fb => { if (active) fb?.XFBML?.parse(container) }).catch(fail)
    } else if (platform === 'tiktok' && container.querySelector('.tiktok-embed')) {
      reloadTikTokEmbeds(() => {}, fail)
    }
    return () => {
      active = false
      container.replaceChildren()
    }
  }, [html, platform, onFail])

  return <div ref={ref} className="mx-auto flex w-full min-w-0 justify-center [&_iframe]:!min-w-0" />
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
function PostPreview({ post, platform, isVideo, embedInfo, facebookPlugin }) {
  const [nativeFailed, setNativeFailed] = useState(false)
  const [embedFailed, setEmbedFailed] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const failNative = useCallback(() => setNativeFailed(true), [])
  const failEmbed = useCallback(() => setEmbedFailed(true), [])
  const value = embedInfo.value || ''
  const instagramUrl = platform === 'instagram' ? getInstagramPostUrl(value) : null

  if (!nativeFailed) {
    if (platform === 'tiktok') {
      const postId = getTikTokPostId(value)
      if (postId) return <TikTokPlayer postId={postId} onFail={failNative} />
    }
    if (instagramUrl) {
      return <InstagramEmbed url={instagramUrl} captioned={/\bdata-instgrm-captioned\b/i.test(value)} onFail={failNative} />
    }
    if (facebookPlugin || embedInfo.type === 'fb_url') {
      const url = facebookPlugin?.url || value
      return <FacebookUrlEmbed url={url} isVideo={facebookPlugin?.isVideo ?? isVideo} onFail={failNative} />
    }
  }
  if (!embedFailed && !instagramUrl && embedInfo.type === 'html_embed') {
    return <UniversalEmbed html={value} platform={platform} onFail={failEmbed} />
  }
  if (!isNullishString(post.imagen_url) && !imgFailed) {
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

function FittedPreview({ children }) {
  const contentRef = useRef(null)
  const limitRef = useRef(null)
  const [fit, setFit] = useState(null)

  useEffect(() => {
    const content = contentRef.current
    const limit = limitRef.current
    const measure = () => {
      const height = content.offsetHeight
      const available = limit.offsetHeight
      const scale = height > available && available > 0 ? available / height : 1
      setFit(previous => {
        if (scale === 1) return null
        if (previous?.scale === scale && previous.height === available) return previous
        return { height: available, scale }
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    observer.observe(limit)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-white/10 bg-black/25"
      style={{ height: fit ? fit.height + 2 : undefined }}>
      <div ref={limitRef} aria-hidden="true" className="pointer-events-none invisible absolute w-px"
        style={{ height: 'clamp(300px, calc(100svh - 215px), 540px)' }} />
      <div ref={contentRef} className="origin-top"
        style={{ transform: fit ? 'scale(' + fit.scale + ')' : undefined }}>
        {children}
      </div>
    </div>
  )
}

function PostSlide({ slide, platform, group }) {
  const { post, label, isOpportunity } = slide
  const isVideo = platform === 'tiktok' || /video|reel|fb-video|facebook\.com\/watch|fb\.watch|facebook\.com\/share\/[rv]\//i.test([post.tipo, post.embed_url].join(' '))
  const embedInfo = classifyEmbed(post.embed_url)
  const facebookPlugin = platform === 'facebook' && embedInfo.type === 'html_embed'
    ? getFacebookPlugin(embedInfo.value)
    : null
  const linkUrl = facebookPlugin?.url || extractLinkFromEmbed(post.embed_url)
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

      <div className="grid items-start gap-4 px-4 pb-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3 lg:col-start-2 lg:row-start-1">
          {!!metrics.length && (
            <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl bg-white/5 px-4 py-3">
              {metrics.map(({ metric, label: metricLabel, value, icon: Icon }, index) => (
                <div key={metric} className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-sm text-white/75">
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
              <h5 className="text-sm font-bold text-violet-200">Hallazgo del post</h5>
              <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-white/85">{post.descripcion}</p>
            </div>
          )}
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <FittedPreview>
            <PostPreview post={post} platform={platform} isVideo={isVideo}
              embedInfo={embedInfo} facebookPlugin={facebookPlugin} />
          </FittedPreview>
        </div>
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
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="rounded-lg border p-2 text-white" style={{ background: style.bg, borderColor: style.border }}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="break-words text-base font-bold text-white">{label}</h4>
          <p className="text-xs text-white/65">
            {[
              highlights.length ? highlights.length + (highlights.length === 1 ? ' destacado' : ' destacados') : '',
              opportunities.length ? opportunities.length + (opportunities.length === 1 ? ' oportunidad' : ' oportunidades') : '',
              editorialOrder ? 'Orden editorial' : '',
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
        {slides.length > 1 && (
          <nav aria-label={'Publicaciones de ' + label} className="flex flex-wrap items-center justify-center gap-2">
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
      </header>

      <PostSlide key={slideKey} slide={slide} platform={platform} group={group} />
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
      <div className="grid max-w-[1500px] items-start gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 690px), 1fr))' }}>
        {groups.map(group => (
          <ObjectiveCarousel key={periodKey + '|' + group.key} group={group} platform={platformKey} />
        ))}
      </div>
    </div>
  )
}
