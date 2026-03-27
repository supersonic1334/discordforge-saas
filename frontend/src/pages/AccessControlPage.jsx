import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Ban, Fingerprint, RefreshCw, Search, ShieldOff, UserRoundX, Shield, Filter, ChevronDown, Sparkles, ShieldCheck } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
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
    <div className="spotlight-card p-8 text-center">
      <div className="relative z-[1]">
        <Icon className="w-12 h-12 text-white/10 mx-auto mb-4" />
        <p className="font-display font-700 text-white text-lg">{title}</p>
        <p className="text-white/40 mt-2 text-sm">{body}</p>
      </div>
    </div>
  )
}

function CountCard({ label, value, tone }) {
  return (
    <div className={`feature-metric border ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] opacity-70">{label}</p>
      <p className="mt-2 font-display text-2xl font-800">{value}</p>
    </div>
  )
}

function HeaderPill({ icon: Icon, label }) {
  return (
    <span className="feature-chip">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
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
  const actionLabel = isBan ? 'Debannir' : 'Retirer'
  const icon = isBan ? Ban : Fingerprint
  const Icon = icon
  const timestamp = isBan ? entry.banned_at : (entry.updated_at || entry.created_at)

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="depth-panel p-5 space-y-4"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar
            src={entry.avatar_url}
            label={entry.display_name}
            tone={isBan ? 'from-red-500/25 to-orange-500/25' : 'from-violet-500/25 to-fuchsia-500/25'}
          />
          <div className="min-w-0 flex-1">
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
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-white/35" />
                ID: {entry.id}
              </span>
              <span>{isBan ? 'Banni le' : 'Mis a jour'}: {formatDate(locale, timestamp)}</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => onAction(entry)}
          disabled={actioning}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-2xl border text-sm font-mono transition-all disabled:opacity-60 ${isBan ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15' : 'border-amber-500/25 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'}`}
        >
          {actioning ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Icon className="w-4 h-4" />
          )}
          {actionLabel}
        </button>
      </div>

      <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30 mb-2">Raison</p>
        <p className="text-white/80 text-sm">{entry.reason || 'Aucune raison precisee.'}</p>
      </div>
    </motion.div>
  )
}

