import { ArrowRight, Shield } from 'lucide-react'
import { Link } from 'react-router-dom'

export const ACTION_LABELS = {
  warn: 'Warn',
  timeout: 'Mute temporaire',
  untimeout: 'Retirer le mute',
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Deban',
  blacklist: 'Blacklist reseau',
  member_update: 'Mise a jour du membre',
  role_update: 'Mise a jour des roles',
  voice_move: 'Deplacement vocal',
  voice_disconnect: 'Deconnexion vocale',
  bot_add: 'Ajout du bot',
  message_delete: 'Suppression message',
  message_bulk_delete: 'Suppression messages',
  message_pin: 'Message epingle',
  message_unpin: 'Message desepingle',
  timeout_remove: 'Fin du mute',
}

export const ACTION_COLORS = {
  warn: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  timeout: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300',
  untimeout: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
  kick: 'border-orange-500/20 bg-orange-500/10 text-orange-300',
  ban: 'border-red-500/20 bg-red-500/10 text-red-300',
  unban: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  blacklist: 'border-violet-500/20 bg-violet-500/10 text-violet-300',
  message_delete: 'border-pink-500/20 bg-pink-500/10 text-pink-300',
  message_bulk_delete: 'border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-300',
}

export const LOG_LEVEL_COLORS = {
  info: 'text-cyan-300 border-cyan-500/20 bg-cyan-500/10',
  warn: 'text-amber-300 border-amber-500/20 bg-amber-500/10',
  error: 'text-red-300 border-red-500/20 bg-red-500/10',
  success: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10',
  debug: 'text-violet-300 border-violet-500/20 bg-violet-500/10',
}

export function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Unexpected error'
}

export function parseDurationInput(value) {
  const match = String(value || '').trim().match(/^(\d+)\s*(s|m|h|d)$/i)
  if (!match) return null
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 }
  return amount * multipliers[unit]
}

export function formatDate(locale, value) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString(locale)
  } catch {
    return String(value)
  }
}

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?'
}

export function renderAvatar(url, label, accent = 'from-cyan-500/25 to-violet-500/25', size = 'w-12 h-12') {
  const fallback = (
    <div className={`${size} rounded-2xl border border-white/10 bg-gradient-to-br ${accent} flex items-center justify-center text-white/75 font-mono text-xs shadow-[0_14px_36px_rgba(0,0,0,0.24)]`}>
      {initials(label)}
    </div>
  )

  if (url) {
    return (
      <div className={`${size} relative shrink-0`}>
        <img
          src={url}
          alt={label}
          className="w-full h-full rounded-2xl object-cover border border-white/10 shadow-[0_14px_36px_rgba(0,0,0,0.24)]"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
            const fallbackNode = event.currentTarget.nextElementSibling
            if (fallbackNode) fallbackNode.style.display = 'flex'
          }}
        />
        <div className="absolute inset-0 hidden">
          {fallback}
        </div>
      </div>
    )
  }

  return fallback
}

export function SummaryCard({ label, value, tone }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] opacity-70">{label}</p>
      <p className="mt-2 font-display text-2xl font-800">{value}</p>
    </div>
  )
}

export function SelectGuildState({
  title = 'Choisis d abord un serveur',
  body = 'Cette section devient disponible des que ton serveur est selectionne.',
  actionLabel = 'Choisir un serveur',
}) {
  return (
    <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto">
      <div className="glass-card p-10 text-center">
        <Shield className="w-12 h-12 text-white/10 mx-auto mb-4" />
        <p className="font-display font-700 text-white text-xl">{title}</p>
        <p className="text-white/40 mt-2">{body}</p>
        <Link
          to="/dashboard/servers"
          className="inline-flex items-center gap-2 mt-5 px-5 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/20 transition-all"
        >
          {actionLabel}
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  )
}
