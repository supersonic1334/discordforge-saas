import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Mail, Settings, Shield, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { botAPI, modulesAPI } from '../services/api'
import { wsService } from '../services/websocket'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'

const TEXT_CHANNEL_TYPES = [0, 5, 11, 12, 15]
const DELAY_OPTIONS = [
  { value: 0, label: 'Immédiat' },
  { value: 5000, label: '5 secondes' },
  { value: 30000, label: '30 secondes' },
  { value: 120000, label: '2 minutes' },
]

const WELCOME_COPY = {
  fr: {
    pageTitle: 'Accueil & rôles',
    pageChip: 'accueil & rôles',
    description: "Configure l'arrivée des nouveaux membres avec un vrai message d'accueil, un DM propre et des rôles automatiques.",
    publicMessage: 'Bienvenue sur **{server}**, {user} ! Prends un instant pour lire les informations importantes et profiter de tous les salons.',
    dmMessage: 'Bienvenue sur {server}, {user}. Le serveur est prêt pour toi: lis les règles, présente-toi et profite de ton accès.',
    embedTitle: 'Bienvenue sur {server}',
    previewLabel: 'Aperçu du rendu',
    previewNote: "Le rendu suit automatiquement la langue active du site et affiche un vrai visuel de bienvenue.",
    resetTemplate: 'Réappliquer le modèle',
    welcomeLabel: 'Bienvenue avancée',
    welcomeHint: "Message public, DM d'accueil et aperçu visuel propre.",
    autoRoleLabel: 'Rôles automatiques',
    autoRoleHint: "Attribue les bons rôles dès l'arrivée, avec un délai propre si besoin.",
  },
  en: {
    pageTitle: 'Welcome & roles',
    pageChip: 'welcome & roles',
    description: 'Configure member arrival with a polished welcome message, a clean DM and automatic role assignment.',
    publicMessage: 'Welcome to **{server}**, {user}! Take a moment to read the key information and enjoy every channel.',
    dmMessage: 'Welcome to {server}, {user}. Everything is ready for you: read the rules, introduce yourself and enjoy your access.',
    embedTitle: 'Welcome to {server}',
    previewLabel: 'Live preview',
    previewNote: 'The render follows the current site language and displays a proper welcome card.',
    resetTemplate: 'Reload template',
    welcomeLabel: 'Advanced welcome',
    welcomeHint: 'Public message, welcome DM and cleaner visual preview.',
    autoRoleLabel: 'Automatic roles',
    autoRoleHint: 'Assign the right roles on join, with a clean delay if needed.',
  },
  es: {
    pageTitle: 'Bienvenida y roles',
    pageChip: 'bienvenida y roles',
    description: 'Configura la llegada de miembros con un mensaje bonito, un DM claro y roles automáticos.',
    publicMessage: 'Bienvenido a **{server}**, {user}. Tómate un momento para leer la información importante y disfrutar todos los canales.',
    dmMessage: 'Bienvenido a {server}, {user}. Todo está listo para ti: revisa las reglas, preséntate y aprovecha tu acceso.',
    embedTitle: 'Bienvenido a {server}',
    previewLabel: 'Vista previa',
    previewNote: 'La vista sigue el idioma activo del sitio y muestra una bienvenida más visual.',
    resetTemplate: 'Recargar plantilla',
    welcomeLabel: 'Bienvenida avanzada',
    welcomeHint: 'Mensaje público, DM de bienvenida y vista previa más clara.',
    autoRoleLabel: 'Roles automáticos',
    autoRoleHint: 'Entrega los roles correctos al entrar, con retraso limpio si hace falta.',
  },
}

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Erreur inattendue'
}

function getResolvedLocale(locale) {
  return ['fr', 'en', 'es'].includes(locale) ? locale : 'fr'
}

function getWelcomeCopy(locale) {
  return WELCOME_COPY[getResolvedLocale(locale)] || WELCOME_COPY.fr
}

function applyWelcomeTokens(template, { guildName, memberLabel, memberCount }) {
  return String(template || '')
    .replace(/{server}/g, guildName)
    .replace(/{user}/g, memberLabel)
    .replace(/{username}/g, memberLabel.replace(/^@/, ''))
    .replace(/{memberCount}/g, String(memberCount || '?'))
}

