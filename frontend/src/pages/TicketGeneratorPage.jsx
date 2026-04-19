import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowRight, ChevronDown, ImagePlus, LifeBuoy, RefreshCw, Save, Send, Ticket, Upload, X } from 'lucide-react'
import { botAPI, ticketGeneratorAPI } from '../services/api'
import { wsService } from '../services/websocket'
import { useGuildStore } from '../stores'
import SearchableSelect from '../components/ui/SearchableSelect'

const TEXT_CHANNEL_TYPES = new Set([0, 5, 11, 12, 15])
const AUTO_REFRESH_MS = 12000
const AUTOSAVE_DELAY_MS = 1500
const LOCAL_DRAFT_PREFIX = 'ticket-generator-draft:'
const MAX_TICKET_ASSET_LENGTH = 320000
const MAX_TICKET_REQUEST_LENGTH = 850000
const LEGACY_DUPLICATE_FOOTER = 'Une seule demande active par catégorie si la protection anti-doublon est activée.'
const LEGACY_PANEL_DESCRIPTION = 'Choisis le bon motif dans le menu ci-dessous pour ouvrir un salon privé avec le staff adapté.'
const DEFAULT_PANEL_DESCRIPTION = 'Crée ton ticket depuis le menu ci-dessous.'
const DEFAULT_MENU_PLACEHOLDER = 'Sélectionne la demande à ouvrir'
const DEFAULT_PARTNERSHIP_TEMPLATE = 'partenaire-{number}'

const PRESETS = [
  {
    key: 'contact_staff',
    label: 'Contact staff',
    emoji: '🛟',
    description: "Parler directement avec l'équipe du serveur",
    question_label: 'Pourquoi veux-tu contacter le staff ?',
    question_placeholder: 'Explique clairement ta demande...',
    intro_message: 'Bonjour {mention}, ta demande a bien été ouverte.\n\nCatégorie : {label}\nRaison : {reason}',
    ticket_name_template: 'staff-{number}',
    ticket_topic_template: 'Ticket #{number} | {label} | {user_tag}',
    enabled: true,
  },
  {
    key: 'report',
    label: 'Report',
    emoji: '🚨',
    description: 'Signaler un membre ou un incident',
    question_label: 'Que veux-tu signaler ?',
    question_placeholder: 'Donne le plus de détails possible...',
    intro_message: 'Signalement reçu pour {mention}.\n\nRaison : {reason}',
    ticket_name_template: 'report-{number}',
    ticket_topic_template: 'Report #{number} | {user_tag}',
    enabled: true,
  },
  {
    key: 'appeal',
    label: 'Appel sanction',
    emoji: '⚖️',
    description: 'Contester une sanction ou demander une révision',
    question_label: 'Quelle sanction veux-tu contester ?',
    question_placeholder: 'Explique la situation et ajoute le contexte utile...',
    intro_message: 'Appel de sanction reçu pour {mention}.\n\nContexte : {reason}',
    ticket_name_template: 'appeal-{number}',
    ticket_topic_template: 'Appel #{number} | {user_tag}',
    enabled: true,
  },
  {
    key: 'partnership',
    label: 'Partenariat',
    emoji: '🤝',
    description: 'Proposer un partenariat ou une collaboration',
    question_label: 'Parle-nous de ton projet',
    question_placeholder: 'Serveur, objectifs, lien, idée...',
    intro_message: 'Demande de partenariat ouverte pour {mention}.\n\nDétails : {reason}',
    ticket_name_template: DEFAULT_PARTNERSHIP_TEMPLATE,
    ticket_topic_template: 'Partenariat #{number} | {user_tag}',
    enabled: true,
  },
  {
    key: 'purchase',
    label: 'Achat',
    emoji: '🛒',
    description: 'Question commerciale ou achat de service',
    question_label: 'De quoi as-tu besoin ?',
    question_placeholder: 'Produit, offre, budget, informations...',
    intro_message: 'Demande commerciale ouverte pour {mention}.\n\nBesoin : {reason}',
    ticket_name_template: 'purchase-{number}',
    ticket_topic_template: 'Achat #{number} | {user_tag}',
    enabled: true,
  },
  {
    key: 'recruitment',
    label: 'Recrutement',
    emoji: '🧩',
    description: "Candidater ou contacter l'équipe recrutement",
    question_label: "Pourquoi souhaites-tu rejoindre l'équipe ?",
    question_placeholder: 'Expérience, disponibilités, motivations...',
    intro_message: 'Candidature reçue pour {mention}.\n\nProfil : {reason}',
    ticket_name_template: 'recruit-{number}',
    ticket_topic_template: 'Recrutement #{number} | {user_tag}',
    enabled: false,
  },
]

