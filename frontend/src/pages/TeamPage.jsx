import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Crown,
  Eye,
  History,
  Hourglass,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  ShieldCheck,
  Timer,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { teamAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { wsService } from '../services/websocket'

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

function formatRelativeTime(value) {
  if (!value) return null
  const diff = new Date(value) - Date.now()
  if (diff <= 0) return 'Expire'
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}j ${hours % 24}h restant${days > 1 ? 's' : ''}`
  if (hours > 0) return `${hours}h restante${hours > 1 ? 's' : ''}`
  const minutes = Math.max(1, Math.floor(diff / 60000))
  return `${minutes}min restante${minutes > 1 ? 's' : ''}`
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

function StatusBadge({ isSuspended, expiresAt }) {
  if (isSuspended) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-red-500/20 bg-red-500/10 text-red-300 text-xs font-mono">
        <Pause className="w-3 h-3" />
        Suspendu
      </span>
    )
  }

  if (expiresAt) {
    const remaining = formatRelativeTime(expiresAt)
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-200 text-xs font-mono">
        <Hourglass className="w-3 h-3" />
        {remaining}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-xs font-mono">
      <CheckCircle2 className="w-3 h-3" />
      Actif
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

function HeaderPill({ icon: Icon, label }) {
  return (
    <span className="feature-chip">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  )
}

const AUDIT_ACTION_LABELS = {
  invite: { label: 'Invitation', icon: UserPlus, tone: 'text-emerald-300' },
  revoke: { label: 'Revocation', icon: Trash2, tone: 'text-red-300' },
  role_change: { label: 'Role modifie', icon: Users, tone: 'text-violet-300' },
  suspend: { label: 'Suspension', icon: Pause, tone: 'text-amber-300' },
  unsuspend: { label: 'Reactivation', icon: Play, tone: 'text-emerald-300' },
  snapshot_create: { label: 'Sauvegarde creee', icon: Save, tone: 'text-violet-300' },
  snapshot_restore: { label: 'Sauvegarde restauree', icon: RotateCcw, tone: 'text-amber-300' },
  snapshot_delete: { label: 'Sauvegarde supprimee', icon: Trash2, tone: 'text-red-300' },
}

const EXPIRY_OPTIONS = [
  { value: 0, label: 'Permanent' },
  { value: 1, label: '1 heure' },
  { value: 6, label: '6 heures' },
  { value: 24, label: '1 jour' },
  { value: 72, label: '3 jours' },
  { value: 168, label: '1 semaine' },
  { value: 720, label: '30 jours' },
]

export default function TeamPage() {
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [overview, setOverview] = useState({ access: null, collaborators: [], snapshots: [] })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState('')
  const [inviteForm, setInviteForm] = useState({ target: '', access_role: 'admin', expires_in_hours: 0 })
  const [snapshotLabel, setSnapshotLabel] = useState('')
  const [activeTab, setActiveTab] = useState('team') // 'team' | 'audit'
  const [auditData, setAuditData] = useState({ items: [], total: 0, page: 1 })

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

  const loadAuditLog = async (page = 1) => {
    if (!selectedGuildId || !isOwner) return
    try {
      const response = await teamAPI.auditLog(selectedGuildId, { page, limit: 30 })
      setAuditData(response.data || { items: [], total: 0, page: 1 })
    } catch {
      // Silently fail for audit
    }
  }

  useEffect(() => {
    setInviteForm({ target: '', access_role: 'admin', expires_in_hours: 0 })
    setSnapshotLabel('')
    setOverview({ access: null, collaborators: [], snapshots: [] })
    setActiveTab('team')
    setAuditData({ items: [], total: 0, page: 1 })
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return
    loadOverview()
  }, [selectedGuildId])

  // Real-time sync via WebSocket
  useEffect(() => {
    if (!selectedGuildId) return undefined

    const handleTeamUpdate = (data) => {
      if (data?.guildId === selectedGuildId || !data?.guildId) {
        loadOverview({ silent: true })
        if (activeTab === 'audit' && isOwner) loadAuditLog(auditData.page)
      }
    }

    const handleSnapshotRestored = (data) => {
      if (data?.guildId === selectedGuildId) {
        loadOverview({ silent: true })
        toast.success('Le proprietaire a restaure une sauvegarde — les donnees sont synchronisees.')
      }
    }

    const unsub1 = wsService.on('team:updated', handleTeamUpdate)
    const unsub2 = wsService.on('team:snapshot_restored', handleSnapshotRestored)

    return () => {
      unsub1()
      unsub2()
    }
  }, [selectedGuildId, activeTab, isOwner])

  // Polling as fallback for sync
  useEffect(() => {
    if (!selectedGuildId) return undefined
    const intervalId = window.setInterval(() => {
      loadOverview({ silent: true })
    }, 8000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [selectedGuildId])

  // Load audit log when switching to audit tab
  useEffect(() => {
    if (activeTab === 'audit' && isOwner) {
      loadAuditLog(1)
    }
  }, [activeTab, isOwner, selectedGuildId])

  const handleInvite = async () => {
    if (!selectedGuildId || !inviteForm.target.trim()) return
    setSaving('invite')
    try {
      const response = await teamAPI.invite(selectedGuildId, {
        target: inviteForm.target.trim(),
        access_role: inviteForm.access_role,
        expires_in_hours: inviteForm.expires_in_hours,
      })
      setOverview(response.data)
      setInviteForm({ target: '', access_role: inviteForm.access_role, expires_in_hours: inviteForm.expires_in_hours })
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

  const handleSuspend = async (memberUserId, username, isSuspended) => {
    if (!selectedGuildId) return
    setSaving(`suspend:${memberUserId}`)
    try {
      const response = await teamAPI.suspendMember(selectedGuildId, memberUserId, { is_suspended: isSuspended })
      setOverview(response.data)
      toast.success(isSuspended ? `${username} suspendu` : `${username} reactive`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleRemoveMember = async (memberUserId, username) => {
    if (!selectedGuildId) return
    if (!window.confirm(`Retirer l'acces partage de ${username || 'ce compte'} ? Cette action est immediate.`)) return
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
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <HeaderPill icon={Users} label="Team" />
              <HeaderPill icon={ShieldCheck} label="token prive" />
              <HeaderPill icon={History} label={guild?.name || 'serveur'} />
            </div>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">Equipe & sauvegardes</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 sm:text-[15px]">Partage le dashboard proprement, garde le token cote serveur et pilote les retours arriere sans perdre la synchro.</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {isOwner && (
              <div className="flex rounded-2xl border border-white/10 bg-white/[0.03] p-1 overflow-hidden">
                <button type="button" onClick={() => setActiveTab('team')} className={`px-4 py-2.5 text-sm font-mono transition-all rounded-xl ${activeTab === 'team' ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-white/50 hover:text-white'}`}>
                  <Users className="w-4 h-4 inline mr-2" />
                  Equipe
                </button>
                <button type="button" onClick={() => setActiveTab('audit')} className={`px-4 py-2.5 text-sm font-mono transition-all rounded-xl ${activeTab === 'audit' ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-white/50 hover:text-white'}`}>
                  <ScrollText className="w-4 h-4 inline mr-2" />
                  Activite
                </button>
              </div>
            )}
            <button type="button" onClick={() => loadOverview()} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-mono text-white/70 transition-all hover:border-white/20 hover:text-white">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Recharger
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="Acces" value={isOwner ? 'Proprietaire' : (overview.access?.access_role || 'Partage')} hint={isOwner ? 'Tu gardes seul le token et les retours arriere.' : `Acces synchronise via ${overview.access?.owner_username || 'le proprietaire'}.`} tone="cyan" />
        <SummaryCard title="Collaborateurs" value={collaborators.filter((c) => !c.is_owner).length} hint="Chaque personne invitee voit les memes modules, commandes et reglages en direct." tone="violet" />
        <SummaryCard title="Sauvegardes" value={isOwner ? snapshots.length : 'Prive'} hint={isOwner ? 'Reviens exactement a un etat precedent du serveur.' : 'Seul le proprietaire d origine peut creer ou restaurer une sauvegarde.'} tone="amber" />
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'team' ? (
          <motion.div key="team" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <TeamTab
              isOwner={isOwner}
              collaborators={collaborators}
              snapshots={snapshots}
              saving={saving}
              inviteForm={inviteForm}
              setInviteForm={setInviteForm}
              snapshotLabel={snapshotLabel}
              setSnapshotLabel={setSnapshotLabel}
              overview={overview}
              ownerEntry={ownerEntry}
              locale={locale}
              onInvite={handleInvite}
              onMemberRole={handleMemberRole}
              onSuspend={handleSuspend}
              onRemoveMember={handleRemoveMember}
              onCreateSnapshot={handleCreateSnapshot}
              onRestoreSnapshot={handleRestoreSnapshot}
              onDeleteSnapshot={handleDeleteSnapshot}
            />
          </motion.div>
        ) : (
          <motion.div key="audit" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <AuditTab
              auditData={auditData}
              locale={locale}
              onPageChange={(page) => loadAuditLog(page)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Team Tab ─────────────────────────────────────────────────────────────────

function TeamTab({ isOwner, collaborators, snapshots, saving, inviteForm, setInviteForm, snapshotLabel, setSnapshotLabel, overview, ownerEntry, locale, onInvite, onMemberRole, onSuspend, onRemoveMember, onCreateSnapshot, onRestoreSnapshot, onDeleteSnapshot }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_380px]">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="spotlight-card p-6 space-y-5">
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
          <div className="feature-hero p-5">
            <div className="relative z-[1] grid gap-4 xl:grid-cols-[minmax(0,1fr)_250px]">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-white">
                  <UserPlus className="w-4 h-4 text-emerald-300" />
                  <p className="font-display font-700">Inviter une personne</p>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_140px_auto]">
                  <input className="input-field" placeholder="Pseudo, email, ID du site ou ID Discord" value={inviteForm.target} onChange={(event) => setInviteForm((current) => ({ ...current, target: event.target.value }))} />
                  <select className="select-field" value={inviteForm.access_role} onChange={(event) => setInviteForm((current) => ({ ...current, access_role: event.target.value }))}>
                    <option value="admin">Admin partage</option>
                    <option value="moderator">Moderateur partage</option>
                    <option value="viewer">Lecture</option>
                  </select>
                  <select className="select-field" value={inviteForm.expires_in_hours} onChange={(event) => setInviteForm((current) => ({ ...current, expires_in_hours: Number(event.target.value) }))}>
                    {EXPIRY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                  <button type="button" onClick={onInvite} disabled={saving === 'invite' || !inviteForm.target.trim()} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/15 transition-all disabled:opacity-50">
                    <Plus className="w-4 h-4" />
                    {saving === 'invite' ? 'Ajout...' : 'Inviter'}
                  </button>
                </div>
              </div>

              <div className="rounded-[22px] border border-white/8 bg-black/15 p-4">
                <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Flux simple</p>
                <div className="mt-3 space-y-2 text-sm text-white/55">
                  <p>1. Tu invites.</p>
                  <p>2. Le compte recoit le meme dashboard.</p>
                  <p>3. Tout reste synchro en direct.</p>
                </div>
              </div>
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
              className={`spotlight-card p-5 ${entry.is_suspended ? 'border-red-500/15 bg-red-500/[0.03]' : ''}`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  <Avatar
                    src={entry.avatar_url}
                    label={entry.username}
                    tone={entry.is_owner ? 'from-amber-500/25 to-orange-500/25' : entry.is_suspended ? 'from-red-500/25 to-red-600/25' : 'from-cyan-500/25 to-violet-500/25'}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`font-display font-700 text-lg truncate ${entry.is_suspended ? 'text-white/40 line-through' : 'text-white'}`}>{entry.username}</p>
                      {entry.is_owner ? <Crown className="w-4 h-4 text-amber-300" /> : null}
                      <RolePill role={entry.access_role} />
                      {!entry.is_owner && <StatusBadge isSuspended={entry.is_suspended} expiresAt={entry.expires_at} />}
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
                      onChange={(event) => onMemberRole(entry.user_id, event.target.value)}
                      disabled={saving === `member:${entry.user_id}` || entry.is_suspended}
                    >
                      <option value="admin">Admin partage</option>
                      <option value="moderator">Moderateur partage</option>
                      <option value="viewer">Lecture</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => onSuspend(entry.user_id, entry.username, !entry.is_suspended)}
                      disabled={saving === `suspend:${entry.user_id}`}
                      className={`inline-flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm font-mono transition-all disabled:opacity-50 ${
                        entry.is_suspended
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                          : 'border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
                      }`}
                    >
                      {entry.is_suspended ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                      {entry.is_suspended ? 'Reactiver' : 'Suspendre'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveMember(entry.user_id, entry.username)}
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
        <div className="feature-hero p-6 space-y-4">
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
            <div className="mt-3 pt-3 border-t border-white/8 space-y-1.5">
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Securite du token</p>
              <ul className="text-xs text-white/40 space-y-1">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" /> Chiffre AES-256 cote serveur</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" /> Jamais envoye aux clients</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" /> Invisible dans DevTools et reseau</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" /> Acces session uniquement, zero exposition</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="spotlight-card p-6 space-y-5">
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
                  onClick={onCreateSnapshot}
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
                        onClick={() => onRestoreSnapshot(snapshot)}
                        disabled={saving === `snapshot:restore:${snapshot.id}`}
                        className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-sm font-mono hover:bg-emerald-500/15 transition-all disabled:opacity-50"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Restaurer
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSnapshot(snapshot)}
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

        <div className="feature-hero p-5">
          <div className="relative z-[1]">
          <div className="flex items-center gap-2 text-emerald-200">
            <CheckCircle2 className="w-4 h-4" />
            <p className="font-display font-700">Synchronisation live</p>
          </div>
          <p className="mt-3 text-sm leading-6 text-white/60">
            Les invites recuperent automatiquement les memes commandes IA, les memes protections et les memes reglages. Si tu restaures une sauvegarde, tout revient ensemble comme avant.
          </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Audit Tab ─────────────────────────────────────────────────────────────────

function AuditTab({ auditData, locale, onPageChange }) {
  const { items, total, page, limit = 30 } = auditData
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="spotlight-card p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 flex items-center justify-center shrink-0">
          <ScrollText className="w-5 h-5 text-neon-cyan" />
        </div>
        <div>
          <p className="font-display font-700 text-white text-lg">Journal d'activite</p>
          <p className="text-white/40 text-sm mt-1">Toutes les actions de l equipe, en temps reel. Visible uniquement par le proprietaire.</p>
        </div>
      </div>

      {items.length === 0 && (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-8 text-center text-white/40 text-sm">
          <Eye className="w-10 h-10 text-white/10 mx-auto mb-3" />
          Aucune activite enregistree pour le moment.
        </div>
      )}

      <div className="space-y-2">
        {items.map((logEntry, index) => {
          const config = AUDIT_ACTION_LABELS[logEntry.action_type] || { label: logEntry.action_type, icon: AlertTriangle, tone: 'text-white/50' }
          const Icon = config.icon

          return (
            <motion.div
              key={logEntry.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(index * 0.03, 0.15) }}
              className="flex items-start gap-4 px-4 py-3.5 rounded-2xl border border-white/6 bg-white/[0.02] hover:bg-white/[0.04] transition-all"
            >
              <div className={`w-9 h-9 rounded-xl border border-white/10 bg-white/[0.04] flex items-center justify-center shrink-0 ${config.tone}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display font-600 text-white text-sm">{logEntry.actor_username || 'Inconnu'}</span>
                  <span className={`text-xs font-mono ${config.tone}`}>{config.label}</span>
                  {logEntry.target && (
                    <span className="text-xs text-white/40 font-mono truncate">→ {logEntry.target}</span>
                  )}
                </div>
                {logEntry.details && Object.keys(logEntry.details).length > 0 && (
                  <p className="text-xs text-white/30 font-mono mt-1">
                    {Object.entries(logEntry.details).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </p>
                )}
              </div>
              <span className="text-xs text-white/25 font-mono whitespace-nowrap shrink-0">
                {formatDate(locale, logEntry.created_at)}
              </span>
            </motion.div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/50 text-sm font-mono hover:text-white disabled:opacity-30 transition-all"
          >
            Precedent
          </button>
          <span className="text-xs text-white/40 font-mono px-3">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/50 text-sm font-mono hover:text-white disabled:opacity-30 transition-all"
          >
            Suivant
          </button>
        </div>
      )}
    </div>
  )
}
