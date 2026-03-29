import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Clock3, Flame, Radar, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import { logsAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { renderAvatar } from '../components/moderation/moderationUI'

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Erreur inattendue'
}

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('fr-FR')
  } catch {
    return value
  }
}

function inferSeverity(entry) {
  const level = String(entry?.level || entry?.severity || entry?.type || '').toLowerCase()
  const action = String(entry?.action || entry?.action_name || entry?.title || '').toLowerCase()

  if (level.includes('error') || level.includes('critical') || action.includes('ban') || action.includes('nuke')) return 'critical'
  if (level.includes('warn') || action.includes('timeout') || action.includes('raid') || action.includes('blacklist')) return 'high'
  return 'medium'
}

function normalizeEntry(entry, source) {
  const severity = inferSeverity(entry)
  return {
    id: entry?.id || `${source}-${entry?.timestamp || entry?.created_at || Math.random()}`,
    source,
    severity,
    title: entry?.action || entry?.action_name || entry?.title || entry?.message || 'Événement',
    detail: entry?.message || entry?.reason || entry?.summary || entry?.description || 'Aucun détail complémentaire.',
    actor: entry?.actor?.global_name || entry?.actor?.username || entry?.executor?.global_name || entry?.executor?.username || entry?.username || 'Système',
    actorAvatar: entry?.actor?.avatar_url || entry?.executor?.avatar_url || entry?.metadata?.actor_avatar_url || null,
    targetLabel: entry?.target?.label || entry?.metadata?.target_label || entry?.target_username || null,
    targetSubtitle: entry?.target?.subtitle || entry?.metadata?.target_subtitle || null,
    timestamp: entry?.timestamp || entry?.created_at || entry?.executed_at || entry?.date || null,
  }
}

function MetricCard({ label, value, tone }) {
  const tones = {
    critical: 'border-red-500/15 bg-red-500/[0.06]',
    high: 'border-amber-400/15 bg-amber-400/[0.06]',
    medium: 'border-neon-cyan/15 bg-neon-cyan/[0.06]',
  }

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">{label}</p>
      <p className="mt-2 font-display text-2xl font-800 text-white">{value}</p>
    </div>
  )
}

