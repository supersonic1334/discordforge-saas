import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Server, Users, Shield, RefreshCw, ArrowRight, CheckCircle2, Unplug, PlusCircle } from 'lucide-react'
import { useGuildStore, useBotStore } from '../stores'
import { wsService } from '../services/websocket'
import { useI18n } from '../i18n'

export default function ServersPage() {
  const { t, locale } = useI18n()
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

  const selectCurrentGuild = (guildId) => {
    selectGuild(guildId)
  }

  const inviteBotToServer = () => {
    if (!inviteUrl) return
    window.open(inviteUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-800 text-2xl text-white">{t('servers.title')}</h1>
          <p className="text-white/40 text-sm mt-0.5">
            {guilds.length} {t(guilds.length === 1 ? 'servers.connectedSingle' : 'servers.connectedPlural')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={inviteBotToServer}
            disabled={!inviteUrl}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-mono hover:bg-green-500/20 transition-all disabled:opacity-40"
          >
            <PlusCircle className="w-4 h-4" />
            {t('servers.addServer', 'Ajouter un serveur')}
          </button>
          <button
            onClick={syncGuilds}
            disabled={status !== 'running' || isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/20 transition-all disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            {t('servers.sync')}
          </button>
        </div>
      </div>

      {selectedGuild && (
        <div className="glass-card p-5 border border-green-500/15">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {selectedGuild.iconUrl ? (
                <img src={selectedGuild.iconUrl} className="w-12 h-12 rounded-2xl object-cover shrink-0" alt="" />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500/20 to-neon-cyan/20 flex items-center justify-center font-display font-800 text-green-400 shrink-0">
                  {selectedGuild.name[0]}
                </div>
              )}
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-mono">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t('servers.selectionActive', 'Serveur actuellement selectionne')}
                </span>
                <p className="font-display font-700 text-white text-lg truncate mt-2">{selectedGuild.name}</p>
                <p className="text-sm text-white/40">{selectedGuild.member_count?.toLocaleString(locale) || 0} {t('dashboard.members')}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate('/dashboard/protection')}
                className="px-4 py-2 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/20 transition-all"
              >
                {t('servers.openProtection', 'Protection')}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearSelectedGuild()
                  navigate('/dashboard/servers')
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-mono hover:bg-red-500/20 transition-all"
              >
                <Unplug className="w-4 h-4" />
                {t('servers.clearSelection', 'Retirer la selection')}
              </button>
            </div>
          </div>
        </div>
      )}

      {guilds.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Server className="w-12 h-12 text-white/10 mx-auto mb-3" />
          <p className="text-white/40 mb-1">{t('servers.emptyTitle')}</p>
          <p className="text-white/20 text-sm">{t('servers.emptyBody')}</p>
          <button
            type="button"
            onClick={inviteBotToServer}
            disabled={!inviteUrl}
            className="inline-flex items-center gap-2 mt-5 px-5 py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 font-mono text-sm hover:bg-green-500/20 transition-all disabled:opacity-40"
          >
            <PlusCircle className="w-4 h-4" />
            {t('servers.addServer', 'Ajouter un serveur')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="glass-card p-5 border border-neon-cyan/10">
            <p className="font-display font-700 text-white text-lg">{t('servers.selectionTitle', 'Choisis le serveur a piloter')}</p>
            <p className="text-white/40 text-sm mt-1">{t('servers.selectionBody', 'Clique sur un serveur pour le rendre actif, puis gere ensuite sa protection, sa moderation, ses commandes et ses analytics.')}</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {guilds.map((guild, index) => (
            <motion.div key={guild.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
              <button
                type="button"
                onClick={() => selectCurrentGuild(guild.id)}
                className={`w-full text-left p-5 flex flex-col gap-4 rounded-2xl transition-all ${
                  guild.id === selectedGuildId
                    ? 'glass-card border border-neon-cyan/25 bg-neon-cyan/[0.05]'
                    : 'glass-card-hover'
                }`}
              >
                <div className="flex items-center gap-3">
                  {guild.iconUrl
                    ? <img src={guild.iconUrl} className="w-12 h-12 rounded-xl" alt="" />
                    : <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-neon-cyan/20 to-neon-violet/20 flex items-center justify-center font-display font-800 text-xl text-neon-cyan">{guild.name[0]}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-600 text-white truncate">{guild.name}</p>
                    <p className="text-xs text-white/30 font-mono flex items-center gap-1">
                      <Users className="w-3 h-3" />{guild.member_count?.toLocaleString(locale) || 0}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono flex items-center gap-1 ${
                    guild.id === selectedGuildId ? 'text-green-400' : 'text-neon-cyan/60'
                  }`}>
                    <Shield className="w-3 h-3" />
                    {guild.id === selectedGuildId ? t('servers.selected', 'Selectionne') : t('servers.selectCta', 'Selectionner')}
                  </span>
                  {guild.id === selectedGuildId
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                    : <ArrowRight className="w-3.5 h-3.5 text-white/20" />}
                </div>
              </button>
            </motion.div>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}
