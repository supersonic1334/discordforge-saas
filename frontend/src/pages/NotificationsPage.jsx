import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  ExternalLink,
  ImagePlus,
  LayoutTemplate,
  RefreshCw,
  ShieldBan,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRoundX,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { messagesAPI } from '../services/api'
import { wsService } from '../services/websocket'
import { useGuildStore } from '../stores'
import SearchableSelect from '../components/ui/SearchableSelect'

const DEFAULT_CONFIG = {
  auto_dm_warn: true,
  auto_dm_timeout: true,
  auto_dm_kick: true,
  auto_dm_ban: true,
  auto_dm_blacklist: true,
  appeal_server_name: '',
  appeal_server_url: '',
  brand_name: '',
  brand_icon_url: '',
  brand_logo_url: '',
  brand_site_url: '',
  site_button_label: '',
  show_site_link: true,
  show_brand_logo: true,
  footer_text: '',
}

const AUTO_OPTIONS = [
  {
    key: 'auto_dm_warn',
    title: 'Warn',
    icon: AlertTriangle,
    color: 'amber',
    hint: 'Envoie un MP propre apres un avertissement.',
    summary: 'Tu as recu un avertissement officiel sur le serveur.',
    reason: 'Publicite repetee dans plusieurs salons.',
  },
  {
    key: 'auto_dm_timeout',
    title: 'Timeout',
    icon: Clock3,
    color: 'cyan',
    hint: 'Explique la duree et la raison automatiquement.',
    summary: 'Tu ne peux plus parler temporairement sur le serveur.',
    reason: 'Flood detecte par le staff.',
    duration: '10 minutes',
  },
  {
    key: 'auto_dm_kick',
    title: 'Kick',
    icon: ArrowRight,
    color: 'red',
    hint: 'Previens clairement avant la sortie du serveur.',
    summary: 'Tu as ete retire du serveur avec un recap staff clair.',
    reason: 'Comportement contraire au reglement.',
  },
  {
    key: 'auto_dm_ban',
    title: 'Ban',
    icon: ShieldBan,
    color: 'violet',
    hint: 'Peut inclure un serveur ou un lien de recours.',
    summary: 'Ton acces au serveur a ete retire par le staff.',
    reason: 'Contournement de sanction.',
  },
  {
    key: 'auto_dm_blacklist',
    title: 'Blacklist reseau',
    icon: UserRoundX,
    color: 'rose',
    hint: 'Notification speciale pour un blocage global.',
    summary: 'Ton acces au reseau du bot a ete coupe.',
    reason: 'Raid confirme sur plusieurs serveurs.',
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Lecture image impossible'))
    reader.readAsDataURL(file)
  })
}