const PRESET_KEYS = new Set(PRESETS.map((item) => item.key))

const DEFAULT_CONFIG = {
  enabled: true,
  panel_channel_id: '',
  panel_message_id: '',
  transcript_channel_id: '',
  panel_title: 'Support & tickets',
  panel_description: DEFAULT_PANEL_DESCRIPTION,
  panel_footer: '',
  menu_placeholder: DEFAULT_MENU_PLACEHOLDER,
  panel_color: '#7c3aed',
  panel_thumbnail_url: '',
  panel_image_url: '',
  default_category_id: '',
  ticket_name_template: 'ticket-{number}',
  ticket_topic_template: 'Ticket #{number} | {label} | {user_tag}',
  intro_message: 'Bonjour {mention}, ton ticket est bien créé.\n\nCatégorie : {label}\nRaison : {reason}',
  claim_message: 'Ticket pris en charge par {claimer}.',
  close_message: 'Ticket fermé par {closer}.',
  auto_ping_support: true,
  allow_user_close: true,
  prevent_duplicates: true,
  options: PRESETS.map((item) => ({ ...item, role_ids: [], ping_roles: true })),
}

const getErrorMessage = (error) => {
  const responseData = error?.response?.data
  if (responseData?.error === 'Validation failed' && Array.isArray(responseData.errors) && responseData.errors.length > 0) {
    const first = responseData.errors[0]
    return `Validation failed: ${first.field || 'champ'} ${first.message || ''}`.trim()
  }
  return responseData?.error || error?.message || 'Erreur inattendue'
}
const isTextChannel = (channel) => TEXT_CHANNEL_TYPES.has(Number(channel?.type))
const sortChannels = (channels) => [...channels].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
const sortRoles = (roles) => [...roles].filter((role) => role?.name !== '@everyone').sort((a, b) => Number(b?.position || 0) - Number(a?.position || 0))
const clone = (value) => JSON.parse(JSON.stringify(value || {}))

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
    // ignore storage errors
  }
}

function clearStoredDraft(guildId) {
  try {
    window.localStorage.removeItem(getDraftStorageKey(guildId))
  } catch {
    // ignore storage errors
  }
}

function normalizeLegacyPanelFooter(value) {
  const normalized = String(value || '').trim()
  return normalized === LEGACY_DUPLICATE_FOOTER ? '' : normalized
}

function normalizeLegacyPanelDescription(value) {
  const normalized = String(value || '').trim()
  return !normalized || normalized === LEGACY_PANEL_DESCRIPTION ? DEFAULT_PANEL_DESCRIPTION : normalized
}

function normalizeLegacyTicketTemplate(optionKey, value, fallback = '') {
  const normalized = String(value || fallback || '').trim()
  if (String(optionKey || '').trim() === 'partnership' && normalized === 'partner-{number}') {
    return DEFAULT_PARTNERSHIP_TEMPLATE
  }
  return normalized
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
  if (rawDataUrl.length <= MAX_TICKET_ASSET_LENGTH) return rawDataUrl
  if (String(file.type || '').toLowerCase() === 'image/gif') {
    throw new Error('GIF trop lourd. Choisis une image plus légère.')
  }

  const image = await loadImageElement(rawDataUrl)
  let width = image.naturalWidth || image.width
  let height = image.naturalHeight || image.height
  let scale = Math.min(1, 1600 / Math.max(width, height))
  let quality = 0.88
  let output = rawDataUrl

  while (output.length > MAX_TICKET_ASSET_LENGTH && scale > 0.16) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) break
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    output = canvas.toDataURL('image/webp', quality)
    quality = Math.max(0.28, quality - 0.1)
    scale *= 0.82
  }

  if (output.length > MAX_TICKET_ASSET_LENGTH) {
    throw new Error('Image trop lourde. Réduis sa taille avant envoi.')
  }

  return output
}

