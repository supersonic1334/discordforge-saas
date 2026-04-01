import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowRight, ChevronDown, ChevronUp, ImagePlus, LifeBuoy, RefreshCw, Save, Send, Sparkles, Ticket, Upload, Users, X } from 'lucide-react'
import { botAPI, ticketGeneratorAPI } from '../services/api'
import { wsService } from '../services/websocket'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'

const CATEGORY_CHANNEL_TYPE = 4
const TEXT_CHANNEL_TYPES = new Set([0, 5, 11, 12, 15])
const AUTO_REFRESH_MS = 12000

const PRESETS = [
  { key: 'contact_staff', label: 'Contact staff', description: 'Parler directement avec le staff', question_label: 'Pourquoi veux-tu contacter le staff ?', question_placeholder: 'Explique clairement ta demande...', intro_message: 'Bonjour {mention}, ta demande a bien ete ouverte.\n\nCategorie: {label}\nRaison: {reason}', ticket_name_template: 'staff-{number}', ticket_topic_template: 'Ticket #{number} | {label} | {user_tag}', enabled: true, ping_roles: true },
  { key: 'report', label: 'Report', description: 'Signaler un membre ou un incident', question_label: 'Que veux-tu signaler ?', question_placeholder: 'Donne le plus de details possible...', intro_message: 'Signalement recu pour {mention}.\n\nRaison: {reason}', ticket_name_template: 'report-{number}', ticket_topic_template: 'Report #{number} | {user_tag}', enabled: true, ping_roles: true },
  { key: 'appeal', label: 'Appel sanction', description: 'Demander une revision de sanction', question_label: 'Quelle sanction veux-tu contester ?', question_placeholder: 'Explique la sanction et pourquoi tu fais appel...', intro_message: 'Appel de sanction recu pour {mention}.\n\nContexte: {reason}', ticket_name_template: 'appeal-{number}', ticket_topic_template: 'Appel #{number} | {user_tag}', enabled: true, ping_roles: true },
  { key: 'partnership', label: 'Partenariat', description: 'Proposer un partenariat ou une collaboration', question_label: 'Parle-nous de ton partenariat', question_placeholder: 'Serveur, objectifs, lien, idee...', intro_message: 'Demande partenariat ouverte pour {mention}.\n\nDetails: {reason}', ticket_name_template: 'partner-{number}', ticket_topic_template: 'Partenariat #{number} | {user_tag}', enabled: true, ping_roles: false },
  { key: 'purchase', label: 'Achat', description: 'Question commerciale ou achat de service', question_label: 'De quoi as-tu besoin ?', question_placeholder: 'Produit, offre, budget, informations...', intro_message: 'Demande commerciale ouverte pour {mention}.\n\nBesoin: {reason}', ticket_name_template: 'purchase-{number}', ticket_topic_template: 'Achat #{number} | {user_tag}', enabled: true, ping_roles: false },
  { key: 'recruitment', label: 'Recrutement', description: 'Postuler ou contacter l equipe recrutement', question_label: 'Pourquoi souhaites-tu rejoindre l equipe ?', question_placeholder: 'Experience, disponibilites, motivations...', intro_message: 'Candidature recue pour {mention}.\n\nProfil: {reason}', ticket_name_template: 'recruit-{number}', ticket_topic_template: 'Recrutement #{number} | {user_tag}', enabled: false, ping_roles: false },
]

const PRESET_KEYS = new Set(PRESETS.map((item) => item.key))

const DEFAULT_CONFIG = {
  enabled: true,
  panel_channel_id: '',
  panel_message_id: '',
  panel_title: 'Support & tickets',
  panel_description: 'Choisis le bon type de ticket dans le menu ci-dessous. Un formulaire rapide te sera ensuite propose pour ouvrir un salon prive avec la bonne equipe.',
  panel_footer: 'Une seule demande active par categorie si la protection anti-doublon est active.',
  menu_placeholder: 'Choisis le bon type de ticket',
  panel_color: '#7c3aed',
  panel_thumbnail_url: '',
  panel_image_url: '',
  default_category_id: '',
  ticket_name_template: 'ticket-{number}',
  ticket_topic_template: 'Ticket #{number} | {label} | {user_tag}',
  intro_message: 'Bonjour {mention}, ton ticket est bien cree.\n\nCategorie: {label}\nRaison: {reason}',
  claim_message: 'Ticket pris en charge par {claimer}.',
  close_message: 'Ticket ferme par {closer}.',
  auto_ping_support: true,
  allow_user_close: true,
  prevent_duplicates: true,
  options: PRESETS,
}

