import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { 
  ArrowRight, 
  Ban, 
  Clock, 
  LogOut, 
  Search, 
  ShieldOff, 
  UserRoundX,
  Shield,
  AlertTriangle,
  MessageCircle,
  History,
  TrendingUp,
  Activity,
  UserCheck,
  UserX,
  Zap
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { modAPI, messagesAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'
import { ACTION_LABELS, ACTION_COLORS, getErrorMessage, formatDate, initials, parseDurationInput } from '../components/moderation/moderationUI'

function Avatar({ src, label, tone = 'from-cyan-500/25 to-violet-500/25', size = 'w-20 h-20' }) {
  if (src) {
    return <img src={src} alt={label} className={`${size} rounded-2xl object-cover border border-white/10 shadow-[0_18px_36px_rgba(0,0,0,0.22)]`} />
  }

  return (
    <div className={`${size} rounded-2xl border border-white/10 bg-gradient-to-br ${tone} flex items-center justify-center text-white/75 font-mono text-sm shadow-[0_18px_36px_rgba(0,0,0,0.22)]`}>
      {initials(label)}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, tone }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" />
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] opacity-70">{label}</p>
      </div>
      <p className="font-display text-2xl font-800">{value}</p>
    </div>
  )
}

function ActionHistoryItem({ action, locale }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-white/8 bg-white/[0.02]">
      <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${ACTION_COLORS[action.action_type] || 'border-white/10 bg-white/[0.04]'}`}>
        {action.action_type === 'warn' && <AlertTriangle className="w-4 h-4" />}
        {action.action_type === 'timeout' && <Clock className="w-4 h-4" />}
        {action.action_type === 'kick' && <LogOut className="w-4 h-4" />}
        {action.action_type === 'ban' && <Ban className="w-4 h-4" />}
        {!['warn', 'timeout', 'kick', 'ban'].includes(action.action_type) && <Shield className="w-4 h-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full border text-xs font-mono ${ACTION_COLORS[action.action_type] || 'border-white/10 bg-white/[0.04] text-white/55'}`}>
            {ACTION_LABELS[action.action_type] || action.action_type}
          </span>
          <span className="text-xs text-white/35 font-mono">{formatDate(locale, action.created_at)}</span>
        </div>
        <p className="text-sm text-white/70 mt-1">{action.reason || 'Aucune raison'}</p>
        <p className="text-xs text-white/40 mt-1">Par {action.moderator_username || action.moderator_id}</p>
      </div>
    </div>
  )
}