async function optimizeImageAssetValue(value, maxLength = MAX_TICKET_ASSET_LENGTH) {
  const raw = String(value || '').trim()
  if (!raw || /^https?:\/\//i.test(raw)) return raw
  if (!/^data:image\//i.test(raw)) return raw
  if (raw.length <= maxLength) return raw

  const image = await loadImageElement(raw)
  let scale = Math.min(1, 1500 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height))
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
    throw new Error('Image trop lourde pour la sauvegarde du panel.')
  }

  return output
}

function mergeOptions(options = []) {
  const map = new Map((Array.isArray(options) ? options : []).map((item) => [String(item?.key || '').trim(), item]).filter(([key]) => key))
  return PRESETS.map((preset) => {
    const current = map.get(preset.key) || {}
    const roleIds = Array.isArray(current.role_ids) ? current.role_ids.filter(Boolean) : []
    return {
      ...preset,
      ...current,
      key: preset.key,
      label: String(current.label || preset.label),
      description: String(current.description || preset.description),
      emoji: String(current.emoji || preset.emoji || ''),
      question_label: String(current.question_label || preset.question_label),
      question_placeholder: String(current.question_placeholder || preset.question_placeholder),
      modal_title: String(current.modal_title || current.label || preset.label),
      intro_message: String(current.intro_message || preset.intro_message),
      ticket_name_template: normalizeLegacyTicketTemplate(preset.key, current.ticket_name_template, preset.ticket_name_template),
      ticket_topic_template: String(current.ticket_topic_template || preset.ticket_topic_template),
      role_ids: roleIds,
      enabled: typeof current.enabled === 'boolean' ? current.enabled : preset.enabled,
      ping_roles: roleIds.length > 0 ? true : (typeof current.ping_roles === 'boolean' ? current.ping_roles : true),
    }
  })
}

const normalizeConfig = (value = {}) => ({ ...DEFAULT_CONFIG, ...(value || {}), options: mergeOptions(value?.options) })

function buildTicketSavePayload(value = {}) {
  const source = normalizeConfig(value)
  const optionsByKey = new Map((source.options || []).map((option) => [option.key, option]))

  return {
    enabled: Boolean(source.enabled),
    panel_channel_id: String(source.panel_channel_id || '').trim(),
    panel_message_id: String(source.panel_message_id || '').trim(),
    transcript_channel_id: String(source.transcript_channel_id || '').trim(),
    panel_title: String(source.panel_title || DEFAULT_CONFIG.panel_title).trim(),
    panel_description: normalizeLegacyPanelDescription(source.panel_description),
    panel_footer: normalizeLegacyPanelFooter(String(source.panel_footer || DEFAULT_CONFIG.panel_footer).trim()),
    menu_placeholder: String(source.menu_placeholder || DEFAULT_CONFIG.menu_placeholder).trim(),
    panel_color: String(source.panel_color || DEFAULT_CONFIG.panel_color).trim(),
    panel_thumbnail_url: String(source.panel_thumbnail_url || '').trim(),
    panel_image_url: String(source.panel_image_url || '').trim(),
    default_category_id: String(source.default_category_id || '').trim(),
    ticket_name_template: String(source.ticket_name_template || DEFAULT_CONFIG.ticket_name_template).trim(),
    ticket_topic_template: String(source.ticket_topic_template || DEFAULT_CONFIG.ticket_topic_template).trim(),
    intro_message: String(source.intro_message || DEFAULT_CONFIG.intro_message).trim(),
    claim_message: String(source.claim_message || DEFAULT_CONFIG.claim_message).trim(),
    close_message: String(source.close_message || DEFAULT_CONFIG.close_message).trim(),
    auto_ping_support: Boolean(source.auto_ping_support),
    allow_user_close: Boolean(source.allow_user_close),
    prevent_duplicates: Boolean(source.prevent_duplicates),
    options: PRESETS.map((preset) => {
      const current = optionsByKey.get(preset.key) || {}
      return {
        key: preset.key,
        label: String(current.label || preset.label).trim(),
        description: String(current.description || preset.description || '').trim(),
        emoji: String(current.emoji || preset.emoji || '').trim(),
        category_id: String(current.category_id || '').trim(),
        role_ids: [...new Set((Array.isArray(current.role_ids) ? current.role_ids : []).map((roleId) => String(roleId || '').trim()).filter(Boolean))],
        ping_roles: Boolean(current.ping_roles),
        question_label: String(current.question_label || preset.question_label).trim(),
        question_placeholder: String(current.question_placeholder || preset.question_placeholder || '').trim(),
        modal_title: String(current.modal_title || current.label || preset.label).trim(),
        intro_message: String(current.intro_message || preset.intro_message).trim(),
        ticket_name_template: normalizeLegacyTicketTemplate(preset.key, current.ticket_name_template, preset.ticket_name_template),
        ticket_topic_template: String(current.ticket_topic_template || preset.ticket_topic_template).trim(),
        enabled: Boolean(current.enabled),
      }
    }),
  }
}

