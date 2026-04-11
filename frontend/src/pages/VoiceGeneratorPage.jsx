import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowRight, ChevronDown, ImagePlus, Mic, RefreshCw, Save, Send, Upload, Volume2, X } from 'lucide-react'
import { botAPI, voiceGeneratorAPI } from '../services/api'
import { wsService } from '../services/websocket'
import { useGuildStore } from '../stores'
import SearchableSelect from '../components/ui/SearchableSelect'

const VOICE_CHANNEL_TYPES = new Set([2, 13])
const CATEGORY_CHANNEL_TYPES = new Set([4])
const AUTO_REFRESH_MS = 12000
const MAX_ASSET_LENGTH = 280000
const MAX_REQUEST_LENGTH = 700000
const DEFAULT_SITE_ICON = '/discordforger-icon.png'
const DEFAULT_SITE_BANNER = '/discordforger-logo-full.png'
const DEFAULT_SITE_BUTTON_LABEL = 'Ouvrir DiscordForger'
const LEGACY_CONTROL_TITLE = 'Ta vocale temporaire'
const LEGACY_CONTROL_DESCRIPTION = 'Utilise les menus ci-dessous pour gerer ta vocale temporaire.'

const DEFAULT_CONFIG = {
  enabled: true,
  channel_mode: 'create',
  creator_channel_id: '',
  creator_channel_name: 'Creer ta voc',
  creator_category_id: '',
  control_title: 'Bienvenue dans ton salon vocal',
  control_description: 'Utilise les menus ci-dessous pour personnaliser et gerer ta vocale.',
  panel_color: '#22c55e',
  panel_thumbnail_url: '',
  panel_image_url: '',
  site_button_label: DEFAULT_SITE_BUTTON_LABEL,
  show_site_link: true,
  room_name_template: 'Vocal de {username}',
  default_user_limit: 0,
  default_region: 'auto',
  delete_when_empty: true,
  allow_claim: true,
}

const REGION_OPTIONS = [
  { value: 'auto', label: 'Region auto' },
  { value: 'rotterdam', label: 'Europe' },
  { value: 'us-east', label: 'US East' },
  { value: 'us-west', label: 'US West' },
  { value: 'us-central', label: 'US Central' },
  { value: 'singapore', label: 'Singapore' },
  { value: 'japan', label: 'Japan' },
  { value: 'hongkong', label: 'Hong Kong' },
  { value: 'india', label: 'India' },
  { value: 'sydney', label: 'Sydney' },
  { value: 'brazil', label: 'Brazil' },
  { value: 'southafrica', label: 'South Africa' },
]

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}))
}

function isVoiceChannel(channel) {
  return VOICE_CHANNEL_TYPES.has(Number(channel?.type))
}

function isCategoryChannel(channel) {
  return CATEGORY_CHANNEL_TYPES.has(Number(channel?.type))
}

function sortChannels(channels) {
  return [...channels].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
}

function normalizeConfig(value = {}) {
  const normalizedTitle = String(value?.control_title || DEFAULT_CONFIG.control_title).trim() || DEFAULT_CONFIG.control_title
  const normalizedDescription = String(value?.control_description || DEFAULT_CONFIG.control_description).trim() || DEFAULT_CONFIG.control_description
  return {
    ...DEFAULT_CONFIG,
    ...(value || {}),
    creator_channel_name: String(value?.creator_channel_name || DEFAULT_CONFIG.creator_channel_name).trim() || DEFAULT_CONFIG.creator_channel_name,
    control_title: normalizedTitle === LEGACY_CONTROL_TITLE ? DEFAULT_CONFIG.control_title : normalizedTitle,
    control_description: normalizedDescription === LEGACY_CONTROL_DESCRIPTION ? DEFAULT_CONFIG.control_description : normalizedDescription,
    room_name_template: String(value?.room_name_template || DEFAULT_CONFIG.room_name_template).trim() || DEFAULT_CONFIG.room_name_template,
    site_button_label: String(value?.site_button_label || DEFAULT_CONFIG.site_button_label).trim() || DEFAULT_CONFIG.site_button_label,
    show_site_link: typeof value?.show_site_link === 'boolean' ? value.show_site_link : DEFAULT_CONFIG.show_site_link,
    default_user_limit: Math.max(0, Math.min(Number(value?.default_user_limit ?? DEFAULT_CONFIG.default_user_limit) || 0, 99)),
    default_region: String(value?.default_region || DEFAULT_CONFIG.default_region).trim() || DEFAULT_CONFIG.default_region,
  }
}

