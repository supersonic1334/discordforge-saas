import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Activity, ArrowRight, BellRing, CheckCircle2, Command, Compass, Cpu, Gauge, Play, RefreshCw, Rocket, RotateCcw, ScrollText, Search, Server, Shield, Sparkles, Square, TrendingUp, Unplug, Users, Wifi } from 'lucide-react'
import toast from 'react-hot-toast'
import { botAPI } from '../services/api'
import { useAuthStore, useGuildStore, useBotStore } from '../stores'
import { wsService } from '../services/websocket'
import { useI18n } from '../i18n'

function DashboardPanel({ children, className = '', delay = 0, glow = 'cyan' }) {
  const glowClasses = {
    cyan: 'from-neon-cyan/18 via-neon-cyan/6 to-transparent',
    violet: 'from-neon-violet/18 via-neon-violet/8 to-transparent',
    green: 'from-emerald-400/18 via-emerald-400/6 to-transparent',
    amber: 'from-amber-400/18 via-amber-400/6 to-transparent',
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.42, ease: 'easeOut' }}
      whileHover={{ y: -4, scale: 1.005 }}
      className={`glass-card relative overflow-hidden border border-white/[0.08] shadow-[0_20px_80px_rgba(3,8,20,0.34)] ${className}`}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${glowClasses[glow] || glowClasses.cyan}`} />
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="relative">{children}</div>
    </motion.div>
  )
}

function StatCard({ icon: Icon, label, value, meta, tone = 'cyan', delay = 0 }) {
  const toneClasses = {
    cyan: 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/20',
    violet: 'text-neon-violet bg-neon-violet/10 border-neon-violet/20',
    green: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20',
    amber: 'text-amber-300 bg-amber-400/10 border-amber-400/20',
  }

  return (
    <DashboardPanel delay={delay} glow={tone} className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className={`rounded-2xl border p-3 ${toneClasses[tone] || toneClasses.cyan}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-white/45">
          {meta}
        </div>
      </div>
      <div className="mt-6">
        <p className="font-display text-3xl font-800 text-white">{value}</p>
        <p className="mt-1 text-sm text-white/45">{label}</p>
      </div>
    </DashboardPanel>
  )
}

