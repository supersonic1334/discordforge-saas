import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Ban, Fingerprint, RefreshCw, Search, ShieldOff, Trash2, UserRoundX } from 'lucide-react'
import toast from 'react-hot-toast'
import { blockedAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Erreur inattendue'
}

function formatDate(locale, value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString(locale)
  } catch {
    return String(value)
  }
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?'
}

function Avatar({ src, label, tone = 'from-cyan-500/25 to-violet-500/25' }) {
  if (src) {
    return <img src={src} alt={label} className="w-14 h-14 rounded-2xl object-cover border border-white/10 shadow-[0_14px_36px_rgba(0,0,0,0.22)]" />
  }

  return (
    <div className={`w-14 h-14 rounded-2xl border border-white/10 bg-gradient-to-br ${tone} flex items-center justify-center text-white/75 font-mono text-xs shadow-[0_14px_36px_rgba(0,0,0,0.22)]`}>
      {initials(label)}
    </div>
  )
}

function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="glass-card p-8 text-center">
      <Icon className="w-12 h-12 text-white/10 mx-auto mb-4" />
      <p className="font-display font-700 text-white text-lg">{title}</p>
      <p className="text-white/40 mt-2 text-sm">{body}</p>
    </div>
  )
}

function CountCard({ label, value, tone }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] opacity-70">{label}</p>
      <p className="mt-2 font-display text-2xl font-800">{value}</p>
    </div>
  )
}

function BlockedRow({
  entry,
  kind,
  locale,
  actioning,
  onAction,
}) {
  const isBan = kind === 'ban'
  const actionLabel = isBan ? 'Déban' : 'Retirer'
  const icon = isBan ? Ban : Fingerprint
  const Icon = icon
  const timestamp = isBan ? entry.banned_at : (entry.updated_at || entry.created_at)

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar
            src={entry.avatar_url}
            label={entry.display_name}
            tone={isBan ? 'from-red-500/25 to-orange-500/25' : 'from-violet-500/25 to-fuchsia-500/25'}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display font-700 text-white truncate">{entry.display_name || entry.username || entry.id}</p>
              <span className={`px-2.5 py-1 rounded-full border text-xs font-mono ${isBan ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-violet-500/20 bg-violet-500/10 text-violet-300'}`}>
                {isBan ? 'Banni' : 'Blacklist'}
              </span>
              {!isBan && entry.source_module && (
                <span className="px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.04] text-white/55 text-xs font-mono">
                  {entry.source_module}
                </span>
              )}
            </div>
            <p className="text-sm text-white/55 truncate mt-1">@{entry.username || entry.id}</p>
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-white/35 font-mono">
              <span>ID: {entry.id}</span>
              <span>{isBan ? 'Date' : 'Mis a jour'}: {formatDate(locale, timestamp)}</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => onAction(entry)}
          disabled={actioning}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-2xl border text-sm font-mono transition-all disabled:opacity-60 ${isBan ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15' : 'border-amber-500/25 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'}`}
        >
          <Icon className={`w-4 h-4 ${actioning ? 'animate-pulse' : ''}`} />
          {actionLabel}
        </button>
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30 mb-2">Raison</p>
        <p className="text-white/80 text-sm">{entry.reason || 'Aucune raison precisee.'}</p>
      </div>
    </div>
  )
}

