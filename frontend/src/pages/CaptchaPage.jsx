import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowRight, ChevronDown, Fingerprint, ImagePlus, RefreshCw, Save, Send, Shield, Upload, UserPlus, X } from 'lucide-react'
import { botAPI, captchaAPI } from '../services/api'
import { wsService } from '../services/websocket'
import { useGuildStore } from '../stores'

const TEXT_CHANNEL_TYPES = new Set([0, 5, 11, 12, 15])
const AUTO_REFRESH_MS = 15000
const AUTOSAVE_DELAY_MS = 1500
const LOCAL_DRAFT_PREFIX = 'captcha-generator-draft:'
const MAX_CAPTCHA_ASSET_LENGTH = 280000
const MAX_CAPTCHA_REQUEST_LENGTH = 650000

const DEFAULT_CHALLENGE_TYPES = [
  {
    key: 'image_code',
    label: 'Image sécurisée',
    description: 'Le membre recopie un code généré dans une image unique.',
    enabled: true,
  },
  {
    key: 'quick_math',
    label: 'Calcul express',
    description: 'Le membre résout un calcul court pour valider son accès.',
    enabled: true,
  },
]

const DEFAULT_CONFIG = {
  enabled: true,
  channel_mode: 'existing',
  panel_channel_id: '',
  panel_channel_name: 'verification',
  panel_message_id: '',
  panel_title: 'Vérification CAPTCHA',
  panel_description: 'Clique sur le bouton de vérification pour débloquer ton accès au serveur.',
  panel_color: '#06b6d4',
  panel_thumbnail_url: '',
  panel_image_url: '',
  verified_role_ids: [],
  log_channel_id: '',
  success_message: 'Vérification réussie. Accès débloqué.',
  failure_message: 'Code invalide. Réessaie avec une nouvelle vérification.',
  challenge_types: DEFAULT_CHALLENGE_TYPES,
}

function getErrorMessage(error) {
  const responseData = error?.response?.data
  if (responseData?.error === 'Validation failed' && Array.isArray(responseData.errors) && responseData.errors.length > 0) {
    const first = responseData.errors[0]
    return `Validation failed: ${first.field || 'champ'} ${first.message || ''}`.trim()
  }
  return responseData?.error || error?.message || 'Erreur inattendue'
}

function isTextChannel(channel) {
  return TEXT_CHANNEL_TYPES.has(Number(channel?.type))
}

function sortChannels(channels) {
  return [...channels].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
}

function sortRoles(roles) {
  return [...roles]
    .filter((role) => role?.name !== '@everyone')
    .sort((a, b) => Number(b?.position || 0) - Number(a?.position || 0))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}))
}

function getDraftStorageKey(guildId) {
  return `${LOCAL_DRAFT_PREFIX}${guildId || 'unknown'}`
}

