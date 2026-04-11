import { useEffect, useMemo, useState } from 'react'
import { Bot, Eye, Gamepad2, Headphones, MessageSquareText, Radio, Save, SendHorizontal, Sparkles, Trophy } from 'lucide-react'
import toast from 'react-hot-toast'
import { botAPI, messagesAPI } from '../../services/api'

const STATUS_OPTIONS = [
  { value: 'online', label: 'En ligne' },
  { value: 'idle', label: 'Inactif' },
  { value: 'dnd', label: 'Ne pas déranger' },
  { value: 'invisible', label: 'Invisible' },
]

const ACTIVITY_OPTIONS = [
  { value: 'playing', label: 'Joue à', icon: Gamepad2 },
  { value: 'listening', label: 'Écoute', icon: Headphones },
  { value: 'watching', label: 'Regarde', icon: Eye },
  { value: 'competing', label: 'Participe à', icon: Trophy },
  { value: 'streaming', label: 'Diffuse', icon: Radio },
]

const DEFAULT_PROFILE = {
  username: '',
  bio: '',
  presence_status: 'online',
  activity_type: 'playing',
  activity_text: '',
  avatar_url: '',
  is_running: false,
}

function StudioCard({ title, subtitle, icon: Icon, children }) {
  return (
    <div className="rounded-[26px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,31,0.92),rgba(6,10,21,0.94))] p-5 shadow-[0_18px_60px_rgba(4,8,20,0.22)]">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.05]">
          <Icon className="h-5 w-5 text-neon-cyan" />
        </div>
        <div>
          <p className="font-display text-xl font-700 text-white">{title}</p>
          <p className="mt-1 text-sm leading-6 text-white/42">{subtitle}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  )
}

