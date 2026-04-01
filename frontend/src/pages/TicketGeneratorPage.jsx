import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowRight, LifeBuoy, Plus, RefreshCw, Save, Send, Sparkles, Ticket, Users } from 'lucide-react'
import { botAPI, ticketGeneratorAPI } from '../services/api'
import { wsService } from '../services/websocket'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'

const CATEGORY_CHANNEL_TYPE = 4
const TEXT_CHANNEL_TYPES = new Set([0, 5, 11, 12, 15])
const AUTO_REFRESH_MS = 12000

const UI = {
  fr: {
    title: 'Ticket Generator',
    subtitle: 'Panel Discord reel avec menu, formulaire, creation automatique du salon ticket et ping staff configurable.',
    selectServerTitle: "Choisis d'abord un serveur",
    selectServerText: 'Le systeme tickets se configure serveur par serveur.',
    selectServerAction: 'Choisir un serveur',
    refresh: 'Recharger',
    save: 'Sauvegarder',
    saving: 'Sauvegarde...',
    publish: 'Publier le panel',
    publishing: 'Publication...',
    saved: 'Configuration tickets sauvegardee',
    published: 'Panel tickets publie',
    synced: 'Tickets synchronises',
    loading: 'Chargement...',
    loadError: 'Impossible de charger le generateur de tickets.',
    stats: {
      forms: 'Formulaires',
      open: 'Ouverts',
      claimed: 'Pris',
      total: 'Total',
    },
    panel: 'Publication Discord',
    panelHint: 'Choisis le salon du panel, le texte visible et l apparence du menu.',
    defaults: 'Templates et comportement',
    defaultsHint: 'Regle les messages par defaut, la categorie parent et les regles globales.',
    options: 'Types de tickets',
    optionsHint: 'Chaque entree du menu peut avoir ses propres roles, question, categorie et templates.',
    recent: 'Activite recente',
    recentHint: 'Derniers tickets ouverts, pris ou fermes depuis Discord.',
    panelChannel: 'Salon du panel',
    defaultCategory: 'Categorie parent par defaut',
    noChannel: 'Aucun salon',
    noCategory: 'Aucune categorie',
    panelTitle: 'Titre du panel',
    panelDescription: 'Description',
    panelFooter: 'Footer',
    placeholder: 'Placeholder du menu',
    color: 'Couleur hex',
    ticketNameTemplate: 'Template nom salon',
    ticketTopicTemplate: 'Template topic salon',
    introMessage: 'Message d ouverture',
    claimMessage: 'Message de claim',
    closeMessage: 'Message de fermeture',
    enabled: 'Actif',
    disabled: 'Desactive',
    autoPing: 'Ping auto des roles staff',
    allowUserClose: 'Autoriser l auteur a fermer',
    preventDuplicates: 'Bloquer les doublons',
    addType: 'Ajouter un type',
    removeType: 'Supprimer',
    key: 'Cle technique',
    label: 'Label',
    description: 'Description courte',
    emoji: 'Emoji',
    modalTitle: 'Titre du formulaire',
    questionLabel: 'Question',
    questionPlaceholder: 'Placeholder question',
    optionCategory: 'Categorie parent',
    optionIntro: 'Message d intro',
    supportRoles: 'Roles staff',
    pingRoles: 'Ping a l ouverture',
    publishedPanel: 'Panel publie',
    notPublished: 'Pas encore publie',
    ticketChannel: 'Salon',
    ticketReason: 'Raison',
    ticketCreator: 'Auteur',
    noTickets: 'Aucun ticket pour le moment.',
    addOptionLimit: 'Maximum 10 types de tickets.',
    duplicateKeys: 'Chaque type de ticket doit avoir une cle unique.',
  },
  en: {
    title: 'Ticket Generator',
    subtitle: 'Real Discord panel with menu, form, automatic ticket channel creation and configurable staff ping.',
    selectServerTitle: 'Choose a server first',
    selectServerText: 'The ticket system is configured per server.',
    selectServerAction: 'Choose a server',
    refresh: 'Refresh',
    save: 'Save',
    saving: 'Saving...',
    publish: 'Publish panel',
    publishing: 'Publishing...',
    saved: 'Ticket configuration saved',
    published: 'Ticket panel published',
    synced: 'Tickets synced',
    loading: 'Loading...',
    loadError: 'Unable to load the ticket generator.',
    stats: {
      forms: 'Forms',
      open: 'Open',
      claimed: 'Claimed',
      total: 'Total',
    },
    panel: 'Discord publish',
    panelHint: 'Choose the panel channel, visible text and menu appearance.',
    defaults: 'Templates and behavior',
    defaultsHint: 'Tune default messages, parent category and global rules.',
    options: 'Ticket types',
    optionsHint: 'Each menu entry can have its own roles, question, category and templates.',
    recent: 'Recent activity',
    recentHint: 'Latest tickets opened, claimed or closed from Discord.',
    panelChannel: 'Panel channel',
    defaultCategory: 'Default parent category',
    noChannel: 'No channel',
    noCategory: 'No category',
    panelTitle: 'Panel title',
    panelDescription: 'Description',
    panelFooter: 'Footer',
    placeholder: 'Menu placeholder',
    color: 'Hex color',
    ticketNameTemplate: 'Channel name template',
    ticketTopicTemplate: 'Channel topic template',
    introMessage: 'Opening message',
    claimMessage: 'Claim message',
    closeMessage: 'Close message',
    enabled: 'Enabled',
    disabled: 'Disabled',
    autoPing: 'Auto ping support roles',
    allowUserClose: 'Allow author close',
    preventDuplicates: 'Block duplicates',
    addType: 'Add type',
    removeType: 'Remove',
    key: 'Technical key',
    label: 'Label',
    description: 'Short description',
    emoji: 'Emoji',
    modalTitle: 'Form title',
    questionLabel: 'Question',
    questionPlaceholder: 'Question placeholder',
    optionCategory: 'Parent category',
    optionIntro: 'Intro message',
    supportRoles: 'Support roles',
    pingRoles: 'Ping on open',
    publishedPanel: 'Published panel',
    notPublished: 'Not published yet',
    ticketChannel: 'Channel',
    ticketReason: 'Reason',
    ticketCreator: 'Author',
    noTickets: 'No tickets yet.',
    addOptionLimit: 'Maximum 10 ticket types.',
    duplicateKeys: 'Every ticket type needs a unique key.',
  },
}