function readStoredDraft(guildId) {
  try {
    const raw = window.localStorage.getItem(getDraftStorageKey(guildId))
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeStoredDraft(guildId, draft) {
  try {
    window.localStorage.setItem(getDraftStorageKey(guildId), JSON.stringify(draft))
  } catch {
    // ignore
  }
}

function clearStoredDraft(guildId) {
  try {
    window.localStorage.removeItem(getDraftStorageKey(guildId))
  } catch {
    // ignore
  }
}

function mergeChallengeTypes(challengeTypes = []) {
  const map = new Map(
    (Array.isArray(challengeTypes) ? challengeTypes : [])
      .map((item) => [String(item?.key || '').trim(), item])
      .filter(([key]) => key)
  )

  return DEFAULT_CHALLENGE_TYPES.map((preset) => {
    const current = map.get(preset.key) || {}
    return {
      key: preset.key,
      label: String(current.label || preset.label),
      description: String(current.description || preset.description),
      enabled: typeof current.enabled === 'boolean' ? current.enabled : preset.enabled,
    }
  })
}

function normalizeConfig(value = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...(value || {}),
    panel_channel_name: String(value?.panel_channel_name || DEFAULT_CONFIG.panel_channel_name).trim() || DEFAULT_CONFIG.panel_channel_name,
    verified_role_ids: [...new Set((Array.isArray(value?.verified_role_ids) ? value.verified_role_ids : []).map((roleId) => String(roleId || '').trim()).filter(Boolean))],
    challenge_types: mergeChallengeTypes(value?.challenge_types),
  }
}

function buildCaptchaSavePayload(value = {}) {
  const source = normalizeConfig(value)
  return {
    enabled: Boolean(source.enabled),
    channel_mode: source.channel_mode === 'create' ? 'create' : 'existing',
    panel_channel_id: String(source.panel_channel_id || '').trim(),
    panel_channel_name: String(source.panel_channel_name || DEFAULT_CONFIG.panel_channel_name).trim() || DEFAULT_CONFIG.panel_channel_name,
    panel_message_id: String(source.panel_message_id || '').trim(),
    panel_title: String(source.panel_title || DEFAULT_CONFIG.panel_title).trim(),
    panel_description: String(source.panel_description || '').trim(),
    panel_color: String(source.panel_color || DEFAULT_CONFIG.panel_color).trim(),
    panel_thumbnail_url: String(source.panel_thumbnail_url || '').trim(),
    panel_image_url: String(source.panel_image_url || '').trim(),
    verified_role_ids: [...new Set((Array.isArray(source.verified_role_ids) ? source.verified_role_ids : []).map((roleId) => String(roleId || '').trim()).filter(Boolean))],
    log_channel_id: String(source.log_channel_id || '').trim(),
    success_message: String(source.success_message || DEFAULT_CONFIG.success_message).trim(),
    failure_message: String(source.failure_message || DEFAULT_CONFIG.failure_message).trim(),
    challenge_types: mergeChallengeTypes(source.challenge_types),
  }
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

async function buildOptimizedImageAsset(file) {
  const rawDataUrl = await readFileAsDataUrl(file)
  if (rawDataUrl.length <= MAX_CAPTCHA_ASSET_LENGTH) return rawDataUrl
  if (String(file.type || '').toLowerCase() === 'image/gif') {
    throw new Error('GIF trop lourd. Choisis une image plus légère.')
  }

  const image = await loadImageElement(rawDataUrl)
  let scale = Math.min(1, 1400 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height))
  let quality = 0.84
  let output = rawDataUrl

  while (output.length > MAX_CAPTCHA_ASSET_LENGTH && scale > 0.14) {
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

  if (output.length > MAX_CAPTCHA_ASSET_LENGTH) {
    throw new Error('Image trop lourde. Réduis sa taille avant envoi.')
  }

  return output
}

async function optimizeImageAssetValue(value, maxLength = MAX_CAPTCHA_ASSET_LENGTH) {
  const raw = String(value || '').trim()
  if (!raw || /^https?:\/\//i.test(raw)) return raw
  if (!/^data:image\//i.test(raw)) return raw
  if (raw.length <= maxLength) return raw

  const image = await loadImageElement(raw)
  let scale = Math.min(1, 1400 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height))
  let quality = 0.8
  let output = raw

  while (output.length > maxLength && scale > 0.12) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale))
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale))
    const context = canvas.getContext('2d')
    if (!context) break
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    output = canvas.toDataURL('image/webp', quality)
    quality = Math.max(0.22, quality - 0.08)
    scale *= 0.8
  }

  if (output.length > maxLength) {
    throw new Error('Image trop lourde pour le panel CAPTCHA.')
  }

  return output
}

async function buildCaptchaSavePayloadForRequest(value = {}) {
  const payload = buildCaptchaSavePayload(value)
  payload.panel_thumbnail_url = await optimizeImageAssetValue(payload.panel_thumbnail_url, 180000)
  payload.panel_image_url = await optimizeImageAssetValue(payload.panel_image_url, 320000)

  let serialized = JSON.stringify(payload)
  if (serialized.length > MAX_CAPTCHA_REQUEST_LENGTH && payload.panel_image_url.startsWith('data:image/')) {
    payload.panel_image_url = await optimizeImageAssetValue(payload.panel_image_url, 220000)
    serialized = JSON.stringify(payload)
  }
  if (serialized.length > MAX_CAPTCHA_REQUEST_LENGTH && payload.panel_thumbnail_url.startsWith('data:image/')) {
    payload.panel_thumbnail_url = await optimizeImageAssetValue(payload.panel_thumbnail_url, 120000)
    serialized = JSON.stringify(payload)
  }
  if (serialized.length > MAX_CAPTCHA_REQUEST_LENGTH) {
    throw new Error('Le panel CAPTCHA est trop lourd. Réduis la miniature ou la bannière.')
  }

  return payload
}

