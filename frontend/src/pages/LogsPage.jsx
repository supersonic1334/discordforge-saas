import { useEffect, useMemo, useState } from 'react'
import { FileText, History, RefreshCw, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import { logsAPI, modAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'
import {
  ACTION_COLORS,
  ACTION_LABELS,
  LOG_LEVEL_COLORS,
  SelectGuildState,
  SummaryCard,
  formatDate,
  getErrorMessage,
  renderAvatar,
} from '../components/moderation/moderationUI'

function SiteLogRow({ entry, locale }) {
  const actor = entry.actor || { username: 'System', user_id: 'system', avatar_url: null }
  return (
    <div className="glass-card p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {renderAvatar(actor.avatar_url, actor.username, 'from-cyan-500/25 to-blue-500/25')}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-white font-display font-700 truncate">{actor.username || 'System'}</p>
              <span className={`px-2.5 py-1 rounded-full text-xs font-mono border ${LOG_LEVEL_COLORS[entry.level] || 'text-white/70 border-white/10 bg-white/[0.05]'}`}>{String(entry.level || 'info').toUpperCase()}</span>
              <span className="px-2.5 py-1 rounded-full text-xs font-mono border border-white/10 bg-white/[0.03] text-white/55">{entry.category || 'Site'}</span>
            </div>
            <p className="text-xs text-white/35 font-mono mt-1">ID: {actor.user_id || actor.id || 'system'}</p>
            <p className="text-white/80 text-sm mt-3">{entry.action_performed || entry.message}</p>
          </div>
        </div>
        <span className="text-xs text-white/35 font-mono whitespace-nowrap">{formatDate(locale, entry.created_at)}</span>
      </div>
    </div>
  )
}

function WarningLogRow({ entry, locale }) {
  const metadata = entry.metadata || {}
  const targetLabel = entry.target_username || metadata.target_username || entry.target_user_id
  const moderatorName = metadata.moderator_display_name || metadata.moderator_site_username || entry.moderator_username || 'Inconnu'
  return (
    <div className="glass-card p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {renderAvatar(metadata.target_avatar_url || null, targetLabel, 'from-amber-500/25 to-orange-500/25')}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-white font-display font-700 truncate">{targetLabel}</p>
              <span className="px-2.5 py-1 rounded-full border text-xs font-mono border-amber-500/20 bg-amber-500/10 text-amber-300">Warn</span>
              <span className="px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.03] text-white/55 text-xs font-mono">{entry.points || 1} pt</span>
            </div>
            <p className="text-xs text-white/35 font-mono mt-1">ID: {entry.target_user_id}</p>
            <p className="text-white/80 text-sm mt-3">{entry.reason || 'Aucune raison precisee.'}</p>
            <p className="text-xs text-white/35 font-mono mt-3">Par: {moderatorName}</p>
          </div>
        </div>
        <span className="text-xs text-white/35 font-mono whitespace-nowrap">{formatDate(locale, entry.created_at)}</span>
      </div>
    </div>
  )
}

function DiscordLogRow({ entry, locale }) {
  const mainIdentity = entry.target?.kind === 'user'
    ? { username: entry.target.label, user_id: entry.target.id, avatar_url: entry.target.avatar_url }
    : { username: entry.executor?.global_name || entry.executor?.username || entry.executor?.id || 'Inconnu', user_id: entry.executor?.id || 'unknown', avatar_url: entry.executor?.avatar_url || null }
  const executorName = entry.executor?.global_name || entry.executor?.username || entry.executor?.id || 'Inconnu'
  const actionKey = entry.action_name || entry.action_label || entry.action_type

  return (
    <div className="glass-card p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {renderAvatar(mainIdentity.avatar_url, mainIdentity.username, 'from-violet-500/25 to-fuchsia-500/25')}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-white font-display font-700 truncate">{mainIdentity.username}</p>
              <span className={`px-2.5 py-1 rounded-full border text-xs font-mono ${ACTION_COLORS[actionKey] || 'border-white/10 bg-white/[0.03] text-white/55'}`}>{ACTION_LABELS[actionKey] || actionKey || `Action ${entry.action_type}`}</span>
            </div>
            <p className="text-xs text-white/35 font-mono mt-1">ID: {mainIdentity.user_id || 'unknown'}</p>
            <p className="text-white/80 text-sm mt-3">{entry.reason || 'Aucune raison precisee.'}</p>
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-white/35 font-mono">
              <span>Par: {executorName}</span>
              {entry.target?.kind && entry.target.kind !== 'user' ? <span>Cible: {entry.target.label}</span> : null}
            </div>
          </div>
        </div>
        <span className="text-xs text-white/35 font-mono whitespace-nowrap">{formatDate(locale, entry.created_at)}</span>
      </div>
    </div>
  )
}

export default function LogsPage() {
  const { locale } = useI18n()
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [warnings, setWarnings] = useState([])
  const [siteLogs, setSiteLogs] = useState([])
  const [discordLogs, setDiscordLogs] = useState([])
  const [loadingWarnings, setLoadingWarnings] = useState(false)
  const [loadingSiteLogs, setLoadingSiteLogs] = useState(false)
  const [loadingDiscordLogs, setLoadingDiscordLogs] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  async function loadWarnings({ silent = false } = {}) {
    if (!selectedGuildId) return
    if (!silent) setLoadingWarnings(true)
    try {
      const response = await modAPI.warnings(selectedGuildId, { page: 1, limit: 50 })
      setWarnings(response.data.warnings || [])
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error))
    } finally {
      if (!silent) setLoadingWarnings(false)
    }
  }

  async function loadSiteLogs({ silent = false } = {}) {
    if (!selectedGuildId) return
    if (!silent) setLoadingSiteLogs(true)
    try {
      const response = await logsAPI.list(selectedGuildId, { page: 1, limit: 50 })
      setSiteLogs(response.data.logs || [])
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error))
    } finally {
      if (!silent) setLoadingSiteLogs(false)
    }
  }

  async function loadDiscordLogs({ silent = false } = {}) {
    if (!selectedGuildId) return
    if (!silent) setLoadingDiscordLogs(true)
    try {
      const response = await logsAPI.discord(selectedGuildId, { page: 1, limit: 50 })
      setDiscordLogs(response.data.logs || [])
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error))
    } finally {
      if (!silent) setLoadingDiscordLogs(false)
    }
  }

  async function refreshAll({ silent = false } = {}) {
    if (!selectedGuildId) return
    if (silent) setRefreshing(true)
    await Promise.all([loadWarnings({ silent }), loadSiteLogs({ silent }), loadDiscordLogs({ silent })])
    if (silent) setRefreshing(false)
  }

  useEffect(() => {
    if (!selectedGuildId) return undefined
    refreshAll()
    const intervalId = window.setInterval(() => refreshAll({ silent: true }), 10000)
    return () => window.clearInterval(intervalId)
  }, [selectedGuildId])

  const totals = useMemo(() => ({ warnings: warnings.length, site: siteLogs.length, discord: discordLogs.length }), [warnings, siteLogs, discordLogs])

  if (!selectedGuildId) {
    return <SelectGuildState title="Choisis d abord un serveur" body="Logs devient disponible des que ton serveur est selectionne." actionLabel="Choisir un serveur" />
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display font-800 text-2xl text-white">Logs</h1>
          <p className="text-white/40 text-sm mt-1">Website logs, warning logs et Discord logs. - {guild?.name}</p>
        </div>
        <button onClick={() => refreshAll()} className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />Recharger</button>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-display font-700 text-white text-lg">Vue centralisee</p>
            <p className="text-white/40 text-sm mt-1">Trois flux distincts, mis a jour automatiquement toutes les 10 secondes.</p>
          </div>
          <div className="px-3 py-2 rounded-xl border border-neon-cyan/15 bg-neon-cyan/10 text-neon-cyan text-xs font-mono">Auto-refresh 10s</div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard label="Website logs" value={totals.site} tone="border-cyan-500/20 bg-cyan-500/10 text-cyan-300" />
          <SummaryCard label="Warning logs" value={totals.warnings} tone="border-amber-500/20 bg-amber-500/10 text-amber-300" />
          <SummaryCard label="Discord logs" value={totals.discord} tone="border-violet-500/20 bg-violet-500/10 text-violet-300" />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="space-y-4">
          <div className="glass-card p-5 flex items-center gap-3"><div className="w-11 h-11 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 flex items-center justify-center shrink-0"><FileText className="w-5 h-5 text-cyan-300" /></div><div><p className="font-display font-700 text-white text-lg">Website logs</p><p className="text-white/40 text-sm mt-1">Logs internes du site et du bot.</p></div></div>
          <div className="space-y-3">{loadingSiteLogs && [...Array(3)].map((_, index) => <div key={index} className="h-28 rounded-3xl skeleton" />)}{!loadingSiteLogs && siteLogs.length === 0 && <div className="glass-card p-8 text-center text-white/40 text-sm">Aucun log interne.</div>}{!loadingSiteLogs && siteLogs.map((entry) => <SiteLogRow key={entry.id} entry={entry} locale={locale} />)}</div>
        </section>

        <section className="space-y-4">
          <div className="glass-card p-5 flex items-center gap-3"><div className="w-11 h-11 rounded-2xl border border-amber-500/20 bg-amber-500/10 flex items-center justify-center shrink-0"><ShieldAlert className="w-5 h-5 text-amber-300" /></div><div><p className="font-display font-700 text-white text-lg">Warning logs</p><p className="text-white/40 text-sm mt-1">Historique recent des avertissements actifs.</p></div></div>
          <div className="space-y-3">{loadingWarnings && [...Array(3)].map((_, index) => <div key={index} className="h-28 rounded-3xl skeleton" />)}{!loadingWarnings && warnings.length === 0 && <div className="glass-card p-8 text-center text-white/40 text-sm">Aucun avertissement actif.</div>}{!loadingWarnings && warnings.map((entry) => <WarningLogRow key={entry.id} entry={entry} locale={locale} />)}</div>
        </section>

        <section className="space-y-4">
          <div className="glass-card p-5 flex items-center gap-3"><div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0"><History className="w-5 h-5 text-violet-300" /></div><div><p className="font-display font-700 text-white text-lg">Discord logs</p><p className="text-white/40 text-sm mt-1">Audit log recent du serveur.</p></div></div>
          <div className="space-y-3">{loadingDiscordLogs && [...Array(3)].map((_, index) => <div key={index} className="h-28 rounded-3xl skeleton" />)}{!loadingDiscordLogs && discordLogs.length === 0 && <div className="glass-card p-8 text-center text-white/40 text-sm">Aucun log Discord recent.</div>}{!loadingDiscordLogs && discordLogs.map((entry) => <DiscordLogRow key={entry.id} entry={entry} locale={locale} />)}</div>
        </section>
      </div>
    </div>
  )
}
