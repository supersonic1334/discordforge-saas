import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Compass,
  PlusCircle,
  RefreshCw,
  Rocket,
  ScrollText,
  Search,
  Server,
  Shield,
  Unplug,
  Users,
} from 'lucide-react'
import { useAuthStore, useGuildStore, useBotStore } from '../stores'
import { wsService } from '../services/websocket'
import { useI18n } from '../i18n'

function ServerSurface({ children, className = '', delay = 0, glow = 'cyan' }) {
  const glowClasses = {
    cyan: 'from-neon-cyan/16 via-neon-cyan/5 to-transparent',
    violet: 'from-neon-violet/18 via-neon-violet/6 to-transparent',
    green: 'from-emerald-400/16 via-emerald-400/6 to-transparent',
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.36, ease: 'easeOut' }}
      whileHover={{ y: -4, scale: 1.004 }}
      className={`glass-card relative overflow-hidden border border-white/[0.08] shadow-[0_18px_70px_rgba(4,8,20,0.24)] ${className}`}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${glowClasses[glow] || glowClasses.cyan}`} />
      <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="relative">{children}</div>
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

function MetricCard({ icon: Icon, label, value, meta, tone = 'cyan', delay = 0 }) {
  const tones = {
    cyan: 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/20',
    violet: 'text-neon-violet bg-neon-violet/10 border-neon-violet/20',
    green: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20',
  }

  return (
    <ServerSurface delay={delay} glow={tone} className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-2xl border p-3 ${tones[tone] || tones.cyan}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-white/40">
          {meta}
        </span>
      </div>
      <div className="mt-6">
        <p className="font-display text-3xl font-800 text-white">{value}</p>
        <p className="mt-1 text-sm text-white/45">{label}</p>
      </div>
    </ServerSurface>
  )
}

export default function ServersPage() {
  const { t, locale } = useI18n()
  const { hasOwnBotToken, sharedGuildCount } = useAuthStore()
  const { guilds, selectedGuildId, selectGuild, clearSelectedGuild, fetchGuilds, syncGuilds, isLoading } = useGuildStore()
  const { status, bot, fetchStatus } = useBotStore()
  const navigate = useNavigate()

  const selectedGuild = guilds.find((guild) => guild.id === selectedGuildId) || null
  const inviteUrl = bot?.inviteUrl || null

  useEffect(() => {
    fetchGuilds()
    fetchStatus()
    const unsubReady = wsService.on('bot:ready', () => fetchGuilds())
    const unsubGuildUpdate = wsService.on('bot:guildUpdate', () => fetchGuilds())
    return () => {
      unsubReady()
      unsubGuildUpdate()
    }
  }, [])

  const totalMembers = useMemo(
    () => guilds.reduce((sum, guild) => sum + Number(guild.member_count || 0), 0),
    [guilds]
  )
  const sharedServers = useMemo(
    () => guilds.filter((guild) => guild.is_shared).length,
    [guilds]
  )
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale || 'fr-FR'), [locale])

  const inviteBotToServer = () => {
    if (!inviteUrl) return
    window.open(inviteUrl, '_blank', 'noopener,noreferrer')
  }

  const activateGuild = (guildId) => {
    selectGuild(guildId)
  }

  const openGuildRoute = (guildId, route) => {
    selectGuild(guildId)
    navigate(route)
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:px-5 sm:py-6">
      <ServerSurface glow="cyan" className="p-6 sm:p-7">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(8,12,18,0.98),rgba(10,14,22,0.96)_48%,rgba(17,13,28,0.92))]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.045),transparent_18%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.1),transparent_34%)]" />
        <div className="relative">
          <div className="relative overflow-hidden rounded-[28px] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(9,14,20,0.9),rgba(7,10,16,0.72))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_22px_60px_rgba(2,6,14,0.28)] sm:p-6">
            <div className="pointer-events-none absolute -left-16 top-[-22%] h-56 w-56 rounded-full bg-neon-cyan/10 blur-3xl opacity-75" />
            <div className="pointer-events-none absolute -right-20 bottom-[-30%] h-64 w-64 rounded-full bg-neon-violet/10 blur-3xl opacity-60" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_38%)]" />
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />

            <div className="relative space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/55">
                <Rocket className="h-3.5 w-3.5 text-neon-cyan" />
                Espace serveurs
              </div>
              <div>
                <h1 className="font-display text-3xl font-800 text-white sm:text-[2.5rem]">{t('servers.title')}</h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50 sm:text-[15px]">
                  Centre plus clair pour connecter le bot, choisir un serveur actif et basculer vite vers la protection, la recherche ou les logs.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <motion.button
                  type="button"
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={inviteBotToServer}
                  disabled={!inviteUrl || !hasOwnBotToken}
                  className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/12 px-4 py-3 text-sm font-mono text-emerald-300 transition-all hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <PlusCircle className="h-4 w-4" />
                  {t('servers.addServer', 'Ajouter un serveur')}
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={syncGuilds}
                  disabled={status !== 'running' || isLoading || !hasOwnBotToken}
                  className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-4 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/16 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                  {t('servers.sync')}
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => navigate('/dashboard/osint')}
                  className="inline-flex items-center gap-2 rounded-2xl border border-neon-violet/25 bg-neon-violet/10 px-4 py-3 text-sm font-mono text-neon-violet transition-all hover:bg-neon-violet/16"
                >
                  <Compass className="h-4 w-4" />
                  OSINT
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      </ServerSurface>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard icon={Server} label="Serveurs actifs" value={numberFormatter.format(guilds.length)} meta="pilotage" tone="cyan" delay={0.04} />
        <MetricCard icon={Users} label="Membres suivis" value={numberFormatter.format(totalMembers)} meta="cumul" tone="violet" delay={0.08} />
        <MetricCard icon={Shield} label="Serveurs partages" value={numberFormatter.format(sharedGuildCount || sharedServers)} meta="acces" tone="green" delay={0.12} />
        <MetricCard icon={Activity} label="Statut bot" value={status === 'running' ? 'OK' : 'OFF'} meta="live" tone="cyan" delay={0.16} />
      </div>

      {!hasOwnBotToken && sharedGuildCount > 0 && (
        <ServerSurface glow="violet" className="p-4 sm:p-5">
          <p className="text-sm leading-7 text-white/58">
            Acces partage detecte. Tu pilotes ici les serveurs invites sans jamais recuperer le token d origine.
          </p>
        </ServerSurface>
      )}

      <ServerSurface glow="violet" className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-neon-violet/20 bg-neon-violet/10 px-3 py-1 text-xs font-mono text-neon-violet">
              <Compass className="h-3.5 w-3.5" />
              Nouveau module
            </div>
            <p className="mt-3 font-display text-2xl font-700 text-white">OSINT</p>
            <p className="mt-2 text-sm leading-7 text-white/45">
              Ouvre le tracker de pseudos et la geolocalisation d image meme sans serveur actif.
            </p>
          </div>

          <motion.button
            type="button"
            whileHover={{ y: -2, scale: 1.01 }}
            whileTap={{ scale: 0.985 }}
            onClick={() => navigate('/dashboard/osint')}
            className="inline-flex items-center gap-2 rounded-2xl border border-neon-violet/25 bg-neon-violet/10 px-5 py-3 text-sm font-mono text-neon-violet transition-all hover:bg-neon-violet/16"
          >
            <Compass className="h-4 w-4" />
            Ouvrir OSINT
            <ArrowRight className="h-4 w-4" />
          </motion.button>
        </div>
      </ServerSurface>

      {selectedGuild && (
        <ServerSurface glow="green" className="p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-4">
              <GuildAvatar guild={selectedGuild} className="h-16 w-16 rounded-[24px]" />
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-mono text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t('servers.selectionActive', 'Serveur actuellement selectionne')}
                </div>
                <p className="mt-3 truncate font-display text-2xl font-800 text-white">{selectedGuild.name}</p>
                <p className="mt-1 text-sm text-white/45">{numberFormatter.format(selectedGuild.member_count || 0)} {t('dashboard.members')}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate('/dashboard/protection')}
                className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-4 py-3 text-sm font-mono text-neon-cyan transition-all hover:-translate-y-0.5 hover:bg-neon-cyan/18"
              >
                <Shield className="h-4 w-4" />
                {t('servers.openProtection', 'Protection')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/dashboard/search')}
                className="inline-flex items-center gap-2 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm font-mono text-amber-300 transition-all hover:-translate-y-0.5 hover:bg-amber-400/18"
              >
                <Search className="h-4 w-4" />
                Recherche
              </button>
              <button
                type="button"
                onClick={() => {
                  clearSelectedGuild()
                  navigate('/dashboard/servers')
                }}
                className="inline-flex items-center gap-2 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-mono text-red-300 transition-all hover:-translate-y-0.5 hover:bg-red-400/18"
              >
                <Unplug className="h-4 w-4" />
                {t('servers.clearSelection', 'Retirer la selection')}
              </button>
            </div>
          </div>
        </ServerSurface>
      )}

      {guilds.length === 0 ? (
        <ServerSurface glow="cyan" className="p-10 sm:p-14">
          <div className="mx-auto max-w-xl text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[28px] border border-white/[0.08] bg-white/[0.04]">
              <Server className="h-8 w-8 text-white/18" />
            </div>
            <p className="mt-5 font-display text-2xl font-700 text-white">{t('servers.emptyTitle')}</p>
            <p className="mt-3 text-sm leading-7 text-white/45">{t('servers.emptyBody')}</p>
            <button
              type="button"
              onClick={inviteBotToServer}
              disabled={!inviteUrl}
              className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/12 px-5 py-3 text-sm font-mono text-emerald-300 transition-all hover:-translate-y-0.5 hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PlusCircle className="h-4 w-4" />
              {t('servers.addServer', 'Ajouter un serveur')}
            </button>
          </div>
        </ServerSurface>
      ) : (
        <div className="space-y-4">
          <ServerSurface glow="violet" className="p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-white/30">Selection</p>
                <p className="mt-2 font-display text-2xl font-700 text-white">{t('servers.selectionTitle', 'Choisis le serveur a piloter')}</p>
                <p className="mt-2 text-sm leading-7 text-white/45">{t('servers.selectionBodyV2', 'Clique sur un serveur pour le rendre actif, puis gere sa protection, sa recherche, ses logs, ses commandes et ses analytics.')}</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-mono text-white/45">
                <Rocket className="h-3.5 w-3.5 text-neon-cyan" />
                Focus instantane
              </div>
            </div>
          </ServerSurface>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {guilds.map((guild, index) => (
              <motion.article
                key={guild.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05, duration: 0.32 }}
                whileHover={{ y: -6, scale: 1.01 }}
                className={`relative overflow-hidden rounded-[28px] border p-5 shadow-[0_20px_70px_rgba(4,8,20,0.2)] transition-all duration-200 ${
                  guild.id === selectedGuildId
                    ? 'border-neon-cyan/25 bg-[linear-gradient(180deg,rgba(0,229,255,0.09),rgba(255,255,255,0.03))]'
                    : 'border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] hover:border-neon-cyan/18'
                }`}
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.12),transparent_38%)] opacity-90" />
                <div className="relative space-y-5">
                  <div className="flex items-start gap-3">
                    <GuildAvatar guild={guild} className="h-14 w-14 rounded-[20px]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-display text-lg font-700 text-white">{guild.name}</p>
                        {guild.id === selectedGuildId && <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] font-mono text-white/40">
                          <Users className="h-3 w-3" />
                          {numberFormatter.format(guild.member_count || 0)}
                        </span>
                        {guild.is_shared && (
                          <span className="rounded-full border border-neon-violet/20 bg-neon-violet/10 px-2.5 py-1 text-[10px] font-mono text-neon-violet">
                            Partage par {guild.owner_username || 'le proprietaire'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                    <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/28">Etat</p>
                    <p className="mt-2 text-sm leading-6 text-white/55">
                      {guild.id === selectedGuildId
                        ? 'Ce serveur est deja actif. Tu peux ouvrir direct ses modules.'
                        : 'Active ce serveur pour travailler dessus dans toutes les categories du panel.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => activateGuild(guild.id)}
                      className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-mono transition-all ${
                        guild.id === selectedGuildId
                          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                          : 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/18'
                      }`}
                    >
                      {guild.id === selectedGuildId ? <CheckCircle2 className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
                      {guild.id === selectedGuildId ? 'Actif' : 'Activer'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openGuildRoute(guild.id, '/dashboard/protection')}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.05] px-3 py-3 text-sm font-mono text-white/70 transition-all hover:border-neon-cyan/25 hover:bg-neon-cyan/[0.08] hover:text-neon-cyan"
                    >
                      <Shield className="h-4 w-4" />
                      Protection
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => openGuildRoute(guild.id, '/dashboard/search')}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.05] px-3 py-3 text-sm font-mono text-white/70 transition-all hover:border-amber-400/25 hover:bg-amber-400/[0.08] hover:text-amber-300"
                    >
                      <Search className="h-4 w-4" />
                      Recherche
                    </button>
                    <button
                      type="button"
                      onClick={() => openGuildRoute(guild.id, '/dashboard/logs')}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.05] px-3 py-3 text-sm font-mono text-white/70 transition-all hover:border-neon-violet/25 hover:bg-neon-violet/[0.08] hover:text-neon-violet"
                    >
                      <ScrollText className="h-4 w-4" />
                      Logs
                    </button>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