export default function BotStudioPanel({ selectedGuildId, selectedGuild, canManageBot, onProfileUpdated }) {
  const [profile, setProfile] = useState(DEFAULT_PROFILE)
  const [initialProfile, setInitialProfile] = useState(DEFAULT_PROFILE)
  const [channels, setChannels] = useState([])
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [messagePayload, setMessagePayload] = useState({
    channel_id: '',
    message: '',
  })

  const currentActivity = useMemo(
    () => ACTIVITY_OPTIONS.find((item) => item.value === profile.activity_type) || ACTIVITY_OPTIONS[0],
    [profile.activity_type]
  )

  useEffect(() => {
    if (!canManageBot) return

    let mounted = true
    setLoadingProfile(true)

    botAPI.profile()
      .then((response) => {
        if (!mounted) return
        const nextProfile = {
          username: response.data?.profile?.username || '',
          bio: response.data?.profile?.bio || '',
          presence_status: response.data?.profile?.presence_status || 'online',
          activity_type: response.data?.profile?.activity_type || 'playing',
          activity_text: response.data?.profile?.activity_text || '',
          avatar_url: response.data?.profile?.avatar_url || '',
          is_running: !!response.data?.profile?.is_running,
        }
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

  useEffect(() => {
    if (!selectedGuildId) {
      setChannels([])
      setMessagePayload((current) => ({ ...current, channel_id: '' }))
      return
    }

    let mounted = true
    setLoadingChannels(true)

    botAPI.channels(selectedGuildId)
      .then((response) => {
        if (!mounted) return
        const nextChannels = (response.data?.channels || [])
          .filter((channel) => [0, 5].includes(Number(channel?.type)))
          .map((channel) => ({
            id: String(channel.id),
            name: channel.name || `salon-${channel.id}`,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'))

        setChannels(nextChannels)
        setMessagePayload((current) => ({
          ...current,
          channel_id: nextChannels.some((item) => item.id === current.channel_id)
            ? current.channel_id
            : (nextChannels[0]?.id || ''),
        }))
      })
      .catch(() => {
        if (mounted) {
          setChannels([])
          setMessagePayload((current) => ({ ...current, channel_id: '' }))
        }
      })
      .finally(() => {
        if (mounted) setLoadingChannels(false)
      })

    return () => {
      mounted = false
    }
  }, [selectedGuildId])

  const handleProfileField = (field, value) => {
    setProfile((current) => ({ ...current, [field]: value }))
  }

  const handleSaveProfile = async () => {
    if (!canManageBot) return

    const payload = {}

    if (profile.username !== initialProfile.username) payload.username = profile.username.trim()
    if (profile.bio !== initialProfile.bio) payload.bio = profile.bio.trim()
    if (profile.presence_status !== initialProfile.presence_status) payload.presence_status = profile.presence_status
    if (profile.activity_type !== initialProfile.activity_type) payload.activity_type = profile.activity_type
    if (profile.activity_text !== initialProfile.activity_text) payload.activity_text = profile.activity_text.trim()

    if (!Object.keys(payload).length) {
      toast.success('Aucune modification à enregistrer')
      return
    }

    setSavingProfile(true)
    try {
      const response = await botAPI.updateProfile(payload)
      const nextProfile = {
        username: response.data?.profile?.username || profile.username,
        bio: response.data?.profile?.bio || '',
        presence_status: response.data?.profile?.presence_status || profile.presence_status,
        activity_type: response.data?.profile?.activity_type || profile.activity_type,
        activity_text: response.data?.profile?.activity_text || profile.activity_text,
        avatar_url: response.data?.profile?.avatar_url || profile.avatar_url,
        is_running: !!response.data?.profile?.is_running,
      }
      setProfile(nextProfile)
      setInitialProfile(nextProfile)
      onProfileUpdated?.()
      toast.success(nextProfile.is_running ? 'Bot mis à jour en temps réel' : 'Réglages enregistrés')
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Impossible de mettre à jour le bot')
    }
    setSavingProfile(false)
  }

  const handleSendMessage = async () => {
    if (!selectedGuildId || !messagePayload.channel_id || !messagePayload.message.trim()) return

    setSendingMessage(true)
    try {
      await messagesAPI.sendChannel(selectedGuildId, {
        channel_id: messagePayload.channel_id,
        message: messagePayload.message.trim(),
      })
      setMessagePayload((current) => ({ ...current, message: '' }))
      toast.success('Message envoyé')
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Impossible d envoyer le message')
    }
    setSendingMessage(false)
  }

  if (!canManageBot) {
    return (
      <StudioCard
        title="Studio bot"
        subtitle="Les réglages globaux du bot restent réservés au propriétaire du token."
        icon={Bot}
      >
        <div className="rounded-2xl border border-neon-cyan/18 bg-neon-cyan/[0.08] px-4 py-4 text-sm leading-6 text-white/62">
          Le contrôle avancé du bot n est disponible que depuis le compte principal qui héberge le token.
        </div>
      </StudioCard>
    )
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <StudioCard
        title="Studio bot"
        subtitle="Statut, activité, pseudo et bio modifiables en direct sur Discord."
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
              <p className="mt-1 text-sm text-white/45">{profile.is_running ? 'Modifications live actives' : 'Le bot est hors ligne, les réglages seront repris au prochain lancement'}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Statut Discord</span>
              <select
                value={profile.presence_status}
                onChange={(event) => handleProfileField('presence_status', event.target.value)}
                className="w-full rounded-2xl border border-white/[0.08] bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-neon-cyan/30"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Activité</span>
              <select
                value={profile.activity_type}
                onChange={(event) => handleProfileField('activity_type', event.target.value)}
                className="w-full rounded-2xl border border-white/[0.08] bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-neon-cyan/30"
              >
                {ACTIVITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Pseudo bot</span>
              <input
                type="text"
                value={profile.username}
                onChange={(event) => handleProfileField('username', event.target.value.slice(0, 32))}
                placeholder="Nexus"
                className="w-full rounded-2xl border border-white/[0.08] bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/22 focus:border-neon-cyan/30"
              />
            </label>

            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Texte d activité</span>
              <div className="relative">
                <input
                  type="text"
                  value={profile.activity_text}
                  onChange={(event) => handleProfileField('activity_text', event.target.value.slice(0, 128))}
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
            <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Bio bot</span>
            <textarea
              rows={4}
              value={profile.bio}
              onChange={(event) => handleProfileField('bio', event.target.value.slice(0, 300))}
              placeholder="Bot principal du serveur"
              className="w-full resize-none rounded-[24px] border border-white/[0.08] bg-slate-950/60 px-4 py-3 text-sm leading-6 text-white outline-none transition-colors placeholder:text-white/22 focus:border-neon-cyan/30"
            />
          </label>

          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={savingProfile || loadingProfile}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neon-cyan/22 bg-neon-cyan/10 px-4 py-3 text-sm font-mono text-neon-cyan transition-all hover:-translate-y-0.5 hover:bg-neon-cyan/18 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingProfile ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current/25 border-t-current" /> : <Save className="h-4 w-4" />}
            Enregistrer
          </button>
        </div>
      </StudioCard>

      <StudioCard
        title="Message direct"
        subtitle="Choisis un salon textuel puis fais parler le bot instantanément."
        icon={MessageSquareText}
      >
        {!selectedGuildId ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-sm leading-6 text-white/58">
            Sélectionne d abord un serveur actif pour écrire dans un salon avec le bot.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-4">
              <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/28">Serveur actif</p>
              <p className="mt-2 font-display text-lg font-700 text-white">{selectedGuild?.name || 'Serveur sélectionné'}</p>
            </div>

            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Salon</span>
              <select
                value={messagePayload.channel_id}
                onChange={(event) => setMessagePayload((current) => ({ ...current, channel_id: event.target.value }))}
                disabled={loadingChannels || channels.length === 0}
                className="w-full rounded-2xl border border-white/[0.08] bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-neon-cyan/30 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {channels.length === 0 ? (
                  <option value="">{loadingChannels ? 'Chargement...' : 'Aucun salon textuel détecté'}</option>
                ) : (
                  channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>#{channel.name}</option>
                  ))
                )}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Message</span>
              <textarea
                rows={7}
                value={messagePayload.message}
                onChange={(event) => setMessagePayload((current) => ({ ...current, message: event.target.value.slice(0, 2000) }))}
                placeholder="Écris ici le message que le bot doit envoyer."
                className="w-full resize-none rounded-[24px] border border-white/[0.08] bg-slate-950/60 px-4 py-3 text-sm leading-6 text-white outline-none transition-colors placeholder:text-white/22 focus:border-neon-cyan/30"
              />
            </label>

            <button
              type="button"
              onClick={handleSendMessage}
              disabled={sendingMessage || !messagePayload.channel_id || !messagePayload.message.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/22 bg-emerald-400/10 px-4 py-3 text-sm font-mono text-emerald-300 transition-all hover:-translate-y-0.5 hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sendingMessage ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current/25 border-t-current" /> : <SendHorizontal className="h-4 w-4" />}
              Envoyer avec le bot
            </button>
          </div>
        )}
      </StudioCard>
    </div>
  )
}