function SelectField({ label, value, onChange, options, emptyLabel }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      <div className="relative">
        <select
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-2xl border border-white/10 bg-[#0a101b] px-4 py-3 pr-12 text-sm text-white outline-none transition focus:border-cyan-400/25"
          style={{ colorScheme: 'dark' }}
        >
          <option value="" style={{ color: '#f8fafc', backgroundColor: '#0a101b' }}>{emptyLabel}</option>
          {options.map((option) => <option key={option.id} value={option.id} style={{ color: '#f8fafc', backgroundColor: '#0a101b' }}>{option.name}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
      </div>
    </label>
  )
}

function InputField({ label, value, onChange, multiline = false, rows = 4, placeholder = '' }) {
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
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/25"
        />
      )}
    </label>
  )
}

function ModeButton({ active, label, description, onClick }) {
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
  const openPicker = () => inputRef.current?.click()

  return (
    <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-display font-700 text-white">{label}</p>
        <div className="flex gap-2">
          <button type="button" onClick={openPicker} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/70 transition hover:text-white">
            <Upload className="h-3.5 w-3.5" />
            Importer
          </button>
          <button type="button" onClick={onClear} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/70 transition hover:text-white">
            <X className="h-3.5 w-3.5" />
            Retirer
          </button>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void onUpload(event.target.files?.[0] || null)
          event.target.value = ''
        }}
      />
      <div className="mt-4 flex items-center gap-4">
        <button
          type="button"
          onClick={openPicker}
          className="group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
        >
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]" />
          ) : (
            <ImagePlus className="h-5 w-5 text-white/25" />
          )}
        </button>
        <input
          value={value || ''}
          onChange={(event) => onValue(event.target.value)}
          placeholder="URL image ou upload direct"
          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/25"
        />
      </div>
    </div>
  )
}