async function buildTicketSavePayloadForRequest(value = {}) {
  const payload = buildTicketSavePayload(value)
  payload.panel_thumbnail_url = await optimizeImageAssetValue(payload.panel_thumbnail_url, 220000)
  payload.panel_image_url = await optimizeImageAssetValue(payload.panel_image_url, 420000)

  let serialized = JSON.stringify(payload)
  if (serialized.length > MAX_TICKET_REQUEST_LENGTH && payload.panel_image_url.startsWith('data:image/')) {
    payload.panel_image_url = await optimizeImageAssetValue(payload.panel_image_url, 260000)
    serialized = JSON.stringify(payload)
  }
  if (serialized.length > MAX_TICKET_REQUEST_LENGTH && payload.panel_thumbnail_url.startsWith('data:image/')) {
    payload.panel_thumbnail_url = await optimizeImageAssetValue(payload.panel_thumbnail_url, 140000)
    serialized = JSON.stringify(payload)
  }
  if (serialized.length > MAX_TICKET_REQUEST_LENGTH) {
    throw new Error('Le panel est trop lourd. Réduis la miniature ou la bannière.')
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
        onChange={(option) => onChange(option.id)}
        options={options}
        placeholder={emptyLabel}
        emptyLabel={emptyLabel}
        emptySearchLabel="Aucun resultat"
        countSuffix="elements"
        getOptionKey={(option) => option.id}
        getOptionLabel={(option) => option.name}
      />
    </label>
  )
}