function getUi(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]
  return UI[key] || UI.fr
}

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Unexpected error'
}

function isTextChannel(channel) {
  return TEXT_CHANNEL_TYPES.has(Number(channel?.type))
}

function isCategoryChannel(channel) {
  return Number(channel?.type) === CATEGORY_CHANNEL_TYPE
}

function sortChannels(channels) {
  return [...channels].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
}

function sortRoles(roles) {
  return [...roles]
    .filter((role) => role?.name !== '@everyone')
    .sort((a, b) => Number(b?.position || 0) - Number(a?.position || 0))
}

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value || {}))
}

function buildOptionKey(base, existingKeys) {
  const normalized = String(base || 'ticket')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'ticket'
  let nextKey = normalized
  let suffix = 1

  while (existingKeys.has(nextKey)) {
    nextKey = `${normalized}_${suffix}`.slice(0, 32)
    suffix += 1
  }

  return nextKey
}

function createOptionDraft(existingOptions = []) {
  const existingKeys = new Set(existingOptions.map((option) => String(option?.key || '').trim()).filter(Boolean))
  const key = buildOptionKey(`ticket_${existingOptions.length + 1}`, existingKeys)
  const label = `Ticket ${existingOptions.length + 1}`

  return {
    key,
    label,
    description: 'Nouvelle categorie de ticket',
    emoji: '',
    category_id: '',
    role_ids: [],
    ping_roles: true,
    question_label: 'Explique ta demande',
    question_placeholder: 'Donne le plus de details possible...',
    modal_title: label,
    intro_message: 'Bonjour {mention}, ton ticket est bien ouvert.\n\nRaison: {reason}',
    ticket_name_template: `${key}-{number}`,
    ticket_topic_template: 'Ticket #{number} | {label} | {user_tag}',
    enabled: true,
  }
}

function formatDate(locale, value) {
  if (!value) return '--'
  try {
    return new Date(value).toLocaleString(locale)
  } catch {
    return value
  }
}

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

