import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Bot, RefreshCw, ShieldOff, Search, Filter, Calendar, User, Zap, FileText, ChevronDown, Trash2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { logsAPI, modAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'
import { ACTION_LABELS, ACTION_COLORS, LOG_LEVEL_COLORS, getErrorMessage, formatDate, renderAvatar, SelectGuildState } from '../components/moderation/moderationUI'

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

function HeaderPill({ icon: Icon, label }) {
  return (
    <span className="feature-chip">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  )
}

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
  const [clearingDiscord, setClearingDiscord] = useState(false)
  const [expandedDetails, setExpandedDetails] = useState({})

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

  async function handleClearDiscordLogs() {
    if (!selectedGuildId || clearingDiscord) return
    if (!window.confirm('Vider les logs Discord affiches ? Les anciens logs ne reviendront plus apres refresh.')) return

    setClearingDiscord(true)
    try {
      await logsAPI.clearDiscord(selectedGuildId)
      setDiscordLogs([])
      toast.success('Logs Discord vides')
      await loadDiscordLogs({ silent: true })
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setClearingDiscord(false)
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
    const discordCount = discordLogs.length
    return { warnCount, actionCount, discordCount }
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
          log.event_type?.toLowerCase().includes(searchLower) ||
          log.action_name?.toLowerCase().includes(searchLower) ||
          log.executor?.username?.toLowerCase().includes(searchLower) ||
          log.executor?.global_name?.toLowerCase().includes(searchLower) ||
          log.metadata?.actor_name?.toLowerCase().includes(searchLower) ||
          log.metadata?.target_label?.toLowerCase().includes(searchLower) ||
          log.target?.label?.toLowerCase().includes(searchLower) ||
          (Array.isArray(log.details) && log.details.some((detail) => detail?.toLowerCase().includes(searchLower)))
        if (!matchesSearch) return false
      }

      if (filterAction) {
        const currentAction = String(activeTab === 'discord' ? (log.action_name || '') : (log.action_type || '')).toLowerCase()
        if (currentAction !== filterAction) return false
      }
      if (filterLevel && log.level && log.level !== filterLevel) return false
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

  const toggleDetails = (logId) => {
    setExpandedDetails((current) => ({
      ...current,
      [logId]: !current[logId],
    }))
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
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <HeaderPill icon={Activity} label="logs site" />
              <HeaderPill icon={AlertTriangle} label="warnings" />
              <HeaderPill icon={Bot} label={guild?.name || 'discord'} />
            </div>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">Logs & historique</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 sm:text-[15px]">Vue plus nette des actions staff, avertissements et evenements Discord, avec lecture rapide et filtres propres.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 xl:justify-end">
            <button
              onClick={() => loadLogs()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-mono text-white/70 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Recharger
            </button>
            {activeTab === 'discord' && (
              <button
                onClick={handleClearDiscordLogs}
                disabled={clearingDiscord}
                className="inline-flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-mono text-red-300 transition-all hover:bg-red-500/15 disabled:opacity-50"
              >
                <Trash2 className={`w-4 h-4 ${clearingDiscord ? 'animate-pulse' : ''}`} />
                {clearingDiscord ? 'Vidage...' : 'Vider Discord'}
              </button>
            )}
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-3">
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Actions site</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{summaries.actionCount}</p>
          </div>
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Avertissements</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{summaries.warnCount}</p>
          </div>
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Evenements Discord</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{summaries.discordCount}</p>
          </div>
        </div>
      </div>

      <div className="spotlight-card p-1">
        <div className="relative z-[1] flex gap-1 overflow-x-auto">
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
      </div>

      <div className="spotlight-card p-5 sm:p-6">
        <div className="relative z-[1] space-y-4">
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
            <div className="feature-hero p-8 text-center">
              <div className="relative z-[1]">
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
            </div>
          )}

          {!loading && activeTab === 'site' && filteredLogs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="depth-panel p-5 space-y-4"
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
                <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
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
              className="depth-panel p-5 space-y-4"
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
                <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
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
              className="depth-panel p-5 space-y-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  {renderAvatar(
                    log.executor?.avatar_url || log.target?.avatar_url || null,
                    log.executor?.global_name || log.executor?.username || log.metadata?.actor_name || log.target?.label || 'Discord',
                    'from-violet-500/25 to-fuchsia-500/25'
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display font-700 text-white truncate">{log.event_type || 'Event'}</p>
                      <span className={`px-2.5 py-1 rounded-full border text-xs font-mono uppercase ${LOG_LEVEL_COLORS[log.level] || 'border-white/10 bg-white/[0.04] text-white/55'}`}>
                        {log.level}
                      </span>
                      <span className={`px-2.5 py-1 rounded-full border text-[11px] font-mono ${log.metadata?.source_kind === 'runtime' ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300' : 'border-violet-500/20 bg-violet-500/10 text-violet-300'}`}>
                        {log.metadata?.source_kind === 'runtime' ? 'Detection bot' : 'Audit Discord'}
                      </span>
                      {log.target?.label ? (
                        <span className="px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.04] text-xs font-mono text-white/60">
                          {log.target.label}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-white/55 mt-1">
                      {log.executor?.global_name || log.executor?.username || log.metadata?.actor_name || 'System'}
                    </p>
                    {log.message ? (
                      <p className="mt-3 text-sm leading-6 text-white/80">
                        {log.message}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-3 mt-3 text-xs text-white/35 font-mono">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3" />
                        {formatDate(locale, log.timestamp)}
                      </span>
                      {log.target?.subtitle ? (
                        <span className="flex items-center gap-1.5">
                          <Bot className="w-3 h-3" />
                          {log.target.subtitle}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleDetails(log.id)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-mono text-white/65 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                  >
                    Infos supplementaires
                    <ChevronDown className={`w-3 h-3 transition-transform ${expandedDetails[log.id] ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {expandedDetails[log.id] ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-2xl border border-white/8 bg-black/15 p-4 space-y-3">
                      <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Details utiles</p>
                      {Array.isArray(log.details) && log.details.length > 0 ? (
                        <div className="space-y-2">
                          {log.details.map((detail, index) => (
                            <div key={`${log.id}-${index}`} className="rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2 text-sm text-white/78">
                              {detail}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-white/45">Aucune information supplementaire utile sur cette entree.</p>
                      )}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>

      {!loading && filteredLogs.length > 0 && (
        <div className="spotlight-card p-4 text-center text-white/40 text-sm font-mono">
          <div className="relative z-[1]">
            {filteredLogs.length} {filteredLogs.length === 1 ? 'entree' : 'entrees'} {activeFiltersCount > 0 ? 'trouvee(s)' : 'au total'}
          </div>
        </div>
      )}
    </div>
  )
}