function IncidentRow({ item }) {
  const severityUI = {
    critical: 'border-red-500/20 bg-red-500/[0.05] text-red-300',
    high: 'border-amber-400/20 bg-amber-400/[0.05] text-amber-300',
    medium: 'border-neon-cyan/20 bg-neon-cyan/[0.05] text-neon-cyan',
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          {renderAvatar(item.actorAvatar, item.actor, 'from-cyan-500/25 to-violet-500/25', 'w-12 h-12')}
          <div className="min-w-0">
            <p className="truncate font-display font-700 text-white">{item.title}</p>
            <p className="mt-1 truncate text-xs font-mono text-white/35">
              {item.source} · par {item.actor}
            </p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.16em] ${severityUI[item.severity]}`}>
          {item.severity}
        </span>
      </div>

      {item.targetLabel ? (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px] font-mono text-white/58">
            Cible: {item.targetLabel}
          </span>
          {item.targetSubtitle ? (
            <span className="inline-flex items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px] font-mono text-white/42">
              {item.targetSubtitle}
            </span>
          ) : null}
        </div>
      ) : null}

      <p className="text-sm leading-relaxed text-white/58">{item.detail}</p>

      <div className="flex items-center gap-2 text-xs font-mono text-white/30">
        <Clock3 className="h-3.5 w-3.5" />
        {formatDate(item.timestamp)}
      </div>
    </div>
  )
}

export default function IncidentsPage() {
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const grouped = useMemo(() => {
    const critical = items.filter((item) => item.severity === 'critical')
    const high = items.filter((item) => item.severity === 'high')
    const medium = items.filter((item) => item.severity === 'medium')
    return { critical, high, medium }
  }, [items])

  useEffect(() => {
    if (!selectedGuildId) return
    let active = true

    async function loadIncidents() {
      try {
        const [siteResponse, discordResponse] = await Promise.all([
          logsAPI.list(selectedGuildId, { limit: 24 }),
          logsAPI.discord(selectedGuildId, { limit: 24 }),
        ])

        if (!active) return

        const siteItems = (siteResponse.data?.logs || siteResponse.data?.items || []).map((entry) => normalizeEntry(entry, 'site'))
        const discordItems = (discordResponse.data?.logs || discordResponse.data?.items || []).map((entry) => normalizeEntry(entry, 'discord'))

        setItems(
          [...siteItems, ...discordItems]
            .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
            .slice(0, 30),
        )
      } catch (error) {
        toast.error(getErrorMessage(error))
      } finally {
        if (active) setLoading(false)
      }
    }

    loadIncidents()
    const intervalId = window.setInterval(loadIncidents, 10000)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [selectedGuildId])

  if (!selectedGuildId) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-20 pb-5 sm:p-6 sm:pt-24">
        <div className="glass-card p-10 text-center">
          <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-white/10" />
          <p className="font-display text-xl font-700 text-white">Choisis d'abord un serveur</p>
          <p className="mt-2 text-white/40">La vue Incidents dépend du serveur actif.</p>
          <Link to="/dashboard/servers" className="mt-5 inline-flex items-center gap-2 rounded-xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 font-mono text-sm text-neon-cyan transition-all hover:bg-neon-cyan/20">
            Choisir un serveur
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:p-6">
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="feature-chip"><Radar className="h-3.5 w-3.5" /> incidents</span>
              <span className="feature-chip"><Flame className="h-3.5 w-3.5" /> surveillance live</span>
              <span className="feature-chip"><ShieldAlert className="h-3.5 w-3.5" /> {guild?.name || 'serveur'}</span>
            </div>
            <div>
              <h1 className="font-display text-3xl font-800 text-white sm:text-4xl">Incidents</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 sm:text-[15px]">
                Vue plus claire des événements critiques avec la personne, la cible et le contexte visibles en un coup d'œil.
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-3">
          <MetricCard label="Critiques" value={grouped.critical.length} tone="critical" />
          <MetricCard label="Élevés" value={grouped.high.length} tone="high" />
          <MetricCard label="Modérés" value={grouped.medium.length} tone="medium" />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {loading ? (
            <>
              <div className="skeleton h-32 rounded-3xl" />
              <div className="skeleton h-32 rounded-3xl" />
              <div className="skeleton h-32 rounded-3xl" />
            </>
          ) : items.length === 0 ? (
            <div className="spotlight-card p-10 text-center text-white/40">
              Aucun incident récent pour le moment.
            </div>
          ) : (
            items.map((item) => <IncidentRow key={item.id} item={item} />)
          )}
        </div>

        <div className="space-y-5">
          <div className="spotlight-card space-y-4 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
                <AlertTriangle className="h-5 w-5 text-red-300" />
              </div>
              <div>
                <p className="font-display text-lg font-700 text-white">Réponses rapides</p>
                <p className="mt-1 text-sm text-white/40">Va directement à la bonne zone selon la situation.</p>
              </div>
            </div>

            <div className="grid gap-3">
              <Link to="/dashboard/protection" className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-white/70 transition-all hover:border-white/12 hover:text-white">
                <p className="font-display font-700 text-white">Protection</p>
                <p className="mt-1 text-sm text-white/45">Renforce le verrouillage, l'anti-raid et l'anti-nuke.</p>
              </Link>
              <Link to="/dashboard/logs" className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-white/70 transition-all hover:border-white/12 hover:text-white">
                <p className="font-display font-700 text-white">Logs</p>
                <p className="mt-1 text-sm text-white/45">Ouvre les journaux complets avec plus de détails.</p>
              </Link>
              <Link to="/dashboard/blocked" className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-white/70 transition-all hover:border-white/12 hover:text-white">
                <p className="font-display font-700 text-white">Contrôle d'accès</p>
                <p className="mt-1 text-sm text-white/45">Vérifie les bannis et la blacklist réseau.</p>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