function TogglePill({ active, onClick, activeLabel, inactiveLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-mono transition-all ${
        active
          ? 'border-emerald-400/30 bg-emerald-500/14 text-emerald-300'
          : 'border-white/10 bg-white/[0.04] text-white/45 hover:text-white'
      }`}
    >
      {active ? activeLabel : inactiveLabel}
    </button>
  )
}

function SelectField({ label, value, onChange, options, emptyLabel }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      <select
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/25"
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function TextField({ label, value, onChange, placeholder = '' }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      <input
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/25"
      />
    </label>
  )
}

function TextAreaField({ label, value, onChange, rows = 4 }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      <textarea
        rows={rows}
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/25"
      />
    </label>
  )
}

function RolePills({ roles, selectedIds, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2">
      {roles.map((role) => {
        const active = selectedIds.includes(role.id)
        return (
          <button
            key={role.id}
            type="button"
            onClick={() => onToggle(role.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-mono transition-all ${
              active
                ? 'border-cyan-400/30 bg-cyan-500/14 text-cyan-200'
                : 'border-white/10 bg-white/[0.04] text-white/50 hover:text-white'
            }`}
          >
            @{role.name}
          </button>
        )
      })}
    </div>
  )
}

function RecentTicketRow({ ticket, locale, ui }) {
  const statusTone = ticket.status === 'closed'
    ? 'border-white/10 bg-white/[0.06] text-white/60'
    : ticket.status === 'claimed'
      ? 'border-amber-400/20 bg-amber-500/12 text-amber-300'
      : 'border-cyan-400/20 bg-cyan-500/12 text-cyan-300'

  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-mono text-white/70">
          #{ticket.ticket_number}
        </span>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-mono ${statusTone}`}>
          {ticket.status}
        </span>
      </div>
      <div className="mt-3 grid gap-2 text-sm text-white/70 sm:grid-cols-2">
        <div><span className="text-white/35">{ui.ticketCreator}:</span> {ticket.creator_username || '--'}</div>
        <div><span className="text-white/35">{ui.ticketChannel}:</span> {ticket.channel_id || '--'}</div>
        <div className="sm:col-span-2"><span className="text-white/35">{ui.ticketReason}:</span> {ticket.reason || '--'}</div>
      </div>
      <div className="mt-3 text-xs font-mono text-white/30">{formatDate(locale, ticket.updated_at || ticket.created_at)}</div>
    </div>
  )
}

export default function TicketGeneratorPage() {
  const { locale } = useI18n()
  const ui = getUi(locale)
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

  const textChannels = useMemo(() => sortChannels(channels.filter(isTextChannel)), [channels])
  const categoryChannels = useMemo(() => sortChannels(channels.filter(isCategoryChannel)), [channels])
  const visibleRoles = useMemo(() => sortRoles(roles), [roles])
  const draftDirty = JSON.stringify(config || {}) !== JSON.stringify(draft || {})

  const applyOverview = (payload = {}, preserveDraft = false) => {
    const nextConfig = cloneConfig(payload.config || {})
    setConfig(nextConfig)
    setTickets(Array.isArray(payload.tickets) ? payload.tickets : [])
    setStats(payload.stats || { forms: 0, open: 0, claimed: 0, total: 0 })
    if (!preserveDraft) {
      setDraft(cloneConfig(nextConfig))
    }
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
      if (showToast) toast.success(ui.synced)
    } catch (error) {
      const message = getErrorMessage(error)
      setLoadError(message || ui.loadError)
      if (showToast) toast.error(message || ui.loadError)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const refreshOverviewOnly = async () => {
    if (!selectedGuildId) return
    try {
      const response = await ticketGeneratorAPI.get(selectedGuildId)
      applyOverview(response.data, draftDirty)
      setLoadError('')
    } catch {
      // Silent refresh.
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
      void refreshOverviewOnly()
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [selectedGuildId, draftDirty])

  const updateDraft = (patch) => {
    setDraft((current) => ({
      ...(current || {}),
      ...patch,
    }))
  }

  const updateOption = (index, patch) => {
    setDraft((current) => {
      const nextOptions = [...(current?.options || [])]
      nextOptions[index] = {
        ...nextOptions[index],
        ...patch,
      }
      return {
        ...current,
        options: nextOptions,
      }
    })
  }

  const toggleOptionRole = (index, roleId) => {
    setDraft((current) => {
      const nextOptions = [...(current?.options || [])]
      const currentRoles = new Set(nextOptions[index]?.role_ids || [])
      if (currentRoles.has(roleId)) currentRoles.delete(roleId)
      else currentRoles.add(roleId)
      nextOptions[index] = {
        ...nextOptions[index],
        role_ids: [...currentRoles],
      }
      return {
        ...current,
        options: nextOptions,
      }
    })
  }

  const addOption = () => {
    setDraft((current) => {
      const currentOptions = current?.options || []
      if (currentOptions.length >= 10) {
        toast.error(ui.addOptionLimit)
        return current
      }
      return {
        ...current,
        options: [...currentOptions, createOptionDraft(currentOptions)],
      }
    })
  }

  const removeOption = (index) => {
    setDraft((current) => {
      const currentOptions = current?.options || []
      if (currentOptions.length <= 1) return current
      return {
        ...current,
        options: currentOptions.filter((_, optionIndex) => optionIndex !== index),
      }
    })
  }

  const ensureUniqueOptionKeys = () => {
    const keys = (draft?.options || []).map((option) => String(option?.key || '').trim()).filter(Boolean)
    return keys.length === (draft?.options || []).length && new Set(keys).size === keys.length
  }

  const saveConfig = async ({ silent = false } = {}) => {
    if (!selectedGuildId || !draft) return null
    if (!ensureUniqueOptionKeys()) {
      toast.error(ui.duplicateKeys)
      return null
    }

    setSaving(true)
    try {
      const response = await ticketGeneratorAPI.save(selectedGuildId, draft)
      applyOverview(response.data, false)
      setLoadError('')
      if (!silent) toast.success(ui.saved)
      return response.data
    } catch (error) {
      toast.error(getErrorMessage(error))
      throw error
    } finally {
      setSaving(false)
    }
  }

  const publishPanel = async () => {
    if (!selectedGuildId || !draft) return
    if (!ensureUniqueOptionKeys()) {
      toast.error(ui.duplicateKeys)
      return
    }

    setPublishing(true)
    try {
      if (draftDirty) {
        await saveConfig({ silent: true })
      }
      const response = await ticketGeneratorAPI.publish(selectedGuildId)
      applyOverview(response.data, false)
      setLoadError('')
      toast.success(ui.published)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPublishing(false)
    }
  }

  if (!selectedGuildId) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-5 pt-20 sm:p-6 sm:pt-24">
        <div className="glass-card p-10 text-center">
          <Ticket className="mx-auto mb-4 h-12 w-12 text-white/10" />
          <p className="font-display text-xl font-700 text-white">{ui.selectServerTitle}</p>
          <p className="mt-2 text-white/40">{ui.selectServerText}</p>
          <Link to="/dashboard/servers" className="mt-5 inline-flex items-center gap-2 rounded-xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 font-mono text-sm text-neon-cyan transition-all hover:bg-neon-cyan/20">
            {ui.selectServerAction}
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
              <h1 className="font-display text-3xl font-700 text-white sm:text-[2.5rem]">{ui.title}</h1>
              <p className="max-w-3xl text-sm text-white/55 sm:text-base">{ui.subtitle}</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setRefreshing(true)
                  void loadAll(true)
                }}
                disabled={loading || refreshing}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {ui.refresh}
              </button>
              <button
                type="button"
                onClick={() => { void saveConfig() }}
                disabled={!draft || saving || publishing}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/12 px-4 py-3 text-sm text-cyan-200 transition hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? ui.saving : ui.save}
              </button>
              <button
                type="button"
                onClick={() => { void publishPanel() }}
                disabled={!draft || saving || publishing}
                className="inline-flex items-center gap-2 rounded-2xl border border-violet-400/20 bg-violet-500/12 px-4 py-3 text-sm text-violet-200 transition hover:bg-violet-500/18 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {publishing ? ui.publishing : ui.publish}
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label={ui.stats.forms} value={stats.forms || 0} icon={Sparkles} tone="border-cyan-400/20 bg-cyan-500/12 text-cyan-300" />
            <StatCard label={ui.stats.open} value={stats.open || 0} icon={Ticket} tone="border-violet-400/20 bg-violet-500/12 text-violet-300" />
            <StatCard label={ui.stats.claimed} value={stats.claimed || 0} icon={Users} tone="border-amber-400/20 bg-amber-500/12 text-amber-300" />
            <StatCard label={ui.stats.total} value={stats.total || 0} icon={LifeBuoy} tone="border-emerald-400/20 bg-emerald-500/12 text-emerald-300" />
          </div>
        </div>
      </section>

      {loadError && (
        <div className="rounded-[28px] border border-red-400/20 bg-red-500/10 px-5 py-4 text-sm text-red-200">
          {loadError || ui.loadError}
        </div>
      )}

      {loading && !draft ? (
        <div className="glass-card p-10 text-center text-white/60">{ui.loading}</div>
      ) : draft ? (
        <>
          <section className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
            <div className="glass-card border border-white/[0.08] p-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl font-700 text-white">{ui.panel}</h2>
                  <p className="mt-1 text-sm text-white/45">{ui.panelHint}</p>
                </div>
                <TogglePill active={Boolean(draft.enabled)} onClick={() => updateDraft({ enabled: !draft.enabled })} activeLabel={ui.enabled} inactiveLabel={ui.disabled} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SelectField label={ui.panelChannel} value={draft.panel_channel_id} onChange={(value) => updateDraft({ panel_channel_id: value })} options={textChannels} emptyLabel={ui.noChannel} />
                <SelectField label={ui.defaultCategory} value={draft.default_category_id} onChange={(value) => updateDraft({ default_category_id: value })} options={categoryChannels} emptyLabel={ui.noCategory} />
                <TextField label={ui.panelTitle} value={draft.panel_title} onChange={(value) => updateDraft({ panel_title: value })} />
                <TextField label={ui.placeholder} value={draft.menu_placeholder} onChange={(value) => updateDraft({ menu_placeholder: value })} />
                <div className="lg:col-span-2">
                  <TextAreaField label={ui.panelDescription} rows={5} value={draft.panel_description} onChange={(value) => updateDraft({ panel_description: value })} />
                </div>
                <TextField label={ui.panelFooter} value={draft.panel_footer} onChange={(value) => updateDraft({ panel_footer: value })} />
                <TextField label={ui.color} value={draft.panel_color} onChange={(value) => updateDraft({ panel_color: value })} />
              </div>
            </div>

            <div className="space-y-6">
              <div className="glass-card border border-white/[0.08] p-5">
                <div className="mb-5">
                  <h2 className="font-display text-2xl font-700 text-white">{ui.defaults}</h2>
                  <p className="mt-1 text-sm text-white/45">{ui.defaultsHint}</p>
                </div>
                <div className="space-y-4">
                  <TextField label={ui.ticketNameTemplate} value={draft.ticket_name_template} onChange={(value) => updateDraft({ ticket_name_template: value })} />
                  <TextField label={ui.ticketTopicTemplate} value={draft.ticket_topic_template} onChange={(value) => updateDraft({ ticket_topic_template: value })} />
                  <TextAreaField label={ui.introMessage} rows={4} value={draft.intro_message} onChange={(value) => updateDraft({ intro_message: value })} />
                  <TextAreaField label={ui.claimMessage} rows={3} value={draft.claim_message} onChange={(value) => updateDraft({ claim_message: value })} />
                  <TextAreaField label={ui.closeMessage} rows={3} value={draft.close_message} onChange={(value) => updateDraft({ close_message: value })} />
                </div>
              </div>

              <div className="glass-card border border-white/[0.08] p-5">
                <div className="grid gap-3">
                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <span className="text-sm text-white/70">{ui.autoPing}</span>
                    <TogglePill active={Boolean(draft.auto_ping_support)} onClick={() => updateDraft({ auto_ping_support: !draft.auto_ping_support })} activeLabel={ui.enabled} inactiveLabel={ui.disabled} />
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <span className="text-sm text-white/70">{ui.allowUserClose}</span>
                    <TogglePill active={Boolean(draft.allow_user_close)} onClick={() => updateDraft({ allow_user_close: !draft.allow_user_close })} activeLabel={ui.enabled} inactiveLabel={ui.disabled} />
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <span className="text-sm text-white/70">{ui.preventDuplicates}</span>
                    <TogglePill active={Boolean(draft.prevent_duplicates)} onClick={() => updateDraft({ prevent_duplicates: !draft.prevent_duplicates })} activeLabel={ui.enabled} inactiveLabel={ui.disabled} />
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">{ui.publishedPanel}</div>
                  <div className="mt-2 text-sm text-white/70">
                    {draft.panel_message_id ? `${draft.panel_channel_id || '--'} / ${draft.panel_message_id}` : ui.notPublished}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="glass-card border border-white/[0.08] p-5">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-2xl font-700 text-white">{ui.options}</h2>
                <p className="mt-1 text-sm text-white/45">{ui.optionsHint}</p>
              </div>
              <button type="button" onClick={addOption} disabled={(draft.options || []).length >= 10} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200 transition hover:bg-cyan-500/16 disabled:cursor-not-allowed disabled:opacity-50">
                <Plus className="h-4 w-4" />
                {ui.addType}
              </button>
            </div>

            <div className="space-y-5">
              {(draft.options || []).map((option, index) => (
                <div key={`${option.key}-${index}`} className="rounded-[28px] border border-white/10 bg-black/20 p-5">
                  <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="font-display text-xl font-700 text-white">{option.label || `Ticket ${index + 1}`}</div>
                      <div className="text-sm text-white/35">{option.key}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <TogglePill active={Boolean(option.enabled)} onClick={() => updateOption(index, { enabled: !option.enabled })} activeLabel={ui.enabled} inactiveLabel={ui.disabled} />
                      <button type="button" onClick={() => removeOption(index)} disabled={(draft.options || []).length <= 1} className="rounded-full border border-red-400/18 bg-red-500/10 px-3 py-1.5 text-xs font-mono text-red-200 transition hover:bg-red-500/16 disabled:cursor-not-allowed disabled:opacity-50">
                        {ui.removeType}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <TextField label={ui.label} value={option.label} onChange={(value) => updateOption(index, { label: value })} />
                    <TextField label={ui.key} value={option.key} onChange={(value) => updateOption(index, { key: value })} />
                    <TextField label={ui.description} value={option.description} onChange={(value) => updateOption(index, { description: value })} />
                    <TextField label={ui.emoji} value={option.emoji} onChange={(value) => updateOption(index, { emoji: value })} />
                    <TextField label={ui.modalTitle} value={option.modal_title} onChange={(value) => updateOption(index, { modal_title: value })} />
                    <TextField label={ui.questionLabel} value={option.question_label} onChange={(value) => updateOption(index, { question_label: value })} />
                    <div className="xl:col-span-2">
                      <TextField label={ui.questionPlaceholder} value={option.question_placeholder} onChange={(value) => updateOption(index, { question_placeholder: value })} />
                    </div>
                    <SelectField label={ui.optionCategory} value={option.category_id} onChange={(value) => updateOption(index, { category_id: value })} options={categoryChannels} emptyLabel={ui.noCategory} />
                    <div className="flex items-end">
                      <div className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <span className="text-sm text-white/70">{ui.pingRoles}</span>
                        <TogglePill active={Boolean(option.ping_roles)} onClick={() => updateOption(index, { ping_roles: !option.ping_roles })} activeLabel={ui.enabled} inactiveLabel={ui.disabled} />
                      </div>
                    </div>
                    <TextField label={ui.ticketNameTemplate} value={option.ticket_name_template} onChange={(value) => updateOption(index, { ticket_name_template: value })} />
                    <TextField label={ui.ticketTopicTemplate} value={option.ticket_topic_template} onChange={(value) => updateOption(index, { ticket_topic_template: value })} />
                    <div className="xl:col-span-2">
                      <TextAreaField label={ui.optionIntro} rows={4} value={option.intro_message} onChange={(value) => updateOption(index, { intro_message: value })} />
                    </div>
                    <div className="xl:col-span-2 space-y-2">
                      <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">{ui.supportRoles}</span>
                      <RolePills roles={visibleRoles} selectedIds={option.role_ids || []} onToggle={(roleId) => toggleOptionRole(index, roleId)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-card border border-white/[0.08] p-5">
            <div className="mb-5">
              <h2 className="font-display text-2xl font-700 text-white">{ui.recent}</h2>
              <p className="mt-1 text-sm text-white/45">{ui.recentHint}</p>
            </div>

            {tickets.length === 0 ? (
              <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-10 text-center text-white/45">
                {ui.noTickets}
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {tickets.map((ticket) => (
                  <RecentTicketRow key={ticket.id} ticket={ticket} locale={locale} ui={ui} />
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
