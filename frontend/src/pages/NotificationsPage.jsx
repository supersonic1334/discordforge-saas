import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRoundX,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { messagesAPI } from '../services/api'
import { useGuildStore } from '../stores'

const DEFAULT_CONFIG = {
  auto_dm_warn: true,
  auto_dm_timeout: true,
  auto_dm_kick: true,
  auto_dm_ban: true,
  auto_dm_blacklist: true,
  appeal_server_name: '',
  appeal_server_url: '',
}

const AUTO_OPTIONS = [
  {
    key: 'auto_dm_warn',
    title: 'Warn',
    hint: 'Envoie un MP propre apres un avertissement.',
    icon: AlertTriangle,
    color: 'amber',
    preview: 'Tu as recu un avertissement. Merci de prendre connaissance de la raison et d ajuster ton comportement.',
  },
  {
    key: 'auto_dm_timeout',
    title: 'Timeout',
    hint: 'Explique la duree et la raison automatiquement.',
    icon: Clock3,
    color: 'cyan',
    preview: 'Tu as ete mute temporairement. Le message precise la duree et le contexte sans rester flou.',
  },
  {
    key: 'auto_dm_kick',
    title: 'Kick',
    hint: 'Previens clairement avant la sortie du serveur.',
    icon: ArrowRight,
    color: 'red',
    preview: 'Tu as ete retire du serveur. Ce message sert de recap rapide avec la raison staff.',
  },
  {
    key: 'auto_dm_ban',
    title: 'Ban',
    hint: 'Peut inclure un serveur ou un lien de recours.',
    icon: ShieldCheck,
    color: 'violet',
    preview: 'Tu as ete banni du serveur. Si un recours est configure, il apparait automatiquement dans le MP.',
  },
  {
    key: 'auto_dm_blacklist',
    title: 'Blacklist reseau',
    hint: 'Notification speciale pour un blocage global.',
    icon: UserRoundX,
    color: 'rose',
    preview: 'Tu es bloque sur le reseau de serveurs. Le message reste clair et indique la marche a suivre si tu autorises un recours.',
  },
]

const TONE_MAP = {
  amber: {
    shell: 'border-amber-500/20 bg-amber-500/10',
    icon: 'text-amber-300',
  },
  cyan: {
    shell: 'border-cyan-500/20 bg-cyan-500/10',
    icon: 'text-cyan-300',
  },
  red: {
    shell: 'border-red-500/20 bg-red-500/10',
    icon: 'text-red-300',
  },
  violet: {
    shell: 'border-violet-500/20 bg-violet-500/10',
    icon: 'text-violet-300',
  },
  rose: {
    shell: 'border-pink-500/20 bg-pink-500/10',
    icon: 'text-pink-300',
  },
}

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Erreur inattendue'
}

function HeaderPill({ icon: Icon, label }) {
  return (
    <span className="feature-chip">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  )
}

