import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  Compass,
  ExternalLink,
  Fingerprint,
  Globe,
  Image,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react'
import { osintAPI } from '../services/api'
import DiscordIntelPanel from '../components/osint/DiscordIntelPanel'

function getErrorPayload(error) {
  const rawMessage = error?.response?.data?.error || error?.message || 'Une erreur est survenue'
  const lowered = String(rawMessage).toLowerCase()
  if (lowered.includes('ia non configuree')) {
    return {
      message: "Configure une IA vision avant de lancer la geolocalisation.",
      raw: '',
      actionLabel: "Configurer l'IA",
      actionHref: '/dashboard/ai',
    }
  }

  if (lowered.includes('high demand') || lowered.includes('temporairement sature') || lowered.includes('unavailable')) {
    return {
      message: "Le moteur visuel est temporairement sature. Reessaie dans quelques instants.",
      raw: '',
    }
  }

  if (lowered.includes('quota') || lowered.includes('resource exhausted') || lowered.includes('insufficient_quota')) {
    return {
      message: "Le quota visuel IA est temporairement indisponible ou atteint. Reessaie plus tard ou change de modele.",
      raw: '',
    }
  }

  return {
    message: rawMessage,
    raw: typeof error?.response?.data?.raw === 'string' ? error.response.data.raw : '',
  }
}

function ErrorPanel({ error, onRetry }) {
  if (!error?.message) return null

  return (
    <div className="rounded-[24px] border border-red-400/20 bg-red-500/10 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10">
          <AlertTriangle className="h-5 w-5 text-red-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-700 text-red-100">Erreur OSINT</p>
          <p className="mt-1 text-sm leading-6 text-red-100/80">{error.message}</p>
          {error.raw ? (
            <pre className="mt-4 max-h-56 overflow-auto rounded-2xl border border-red-400/15 bg-black/30 p-4 text-xs leading-6 text-red-100/70">
              {error.raw}
            </pre>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-2xl border border-red-300/20 bg-red-300/10 px-4 py-3 text-sm font-mono text-red-100 transition-all hover:bg-red-300/15"
              >
                <RefreshCw className="h-4 w-4" />
                Reessayer
              </button>
            ) : null}
            {error.actionHref ? (
              <a
                href={error.actionHref}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-mono text-white/80 transition-all hover:border-white/20 hover:text-white"
              >
                {error.actionLabel || 'Ouvrir'}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricTile({ label, value, hint = '' }) {
  return (
    <div className="feature-metric">
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">{label}</p>
      <p className="mt-2 font-display text-2xl font-800 text-white">{value}</p>
      {hint ? <p className="mt-2 text-xs text-white/45">{hint}</p> : null}
    </div>
  )
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0)
  if (!Number.isFinite(size) || size <= 0) return '--'
  return size < 1024 * 1024 ? `${Math.round(size / 1024)} Ko` : `${(size / (1024 * 1024)).toFixed(2)} Mo`
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Impossible de lire le fichier image'))
    reader.readAsDataURL(file)
  })
}

function stringToAccentColor(value) {
  const palette = [
    'from-neon-cyan/25 to-cyan-500/18',
    'from-violet-500/25 to-fuchsia-500/18',
    'from-emerald-500/22 to-teal-500/18',
    'from-sky-500/24 to-indigo-500/18',
    'from-amber-500/24 to-orange-500/18',
  ]
  const seed = String(value || '').split('').reduce((total, char) => total + char.charCodeAt(0), 0)
  return palette[seed % palette.length]
}

function getAvatarFallbackLetter(label) {
  const cleaned = String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()

  return String(cleaned[0] || '?').toUpperCase()
}

function ResolvedProfileImage({ src, alt, size = 'h-16 w-16 rounded-[22px]' }) {
  const [resolvedSrc, setResolvedSrc] = useState('')
  const fallbackLetter = getAvatarFallbackLetter(alt)
  const fallbackAccent = stringToAccentColor(alt)

  useEffect(() => {
    let active = true

    if (!src) {
      setResolvedSrc('')
      return undefined
    }

    const probe = new window.Image()
    probe.referrerPolicy = 'no-referrer'
    probe.onload = () => {
      if (active) setResolvedSrc(src)
    }
    probe.onerror = () => {
      if (active) setResolvedSrc('')
    }
    probe.src = src

    return () => {
      active = false
    }
  }, [src])

  const canRender = !!resolvedSrc

  if (canRender) {
    return (
      <img
        src={resolvedSrc}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`${size} border border-white/10 object-cover shadow-[0_18px_36px_rgba(0,0,0,0.28)]`}
      />
    )
  }

  return (
    <div className={`flex ${size} items-center justify-center border border-white/10 bg-gradient-to-br ${fallbackAccent} text-white shadow-[0_18px_36px_rgba(0,0,0,0.28)]`}>
      <span className="font-display text-2xl font-800">{fallbackLetter}</span>
    </div>
  )
}

