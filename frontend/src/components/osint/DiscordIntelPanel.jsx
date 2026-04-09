import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  ExternalLink,
  Image as ImageIcon,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { osintAPI } from '../../services/api'

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Recherche Discord impossible.'
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

function stringToAccentColor(value) {
  const palette = [
    'from-neon-cyan/25 to-cyan-500/18',
    'from-violet-500/25 to-fuchsia-500/18',
    'from-emerald-500/22 to-teal-500/18',
    'from-sky-500/24 to-indigo-500/18',
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

function Avatar({ src, label, compact = false }) {
  const [failed, setFailed] = useState(false)
  const sizeClass = compact ? 'h-11 w-11 rounded-[16px]' : 'h-24 w-24 rounded-[28px]'
  const letterClass = compact ? 'text-lg' : 'text-4xl'
  const accentClass = stringToAccentColor(label)

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={label}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${sizeClass} border border-white/10 object-cover shadow-[0_24px_48px_rgba(0,0,0,0.32)]`}
      />
    )
  }

  return (
    <div className={`flex ${sizeClass} items-center justify-center border border-white/10 bg-gradient-to-br ${accentClass} text-white shadow-[0_24px_48px_rgba(0,0,0,0.32)]`}>
      <span className={`font-display font-800 ${letterClass}`}>{getAvatarFallbackLetter(label)}</span>
    </div>
  )
}

function Metric({ label, value, hint = '' }) {
  return (
    <div className="feature-metric">
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">{label}</p>
      <p className="mt-2 font-display text-2xl font-800 text-white">{value || '--'}</p>
      {hint ? <p className="mt-2 text-xs text-white/45">{hint}</p> : null}
    </div>
  )
}

export default function DiscordIntelPanel() {
  const [identity, setIdentity] = useState('')
  const [phase, setPhase] = useState('idle')
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')

  const profile = payload?.profile || null
  const candidates = useMemo(() => (Array.isArray(payload?.candidates) ? payload.candidates : []), [payload])
  const facts = useMemo(() => (Array.isArray(profile?.facts) ? profile.facts : []), [profile])
  const sections = useMemo(() => (Array.isArray(profile?.sections) ? profile.sections : []), [profile])
  const canOpenDiscordProfile = /^\d{16,22}$/.test(String(profile?.id || ''))

  async function handleLookup(nextIdentity = identity) {
    const cleaned = String(nextIdentity || '').trim()
    if (!cleaned || phase === 'loading') return

    setPhase('loading')
    setError('')

    try {
      const response = await osintAPI.lookupDiscord(cleaned)
      setPayload(response.data || null)
      setPhase('done')
    } catch (requestError) {
      const message = getErrorMessage(requestError)
      setPayload(null)
      setError(message)
      setPhase('error')
      toast.error(message)
    }
  }

  return (
    <div className="space-y-5">
      <div className="spotlight-card p-5 sm:p-6">
        <div className="relative z-[1] flex flex-col gap-4 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
            <input
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleLookup()
                }
              }}
              placeholder="Pseudo, ID Discord ou mention..."
              className="input-field pl-11"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleLookup()}
              disabled={!identity.trim() || phase === 'loading'}
              className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <RefreshCw className={`h-4 w-4 ${phase === 'loading' ? 'animate-spin' : ''}`} />
              {phase === 'loading' ? 'Recherche...' : 'Analyser'}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-[24px] border border-red-400/20 bg-red-500/10 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10">
              <AlertTriangle className="h-5 w-5 text-red-300" />
            </div>
            <div>
              <p className="font-display text-lg font-700 text-red-100">Discord Panel</p>
              <p className="mt-1 text-sm leading-6 text-red-100/80">{error}</p>
            </div>
          </div>
        </div>
      ) : null}

      {profile ? (
        <>
          <div className="feature-hero overflow-hidden p-0">
            {profile.banner_url ? (
              <div
                className="h-40 w-full border-b border-white/8 bg-cover bg-center"
                style={{ backgroundImage: `linear-gradient(180deg, rgba(5,7,13,0.18), rgba(5,7,13,0.78)), url(${profile.banner_url})` }}
              />
            ) : (
              <div
                className="h-40 w-full border-b border-white/8"
                style={{ background: `linear-gradient(135deg, ${profile.banner_color || '#1f2937'}55, rgba(34,211,238,0.12), rgba(168,85,247,0.12))` }}
              />
            )}

            <div className="relative z-[1] -mt-10 flex flex-col gap-5 p-5 sm:p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="flex items-end gap-4">
                  <Avatar src={profile.avatar_url} label={profile.display_name || profile.username || profile.id} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-3xl font-800 text-white">{profile.display_name || profile.username || profile.id}</h2>
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-emerald-200">
                        Profil public
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-white/55">
                      @{profile.username || 'inconnu'} {profile.id ? ` - ${profile.id}` : ''}
                    </p>
                    {payload?.note ? <p className="mt-2 text-sm text-white/45">{payload.note}</p> : null}
                    {profile.summary ? <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62">{profile.summary}</p> : null}
                  </div>
                </div>

                {canOpenDiscordProfile ? (
                  <a
                    href={`https://discord.com/users/${profile.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15"
                  >
                    Ouvrir
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Creation" value={formatDate(profile.created_at)} hint="date publique estimee" />
                <Metric label="Serveurs relies" value={profile.server_count || '--'} hint="recoupements serveur visibles" />
                <Metric label="Alias publics" value={profile.observed_names?.length ? Math.max(0, profile.observed_names.length - 1) : '--'} hint="noms observes publiquement" />
                <Metric label="Recoupements" value={profile.sources?.length || 1} hint="multi-source public" />
              </div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="spotlight-card p-5 sm:p-6">
              <div className="relative z-[1] space-y-4">
                <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Fiche publique</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(facts.length ? facts : [
                    { label: 'Pseudo', value: profile.username },
                    { label: 'Nom global', value: profile.global_name },
                    { label: 'ID Discord', value: profile.id },
                    { label: 'Couleur', value: profile.banner_color },
                  ]).map((item) => (
                    <div key={item.label} className="rounded-[20px] border border-white/8 bg-black/15 px-4 py-4">
                      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">{item.label}</p>
                      <p className="mt-3 text-sm leading-6 text-white/72">{item.value || '--'}</p>
                    </div>
                  ))}
                </div>

                {sections.length ? (
                  <div className="grid gap-3 pt-2">
                    {sections.map((section) => (
                      <div key={section.title} className="rounded-[20px] border border-white/8 bg-black/15 p-4">
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
              </div>
            </div>

            {candidates.length ? (
              <div className="spotlight-card p-5">
                <div className="relative z-[1]">
                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Correspondances</p>
                  <div className="mt-4 space-y-3">
                    {candidates.map((candidate) => (
                      <button
                        key={`${candidate.id}-${candidate.display_name}`}
                        type="button"
                        onClick={() => {
                          setIdentity(candidate.id || candidate.username || '')
                          void handleLookup(candidate.id || candidate.username || '')
                        }}
                        className="flex w-full items-center gap-3 rounded-[20px] border border-white/8 bg-black/15 px-4 py-4 text-left transition-all hover:border-white/15 hover:bg-white/[0.04]"
                      >
                        <Avatar src={candidate.avatar_url} label={candidate.display_name} compact />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-display font-700 text-white">{candidate.display_name}</p>
                          <p className="mt-1 truncate text-xs font-mono uppercase tracking-[0.18em] text-white/35">
                            {candidate.username || candidate.id}
                          </p>
                          {candidate.server_count ? (
                            <p className="mt-2 text-xs text-white/45">
                              {candidate.server_count} serveur(s) relie(s) - {candidate.source === 'site_link' ? 'compte lie' : 'recherche publique'}
                            </p>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="spotlight-card p-5">
                <div className="relative z-[1] text-center">
                  <ImageIcon className="mx-auto h-10 w-10 text-white/12" />
                  <p className="mt-4 font-display text-lg font-700 text-white">Recherche multi-source</p>
                  <p className="mt-2 text-sm leading-6 text-white/45">
                    Recherche par pseudo, mention ou ID avec recoupements publics, comptes lies et serveurs relies.
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="feature-hero p-10 text-center">
          <div className="relative z-[1]">
            <ShieldCheck className="mx-auto h-12 w-12 text-white/10" />
            <p className="mt-4 font-display text-xl font-700 text-white">Discord Panel</p>
            <p className="mt-2 text-sm leading-6 text-white/45">
              Fiche Discord publique enrichie avec plusieurs sources visibles sans scope prive.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