function normalizeWelcome(moduleData, fallbackLocale = 'fr') {
  return {
    enabled: !!moduleData?.enabled,
    channel_id: moduleData?.simple_config?.channel_id || '',
    message: moduleData?.simple_config?.message || '',
    send_dm: !!moduleData?.advanced_config?.send_dm,
    dm_message: moduleData?.advanced_config?.dm_message || '',
    embed: moduleData?.advanced_config?.embed !== false,
    embed_title: moduleData?.advanced_config?.embed_title || '',
    template_locale: moduleData?.advanced_config?.template_locale || fallbackLocale,
  }
}

function normalizeAutoRole(moduleData) {
  return {
    enabled: !!moduleData?.enabled,
    roles: Array.isArray(moduleData?.simple_config?.roles) ? moduleData.simple_config.roles : [],
    delay_ms: Number(moduleData?.advanced_config?.delay_ms || 0),
    only_humans: moduleData?.advanced_config?.only_humans !== false,
  }
}

function SummaryCard({ icon: Icon, title, text, tone = 'cyan' }) {
  const tones = {
    cyan: 'border-neon-cyan/15 bg-neon-cyan/[0.06] text-neon-cyan',
    violet: 'border-violet-400/15 bg-violet-400/[0.06] text-violet-300',
    emerald: 'border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300',
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${tones[tone]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-4 font-display font-700 text-white">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-white/50">{text}</p>
    </div>
  )
}

export default function RolesOnboardingPage() {
  const { locale } = useI18n()
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [roles, setRoles] = useState([])
  const [channels, setChannels] = useState([])
  const [welcomeForm, setWelcomeForm] = useState(normalizeWelcome(null))
  const [autoRoleForm, setAutoRoleForm] = useState(normalizeAutoRole(null))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const selectedGuildIdRef = useRef(selectedGuildId)

  const resolvedLocale = useMemo(() => getResolvedLocale(locale), [locale])
  const textChannels = useMemo(
    () => channels.filter((channel) => TEXT_CHANNEL_TYPES.includes(Number(channel?.type))),
    [channels],
  )
  const welcomeCopy = useMemo(
    () => getWelcomeCopy(welcomeForm.template_locale || resolvedLocale),
    [welcomeForm.template_locale, resolvedLocale],
  )
  const welcomePreview = useMemo(() => {
    const guildName = guild?.name || 'DiscordForger'
    const memberLabel = '@Nexus'
    const memberCount = Number(guild?.member_count || 128)
    return {
      title: applyWelcomeTokens(welcomeForm.embed_title?.trim() || welcomeCopy.embedTitle, { guildName, memberLabel, memberCount }),
      publicMessage: applyWelcomeTokens(welcomeForm.message?.trim() || welcomeCopy.publicMessage, { guildName, memberLabel, memberCount }),
      dmMessage: applyWelcomeTokens(welcomeForm.dm_message?.trim() || welcomeCopy.dmMessage, { guildName, memberLabel, memberCount }),
    }
  }, [guild, welcomeCopy, welcomeForm.dm_message, welcomeForm.embed_title, welcomeForm.message])

  useEffect(() => {
    selectedGuildIdRef.current = selectedGuildId
  }, [selectedGuildId])

  useEffect(() => {
    setRoles([])
    setChannels([])
    setWelcomeForm(normalizeWelcome(null, resolvedLocale))
    setAutoRoleForm(normalizeAutoRole(null))
  }, [selectedGuildId, resolvedLocale])

  const loadData = useCallback(async (showLoader = true) => {
    const guildId = selectedGuildIdRef.current
    if (!guildId) return

    if (showLoader) {
      setLoading(true)
    }

    try {
      const [rolesResponse, channelsResponse, welcomeResponse, autoRoleResponse] = await Promise.all([
        botAPI.roles(guildId),
        botAPI.channels(guildId),
        modulesAPI.get(guildId, 'WELCOME_MESSAGE'),
        modulesAPI.get(guildId, 'AUTO_ROLE'),
      ])

      if (guildId !== selectedGuildIdRef.current) return

      setRoles(rolesResponse.data?.roles || rolesResponse.data || [])
      setChannels(channelsResponse.data?.channels || channelsResponse.data || [])
      setWelcomeForm(normalizeWelcome(welcomeResponse.data, resolvedLocale))
      setAutoRoleForm(normalizeAutoRole(autoRoleResponse.data))
    } catch (error) {
      if (guildId !== selectedGuildIdRef.current) return
      toast.error(getErrorMessage(error))
    } finally {
      if (showLoader && guildId === selectedGuildIdRef.current) {
        setLoading(false)
      }
    }
  }, [resolvedLocale])

  useEffect(() => {
    if (!selectedGuildId) return
    void loadData(true)
  }, [loadData, selectedGuildId, resolvedLocale])

  useEffect(() => {
    const handleRealtimeSync = (payload = {}) => {
      if (String(payload.guildId || '') !== String(selectedGuildIdRef.current || '')) return
      const syncedModules = Array.isArray(payload.modules) ? payload.modules : []
      const welcomeModule = syncedModules.find((module) => module?.type === 'WELCOME_MESSAGE')
      const autoRoleModule = syncedModules.find((module) => module?.type === 'AUTO_ROLE')

      if (welcomeModule) {
        setWelcomeForm(normalizeWelcome(welcomeModule, resolvedLocale))
      }
      if (autoRoleModule) {
        setAutoRoleForm(normalizeAutoRole(autoRoleModule))
      }
      if (welcomeModule || autoRoleModule) return
      if (payload.moduleType && !['WELCOME_MESSAGE', 'AUTO_ROLE'].includes(String(payload.moduleType))) return
      void loadData(false)
    }

    const unsubscribeModules = wsService.on('modules:updated', handleRealtimeSync)
    const unsubscribeSnapshots = wsService.on('team:snapshot_restored', (payload = {}) => {
      if (String(payload.guildId || '') !== String(selectedGuildIdRef.current || '')) return
      void loadData(false)
    })

    return () => {
      unsubscribeModules()
      unsubscribeSnapshots()
    }
  }, [loadData, resolvedLocale])

  function toggleRole(roleId) {
    setAutoRoleForm((current) => ({
      ...current,
      roles: current.roles.includes(roleId)
        ? current.roles.filter((value) => value !== roleId)
        : [...current.roles, roleId],
    }))
  }

  async function saveWelcome() {
    if (!selectedGuildId) return
    setSaving('welcome')

    try {
      const activeLocale = welcomeForm.template_locale || resolvedLocale
      const activeCopy = getWelcomeCopy(activeLocale)

      await modulesAPI.toggle(selectedGuildId, 'WELCOME_MESSAGE', welcomeForm.enabled)
      await modulesAPI.config(selectedGuildId, 'WELCOME_MESSAGE', {
        simple_config: {
          channel_id: welcomeForm.channel_id || null,
          message: String(welcomeForm.message || '').trim() || activeCopy.publicMessage,
        },
        advanced_config: {
          send_dm: !!welcomeForm.send_dm,
          dm_message: String(welcomeForm.dm_message || '').trim() || activeCopy.dmMessage,
          embed: !!welcomeForm.embed,
          embed_title: String(welcomeForm.embed_title || '').trim() || activeCopy.embedTitle,
          embed_color: '#5865F2',
          embed_thumbnail: true,
          template_locale: activeLocale,
        },
      })

      toast.success('Accueil mis à jour')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  async function saveAutoRoles() {
    if (!selectedGuildId) return
    setSaving('roles')

    try {
      await modulesAPI.toggle(selectedGuildId, 'AUTO_ROLE', autoRoleForm.enabled)
      await modulesAPI.config(selectedGuildId, 'AUTO_ROLE', {
        simple_config: {
          roles: autoRoleForm.roles,
        },
        advanced_config: {
          delay_ms: Number(autoRoleForm.delay_ms || 0),
          only_humans: !!autoRoleForm.only_humans,
        },
      })

      toast.success('Auto-rôles mis à jour')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  if (!selectedGuildId) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-20 pb-5 sm:p-6 sm:pt-24">
        <div className="glass-card p-10 text-center">
          <UserPlus className="mx-auto mb-4 h-12 w-12 text-white/10" />
          <p className="font-display text-xl font-700 text-white">Choisis d'abord un serveur</p>
          <p className="mt-2 text-white/40">Accueil & rôles dépend du serveur actif.</p>
          <Link to="/dashboard/servers" className="mt-5 inline-flex items-center gap-2 rounded-xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 font-mono text-sm text-neon-cyan transition-all hover:bg-neon-cyan/20">
            Choisir un serveur
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:p-6">
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="feature-chip"><UserPlus className="h-3.5 w-3.5" /> {welcomeCopy.pageChip}</span>
              <span className="feature-chip"><Mail className="h-3.5 w-3.5" /> accueil</span>
              <span className="feature-chip"><Shield className="h-3.5 w-3.5" /> {guild?.name || 'serveur'}</span>
            </div>
            <div>
              <h1 className="font-display text-3xl font-800 text-white sm:text-4xl">{welcomeCopy.pageTitle}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 sm:text-[15px]">
                {welcomeCopy.description}
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-3">
          <SummaryCard icon={Mail} title="Accueil" text={welcomeForm.enabled ? 'Actif' : 'Inactif'} tone="cyan" />
          <SummaryCard icon={UserPlus} title="Rôles auto" text={autoRoleForm.roles.length ? `${autoRoleForm.roles.length} rôle(s)` : 'Aucun rôle'} tone="violet" />
          <SummaryCard icon={Settings} title="Canal d'accueil" text={textChannels.find((channel) => channel.id === welcomeForm.channel_id)?.name || 'Non défini'} tone="emerald" />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="skeleton h-[420px] rounded-3xl" />
          <div className="skeleton h-[420px] rounded-3xl" />
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="spotlight-card space-y-5 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10">
                <Mail className="h-5 w-5 text-neon-cyan" />
              </div>
              <div>
                <p className="font-display text-lg font-700 text-white">{welcomeCopy.welcomeLabel}</p>
                <p className="mt-1 text-sm text-white/40">{welcomeCopy.welcomeHint}</p>
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/70">
              <span>Activer le message de bienvenue</span>
              <input
                type="checkbox"
                checked={welcomeForm.enabled}
                onChange={(event) => setWelcomeForm((current) => ({ ...current, enabled: event.target.checked }))}
                className="toggle-switch"
              />
            </label>

            <select
              className="select-field"
              value={welcomeForm.channel_id}
              onChange={(event) => setWelcomeForm((current) => ({ ...current, channel_id: event.target.value }))}
            >
              <option value="">Choisir un salon texte</option>
              {textChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>#{channel.name}</option>
              ))}
            </select>

            <textarea
              className="input-field min-h-[150px] resize-y"
              placeholder="Message de bienvenue public"
              value={welcomeForm.message}
              onChange={(event) => setWelcomeForm((current) => ({ ...current, message: event.target.value }))}
            />

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/70">
              <span>Envoyer aussi un DM</span>
              <input
                type="checkbox"
                checked={welcomeForm.send_dm}
                onChange={(event) => setWelcomeForm((current) => ({ ...current, send_dm: event.target.checked }))}
                className="toggle-switch"
              />
            </label>

            {welcomeForm.send_dm ? (
              <textarea
                className="input-field min-h-[120px] resize-y"
                placeholder="Message privé d'accueil"
                value={welcomeForm.dm_message}
                onChange={(event) => setWelcomeForm((current) => ({ ...current, dm_message: event.target.value }))}
              />
            ) : null}

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/70">
              <span>Envoyer en embed</span>
              <input
                type="checkbox"
                checked={welcomeForm.embed}
                onChange={(event) => setWelcomeForm((current) => ({ ...current, embed: event.target.checked }))}
                className="toggle-switch"
              />
            </label>

            <button
              type="button"
              onClick={() => setWelcomeForm((current) => ({
                ...current,
                message: '',
                dm_message: '',
                embed_title: '',
                template_locale: resolvedLocale,
              }))}
              className="inline-flex items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 font-mono text-sm text-white/68 transition-all hover:border-white/14 hover:bg-white/[0.05] hover:text-white"
            >
              {welcomeCopy.resetTemplate}
            </button>

            <div className="rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,24,38,0.95),rgba(9,12,20,0.94))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">{welcomeCopy.previewLabel}</p>
                  <p className="mt-2 text-sm text-white/50">{welcomeCopy.previewNote}</p>
                </div>
                <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                  {guild?.iconUrl ? (
                    <img src={guild.iconUrl} alt={guild?.name || 'serveur'} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center font-display text-lg font-800 text-neon-cyan">
                      {(guild?.name || 'D')[0]}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5 rounded-[24px] border border-neon-cyan/15 bg-neon-cyan/[0.04] p-4">
                <div className="flex items-start gap-4">
                  <img
                    src="https://cdn.discordapp.com/embed/avatars/0.png"
                    alt="avatar"
                    className="h-16 w-16 rounded-2xl border border-white/10 object-cover shadow-[0_14px_30px_rgba(0,0,0,0.24)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-3 py-1 text-[11px] font-mono text-neon-cyan">
                        #{textChannels.find((channel) => channel.id === welcomeForm.channel_id)?.name || 'accueil'}
                      </span>
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] font-mono text-white/45">
                        {welcomeForm.template_locale || resolvedLocale}
                      </span>
                    </div>
                    <p className="mt-3 font-display text-xl font-800 text-white">{welcomePreview.title}</p>
                    <p className="mt-3 text-sm leading-7 text-white/72">{welcomePreview.publicMessage}</p>
                    {welcomeForm.send_dm ? (
                      <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                        <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/35">DM</p>
                        <p className="mt-2 text-sm leading-7 text-white/68">{welcomePreview.dmMessage}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={saveWelcome}
              disabled={saving === 'welcome'}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 font-mono text-sm text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:opacity-50"
            >
              <CheckCircle2 className={`h-4 w-4 ${saving === 'welcome' ? 'animate-pulse' : ''}`} />
              {saving === 'welcome' ? 'Sauvegarde...' : 'Enregistrer'}
            </button>
          </div>

          <div className="spotlight-card space-y-5 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-500/20 bg-violet-500/10">
                <UserPlus className="h-5 w-5 text-violet-300" />
              </div>
              <div>
                <p className="font-display text-lg font-700 text-white">{welcomeCopy.autoRoleLabel}</p>
                <p className="mt-1 text-sm text-white/40">{welcomeCopy.autoRoleHint}</p>
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/70">
              <span>Activer l'auto-rôle</span>
              <input
                type="checkbox"
                checked={autoRoleForm.enabled}
                onChange={(event) => setAutoRoleForm((current) => ({ ...current, enabled: event.target.checked }))}
                className="toggle-switch"
              />
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((role) => {
                const active = autoRoleForm.roles.includes(role.id)
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => toggleRole(role.id)}
                    className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                      active
                        ? 'border-violet-400/20 bg-violet-500/10 text-violet-200'
                        : 'border-white/[0.06] bg-white/[0.02] text-white/65 hover:border-white/12'
                    }`}
                  >
                    <p className="font-display font-700">{role.name}</p>
                    <p className="mt-1 text-xs font-mono opacity-60">{role.id}</p>
                  </button>
                )
              })}
            </div>

            <select
              className="select-field"
              value={autoRoleForm.delay_ms}
              onChange={(event) => setAutoRoleForm((current) => ({ ...current, delay_ms: Number(event.target.value) }))}
            >
              {DELAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/70">
              <span>Ignorer les bots</span>
              <input
                type="checkbox"
                checked={autoRoleForm.only_humans}
                onChange={(event) => setAutoRoleForm((current) => ({ ...current, only_humans: event.target.checked }))}
                className="toggle-switch"
              />
            </label>

            <button
              type="button"
              onClick={saveAutoRoles}
              disabled={saving === 'roles'}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-violet-400/25 bg-violet-500/10 px-5 py-3 font-mono text-sm text-violet-200 transition-all hover:bg-violet-500/15 disabled:opacity-50"
            >
              <CheckCircle2 className={`h-4 w-4 ${saving === 'roles' ? 'animate-pulse' : ''}`} />
              {saving === 'roles' ? 'Sauvegarde...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