function InputField({ label, value, onChange, multiline = false, rows = 4, placeholder = '' }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      {multiline ? (
        <textarea rows={rows} value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/25" />
      ) : (
        <input value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/25" />
      )}
    </label>
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

export default function TicketGeneratorPage() {
  const { selectedGuildId } = useGuildStore()
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
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
  const configFingerprint = useMemo(() => normalizedConfig ? JSON.stringify(buildTicketSavePayload(normalizedConfig)) : '', [normalizedConfig])
  const draftFingerprint = useMemo(() => normalizedDraft ? JSON.stringify(buildTicketSavePayload(normalizedDraft)) : '', [normalizedDraft])
  const draftDirty = configFingerprint !== draftFingerprint
  const activeOptions = (normalizedDraft?.options || []).filter((item) => item.enabled)
  const selectedRoleIds = useMemo(() => {
    const all = new Set()
    for (const option of normalizedDraft?.options || []) {
      for (const roleId of option.role_ids || []) all.add(roleId)
    }
    return [...all]
  }, [normalizedDraft])

  const applyOverview = (payload = {}, preserveDraft = false) => {
    const nextConfig = normalizeConfig(payload.config || {})
    setConfig(nextConfig)
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
        ticketGeneratorAPI.get(selectedGuildId),
        botAPI.channels(selectedGuildId),
        botAPI.roles(selectedGuildId),
      ])
      applyOverview(overviewResponse.data, preserveDraft)
      setChannels(Array.isArray(channelsResponse.data?.channels) ? channelsResponse.data.channels : [])
      setRoles(Array.isArray(rolesResponse.data?.roles) ? rolesResponse.data.roles : [])
      setLoadError('')
      if (showToast) toast.success('Configuration tickets rechargée')
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
      setChannels([])
      setRoles([])
      setLoadError('')
      setLoading(false)
      return
    }
    const storedDraft = readStoredDraft(selectedGuildId)
    if (storedDraft) {
      setDraft(normalizeConfig(buildTicketSavePayload(storedDraft)))
    }
    void loadAll(false, !!storedDraft)
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return undefined
    const unsubscribe = wsService.on('tickets:updated', (payload = {}) => {
      if (String(payload.guildId || '') !== String(selectedGuildId)) return
      applyOverview(payload, draftDirty)
      setLoadError('')
    })
    return () => unsubscribe()
  }, [selectedGuildId, draftDirty])

  useEffect(() => {
    if (!selectedGuildId) return undefined
    const timer = window.setInterval(() => {
      void ticketGeneratorAPI.get(selectedGuildId).then((response) => {
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
    writeStoredDraft(selectedGuildId, buildTicketSavePayload(normalizedDraft))
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

  const toggleOption = (key) => {
    hasUserEditedRef.current = true
    autosaveBlockedFingerprintRef.current = ''
    setLoadError('')
    setDraft((current) => {
      const source = normalizeConfig(current || {})
      return {
        ...source,
        options: source.options.map((item) => item.key === key ? { ...item, enabled: !item.enabled } : item),
      }
    })
  }

  const toggleRole = (roleId) => {
    hasUserEditedRef.current = true
    autosaveBlockedFingerprintRef.current = ''
    setLoadError('')
    setDraft((current) => {
      const source = normalizeConfig(current || {})
      const nextRoleIds = new Set()
      source.options.forEach((item) => {
        ;(item.role_ids || []).forEach((currentRoleId) => nextRoleIds.add(currentRoleId))
      })
    if (nextRoleIds.has(roleId)) nextRoleIds.delete(roleId)
    else nextRoleIds.add(roleId)
    const mergedRoleIds = [...nextRoleIds]
      return {
        ...source,
        auto_ping_support: mergedRoleIds.length > 0,
        options: source.options.map((item) => ({
          ...item,
        role_ids: mergedRoleIds,
          ping_roles: mergedRoleIds.length > 0,
        })),
      }
    })
  }

  const saveConfig = async ({ silent = false, throwOnError = true, mode = 'manual' } = {}) => {
    if (!selectedGuildId || !normalizedDraft) return
    setSaving(true)
    try {
      const payload = await buildTicketSavePayloadForRequest(normalizedDraft)
      if (JSON.stringify(payload) !== draftFingerprint) {
        setDraft(normalizeConfig(payload))
      }
      const response = await ticketGeneratorAPI.save(selectedGuildId, payload)
      applyOverview(response.data, false)
      setLoadError('')
      autosaveBlockedFingerprintRef.current = ''
      hasUserEditedRef.current = false
      if (!silent) toast.success('Configuration tickets sauvegardée')
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
      const response = await ticketGeneratorAPI.publish(selectedGuildId)
      applyOverview(response.data, false)
      setLoadError('')
      toast.success('Panel tickets publié')
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
          <Ticket className="mx-auto mb-4 h-12 w-12 text-white/10" />
          <p className="font-display text-xl font-700 text-white">Choisis d'abord un serveur</p>
          <p className="mt-2 text-white/40">Le système tickets se configure serveur par serveur.</p>
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
                <LifeBuoy className="h-3.5 w-3.5" />
                Ticket generator
              </div>
              <h1 className="font-display text-3xl font-700 text-white sm:text-[2.5rem]">Tickets</h1>
              <p className="max-w-3xl text-sm text-white/55 sm:text-base">Choisis le salon, personnalise le panel, coche les types utiles et publie.</p>
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
                  <p className="mt-1 text-sm text-white/45">Le minimum utile pour publier un panel propre et facile à utiliser.</p>
                </div>
                <label className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/80">
                  <input type="checkbox" checked={Boolean(normalizedDraft.enabled)} onChange={(event) => updateDraft({ enabled: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
                  Activer
                </label>
              </div>

              <div className="grid gap-4">
                <SelectField label="Salon du panel" value={normalizedDraft.panel_channel_id} onChange={(value) => updateDraft({ panel_channel_id: value })} options={textChannels} emptyLabel="Aucun salon" />
                <SelectField label="Salon transcript" value={normalizedDraft.transcript_channel_id} onChange={(value) => updateDraft({ transcript_channel_id: value })} options={textChannels} emptyLabel="Aucun transcript" />
                <InputField label="Titre du panel" value={normalizedDraft.panel_title} onChange={(value) => updateDraft({ panel_title: value })} />
                <InputField label="Texte du menu" value={normalizedDraft.menu_placeholder} onChange={(value) => updateDraft({ menu_placeholder: value })} />
                <InputField label="Message du panel" value={normalizedDraft.panel_description} onChange={(value) => updateDraft({ panel_description: value })} multiline rows={5} />
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">Couleur du panel</span>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <input type="color" value={normalizedDraft.panel_color || '#7c3aed'} onChange={(event) => updateDraft({ panel_color: event.target.value })} className="h-11 w-14 cursor-pointer rounded-xl border border-white/10 bg-transparent" />
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
                <h2 className="font-display text-2xl font-700 text-white">Types de tickets</h2>
                <p className="mt-1 text-sm text-white/45">Coche simplement les types que tu veux afficher dans le menu.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {normalizedDraft.options.map((option) => {
                  const active = Boolean(option.enabled)
                  return (
                    <button key={option.key} type="button" onClick={() => toggleOption(option.key)} className={`rounded-[24px] border p-4 text-left transition-all ${active ? 'border-cyan-400/25 bg-cyan-500/[0.08]' : 'border-white/10 bg-black/20 hover:bg-white/[0.04]'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-display text-lg font-700 text-white">{option.label}</div>
                          <div className="mt-1 text-sm text-white/50">{option.description}</div>
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
                <h2 className="font-display text-2xl font-700 text-white">Rôles à notifier</h2>
                <p className="mt-1 text-sm text-white/45">Les rôles cochés seront ajoutés et pingés automatiquement dans tous les tickets.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {visibleRoles.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-white/45">Aucun rôle disponible.</div>
                ) : visibleRoles.map((role) => {
                  const active = selectedRoleIds.includes(role.id)
                  return (
                    <button key={role.id} type="button" onClick={() => toggleRole(role.id)} className={`rounded-full border px-3 py-2 text-xs font-mono transition-all ${active ? 'border-cyan-400/30 bg-cyan-500/14 text-cyan-200' : 'border-white/10 bg-white/[0.04] text-white/50 hover:text-white'}`}>
                      @{role.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="glass-card border border-white/[0.08] p-5">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl font-700 text-white">Aperçu Discord</h2>
                  <p className="mt-1 text-sm text-white/45">Ce que les membres verront avant d'ouvrir leur ticket.</p>
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/65">{activeOptions.length} types actifs</div>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-[#111827] p-4 shadow-[0_20px_40px_rgba(2,8,23,0.25)]">
                <div className="space-y-4 rounded-[24px] border border-white/10 bg-[#101826] p-4" style={{ boxShadow: `inset 3px 0 0 ${normalizedDraft.panel_color || '#7c3aed'}` }}>
                  <div className="flex items-start gap-3">
                    {normalizedDraft.panel_thumbnail_url ? <img src={normalizedDraft.panel_thumbnail_url} alt="" className="h-14 w-14 rounded-2xl border border-white/10 object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-white/25"><ImagePlus className="h-4 w-4" /></div>}
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/70">Centre support</div>
                      <div className="mt-1 text-lg font-display font-700 text-white">{normalizedDraft.panel_title}</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-white/65">{normalizedDraft.panel_description}</div>
                    </div>
                  </div>

                  {normalizedDraft.panel_image_url && <img src={normalizedDraft.panel_image_url} alt="" className="h-32 w-full rounded-2xl border border-white/10 object-cover" />}

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Ouverture</div>
                      <div className="mt-2 text-sm text-white/70">Menu déroulant interactif et salon privé créé automatiquement.</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Staff notifié</div>
                      <div className="mt-2 text-sm text-white/70">{selectedRoleIds.length > 0 ? `${selectedRoleIds.length} rôle(s) ping automatiquement` : 'Aucun rôle staff configuré'}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/35">{normalizedDraft.menu_placeholder}</div>
                    <div className="space-y-2">
                      {activeOptions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-sm text-white/35">Aucun type sélectionné.</div>
                      ) : activeOptions.map((option) => (
                        <div key={option.key} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white/70">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-white">
                              <span>{option.emoji || '🎫'}</span>
                              <span className="font-medium">{option.label}</span>
                            </div>
                            <div className="mt-1 text-xs text-white/40">{option.description}</div>
                          </div>
                          <div className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-white/45">Actif</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-card border border-white/[0.08] p-5">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Panel publié</div>
              <div className="mt-2 text-sm text-white/70">{normalizedDraft.panel_message_id ? `${normalizedDraft.panel_channel_id || '--'} / ${normalizedDraft.panel_message_id}` : 'Pas encore publié'}</div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