export default function BlockedPage() {
  const { locale } = useI18n()
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [query, setQuery] = useState('')
  const [bans, setBans] = useState([])
  const [blacklist, setBlacklist] = useState([])
  const [totals, setTotals] = useState({ bans: 0, blacklist: 0 })
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [actioningId, setActioningId] = useState('')

  async function loadBlocked({ silent = false } = {}) {
    if (!selectedGuildId) return
    if (silent) setRefreshing(true)
    else setLoading(true)

    try {
      const response = await blockedAPI.list(selectedGuildId, { q: query.trim() || undefined })
      setBans(response.data.bans || [])
      setBlacklist(response.data.blacklist || [])
      setTotals(response.data.totals || { bans: 0, blacklist: 0 })
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!selectedGuildId) return undefined

    const firstLoad = window.setTimeout(() => {
      loadBlocked()
    }, 120)

    const intervalId = window.setInterval(() => {
      loadBlocked({ silent: true })
    }, 8000)

    return () => {
      window.clearTimeout(firstLoad)
      window.clearInterval(intervalId)
    }
  }, [selectedGuildId, query])

  useEffect(() => {
    setBans([])
    setBlacklist([])
    setTotals({ bans: 0, blacklist: 0 })
  }, [selectedGuildId])

  async function handleUnban(entry) {
    if (!selectedGuildId || !entry?.id || actioningId) return
    setActioningId(`ban:${entry.id}`)
    setBans((current) => current.filter((item) => item.id !== entry.id))
    setTotals((current) => ({ ...current, bans: Math.max(0, (current.bans || 0) - 1) }))

    try {
      await blockedAPI.unban(selectedGuildId, entry.id)
      toast.success('Utilisateur debanni')
      await loadBlocked({ silent: true })
    } catch (error) {
      toast.error(getErrorMessage(error))
      await loadBlocked({ silent: true })
    } finally {
      setActioningId('')
    }
  }

  async function handleUnblacklist(entry) {
    if (!selectedGuildId || !entry?.id || actioningId) return
    setActioningId(`blacklist:${entry.id}`)
    setBlacklist((current) => current.filter((item) => item.id !== entry.id))
    setTotals((current) => ({ ...current, blacklist: Math.max(0, (current.blacklist || 0) - 1) }))

    try {
      await blockedAPI.unblacklist(selectedGuildId, entry.id)
      toast.success('Utilisateur retire de la blacklist')
      await loadBlocked({ silent: true })
    } catch (error) {
      toast.error(getErrorMessage(error))
      await loadBlocked({ silent: true })
    } finally {
      setActioningId('')
    }
  }

  const hasResults = useMemo(() => bans.length > 0 || blacklist.length > 0, [bans.length, blacklist.length])

  if (!selectedGuildId) {
    return (
      <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto">
        <EmptyState
          icon={ShieldOff}
          title="Choisis d'abord un serveur"
          body="La categorie Blocages devient disponible des que ton serveur est selectionne."
        />
        <div className="mt-5 text-center">
          <Link to="/dashboard/servers" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/20 transition-all">
            Choisir un serveur
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display font-800 text-2xl text-white">Blocages</h1>
          <p className="text-white/40 text-sm mt-1">Recherche, deban et retrait de blacklist. - {guild?.name}</p>
        </div>
        <button
          onClick={() => loadBlocked()}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Recharger
        </button>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="relative">
            <Search className="w-4 h-4 text-white/25 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              className="input-field pl-11"
              placeholder="Pseudo, ID, raison, module..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 flex items-center justify-between text-sm">
            <span className="text-white/40 font-mono">Auto-refresh</span>
            <span className="text-neon-cyan font-mono">8s</span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <CountCard label="Bannis serveur" value={totals.bans || 0} tone="border-red-500/20 bg-red-500/10 text-red-300" />
          <CountCard label="Blacklist reseau" value={totals.blacklist || 0} tone="border-violet-500/20 bg-violet-500/10 text-violet-300" />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="space-y-4">
          <div className="glass-card p-5 flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl border border-red-500/20 bg-red-500/10 flex items-center justify-center shrink-0">
              <Ban className="w-5 h-5 text-red-300" />
            </div>
            <div>
              <p className="font-display font-700 text-white text-lg">Bannis du serveur</p>
              <p className="text-white/40 text-sm mt-1">Liste des comptes actuellement bannis sur ce serveur.</p>
            </div>
          </div>

          <div className="space-y-3">
            {loading && [...Array(3)].map((_, index) => <div key={index} className="h-40 rounded-3xl skeleton" />)}
            {!loading && bans.length === 0 && (
              <EmptyState
                icon={UserRoundX}
                title="Aucun banni visible"
                body={query.trim() ? 'Aucun banni ne correspond a cette recherche.' : 'Le serveur ne remonte aucun banni pour le moment.'}
              />
            )}
            {!loading && bans.map((entry) => (
              <BlockedRow
                key={`ban-${entry.id}`}
                entry={entry}
                kind="ban"
                locale={locale}
                actioning={actioningId === `ban:${entry.id}`}
                onAction={handleUnban}
              />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="glass-card p-5 flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0">
              <Fingerprint className="w-5 h-5 text-violet-300" />
            </div>
            <div>
              <p className="font-display font-700 text-white text-lg">Blacklist reseau</p>
              <p className="text-white/40 text-sm mt-1">Blocages globaux du bot sur tout ton reseau de serveurs.</p>
            </div>
          </div>

          <div className="space-y-3">
            {loading && [...Array(3)].map((_, index) => <div key={index} className="h-40 rounded-3xl skeleton" />)}
            {!loading && blacklist.length === 0 && (
              <EmptyState
                icon={Fingerprint}
                title="Aucune blacklist visible"
                body={query.trim() ? 'Aucune entree de blacklist ne correspond a cette recherche.' : 'Aucun utilisateur n est bloque au niveau reseau pour le moment.'}
              />
            )}
            {!loading && blacklist.map((entry) => (
              <BlockedRow
                key={`blacklist-${entry.id}`}
                entry={entry}
                kind="blacklist"
                locale={locale}
                actioning={actioningId === `blacklist:${entry.id}`}
                onAction={handleUnblacklist}
              />
            ))}
          </div>
        </section>
      </div>

      {!loading && !hasResults && query.trim() && (
        <div className="glass-card p-5 text-center text-white/40 text-sm">
          Aucun resultat pour cette recherche.
        </div>
      )}
    </div>
  )
}