function buildSavePayload(value = {}) {
  const source = normalizeConfig(value)
  return {
    enabled: Boolean(source.enabled),
    channel_mode: source.channel_mode === 'existing' ? 'existing' : 'create',
    creator_channel_id: String(source.creator_channel_id || '').trim(),
    creator_channel_name: String(source.creator_channel_name || DEFAULT_CONFIG.creator_channel_name).trim() || DEFAULT_CONFIG.creator_channel_name,
    creator_category_id: String(source.creator_category_id || '').trim(),
    control_title: String(source.control_title || DEFAULT_CONFIG.control_title).trim(),
    control_description: String(source.control_description || DEFAULT_CONFIG.control_description).trim(),
    panel_color: String(source.panel_color || DEFAULT_CONFIG.panel_color).trim(),
    panel_thumbnail_url: String(source.panel_thumbnail_url || '').trim(),
    panel_image_url: String(source.panel_image_url || '').trim(),
    site_button_label: String(source.site_button_label || DEFAULT_CONFIG.site_button_label).trim() || DEFAULT_CONFIG.site_button_label,
    show_site_link: Boolean(source.show_site_link),
    room_name_template: String(source.room_name_template || DEFAULT_CONFIG.room_name_template).trim(),
    default_user_limit: Math.max(0, Math.min(Number(source.default_user_limit || 0), 99)),
    default_region: String(source.default_region || DEFAULT_CONFIG.default_region).trim(),
    delete_when_empty: Boolean(source.delete_when_empty),
    allow_claim: Boolean(source.allow_claim),
  }
}

function getErrorMessage(error) {
  const responseData = error?.response?.data
  if (responseData?.error === 'Validation failed' && Array.isArray(responseData.errors) && responseData.errors.length > 0) {
    const first = responseData.errors[0]
    return `Validation failed: ${first.field || 'champ'} ${first.message || ''}`.trim()
  }
  return responseData?.error || error?.message || 'Erreur inattendue'
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Lecture image impossible'))
    reader.readAsDataURL(file)
  })
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image invalide'))
    image.src = source
  })
}

async function optimizeAssetValue(value, maxLength = MAX_ASSET_LENGTH) {
  const raw = String(value || '').trim()
  if (!raw || /^https?:\/\//i.test(raw)) return raw
  if (!/^data:image\//i.test(raw)) return raw
  if (raw.length <= maxLength) return raw

  const image = await loadImageElement(raw)
  let scale = Math.min(1, 1500 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height))
  let quality = 0.82
  let output = raw

  while (output.length > maxLength && scale > 0.12) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale))
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale))
    const context = canvas.getContext('2d')
    if (!context) break
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    output = canvas.toDataURL('image/webp', quality)
    quality = Math.max(0.24, quality - 0.08)
    scale *= 0.82
  }

  if (output.length > maxLength) {
    throw new Error('Image trop lourde pour le systeme vocal.')
  }

  return output
}

async function buildOptimizedImageAsset(file) {
  const dataUrl = await readFileAsDataUrl(file)
  return optimizeAssetValue(dataUrl, MAX_ASSET_LENGTH)
}

async function buildSavePayloadForRequest(value = {}) {
  const payload = buildSavePayload(value)
  payload.panel_thumbnail_url = await optimizeAssetValue(payload.panel_thumbnail_url, 180000)
  payload.panel_image_url = await optimizeAssetValue(payload.panel_image_url, 300000)

  if (JSON.stringify(payload).length > MAX_REQUEST_LENGTH) {
    throw new Error('Le systeme vocal est trop lourd. Reduis la miniature ou la banniere.')
  }

  return payload
}

function SelectField({ label, value, onChange, options, emptyLabel }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      <SearchableSelect
        label={label}
        value={value || ''}
        onChange={(option) => onChange(option.id || option.value)}
        options={options}
        placeholder={emptyLabel}
        emptyLabel={emptyLabel}
        emptySearchLabel="Aucun resultat"
        countSuffix="elements"
        getOptionKey={(option) => option.id || option.value}
        getOptionLabel={(option) => option.name || option.label}
      />
    </label>
  )
}

