import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Crown,
  History,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { teamAPI } from '../services/api'
import { useGuildStore } from '../stores'

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Erreur inattendue'
}

function formatDate(locale, value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString(locale)
  } catch {
    return value
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

function Avatar({ src, label, size = 'w-12 h-12', tone = 'from-cyan-500/25 to-violet-500/25' }) {
  if (src) {
    return <img src={src} alt={label} className={`${size} rounded-2xl object-cover border border-white/10 shadow-[0_18px_36px_rgba(0,0,0,0.22)]`} />
  }

  return (
    <div className={`${size} rounded-2xl border border-white/10 bg-gradient-to-br ${tone} flex items-center justify-center text-white/75 font-mono text-xs shadow-[0_18px_36px_rgba(0,0,0,0.22)]`}>
      {initials(label)}
    </div>
  )
}

function RolePill({ role }) {
  const styles = {
    owner: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    admin: 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan',
    moderator: 'border-violet-500/20 bg-violet-500/10 text-violet-200',
    viewer: 'border-white/10 bg-white/[0.04] text-white/55',
  }

  const labels = {
    owner: 'Proprietaire',
    admin: 'Admin partage',
    moderator: 'Moderateur partage',
    viewer: 'Lecture',
  }

  return (
    <span className={`px-2.5 py-1 rounded-full border text-xs font-mono ${styles[role] || styles.viewer}`}>
      {labels[role] || role}
    </span>
  )
}

function SummaryCard({ title, value, hint, tone = 'cyan' }) {
  const tones = {
    cyan: 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    violet: 'border-violet-500/20 bg-violet-500/10 text-violet-200',
  }

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] || tones.cyan}`}>
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] opacity-70">{title}</p>
      <p className="mt-2 font-display text-2xl font-800 text-white">{value}</p>
      <p className="mt-2 text-sm text-white/55">{hint}</p>
    </div>
  )
}

export default function TeamPage() {
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [overview, setOverview] = useState({ access: null, collaborators: [], snapshots: [] })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState('')
  const [inviteForm, setInviteForm] = useState({ target: '', access_role: 'admin' })
  const [snapshotLabel, setSnapshotLabel] = useState('')

  const locale = typeof navigator !== 'undefined' ? navigator.language || 'fr-FR' : 'fr-FR'
  const isOwner = !!overview.access?.is_owner
  const collaborators = overview.collaborators || []
  const snapshots = overview.snapshots || []
  const ownerEntry = useMemo(() => collaborators.find((entry) => entry.is_owner) || null, [collaborators])

  const loadOverview = async ({ silent = false } = {}) => {
    if (!selectedGuildId) return
    if (!silent) setLoading(true)
    try {
      const response = await teamAPI.overview(selectedGuildId)
      setOverview(response.data || { access: null, collaborators: [], snapshots: [] })
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    setInviteForm({ target: '', access_role: 'admin' })
    setSnapshotLabel('')
    setOverview({ access: null, collaborators: [], snapshots: [] })
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return
    loadOverview()
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return undefined
    const intervalId = window.setInterval(() => {
      loadOverview({ silent: true })
    }, 8000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [selectedGuildId])

  const handleInvite = async () => {
    if (!selectedGuildId || !inviteForm.target.trim()) return
    setSaving('invite')
    try {
      const response = await teamAPI.invite(selectedGuildId, {
        target: inviteForm.target.trim(),
        access_role: inviteForm.access_role,
      })
      setOverview(response.data)
      setInviteForm({ target: '', access_role: inviteForm.access_role })
      toast.success('Acces partage ajoute')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleMemberRole = async (memberUserId, accessRole) => {
    if (!selectedGuildId) return
    setSaving(`member:${memberUserId}`)
    try {
      const response = await teamAPI.updateMember(selectedGuildId, memberUserId, { access_role: accessRole })
      setOverview(response.data)
      toast.success('Role partage mis a jour')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleRemoveMember = async (memberUserId, username) => {
    if (!selectedGuildId) return
    if (!window.confirm(`Retirer l'acces partage de ${username || 'ce compte'} ?`)) return
    setSaving(`remove:${memberUserId}`)
    try {
      const response = await teamAPI.removeMember(selectedGuildId, memberUserId)
      setOverview(response.data)
      toast.success('Acces partage retire')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleCreateSnapshot = async () => {
    if (!selectedGuildId) return
    setSaving('snapshot:create')
    try {
      const response = await teamAPI.createSnapshot(selectedGuildId, { label: snapshotLabel.trim() })
      setOverview((current) => ({ ...current, snapshots: response.data?.snapshots || current.snapshots }))
      setSnapshotLabel('')
      toast.success('Sauvegarde creee')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleRestoreSnapshot = async (snapshot) => {
    if (!selectedGuildId || !snapshot?.id) return
    if (!window.confirm(`Restaurer "${snapshot.label || 'cette sauvegarde'}" ? Cela remettra protections et commandes comme avant.`)) return
    setSaving(`snapshot:restore:${snapshot.id}`)
    try {
      const response = await teamAPI.restoreSnapshot(selectedGuildId, snapshot.id)
      setOverview(response.data)
      toast.success('Sauvegarde restauree')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleDeleteSnapshot = async (snapshot) => {
    if (!selectedGuildId || !snapshot?.id) return
    if (!window.confirm(`Supprimer "${snapshot.label || 'cette sauvegarde'}" ?`)) return
    setSaving(`snapshot:delete:${snapshot.id}`)
    try {
      const response = await teamAPI.deleteSnapshot(selectedGuildId, snapshot.id)
      setOverview((current) => ({ ...current, snapshots: response.data?.snapshots || [] }))
      toast.success('Sauvegarde supprimee')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  if (!selectedGuildId) {
    return (
      <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto">
        <div className="glass-card p-10 text-center">
          <Users className="w-12 h-12 text-white/10 mx-auto mb-4" />
          <p className="font-display font-700 text-white text-xl">Choisis d'abord un serveur</p>
          <p className="text-white/40 mt-2">La categorie Equipe devient disponible des qu'un serveur est selectionne.</p>
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
          <h1 className="font-display font-800 text-2xl text-white">Equipe & sauvegardes</h1>
          <p className="text-white/40 text-sm mt-1">Acces partage securise sans donner le token. Toute la config reste synchronisee sur {guild?.name}.</p>
        </div>
        <button
          type="button"
          onClick={() => loadOverview()}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Recharger
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="Acces" value={isOwner ? 'Proprietaire' : (overview.access?.access_role || 'Partage')} hint={isOwner ? 'Tu gardes seul le token et les retours arriere.' : `Acces synchronise via ${overview.access?.owner_username || 'le proprietaire'}.`} tone="cyan" />
        <SummaryCard title="Collaborateurs" value={collaborators.length} hint="Chaque personne invitee voit les memes modules, commandes et reglages en direct." tone="violet" />
        <SummaryCard title="Sauvegardes" value={isOwner ? snapshots.length : 'Prive'} hint={isOwner ? 'Reviens exactement a un etat precedent du serveur.' : 'Seul le proprietaire d origine peut creer ou restaurer une sauvegarde.'} tone="amber" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_380px]">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-neon-cyan" />
            </div>
            <div>
              <p className="font-display font-700 text-white text-lg">Equipe connectee</p>
              <p className="text-white/40 text-sm mt-1">Les comptes invites pilotent exactement le meme bot et les memes reglages, sans voir le token.</p>
            </div>
          </div>

          {isOwner && (
            <div className="rounded-3xl border border-white/8 bg-white/[0.02] p-5 space-y-4">
              <div className="flex items-center gap-2 text-white">
                <UserPlus className="w-4 h-4 text-emerald-300" />
                <p className="font-display font-700">Inviter une personne</p>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
                <input
                  className="input-field"
                  placeholder="Pseudo, email, ID du site ou ID Discord"
                  value={inviteForm.target}
                  onChange={(event) => setInviteForm((current) => ({ ...current, target: event.target.value }))}
                />
                <select
                  className="select-field"
                  value={inviteForm.access_role}
                  onChange={(event) => setInviteForm((current) => ({ ...current, access_role: event.target.value }))}
                >
                  <option value="admin">Admin partage</option>
                  <option value="moderator">Moderateur partage</option>
                  <option value="viewer">Lecture</option>
                </select>
                <button
                  type="button"
                  onClick={handleInvite}
                  disabled={saving === 'invite' || !inviteForm.target.trim()}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/15 transition-all disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  {saving === 'invite' ? 'Ajout...' : 'Inviter'}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {collaborators.length === 0 && (
              <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6 text-center text-white/40 text-sm">
                Aucun acces partage pour le moment.
              </div>
            )}

            {collaborators.map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.04, 0.18) }}
                className="rounded-3xl border border-white/8 bg-white/[0.02] p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    <Avatar
                      src={entry.avatar_url}
                      label={entry.username}
                      tone={entry.is_owner ? 'from-amber-500/25 to-orange-500/25' : 'from-cyan-500/25 to-violet-500/25'}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-display font-700 text-white text-lg truncate">{entry.username}</p>
                        {entry.is_owner ? <Crown className="w-4 h-4 text-amber-300" /> : null}
                        <RolePill role={entry.access_role} />
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-white/35 font-mono">
                        <span>ID site: {entry.user_id}</span>
                        {entry.discord_id ? <span>Discord: {entry.discord_id}</span> : null}
                        <span>Depuis: {formatDate(locale, entry.accepted_at || entry.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {!entry.is_owner && isOwner && (
                    <div className="flex flex-wrap gap-2">
                      <select
                        className="select-field min-w-[170px]"
                        value={entry.access_role}
                        onChange={(event) => handleMemberRole(entry.user_id, event.target.value)}
                        disabled={saving === `member:${entry.user_id}`}
                      >
                        <option value="admin">Admin partage</option>
                        <option value="moderator">Moderateur partage</option>
                        <option value="viewer">Lecture</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(entry.user_id, entry.username)}
                        disabled={saving === `remove:${entry.user_id}`}
                        className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm font-mono hover:bg-red-500/15 transition-all disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        Retirer
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="space-y-5">
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-amber-500/20 bg-amber-500/10 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-amber-300" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Token toujours prive</p>
                <p className="text-white/40 text-sm mt-1">Le proprietaire garde seul le token. Les invites utilisent la meme configuration sans jamais le voir.</p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 text-sm text-white/55 leading-6">
              <p>Proprietaire: <span className="text-white font-medium">{overview.access?.owner_username || ownerEntry?.username || 'Inconnu'}</span></p>
              <p className="mt-2">Chaque changement de modules, protections, commandes et messages reste synchronise pour toute l equipe.</p>
            </div>
          </div>

          <div className="glass-card p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0">
                <History className="w-5 h-5 text-violet-200" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Sauvegardes serveur</p>
                <p className="text-white/40 text-sm mt-1">Retour arriere exact des modules, commandes, logs et messages auto.</p>
              </div>
            </div>

            {!isOwner && (
              <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5 text-white/45 text-sm leading-6">
                Seul le proprietaire d'origine peut creer, restaurer ou supprimer une sauvegarde complete.
              </div>
            )}

            {isOwner && (
              <>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <input
                    className="input-field"
                    placeholder="Nom lisible de la sauvegarde (optionnel)"
                    value={snapshotLabel}
                    onChange={(event) => setSnapshotLabel(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handleCreateSnapshot}
                    disabled={saving === 'snapshot:create'}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-violet-500/25 bg-violet-500/10 text-violet-200 font-mono text-sm hover:bg-violet-500/15 transition-all disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {saving === 'snapshot:create' ? 'Creation...' : 'Sauvegarder'}
                  </button>
                </div>

                <div className="space-y-3">
                  {snapshots.length === 0 && (
                    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5 text-center text-white/40 text-sm">
                      Aucune sauvegarde pour le moment.
                    </div>
                  )}

                  {snapshots.map((snapshot) => (
                    <div key={snapshot.id} className="rounded-3xl border border-white/8 bg-white/[0.02] p-5 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-display font-700 text-white truncate">{snapshot.label || 'Sauvegarde sans nom'}</p>
                          <div className="flex flex-wrap gap-3 mt-2 text-xs text-white/35 font-mono">
                            <span className="inline-flex items-center gap-1"><Clock3 className="w-3.5 h-3.5" />{formatDate(locale, snapshot.created_at)}</span>
                            <span>Par: {snapshot.created_by_username || 'Inconnu'}</span>
                          </div>
                        </div>
                        <Avatar src={snapshot.created_by_avatar_url} label={snapshot.created_by_username} size="w-11 h-11" tone="from-violet-500/25 to-fuchsia-500/25" />
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-2xl border border-white/8 bg-black/15 p-3">
                          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Modules</p>
                          <p className="mt-2 text-white font-display font-700 text-lg">{snapshot.module_count}</p>
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-black/15 p-3">
                          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Commandes</p>
                          <p className="mt-2 text-white font-display font-700 text-lg">{snapshot.command_count}</p>
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-black/15 p-3">
                          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Extras</p>
                          <p className="mt-2 text-white font-display font-700 text-lg">{Number(!!snapshot.has_log_channel) + Number(!!snapshot.has_dm_settings)}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleRestoreSnapshot(snapshot)}
                          disabled={saving === `snapshot:restore:${snapshot.id}`}
                          className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-sm font-mono hover:bg-emerald-500/15 transition-all disabled:opacity-50"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Restaurer
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSnapshot(snapshot)}
                          disabled={saving === `snapshot:delete:${snapshot.id}`}
                          className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm font-mono hover:bg-red-500/15 transition-all disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="rounded-3xl border border-emerald-500/15 bg-gradient-to-br from-emerald-500/10 to-cyan-500/6 p-5">
            <div className="flex items-center gap-2 text-emerald-200">
              <CheckCircle2 className="w-4 h-4" />
              <p className="font-display font-700">Synchronisation live</p>
            </div>
            <p className="mt-3 text-sm leading-6 text-white/60">
              Les invites recuperent automatiquement les memes commandes IA, les memes protections et les memes reglages. Si tu restaures une sauvegarde, tout revient ensemble comme avant.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