function AssetPreview({ src, label, rounded = false, className = '', onClick = null }) {
  const baseClassName = `${rounded ? 'rounded-2xl' : 'rounded-3xl'} border ${className}`
  const interactiveClassName = onClick
    ? 'cursor-pointer transition-all hover:border-white/20 hover:bg-white/[0.05]'
    : ''

  if (src) {
    if (onClick) {
      return (
        <button
          type="button"
          onClick={onClick}
          aria-label={`Importer ${label}`}
          className={`${baseClassName} overflow-hidden ${interactiveClassName}`}
        >
          <img
            src={src}
            alt={label}
            className="h-full w-full object-cover"
          />
        </button>
      )
    }

    return (
      <img
        src={src}
        alt={label}
        className={`${baseClassName} border-white/10 object-cover`}
      />
    )
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Importer ${label}`}
        className={`${baseClassName} border-dashed border-white/12 bg-white/[0.03] flex items-center justify-center text-white/30 ${interactiveClassName}`}
      >
        <ImagePlus className="w-5 h-5" />
      </button>
    )
  }

  return (
    <div className={`${baseClassName} border-dashed border-white/12 bg-white/[0.03] flex items-center justify-center text-white/30`}>
      <ImagePlus className="w-5 h-5" />
    </div>
  )
}

export default function NotificationsPage() {
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId) || null
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedPreview, setSelectedPreview] = useState('auto_dm_warn')
  const autosaveTimerRef = useRef(null)
  const lastSavedSignatureRef = useRef(JSON.stringify(DEFAULT_CONFIG))
  const hydratedRef = useRef(false)
  const iconUploadRef = useRef(null)
  const logoUploadRef = useRef(null)

  const appealGuilds = useMemo(
    () => guilds.filter((entry) => entry.id !== selectedGuildId),
    [guilds, selectedGuildId]
  )

  const enabledCount = useMemo(
    () => AUTO_OPTIONS.filter((entry) => !!config[entry.key]).length,
    [config]
  )

  const customAssets = useMemo(
    () => [config.brand_icon_url, config.brand_logo_url].filter(Boolean).length,
    [config.brand_icon_url, config.brand_logo_url]
  )

  const previewOption = AUTO_OPTIONS.find((entry) => entry.key === selectedPreview) || AUTO_OPTIONS[0]
  const previewTone = TONE_MAP[previewOption.color] || TONE_MAP.violet
  const PreviewIcon = previewOption.icon
  const brandName = config.brand_name.trim() || guild?.name || 'Serveur Discord'
  const footerText = config.footer_text.trim() || 'Notification automatique'
  const siteUrl = config.brand_site_url.trim() || 'https://discordforger.onrender.com'
  const siteButtonLabel = config.site_button_label.trim() || `Ouvrir ${brandName}`
  const iconSrc = config.brand_icon_url || guild?.iconUrl || '/discordforger-icon.png'
  const logoSrc = config.brand_logo_url || '/discordforger-logo-full.png'

  useEffect(() => {
    if (!selectedGuildId) return
    hydratedRef.current = false
    void loadConfig()
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

  useEffect(() => {
    const handleRealtimeSync = (payload = {}) => {
      if (String(payload.guildId || '') !== String(selectedGuildId || '')) return
      const nextConfig = { ...DEFAULT_CONFIG, ...(payload.settings || {}) }
      lastSavedSignatureRef.current = JSON.stringify(nextConfig)
      setConfig(nextConfig)
      hydratedRef.current = true
    }

    const handleSnapshotRestore = (payload = {}) => {
      if (String(payload.guildId || '') !== String(selectedGuildId || '')) return
      void loadConfig(false)
    }

    const unsubscribeMessages = wsService.on('messages:updated', handleRealtimeSync)
    const unsubscribeSnapshots = wsService.on('team:snapshot_restored', handleSnapshotRestore)

    return () => {
      unsubscribeMessages()
      unsubscribeSnapshots()
    }
  }, [selectedGuildId])

  async function loadConfig(showToast = false) {
    if (!selectedGuildId) return
    setLoading(true)
    try {
      const response = await messagesAPI.config(selectedGuildId)
      const nextConfig = { ...DEFAULT_CONFIG, ...(response.data?.settings || {}) }
      setConfig(nextConfig)
      lastSavedSignatureRef.current = JSON.stringify(nextConfig)
      hydratedRef.current = true
      if (showToast) toast.success('Notifications rechargees')
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

  async function handleAssetUpload(targetKey, file) {
    if (!file) return
    if (!String(file.type || '').startsWith('image/')) {
      toast.error('Choisis une image valide')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setConfig((current) => ({ ...current, [targetKey]: dataUrl }))
      toast.success('Image chargee')
    } catch (error) {
      toast.error(error?.message || 'Chargement impossible')
    }
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
      <input
        ref={iconUploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleAssetUpload('brand_icon_url', event.target.files?.[0] || null)
          event.target.value = ''
        }}
      />
      <input
        ref={logoUploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleAssetUpload('brand_logo_url', event.target.files?.[0] || null)
          event.target.value = ''
        }}
      />

      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <HeaderPill icon={BellRing} label="notifications auto" />
              <HeaderPill icon={LayoutTemplate} label="branding dm" />
              <HeaderPill icon={Sparkles} label={guild?.name || 'serveur'} />
            </div>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">Notifications</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55 sm:text-[15px]">Toute la configuration des MP automatiques est maintenant regroupee ici: profils actifs, branding du bot, lien utile, recours et apercu live.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { void loadConfig(true) }}
            disabled={loading || saving}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-mono text-white/70 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading || saving ? 'animate-spin' : ''}`} />
            Recharger
          </button>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-4">
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Actives</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{enabledCount}</p>
          </div>
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Assets perso</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{customAssets}</p>
          </div>
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Lien utile</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{config.show_site_link ? 'On' : 'Off'}</p>
          </div>
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Recours</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{config.appeal_server_url ? 'On' : 'Off'}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <div className="spotlight-card p-6">
            <div className="relative z-[1] space-y-5">
              <div>
                <p className="font-display font-700 text-white text-lg">Identite du bot</p>
                <p className="text-white/40 text-sm mt-1">Change le nom visible, le footer et le lien que voit le membre en message prive.</p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Nom affiche</span>
                  <input
                    className="input-field"
                    placeholder={guild?.name || 'Nom du bot'}
                    value={config.brand_name}
                    onChange={(event) => setConfig((current) => ({ ...current, brand_name: event.target.value }))}
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Footer</span>
                  <input
                    className="input-field"
                    placeholder="Notification automatique"
                    value={config.footer_text}
                    onChange={(event) => setConfig((current) => ({ ...current, footer_text: event.target.value }))}
                  />
                </label>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                <label className="block space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Lien du site ou du support</span>
                  <input
                    className="input-field"
                    placeholder="https://ton-site.fr"
                    value={config.brand_site_url}
                    onChange={(event) => setConfig((current) => ({ ...current, brand_site_url: event.target.value }))}
                  />
                </label>

                <div className="space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Afficher le lien</span>
                  <TogglePill
                    enabled={!!config.show_site_link}
                    onClick={() => setConfig((current) => ({ ...current, show_site_link: !current.show_site_link }))}
                  />
                </div>
              </div>

              <label className="block space-y-2">
                <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Texte du bouton</span>
                <input
                  className="input-field"
                  placeholder="Ouvrir le support"
                  value={config.site_button_label}
                  onChange={(event) => setConfig((current) => ({ ...current, site_button_label: event.target.value }))}
                />
              </label>
            </div>
          </div>

          <div className="spotlight-card p-6">
            <div className="relative z-[1] space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display font-700 text-white text-lg">Assets visuels</p>
                  <p className="text-white/40 text-sm mt-1">Charge ton icone et ton logo pour white-label les DM.</p>
                </div>
                <div className="space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Afficher le grand logo</span>
                  <TogglePill
                    enabled={!!config.show_brand_logo}
                    onClick={() => setConfig((current) => ({ ...current, show_brand_logo: !current.show_brand_logo }))}
                  />
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-display font-700 text-white">Icone</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => iconUploadRef.current?.click()}
                        className="feature-chip transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Importer
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfig((current) => ({ ...current, brand_icon_url: '' }))}
                        className="feature-chip transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                        Retirer
                      </button>
                    </div>
                  </div>
                  <AssetPreview
                    src={config.brand_icon_url || guild?.iconUrl || ''}
                    label="Icone DM"
                    rounded
                    className="w-24 h-24"
                    onClick={() => iconUploadRef.current?.click()}
                  />
                  <input
                    className="input-field"
                    placeholder="URL icone (ou importe une image)"
                    value={config.brand_icon_url}
                    onChange={(event) => setConfig((current) => ({ ...current, brand_icon_url: event.target.value }))}
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-display font-700 text-white">Logo large</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => logoUploadRef.current?.click()}
                        className="feature-chip transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Importer
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfig((current) => ({ ...current, brand_logo_url: '' }))}
                        className="feature-chip transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                        Retirer
                      </button>
                    </div>
                  </div>
                  <AssetPreview
                    src={config.brand_logo_url || ''}
                    label="Logo DM"
                    className="w-full h-28"
                    onClick={() => logoUploadRef.current?.click()}
                  />
                  <input
                    className="input-field"
                    placeholder="URL logo (ou importe une image)"
                    value={config.brand_logo_url}
                    onChange={(event) => setConfig((current) => ({ ...current, brand_logo_url: event.target.value }))}
                  />
                </div>
              </div>
            </div>
          </div>

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
                  <SearchableSelect
                    label="Serveur de recours"
                    value={appealGuilds.some((entry) => entry.name === config.appeal_server_name) ? config.appeal_server_name : ''}
                    onChange={(option) => setConfig((current) => ({ ...current, appeal_server_name: option.name }))}
                    options={appealGuilds}
                    placeholder="Aucun serveur choisi"
                    emptyLabel="Aucun serveur choisi"
                    emptySearchLabel="Aucun serveur"
                    getOptionKey={(option) => option.name}
                    getOptionLabel={(option) => option.name}
                    showCount={false}
                  />
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
                  placeholder="Exemple: Support deban"
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

              <div className="rounded-2xl border border-white/8 bg-black/20 p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <AssetPreview src={iconSrc} label={brandName} rounded className="w-12 h-12" />
                  <div className="min-w-0">
                    <p className="text-white font-display font-700 truncate">{brandName}</p>
                    <p className="text-[11px] font-mono text-white/30 uppercase tracking-[0.18em]">notification staff</p>
                  </div>
                </div>

                <div className={`rounded-2xl border p-4 ${previewTone.shell}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-white font-display font-700">{previewOption.title}</p>
                    <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">{config[previewOption.key] ? 'active' : 'coupe'}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/80">{previewOption.summary}</p>
                  <div className="mt-4 space-y-2 text-sm text-white/65">
                    <p><span className="text-white/35">Serveur:</span> {guild?.name || 'Serveur Discord'}</p>
                    {previewOption.duration ? <p><span className="text-white/35">Duree:</span> {previewOption.duration}</p> : null}
                    <p><span className="text-white/35">Raison:</span> {previewOption.reason}</p>
                    {(previewOption.key === 'auto_dm_ban' || previewOption.key === 'auto_dm_blacklist') && config.appeal_server_url ? (
                      <p><span className="text-white/35">Recours:</span> {config.appeal_server_name || 'Support'} - {config.appeal_server_url}</p>
                    ) : null}
                  </div>
                </div>

                {config.show_brand_logo && (
                  <AssetPreview src={logoSrc} label="Logo embed" className="w-full h-28" />
                )}

                <div className="rounded-2xl border border-white/8 bg-black/15 p-4 space-y-3">
                  <p className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Footer</p>
                  <p className="text-sm text-white/70">{footerText}</p>
                  {config.show_site_link && (
                    <div className="rounded-xl border border-neon-cyan/20 bg-neon-cyan/10 px-3 py-3">
                      <p className="text-sm text-neon-cyan">{siteButtonLabel}</p>
                      <p className="text-xs text-white/45 mt-1 break-all">{siteUrl}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
                <div className="flex items-center gap-2 text-white/75">
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  <p className="text-sm font-display font-700">Conseil</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-white/45">Active les profils sensibles, remplace les assets visibles, puis coupe le lien si tu veux un rendu totalement white-label. La synchro live reste partagee entre collaborateurs.</p>
              </div>
            </div>
          </div>

          <div className="glass-card p-5 text-xs font-mono text-white/40">
            {saving ? 'Synchronisation notifications en cours...' : 'Synchro live active pour les collaborateurs'}
          </div>
        </div>
      </div>
    </div>
  )
}