export default function AccessControlPage() {
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
  const [showFilters, setShowFilters] = useState(false)
  const [filterType, setFilterType] = useState('all')

  function removeEntryLocally(kind, userId) {
    if (kind === 'ban') {
      setBans((current) => current.filter((entry) => entry.id !== userId))
      setTotals((current) => ({ ...current, bans: Math.max(0, (current.bans || 0) - 1) }))
      return
    }

    setBlacklist((current) => current.filter((entry) => entry.id !== userId))
    setTotals((current) => ({ ...current, blacklist: Math.max(0, (current.blacklist || 0) - 1) }))
  }

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

    try {
      await blockedAPI.unban(selectedGuildId, entry.id)
      removeEntryLocally('ban', entry.id)
      toast.success('Utilisateur debanni avec succes')
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

    try {
      await blockedAPI.unblacklist(selectedGuildId, entry.id)
      removeEntryLocally('blacklist', entry.id)
      toast.success('Utilisateur retire de la blacklist avec succes')
      await loadBlocked({ silent: true })
    } catch (error) {
      toast.error(getErrorMessage(error))
      await loadBlocked({ silent: true })
    } finally {
      setActioningId('')
    }
  }

  const filteredBans = useMemo(() => {
    if (filterType === 'blacklist') return []
    return bans
  }, [bans, filterType])

  const filteredBlacklist = useMemo(() => {
    if (filterType === 'bans') return []
    return blacklist
  }, [blacklist, filterType])

  const hasResults = useMemo(() => filteredBans.length > 0 || filteredBlacklist.length > 0, [filteredBans.length, filteredBlacklist.length])

  if (!selectedGuildId) {
    return (
      <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto">
        <EmptyState
          icon={ShieldOff}
          title="Choisis d'abord un serveur"
          body="La categorie Controle d'Acces devient disponible des que ton serveur est selectionne."
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
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <HeaderPill icon={Ban} label="bannis serveur" />
              <HeaderPill icon={Fingerprint} label="blacklist reseau" />
              <HeaderPill icon={Shield} label={guild?.name || 'controle'} />
            </div>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">Controle d'acces</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 sm:text-[15px]">Panneau plus lisible pour debannir, retirer une blacklist et garder un oeil clair sur toutes les restrictions du reseau.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 xl:justify-end">
            <button
              onClick={() => loadBlocked()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-mono text-white/70 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Recharger
            </button>
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-2">
          <CountCard label="Bannis serveur" value={totals.bans || 0} tone="border-red-500/20 bg-red-500/10 text-red-300" />
          <CountCard label="Blacklist reseau" value={totals.blacklist || 0} tone="border-violet-500/20 bg-violet-500/10 text-violet-300" />
        </div>

        <div className="relative z-[1] mt-4 grid gap-3 lg:grid-cols-2">
          <div className="depth-panel-static rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 overflow-hidden relative">
            <div className="absolute inset-x-4 bottom-4 h-10 rounded-full bg-red-400/10 blur-2xl pointer-events-none" />
            <div className="flex items-center gap-3 relative">
              <div className="w-11 h-11 rounded-2xl border border-red-400/20 bg-red-400/10 flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(248,113,113,0.12)]">
                <Ban className="w-5 h-5 text-red-300" />
              </div>
              <div>
                <p className="font-display font-700 text-white">Deban instantane</p>
                <p className="text-white/40 text-sm mt-1">Le retrait disparait directement de la liste et se resynchronise sans effort.</p>
              </div>
            </div>
          </div>
          <div className="depth-panel-static rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 overflow-hidden relative">
            <div className="absolute inset-x-4 bottom-4 h-10 rounded-full bg-violet-400/10 blur-2xl pointer-events-none" />
            <div className="flex items-center gap-3 relative">
              <div className="w-11 h-11 rounded-2xl border border-violet-400/20 bg-violet-400/10 flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(192,132,252,0.12)]">
                <ShieldCheck className="w-5 h-5 text-violet-300" />
              </div>
              <div>
                <p className="font-display font-700 text-white">Surveillance reseau</p>
                <p className="text-white/40 text-sm mt-1">Bannis serveur et blacklist globale restent lisibles dans un seul espace clair.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="spotlight-card p-5 sm:p-6">
        <div className="relative z-[1] space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-white/25 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              className="input-field pl-11"
              placeholder="Pseudo, ID, raison, module..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
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
              <div className="pt-2">
                <label className="block space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Type de restriction</span>
                  <select
                    className="select-field"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                  >
                    <option value="all">Tout afficher</option>
                    <option value="bans">Bannis uniquement</option>
                    <option value="blacklist">Blacklist uniquement</option>
                  </select>
                </label>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {filterType !== 'blacklist' && (
          <section className="space-y-4">
            <div className="spotlight-card p-5 flex items-center gap-3">
              <div className="relative z-[1] flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-red-500/20 bg-red-500/10 flex items-center justify-center shrink-0">
                <Ban className="w-5 h-5 text-red-300" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Bannis du serveur</p>
                <p className="text-white/40 text-sm mt-1">Liste des comptes actuellement bannis sur ce serveur.</p>
              </div>
              </div>
            </div>

            <div className="space-y-3">
              {loading && [...Array(3)].map((_, index) => <div key={index} className="h-40 rounded-3xl skeleton" />)}
              {!loading && filteredBans.length === 0 && (
                <EmptyState
                  icon={UserRoundX}
                  title="Aucun banni visible"
                  body={query.trim() ? 'Aucun banni ne correspond a cette recherche.' : 'Le serveur ne remonte aucun banni pour le moment.'}
                />
              )}
              {!loading && filteredBans.map((entry) => (
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
        )}

        {filterType !== 'bans' && (
          <section className="space-y-4">
            <div className="spotlight-card p-5 flex items-center gap-3">
              <div className="relative z-[1] flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0">
                <Fingerprint className="w-5 h-5 text-violet-300" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Blacklist reseau</p>
                <p className="text-white/40 text-sm mt-1">Blocages globaux du bot sur tout ton reseau de serveurs.</p>
              </div>
              </div>
            </div>

            <div className="space-y-3">
              {loading && [...Array(3)].map((_, index) => <div key={index} className="h-40 rounded-3xl skeleton" />)}
              {!loading && filteredBlacklist.length === 0 && (
                <EmptyState
                  icon={Fingerprint}
                  title="Aucune blacklist visible"
                  body={query.trim() ? 'Aucune entree de blacklist ne correspond a cette recherche.' : 'Aucun utilisateur n\'est bloque au niveau reseau pour le moment.'}
                />
              )}
              {!loading && filteredBlacklist.map((entry) => (
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
        )}
      </div>

      {!loading && !hasResults && query.trim() && (
        <div className="spotlight-card p-5 text-center text-white/40 text-sm">
          <div className="relative z-[1]">Aucun resultat pour cette recherche.</div>
        </div>
      )}
    </div>
  )
}
