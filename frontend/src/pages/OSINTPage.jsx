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

const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', cat: 'Social', url: (value) => `https://instagram.com/${value}` },
  { id: 'tiktok', name: 'TikTok', cat: 'Social', url: (value) => `https://tiktok.com/@${value}` },
  { id: 'twitter', name: 'Twitter/X', cat: 'Social', url: (value) => `https://x.com/${value}` },
  { id: 'youtube', name: 'YouTube', cat: 'Video', url: (value) => `https://youtube.com/@${value}` },
  { id: 'snapchat', name: 'Snapchat', cat: 'Social', url: (value) => `https://snapchat.com/add/${value}` },
  { id: 'facebook', name: 'Facebook', cat: 'Social', url: (value) => `https://facebook.com/${value}` },
  { id: 'reddit', name: 'Reddit', cat: 'Social', url: (value) => `https://reddit.com/user/${value}` },
  { id: 'roblox', name: 'Roblox', cat: 'Gaming', url: (value) => `https://roblox.com/user.aspx?username=${value}` },
  { id: 'steam', name: 'Steam', cat: 'Gaming', url: (value) => `https://steamcommunity.com/id/${value}` },
  { id: 'twitch', name: 'Twitch', cat: 'Gaming', url: (value) => `https://twitch.tv/${value}` },
  { id: 'github', name: 'GitHub', cat: 'Dev', url: (value) => `https://github.com/${value}` },
  { id: 'gitlab', name: 'GitLab', cat: 'Dev', url: (value) => `https://gitlab.com/${value}` },
  { id: 'linkedin', name: 'LinkedIn', cat: 'Pro', url: (value) => `https://linkedin.com/in/${value}` },
  { id: 'spotify', name: 'Spotify', cat: 'Music', url: (value) => `https://open.spotify.com/user/${value}` },
  { id: 'soundcloud', name: 'SoundCloud', cat: 'Music', url: (value) => `https://soundcloud.com/${value}` },
  { id: 'telegram', name: 'Telegram', cat: 'Social', url: (value) => `https://t.me/${value}` },
  { id: 'medium', name: 'Medium', cat: 'Blog', url: (value) => `https://medium.com/@${value}` },
  { id: 'pinterest', name: 'Pinterest', cat: 'Social', url: (value) => `https://pinterest.com/${value}` },
  { id: 'tumblr', name: 'Tumblr', cat: 'Blog', url: (value) => `https://${value}.tumblr.com` },
  { id: 'patreon', name: 'Patreon', cat: 'Creator', url: (value) => `https://patreon.com/${value}` },
  { id: 'vimeo', name: 'Vimeo', cat: 'Video', url: (value) => `https://vimeo.com/${value}` },
  { id: 'lastfm', name: 'Last.fm', cat: 'Music', url: (value) => `https://last.fm/user/${value}` },
  { id: 'devto', name: 'Dev.to', cat: 'Dev', url: (value) => `https://dev.to/${value}` },
  { id: 'kofi', name: 'Ko-fi', cat: 'Creator', url: (value) => `https://ko-fi.com/${value}` },
]

const CONFIDENCE_TONE = {
  haute: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
  moyenne: 'border-amber-400/20 bg-amber-400/10 text-amber-100',
  faible: 'border-red-400/20 bg-red-400/10 text-red-200',
}

