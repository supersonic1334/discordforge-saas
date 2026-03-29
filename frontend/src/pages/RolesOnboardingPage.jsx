import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Mail, Settings, Shield, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { botAPI, modulesAPI } from '../services/api'
import { useGuildStore } from '../stores'

const TEXT_CHANNEL_TYPES = [0, 5, 11, 12, 15]
const DELAY_OPTIONS = [
  { value: 0, label: 'Immédiat' },
  { value: 5000, label: '5 secondes' },
  { value: 30000, label: '30 secondes' },
  { value: 120000, label: '2 minutes' },
]

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Erreur inattendue'
}

function normalizeWelcome(moduleData) {
  return {
    enabled: !!moduleData?.enabled,
    channel_id: moduleData?.simple_config?.channel_id || '',
    message: moduleData?.simple_config?.message || '',
    send_dm: !!moduleData?.advanced_config?.send_dm,
    dm_message: moduleData?.advanced_config?.dm_message || '',
    embed: !!moduleData?.advanced_config?.embed,
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
      <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center ${tones[tone]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="mt-4 font-display font-700 text-white">{title}</p>
      <p className="mt-1 text-sm text-white/50 leading-relaxed">{text}</p>
    </div>
  )
}

export default function RolesOnboardingPage() {
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [roles, setRoles] = useState([])
  const [channels, setChannels] = useState([])
  const [welcomeForm, setWelcomeForm] = useState(normalizeWelcome(null))
  const [autoRoleForm, setAutoRoleForm] = useState(normalizeAutoRole(null))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')

  const textChannels = useMemo(
    () => channels.filter((channel) => TEXT_CHANNEL_TYPES.includes(Number(channel?.type))),
    [channels],
  )

  useEffect(() => {
    setRoles([])
    setChannels([])
    setWelcomeForm(normalizeWelcome(null))
    setAutoRoleForm(normalizeAutoRole(null))
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return
    let active = true

    async function loadData() {
      setLoading(true)
      try {
        const [rolesResponse, channelsResponse, welcomeResponse, autoRoleResponse] = await Promise.all([
          botAPI.roles(selectedGuildId),
          botAPI.channels(selectedGuildId),
          modulesAPI.get(selectedGuildId, 'WELCOME_MESSAGE'),
          modulesAPI.get(selectedGuildId, 'AUTO_ROLE'),
        ])

        if (!active) return
        setRoles(rolesResponse.data?.roles || rolesResponse.data || [])
        setChannels(channelsResponse.data?.channels || channelsResponse.data || [])
        setWelcomeForm(normalizeWelcome(welcomeResponse.data))
        setAutoRoleForm(normalizeAutoRole(autoRoleResponse.data))
      } catch (error) {
        toast.error(getErrorMessage(error))
      } finally {
        if (active) setLoading(false)
      }
    }

    loadData()
    return () => {
      active = false
    }
  }, [selectedGuildId])

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
      await modulesAPI.toggle(selectedGuildId, 'WELCOME_MESSAGE', welcomeForm.enabled)
      await modulesAPI.config(selectedGuildId, 'WELCOME_MESSAGE', {
        simple_config: {
          channel_id: welcomeForm.channel_id || null,
          message: welcomeForm.message,
        },
        advanced_config: {
          send_dm: !!welcomeForm.send_dm,
          dm_message: welcomeForm.dm_message,
          embed: !!welcomeForm.embed,
        },
      })
      toast.success('Onboarding de bienvenue mis à jour')
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
      <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto">
        <div className="glass-card p-10 text-center">
          <UserPlus className="w-12 h-12 text-white/10 mx-auto mb-4" />
          <p className="font-display font-700 text-white text-xl">Choisis d'abord un serveur</p>
          <p className="text-white/40 mt-2">Rôles & Onboarding dépend du serveur actif.</p>
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
              <span className="feature-chip"><UserPlus className="w-3.5 h-3.5" /> rôles & onboarding</span>
              <span className="feature-chip"><Mail className="w-3.5 h-3.5" /> accueil</span>
              <span className="feature-chip"><Shield className="w-3.5 h-3.5" /> {guild?.name || 'serveur'}</span>
            </div>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">Rôles & Onboarding</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 sm:text-[15px]">
                Configure l’arrivée des nouveaux membres sans ouvrir dix modules: message de bienvenue, DM d’accueil et auto-rôles.
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-3">
          <SummaryCard icon={Mail} title="Accueil" text={welcomeForm.enabled ? 'Actif' : 'Inactif'} tone="cyan" />
          <SummaryCard icon={UserPlus} title="Auto-rôles" text={autoRoleForm.roles.length ? `${autoRoleForm.roles.length} rôle(s)` : 'Aucun rôle'} tone="violet" />
          <SummaryCard icon={Settings} title="Canal d’accueil" text={textChannels.find((channel) => channel.id === welcomeForm.channel_id)?.name || 'Non défini'} tone="emerald" />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="h-[420px] rounded-3xl skeleton" />
          <div className="h-[420px] rounded-3xl skeleton" />
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="spotlight-card p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 flex items-center justify-center shrink-0">
                <Mail className="w-5 h-5 text-neon-cyan" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Bienvenue</p>
                <p className="text-white/40 text-sm mt-1">Message public + DM d’accueil.</p>
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
              className="input-field min-h-[160px] resize-y"
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

            {welcomeForm.send_dm && (
              <textarea
                className="input-field min-h-[120px] resize-y"
                placeholder="Message privé d’accueil"
                value={welcomeForm.dm_message}
                onChange={(event) => setWelcomeForm((current) => ({ ...current, dm_message: event.target.value }))}
              />
            )}

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
              onClick={saveWelcome}
              disabled={saving === 'welcome'}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:opacity-50"
            >
              <CheckCircle2 className={`w-4 h-4 ${saving === 'welcome' ? 'animate-pulse' : ''}`} />
              {saving === 'welcome' ? 'Sauvegarde...' : 'Enregistrer'}
            </button>
          </div>

          <div className="spotlight-card p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0">
                <UserPlus className="w-5 h-5 text-violet-300" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Auto-rôles</p>
                <p className="text-white/40 text-sm mt-1">Donne automatiquement les bons rôles à l’arrivée.</p>
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/70">
              <span>Activer l’auto-rôle</span>
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
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-violet-400/25 bg-violet-500/10 px-5 py-3 text-sm font-mono text-violet-200 transition-all hover:bg-violet-500/15 disabled:opacity-50"
            >
              <CheckCircle2 className={`w-4 h-4 ${saving === 'roles' ? 'animate-pulse' : ''}`} />
              {saving === 'roles' ? 'Sauvegarde...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