export default function CaptchaPage() {
  const { selectedGuildId } = useGuildStore()
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [stats, setStats] = useState({})
  const [channels, setChannels] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const thumbnailRef = useRef(null)
  const imageRef = useRef(null)
  const autosaveBlockedFingerprintRef = useRef('')
  const hasUserEditedRef = useRef(false)

  const textChannels = useMemo(() => sortChannels(channels.filter(isTextChannel)), [channels])
  const visibleRoles = useMemo(() => sortRoles(roles), [roles])
  const normalizedConfig = config ? normalizeConfig(config) : null
  const normalizedDraft = draft ? normalizeConfig(draft) : null
  const configFingerprint = useMemo(() => normalizedConfig ? JSON.stringify(buildCaptchaSavePayload(normalizedConfig)) : '', [normalizedConfig])
  const draftFingerprint = useMemo(() => normalizedDraft ? JSON.stringify(buildCaptchaSavePayload(normalizedDraft)) : '', [normalizedDraft])
  const draftDirty = configFingerprint !== draftFingerprint
  const enabledChallenges = (normalizedDraft?.challenge_types || []).filter((item) => item.enabled)
  const selectedRoles = useMemo(() => new Set(normalizedDraft?.verified_role_ids || []), [normalizedDraft])

  const applyOverview = (payload = {}, preserveDraft = false) => {
    const nextConfig = normalizeConfig(payload.config || {})
    setConfig(nextConfig)
    setStats(payload.stats || {})
    if (!preserveDraft) {
      setDraft(clone(nextConfig))
      autosaveBlockedFingerprintRef.current = ''
      hasUserEditedRef.current = false
    }
  }

  const loadAll = async (showToast = false, preserveDraft = false) => {
    if (!selectedGuildId) return
    setLoading(true)
    try {
      const [overviewResponse, channelsResponse, rolesResponse] = await Promise.all([
        captchaAPI.get(selectedGuildId),
        botAPI.channels(selectedGuildId),
        botAPI.roles(selectedGuildId),
      ])
      applyOverview(overviewResponse.data, preserveDraft)
      setChannels(Array.isArray(channelsResponse.data?.channels) ? channelsResponse.data.channels : [])
      setRoles(Array.isArray(rolesResponse.data?.roles) ? rolesResponse.data.roles : [])
      setLoadError('')
      if (showToast) toast.success('Configuration CAPTCHA rechargée')
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
      setStats({})
      setChannels([])
      setRoles([])
      setLoadError('')
      setLoading(false)
      return
    }

    const storedDraft = readStoredDraft(selectedGuildId)
    if (storedDraft) {
      setDraft(normalizeConfig(buildCaptchaSavePayload(storedDraft)))
    }
    void loadAll(false, !!storedDraft)
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return undefined
    const unsubscribe = wsService.on('captcha:updated', (payload = {}) => {
      if (String(payload.guildId || '') !== String(selectedGuildId)) return
      applyOverview(payload, draftDirty)
      setLoadError('')
    })
    return () => unsubscribe()
  }, [selectedGuildId, draftDirty])

  useEffect(() => {
    if (!selectedGuildId) return undefined
    const timer = window.setInterval(() => {
      void captchaAPI.get(selectedGuildId).then((response) => {
        applyOverview(response.data, draftDirty)
        setLoadError('')
      }).catch(() => {})
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [selectedGuildId, draftDirty])

  useEffect(() => {
    if (!selectedGuildId || !normalizedDraft) return
    if (!draftDirty) {
      clearStoredDraft(selectedGuildId)
      return
    }
    writeStoredDraft(selectedGuildId, buildCaptchaSavePayload(normalizedDraft))
  }, [selectedGuildId, normalizedDraft, draftDirty])

  useEffect(() => {
    if (!selectedGuildId || !normalizedDraft || !draftDirty || saving || publishing || !hasUserEditedRef.current) return undefined
    if (autosaveBlockedFingerprintRef.current && autosaveBlockedFingerprintRef.current === draftFingerprint) return undefined
    const timer = window.setTimeout(() => {
      void saveConfig({ silent: true, throwOnError: false, mode: 'autosave' })
    }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [selectedGuildId, normalizedDraft, draftDirty, draftFingerprint, saving, publishing])

  const updateDraft = (patch) => {
    hasUserEditedRef.current = true
    autosaveBlockedFingerprintRef.current = ''
    setLoadError('')
    setDraft((current) => normalizeConfig({ ...(current || {}), ...patch }))
  }

  const toggleChallengeType = (key) => {
    hasUserEditedRef.current = true
    autosaveBlockedFingerprintRef.current = ''
    setLoadError('')
    setDraft((current) => {
      const source = normalizeConfig(current || {})
      return {
        ...source,
        challenge_types: source.challenge_types.map((item) => item.key === key ? { ...item, enabled: !item.enabled } : item),
      }
    })
  }

  const toggleRole = (roleId) => {
    hasUserEditedRef.current = true
    autosaveBlockedFingerprintRef.current = ''
    setLoadError('')
    setDraft((current) => {
      const source = normalizeConfig(current || {})
      const nextRoles = new Set(source.verified_role_ids || [])
      if (nextRoles.has(roleId)) nextRoles.delete(roleId)
      else nextRoles.add(roleId)
      return {
        ...source,
        verified_role_ids: [...nextRoles],
      }
    })
  }

  const saveConfig = async ({ silent = false, throwOnError = true, mode = 'manual' } = {}) => {
    if (!selectedGuildId || !normalizedDraft) return
    setSaving(true)
    try {
      const payload = await buildCaptchaSavePayloadForRequest(normalizedDraft)
      if (JSON.stringify(payload) !== draftFingerprint) {
        setDraft(normalizeConfig(payload))
      }
      const response = await captchaAPI.save(selectedGuildId, payload)
      applyOverview(response.data, false)
      setLoadError('')
      autosaveBlockedFingerprintRef.current = ''
      hasUserEditedRef.current = false
      if (!silent) toast.success('Configuration CAPTCHA sauvegardée')
    } catch (error) {
      const message = getErrorMessage(error)
      setLoadError(message)
      if (mode === 'autosave') autosaveBlockedFingerprintRef.current = draftFingerprint
      if (!silent) toast.error(message)
      if (throwOnError) throw error
    } finally {
      setSaving(false)
    }
  }

  const publishPanel = async () => {
    if (!selectedGuildId || !normalizedDraft) return
    setPublishing(true)
    try {
      if (draftDirty) await saveConfig({ silent: true })
      const response = await captchaAPI.publish(selectedGuildId)
      applyOverview(response.data, false)
      setLoadError('')
      toast.success(response.data?.panel?.channelName ? `Panel CAPTCHA publié dans #${response.data.panel.channelName}` : 'Panel CAPTCHA publié')
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
      toast.success('Image chargée')
    } catch (error) {
      toast.error(error?.message || 'Chargement impossible')
    }
  }

  if (!selectedGuildId) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-5 pt-20 sm:p-6 sm:pt-24">
        <div className="glass-card p-10 text-center">
          <Shield className="mx-auto mb-4 h-12 w-12 text-white/10" />
          <p className="font-display text-xl font-700 text-white">Choisis d&apos;abord un serveur</p>
          <p className="mt-2 text-white/40">Le module CAPTCHA se configure serveur par serveur.</p>
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
      <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(16,24,40,0.94),rgba(18,16,34,0.98))] shadow-[0_30px_90px_rgba(2,8,23,0.45)]">
        <div className="pointer-events-none absolute -left-20 top-0 h-64 w-64 rounded-full bg-neon-cyan/10 blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-10 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.22em] text-cyan-200">
                <Fingerprint className="h-3.5 w-3.5" />
                Captcha
              </div>
              <h1 className="font-display text-3xl font-700 text-white sm:text-[2.5rem]">CAPTCHA</h1>
              <p className="max-w-3xl text-sm text-white/55 sm:text-base">Choisis le salon, active les méthodes utiles, définis les rôles validés et publie un vrai panel Discord.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => { setRefreshing(true); void loadAll(true) }} disabled={loading || refreshing} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Recharger
              </button>
              <button type="button" onClick={() => { void saveConfig() }} disabled={!normalizedDraft || saving || publishing} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/12 px-4 py-3 text-sm text-cyan-200 transition hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-60">
                <Save className="h-4 w-4" />
                {saving ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
              <button type="button" onClick={() => { void publishPanel() }} disabled={!normalizedDraft || saving || publishing} className="inline-flex items-center gap-2 rounded-2xl border border-violet-400/20 bg-violet-500/12 px-4 py-3 text-sm text-violet-200 transition hover:bg-violet-500/18 disabled:cursor-not-allowed disabled:opacity-60">
                <Send className="h-4 w-4" />
                {publishing ? 'Publication...' : 'Publier le panel'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className={`rounded-full border px-3 py-1.5 text-xs font-mono ${normalizedDraft?.enabled ? 'border-emerald-400/20 bg-emerald-500/12 text-emerald-200' : 'border-white/10 bg-white/[0.04] text-white/55'}`}>
              {normalizedDraft?.enabled ? 'Module actif' : 'Module désactivé'}
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/60">
              {enabledChallenges.length} méthode{enabledChallenges.length > 1 ? 's' : ''} active{enabledChallenges.length > 1 ? 's' : ''}
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/60">
              {selectedRoles.size} rôle{selectedRoles.size > 1 ? 's' : ''} vérifié{selectedRoles.size > 1 ? 's' : ''}
            </div>
            <div className={`rounded-full border px-3 py-1.5 text-xs font-mono ${stats?.published ? 'border-cyan-400/20 bg-cyan-500/12 text-cyan-200' : 'border-white/10 bg-white/[0.04] text-white/55'}`}>
              {stats?.published ? 'Panel publié' : 'Panel non publié'}
            </div>
          </div>
        </div>
      </section>

      {loadError && <div className="rounded-[28px] border border-red-400/20 bg-red-500/10 px-5 py-4 text-sm text-red-200">{loadError}</div>}

      {loading && !normalizedDraft ? <div className="glass-card p-10 text-center text-white/60">Chargement...</div> : normalizedDraft ? (
        <section className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
          <div className="space-y-6">
            <div className="glass-card border border-white/[0.08] p-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl font-700 text-white">Panel</h2>
                  <p className="mt-1 text-sm text-white/45">Le minimum utile pour publier une vérification claire, propre et rapide.</p>
                </div>
                <label className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/80">
                  <input type="checkbox" checked={Boolean(normalizedDraft.enabled)} onChange={(event) => updateDraft({ enabled: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
                  Activer
                </label>
              </div>

              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ModeButton active={normalizedDraft.channel_mode === 'existing'} label="Salon existant" description="Tu sélectionnes un salon texte déjà présent." onClick={() => updateDraft({ channel_mode: 'existing' })} />
                  <ModeButton active={normalizedDraft.channel_mode === 'create'} label="Créer automatiquement" description="Le salon sera créé à la publication avec le nom choisi." onClick={() => updateDraft({ channel_mode: 'create' })} />
                </div>

                {normalizedDraft.channel_mode === 'create' ? (
                  <InputField label="Nom du salon à créer" value={normalizedDraft.panel_channel_name} onChange={(value) => updateDraft({ panel_channel_name: value })} placeholder="verification" />
                ) : (
                  <SelectField label="Salon du panel" value={normalizedDraft.panel_channel_id} onChange={(value) => updateDraft({ panel_channel_id: value })} options={textChannels} emptyLabel="Aucun salon" />
                )}

                <InputField label="Titre du panel" value={normalizedDraft.panel_title} onChange={(value) => updateDraft({ panel_title: value })} />
                <InputField label="Message du panel" value={normalizedDraft.panel_description} onChange={(value) => updateDraft({ panel_description: value })} multiline rows={5} />

                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">Couleur du panel</span>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <input type="color" value={normalizedDraft.panel_color || '#06b6d4'} onChange={(event) => updateDraft({ panel_color: event.target.value })} className="h-11 w-14 cursor-pointer rounded-xl border border-white/10 bg-transparent" />
                    <div>
                      <div className="text-sm text-white">Couleur active</div>
                      <div className="text-xs font-mono uppercase tracking-[0.18em] text-white/35">{normalizedDraft.panel_color}</div>
                    </div>
                  </div>
                </label>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <AssetBox label="Miniature" value={normalizedDraft.panel_thumbnail_url} onValue={(value) => updateDraft({ panel_thumbnail_url: value })} onUpload={(file) => uploadAsset('panel_thumbnail_url', file)} onClear={() => updateDraft({ panel_thumbnail_url: '' })} inputRef={thumbnailRef} />
                <AssetBox label="Bannière" value={normalizedDraft.panel_image_url} onValue={(value) => updateDraft({ panel_image_url: value })} onUpload={(file) => uploadAsset('panel_image_url', file)} onClear={() => updateDraft({ panel_image_url: '' })} inputRef={imageRef} />
              </div>
            </div>

            <div className="glass-card border border-white/[0.08] p-5">
              <div className="mb-5">
                <h2 className="font-display text-2xl font-700 text-white">Méthodes CAPTCHA</h2>
                <p className="mt-1 text-sm text-white/45">Coche les méthodes autorisées. Discord lancera automatiquement l'une d'elles avec un seul bouton.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {normalizedDraft.challenge_types.map((item) => {
                  const active = Boolean(item.enabled)
                  return (
                    <button key={item.key} type="button" onClick={() => toggleChallengeType(item.key)} className={`rounded-[24px] border p-4 text-left transition-all ${active ? 'border-cyan-400/25 bg-cyan-500/[0.08]' : 'border-white/10 bg-black/20 hover:bg-white/[0.04]'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-display text-lg font-700 text-white">{item.label}</div>
                          <div className="mt-1 text-sm text-white/50">{item.description}</div>
                        </div>
                        <div className={`mt-1 rounded-full border px-2.5 py-1 text-[11px] font-mono ${active ? 'border-emerald-400/20 bg-emerald-500/12 text-emerald-300' : 'border-white/10 bg-white/[0.04] text-white/45'}`}>
                          {active ? 'Actif' : 'Off'}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="glass-card border border-white/[0.08] p-5">
              <div className="mb-5">
                <h2 className="font-display text-2xl font-700 text-white">Rôles validés</h2>
                <p className="mt-1 text-sm text-white/45">Les rôles cochés seront attribués automatiquement après une vérification réussie.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {visibleRoles.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-white/45">Aucun rôle disponible.</div>
                ) : visibleRoles.map((role) => {
                  const active = selectedRoles.has(role.id)
                  return (
                    <button key={role.id} type="button" onClick={() => toggleRole(role.id)} className={`rounded-full border px-3 py-2 text-xs font-mono transition-all ${active ? 'border-cyan-400/30 bg-cyan-500/14 text-cyan-200' : 'border-white/10 bg-white/[0.04] text-white/50 hover:text-white'}`}>
                      @{role.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="glass-card border border-white/[0.08] p-5">
              <div className="mb-5">
                <h2 className="font-display text-2xl font-700 text-white">Réponses & logs</h2>
                <p className="mt-1 text-sm text-white/45">Messages envoyés au membre et salon facultatif pour suivre les validations.</p>
              </div>
              <div className="grid gap-4">
                <SelectField label="Salon de logs" value={normalizedDraft.log_channel_id} onChange={(value) => updateDraft({ log_channel_id: value })} options={textChannels} emptyLabel="Aucun salon" />
                <InputField label="Message de succès" value={normalizedDraft.success_message} onChange={(value) => updateDraft({ success_message: value })} />
                <InputField label="Message d'erreur" value={normalizedDraft.failure_message} onChange={(value) => updateDraft({ failure_message: value })} />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="glass-card border border-white/[0.08] p-5">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-200">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-700 text-white">Aperçu Discord</h2>
                  <p className="mt-1 text-sm text-white/45">Le rendu visuel du panel avant publication.</p>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-[#0a101b] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="rounded-[22px] border border-white/8 bg-[#101827] p-4">
                  <div className="overflow-hidden rounded-[20px] border border-white/10 bg-[#111827]">
                    {normalizedDraft.panel_image_url ? (
                      <img src={normalizedDraft.panel_image_url} alt="" className="h-36 w-full object-cover" />
                    ) : (
                      <div className="h-36 w-full bg-[linear-gradient(135deg,rgba(6,182,212,0.24),rgba(124,58,237,0.22))]" />
                    )}
                    <div className="border-t border-white/8 p-4">
                      <div className="flex items-start gap-4">
                        {normalizedDraft.panel_thumbnail_url ? (
                          <img src={normalizedDraft.panel_thumbnail_url} alt="" className="h-14 w-14 rounded-2xl border border-white/10 object-cover" />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-black/30 text-white/40">
                            <UserPlus className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-display text-lg font-700 text-white">{normalizedDraft.panel_title || DEFAULT_CONFIG.panel_title}</div>
                          <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/70">{normalizedDraft.panel_description || DEFAULT_CONFIG.panel_description}</div>
                          <div className="mt-4 space-y-2">
                            {enabledChallenges.length > 0 ? enabledChallenges.map((item) => (
                              <div key={item.key} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
                                <div className="font-display text-sm font-700 text-white">{item.label}</div>
                                <div className="mt-1 text-xs text-white/55">{item.description}</div>
                              </div>
                            )) : (
                              <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/45">
                                Active au moins une méthode pour publier le panel.
                              </div>
                            )}
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {(normalizedDraft.verified_role_ids || []).slice(0, 4).map((roleId) => {
                              const role = visibleRoles.find((item) => item.id === roleId)
                              return (
                                <div key={roleId} className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-mono text-cyan-200">
                                  @{role?.name || roleId}
                                </div>
                              )
                            })}
                            {(normalizedDraft.verified_role_ids || []).length === 0 && (
                              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-white/45">
                                Aucun rôle vérifié
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/14 px-4 py-3 text-center text-sm font-medium text-cyan-100">
                    Lancer la vérification
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-card border border-white/[0.08] p-5">
              <div className="mb-4">
                <h2 className="font-display text-2xl font-700 text-white">Résumé rapide</h2>
                <p className="mt-1 text-sm text-white/45">Ce qui va réellement se passer une fois le panel publié.</p>
              </div>
              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
                  {normalizedDraft.channel_mode === 'create'
                    ? `Le salon #${normalizedDraft.panel_channel_name || 'verification'} sera créé automatiquement au moment de la publication.`
                    : `Le panel sera publié dans ${normalizedDraft.panel_channel_id ? 'le salon choisi' : 'aucun salon pour le moment'}.`}
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
                  {selectedRoles.size > 0
                    ? `${selectedRoles.size} rôle${selectedRoles.size > 1 ? 's' : ''} seront attribué${selectedRoles.size > 1 ? 's' : ''} après validation.`
                    : 'Aucun rôle n’est encore sélectionné.'}
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
                  {enabledChallenges.length > 0
                    ? `${enabledChallenges.length} méthode${enabledChallenges.length > 1 ? 's' : ''} CAPTCHA sera${enabledChallenges.length > 1 ? 'ont' : ''} pilotée${enabledChallenges.length > 1 ? 's' : ''} automatiquement depuis le site.`
                    : 'Active au moins une méthode CAPTCHA avant de publier.'}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