export default function SearchPage() {
  const { locale } = useI18n()
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [profile, setProfile] = useState(null)
  const [actionHistory, setActionHistory] = useState([])
  const [showActionModal, setShowActionModal] = useState(false)
  const [actionType, setActionType] = useState('')
  const [actionReason, setActionReason] = useState('')
  const [actionDuration, setActionDuration] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setQuery('')
    setProfile(null)
    setActionHistory([])
  }, [selectedGuildId])

  async function handleSearch() {
    if (!selectedGuildId || !query.trim()) return
    setSearching(true)
    setProfile(null)
    setActionHistory([])
    
    try {
      const response = await modAPI.userProfile(selectedGuildId, { q: query.trim() })
      setProfile(response.data.profile || null)
      setActionHistory(response.data.history || [])
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSearching(false)
    }
  }

  async function handleQuickAction(type) {
    setActionType(type)
    setActionReason('')
    setActionDuration('')
    setShowActionModal(true)
  }

  async function handleSubmitAction() {
    if (!selectedGuildId || !profile?.id || !actionType || submitting) return
    
    const payload = {
      target_user_id: profile.id,
      target_username: profile.display_name || profile.username || profile.id,
      reason: actionReason.trim() || 'Action rapide depuis la recherche',
    }

    if (actionType === 'timeout' && actionDuration.trim()) {
      const ms = parseDurationInput(actionDuration.trim())
      if (ms > 0) payload.duration_ms = ms
    }

    setSubmitting(true)
    try {
      await modAPI.quickAction(selectedGuildId, actionType, payload)
      toast.success(`Action ${ACTION_LABELS[actionType] || actionType} executee`)
      setShowActionModal(false)
      await handleSearch()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSendDM() {
    if (!selectedGuildId || !profile?.id) return
    try {
      await messagesAPI.send(selectedGuildId, {
        target_user_id: profile.id,
        target_username: profile.display_name || profile.username || profile.id,
        title: 'Message du staff',
        message: 'Bonjour, le staff souhaite vous contacter.',
      })
      toast.success('MP envoye')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  if (!selectedGuildId) {
    return (
      <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto">
        <div className="glass-card p-10 text-center">
          <ShieldOff className="w-12 h-12 text-white/10 mx-auto mb-4" />
          <p className="font-display font-700 text-white text-xl">Choisis d'abord un serveur</p>
          <p className="text-white/40 mt-2">La recherche utilisateur fonctionne serveur par serveur.</p>
          <Link to="/dashboard/servers" className="inline-flex items-center gap-2 mt-5 px-5 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/20 transition-all">
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
          <h1 className="font-display font-800 text-2xl text-white">Recherche & Actions</h1>
          <p className="text-white/40 text-sm mt-1">Recherche rapide d'utilisateurs avec profil complet et actions directes. - {guild?.name}</p>
        </div>
      </div>

      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 flex items-center justify-center shrink-0">
            <Search className="w-5 h-5 text-neon-cyan" />
          </div>
          <div>
            <p className="font-display font-700 text-white text-lg">Recherche utilisateur</p>
            <p className="text-white/40 text-sm mt-1">Entrez un ID Discord, pseudo ou surnom pour charger le profil complet.</p>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-white/25 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              className="input-field pl-11"
              placeholder="ID Discord, pseudo, ou surnom..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSearch()
                }
              }}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={!query.trim() || searching}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/15 transition-all disabled:opacity-50"
          >
            <Search className={`w-4 h-4 ${searching ? 'animate-pulse' : ''}`} />
            Rechercher
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {searching && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {[...Array(3)].map((_, i) => <div key={i} className="h-32 rounded-3xl skeleton" />)}
          </motion.div>
        )}

        {!searching && profile && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="space-y-5"
          >
            <div className="glass-card p-6 space-y-6">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-5">
                  <Avatar 
                    src={profile.avatar_url} 
                    label={profile.display_name || profile.username} 
                    tone="from-violet-500/25 to-fuchsia-500/25"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h2 className="font-display font-800 text-white text-2xl truncate">{profile.display_name || profile.username}</h2>
                      {profile.banned && (
                        <span className="px-3 py-1 rounded-full border border-red-500/20 bg-red-500/10 text-red-300 text-xs font-mono flex items-center gap-1.5">
                          <Ban className="w-3 h-3" />
                          Banni
                        </span>
                      )}
                      {profile.in_server && !profile.banned && (
                        <span className="px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-xs font-mono flex items-center gap-1.5">
                          <UserCheck className="w-3 h-3" />
                          Dans le serveur
                        </span>
                      )}
                      {!profile.in_server && !profile.banned && (
                        <span className="px-3 py-1 rounded-full border border-white/10 bg-white/[0.04] text-white/55 text-xs font-mono flex items-center gap-1.5">
                          <UserX className="w-3 h-3" />
                          Hors serveur
                        </span>
                      )}
                    </div>
                    <p className="text-white/55 text-sm">@{profile.username || profile.id}</p>
                    <p className="text-white/35 text-xs font-mono mt-2">ID: {profile.id}</p>
                    {profile.joined_at && (
                      <p className="text-white/35 text-xs mt-1">Rejoint le {formatDate(locale, profile.joined_at)}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleQuickAction('warn')}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-300 text-sm font-mono hover:bg-amber-500/15 transition-all"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    Warn
                  </button>
                  <button
                    onClick={() => handleQuickAction('timeout')}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-orange-500/25 bg-orange-500/10 text-orange-300 text-sm font-mono hover:bg-orange-500/15 transition-all"
                  >
                    <Clock className="w-4 h-4" />
                    Timeout
                  </button>
                  <button
                    onClick={() => handleQuickAction('kick')}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-red-500/25 bg-red-500/10 text-red-300 text-sm font-mono hover:bg-red-500/15 transition-all"
                  >
                    <LogOut className="w-4 h-4" />
                    Kick
                  </button>
                  {!profile.banned && (
                    <button
                      onClick={() => handleQuickAction('ban')}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-red-500/25 bg-red-500/10 text-red-300 text-sm font-mono hover:bg-red-500/15 transition-all"
                    >
                      <Ban className="w-4 h-4" />
                      Ban
                    </button>
                  )}
                  {profile.banned && (
                    <button
                      onClick={() => handleQuickAction('unban')}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 text-sm font-mono hover:bg-emerald-500/15 transition-all"
                    >
                      <UserCheck className="w-4 h-4" />
                      Unban
                    </button>
                  )}
                  <button
                    onClick={handleSendDM}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-violet-500/25 bg-violet-500/10 text-violet-300 text-sm font-mono hover:bg-violet-500/15 transition-all"
                  >
                    <MessageCircle className="w-4 h-4" />
                    MP
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <StatCard 
                  icon={AlertTriangle} 
                  label="Avertissements" 
                  value={profile.warning_count || 0} 
                  tone="border-amber-500/20 bg-amber-500/10 text-amber-300" 
                />
                <StatCard 
                  icon={Shield} 
                  label="Actions totales" 
                  value={actionHistory.length} 
                  tone="border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan" 
                />
                <StatCard 
                  icon={Activity} 
                  label="Derniere action" 
                  value={actionHistory.length > 0 ? 'Recente' : 'Aucune'} 
                  tone="border-violet-500/20 bg-violet-500/10 text-violet-300" 
                />
                <StatCard 
                  icon={TrendingUp} 
                  label="Statut" 
                  value={profile.banned ? 'Banni' : profile.in_server ? 'Actif' : 'Absent'} 
                  tone={profile.banned ? 'border-red-500/20 bg-red-500/10 text-red-300' : profile.in_server ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/[0.04] text-white/55'} 
                />
              </div>
            </div>

            {actionHistory.length > 0 && (
              <div className="glass-card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0">
                    <History className="w-5 h-5 text-violet-300" />
                  </div>
                  <div>
                    <p className="font-display font-700 text-white text-lg">Historique des actions</p>
                    <p className="text-white/40 text-sm mt-1">{actionHistory.length} action{actionHistory.length > 1 ? 's' : ''} enregistree{actionHistory.length > 1 ? 's' : ''}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {actionHistory.slice(0, 10).map((action) => (
                    <ActionHistoryItem key={action.id} action={action} locale={locale} />
                  ))}
                  {actionHistory.length > 10 && (
                    <p className="text-center text-white/40 text-sm font-mono">
                      ... et {actionHistory.length - 10} action{actionHistory.length - 10 > 1 ? 's' : ''} de plus
                    </p>
                  )}
                </div>
              </div>
            )}

            {actionHistory.length === 0 && (
              <div className="glass-card p-8 text-center">
                <History className="w-12 h-12 text-white/10 mx-auto mb-4" />
                <p className="font-display font-700 text-white text-lg">Aucun historique</p>
                <p className="text-white/40 mt-2 text-sm">Cet utilisateur n'a pas d'actions de moderation enregistrees.</p>
              </div>
            )}
          </motion.div>
        )}

        {!searching && !profile && query.trim() && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass-card p-8 text-center"
          >
            <UserRoundX className="w-12 h-12 text-white/10 mx-auto mb-4" />
            <p className="font-display font-700 text-white text-lg">Utilisateur introuvable</p>
            <p className="text-white/40 mt-2 text-sm">Aucun utilisateur ne correspond a cette recherche.</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showActionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowActionModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card p-6 max-w-md w-full space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 ${ACTION_COLORS[actionType] || 'border-white/10 bg-white/[0.04]'}`}>
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-display font-700 text-white text-lg">
                    {ACTION_LABELS[actionType] || actionType}
                  </p>
                  <p className="text-white/40 text-sm mt-1">
                    Action sur {profile?.display_name || profile?.username}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <label className="block space-y-2">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Raison</span>
                  <textarea
                    className="input-field min-h-[100px] resize-y"
                    placeholder="Expliquez la raison de cette action..."
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                  />
                </label>

                {actionType === 'timeout' && (
                  <label className="block space-y-2">
                    <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Duree</span>
                    <input
                      className="input-field"
                      placeholder="Ex: 10m, 1h, 1d"
                      value={actionDuration}
                      onChange={(e) => setActionDuration(e.target.value)}
                    />
                    <p className="text-xs text-white/35">Format: 10m (minutes), 1h (heures), 1d (jours)</p>
                  </label>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowActionModal(false)}
                  className="flex-1 px-4 py-3 rounded-2xl border border-white/10 bg-white/[0.03] text-white/70 font-mono text-sm hover:text-white hover:border-white/20 transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSubmitAction}
                  disabled={submitting}
                  className={`flex-1 px-4 py-3 rounded-2xl border font-mono text-sm transition-all disabled:opacity-50 ${ACTION_COLORS[actionType] || 'border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/15'}`}
                >
                  {submitting ? 'Execution...' : 'Confirmer'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