function getErrorPayload(error) {
  return {
    message: error?.response?.data?.error || error?.message || 'Une erreur est survenue',
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
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-red-300/20 bg-red-300/10 px-4 py-3 text-sm font-mono text-red-100 transition-all hover:bg-red-300/15"
            >
              <RefreshCw className="h-4 w-4" />
              Reessayer
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function MetricTile({ label, value, hint = '', tone = '' }) {
  return (
    <div className={`feature-metric ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">{label}</p>
      <p className="mt-2 font-display text-2xl font-800 text-white">{value}</p>
      {hint ? <p className="mt-2 text-xs text-white/45">{hint}</p> : null}
    </div>
  )
}

function formatDuration(durationMs) {
  if (!Number.isFinite(Number(durationMs))) return '--'
  const seconds = Number(durationMs) / 1000
  return seconds < 1 ? `${Math.max(1, Math.round(Number(durationMs)))} ms` : `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`
}

function formatDate(value) {
  if (!value) return '--'

  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0)
  if (!Number.isFinite(size) || size <= 0) return '--'
  return size < 1024 * 1024 ? `${Math.round(size / 1024)} Ko` : `${(size / (1024 * 1024)).toFixed(2)} Mo`
}

function StatusBanner({ active, title, detail }) {
  return (
    <div className={`rounded-[22px] border px-4 py-4 ${active ? 'border-emerald-400/18 bg-emerald-400/10' : 'border-amber-400/18 bg-amber-400/10'}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl border ${active ? 'border-emerald-400/18 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/18 bg-amber-400/10 text-amber-100'}`}>
          {active ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        </div>
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">{title}</p>
          <p className="mt-1 text-sm leading-6 text-white/70">{detail}</p>
        </div>
      </div>
    </div>
  )
}

function statusBadge(result, loading) {
  if (loading) return { label: 'Scan', tone: 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan' }
  if (!result) return { label: 'Attente', tone: 'border-white/10 bg-white/[0.04] text-white/45' }
  if (result.supported === false) return { label: 'Hors corpus', tone: 'border-white/10 bg-white/[0.04] text-white/45' }
  if (result.found) {
    return result.confidence >= 70
      ? { label: 'Trouve', tone: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' }
      : { label: 'Probable', tone: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200' }
  }
  return result.confidence <= 30
    ? { label: 'Absent', tone: 'border-red-400/20 bg-red-400/10 text-red-200' }
    : { label: 'Inconnu', tone: 'border-white/10 bg-white/[0.04] text-white/55' }
}

function UsernameTracker({ status }) {
  const categories = useMemo(() => ['Tous', ...new Set(PLATFORMS.map((platform) => platform.cat))], [])
  const sweepFilters = useMemo(() => [
    { id: 'found', label: 'Trouves' },
    { id: 'unknown', label: 'Ambigus' },
    { id: 'all', label: 'Tous' },
  ], [])
  const [input, setInput] = useState('')
  const [username, setUsername] = useState('')
  const [filter, setFilter] = useState('Tous')
  const [sweepFilter, setSweepFilter] = useState('found')
  const [phase, setPhase] = useState('idle')
  const [scanData, setScanData] = useState(null)
  const [error, setError] = useState(null)

  const results = scanData?.results || {}
  const filteredPlatforms = PLATFORMS.filter((platform) => filter === 'Tous' || platform.cat === filter)
  const foundPlatforms = PLATFORMS.filter((platform) => results[platform.id]?.found)
  const highConfidence = foundPlatforms.filter((platform) => Number(results[platform.id]?.confidence || 0) >= 70)
  const sweepRows = useMemo(() => {
    const rows = scanData?.sites || []
    if (sweepFilter === 'found') return rows.filter((entry) => entry.status === 'found').slice(0, 120)
    if (sweepFilter === 'unknown') return rows.filter((entry) => entry.status === 'unknown').slice(0, 120)
    return rows.slice(0, 120)
  }, [scanData, sweepFilter])

  async function handleScan() {
    const cleaned = input.trim().replace(/^@+/, '')
    if (!cleaned || phase === 'loading' || !status.usernameConfigured) return

    setPhase('loading')
    setUsername(cleaned)
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
                placeholder="Pseudo, handle, alias..."
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
                {phase === 'loading' ? 'Sweep...' : 'Lancer le sweep'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setInput('')
                  setUsername('')
                  setScanData(null)
                  setError(null)
                  setFilter('Tous')
                  setSweepFilter('found')
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
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">
                Analyse de {username || input.trim()}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {!status.usernameConfigured ? (
        <StatusBanner
          active={false}
          title="Sweep indisponible"
          detail="Le corpus OSINT local n est pas charge sur le serveur. Tu peux saisir un pseudo, mais le sweep reseau restera bloque tant que le moteur n est pas disponible."
        />
      ) : null}

      <ErrorPanel error={error} onRetry={phase === 'error' ? () => void handleScan() : null} />

      {phase === 'done' || phase === 'error' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="Hits" value={scanData?.summary?.found ?? foundPlatforms.length} hint="profils detectes" tone="border-neon-cyan/18 bg-neon-cyan/[0.08]" />
            <MetricTile label="Confiance forte" value={highConfidence.length} hint="score 70+" tone="border-emerald-400/20 bg-emerald-400/10 text-emerald-100" />
            <MetricTile label="Ambigus" value={scanData?.summary?.unknown ?? Math.max(0, foundPlatforms.length - highConfidence.length)} hint="rate limit ou doute" tone="border-amber-400/20 bg-amber-400/10 text-amber-100" />
            <MetricTile label="Corpus" value={scanData?.summary?.checked ?? status.usernameSiteCount ?? PLATFORMS.length} hint={username ? `pour @${username}` : 'plateformes'} />
            <MetricTile label="Duree" value={formatDuration(scanData?.summary?.durationMs)} hint="probe complet" tone="border-violet-400/18 bg-violet-400/10 text-violet-100" />
          </div>

          <div className="spotlight-card p-4">
            <div className="relative z-[1] flex flex-wrap gap-2">
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
              {foundPlatforms.length ? (
                <button
                  type="button"
                  onClick={() => {
                    foundPlatforms.forEach((platform) => window.open(platform.url(username), '_blank', 'noopener,noreferrer'))
                  }}
                  className="ml-auto inline-flex items-center gap-2 rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-neon-cyan transition-all hover:bg-neon-cyan/15"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Ouvrir tout
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredPlatforms.map((platform) => {
              const result = results[platform.id]
              const badge = statusBadge(result, phase === 'loading')
              return (
                <div key={platform.id} className={`spotlight-card p-4 ${result?.found ? 'border-neon-cyan/18 bg-neon-cyan/[0.05]' : ''}`}>
                  <div className="relative z-[1] flex h-full flex-col gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-base font-700 text-white">{platform.name}</p>
                        <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{platform.cat}</p>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.18em] ${badge.tone}`}>
                        {badge.label}
                      </span>
                    </div>

                    <div className="rounded-[18px] border border-white/8 bg-black/15 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Confiance</p>
                        <p className="font-display text-xl font-800 text-white">{result?.confidence ?? 0}</p>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${result?.found ? 'from-neon-cyan via-cyan-400 to-violet-400' : 'from-red-400 via-amber-300 to-white/40'}`}
                          style={{ width: `${Math.max(6, Math.min(100, Number(result?.confidence || 0)))}%` }}
                        />
                      </div>
                    </div>

                    <div className="min-h-[74px] rounded-[18px] border border-white/8 bg-black/15 px-3 py-3 text-sm leading-6 text-white/60">
                      {result?.info || 'Aucune conclusion detaillee pour le moment.'}
                    </div>

                    {result?.found ? (
                      <a
                        href={platform.url(username)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-auto inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Ouvrir
                      </a>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          {scanData?.sites?.length ? (
            <div className="spotlight-card p-5 sm:p-6">
              <div className="relative z-[1] space-y-5">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Sweep etendu</p>
                    <p className="mt-2 text-sm leading-6 text-white/55">
                      Affichage de {sweepRows.length} ligne{sweepRows.length > 1 ? 's' : ''} sur {scanData.summary?.checked || scanData.sites.length} verifications.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {sweepFilters.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSweepFilter(entry.id)}
                        className={`rounded-full border px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] transition-all ${
                          sweepFilter === entry.id
                            ? 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan'
                            : 'border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white/80'
                        }`}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4">
                  {sweepRows.length ? sweepRows.map((entry) => {
                    const badge = entry.status === 'found'
                      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                      : entry.status === 'unknown'
                        ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
                        : 'border-white/10 bg-white/[0.04] text-white/45'

                    const label = entry.status === 'found' ? 'Trouve' : entry.status === 'unknown' ? 'Ambigu' : 'Absent'

                    return (
                      <div key={`${entry.id}-${entry.profileUrl || entry.mainUrl || entry.siteName}`} className={`rounded-[22px] border p-4 ${entry.status === 'found' ? 'border-emerald-400/18 bg-emerald-400/[0.07]' : entry.status === 'unknown' ? 'border-amber-400/18 bg-amber-400/[0.06]' : 'border-white/8 bg-black/15'}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-display text-lg font-700 text-white">{entry.siteName}</p>
                              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.18em] ${badge}`}>{label}</span>
                              {entry.category ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">{entry.category}</span> : null}
                            </div>
                            <p className="mt-1 text-xs font-mono uppercase tracking-[0.2em] text-white/30">{entry.domain || 'profil public'}</p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">Score {entry.confidence}</span>
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">{formatDuration(entry.durationMs)}</span>
                          </div>
                        </div>

                        <p className="mt-4 text-sm leading-6 text-white/65">{entry.info}</p>

                        <div className="mt-4 flex flex-wrap gap-3">
                          {entry.profileUrl ? (
                            <a
                              href={entry.profileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15"
                            >
                              Profil
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : null}
                          {entry.mainUrl ? (
                            <a
                              href={entry.mainUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-mono text-white/70 transition-all hover:border-white/20 hover:text-white"
                            >
                              Site
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    )
                  }) : (
                    <div className="rounded-[24px] border border-white/8 bg-black/15 px-5 py-6 text-sm text-white/50">
                      Aucun resultat a afficher avec ce filtre.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="feature-hero p-10 text-center">
          <div className="relative z-[1]">
            <Fingerprint className="mx-auto h-12 w-12 text-white/10" />
            <p className="mt-4 font-display text-xl font-700 text-white">Username tracker</p>
            <p className="mt-2 text-sm leading-6 text-white/45">Lance un sweep reseau massif sur un large corpus de profils publics.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Impossible de lire le fichier image'))
    reader.readAsDataURL(file)
  })
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
    if (!imagePayload || phase === 'loading' || !status.imageConfigured) return

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

  const coordinates = result?.coordinates
  const hasCoordinates = Number.isFinite(Number(coordinates?.lat)) && Number.isFinite(Number(coordinates?.lon))

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
                <p className="mt-5 font-display text-xl font-700 text-white">Image geolocator</p>
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
              disabled={!imagePayload || phase === 'loading' || status.loading || !status.imageConfigured}
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

      {!status.imageConfigured ? (
        <StatusBanner
          active={false}
          title="Analyse image en attente"
          detail="Tu peux deja charger et previsualiser une image. La geolocalisation se debloquera des qu une cle IA vision sera configuree cote serveur."
        />
      ) : null}

      <ErrorPanel error={error} onRetry={phase === 'error' ? () => void analyze() : null} />

      {result ? (
        <>
          <div className="feature-hero p-6 sm:p-7">
            <div className="relative z-[1] flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <span className="feature-chip"><MapPin className="h-3.5 w-3.5" />position estimee</span>
                  <span className="feature-chip"><Globe className="h-3.5 w-3.5" />{result.country || 'pays inconnu'}</span>
                </div>
                <div>
                  <h2 className="font-display text-3xl font-800 text-white">{[result.city, result.region, result.country].filter(Boolean).join(', ') || 'Lieu non identifie'}</h2>
                  {result.exact_location ? <p className="mt-3 text-sm leading-6 text-white/65">{result.exact_location}</p> : null}
                </div>
              </div>
              <div className={`rounded-full border px-4 py-2 text-[11px] font-mono uppercase tracking-[0.24em] ${CONFIDENCE_TONE[result.confidence] || CONFIDENCE_TONE.moyenne}`}>
                {result.confidence}
              </div>
            </div>

            <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile label="Pays" value={result.country_code || '--'} hint={result.country || 'inconnu'} />
              <MetricTile label="Moment" value={result.time_of_day || '--'} hint="approximation" />
              <MetricTile label="Meteo" value={result.weather_conditions || '--'} hint="signal ambiant" />
              <MetricTile label="Coordonnees" value={hasCoordinates ? `${Number(coordinates.lat).toFixed(4)}, ${Number(coordinates.lon).toFixed(4)}` : '--'} hint="precision IA" />
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              {result.analysis ? (
                <div className="spotlight-card p-5 sm:p-6">
                  <div className="relative z-[1]">
                    <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Analyse</p>
                    <p className="mt-4 text-sm leading-7 text-white/70">{result.analysis}</p>
                  </div>
                </div>
              ) : null}

              <div className="spotlight-card p-5 sm:p-6">
                <div className="relative z-[1]">
                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Indices</p>
                  <div className="mt-5 space-y-3">
                    {result.clues?.length ? result.clues.map((clue, index) => (
                      <div key={`${clue.type}-${index}`} className="rounded-[20px] border border-white/8 bg-black/15 p-4">
                        <div className="flex flex-wrap items-start gap-3">
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/70">{clue.type}</span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">{clue.weight}</span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-white/68">{clue.detail}</p>
                      </div>
                    )) : (
                      <div className="rounded-[20px] border border-white/8 bg-black/15 px-4 py-4 text-sm text-white/45">Aucun indice detaille retourne.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="spotlight-card p-5">
                <div className="relative z-[1] space-y-3">
                  {result.maps_search ? (
                    <a
                      href={`https://www.google.com/maps/search/${encodeURIComponent(result.maps_search)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-[20px] border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-4 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15"
                    >
                      Google Maps
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                  {hasCoordinates ? (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${coordinates.lat}&mlon=${coordinates.lon}&zoom=16`}
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

              {result.alternative_locations?.length ? (
                <div className="spotlight-card p-5">
                  <div className="relative z-[1]">
                    <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Alternatives</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {result.alternative_locations.map((entry) => (
                        <span key={entry} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">
                          {entry}
                        </span>
                      ))}
                    </div>
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
            <p className="mt-4 font-display text-xl font-700 text-white">Image geolocator</p>
            <p className="mt-2 text-sm leading-6 text-white/45">Analyse les indices visuels pour estimer un lieu probable.</p>
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
    usernameSiteCount: 0,
    usernameSource: null,
    usernameSnapshotUpdatedAt: null,
    imageConfigured: false,
    provider: null,
    model: null,
    imageSupported: false,
  })

  useEffect(() => {
    let active = true
    osintAPI.status().then((response) => {
      if (!active) return
      setStatus({
        loading: false,
        configured: Boolean(response.data?.configured),
        usernameConfigured: Boolean(response.data?.usernameConfigured),
        usernameSiteCount: Number(response.data?.usernameSiteCount || 0),
        usernameSource: response.data?.usernameSource || null,
        usernameSnapshotUpdatedAt: response.data?.usernameSnapshotUpdatedAt || null,
        imageConfigured: Boolean(response.data?.imageConfigured),
        provider: response.data?.provider || null,
        model: response.data?.model || null,
        imageSupported: Boolean(response.data?.imageSupported),
      })
    }).catch(() => {
      if (!active) return
      setStatus({
        loading: false,
        configured: false,
        usernameConfigured: false,
        usernameSiteCount: 0,
        usernameSource: null,
        usernameSnapshotUpdatedAt: null,
        imageConfigured: false,
        provider: null,
        model: null,
        imageSupported: false,
      })
    })
    return () => { active = false }
  }, [])

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-5 sm:py-6">
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="feature-chip"><Compass className="h-3.5 w-3.5" />osint</span>
              <span className="feature-chip"><Fingerprint className="h-3.5 w-3.5" />username sweep</span>
              <span className="feature-chip"><Image className="h-3.5 w-3.5" />image geolocator</span>
              <span className="feature-chip"><ShieldCheck className="h-3.5 w-3.5" />discord intel</span>
            </div>
            <div>
              <h1 className="font-display text-3xl font-800 text-white sm:text-4xl">OSINT</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/55 sm:text-[15px]">
                Module de recherche multi-plateformes, Discord Intel serveur et geolocalisation d image, integre au cockpit avec la meme logique visuelle que le reste du site.
              </p>
            </div>
          </div>

          <div className="grid min-w-[300px] gap-3">
            <StatusBanner
              active={status.usernameConfigured}
              title="Sweep username"
              detail={status.usernameConfigured ? `${status.usernameSiteCount || 0} sites publics charges dans le moteur.` : 'Moteur de sweep indisponible.'}
            />
            <StatusBanner
              active={status.imageConfigured}
              title="Analyse image"
              detail={status.imageConfigured ? `Vision active via ${status.provider || 'IA'}${status.model ? ` - ${status.model}` : ''}.` : 'Une cle IA vision est necessaire pour lancer la geolocalisation.'}
            />
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile label="Corpus" value={status.usernameSiteCount || '--'} hint="sites publics cibles" />
          <MetricTile label="Outils" value="3" hint="username + discord + geoloc" tone="border-neon-cyan/18 bg-neon-cyan/[0.08]" />
          <MetricTile label="Theme" value="Cockpit" hint="meme shell, memes animations" tone="border-violet-400/18 bg-violet-400/10 text-violet-100" />
          <MetricTile label="Mode" value="Server" hint="proxy backend, serveur gere, pas de cle front" tone="border-emerald-400/20 bg-emerald-400/10 text-emerald-100" />
        </div>
      </div>

      <div className="spotlight-card p-2 sm:p-3">
        <div className="relative z-[1] grid gap-2 md:grid-cols-3">
          {[
            { id: 'username', label: 'Username Tracker', icon: Fingerprint },
            { id: 'discord', label: 'Discord Intel', icon: ShieldCheck },
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
