import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Calendar, ChevronDown, Clock3, Flame, Radar, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import { logsAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { renderAvatar } from '../components/moderation/moderationUI'

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Erreur inattendue'
}

function formatDate(value) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString('fr-FR')
  } catch {
    return String(value)
  }
}

function inferSeverity(entry) {
  const level = String(entry?.level || entry?.severity || '').toLowerCase()
  const action = String(entry?.action || entry?.action_name || entry?.title || '').toLowerCase()

  if (
    level.includes('error')
    || level.includes('critical')
    || action.includes('ban')
    || action.includes('nuke')
    || action.includes('suppression multiple')
  ) return 'critical'

  if (
    level.includes('warn')
    || action.includes('timeout')
    || action.includes('raid')
    || action.includes('blacklist')
    || action.includes('kick')
  ) return 'high'

  return 'medium'
}

function uniqueLines(lines = []) {
  return [...new Set(lines.map((line) => String(line || '').trim()).filter(Boolean))]
}

function buildIncidentSummary(entry, actionLabel, targetLabel) {
  const summary = String(entry?.summary || entry?.message || entry?.reason || entry?.description || '').trim()
  if (summary) return summary
  if (targetLabel) return `${actionLabel} sur ${targetLabel}.`
  return `${actionLabel} detecte.`
}

function buildIncidentDetails(entry, targetLabel) {
  const metadata = entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}
  const options = entry?.options && typeof entry.options === 'object' ? entry.options : {}

  return uniqueLines([
    ...(Array.isArray(entry?.details) ? entry.details : []),
    entry?.reason ? `Cause : ${entry.reason}` : '',
    options?.count ? `Elements touches : ${options.count}` : '',
    options?.channel_name || options?.channel_id
      ? `Canal concerne : ${options.channel_name ? `#${String(options.channel_name).replace(/^#/, '')}` : options.channel_id}`
      : '',
    metadata?.source_kind === 'runtime' ? 'Source : evenement capture en temps reel' : '',
    metadata?.source_kind === 'audit' ? 'Source : journal d audit Discord' : '',
    metadata?.changes_count ? `Changements detectes : ${metadata.changes_count}` : '',
    !Array.isArray(entry?.details) || entry.details.length === 0
      ? targetLabel
        ? `Element concerne : ${targetLabel}`
        : ''
      : '',
  ])
}

function normalizeEntry(entry, source) {
  const severity = inferSeverity(entry)
  const actor =
    entry?.actor?.global_name
    || entry?.actor?.username
    || entry?.executor?.global_name
    || entry?.executor?.username
    || entry?.metadata?.actor_name
    || entry?.username
    || 'Systeme'

  const actionLabel =
    entry?.event_type
    || entry?.action_label
    || entry?.action
    || entry?.action_name
    || entry?.title
    || 'Evenement'

  const targetLabel =
    entry?.target?.label
    || entry?.metadata?.target_label
    || entry?.target_username
    || null

  const details = buildIncidentDetails(entry, targetLabel)

  return {
    id: entry?.id || `${source}-${entry?.timestamp || entry?.created_at || Math.random()}`,
    source,
    severity,
    title: actionLabel,
    detail: buildIncidentSummary(entry, actionLabel, targetLabel),
    actor,
    actorAvatar: entry?.actor?.avatar_url || entry?.executor?.avatar_url || entry?.metadata?.actor_avatar_url || null,
    targetLabel,
    targetSubtitle: entry?.target?.subtitle || entry?.metadata?.target_subtitle || null,
    timestamp: entry?.timestamp || entry?.created_at || entry?.executed_at || entry?.date || null,
    details,
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
  const [expanded, setExpanded] = useState(false)

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
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.16em] ${severityUI[item.severity]}`}>
            {item.severity}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px] font-mono text-white/60 transition-all hover:border-white/15 hover:text-white"
          >
            Informations complementaires
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {item.targetLabel ? (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px] font-mono text-white/58">
            Cible : {item.targetLabel}
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

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 rounded-2xl border border-white/[0.08] bg-black/15 p-4">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Informations complementaires</p>
              {item.details.length > 0 ? (
                item.details.map((line, index) => (
                  <div key={`${item.id}-${index}`} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-white/78">
                    {line}
                  </div>
                ))
              ) : (
                <p className="text-sm text-white/42">Aucune information complementaire utile pour cette entree.</p>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
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
    if (!selectedGuildId) return undefined
    let active = true

    async function loadIncidents() {
      try {
        const [siteResponse, discordResponse] = await Promise.all([
          logsAPI.list(selectedGuildId, { limit: 24 }),
          logsAPI.discord(selectedGuildId, { limit: 24 }),
        ])

        if (!active) return

        const siteItems = (siteResponse.data?.logs || []).map((entry) => normalizeEntry(entry, 'site'))
        const discordItems = (discordResponse.data?.logs || []).map((entry) => normalizeEntry(entry, 'discord'))

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
          <p className="mt-2 text-white/40">La vue Incidents depend du serveur actif.</p>
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
                Vue plus claire des evenements sensibles, avec l'auteur, la cible et les details utiles quand tu ouvres l'entree.
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-3">
          <MetricCard label="Critiques" value={grouped.critical.length} tone="critical" />
          <MetricCard label="Eleves" value={grouped.high.length} tone="high" />
          <MetricCard label="Moderes" value={grouped.medium.length} tone="medium" />
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
              Aucun incident recent pour le moment.
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
                <p className="font-display text-lg font-700 text-white">Reponses rapides</p>
                <p className="mt-1 text-sm text-white/40">Va directement dans la bonne zone selon le type d'incident.</p>
              </div>
            </div>

            <div className="grid gap-3">
              <Link to="/dashboard/protection" className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-white/70 transition-all hover:border-white/12 hover:text-white">
                <p className="font-display font-700 text-white">Protection</p>
                <p className="mt-1 text-sm text-white/45">Renforce le verrouillage, l'anti-raid et l'anti-nuke.</p>
              </Link>
              <Link to="/dashboard/logs" className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-white/70 transition-all hover:border-white/12 hover:text-white">
                <p className="font-display font-700 text-white">Logs</p>
                <p className="mt-1 text-sm text-white/45">Ouvre les journaux complets avec plus de contexte.</p>
              </Link>
              <Link to="/dashboard/blocked" className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-white/70 transition-all hover:border-white/12 hover:text-white">
                <p className="font-display font-700 text-white">Controle d'acces</p>
                <p className="mt-1 text-sm text-white/45">Verifie les bannis serveur et la blacklist reseau.</p>
              </Link>
            </div>
          </div>

          <div className="spotlight-card p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                <Calendar className="h-5 w-5 text-white/65" />
              </div>
              <div>
                <p className="font-display text-lg font-700 text-white">Lecture rapide</p>
                <p className="mt-1 text-sm text-white/40">Chaque carte reste compacte, puis affiche les details exacts dans Informations complementaires.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