function ActionButton({ icon: Icon, label, tone = 'cyan', onClick, disabled, loading }) {
  const toneClasses = {
    cyan: 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/18',
    green: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/18',
    red: 'border-red-400/20 bg-red-400/10 text-red-300 hover:bg-red-400/18',
    violet: 'border-neon-violet/20 bg-neon-violet/10 text-neon-violet hover:bg-neon-violet/18',
  }

  return (
    <motion.button
      type="button"
      whileHover={disabled ? undefined : { y: -2, scale: 1.01 }}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-w-[112px] items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-mono transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-35 ${toneClasses[tone] || toneClasses.cyan}`}
    >
      {loading ? (
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current/25 border-t-current" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
      <span>{label}</span>
    </motion.button>
  )
}

function QuickLinkCard({ icon: Icon, title, desc, path, tone = 'cyan' }) {
  const toneClasses = {
    cyan: 'text-neon-cyan',
    violet: 'text-neon-violet',
    green: 'text-emerald-300',
    amber: 'text-amber-300',
  }

  return (
    <motion.div whileHover={{ y: -4, scale: 1.01 }} whileTap={{ scale: 0.985 }}>
      <Link
        to={path}
        className="glass-card-hover relative block overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.035] p-5 shadow-[0_20px_60px_rgba(3,8,20,0.22)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.14),transparent_40%)] opacity-90" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="space-y-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.05]">
              <Icon className={`h-5 w-5 ${toneClasses[tone] || toneClasses.cyan}`} />
            </div>
            <div>
              <p className="font-display text-base font-700 text-white">{title}</p>
              <p className="mt-1 text-sm leading-6 text-white/45">{desc}</p>
            </div>
          </div>
          <div className="rounded-full border border-white/[0.08] bg-white/[0.05] p-2 text-white/35 transition-colors group-hover:text-white/70">
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

function GuildAvatar({ guild, className = 'h-14 w-14 rounded-2xl' }) {
  if (guild?.iconUrl) {
    return <img src={guild.iconUrl} alt="" className={`${className} object-cover shadow-[0_16px_34px_rgba(34,211,238,0.15)]`} />
  }

  return (
    <div className={`${className} flex items-center justify-center bg-gradient-to-br from-neon-cyan/24 via-neon-violet/18 to-white/5 font-display text-lg font-800 text-neon-cyan shadow-[0_16px_34px_rgba(34,211,238,0.15)]`}>
      {guild?.name?.[0] || '?'}
    </div>
  )
}

export default function Dashboard() {
  const { t, locale } = useI18n()
  const { user, hasOwnBotToken, sharedGuildCount } = useAuthStore()
  const { guilds, selectedGuildId, selectGuild, clearSelectedGuild, fetchGuilds, syncGuilds } = useGuildStore()
  const { status, ping, startedAt, fetchStatus, setStatus } = useBotStore()
  const [actionLoading, setActionLoading] = useState(null)
  const [timeTick, setTimeTick] = useState(() => Date.now())
  const navigate = useNavigate()
  const canAccessOsintTools = ['founder', 'osint'].includes(user?.role)

  const selectedGuild = guilds.find((guild) => guild.id === selectedGuildId) || null

  useEffect(() => {
    fetchGuilds()
    fetchStatus()
    const uptimeInterval = setInterval(() => setTimeTick(Date.now()), 30000)
    const unsub1 = wsService.on('bot:statusChange', (payload) => setStatus(payload))
    const unsub2 = wsService.on('bot:guildUpdate', () => fetchGuilds())
    const unsub3 = wsService.on('bot:ready', () => fetchGuilds())
    return () => {
      clearInterval(uptimeInterval)
      unsub1()
      unsub2()
      unsub3()
    }
  }, [])

  const botAction = async (action) => {
    setActionLoading(action)
    try {
      if (action === 'start') await botAPI.start()
      else if (action === 'stop') await botAPI.stop()
      else if (action === 'restart') await botAPI.restart()

      const successKey = action === 'start'
        ? 'dashboard.toasts.started'
        : action === 'stop'
          ? 'dashboard.toasts.stopped'
          : 'dashboard.toasts.restarted'

      toast.success(t(successKey))
      setTimeout(fetchStatus, 1800)
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || t('dashboard.toasts.actionError'))
    }
    setActionLoading(null)
  }

  const uptime = startedAt ? Math.floor((timeTick - new Date(startedAt).getTime()) / 60000) : 0
  const totalMembers = useMemo(
    () => guilds.reduce((sum, guild) => sum + Number(guild.member_count || 0), 0),
    [guilds]
  )
  const sharedGuilds = useMemo(
    () => guilds.filter((guild) => guild.is_shared).length,
    [guilds]
  )
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale || 'fr-FR'), [locale])

  const statusColor = {
    running: 'text-emerald-300',
    starting: 'text-amber-300',
    reconnecting: 'text-sky-300',
    stopped: 'text-white/35',
    error: 'text-red-300',
  }[status] || 'text-white/35'

  const statusChipTone = {
    running: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
    starting: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
    reconnecting: 'border-sky-400/20 bg-sky-400/10 text-sky-300',
    stopped: 'border-white/[0.08] bg-white/[0.05] text-white/45',
    error: 'border-red-400/20 bg-red-400/10 text-red-300',
  }[status] || 'border-white/[0.08] bg-white/[0.05] text-white/45'

  const situationCards = [
    {
      label: 'Mode d acces',
      value: hasOwnBotToken ? 'Proprietaire' : 'Partage',
      detail: hasOwnBotToken ? 'Controle complet du bot et des synchronisations.' : 'Acces partage avec modules synchronises.',
      icon: Shield,
      tone: 'cyan',
    },
    {
      label: 'Passerelle',
      value: ping > 0 ? `${ping}ms` : 'Indisponible',
      detail: ping > 0 ? 'Connexion WebSocket stable.' : 'Le ping n est pas encore disponible.',
      icon: Wifi,
      tone: 'green',
    },
    {
      label: 'Serveur actif',
      value: selectedGuild ? selectedGuild.name : 'Aucun',
      detail: selectedGuild ? `${numberFormatter.format(selectedGuild.member_count || 0)} membres surveilles.` : 'Selectionne un serveur pour tout piloter.',
      icon: Server,
      tone: 'violet',
    },
    {
      label: 'Session bot',
      value: status === 'running' ? `${uptime} min` : 'Hors ligne',
      detail: startedAt && status === 'running'
        ? `En ligne depuis ${new Date(startedAt).toLocaleTimeString(locale)}.`
        : 'Relance le bot pour reactiver tous les modules.',
      icon: Gauge,
      tone: 'amber',
    },
  ]

  const quickLinks = [
    {
      icon: Shield,
      title: 'Protection',
      desc: 'Active les modules et verrouille vite les bons reglages.',
      path: '/dashboard/protection',
      tone: 'cyan',
    },
    {
      icon: Search,
      title: 'Recherche',
      desc: 'Retrouve un membre et lance une action en quelques secondes.',
      path: '/dashboard/search',
      tone: 'amber',
    },
    {
      icon: ScrollText,
      title: 'Logs',
      desc: 'Lis les evenements site, moderation et Discord sans te perdre.',
      path: '/dashboard/logs',
      tone: 'green',
    },
    ...(canAccessOsintTools ? [{
      icon: Compass,
      title: 'OSINT',
      desc: 'Lance un tracker de pseudos et une geolocalisation d image sans quitter le cockpit.',
      path: '/dashboard/osint',
      tone: 'green',
    }] : []),
    {
      icon: BellRing,
      title: 'Messages',
      desc: 'Envoie des MP et configure les notifications plus proprement.',
      path: '/dashboard/messages',
      tone: 'violet',
    },
    {
      icon: Command,
      title: 'Commandes',
      desc: 'Monte des commandes plus flexibles et automatise tes workflows.',
      path: '/dashboard/commands',
      tone: 'cyan',
    },
    {
      icon: Sparkles,
      title: 'Assistant IA',
      desc: 'Passe en configuration guidee et delegue les actions complexes.',
      path: '/dashboard/ai',
      tone: 'violet',
    },
  ]

  const cockpitLinks = [
    { label: 'Protection', path: '/dashboard/protection' },
    { label: 'Recherche', path: '/dashboard/search' },
    ...(canAccessOsintTools ? [{ label: 'OSINT', path: '/dashboard/osint' }] : []),
    { label: 'Logs', path: '/dashboard/logs' },
    { label: 'Messages', path: '/dashboard/messages' },
  ]

  const disconnectSelectedGuild = () => {
    clearSelectedGuild()
    navigate('/dashboard/servers')
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:px-5 sm:py-6">
      <div className="grid gap-6 xl:grid-cols-[1.55fr_0.95fr]">
        <DashboardPanel glow="cyan" className="p-6 sm:p-7">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.18),transparent_40%)]" />
          <div className="relative flex h-full flex-col gap-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-mono ${statusChipTone}`}>
                  <span className={`h-2 w-2 rounded-full ${
                    status === 'running'
                      ? 'bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]'
                      : status === 'starting' || status === 'reconnecting'
                        ? 'bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.65)]'
                        : status === 'error'
                          ? 'bg-red-300'
                          : 'bg-white/30'
                  }`} />
                  {t(`layout.status.${status}`, status)}
                </div>
                <h1 className="mt-4 font-display text-3xl font-800 text-white sm:text-[2.6rem]">
                  Centre de pilotage <span className="neon-text">{user?.username}</span>
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50 sm:text-[15px]">
                  Vue d ensemble plus claire pour lancer le bot, garder un serveur en focus et ouvrir les modules importants sans perdre de temps.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:min-w-[260px]">
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 backdrop-blur-md">
                  <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-white/35">Serveurs</p>
                  <p className="mt-2 font-display text-2xl font-800 text-white">{guilds.length}</p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 backdrop-blur-md">
                  <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-white/35">Partages</p>
                  <p className="mt-2 font-display text-2xl font-800 text-white">{sharedGuildCount || sharedGuilds}</p>
                </div>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[28px] border border-white/[0.08] bg-white/[0.04] p-5 shadow-[0_20px_70px_rgba(4,8,20,0.25)] backdrop-blur-xl">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-4">
                    <GuildAvatar guild={selectedGuild || guilds[0]} className="h-16 w-16 rounded-[22px]" />
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-white/45">
                        <Rocket className="h-3.5 w-3.5 text-neon-cyan" />
                        {selectedGuild ? 'Serveur en focus' : 'Serveur a choisir'}
                      </div>
                      <p className="mt-3 truncate font-display text-2xl font-800 text-white">
                        {selectedGuild?.name || 'Selectionne un serveur pour commencer'}
                      </p>
                      <p className="mt-1 text-sm text-white/45">
                        {selectedGuild
                          ? `${numberFormatter.format(selectedGuild.member_count || 0)} membres relies · ${selectedGuild.is_shared ? 'acces partage' : 'serveur proprietaire'}`
                          : 'Tu pourras ensuite moderer, consulter les logs, piloter les commandes et ouvrir l assistant IA.'}
                      </p>
                    </div>
                  </div>

                  {selectedGuild && (
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/18 bg-emerald-400/10 px-3 py-1.5 text-xs font-mono text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Pret a gerer
                    </div>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {cockpitLinks.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-xs font-mono text-white/65 transition-all duration-200 hover:-translate-y-0.5 hover:border-neon-cyan/30 hover:bg-neon-cyan/[0.08] hover:text-neon-cyan"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => (selectedGuild ? navigate('/dashboard/search') : navigate('/dashboard/servers'))}
                    className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-left transition-all duration-200 hover:-translate-y-1 hover:border-neon-cyan/30 hover:bg-neon-cyan/[0.07]"
                  >
                    <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Action rapide</p>
                    <p className="mt-2 font-display text-base font-700 text-white">{selectedGuild ? 'Moderer un membre' : 'Choisir un serveur'}</p>
                    <p className="mt-1 text-xs leading-5 text-white/40">
                      {selectedGuild ? 'Passe direct en recherche avec ton serveur actif deja charge.' : 'Active un serveur pour debloquer tous les modules du cockpit.'}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => (selectedGuild ? navigate('/dashboard/logs') : navigate('/dashboard/servers'))}
                    className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-left transition-all duration-200 hover:-translate-y-1 hover:border-neon-violet/30 hover:bg-neon-violet/[0.07]"
                  >
                    <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Visibilite</p>
                    <p className="mt-2 font-display text-base font-700 text-white">Voir l activite</p>
                    <p className="mt-1 text-xs leading-5 text-white/40">Accede aux evenements site, moderation et Discord sans changer de logique.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => (selectedGuild ? navigate('/dashboard/commands') : navigate('/dashboard/servers'))}
                    className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-left transition-all duration-200 hover:-translate-y-1 hover:border-emerald-400/30 hover:bg-emerald-400/[0.07]"
                  >
                    <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Automation</p>
                    <p className="mt-2 font-display text-base font-700 text-white">Construire des commandes</p>
                    <p className="mt-1 text-xs leading-5 text-white/40">Passe vite des idees au systeme de commandes sans repartir de zero.</p>
                  </button>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,18,34,0.86),rgba(5,10,22,0.9))] p-5 shadow-[0_20px_70px_rgba(4,8,20,0.25)] backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-white/30">Controle bot</p>
                    <p className="mt-2 font-display text-xl font-700 text-white">Etat et puissance</p>
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-xs font-mono ${statusChipTone}`}>
                    {status === 'running' ? 'En ligne' : status === 'stopped' ? 'Hors ligne' : t(`layout.status.${status}`, status)}
                  </div>
                </div>

                <div className="mt-5 rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-white/45">Statut actuel</p>
                      <p className={`mt-1 font-display text-2xl font-800 ${statusColor}`}>{t(`layout.status.${status}`, status)}</p>
                    </div>
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]">
                      <div className={`absolute inset-3 rounded-full ${
                        status === 'running'
                          ? 'bg-emerald-300/20 shadow-[0_0_30px_rgba(110,231,183,0.55)]'
                          : status === 'error'
                            ? 'bg-red-300/15 shadow-[0_0_30px_rgba(252,165,165,0.35)]'
                            : 'bg-neon-cyan/12 shadow-[0_0_30px_rgba(34,211,238,0.3)]'
                      }`} />
                      <Cpu className="relative z-10 h-6 w-6 text-white/90" />
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-white/45">
                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                      <p className="font-mono uppercase tracking-[0.18em] text-white/25">Ping</p>
                      <p className="mt-1 text-sm font-600 text-white">{ping > 0 ? `${ping}ms` : 'Indisponible'}</p>
                    </div>
                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                      <p className="font-mono uppercase tracking-[0.18em] text-white/25">Uptime</p>
                      <p className="mt-1 text-sm font-600 text-white">{status === 'running' ? `${uptime} min` : '0 min'}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <ActionButton
                    icon={Play}
                    label={t('dashboard.controls.start')}
                    tone="green"
                    onClick={() => botAction('start')}
                    disabled={!hasOwnBotToken || status === 'running' || status === 'starting' || !!actionLoading}
                    loading={actionLoading === 'start'}
                  />
                  <ActionButton
                    icon={Square}
                    label={t('dashboard.controls.stop')}
                    tone="red"
                    onClick={() => botAction('stop')}
                    disabled={!hasOwnBotToken || status === 'stopped' || status === 'error' || !!actionLoading}
                    loading={actionLoading === 'stop'}
                  />
                  <ActionButton
                    icon={RotateCcw}
                    label={t('dashboard.controls.restart')}
                    tone="violet"
                    onClick={() => botAction('restart')}
                    disabled={!hasOwnBotToken || !!actionLoading}
                    loading={actionLoading === 'restart'}
                  />
                </div>

                {!hasOwnBotToken && sharedGuildCount > 0 && (
                  <div className="mt-4 rounded-2xl border border-neon-cyan/18 bg-neon-cyan/[0.08] px-4 py-3 text-sm leading-6 text-white/60">
                    Tu utilises un acces partage : les modules restent synchronises, mais seul le proprietaire peut relancer le bot ou resynchroniser les serveurs bruts.
                  </div>
                )}
              </div>
            </div>
          </div>
        </DashboardPanel>

        <div className="space-y-6">
          <DashboardPanel glow="violet" delay={0.08} className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-white/30">Situation</p>
                <p className="mt-2 font-display text-xl font-700 text-white">Vue operationnelle</p>
              </div>
              <button
                type="button"
                onClick={syncGuilds}
                disabled={!hasOwnBotToken}
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/55 transition-all hover:-translate-y-0.5 hover:border-neon-cyan/30 hover:bg-neon-cyan/[0.08] hover:text-neon-cyan disabled:cursor-not-allowed disabled:opacity-35"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Synchroniser
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {situationCards.map((card, index) => {
                const Icon = card.icon
                return (
                  <motion.div
                    key={card.label}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.12 + index * 0.05, duration: 0.35 }}
                    whileHover={{ x: 3 }}
                    className="rounded-[22px] border border-white/[0.08] bg-white/[0.03] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.05]">
                        <Icon className={`h-5 w-5 ${
                          card.tone === 'cyan'
                            ? 'text-neon-cyan'
                            : card.tone === 'violet'
                              ? 'text-neon-violet'
                              : card.tone === 'green'
                                ? 'text-emerald-300'
                                : 'text-amber-300'
                        }`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-mono uppercase tracking-[0.18em] text-white/28">{card.label}</p>
                            <p className="mt-1 font-display text-lg font-700 text-white">{card.value}</p>
                          </div>
                          <ArrowRight className="mt-1 h-4 w-4 text-white/20" />
                        </div>
                        <p className="mt-1 text-sm leading-6 text-white/45">{card.detail}</p>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </DashboardPanel>

          <DashboardPanel glow="green" delay={0.14} className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-white/30">Serveurs</p>
                <p className="mt-2 font-display text-xl font-700 text-white">Liste active</p>
              </div>
              <Link to="/dashboard/servers" className="inline-flex items-center gap-2 text-xs font-mono text-neon-cyan/70 transition-colors hover:text-neon-cyan">
                Tout voir
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {guilds.length === 0 ? (
              <div className="mt-5 rounded-[24px] border border-dashed border-white/[0.08] bg-white/[0.025] px-5 py-8 text-center">
                <Server className="mx-auto h-8 w-8 text-white/18" />
                <p className="mt-3 font-display text-lg font-700 text-white/70">{t('dashboard.noServersTitle')}</p>
                <p className="mt-2 text-sm leading-6 text-white/38">{t('dashboard.noServersBody')}</p>
                <Link
                  to="/dashboard/servers"
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-2 text-xs font-mono text-neon-cyan transition-all hover:-translate-y-0.5 hover:bg-neon-cyan/18"
                >
                  Voir les serveurs
                </Link>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {guilds.slice(0, 5).map((guild, index) => (
                  <motion.button
                    key={guild.id}
                    type="button"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.18 + index * 0.05, duration: 0.32 }}
                    whileHover={{ y: -3, scale: 1.01 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => selectGuild(guild.id)}
                    className={`w-full rounded-[24px] border p-4 text-left transition-all duration-200 ${
                      guild.id === selectedGuildId
                        ? 'border-neon-cyan/26 bg-neon-cyan/[0.08]'
                        : 'border-white/[0.08] bg-white/[0.03] hover:border-neon-cyan/22 hover:bg-neon-cyan/[0.05]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <GuildAvatar guild={guild} className="h-12 w-12 rounded-2xl" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-display text-base font-700 text-white">{guild.name}</p>
                          {guild.is_shared && (
                            <span className="rounded-full border border-neon-violet/20 bg-neon-violet/10 px-2 py-0.5 text-[10px] font-mono text-neon-violet">
                              Partage
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-white/38">{numberFormatter.format(guild.member_count || 0)} membres suivis</p>
                      </div>
                      {guild.id === selectedGuildId ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <ArrowRight className="h-4 w-4 text-white/22" />
                      )}
                    </div>
                  </motion.button>
                ))}
              </div>
            )}
          </DashboardPanel>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          icon={Server}
          label={t('dashboard.stats.activeServers')}
          value={numberFormatter.format(guilds.length)}
          meta={t('dashboard.stats.guilds')}
          tone="cyan"
          delay={0.05}
        />
        <StatCard
          icon={Users}
          label={t('dashboard.stats.totalMembers')}
          value={numberFormatter.format(totalMembers)}
          meta={t('dashboard.stats.acrossServers')}
          tone="violet"
          delay={0.09}
        />
        <StatCard
          icon={Activity}
          label={t('dashboard.stats.ping')}
          value={ping > 0 ? `${ping}ms` : t('dashboard.stats.unavailable')}
          meta={t('dashboard.stats.websocket')}
          tone="green"
          delay={0.13}
        />
        <StatCard
          icon={TrendingUp}
          label={t('dashboard.stats.uptime')}
          value={status === 'running' ? `${uptime}m` : t('dashboard.stats.unavailable')}
          meta={t('dashboard.stats.minutes')}
          tone="amber"
          delay={0.17}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <DashboardPanel glow="cyan" delay={0.2} className="p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-white/30">Raccourcis</p>
              <p className="mt-2 font-display text-2xl font-700 text-white">Acces intelligent</p>
            </div>
            {selectedGuild && (
              <button
                type="button"
                onClick={disconnectSelectedGuild}
                className="inline-flex items-center gap-2 rounded-full border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs font-mono text-red-300 transition-all hover:-translate-y-0.5 hover:bg-red-400/18"
              >
                <Unplug className="h-3.5 w-3.5" />
                Deconnecter le serveur actif
              </button>
            )}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {quickLinks.map((item) => (
              <QuickLinkCard key={item.path} {...item} />
            ))}
          </div>
        </DashboardPanel>

        <DashboardPanel glow="violet" delay={0.24} className="p-5 sm:p-6">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-white/30">Focus</p>
            <p className="mt-2 font-display text-2xl font-700 text-white">Plan de gestion</p>
          </div>

          <div className="mt-5 grid gap-3">
            {[
              {
                title: 'Protection et moderation',
                desc: selectedGuild
                  ? 'Verrouille la protection, puis va en recherche pour agir sur les membres.'
                  : 'Commence par choisir un serveur, puis active les modules de protection.',
                action: selectedGuild ? '/dashboard/protection' : '/dashboard/servers',
                icon: Shield,
                tone: 'cyan',
              },
              {
                title: 'Commandes et IA',
                desc: 'Passe ensuite sur les commandes pour creer des automatisations et utiliser l assistant.',
                action: '/dashboard/commands',
                icon: Command,
                tone: 'violet',
              },
              {
                title: 'Suivi en continu',
                desc: 'Termine sur les logs, messages et analytics pour garder une vision nette du serveur.',
                action: '/dashboard/logs',
                icon: ScrollText,
                tone: 'green',
              },
            ].map((item, index) => {
              const Icon = item.icon
              return (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.28 + index * 0.05, duration: 0.34 }}
                  whileHover={{ x: 4 }}
                >
                  <Link
                    to={item.action}
                    className="flex items-start gap-4 rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-4 transition-all duration-200 hover:border-neon-cyan/20 hover:bg-white/[0.05]"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.05]">
                      <Icon className={`h-5 w-5 ${
                        item.tone === 'cyan'
                          ? 'text-neon-cyan'
                          : item.tone === 'violet'
                            ? 'text-neon-violet'
                            : 'text-emerald-300'
                      }`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-base font-700 text-white">{item.title}</p>
                          <p className="mt-1 text-sm leading-6 text-white/45">{item.desc}</p>
                        </div>
                        <ArrowRight className="mt-1 h-4 w-4 text-white/22" />
                      </div>
                    </div>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </DashboardPanel>
      </div>
    </div>
  )
}
