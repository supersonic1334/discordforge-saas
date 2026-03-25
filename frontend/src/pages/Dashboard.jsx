import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Server, Zap, Shield, Play, Square, RotateCcw, Activity, TrendingUp, Users, Search, CheckCircle2, ArrowRight, Unplug, ScrollText } from 'lucide-react'
import toast from 'react-hot-toast'
import { botAPI } from '../services/api'
import { useAuthStore, useGuildStore, useBotStore } from '../stores'
import { wsService } from '../services/websocket'
import { useI18n } from '../i18n'

function StatCard({ icon: Icon, label, value, sub, color = 'cyan', delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="stat-card glass-card-hover"
    >
      <div className="flex items-center justify-between">
        <div className={`p-2 rounded-lg ${
          color === 'cyan' ? 'bg-neon-cyan/10' :
          color === 'violet' ? 'bg-neon-violet/10' :
          color === 'green' ? 'bg-green-500/10' : 'bg-amber-500/10'
        }`}>
          <Icon className={`w-4 h-4 ${
            color === 'cyan' ? 'text-neon-cyan' :
            color === 'violet' ? 'text-neon-violet' :
            color === 'green' ? 'text-green-400' : 'text-amber-400'
          }`} />
        </div>
        <span className="text-xs text-white/30 font-mono">{sub}</span>
      </div>
      <div>
        <p className="text-2xl font-display font-700 text-white">{value}</p>
        <p className="text-xs text-white/40 font-body mt-0.5">{label}</p>
      </div>
    </motion.div>
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
      setTimeout(fetchStatus, 2000)
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || t('dashboard.toasts.actionError'))
    }
    setActionLoading(null)
  }

  const uptime = startedAt ? Math.floor((timeTick - new Date(startedAt).getTime()) / 60000) : 0

  const selectCurrentGuild = (guildId) => {
    selectGuild(guildId)
  }

  const disconnectSelectedGuild = () => {
    clearSelectedGuild()
    navigate('/dashboard/servers')
  }

  const statusColor = {
    running: 'text-green-400',
    starting: 'text-yellow-400',
    reconnecting: 'text-blue-400',
    stopped: 'text-white/30',
    error: 'text-red-400',
  }[status] || 'text-white/30'

  const quickLinks = [
    { label: t('dashboard.quickLinks.protectionLabel', 'Protection'), desc: t('dashboard.quickLinks.protectionDesc', 'Configure the security modules') },
    { label: t('dashboard.quickLinks.searchLabel', 'Search'), desc: t('dashboard.quickLinks.searchDesc', 'Find a member and moderate fast') },
    { label: t('dashboard.quickLinks.logsLabel', 'Logs'), desc: t('dashboard.quickLinks.logsDesc', 'Track website, warning, and Discord events') },
    { label: t('dashboard.quickLinks.aiLabel', 'Assistant IA'), desc: t('dashboard.quickLinks.aiDesc', 'Configure the server with AI') },
    { label: t('dashboard.quickLinks.analyticsLabel', 'Analytics'), desc: t('dashboard.quickLinks.analyticsDesc', 'View live stats') },
  ]

  return (
    <div className="px-4 py-5 sm:p-6 max-w-6xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display font-800 text-2xl text-white">
            {t('dashboard.welcome')}, <span className="neon-text">{user?.username}</span>
          </h1>
          <p className="text-white/40 text-sm mt-1 font-body">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm font-mono ${statusColor}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${
              status === 'running' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' :
              status === 'error' ? 'bg-red-400' : 'bg-white/20'
            }`} />
            {t(`layout.status.${status}`, status)}
          </div>
        </div>
      </motion.div>

      {!selectedGuild && guilds.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card p-6 border border-neon-cyan/15 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <p className="font-display font-700 text-xl text-white">{t('dashboard.serverPickerTitle', 'Choisis ton serveur')}</p>
              <p className="text-white/45 text-sm mt-1">{t('dashboard.serverPickerBodyV2', 'Selectionne un serveur pour le rendre actif, puis gere sa protection, sa recherche, ses logs, ses commandes et ses analytics.')}</p>
            </div>
            <Link to="/dashboard/servers" className="inline-flex items-center gap-2 text-sm font-mono text-neon-cyan/70 hover:text-neon-cyan transition-colors">
              {t('dashboard.serverPickerManage', 'Voir tous les serveurs')} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {guilds.map((guild) => (
              <button
                key={guild.id}
                type="button"
                onClick={() => selectCurrentGuild(guild.id)}
                className={`text-left p-4 rounded-2xl border transition-all ${
                  guild.id === selectedGuildId
                    ? 'bg-neon-cyan/[0.06] border-neon-cyan/30'
                    : 'bg-white/[0.03] border-white/[0.07] hover:border-neon-cyan/30 hover:bg-neon-cyan/[0.05]'
                }`}
              >
                <div className="flex items-center gap-3">
                  {guild.iconUrl ? (
                    <img src={guild.iconUrl} className="w-11 h-11 rounded-xl object-cover shrink-0" alt="" />
                  ) : (
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-neon-cyan/20 to-neon-violet/20 flex items-center justify-center font-display font-800 text-neon-cyan shrink-0">
                      {guild.name[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-600 text-white truncate">{guild.name}</p>
                    <p className="text-xs text-white/35 font-mono">{guild.member_count?.toLocaleString(locale) || 0} {t('dashboard.members')}</p>
                  </div>
                  {guild.id === selectedGuildId
                    ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                    : <ArrowRight className="w-4 h-4 text-white/25 shrink-0" />}
                </div>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {selectedGuild && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="glass-card p-5 border border-green-500/15">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {selectedGuild.iconUrl ? (
                <img src={selectedGuild.iconUrl} className="w-12 h-12 rounded-2xl object-cover shrink-0" alt="" />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500/20 to-neon-cyan/20 flex items-center justify-center text-green-400 font-display font-800 shrink-0">
                  {selectedGuild.name[0]}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t('dashboard.currentServerTitle', 'Serveur actuel')}
                  </span>
                  {selectedGuild.is_shared && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-200 text-xs font-mono">
                      Partage par {selectedGuild.owner_username || 'le proprietaire'}
                    </span>
                  )}
                </div>
                <p className="font-display font-700 text-white text-lg truncate mt-2">{selectedGuild.name}</p>
                <p className="text-sm text-white/40">{selectedGuild.member_count?.toLocaleString(locale) || 0} {t('dashboard.members')}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate('/dashboard/protection')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/20 transition-all"
              >
                {t('dashboard.openProtection', 'Ouvrir la protection')}
              </button>
              <Link to="/dashboard/servers" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white/70 text-sm font-mono hover:bg-white/[0.06] transition-all">
                {t('dashboard.changeServer', 'Changer de serveur')}
              </Link>
              <button
                type="button"
                onClick={disconnectSelectedGuild}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-mono hover:bg-red-500/20 transition-all"
              >
                <Unplug className="w-4 h-4" />
                {t('dashboard.disconnectServer', 'Deconnecter ce serveur')}
              </button>
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Server} label={t('dashboard.stats.activeServers')} value={guilds.length} sub={t('dashboard.stats.guilds')} color="cyan" delay={0.05} />
        <StatCard icon={Users} label={t('dashboard.stats.totalMembers')} value={guilds.reduce((sum, guild) => sum + (guild.member_count || 0), 0).toLocaleString(locale)} sub={t('dashboard.stats.acrossServers')} color="violet" delay={0.1} />
        <StatCard icon={Activity} label={t('dashboard.stats.ping')} value={ping > 0 ? `${ping}ms` : t('dashboard.stats.unavailable')} sub={t('dashboard.stats.websocket')} color="green" delay={0.15} />
        <StatCard icon={TrendingUp} label={t('dashboard.stats.uptime')} value={status === 'running' ? `${uptime}m` : t('dashboard.stats.unavailable')} sub={t('dashboard.stats.minutes')} color="amber" delay={0.2} />
      </div>

      {!hasOwnBotToken && sharedGuildCount > 0 && (
        <div className="glass-card p-4 border border-neon-cyan/15 text-sm text-white/55">
          Tu utilises un acces partage. Les modules et commandes restent synchronises, mais seul le proprietaire du token peut lancer un nouveau bot ou resynchroniser ses serveurs bruts.
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="glass-card p-5">
          <h2 className="font-display font-600 text-sm text-white/60 mb-4 uppercase tracking-wider">{t('dashboard.botControls')}</h2>

          <div className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.05] mb-4">
            <div className={`w-3 h-3 rounded-full ${
              status === 'running' ? 'bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.5)] animate-pulse' :
              status === 'error' ? 'bg-red-400' :
              status === 'starting' || status === 'reconnecting' ? 'bg-yellow-400 animate-pulse' :
              'bg-white/20'
            }`} />
            <div>
              <p className={`text-sm font-mono font-500 capitalize ${statusColor}`}>{t(`layout.status.${status}`, status)}</p>
              {startedAt && status === 'running' && (
                <p className="text-xs text-white/30">{t('dashboard.since')} {new Date(startedAt).toLocaleTimeString(locale)}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => botAction('start')}
              disabled={!hasOwnBotToken || status === 'running' || status === 'starting' || !!actionLoading}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
            >
              {actionLoading === 'start'
                ? <div className="w-4 h-4 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
                : <Play className="w-4 h-4" />}
              <span className="text-xs font-mono">{t('dashboard.controls.start')}</span>
            </button>
            <button
              onClick={() => botAction('stop')}
              disabled={!hasOwnBotToken || status === 'stopped' || status === 'error' || !!actionLoading}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
            >
              {actionLoading === 'stop'
                ? <div className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                : <Square className="w-4 h-4" />}
              <span className="text-xs font-mono">{t('dashboard.controls.stop')}</span>
            </button>
            <button
              onClick={() => botAction('restart')}
              disabled={!hasOwnBotToken || !!actionLoading}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
            >
              {actionLoading === 'restart'
                ? <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                : <RotateCcw className="w-4 h-4" />}
              <span className="text-xs font-mono">{t('dashboard.controls.restart')}</span>
            </button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="lg:col-span-2 glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-600 text-sm text-white/60 uppercase tracking-wider">{t('dashboard.serversTitle')}</h2>
            <button
              onClick={syncGuilds}
              disabled={!hasOwnBotToken}
              className="text-xs font-mono text-neon-cyan/60 hover:text-neon-cyan transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t('dashboard.sync')}
            </button>
          </div>

          {guilds.length === 0 ? (
            <div className="text-center py-8 text-white/20">
              <Server className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{t('dashboard.noServersTitle')} {t('dashboard.noServersBody')}</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-none">
              {guilds.slice(0, 6).map((guild) => (
                <button
                  key={guild.id}
                  type="button"
                  onClick={() => selectCurrentGuild(guild.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group ${
                    guild.id === selectedGuildId
                      ? 'bg-neon-cyan/[0.08] border border-neon-cyan/20'
                      : 'hover:bg-white/[0.05]'
                  }`}
                >
                  {guild.iconUrl ? (
                    <img src={guild.iconUrl} className="w-8 h-8 rounded-full" alt="" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-cyan/20 to-neon-violet/20 flex items-center justify-center text-xs font-display font-700 text-neon-cyan">
                      {guild.name[0]}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-body text-white group-hover:text-neon-cyan transition-colors truncate">{guild.name}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <p className="text-xs text-white/30 font-mono">{guild.member_count?.toLocaleString(locale)} {t('dashboard.members')}</p>
                      {guild.is_shared && (
                        <span className="px-2 py-0.5 rounded-full border border-violet-500/20 bg-violet-500/10 text-violet-200 text-[10px] font-mono">
                          Partage
                        </span>
                      )}
                    </div>
                  </div>
                  {guild.id === selectedGuildId
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                    : <Shield className="w-3.5 h-3.5 text-white/20 group-hover:text-neon-cyan transition-colors" />}
                </button>
              ))}
              {guilds.length > 6 && (
                <Link to="/dashboard/servers" className="block text-center text-xs text-white/30 hover:text-neon-cyan transition-colors py-2">
                  +{guilds.length - 6} {t('dashboard.moreServers')} {'->'}
                </Link>
              )}
            </div>
          )}
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
        <h2 className="font-display font-600 text-sm text-white/40 mb-3 uppercase tracking-wider">{t('dashboard.quickActions')}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: Shield, path: '/dashboard/protection', color: 'cyan' },
            { icon: Search, path: '/dashboard/search', color: 'amber' },
            { icon: ScrollText, path: '/dashboard/logs', color: 'green' },
            { icon: Zap, path: '/dashboard/ai', color: 'violet' },
            { icon: Activity, path: '/dashboard/analytics', color: 'cyan' },
          ].map(({ icon: Icon, path, color }, index) => {
            const item = quickLinks[index]
            return (
              <Link
                key={path}
                to={path}
                className="glass-card-hover p-4 flex flex-col gap-2"
              >
                <Icon className={`w-5 h-5 ${
                  color === 'cyan' ? 'text-neon-cyan' :
                  color === 'violet' ? 'text-neon-violet' :
                  color === 'green' ? 'text-green-400' : 'text-amber-400'
                }`} />
                <div>
                  <p className="text-sm font-display font-600 text-white">{item?.label}</p>
                  <p className="text-xs text-white/30">{item?.desc}</p>
                </div>
              </Link>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}
