import { useEffect, useMemo, useState } from 'react'
import { Bot, Eye, Gamepad2, Headphones, Radio, Save, Sparkles, Trophy } from 'lucide-react'
import toast from 'react-hot-toast'
import { botAPI } from '../../services/api'
import BotStudioCard from './BotStudioCard'

const STATUS_OPTIONS = [
  { value: 'online', label: 'En ligne' },
  { value: 'idle', label: 'Inactif' },
  { value: 'dnd', label: 'Ne pas deranger' },
  { value: 'invisible', label: 'Invisible' },
]

const ACTIVITY_OPTIONS = [
  { value: 'playing', label: 'Joue a', icon: Gamepad2 },
  { value: 'listening', label: 'Ecoute', icon: Headphones },
  { value: 'watching', label: 'Regarde', icon: Eye },
  { value: 'competing', label: 'Participe a', icon: Trophy },
  { value: 'streaming', label: 'Diffuse', icon: Radio },
]

const DEFAULT_PROFILE = {
  username: '',
  description: '',
  presence_status: 'online',
  activity_type: 'playing',
  activity_text: '',
  avatar_url: '',
  is_running: false,
}

function normalizeProfile(rawProfile) {
  return {
    username: rawProfile?.username || '',
    description: rawProfile?.bio || '',
    presence_status: rawProfile?.presence_status || 'online',
    activity_type: rawProfile?.activity_type || 'playing',
    activity_text: rawProfile?.activity_text || '',
    avatar_url: rawProfile?.avatar_url || '',
    is_running: !!rawProfile?.is_running,
  }
}

export default function BotCustomizationPanel({ canManageBot, onProfileUpdated }) {
  const [profile, setProfile] = useState(DEFAULT_PROFILE)
  const [initialProfile, setInitialProfile] = useState(DEFAULT_PROFILE)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  const currentActivity = useMemo(
    () => ACTIVITY_OPTIONS.find((item) => item.value === profile.activity_type) || ACTIVITY_OPTIONS[0],
    [profile.activity_type]
  )

  useEffect(() => {
    if (!canManageBot) return undefined

    let mounted = true
    setLoadingProfile(true)

    botAPI.profile()
      .then((response) => {
        if (!mounted) return
        const nextProfile = normalizeProfile(response.data?.profile)
        setProfile(nextProfile)
        setInitialProfile(nextProfile)
      })
      .catch((error) => {
        toast.error(error?.response?.data?.error || 'Impossible de charger le profil du bot')
      })
      .finally(() => {
        if (mounted) setLoadingProfile(false)
      })

    return () => {
      mounted = false
    }
  }, [canManageBot])

  const handleField = (field, value) => {
    setProfile((current) => ({ ...current, [field]: value }))
  }

  const handleSave = async () => {
    if (!canManageBot) return

    const payload = {}

    if (profile.username !== initialProfile.username) payload.username = profile.username.trim()
    if (profile.description !== initialProfile.description) payload.bio = profile.description.trim()
    if (profile.presence_status !== initialProfile.presence_status) payload.presence_status = profile.presence_status
    if (profile.activity_type !== initialProfile.activity_type) payload.activity_type = profile.activity_type
    if (profile.activity_text !== initialProfile.activity_text) payload.activity_text = profile.activity_text.trim()

    if (!Object.keys(payload).length) {
      toast.success('Aucune modification a enregistrer')
      return
    }

    setSavingProfile(true)
    try {
      const response = await botAPI.updateProfile(payload)
      const nextProfile = normalizeProfile(response.data?.profile)
      setProfile(nextProfile)
      setInitialProfile(nextProfile)
      onProfileUpdated?.()
      toast.success(nextProfile.is_running ? 'Bot mis a jour en temps reel' : 'Reglages enregistres')
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Impossible de mettre a jour le bot')
    } finally {
      setSavingProfile(false)
    }
  }

  if (!canManageBot) {
    return (
      <BotStudioCard
        title="Personnalisation du bot"
        subtitle="Ces reglages restent reserves au proprietaire principal du token."
        icon={Sparkles}
      >
        <div className="rounded-2xl border border-neon-cyan/18 bg-neon-cyan/[0.08] px-4 py-4 text-sm leading-6 text-white/62">
          Le controle avance du bot est disponible uniquement depuis le compte principal.
        </div>
      </BotStudioCard>
    )
  }

  return (
    <BotStudioCard
      title="Personnalisation du bot"
      subtitle="Statut, activite, pseudo et description modifies en direct sur Discord."
      icon={Sparkles}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-4 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.04]">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Bot className="h-9 w-9 text-neon-cyan" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-2xl font-800 text-white">{profile.username || 'Bot Discord'}</p>
            <p className="mt-1 text-sm text-white/45">
              {profile.is_running ? 'Modifications live actives' : 'Le bot est hors ligne, les reglages seront repris au prochain lancement'}
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Statut Discord</span>
            <select
              value={profile.presence_status}
              onChange={(event) => handleField('presence_status', event.target.value)}
              className="w-full rounded-2xl border border-white/[0.08] bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-neon-cyan/30"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Type d'activite</span>
            <select
              value={profile.activity_type}
              onChange={(event) => handleField('activity_type', event.target.value)}
              className="w-full rounded-2xl border border-white/[0.08] bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-neon-cyan/30"
            >
              {ACTIVITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Pseudo du bot</span>
            <input
              type="text"
              value={profile.username}
              onChange={(event) => handleField('username', event.target.value.slice(0, 32))}
              placeholder="Nexus"
              className="w-full rounded-2xl border border-white/[0.08] bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/22 focus:border-neon-cyan/30"
            />
          </label>

          <label className="space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Texte affiche sur Discord</span>
            <div className="relative">
              <input
                type="text"
                value={profile.activity_text}
                onChange={(event) => handleField('activity_text', event.target.value.slice(0, 128))}
                placeholder={currentActivity?.value === 'playing' ? 'Roblox' : 'DiscordForger'}
                className="w-full rounded-2xl border border-white/[0.08] bg-slate-950/60 px-4 py-3 pr-24 text-sm text-white outline-none transition-colors placeholder:text-white/22 focus:border-neon-cyan/30"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-mono text-white/25">
                {profile.activity_text.length}/128
              </span>
            </div>
          </label>
        </div>

        <label className="space-y-2">
          <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Description du bot</span>
          <textarea
            rows={4}
            value={profile.description}
            onChange={(event) => handleField('description', event.target.value.slice(0, 300))}
            placeholder="Bot principal du serveur"
            className="w-full resize-none rounded-[24px] border border-white/[0.08] bg-slate-950/60 px-4 py-3 text-sm leading-6 text-white outline-none transition-colors placeholder:text-white/22 focus:border-neon-cyan/30"
          />
        </label>

        <button
          type="button"
          onClick={handleSave}
          disabled={savingProfile || loadingProfile}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neon-cyan/22 bg-neon-cyan/10 px-4 py-3 text-sm font-mono text-neon-cyan transition-all hover:-translate-y-0.5 hover:bg-neon-cyan/18 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {savingProfile ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current/25 border-t-current" /> : <Save className="h-4 w-4" />}
          Enregistrer
        </button>
      </div>
    </BotStudioCard>
  )
}