function UsernameProfileCard({ profile }) {
  const [open, setOpen] = useState(false)
  const visibleFacts = useMemo(
    () => (Array.isArray(profile?.facts) ? profile.facts : []).filter((fact) => !['Page', 'Titre', 'Handle', 'Source', 'Domaine'].includes(fact?.label)),
    [profile]
  )
  const hasExtraDetails = Boolean(visibleFacts.length || profile.sections?.length || profile.insights?.length)

  return (
    <div className="spotlight-card border-neon-cyan/18 bg-neon-cyan/[0.05] p-5">
      <div className="relative z-[1] flex h-full flex-col gap-4">
        <div className="flex items-start gap-4">
          <ResolvedProfileImage
            src={profile.imageUrl}
            alt={profile.headline || profile.siteName}
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-display text-xl font-700 text-white">{profile.platformName || profile.siteName}</p>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-emerald-200">
                Verifie
              </span>
            </div>
            <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">
              {profile.domain || profile.siteName || '--'}
            </p>
            {profile.headline && profile.headline !== profile.platformName ? (
              <p className="mt-2 text-sm text-white/72">{profile.headline}</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-4 text-sm leading-6 text-white/70">
          {profile.summary}
        </div>

        {profile.insights?.length && open ? (
          <div className="space-y-2">
            {profile.insights.map((insight) => (
              <div key={insight} className="rounded-[16px] border border-white/8 bg-black/15 px-4 py-3 text-sm leading-6 text-white/68">
                {insight}
              </div>
            ))}
          </div>
        ) : null}

        {open && profile.sections?.length ? (
          <div className="grid gap-3">
            {profile.sections.map((section) => (
              <div key={section.title} className="rounded-[18px] border border-white/8 bg-black/15 p-4">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">{section.title}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {section.items.map((item) => (
                    <span key={item} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/60">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {open && visibleFacts.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleFacts.map((fact) => (
              <div key={`${fact.label}-${fact.value}`} className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">{fact.label}</p>
                <p className="mt-2 text-sm leading-6 text-white/72">{fact.value}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap gap-3">
          {hasExtraDetails ? (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-mono text-white/70 transition-all hover:border-white/20 hover:text-white"
            >
              {open ? 'Refermer' : 'Infos +'}
            </button>
          ) : null}

          {profile.openUrl ? (
            <a
              href={profile.openUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15"
            >
              Ouvrir le profil
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function UsernameTracker({ status }) {
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState('idle')
  const [filter, setFilter] = useState('Tous')
  const [scanData, setScanData] = useState(null)
  const [error, setError] = useState(null)

  const profiles = useMemo(() => {
    const rows = Array.isArray(scanData?.profiles) ? scanData.profiles : []
    return rows.filter((entry) => entry?.openUrl || entry?.summary || entry?.headline)
  }, [scanData])
  const categories = useMemo(() => ['Tous', ...new Set(profiles.map((entry) => entry.category).filter(Boolean))], [profiles])
  const filteredProfiles = useMemo(
    () => profiles.filter((entry) => filter === 'Tous' || entry.category === filter),
    [filter, profiles]
  )

  async function handleScan() {
    const cleaned = input.trim().replace(/^@+/, '')
    if (!cleaned || phase === 'loading' || !status.usernameConfigured) return

    setPhase('loading')
    setScanData(null)
    setError(null)

    try {
      const response = await osintAPI.scanUsername(cleaned)
      setScanData(response.data || null)
      setPhase('done')
    } catch (requestError) {
      const nextError = getErrorPayload(requestError)
      setError(nextError)
      setPhase('error')
      toast.error(nextError.message)
    }
  }

  return (
    <div className="space-y-5">
      <div className="spotlight-card p-5 sm:p-6">
        <div className="relative z-[1] space-y-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleScan()
                  }
                }}
                placeholder="Pseudo ou ID Discord..."
                className="input-field pl-11"
                disabled={phase === 'loading' || status.loading}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleScan()}
                disabled={!input.trim() || phase === 'loading' || status.loading || !status.usernameConfigured}
                className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <RefreshCw className={`h-4 w-4 ${phase === 'loading' ? 'animate-spin' : ''}`} />
                {phase === 'loading' ? 'Recherche...' : 'Scanner'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setInput('')
                  setScanData(null)
                  setError(null)
                  setFilter('Tous')
                  setPhase('idle')
                }}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-mono text-white/70 transition-all hover:border-white/20 hover:text-white"
              >
                Reinitialiser
              </button>
            </div>
          </div>

          {phase === 'loading' ? (
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-neon-cyan via-cyan-400 to-violet-400" />
              </div>
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Sweep public en cours</p>
            </div>
          ) : null}
        </div>
      </div>

      {!status.usernameConfigured ? (
        <div className="rounded-[22px] border border-amber-400/18 bg-amber-400/10 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl border border-amber-400/18 bg-amber-400/10 text-amber-100">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Moteur indisponible</p>
              <p className="mt-1 text-sm leading-6 text-white/70">
                Le corpus OSINT public n est pas charge sur le serveur.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <ErrorPanel error={error} onRetry={phase === 'error' ? () => void handleScan() : null} />

      {phase === 'done' || phase === 'error' ? (
        <>
          <div className="spotlight-card p-5 sm:p-6">
            <div className="relative z-[1] flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Profils verifies</p>
                <p className="mt-2 font-display text-3xl font-800 text-white">{profiles.length}</p>
                {scanData?.input?.username ? (
                  <p className="mt-2 text-sm text-white/55">
                    Recherche active sur <span className="text-white">@{scanData.input.username}</span>
                  </p>
                ) : null}
                {scanData?.input?.type === 'discord_id' && scanData?.input?.discord_user ? (
                  <p className="mt-1 text-sm text-white/45">
                    ID Discord resolu vers <span className="text-neon-cyan">@{scanData.input.discord_user.username}</span>
                  </p>
                ) : null}
              </div>

              {profiles.length ? (
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setFilter(category)}
                      className={`rounded-full border px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] transition-all ${
                        filter === category
                          ? 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan'
                          : 'border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white/80'
                      }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {filteredProfiles.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {filteredProfiles.map((profile) => (
                <UsernameProfileCard key={`${profile.platformId}-${profile.openUrl || profile.siteName}`} profile={profile} />
              ))}
            </div>
          ) : (
            <div className="spotlight-card p-8 text-center">
              <div className="relative z-[1]">
                <Fingerprint className="mx-auto h-12 w-12 text-white/10" />
                <p className="mt-4 font-display text-xl font-700 text-white">Aucun profil detecte</p>
                <p className="mt-2 text-sm leading-6 text-white/45">
                  Aucun profil public verifie n a ete remonte pour cette recherche.
                </p>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="feature-hero p-10 text-center">
          <div className="relative z-[1]">
            <Fingerprint className="mx-auto h-12 w-12 text-white/10" />
            <p className="mt-4 font-display text-xl font-700 text-white">Username Tracker</p>
            <p className="mt-2 text-sm leading-6 text-white/45">
              Profils publics verifies uniquement, enrichis avec des metadonnees et APIs ouvertes quand elles existent.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function ImageGeolocator({ status }) {
  const inputRef = useRef(null)
  const [phase, setPhase] = useState('idle')
  const [preview, setPreview] = useState('')
  const [imagePayload, setImagePayload] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    function handlePaste(event) {
      const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith('image/'))
      const file = item?.getAsFile?.()
      if (file) {
        void handleFile(file)
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])

  async function handleFile(file) {
    if (!file?.type?.startsWith('image/')) {
      const nextError = { message: 'Choisis une image valide', raw: '' }
      setError(nextError)
      toast.error(nextError.message)
      return
    }

    if (file.size > 4_500_000) {
      const nextError = { message: 'Image trop lourde. Reste sous 4.5 Mo.', raw: '' }
      setError(nextError)
      toast.error(nextError.message)
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setPreview(dataUrl)
      setImagePayload({
        base64: dataUrl.split(',')[1] || '',
        mimeType: file.type,
        name: file.name || 'image',
        size: file.size || 0,
      })
      setResult(null)
      setError(null)
      setPhase('ready')
    } catch (fileError) {
      const nextError = { message: fileError.message || 'Lecture image impossible', raw: '' }
      setError(nextError)
      toast.error(nextError.message)
    }
  }

  async function analyze() {
    if (!imagePayload || phase === 'loading') return

    if (!status.imageConfigured) {
      const nextError = getErrorPayload({ response: { data: { error: 'IA non configuree' } } })
      setError(nextError)
      setPhase('error')
      toast.error(nextError.message)
      return
    }

    setPhase('loading')
    setResult(null)
    setError(null)

    try {
      const response = await osintAPI.geolocate(imagePayload.base64, imagePayload.mimeType)
      setResult(response.data || null)
      setPhase('done')
    } catch (requestError) {
      const nextError = getErrorPayload(requestError)
      setError(nextError)
      setPhase('error')
      toast.error(nextError.message)
    }
  }

  const hasCoordinates = Number.isFinite(Number(result?.coordinates?.lat)) && Number.isFinite(Number(result?.coordinates?.lon))

  return (
    <div className="space-y-5">
      <div className="spotlight-card p-5 sm:p-6">
        <div className="relative z-[1] space-y-5">
          <div
            onClick={() => !preview && inputRef.current?.click()}
            onDrop={(event) => {
              event.preventDefault()
              void handleFile(event.dataTransfer.files?.[0])
            }}
            onDragOver={(event) => event.preventDefault()}
            className={`relative overflow-hidden rounded-[26px] border border-dashed p-5 transition-all ${
              preview
                ? 'border-neon-cyan/20 bg-neon-cyan/[0.05]'
                : 'border-white/12 bg-white/[0.03] hover:border-neon-cyan/25 hover:bg-neon-cyan/[0.04]'
            }`}
          >
            {preview ? (
              <div className="space-y-4">
                <img src={preview} alt={imagePayload?.name || 'Image'} className="max-h-[360px] w-full rounded-[20px] object-contain bg-black/20" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">{imagePayload?.name || 'image'}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">{formatFileSize(imagePayload?.size)}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">{imagePayload?.mimeType || '--'}</span>
                </div>
                {phase === 'loading' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 backdrop-blur-sm">
                    <RefreshCw className="h-8 w-8 animate-spin text-neon-cyan" />
                    <p className="text-[11px] font-mono uppercase tracking-[0.3em] text-neon-cyan">Analyse visuelle</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="py-10 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/10 bg-white/[0.04]">
                  <Upload className="h-7 w-7 text-neon-cyan/80" />
                </div>
                <p className="mt-5 font-display text-xl font-700 text-white">Image Geolocator</p>
                <p className="mt-2 text-sm leading-6 text-white/45">Glisse une image, clique ici ou colle-la avec Ctrl+V.</p>
              </div>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0])
            }}
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-mono text-white/70 transition-all hover:border-white/20 hover:text-white"
            >
              <Upload className="h-4 w-4" />
              Choisir une image
            </button>

            <button
              type="button"
              onClick={() => void analyze()}
              disabled={!imagePayload || phase === 'loading' || status.loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Compass className="h-4 w-4" />
              {phase === 'loading' ? 'Geolocalisation...' : 'Geolocaliser'}
            </button>

            <button
              type="button"
              onClick={() => {
                setPreview('')
                setImagePayload(null)
                setResult(null)
                setError(null)
                setPhase('idle')
                if (inputRef.current) inputRef.current.value = ''
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-mono text-white/70 transition-all hover:border-white/20 hover:text-white"
            >
              Reinitialiser
            </button>
          </div>
        </div>
      </div>

      <ErrorPanel error={error} onRetry={phase === 'error' ? () => void analyze() : null} />

      {result ? (
        <>
          <div className="feature-hero p-6 sm:p-7">
            <div className="relative z-[1] flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <span className="feature-chip"><MapPin className="h-3.5 w-3.5" />zone probable</span>
                  <span className="feature-chip"><Globe className="h-3.5 w-3.5" />{result.country || 'pays inconnu'}</span>
                </div>
                <div>
                  <h2 className="font-display text-3xl font-800 text-white">
                    {[result.city, result.region, result.country].filter(Boolean).join(', ') || 'Lieu non identifie'}
                  </h2>
                  {result.exact_location ? <p className="mt-3 text-sm leading-6 text-white/65">{result.exact_location}</p> : null}
                </div>
              </div>
              <div className="rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-2 text-[11px] font-mono uppercase tracking-[0.24em] text-neon-cyan">
                {result.confidence || 'moyenne'}
              </div>
            </div>

            <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <MetricTile label="Pays" value={result.country_code || '--'} hint={result.country || 'inconnu'} />
              <MetricTile label="Ville" value={result.city || '--'} hint={result.region || 'zone'} />
              <MetricTile label="Quartier" value={result.district || '--'} hint={result.landmark || 'zone'} />
              <MetricTile label="Moment estime" value={result.time_of_day || '--'} hint={result.weather_conditions || 'ambiance'} />
              <MetricTile
                label="Point carto"
                value={hasCoordinates ? `${Number(result.coordinates.lat).toFixed(4)}, ${Number(result.coordinates.lon).toFixed(4)}` : '--'}
                hint="approximation publique"
              />
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="spotlight-card p-5 sm:p-6">
              <div className="relative z-[1]">
                <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Zone retenue</p>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {result.exact_location ? (
                    <div className="rounded-[20px] border border-white/8 bg-black/15 p-4">
                      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Adresse publique plausible</p>
                      <p className="mt-3 text-sm leading-6 text-white/72">{result.exact_location}</p>
                    </div>
                  ) : null}

                  {result.landmark ? (
                    <div className="rounded-[20px] border border-white/8 bg-black/15 p-4">
                      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Repere probable</p>
                      <p className="mt-3 text-sm leading-6 text-white/72">{result.landmark}</p>
                    </div>
                  ) : null}

                  {result.district ? (
                    <div className="rounded-[20px] border border-white/8 bg-black/15 p-4">
                      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Quartier ou zone</p>
                      <p className="mt-3 text-sm leading-6 text-white/72">{result.district}</p>
                    </div>
                  ) : null}

                  {result.weather_conditions || result.time_of_day ? (
                    <div className="rounded-[20px] border border-white/8 bg-black/15 p-4">
                      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Contexte visuel</p>
                      <p className="mt-3 text-sm leading-6 text-white/72">
                        {[result.time_of_day, result.weather_conditions].filter(Boolean).join(' · ') || '--'}
                      </p>
                    </div>
                  ) : null}

                  {!result.exact_location && !result.landmark && !result.district && !result.weather_conditions && !result.time_of_day ? (
                    <div className="rounded-[20px] border border-white/8 bg-black/15 px-4 py-4 text-sm text-white/45">
                      Aucun repere public exploitable n a ete retenu.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-5">
              {result.map_links ? (
                <div className="spotlight-card p-5">
                  <div className="relative z-[1] space-y-3">
                    {result.map_links.google ? (
                      <a
                        href={result.map_links.google}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between rounded-[20px] border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-4 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15"
                      >
                        Google Maps
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                    {result.map_links.osm ? (
                      <a
                        href={result.map_links.osm}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between rounded-[20px] border border-violet-400/20 bg-violet-400/10 px-4 py-4 text-sm font-mono text-violet-200 transition-all hover:bg-violet-400/15"
                      >
                        OpenStreetMap
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="feature-hero p-10 text-center">
          <div className="relative z-[1]">
            <Image className="mx-auto h-12 w-12 text-white/10" />
            <p className="mt-4 font-display text-xl font-700 text-white">Image Geolocator</p>
            <p className="mt-2 text-sm leading-6 text-white/45">
              Ville, quartier, repere plausible et point cartographique public.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function OSINTPage() {
  const [tab, setTab] = useState('username')
  const [status, setStatus] = useState({
    loading: true,
    configured: false,
    usernameConfigured: false,
    imageConfigured: false,
  })

  useEffect(() => {
    let active = true
    osintAPI.status().then((response) => {
      if (!active) return
      setStatus({
        loading: false,
        configured: Boolean(response.data?.configured),
        usernameConfigured: Boolean(response.data?.usernameConfigured),
        imageConfigured: Boolean(response.data?.imageConfigured),
      })
    }).catch(() => {
      if (!active) return
      setStatus({
        loading: false,
        configured: false,
        usernameConfigured: false,
        imageConfigured: false,
      })
    })
    return () => { active = false }
  }, [])

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-5 sm:py-6">
      <div className="spotlight-card p-2 sm:p-3">
        <div className="relative z-[1] grid gap-2 md:grid-cols-3">
          {[
            { id: 'username', label: 'Username Tracker', icon: Fingerprint },
            { id: 'discord', label: 'Discord Panel', icon: ShieldCheck },
            { id: 'image', label: 'Image Geolocator', icon: Sparkles },
          ].map((entry) => {
            const Icon = entry.icon
            const active = tab === entry.id
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                className={`flex items-center justify-center gap-2 rounded-[20px] border px-4 py-4 text-sm font-mono uppercase tracking-[0.22em] transition-all ${
                  active ? 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan' : 'border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white/80'
                }`}
              >
                <Icon className="h-4 w-4" />
                {entry.label}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'username' ? <UsernameTracker status={status} /> : null}
      {tab === 'discord' ? <DiscordIntelPanel /> : null}
      {tab === 'image' ? <ImageGeolocator status={status} /> : null}
    </div>
  )
}