function TogglePill({ enabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-8 w-[74px] items-center rounded-full border transition-all ${
        enabled
          ? 'border-emerald-500/30 bg-emerald-500/12 shadow-[0_0_24px_rgba(52,211,153,0.16)]'
          : 'border-white/10 bg-white/[0.04]'
      }`}
    >
      <span
        className={`absolute top-1 h-6 w-6 rounded-full transition-all ${
          enabled
            ? 'left-[42px] bg-emerald-300 shadow-[0_8px_20px_rgba(52,211,153,0.35)]'
            : 'left-1 bg-white/25'
        }`}
      />
      <span className={`w-full px-3 text-[11px] font-mono uppercase tracking-[0.2em] ${enabled ? 'text-emerald-200 text-left' : 'text-white/45 text-right'}`}>
        {enabled ? 'On' : 'Off'}
      </span>
    </button>
  )
}

export default function NotificationsPage() {
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedPreview, setSelectedPreview] = useState('auto_dm_warn')
  const autosaveTimerRef = useRef(null)
  const lastSavedSignatureRef = useRef(JSON.stringify(DEFAULT_CONFIG))
  const hydratedRef = useRef(false)

  const appealGuilds = useMemo(
    () => guilds.filter((entry) => entry.id !== selectedGuildId),
    [guilds, selectedGuildId]
  )

  const enabledCount = useMemo(
    () => AUTO_OPTIONS.filter((entry) => !!config[entry.key]).length,
    [config]
  )

  const previewOption = AUTO_OPTIONS.find((entry) => entry.key === selectedPreview) || AUTO_OPTIONS[0]
  const previewTone = TONE_MAP[previewOption.color] || TONE_MAP.violet
  const PreviewIcon = previewOption.icon

  useEffect(() => {
    if (!selectedGuildId) return
    hydratedRef.current = false
    loadConfig()
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId || !hydratedRef.current) return undefined
    const signature = JSON.stringify(config)
    if (signature === lastSavedSignatureRef.current) return undefined

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    autosaveTimerRef.current = window.setTimeout(async () => {
      setSaving(true)
      try {
        const response = await messagesAPI.saveConfig(selectedGuildId, config)
        const nextConfig = { ...DEFAULT_CONFIG, ...(response.data?.settings || {}) }
        const nextSignature = JSON.stringify(nextConfig)
        lastSavedSignatureRef.current = nextSignature
        setConfig((current) => {
          const currentSignature = JSON.stringify(current)
          return currentSignature === nextSignature ? current : nextConfig
        })
      } catch (error) {
        toast.error(getErrorMessage(error))
      } finally {
        setSaving(false)
      }
    }, 700)

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [config, selectedGuildId])

  async function loadConfig() {
    if (!selectedGuildId) return
    setLoading(true)
    try {
      const response = await messagesAPI.config(selectedGuildId)
      const nextConfig = { ...DEFAULT_CONFIG, ...(response.data?.settings || {}) }
      setConfig(nextConfig)
      lastSavedSignatureRef.current = JSON.stringify(nextConfig)
      hydratedRef.current = true
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  function toggleAll(nextValue) {
    const next = { ...config }
    for (const option of AUTO_OPTIONS) next[option.key] = nextValue
    setConfig(next)
  }

  if (!selectedGuildId) {
    return (
      <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto">
        <div className="glass-card p-10 text-center">
          <BellRing className="w-12 h-12 text-white/10 mx-auto mb-4" />
          <p className="font-display font-700 text-white text-xl">Choisis d'abord un serveur</p>
          <p className="text-white/40 mt-2">La categorie Notifications fonctionne serveur par serveur.</p>
          <Link to="/dashboard/servers" className="inline-flex items-center gap-2 mt-5 px-5 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/20 transition-all">
            Choisir un serveur
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <HeaderPill icon={BellRing} label="notifications auto" />
              <HeaderPill icon={ShieldCheck} label="sanctions staff" />
              <HeaderPill icon={Sparkles} label={guild?.name || 'serveur'} />
            </div>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">Notifications</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 sm:text-[15px]">Toute la configuration automatique est regroupee ici : activations, rendu, serveur de recours et pilotage global, sans melanger cette logique avec la page Messages.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 xl:justify-end">
            <button
              type="button"
              onClick={loadConfig}
              disabled={loading || saving}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-mono text-white/70 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading || saving ? 'animate-spin' : ''}`} />
              Recharger
            </button>
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-3">
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Actives</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{enabledCount}</p>
          </div>
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Recours</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{config.appeal_server_url ? 'On' : 'Off'}</p>
          </div>
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Profils</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{AUTO_OPTIONS.length}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <div className="spotlight-card p-6">
            <div className="relative z-[1] space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display font-700 text-white text-lg">Profils automatiques</p>
                  <p className="text-white/40 text-sm mt-1">Active ou coupe chaque type de notification en un clic.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => toggleAll(true)}
                    className="feature-chip transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                  >
                    Tout activer
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleAll(false)}
                    className="feature-chip transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                  >
                    Tout couper
                  </button>
                </div>
              </div>

              <div className="grid gap-3">
                {AUTO_OPTIONS.map((item) => {
                  const Icon = item.icon
                  const tone = TONE_MAP[item.color] || TONE_MAP.violet
                  const active = selectedPreview === item.key
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setSelectedPreview(item.key)}
                      className={`depth-panel w-full px-4 py-4 text-left transition-all ${active ? 'border-neon-cyan/20 shadow-[0_0_28px_rgba(34,211,238,0.08)]' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${tone.shell}`}>
                            <Icon className={`w-4 h-4 ${tone.icon}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-white font-display font-700">{item.title}</p>
                              <span className="text-[11px] font-mono text-white/30 uppercase tracking-[0.16em]">{config[item.key] ? 'actif' : 'coupe'}</span>
                            </div>
                            <p className="text-white/40 text-sm mt-1">{item.hint}</p>
                          </div>
                        </div>
                        <TogglePill
                          enabled={!!config[item.key]}
                          onClick={(event) => {
                            event.stopPropagation()
                            setConfig((current) => ({ ...current, [item.key]: !current[item.key] }))
                          }}
                        />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="spotlight-card p-6">
            <div className="relative z-[1] space-y-5">
              <div>
                <p className="font-display font-700 text-white text-lg">Passerelle de recours</p>
                <p className="text-white/40 text-sm mt-1">Si tu veux laisser une derniere chance sur ban / blacklist, configure-la ici.</p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Serveur de recours</span>
                  <select
                    className="select-field"
                    value={appealGuilds.some((entry) => entry.name === config.appeal_server_name) ? config.appeal_server_name : ''}
                    onChange={(event) => setConfig((current) => ({ ...current, appeal_server_name: event.target.value }))}
                  >
                    <option value="">Aucun serveur choisi</option>
                    {appealGuilds.map((entry) => (
                      <option key={entry.id} value={entry.name}>{entry.name}</option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Lien d'invitation</span>
                  <input
                    className="input-field"
                    placeholder="https://discord.gg/..."
                    value={config.appeal_server_url}
                    onChange={(event) => setConfig((current) => ({ ...current, appeal_server_url: event.target.value }))}
                  />
                </label>
              </div>

              <label className="block space-y-2">
                <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Nom libre du serveur de recours</span>
                <input
                  className="input-field"
                  placeholder="Exemple: Support deban DiscordForger"
                  value={config.appeal_server_name}
                  onChange={(event) => setConfig((current) => ({ ...current, appeal_server_name: event.target.value }))}
                />
              </label>

              <div className="rounded-2xl border border-white/8 bg-black/15 p-4 text-sm text-white/55">
                Si un lien de recours est defini, les MP de ban et blacklist peuvent l'afficher automatiquement pour orienter la personne.
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="depth-panel-static rounded-[28px] border border-white/8 bg-gradient-to-br from-white/[0.05] to-white/[0.02] p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-2xl border flex items-center justify-center ${previewTone.shell}`}>
                  <PreviewIcon className={`w-5 h-5 ${previewTone.icon}`} />
                </div>
                <div>
                  <p className="font-display font-700 text-white text-lg">Apercu live</p>
                  <p className="text-white/40 text-sm mt-1">{previewOption.title}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/20 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-white font-display font-700">{guild?.name}</p>
                    <p className="text-[11px] font-mono text-white/30 uppercase tracking-[0.18em]">notification automatique</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase ${previewTone.shell} ${previewTone.icon}`}>
                    {config[previewOption.key] ? 'active' : 'coupee'}
                  </span>
                </div>
                <div>
                  <p className="text-white text-sm font-display font-700">Information moderation</p>
                  <p className="text-white/65 text-sm mt-2 leading-6">{previewOption.preview}</p>
                </div>
                {(previewOption.key === 'auto_dm_ban' || previewOption.key === 'auto_dm_blacklist') && config.appeal_server_url ? (
                  <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 py-3 text-sm text-violet-100">
                    Serveur de recours : {config.appeal_server_name || 'Support'} - {config.appeal_server_url}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
                <div className="flex items-center gap-2 text-white/75">
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  <p className="text-sm font-display font-700">Conseil</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-white/45">Garde les profils sensibles actifs, puis personnalise surtout le recours pour les cas de ban et blacklist. La page `Messages` reste maintenant reservee uniquement aux MP manuels.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