function InputField({ label, value, onChange, placeholder = '', multiline = false, rows = 4, type = 'text', min = undefined, max = undefined }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      {multiline ? (
        <textarea
          rows={rows}
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/25"
        />
      ) : (
        <input
          type={type}
          min={min}
          max={max}
          value={value ?? ''}
          onChange={(event) => onChange(type === 'number' ? Number(event.target.value || 0) : event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/25"
        />
      )}
    </label>
  )
}

function ToggleCard({ active, label, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[24px] border p-4 text-left transition-all ${active ? 'border-cyan-400/25 bg-cyan-500/[0.08]' : 'border-white/10 bg-black/20 hover:bg-white/[0.04]'}`}
    >
      <div className="font-display text-base font-700 text-white">{label}</div>
      <div className="mt-1 text-sm text-white/50">{description}</div>
    </button>
  )
}

function AssetBox({ label, value, onValue, onUpload, onClear, inputRef }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-display font-700 text-white">{label}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/70 transition hover:text-white">
            <Upload className="h-3.5 w-3.5" />
            Importer
          </button>
          <button type="button" onClick={onClear} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/70 transition hover:text-white">
            <X className="h-3.5 w-3.5" />
            Retirer
          </button>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { void onUpload(event.target.files?.[0] || null); event.target.value = '' }} />
      <div className="mt-4 flex items-center gap-4">
        {value ? <img src={value} alt="" className="h-20 w-20 rounded-2xl border border-white/10 object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-white/25"><ImagePlus className="h-5 w-5" /></div>}
        <input value={value || ''} onChange={(event) => onValue(event.target.value)} placeholder="URL image ou upload direct" className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/25" />
      </div>
    </div>
  )
}

export default function VoiceGeneratorPage() {
  const { selectedGuildId } = useGuildStore()
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [channels, setChannels] = useState([])
  const [rooms, setRooms] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const thumbnailRef = useRef(null)
  const imageRef = useRef(null)

  const voiceChannels = useMemo(() => sortChannels(channels.filter(isVoiceChannel)), [channels])
  const categoryChannels = useMemo(() => sortChannels(channels.filter(isCategoryChannel)), [channels])
  const normalizedConfig = config ? normalizeConfig(config) : null
  const normalizedDraft = draft ? normalizeConfig(draft) : null
  const draftDirty = JSON.stringify(buildSavePayload(normalizedConfig || {})) !== JSON.stringify(buildSavePayload(normalizedDraft || {}))
  const previewThumbnail = normalizedDraft?.panel_thumbnail_url || DEFAULT_SITE_ICON
  const previewBanner = normalizedDraft?.panel_image_url || DEFAULT_SITE_BANNER
  const previewSiteButtonLabel = normalizedDraft?.site_button_label || DEFAULT_SITE_BUTTON_LABEL

  const applyOverview = (payload = {}, preserveDraft = false) => {
    const nextConfig = normalizeConfig(payload.config || {})
    setConfig(nextConfig)
    setRooms(Array.isArray(payload.rooms) ? payload.rooms : [])
    setStats(payload.stats || {})
    if (!preserveDraft) setDraft(clone(nextConfig))
  }

  const loadAll = async (showToast = false, preserveDraft = false) => {
    if (!selectedGuildId) return
    setLoading(true)
    try {
      const [overviewResponse, channelsResponse] = await Promise.all([
        voiceGeneratorAPI.get(selectedGuildId),
        botAPI.channels(selectedGuildId),
      ])
      applyOverview(overviewResponse.data, preserveDraft)
      setChannels(Array.isArray(channelsResponse.data?.channels) ? channelsResponse.data.channels : [])
      setLoadError('')
      if (showToast) toast.success('Systeme vocal recharge')
    } catch (error) {
      const message = getErrorMessage(error)
      setLoadError(message)
      if (showToast) toast.error(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!selectedGuildId) {
      setConfig(null)
      setDraft(null)
      setRooms([])
      setChannels([])
      setStats({})
      setLoadError('')
      return
    }
    void loadAll(false, false)
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return undefined
    const unsubscribe = wsService.on('voice:updated', (payload = {}) => {
      if (String(payload.guildId || '') !== String(selectedGuildId)) return
      applyOverview(payload, draftDirty)
      setLoadError('')
    })
    return () => unsubscribe()
  }, [selectedGuildId, draftDirty])

  useEffect(() => {
    if (!selectedGuildId) return undefined
    const timer = window.setInterval(() => {
      void voiceGeneratorAPI.get(selectedGuildId).then((response) => {
        applyOverview(response.data, draftDirty)
      }).catch(() => {})
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [selectedGuildId, draftDirty])

  const updateDraft = (patch) => {
    setLoadError('')
    setDraft((current) => normalizeConfig({ ...(current || {}), ...patch }))
  }

  const saveConfig = async ({ silent = false } = {}) => {
    if (!selectedGuildId || !normalizedDraft) return
    setSaving(true)
    try {
      const payload = await buildSavePayloadForRequest(normalizedDraft)
      const response = await voiceGeneratorAPI.save(selectedGuildId, payload)
      applyOverview(response.data, false)
      setLoadError('')
      if (!silent) toast.success('Systeme vocal sauvegarde')
    } catch (error) {
      const message = getErrorMessage(error)
      setLoadError(message)
      if (!silent) toast.error(message)
      throw error
    } finally {
      setSaving(false)
    }
  }

  const publishSystem = async () => {
    if (!selectedGuildId || !normalizedDraft) return
    setPublishing(true)
    try {
      if (draftDirty) await saveConfig({ silent: true })
      const response = await voiceGeneratorAPI.publish(selectedGuildId)
      applyOverview(response.data, false)
      setLoadError('')
      toast.success('Createur vocal publie')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPublishing(false)
    }
  }

  const uploadAsset = async (targetKey, file) => {
    if (!file) return
    if (!String(file.type || '').startsWith('image/')) return toast.error('Choisis une image valide')
    try {
      updateDraft({ [targetKey]: await buildOptimizedImageAsset(file) })
      toast.success('Image chargee')
    } catch (error) {
      toast.error(error?.message || 'Chargement impossible')
    }
  }

  if (!selectedGuildId) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-5 pt-20 sm:p-6 sm:pt-24">
        <div className="glass-card p-10 text-center">
          <Volume2 className="mx-auto mb-4 h-12 w-12 text-white/10" />
          <p className="font-display text-xl font-700 text-white">Choisis d'abord un serveur</p>
          <p className="mt-2 text-white/40">Le systeme vocal temporaire se configure serveur par serveur.</p>
          <Link to="/dashboard/servers" className="mt-5 inline-flex items-center gap-2 rounded-xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 font-mono text-sm text-neon-cyan transition-all hover:bg-neon-cyan/20">
            Choisir un serveur
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:p-6">
      <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(16,24,40,0.94),rgba(12,18,28,0.98))] shadow-[0_30px_90px_rgba(2,8,23,0.45)]">
        <div className="pointer-events-none absolute -left-20 top-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-10 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.22em] text-emerald-200">
                <Mic className="h-3.5 w-3.5" />
                Vocal Temp
              </div>
              <h1 className="font-display text-3xl font-700 text-white sm:text-4xl">Vocaux temporaires</h1>
              <p className="max-w-2xl text-sm text-white/55 sm:text-base">
                Configure un vocal createur, puis laisse le bot ouvrir une vocale perso avec controles VoiceMaster-like dans le chat de la vocale.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => { setRefreshing(true); void loadAll(true, true) }} disabled={loading || refreshing} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white/75 transition hover:text-white disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Recharger
              </button>
              <button type="button" onClick={() => void saveConfig()} disabled={!normalizedDraft || saving || publishing} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/15 disabled:opacity-50">
                <Save className="h-4 w-4" />
                {saving ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
              <button type="button" onClick={() => void publishSystem()} disabled={!normalizedDraft || publishing || saving} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-50">
                <Send className="h-4 w-4" />
                {publishing ? 'Publication...' : 'Publier le createur'}
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Vocaux actifs</div>
              <div className="mt-3 font-display text-3xl font-700 text-white">{Number(stats.open || 0)}</div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Statut createur</div>
              <div className="mt-3 font-display text-2xl font-700 text-white">{stats.published ? 'Publie' : 'A publier'}</div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Suppression auto</div>
              <div className="mt-3 font-display text-2xl font-700 text-white">{normalizedDraft?.delete_when_empty ? 'Activee' : 'Inactive'}</div>
            </div>
          </div>
        </div>
      </section>

      {loadError && (
        <div className="rounded-[24px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {loadError}
        </div>
      )}

      {normalizedDraft && (
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,24,0.98),rgba(6,8,14,0.98))] p-5 shadow-[0_24px_80px_rgba(3,10,24,0.38)]">
              <div className="grid gap-4 md:grid-cols-2">
                <ToggleCard active={normalizedDraft.channel_mode === 'create'} label="Creation auto" description="Le bot cree lui-meme le vocal Createur." onClick={() => updateDraft({ channel_mode: 'create' })} />
                <ToggleCard active={normalizedDraft.channel_mode === 'existing'} label="Salon existant" description="Le bot utilise un vocal deja present." onClick={() => updateDraft({ channel_mode: 'existing' })} />
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {normalizedDraft.channel_mode === 'existing' ? (
                  <SelectField
                    label="Vocal createur"
                    value={normalizedDraft.creator_channel_id}
                    onChange={(value) => updateDraft({ creator_channel_id: value })}
                    options={voiceChannels}
                    emptyLabel="Choisis un vocal"
                  />
                ) : (
                  <InputField
                    label="Nom du vocal createur"
                    value={normalizedDraft.creator_channel_name}
                    onChange={(value) => updateDraft({ creator_channel_name: value })}
                    placeholder="Creer ta voc"
                  />
                )}

                {normalizedDraft.channel_mode === 'create' ? (
                  <div className="space-y-2">
                    <SelectField
                      label="Ranger les vocaux crees dans"
                      value={normalizedDraft.creator_category_id}
                      onChange={(value) => updateDraft({ creator_category_id: value })}
                      options={categoryChannels}
                      emptyLabel="Aucune categorie"
                    />
                    <p className="text-xs text-white/35">Optionnel. Le bot rangera le vocal createur et les vocaux ouverts dans cette categorie.</p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/45">
                    Le salon existant garde sa categorie actuelle.
                  </div>
                )}

                <InputField
                  label="Nom des vocaux"
                  value={normalizedDraft.room_name_template}
                  onChange={(value) => updateDraft({ room_name_template: value })}
                  placeholder="Vocal de {username}"
                />

                <InputField
                  label="Limite par defaut"
                  value={normalizedDraft.default_user_limit}
                  onChange={(value) => updateDraft({ default_user_limit: value })}
                  type="number"
                  min={0}
                  max={99}
                />

                <SelectField
                  label="Region RTC"
                  value={normalizedDraft.default_region}
                  onChange={(value) => updateDraft({ default_region: value })}
                  options={REGION_OPTIONS}
                  emptyLabel="Region auto"
                />

                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                  <input type="checkbox" checked={!!normalizedDraft.delete_when_empty} onChange={(event) => updateDraft({ delete_when_empty: event.target.checked })} className="h-4 w-4 rounded border-white/15 bg-transparent text-cyan-400 focus:ring-cyan-400/30" />
                  Supprimer la vocale quand elle est vide
                </label>

                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                  <input type="checkbox" checked={!!normalizedDraft.allow_claim} onChange={(event) => updateDraft({ allow_claim: event.target.checked })} className="h-4 w-4 rounded border-white/15 bg-transparent text-cyan-400 focus:ring-cyan-400/30" />
                  Autoriser la recuperation si le createur part
                </label>
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,24,0.98),rgba(6,8,14,0.98))] p-5 shadow-[0_24px_80px_rgba(3,10,24,0.38)]">
              <div className="grid gap-4 md:grid-cols-2">
                <InputField label="Titre du message" value={normalizedDraft.control_title} onChange={(value) => updateDraft({ control_title: value })} placeholder="Bienvenue dans ton salon vocal" />
                <InputField label="Couleur" value={normalizedDraft.panel_color} onChange={(value) => updateDraft({ panel_color: value })} placeholder="#22c55e" />
              </div>
              <div className="mt-4">
                <InputField label="Message du chat vocal" value={normalizedDraft.control_description} onChange={(value) => updateDraft({ control_description: value })} multiline rows={4} placeholder="Utilise les menus ci-dessous pour personnaliser et gerer ta vocale." />
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                  <input type="checkbox" checked={!!normalizedDraft.show_site_link} onChange={(event) => updateDraft({ show_site_link: event.target.checked })} className="h-4 w-4 rounded border-white/15 bg-transparent text-cyan-400 focus:ring-cyan-400/30" />
                  Afficher le bouton du site en bas du panel
                </label>
                <InputField label="Texte du bouton site" value={normalizedDraft.site_button_label} onChange={(value) => updateDraft({ site_button_label: value })} placeholder="Ouvrir DiscordForger" />
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <AssetBox label="Miniature" value={normalizedDraft.panel_thumbnail_url} onValue={(value) => updateDraft({ panel_thumbnail_url: value })} onUpload={(file) => uploadAsset('panel_thumbnail_url', file)} onClear={() => updateDraft({ panel_thumbnail_url: '' })} inputRef={thumbnailRef} />
                <AssetBox label="Banniere" value={normalizedDraft.panel_image_url} onValue={(value) => updateDraft({ panel_image_url: value })} onUpload={(file) => uploadAsset('panel_image_url', file)} onClear={() => updateDraft({ panel_image_url: '' })} inputRef={imageRef} />
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,24,0.98),rgba(6,8,14,0.98))] p-5 shadow-[0_24px_80px_rgba(3,10,24,0.38)]">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">
                <Volume2 className="h-3.5 w-3.5" />
                Apercu Discord
              </div>
              <div className="mt-4 overflow-hidden rounded-[26px] border border-white/10 bg-[#0b111b]">
                <div className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(34,197,94,0.12),rgba(34,211,238,0.08),rgba(15,23,42,0.25))] px-4 py-3 text-sm font-medium text-white/80">
                  Panneau vocal Discord
                </div>
                <div className="space-y-4 p-4">
                  <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4">
                    <div className="flex items-start gap-3">
                      <img src={previewThumbnail} alt="" className="h-14 w-14 rounded-2xl border border-white/10 object-cover shadow-[0_10px_30px_rgba(0,0,0,0.25)]" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="font-display text-lg font-700 text-white">{normalizedDraft.control_title}</p>
                        <p className="text-sm leading-6 text-white/72">{normalizedDraft.control_description}</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
                            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/35">Createur</p>
                            <p className="mt-1 text-sm text-white">@Supersonic</p>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
                            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/35">Salon</p>
                            <p className="mt-1 text-sm text-white">Vocal de Supersonic</p>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
                            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/35">Statut</p>
                            <p className="mt-1 text-sm text-white">Ouvert - Visible</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/72">
                        Parametres de la vocale
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/72">
                        Gerer l'acces
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/72">
                        Region active : {REGION_OPTIONS.find((option) => option.value === normalizedDraft.default_region)?.label || 'Region auto'}
                      </div>
                    </div>
                  </div>
                  <img src={previewBanner} alt="" className="max-h-52 w-full rounded-2xl border border-white/10 object-cover" />
                  {normalizedDraft.show_site_link && (
                    <div className="rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.06] p-3">
                      <button type="button" className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-xs font-mono uppercase tracking-[0.18em] text-cyan-100">
                        {previewSiteButtonLabel}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,24,0.98),rgba(6,8,14,0.98))] p-5 shadow-[0_24px_80px_rgba(3,10,24,0.38)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-display text-lg font-700 text-white">Vocaux ouverts</p>
                  <p className="text-sm text-white/45">Suivi live des vocaux temporaires actifs.</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-mono uppercase tracking-[0.14em] text-white/55">
                  {rooms.length}
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {rooms.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-sm text-white/40">
                    Aucun vocal temporaire actif pour le moment.
                  </div>
                ) : rooms.map((room) => (
                  <div key={room.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-display text-base font-700 text-white">{room.name || 'Vocale temporaire'}</div>
                        <div className="mt-1 text-xs text-white/45">Owner: {room.owner_username || room.owner_discord_user_id}</div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] font-mono uppercase tracking-[0.14em]">
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-white/55">limite {room.user_limit || 0}</span>
                        {room.is_locked && <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-amber-200">lock</span>}
                        {room.is_hidden && <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-violet-200">ghost</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
