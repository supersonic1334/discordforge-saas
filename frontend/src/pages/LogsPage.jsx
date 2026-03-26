import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowRight, Bot, RefreshCw, ShieldOff, Search, Filter, Calendar, User, Zap, FileText, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { logsAPI, modAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'
import { ACTION_LABELS, ACTION_COLORS, LOG_LEVEL_COLORS, getErrorMessage, formatDate, initials, renderAvatar, SummaryCard, SelectGuildState } from '../components/moderation/moderationUI'

const TABS = [
  { id: 'site', label: 'Logs Site', icon: Activity, color: 'neon-cyan' },
  { id: 'warnings', label: 'Avertissements', icon: AlertTriangle, color: 'amber' },
  { id: 'discord', label: 'Logs Discord', icon: Bot, color: 'violet' },
]

const ACTION_TYPES = [
  { value: '', label: 'Toutes les actions' },
  { value: 'warn', label: 'Avertissement' },
  { value: 'timeout', label: 'Timeout' },
  { value: 'kick', label: 'Kick' },
  { value: 'ban', label: 'Ban' },
  { value: 'unban', label: 'Unban' },
  { value: 'blacklist', label: 'Blacklist' },
]

const LOG_LEVELS = [
  { value: '', label: 'Tous les niveaux' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
]

export default function LogsPage() {
  const { locale } = useI18n()
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [activeTab, setActiveTab] = useState('site')
  const [siteLogs, setSiteLogs] = useState([])
  const [warnLogs, setWarnLogs] = useState([])
  const [discordLogs, setDiscordLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterLevel, setFilterLevel] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  async function loadSiteLogs({ silent = false } = {}) {
    if (!selectedGuildId) return
    if (!silent) setLoading(true)
    try {
      const response = await modAPI.actions(selectedGuildId, { page: 1, limit: 50 })
      setSiteLogs(response.data.actions || [])
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function loadWarnings({ silent = false } = {}) {
    if (!selectedGuildId) return
    if (!silent) setLoading(true)
    try {
      const response = await modAPI.warnings(selectedGuildId, { page: 1, limit: 50 })
      setWarnLogs(response.data.warnings || [])
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function loadDiscordLogs({ silent = false } = {}) {
    if (!selectedGuildId) return
    if (!silent) setLoading(true)
    try {
      const response = await logsAPI.discord(selectedGuildId, { page: 1, limit: 50 })
      setDiscordLogs(response.data.logs || [])
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function loadLogs() {
    setRefreshing(true)
    await Promise.all([loadSiteLogs(), loadWarnings(), loadDiscordLogs()])
    setRefreshing(false)
  }

  async function refreshAll({ silent = false } = {}) {
    if (!selectedGuildId) return
    if (silent) setRefreshing(true)
    await Promise.all([loadSiteLogs({ silent }), loadWarnings({ silent }), loadDiscordLogs({ silent })])
    if (silent) setRefreshing(false)
  }

  useEffect(() => {
    if (!selectedGuildId) return undefined
    loadLogs()
    const intervalId = window.setInterval(() => refreshAll({ silent: true }), 10000)
    return () => window.clearInterval(intervalId)
  }, [selectedGuildId])

  const summaries = useMemo(() => {
    const warnCount = warnLogs.length
    const actionCount = siteLogs.length
    const errorCount = discordLogs.filter((entry) => entry.level === 'error').length
    return { warnCount, actionCount, errorCount }
  }, [siteLogs, warnLogs, discordLogs])

  const filteredLogs = useMemo(() => {
    let logs = []
    if (activeTab === 'site') logs = siteLogs
    else if (activeTab === 'warnings') logs = warnLogs
    else if (activeTab === 'discord') logs = discordLogs

    return logs.filter((log) => {
      const searchLower = searchQuery.toLowerCase().trim()
      if (searchLower) {
        const matchesSearch = 
          log.target_username?.toLowerCase().includes(searchLower) ||
          log.target_user_id?.toLowerCase().includes(searchLower) ||
          log.moderator_username?.toLowerCase().includes(searchLower) ||
          log.moderator_id?.toLowerCase().includes(searchLower) ||
          log.reason?.toLowerCase().includes(searchLower) ||
          log.message?.toLowerCase().includes(searchLower) ||
          log.action_type?.toLowerCase().includes(searchLower) ||
          log.event_type?.toLowerCase().includes(searchLower)
        if (!matchesSearch) return false
      }

      if (filterAction && log.action_type !== filterAction) return false
      if (filterLevel && log.level !== filterLevel) return false
      if (filterDate) {
        const logDate = new Date(log.created_at || log.timestamp).toISOString().split('T')[0]
        if (logDate !== filterDate) return false
      }

      return true
    })
  }, [activeTab, siteLogs, warnLogs, discordLogs, searchQuery, filterAction, filterLevel, filterDate])

  const clearFilters = () => {
    setSearchQuery('')
    setFilterAction('')
    setFilterLevel('')
    setFilterDate('')
  }

  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (searchQuery.trim()) count++
    if (filterAction) count++
    if (filterLevel) count++
    if (filterDate) count++
    return count
  }, [searchQuery, filterAction, filterLevel, filterDate])

  if (!selectedGuildId) {
    return (
      <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto">
        <SelectGuildState
          icon={ShieldOff}
          title="Choisis d'abord un serveur"
          body="La categorie Logs devient disponible des que ton serveur est selectionne."
        />
      </div>
    )
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display font-800 text-2xl text-white">Logs & Historique</h1>
          <p className="text-white/40 text-sm mt-1">Historique complet des actions de moderation et evenements du bot. - {guild?.name}</p>
        </div>
        <button
          onClick={() => loadLogs()}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Recharger
        </button>
      </div>

      <div className="glass-card p-1 flex gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-5 py-3 rounded-xl font-mono text-sm transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-white/[0.08] border border-white/15 text-white shadow-[0_0_24px_rgba(255,255,255,0.08)]'
                  : 'text-white/50 hover:text-white/75 hover:bg-white/[0.02]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {isActive && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-white/5 to-transparent pointer-events-none"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Actions site" value={summaries.actionCount} tone="border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan" />
        <SummaryCard label="Avertissements" value={summaries.warnCount} tone="border-amber-500/20 bg-amber-500/10 text-amber-300" />
        <SummaryCard label="Erreurs Discord" value={summaries.errorCount} tone="border-red-500/20 bg-red-500/10 text-red-300" />
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-white/25 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              className="input-field pl-11 pr-4"
              placeholder="Rechercher par utilisateur, ID, raison, action..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/60 text-xs font-mono hover:text-white hover:border-white/20 transition-all"
              >
                Effacer ({activeFiltersCount})
              </button>
            )}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-mono transition-all ${
                showFilters
                  ? 'border-violet-500/25 bg-violet-500/10 text-violet-300'
                  : 'border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/20'
              }`}
            >
              <Filter className="w-4 h-4" />
              Filtres
              <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="grid gap-3 md:grid-cols-3 pt-2">
                <label className="block space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35 flex items-center gap-2">
                    <Zap className="w-3 h-3" />
                    Type d'action
                  </span>
                  <select
                    className="select-field"
                    value={filterAction}
                    onChange={(e) => setFilterAction(e.target.value)}
                  >
                    {ACTION_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35 flex items-center gap-2">
                    <FileText className="w-3 h-3" />
                    Niveau de log
                  </span>
                  <select
                    className="select-field"
                    value={filterLevel}
                    onChange={(e) => setFilterLevel(e.target.value)}
                  >
                    {LOG_LEVELS.map((level) => (
                      <option key={level.value} value={level.value}>{level.label}</option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35 flex items-center gap-2">
                    <Calendar className="w-3 h-3" />
                    Date
                  </span>
                  <input
                    type="date"
                    className="input-field"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                  />
                </label>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="space-y-3"
        >
          {loading && [...Array(3)].map((_, index) => <div key={index} className="h-32 rounded-3xl skeleton" />)}
          
          {!loading && filteredLogs.length === 0 && (
            <div className="glass-card p-8 text-center">
              {activeTab === 'site' && <Activity className="w-12 h-12 text-white/10 mx-auto mb-4" />}
              {activeTab === 'warnings' && <AlertTriangle className="w-12 h-12 text-white/10 mx-auto mb-4" />}
              {activeTab === 'discord' && <Bot className="w-12 h-12 text-white/10 mx-auto mb-4" />}
              <p className="font-display font-700 text-white text-lg">
                {activeFiltersCount > 0 ? 'Aucun resultat' : `Aucun ${activeTab === 'site' ? 'log site' : activeTab === 'warnings' ? 'avertissement' : 'log Discord'}`}
              </p>
              <p className="text-white/40 mt-2 text-sm">
                {activeFiltersCount > 0 ? 'Essayez de modifier vos filtres de recherche.' : 'Les logs apparaitront ici des qu\'il y aura de l\'activite.'}
              </p>
            </div>
          )}

          {!loading && activeTab === 'site' && filteredLogs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="glass-card p-5 space-y-4 hover:border-white/15 transition-all"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  {renderAvatar(log.target_username, null)}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display font-700 text-white truncate">{log.target_username || log.target_user_id}</p>
                      <span className={`px-2.5 py-1 rounded-full border text-xs font-mono ${ACTION_COLORS[log.action_type] || 'border-white/10 bg-white/[0.04] text-white/55'}`}>
                        {ACTION_LABELS[log.action_type] || log.action_type}
                      </span>
                    </div>
                    <p className="text-sm text-white/55 truncate mt-1 flex items-center gap-2">
                      <User className="w-3 h-3" />
                      Par {log.moderator_username || log.moderator_id}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-3 text-xs text-white/35 font-mono">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-white/35" />
                        ID: {log.target_user_id}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3" />
                        {formatDate(locale, log.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {log.reason && (
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30 mb-2">Raison</p>
                  <p className="text-white/80 text-sm">{log.reason}</p>
                </div>
              )}
            </motion.div>
          ))}

          {!loading && activeTab === 'warnings' && filteredLogs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="glass-card p-5 space-y-4 hover:border-white/15 transition-all"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  {renderAvatar(log.target_username, null)}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display font-700 text-white truncate">{log.target_username || log.target_user_id}</p>
                      <span className="px-2.5 py-1 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-300 text-xs font-mono">
                        Warning #{log.warning_number || '?'}
                      </span>
                    </div>
                    <p className="text-sm text-white/55 truncate mt-1 flex items-center gap-2">
                      <User className="w-3 h-3" />
                      Par {log.moderator_username || log.moderator_id}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-3 text-xs text-white/35 font-mono">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-white/35" />
                        ID: {log.target_user_id}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3" />
                        {formatDate(locale, log.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {log.reason && (
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30 mb-2">Raison</p>
                  <p className="text-white/80 text-sm">{log.reason}</p>
                </div>
              )}
            </motion.div>
          ))}

          {!loading && activeTab === 'discord' && filteredLogs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="glass-card p-5 space-y-4 hover:border-white/15 transition-all"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center shrink-0 ${LOG_LEVEL_COLORS[log.level] || 'border-white/10 bg-white/[0.04]'}`}>
                    <Bot className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display font-700 text-white truncate">{log.event_type || 'Event'}</p>
                      <span className={`px-2.5 py-1 rounded-full border text-xs font-mono uppercase ${LOG_LEVEL_COLORS[log.level] || 'border-white/10 bg-white/[0.04] text-white/55'}`}>
                        {log.level}
                      </span>
                    </div>
                    <p className="text-sm text-white/55 truncate mt-1">{log.guild_name || 'System'}</p>
                    <div className="flex flex-wrap gap-3 mt-3 text-xs text-white/35 font-mono">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3" />
                        {formatDate(locale, log.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {log.message && (
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30 mb-2">Message</p>
                  <p className="text-white/80 text-sm font-mono">{log.message}</p>
                </div>
              )}

              {log.metadata && Object.keys(log.metadata).length > 0 && (
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30 mb-2">Metadata</p>
                  <pre className="text-white/60 text-xs font-mono overflow-x-auto">{JSON.stringify(log.metadata, null, 2)}</pre>
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>

      {!loading && filteredLogs.length > 0 && (
        <div className="glass-card p-4 text-center text-white/40 text-sm font-mono">
          {filteredLogs.length} {filteredLogs.length === 1 ? 'entree' : 'entrees'} {activeFiltersCount > 0 ? 'trouvee(s)' : 'au total'}
        </div>
      )}
    </div>
  )
}