const getErrorMessage = (error) => error?.response?.data?.error || error?.message || 'Erreur inattendue'
const isTextChannel = (channel) => TEXT_CHANNEL_TYPES.has(Number(channel?.type))
const isCategoryChannel = (channel) => Number(channel?.type) === CATEGORY_CHANNEL_TYPE
const sortChannels = (channels) => [...channels].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
const sortRoles = (roles) => [...roles].filter((role) => role?.name !== '@everyone').sort((a, b) => Number(b?.position || 0) - Number(a?.position || 0))
const clone = (value) => JSON.parse(JSON.stringify(value || {}))

function formatDate(locale, value) {
  try {
    return value ? new Date(value).toLocaleString(locale || 'fr-FR') : '--'
  } catch {
    return value || '--'
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

function mergeOptions(options = []) {
  const map = new Map((Array.isArray(options) ? options : []).map((item) => [String(item?.key || '').trim(), item]).filter(([key]) => key))
  const presets = PRESETS.map((template) => {
    const current = map.get(template.key) || {}
    return {
      ...template,
      ...current,
      key: template.key,
      label: String(current.label || template.label),
      description: String(current.description || template.description),
      role_ids: Array.isArray(current.role_ids) ? current.role_ids : [],
      category_id: String(current.category_id || ''),
      question_label: String(current.question_label || template.question_label),
      question_placeholder: String(current.question_placeholder || template.question_placeholder),
      modal_title: String(current.modal_title || current.label || template.label),
      intro_message: String(current.intro_message || template.intro_message),
      ticket_name_template: String(current.ticket_name_template || template.ticket_name_template),
      ticket_topic_template: String(current.ticket_topic_template || template.ticket_topic_template),
      enabled: typeof current.enabled === 'boolean' ? current.enabled : template.enabled,
      ping_roles: typeof current.ping_roles === 'boolean' ? current.ping_roles : template.ping_roles,
    }
  })
  const extras = (Array.isArray(options) ? options : []).filter((item) => !PRESET_KEYS.has(String(item?.key || '').trim()))
  return [...presets, ...extras]
}

const normalizeConfig = (value = {}) => ({ ...DEFAULT_CONFIG, ...(value || {}), options: mergeOptions(value?.options) })

function StatCard({ label, value, icon: Icon, tone }) {
  return (
    <div className="glass-card border border-white/[0.08] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">{label}</p>
          <p className="mt-3 font-display text-3xl font-700 text-white">{value}</p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function SelectField({ label, value, onChange, options, emptyLabel }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      <div className="relative">
        <select value={value || ''} onChange={(event) => onChange(event.target.value)} className="w-full appearance-none rounded-2xl border border-white/10 bg-[#0a101b] px-4 py-3 pr-12 text-sm text-white outline-none transition focus:border-cyan-400/25" style={{ colorScheme: 'dark' }}>
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
          <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/70 transition hover:text-white"><Upload className="h-3.5 w-3.5" />Importer</button>
          <button type="button" onClick={onClear} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/70 transition hover:text-white"><X className="h-3.5 w-3.5" />Retirer</button>
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
  const { locale } = useI18n()
  const { selectedGuildId } = useGuildStore()
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [tickets, setTickets] = useState([])
  const [stats, setStats] = useState({ forms: 0, open: 0, claimed: 0, total: 0 })
  const [channels, setChannels] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [expandedKeys, setExpandedKeys] = useState(['contact_staff'])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const thumbnailRef = useRef(null)
  const imageRef = useRef(null)

  const textChannels = useMemo(() => sortChannels(channels.filter(isTextChannel)), [channels])
  const categoryChannels = useMemo(() => sortChannels(channels.filter(isCategoryChannel)), [channels])
  const visibleRoles = useMemo(() => sortRoles(roles), [roles])
  const normalizedConfig = config ? normalizeConfig(config) : null
  const normalizedDraft = draft ? normalizeConfig(draft) : null
  const draftDirty = JSON.stringify(normalizedConfig || {}) !== JSON.stringify(normalizedDraft || {})
  const activeOptions = (normalizedDraft?.options || []).filter((item) => PRESET_KEYS.has(item.key) && item.enabled)

  const applyOverview = (payload = {}, preserveDraft = false) => {
    const nextConfig = normalizeConfig(payload.config || {})
    setConfig(nextConfig)
    setTickets(Array.isArray(payload.tickets) ? payload.tickets : [])
    setStats(payload.stats || { forms: 0, open: 0, claimed: 0, total: 0 })
    if (!preserveDraft) setDraft(clone(nextConfig))
  }

  const loadAll = async (showToast = false) => {
    if (!selectedGuildId) return
    setLoading(true)
    try {
      const [overviewResponse, channelsResponse, rolesResponse] = await Promise.all([
        ticketGeneratorAPI.get(selectedGuildId),
        botAPI.channels(selectedGuildId),
        botAPI.roles(selectedGuildId),
      ])
      applyOverview(overviewResponse.data, false)
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
      setTickets([])
      setStats({ forms: 0, open: 0, claimed: 0, total: 0 })
      setChannels([])
      setRoles([])
      setLoadError('')
      setLoading(false)
      return
    }
    void loadAll(false)
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return undefined
    const unsubscribe = wsService.on('tickets:updated', (payload = {}) => {
      if (String(payload.guildId || '') !== String(selectedGuildId)) return
      applyOverview(payload, false)
      setLoadError('')
    })
    return () => unsubscribe()
  }, [selectedGuildId])

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

  const updateDraft = (patch) => setDraft((current) => normalizeConfig({ ...(current || {}), ...patch }))
  const updateOption = (key, patch) => setDraft((current) => {
    const source = normalizeConfig(current || {})
    return { ...source, options: source.options.map((item) => item.key === key ? { ...item, ...patch } : item) }
  })
  const toggleRole = (key, roleId) => setDraft((current) => {
    const source = normalizeConfig(current || {})
    return {
      ...source,
      options: source.options.map((item) => {
        if (item.key !== key) return item
        const roleIds = new Set(item.role_ids || [])
        if (roleIds.has(roleId)) roleIds.delete(roleId)
        else roleIds.add(roleId)
        return { ...item, role_ids: [...roleIds] }
      }),
    }
  })

  const saveConfig = async ({ silent = false } = {}) => {
    if (!selectedGuildId || !normalizedDraft) return
    setSaving(true)
    try {
      const response = await ticketGeneratorAPI.save(selectedGuildId, normalizedDraft)
      applyOverview(response.data, false)
      setLoadError('')
      if (!silent) toast.success('Configuration tickets sauvegardee')
    } catch (error) {
      toast.error(getErrorMessage(error))
      throw error
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
      toast.success('Panel tickets publie')
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
      updateDraft({ [targetKey]: await readFileAsDataUrl(file) })
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
          <p className="mt-2 text-white/40">Le systeme tickets se configure serveur par serveur.</p>
          <Link to="/dashboard/servers" className="mt-5 inline-flex items-center gap-2 rounded-xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 font-mono text-sm text-neon-cyan transition-all hover:bg-neon-cyan/20">
            Choisir un serveur
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:p-6">
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
              <p className="max-w-3xl text-sm text-white/55 sm:text-base">Coche les types utiles, choisis ton salon de publication, ajuste le message et publie.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => { setRefreshing(true); void loadAll(true) }} disabled={loading || refreshing} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Recharger</button>
              <button type="button" onClick={() => { void saveConfig() }} disabled={!normalizedDraft || saving || publishing} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/12 px-4 py-3 text-sm text-cyan-200 transition hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-60"><Save className="h-4 w-4" />{saving ? 'Sauvegarde...' : 'Sauvegarder'}</button>
              <button type="button" onClick={() => { void publishPanel() }} disabled={!normalizedDraft || saving || publishing} className="inline-flex items-center gap-2 rounded-2xl border border-violet-400/20 bg-violet-500/12 px-4 py-3 text-sm text-violet-200 transition hover:bg-violet-500/18 disabled:cursor-not-allowed disabled:opacity-60"><Send className="h-4 w-4" />{publishing ? 'Publication...' : 'Publier le panel'}</button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Formulaires actifs" value={stats.forms || 0} icon={Sparkles} tone="border-cyan-400/20 bg-cyan-500/12 text-cyan-300" />
            <StatCard label="Tickets ouverts" value={stats.open || 0} icon={Ticket} tone="border-violet-400/20 bg-violet-500/12 text-violet-300" />
            <StatCard label="Tickets pris" value={stats.claimed || 0} icon={Users} tone="border-amber-400/20 bg-amber-500/12 text-amber-300" />
            <StatCard label="Tickets total" value={stats.total || 0} icon={LifeBuoy} tone="border-emerald-400/20 bg-emerald-500/12 text-emerald-300" />
          </div>
        </div>
      </section>
      {loadError && <div className="rounded-[28px] border border-red-400/20 bg-red-500/10 px-5 py-4 text-sm text-red-200">{loadError}</div>}
      {loading && !normalizedDraft ? <div className="glass-card p-10 text-center text-white/60">Chargement...</div> : normalizedDraft ? (
        <>
          <section className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
            <div className="space-y-6">
              <div className="glass-card border border-white/[0.08] p-5">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-2xl font-700 text-white">Publication du panel</h2>
                    <p className="mt-1 text-sm text-white/45">Choisis le salon, le message, la couleur et les visuels du panel.</p>
                  </div>
                  <label className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/80">
                    <input type="checkbox" checked={Boolean(normalizedDraft.enabled)} onChange={(event) => updateDraft({ enabled: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
                    Activer
                  </label>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <SelectField label="Salon du panel" value={normalizedDraft.panel_channel_id} onChange={(value) => updateDraft({ panel_channel_id: value })} options={textChannels} emptyLabel="Aucun salon" />
                  <SelectField label="Categorie par defaut" value={normalizedDraft.default_category_id} onChange={(value) => updateDraft({ default_category_id: value })} options={categoryChannels} emptyLabel="Aucune categorie" />
                  <InputField label="Titre du panel" value={normalizedDraft.panel_title} onChange={(value) => updateDraft({ panel_title: value })} />
                  <InputField label="Placeholder du menu" value={normalizedDraft.menu_placeholder} onChange={(value) => updateDraft({ menu_placeholder: value })} />
                  <div className="lg:col-span-2">
                    <InputField label="Message du panel" value={normalizedDraft.panel_description} onChange={(value) => updateDraft({ panel_description: value })} multiline rows={5} />
                  </div>
                  <InputField label="Footer" value={normalizedDraft.panel_footer} onChange={(value) => updateDraft({ panel_footer: value })} />
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
                  <AssetBox label="Banniere" value={normalizedDraft.panel_image_url} onValue={(value) => updateDraft({ panel_image_url: value })} onUpload={(file) => uploadAsset('panel_image_url', file)} onClear={() => updateDraft({ panel_image_url: '' })} inputRef={imageRef} />
                </div>
              </div>

              <div className="glass-card border border-white/[0.08] p-5">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-2xl font-700 text-white">Types de tickets</h2>
                    <p className="mt-1 text-sm text-white/45">Tu coches ou decoches les categories utiles, puis tu ajustes juste l'essentiel.</p>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/65">{activeOptions.length} actifs</div>
                </div>
                <div className="space-y-4">
                  {PRESETS.map((preset) => {
                    const option = normalizedDraft.options.find((item) => item.key === preset.key) || preset
                    const expanded = expandedKeys.includes(preset.key)
                    return (
                      <div key={preset.key} className="rounded-[28px] border border-white/10 bg-black/20 p-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex items-start gap-4">
                            <label className="mt-1 inline-flex h-5 w-5 items-center justify-center">
                              <input type="checkbox" checked={Boolean(option.enabled)} onChange={(event) => updateOption(preset.key, { enabled: event.target.checked })} className="h-4 w-4 rounded accent-cyan-400" />
                            </label>
                            <div>
                              <div className="font-display text-xl font-700 text-white">{option.label}</div>
                              <div className="mt-1 text-sm text-white/45">{option.description}</div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <span className={`rounded-full border px-3 py-1.5 text-xs font-mono ${option.enabled ? 'border-emerald-400/20 bg-emerald-500/12 text-emerald-300' : 'border-white/10 bg-white/[0.04] text-white/45'}`}>{option.enabled ? 'Actif' : 'Desactive'}</span>
                            <button type="button" onClick={() => setExpandedKeys((current) => current.includes(preset.key) ? current.filter((item) => item !== preset.key) : [...current, preset.key])} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/70 transition hover:text-white">
                              Configurer
                              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                        {expanded && <div className="mt-5 grid gap-4 xl:grid-cols-2">
                          <InputField label="Nom dans le menu" value={option.label} onChange={(value) => updateOption(preset.key, { label: value, modal_title: value || preset.label })} />
                          <InputField label="Description courte" value={option.description} onChange={(value) => updateOption(preset.key, { description: value })} />
                          <InputField label="Question affichee" value={option.question_label} onChange={(value) => updateOption(preset.key, { question_label: value })} />
                          <SelectField label="Categorie parent" value={option.category_id} onChange={(value) => updateOption(preset.key, { category_id: value })} options={categoryChannels} emptyLabel="Aucune categorie" />
                          <div className="xl:col-span-2"><InputField label="Placeholder de la question" value={option.question_placeholder} onChange={(value) => updateOption(preset.key, { question_placeholder: value })} /></div>
                          <div className="xl:col-span-2"><InputField label="Message d'ouverture" value={option.intro_message} onChange={(value) => updateOption(preset.key, { intro_message: value })} multiline rows={4} /></div>
                          <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 xl:col-span-2">
                            <div className="mb-3 flex items-center justify-between gap-4">
                              <div>
                                <div className="text-sm font-display font-700 text-white">Roles staff</div>
                                <div className="text-xs text-white/40">Les roles selectionnes pourront voir et gerer ce ticket.</div>
                              </div>
                              <label className="inline-flex items-center gap-2 text-xs font-mono text-white/65">
                                <input type="checkbox" checked={Boolean(option.ping_roles)} onChange={(event) => updateOption(preset.key, { ping_roles: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
                                Ping a l'ouverture
                              </label>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {visibleRoles.map((role) => {
                                const active = (option.role_ids || []).includes(role.id)
                                return <button key={role.id} type="button" onClick={() => toggleRole(preset.key, role.id)} className={`rounded-full border px-3 py-1.5 text-xs font-mono transition-all ${active ? 'border-cyan-400/30 bg-cyan-500/14 text-cyan-200' : 'border-white/10 bg-white/[0.04] text-white/50 hover:text-white'}`}>@{role.name}</button>
                              })}
                            </div>
                          </div>
                        </div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="space-y-6">
              <div className="glass-card border border-white/[0.08] p-5">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-2xl font-700 text-white">Apercu Discord</h2>
                    <p className="mt-1 text-sm text-white/45">Preview rapide du panel avant publication.</p>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/65">{activeOptions.length} options</div>
                </div>
                <div className="rounded-[28px] border border-white/10 bg-[#111827] p-4 shadow-[0_20px_40px_rgba(2,8,23,0.25)]">
                  <div className="rounded-[24px] border border-white/10 bg-[#101826] p-4">
                    <div className="flex items-start gap-3">
                      {normalizedDraft.panel_thumbnail_url ? <img src={normalizedDraft.panel_thumbnail_url} alt="" className="h-14 w-14 rounded-2xl border border-white/10 object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-white/25"><ImagePlus className="h-4 w-4" /></div>}
                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-display font-700 text-white">{normalizedDraft.panel_title}</div>
                        <div className="mt-2 whitespace-pre-wrap text-sm text-white/65">{normalizedDraft.panel_description}</div>
                      </div>
                    </div>
                    {normalizedDraft.panel_image_url && <img src={normalizedDraft.panel_image_url} alt="" className="mt-4 h-32 w-full rounded-2xl border border-white/10 object-cover" />}
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/35">{normalizedDraft.menu_placeholder}</div>
                      <div className="space-y-2">
                        {activeOptions.map((option) => <div key={option.key} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70"><span>{option.label}</span><span className="text-xs text-white/35">{option.description}</span></div>)}
                      </div>
                    </div>
                    <div className="mt-4 text-xs font-mono uppercase tracking-[0.18em] text-white/30">{normalizedDraft.panel_footer}</div>
                  </div>
                </div>
              </div>
              <div className="glass-card border border-white/[0.08] p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-2xl font-700 text-white">Reglages globaux</h2>
                    <p className="mt-1 text-sm text-white/45">Les vrais comportements du systeme tickets.</p>
                  </div>
                  <button type="button" onClick={() => setShowAdvanced((current) => !current)} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/70 transition hover:text-white">
                    {showAdvanced ? 'Masquer' : 'Afficher'}
                    {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="grid gap-3">
                  <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <span className="text-sm text-white/70">Ping staff automatique</span>
                    <input type="checkbox" checked={Boolean(normalizedDraft.auto_ping_support)} onChange={(event) => updateDraft({ auto_ping_support: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
                  </label>
                  <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <span className="text-sm text-white/70">Autoriser l'auteur a fermer</span>
                    <input type="checkbox" checked={Boolean(normalizedDraft.allow_user_close)} onChange={(event) => updateDraft({ allow_user_close: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
                  </label>
                  <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <span className="text-sm text-white/70">Bloquer les doublons</span>
                    <input type="checkbox" checked={Boolean(normalizedDraft.prevent_duplicates)} onChange={(event) => updateDraft({ prevent_duplicates: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
                  </label>
                </div>
                {showAdvanced && <div className="mt-5 space-y-4">
                  <InputField label="Message de prise en charge" value={normalizedDraft.claim_message} onChange={(value) => updateDraft({ claim_message: value })} multiline rows={3} />
                  <InputField label="Message de fermeture" value={normalizedDraft.close_message} onChange={(value) => updateDraft({ close_message: value })} multiline rows={3} />
                  <InputField label="Template nom du salon" value={normalizedDraft.ticket_name_template} onChange={(value) => updateDraft({ ticket_name_template: value })} />
                  <InputField label="Template topic du salon" value={normalizedDraft.ticket_topic_template} onChange={(value) => updateDraft({ ticket_topic_template: value })} />
                  <InputField label="Message d'ouverture global" value={normalizedDraft.intro_message} onChange={(value) => updateDraft({ intro_message: value })} multiline rows={4} />
                </div>}
                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Panel publie</div>
                  <div className="mt-2 text-sm text-white/70">{normalizedDraft.panel_message_id ? `${normalizedDraft.panel_channel_id || '--'} / ${normalizedDraft.panel_message_id}` : 'Pas encore publie'}</div>
                </div>
              </div>
            </div>
          </section>
          <section className="glass-card border border-white/[0.08] p-5">
            <div className="mb-5">
              <h2 className="font-display text-2xl font-700 text-white">Activite recente</h2>
              <p className="mt-1 text-sm text-white/45">Derniers tickets ouverts, pris ou fermes depuis Discord.</p>
            </div>
            {tickets.length === 0 ? <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-10 text-center text-white/45">Aucun ticket pour le moment.</div> : <div className="grid gap-4 xl:grid-cols-2">{tickets.map((ticket) => <div key={ticket.id} className="rounded-3xl border border-white/10 bg-black/20 p-4"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-mono text-white/70">#{ticket.ticket_number}</span><span className={`rounded-full border px-2.5 py-1 text-[11px] font-mono ${ticket.status === 'closed' ? 'border-white/10 bg-white/[0.06] text-white/60' : ticket.status === 'claimed' ? 'border-amber-400/20 bg-amber-500/12 text-amber-300' : 'border-cyan-400/20 bg-cyan-500/12 text-cyan-300'}`}>{ticket.status}</span></div><div className="mt-3 grid gap-2 text-sm text-white/70 sm:grid-cols-2"><div><span className="text-white/35">Auteur:</span> {ticket.creator_username || '--'}</div><div><span className="text-white/35">Salon:</span> {ticket.channel_id || '--'}</div><div className="sm:col-span-2"><span className="text-white/35">Raison:</span> {ticket.reason || '--'}</div></div><div className="mt-3 text-xs font-mono text-white/30">{formatDate(locale, ticket.updated_at || ticket.created_at)}</div></div>)}</div>}
          </section>
        </>
      ) : null}
    </div>
  )
}
